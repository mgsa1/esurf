/**
 * Breaking-wave field for SURF mode — turns the rolling sine sheet into a
 * wave you can surf: every crest "peels" (breaks progressively along its
 * length) and the break chases the rider down the line.
 *
 * Wave coordinates (wave 1 only):
 *   along : distance along the propagation direction (radial: distance from origin)
 *   s     : distance along the crest (tangent)
 *   psi   : phase relative to the nearest crest, (−π, π]
 *           0 = crest top, >0 = front face (downhill toward the beach), <0 = back
 *   n     : crest index (crest n sits where k·along − ω·t = 2πn)
 *
 * Each crest n has a peel point that moves along s at peelSpeed() in a fixed
 * direction (alternating lefts and rights). Relative to the peel:
 *   d > 0 : already broken — whitewater, crest collapsed
 *   d ≈ 0 : the pocket — steepest face, thrown lip, tube zone
 *   d ≪ 0 : the shoulder — wave flattens out the further ahead you are
 *
 * Peels are registered lazily the first time a crest comes into view, starting
 * START_BEHIND metres behind the rider, so every wave gives you a few seconds
 * to set up. The visualizer never uses this: it keeps the pure wave math.
 */

import { liveSurfaceZ } from '../math/liveSurface';
import type { WaveParams } from '../types';

const G = 9.81;
const TAU = Math.PI * 2;

/** Peel speed relative to the wave's phase speed. */
const PEEL_SPEED_FACTOR = 1.6;
const PEEL_MIN_SPEED = 6;
/** Distance ahead of the peel over which the shoulder fades to its flattest. */
const SHOULDER_LEN = 45;
/** Where a newly-seen crest starts peeling, relative to the rider. */
const START_BEHIND = 30;
/** Peels further than this many crests from the rider are forgotten. */
const KEEP_CRESTS = 8;

// ---- Shape tuning (fractions of wave-1 amplitude) ----
const LIP_HEIGHT = 0.55;       // thrown lip in the pocket
const LIP_PHASE = 0.35;        // lip sits slightly in front of the crest
const LIP_WIDTH = 0.45;
const SHOULDER_DROP = 0.35;    // crest height lost far out on the shoulder
const BROKEN_DROP = 0.6;       // crest height lost once broken
const CHURN = 0.08;            // whitewater surface noise

export interface WaveCoords {
  along: number;
  s: number;
  psi: number;
  n: number;
  /** Propagation direction (toward the beach). */
  propX: number;
  propY: number;
  /** Tangent (along the crest). */
  tanX: number;
  tanY: number;
}

interface Peel {
  s0: number;
  t0: number;
  /** +1: peels toward +s, −1: toward −s. */
  dir: 1 | -1;
}

// ---- Per-frame constants (set by beginBreakFrame) ----
let k = 0.28;
let omega = 1.7;
let c = 6;
let amplitude = 3.5;
let planar = true;
let dirX = 1;
let dirY = 0;
let curT = 0;
let riderS = 0;

const peels = new Map<number, Peel>();

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

