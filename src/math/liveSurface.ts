/**
 * Live (causal) ocean surface — the single source of truth for "what the water
 * looks like right now", shared by the renderer and the SURF game.
 *
 * === Causal epoch model ===
 *
 * Each wave source (wave1, wave2) keeps a timeline of "epochs" — parameter
 * snapshots. Each epoch's wavefront expands from its source at phase velocity c:
 *
 *   - radial source: a ring expanding from (originX, originY)
 *   - planar source: a straight line entering from the up-wave edge of the grid
 *     and sweeping across it along the propagation direction
 *
 * At any point, the newest epoch whose front has reached it determines the
 * wave value. Already-emitted waves keep their original parameters, so a
 * slider change rolls across the ocean instead of snapping the whole plane.
 *
 * The wall (reflective boundary at +X) has its own epoch list; its activation
 * front travels inward from the wall at wave 1's phase velocity.
 */

import { surfaceZ, wave1Z, wave2Z } from './trochoidal';
import type { WaveParams } from '../types';

const G = 9.81;
const MIN_EPOCH_GAP = 0.05; // min simTime seconds between epochs (coalesces rapid slider drags)
const MAX_EPOCHS = 100;      // hard cap per wave source

/**
 * A snapshot of wave parameters active from startTime onward.
 * Points the front has not reached yet see no contribution from this epoch.
 */
type WaveEpoch = {
  startTime: number;
  planar: boolean;
  /** Radial source position. */
  originX: number;
  originY: number;
  /** Planar propagation direction (unit vector). */
  dirX: number;
  dirY: number;
  /** Planar only: distance from the source line (up-wave grid edge) to the world origin. */
  sourceOffset: number;
  amplitude: number;
  k: number;       // 2π / wavelength
  omega: number;   // speedFactor * √(g·k)
  c: number;       // ω / k (phase velocity)
  enabled: boolean; // false = "silence" epoch (wave turning off)
};

/**
 * Wall epoch — tracks wall state changes. The activation front is planar,
 * propagating from x = gridExtent inward at wave1's phase velocity.
 */
type WallEpoch = {
  startTime: number;
  enabled: boolean;
  reflection: number;  // 0–1
  c: number;
  smooth: number;      // transition width (half of wave1's wavelength)
};

// Stored newest-first. Index 0 = most recent epoch.
let wave1Epochs: WaveEpoch[] = [];
let wave2Epochs: WaveEpoch[] = [];
let wallEpochs: WallEpoch[] = [];

// Per-frame flags computed by prepareLiveSurface()
let fastPath = true;
let wave1Steady = true;
let wave2Steady = true;
let wallSteady = true;
let steadyRefl = 0;

const WAVE1_KEYS: (keyof WaveParams)[] = ['amplitude', 'wavelength', 'speedFactor', 'wave1Mode', 'wave1Direction'];
const WAVE2_KEYS: (keyof WaveParams)[] = [
  'wave2Enabled', 'wave2Mode', 'wave2Direction',
  'wave2OriginX', 'wave2OriginY',
  'wave2Amplitude', 'wave2Wavelength', 'wave2SpeedFactor',
];
const WALL_KEYS: (keyof WaveParams)[] = ['wallEnabled', 'wallReflection'];

function changed(keys: (keyof WaveParams)[], a: WaveParams, b: WaveParams): boolean {
  return keys.some(k => a[k] !== b[k]);
}

function makeEpoch(
  startTime: number, p: WaveParams, planar: boolean, direction: number,
  originX: number, originY: number,
  amplitude: number, wavelength: number, speedFactor: number, enabled: boolean,
): WaveEpoch {
  const k = (2 * Math.PI) / Math.max(wavelength, 0.01);
  const omega = speedFactor * Math.sqrt(G * k);
  return {
    startTime, planar,
    originX, originY,
    dirX: Math.cos(direction), dirY: Math.sin(direction),
    // The up-wave grid corner is at most gridExtent·√2 behind the origin
    sourceOffset: p.gridExtent * Math.SQRT2,
    amplitude, k, omega, c: omega / k, enabled,
  };
}

function makeWave1Epoch(startTime: number, p: WaveParams): WaveEpoch {
  return makeEpoch(startTime, p, p.wave1Mode === 'planar', p.wave1Direction,
    0, 0, p.amplitude, p.wavelength, p.speedFactor, true);
}

function makeWave2Epoch(startTime: number, p: WaveParams): WaveEpoch {
  return makeEpoch(startTime, p, p.wave2Mode === 'planar', p.wave2Direction,
    p.wave2OriginX, p.wave2OriginY,
    p.wave2Amplitude, p.wave2Wavelength, p.wave2SpeedFactor, p.wave2Enabled);
}

function makeWallEpoch(startTime: number, p: WaveParams): WallEpoch {
  const k1 = (2 * Math.PI) / Math.max(p.wavelength, 0.01);
  const omega1 = p.speedFactor * Math.sqrt(G * k1);
  return {
    startTime, enabled: p.wallEnabled, reflection: p.wallReflection,
    c: omega1 / k1, smooth: p.wavelength * 0.5,
  };
}

/** Push a new epoch, coalescing if the previous one is too recent. */
function pushEpoch<T extends { startTime: number }>(epochs: T[], epoch: T): void {
  if (epochs.length > 0 && epoch.startTime - epochs[0].startTime < MIN_EPOCH_GAP) {
    epochs[0] = epoch; // update in place — too soon for a new front
    return;
  }
  epochs.unshift(epoch);
  if (epochs.length > MAX_EPOCHS) epochs.length = MAX_EPOCHS;
}

/** Farthest distance (in the epoch's own front metric) of any grid point. */
function maxReach(e: WaveEpoch, gridExtent: number): number {
  if (e.planar) return e.sourceOffset + gridExtent * Math.SQRT2;
  const fx = Math.abs(e.originX) + gridExtent;
  const fy = Math.abs(e.originY) + gridExtent;
  return Math.sqrt(fx * fx + fy * fy);
}

function covers(e: WaveEpoch, t: number, gridExtent: number): boolean {
  const smooth = Math.PI / e.k;
  return e.c * (t - e.startTime) > maxReach(e, gridExtent) + smooth * 3;
}

/** Drop epochs that a newer epoch fully covers (no grid point falls through to them). */
function pruneEpochs(epochs: WaveEpoch[], t: number, gridExtent: number): void {
  for (let i = 1; i < epochs.length; i++) {
    if (covers(epochs[i - 1], t, gridExtent)) {
      epochs.length = i;
      break;
    }
  }
}

function pruneWallEpochs(t: number, gridExtent: number): void {
  for (let i = 1; i < wallEpochs.length; i++) {
    const newer = wallEpochs[i - 1];
    if (newer.c * (t - newer.startTime) > 2 * gridExtent + newer.smooth * 3) {
      wallEpochs.length = i;
      break;
    }
  }
}

/** Sigmoid: 0 outside wavefront, 1 inside, smooth transition over smoothDist. */
function causalAlpha(frontDist: number, pointDist: number, smoothDist: number): number {
  const progress = (frontDist - pointDist) / smoothDist;
  return 1 / (1 + Math.exp(-progress * 4));
}

/**
 * Causal wave contribution at (x, y) from an epoch list. Iterates newest-first;
 * the first epoch whose front firmly covers the point claims it. At a front
 * edge, blends with whatever is behind (older epochs, or calm water).
 */
function computeCausalWave(x: number, y: number, t: number, epochs: WaveEpoch[], fromIndex: number): number {
  for (let i = fromIndex; i < epochs.length; i++) {
    const e = epochs[i];
    let phaseDist: number; // distance used in the cosine
    let frontMetric: number; // distance from the source, compared against the front
    if (e.planar) {
      phaseDist = e.dirX * x + e.dirY * y;
      frontMetric = phaseDist + e.sourceOffset;
    } else {
      const dx = x - e.originX;
      const dy = y - e.originY;
      phaseDist = Math.sqrt(dx * dx + dy * dy);
      frontMetric = phaseDist;
    }
    const front = e.c * (t - e.startTime);
    const smooth = Math.PI / e.k; // half wavelength

    if (frontMetric > front + smooth) continue; // not reached yet

    // Cycle t before cos() to prevent float overflow
    const period = (2 * Math.PI) / Math.max(e.omega, 0.001);
    const tCycled = t % period;
    const eZ = e.enabled ? e.amplitude * Math.cos(e.k * phaseDist - e.omega * tCycled) : 0;

    if (frontMetric <= front - smooth) return eZ;

    const alpha = causalAlpha(front, frontMetric, smooth);
    const behind = computeCausalWave(x, y, t, epochs, i + 1);
    return alpha * eZ + (1 - alpha) * behind;
  }
  return 0;
}