/** Wrap an angle to (−π, π]. */
function wrap(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

function setConstants(p: WaveParams): void {
  k = TAU / Math.max(p.wavelength, 0.01);
  omega = p.speedFactor * Math.sqrt(G * k);
  c = omega / k;
  amplitude = p.amplitude;
  planar = p.wave1Mode === 'planar';
  dirX = Math.cos(p.wave1Direction);
  dirY = Math.sin(p.wave1Direction);
}

/** Write the wave coordinates of (x, y) at time t into `out`. */
export function waveCoordsInto(out: WaveCoords, x: number, y: number, t: number): WaveCoords {
  if (planar) {
    out.along = dirX * x + dirY * y;
    out.s = -dirY * x + dirX * y;
    out.propX = dirX; out.propY = dirY;
  } else {
    const r = Math.sqrt(x * x + y * y);
    out.along = r;
    out.s = r * Math.atan2(y, x);
    out.propX = r > 0.01 ? x / r : 1;
    out.propY = r > 0.01 ? y / r : 0;
  }
  out.tanX = -out.propY;
  out.tanY = out.propX;
  const theta = k * out.along - omega * t;
  out.n = Math.round(theta / TAU);
  out.psi = theta - out.n * TAU;
  return out;
}

export function makeCoords(): WaveCoords {
  return { along: 0, s: 0, psi: 0, n: 0, propX: 1, propY: 0, tanX: 0, tanY: 1 };
}

/** World position of the point at phase psi on crest n, crest-distance s, time t. */
export function worldFromWave(n: number, psi: number, s: number, t: number): { x: number; y: number } {
  const along = (n * TAU + psi + omega * t) / k;
  if (planar) {
    return { x: dirX * along - dirY * s, y: dirY * along + dirX * s };
  }
  const r = Math.max(along, 0.01);
  const ang = s / r;
  return { x: r * Math.cos(ang), y: r * Math.sin(ang) };
}

export function peelSpeed(): number {
  return Math.max(PEEL_MIN_SPEED, c * PEEL_SPEED_FACTOR);
}

/** Phase speed of wave 1 (how fast the crests travel toward the beach). */
export function crestSpeed(): number {
  return c;
}

function peelFor(n: number): Peel {
  let pe = peels.get(n);
  if (!pe) {
    const dir: 1 | -1 = (n & 1) ? 1 : -1;
    pe = { s0: riderS - dir * START_BEHIND, t0: curT, dir };
    peels.set(n, pe);
  }
  return pe;
}

/** Peel direction of crest n (+1 or −1 along s). */
export function peelDir(n: number): 1 | -1 {
  return peelFor(n).dir;
}

/** Crest-distance of the peel point of crest n at time t. */
export function peelS(n: number, t: number): number {
  const pe = peelFor(n);
  return pe.s0 + pe.dir * peelSpeed() * (t - pe.t0);
}

/** Metres behind the peel (positive = broken, negative = still open). */
export function behindPeel(n: number, s: number, t: number): number {
  const pe = peelFor(n);
  return pe.dir * (pe.s0 + pe.dir * peelSpeed() * (t - pe.t0) - s);
}

/**
 * Call once per frame before any sampling. Updates wave constants and
 * forgets peels of crests far from the rider.
 */
export function beginBreakFrame(p: WaveParams, t: number, riderX: number, riderY: number): void {
  setConstants(p);
  curT = t;
  const rc = waveCoordsInto(scratch, riderX, riderY, t);
  riderS = rc.s;
  for (const n of peels.keys()) {
    if (Math.abs(n - rc.n) > KEEP_CRESTS) peels.delete(n);
  }
}

/** Forget every peel (new run). */
export function resetBreakField(): void {
  peels.clear();
}

/** Re-anchor crest n so its peel sits `gap` metres behind crest-distance s. */
export function placePeel(n: number, s: number, gap: number, t: number): void {
  const dir: 1 | -1 = (n & 1) ? 1 : -1;
  peels.set(n, { s0: s - dir * gap, t0: t, dir });
}

const scratch = makeCoords();

/** Phase of the thrown lip (just in front of the crest). */
export const LIP_PSI = LIP_PHASE;

/** 0–1: how steep and thrown the lip is at d metres behind the peel (1 = in the pocket). */
export function lipStrength(d: number): number {
  const shoulderK = clamp(-d / SHOULDER_LEN, 0, 1);
  const brokenK = 1 / (1 + Math.exp(-d / 1.5));
  return (1 - shoulderK) * (1 - brokenK);
}

/** Height added to the base surface by the break, for a point at (psi, d). */
function breakOffset(psi: number, d: number, x: number, y: number, t: number): number {
  const lw = (psi - LIP_PHASE) / LIP_WIDTH;
  const lipWin = Math.exp(-lw * lw);
  const cw = (1 + Math.cos(psi)) * 0.5;
  const crestWin = cw * cw;
  const shoulderK = clamp(-d / SHOULDER_LEN, 0, 1);
  const brokenK = 1 / (1 + Math.exp(-d / 1.5));
  const steep = (1 - shoulderK) * (1 - brokenK);
  let z = LIP_HEIGHT * steep * lipWin
    - SHOULDER_DROP * shoulderK * crestWin
    - BROKEN_DROP * brokenK * crestWin;
  if (brokenK > 0.01) {
    z += CHURN * brokenK * crestWin * Math.sin(1.7 * x + 2.3 * t) * Math.sin(1.3 * y - 1.9 * t);
  }
  return amplitude * z;
}

/** Whitewater / spray amount (0–1) for colouring; streaky so it reads as foam, not snow. */
function foamAmount(psi: number, d: number, x: number, y: number): number {
  const brokenK = 1 / (1 + Math.exp(-d / 1.5));
  const fw = (psi - 0.5) / 1.1;
  const faceFoam = brokenK * Math.exp(-fw * fw);
  const lw = (psi - LIP_PHASE) / LIP_WIDTH;
  const lipSpray = Math.exp(-(d / 2.5) * (d / 2.5)) * Math.exp(-lw * lw) * 0.7;
  const streaks = 0.55 + 0.45 * Math.sin(0.9 * x + 1.3 * y) * Math.sin(1.7 * y - 0.6 * x);
  return clamp(faceFoam * 0.7 * streaks + lipSpray, 0, 1);
}

/** Height of the surfable surface: live ocean + breaking-wave shape. */
export function gameSurfaceZ(x: number, y: number, p: WaveParams, t: number): number {
  const wc = waveCoordsInto(scratch, x, y, t);
  const d = behindPeel(wc.n, wc.s, t);
  return liveSurfaceZ(x, y, p, t) + breakOffset(wc.psi, d, x, y, t);
}

/**
 * Sample the game surface on a res × res grid centred on (cx, cy), snapped to
 * the grid step so vertices don't swim as the rider moves. Writes interleaved
 * positions and a per-vertex foam amount.
 */
export function sampleGameSurface(
  p: WaveParams, t: number, cx: number, cy: number, extent: number, res: number,
  pos: Float32Array, foam: Float32Array,
): void {
  const step = (2 * extent) / (res - 1);
  const ox = Math.round(cx / step) * step - extent;
  const oy = Math.round(cy / step) * step - extent;
  let idx = 0;
  let fi = 0;
  for (let xi = 0; xi < res; xi++) {
    const x = ox + xi * step;
    for (let yi = 0; yi < res; yi++) {
      const y = oy + yi * step;
      const wc = waveCoordsInto(scratch, x, y, t);
      const d = behindPeel(wc.n, wc.s, t);
      pos[idx++] = x;
      pos[idx++] = y;
      pos[idx++] = liveSurfaceZ(x, y, p, t) + breakOffset(wc.psi, d, x, y, t);
      foam[fi++] = foamAmount(wc.psi, d, x, y);
    }
  }
}