function computeWallReflection(wallDist: number, t: number, fromIndex: number): number {
  for (let i = fromIndex; i < wallEpochs.length; i++) {
    const e = wallEpochs[i];
    const frontDist = e.c * (t - e.startTime);
    if (wallDist > frontDist + e.smooth) continue;
    const eRefl = e.enabled ? e.reflection : 0;
    if (wallDist <= frontDist - e.smooth) return eRefl;
    const alpha = causalAlpha(frontDist, wallDist, e.smooth);
    const behind = computeWallReflection(wallDist, t, i + 1);
    return alpha * eRefl + (1 - alpha) * behind;
  }
  return 0;
}

// ============================================================================
// Public API
// ============================================================================

/** Start from a settled ocean: one epoch per source, emitted long ago. */
export function resetLiveSurface(p: WaveParams): void {
  wave1Epochs = [makeWave1Epoch(-1e6, p)];
  wave2Epochs = p.wave2Enabled ? [makeWave2Epoch(-1e6, p)] : [];
  wallEpochs = p.wallEnabled ? [makeWallEpoch(-1e6, p)] : [];
}

/** Emit new wavefronts for whichever sources changed between prev and next. */
export function onParamsChanged(prev: WaveParams, next: WaveParams, t: number): void {
  if (changed(WAVE1_KEYS, prev, next)) pushEpoch(wave1Epochs, makeWave1Epoch(t, next));
  if (changed(WAVE2_KEYS, prev, next)) pushEpoch(wave2Epochs, makeWave2Epoch(t, next));
  if (changed(WALL_KEYS, prev, next)) pushEpoch(wallEpochs, makeWallEpoch(t, next));
}

/**
 * Prune superseded epochs and compute the steady-state flags. Call once per
 * frame before sampling. When everything is steady, liveSurfaceZ() falls back
 * to the analytical surfaceZ() (fast path).
 */
export function prepareLiveSurface(p: WaveParams, t: number): void {
  pruneEpochs(wave1Epochs, t, p.gridExtent);
  pruneEpochs(wave2Epochs, t, p.gridExtent);
  pruneWallEpochs(t, p.gridExtent);

  wave1Steady = wave1Epochs.length === 0 || (wave1Epochs.length === 1 && covers(wave1Epochs[0], t, p.gridExtent));
  wave2Steady = wave2Epochs.length === 0 || (wave2Epochs.length === 1 && covers(wave2Epochs[0], t, p.gridExtent));

  if (wallEpochs.length === 0) {
    wallSteady = true;
  } else if (wallEpochs.length > 1) {
    wallSteady = false;
  } else {
    const e = wallEpochs[0];
    wallSteady = e.c * (t - e.startTime) > 2 * p.gridExtent + e.smooth * 3;
  }
  const wallActive = wallEpochs.length > 0 && wallEpochs[0].enabled && wallEpochs[0].reflection > 0;
  steadyRefl = wallSteady ? (wallActive ? wallEpochs[0].reflection : 0) : -1;
  fastPath = wave1Steady && wave2Steady && wallSteady && !wallActive;
}

/** True while any wavefront is still travelling across the grid. */
export function isPropagating(): boolean {
  return !(wave1Steady && wave2Steady && wallSteady);
}

/** Height of the live surface at (x, y, t). Call prepareLiveSurface() first each frame. */
export function liveSurfaceZ(x: number, y: number, p: WaveParams, t: number): number {
  if (fastPath) return surfaceZ(x, y, p, t);

  let z = sourcesZ(x, y, p, t);

  // Wall reflection: mirror source across x = gridExtent
  const wallX = p.gridExtent;
  const refl = steadyRefl >= 0 ? steadyRefl : computeWallReflection(wallX - x, t, 0);
  if (refl > 0) z += refl * sourcesZ(2 * wallX - x, y, p, t);
  return z;
}

function sourcesZ(x: number, y: number, p: WaveParams, t: number): number {
  const z1 = wave1Steady ? wave1Z(x, y, p, t) : computeCausalWave(x, y, t, wave1Epochs, 0);
  const z2 = wave2Steady ? wave2Z(x, y, p, t) : computeCausalWave(x, y, t, wave2Epochs, 0);
  return z1 + z2;
}

/** Per-point Z override for sampleSurface, or undefined on the fast path. */
export function liveZOverride(p: WaveParams, t: number): ((x: number, y: number) => number) | undefined {
  if (fastPath) return undefined;
  return (x: number, y: number) => liveSurfaceZ(x, y, p, t);
}
