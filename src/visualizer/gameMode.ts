/**
 * Arcade SURF mode — 60-second time-attack score chase on a breaking wave.
 *
 * The ocean here is endless (the mesh follows the rider) and every crest
 * peels: a break point runs along it and chases you down the line
 * (see game/breakField.ts). The core loop is: stay in the pocket just ahead
 * of the curl for speed and tube time, hit the lip for airs, cut back when
 * you outrun it, and don't get eaten.
 *
 * State machine:
 *   RIDING    → AIRBORNE: launched over the lip by momentum, or Space pop
 *   AIRBORNE  → RIDING:   landing with good board-vs-travel alignment
 *   AIRBORNE  → WIPEOUT:  bad landing
 *   RIDING    → WIPEOUT:  eaten by the whitewater, or nose-dive
 *   RIDING    → PADDLING: fell off the back of the wave
 *   PADDLING  → RIDING:   catch a face (W toward the beach), or auto drop-in
 *   WIPEOUT   → RIDING:   drop-in onto the next wave
 *
 * Controls:
 *   A / D     : carve on water, spin in air, steer while paddling
 *   W / S     : paddle (paddling) / stall (riding) / flip (air)
 *   Shift     : pump — hold while going downhill to build speed
 *   Space     : pop (bigger near the lip); HOLD in air to grab
 *   R         : drop in on the next wave
 *   Esc       : exit game mode
 */

import * as THREE from 'three';
import { getCamera, getControls, getScene, setTheme, update as updateMesh, setSunsetAnchor } from './renderer3d';
import { createBoardMesh, setBoardPose, disposeBoardMesh, type BoardSprite } from '../game/board';
import {
  createScoreState, startRun, endRun, tickRunTimer, addPoints, bumpCombo,
  breakCombo, decayCombo, recordTrick, multiplier,
  createPopupState, spawnPopup, updatePopups, clearPopups,
  SCORE_RATES,
  type ScoreState, type PopupState,
} from '../game/score';
import { createGates, updateGates, clearGates, type GatesState, type GateKind } from '../game/gates';
import {
  beginBreakFrame, resetBreakField, gameSurfaceZ, sampleGameSurface,
  waveCoordsInto, makeCoords, worldFromWave, behindPeel, peelDir, peelS, peelSpeed, crestSpeed,
  lipStrength, LIP_PSI,
  type WaveCoords,
} from '../game/breakField';
import { sfx } from '../game/audio';
import { getHighScore, submitScore } from '../game/highscore';
import type { WaveParams } from '../types';

// ============================================================================
// Constants
// ============================================================================

const G = 9.81;

// ---- Endless ocean view ----
const GAME_RES = 150;
const GAME_EXTENT = 60;

// ---- Board dynamics ----
const BASE_TURN_RATE = 2.4;          // rad/s base, scales with speed
const SPEED_TURN_BONUS = 0.07;       // extra rad/s per (m/s)
const MAX_SPEED = 30;

// ---- Speed sources ----
const SLOPE_GRAVITY = 0.8;           // fraction of g along the slope
const TRIM_ACCEL = 1.2;              // 1/s — how fast the wave pulls you toward trim speed
const TRIM_SHOULDER = 0.5;           // trim speed far from the curl (× peel speed)
const TRIM_POCKET = 1.45;            // trim speed in the pocket (× peel speed)
const POCKET_REACH = 18;             // metres ahead of the peel the pocket energy reaches
const TRIM_HIGH_PSI = 1.1;           // full trim above this point on the face…
const TRIM_LOW_PSI = 2.0;            // …none below this one

// ---- Drag ----
const DRAG_FACE  = 0.010;
const DRAG_FLAT  = 0.030;
const DRAG_BRAKE = 0.25;
const DRAG_FOAM  = 0.12;
const DRAG_BOTTOM = 0.05;

// ---- Pump (Shift key) ----
const PUMP_BUILD = 5.0;
const PUMP_DRAIN = 2.5;
const PUMP_POWER = 10.0;

// ---- Paddling ----
const PADDLE_ACCEL = 6.0;
const PADDLE_MAX_SPEED = 6.0;
const PADDLE_DRAG = 0.4;
const PADDLE_TURN_RATE = 3.2;
const AUTO_DROP_IN_S = 2.2;          // lost the wave → dropped onto the next one
const DROP_IN_AHEAD = 14;            // metres ahead of the curl a drop-in lands you

// ---- Lost the wave ----
const LOST_TIME = 1.0;

// ---- Air ----
const LAUNCH_MIN_VZ = 2.2;           // vertical speed needed to fly off the lip
const LAUNCH_G = 2.2;                // surface must fall away faster than this × g (extreme speeds only)
const LIP_LAUNCH_MIN_VZ = 1.0;       // rising at least this fast when crossing the lip line…
const LIP_LAUNCH_MIN_K = 0.25;       // …on a lip at least this steep = you fly
const LIP_PROJECT = 0.45;            // fraction of board speed converted to lift off the lip
const POP_VZ = 2.8;                  // Space pop on flat water
const LIP_POP_VZ = 5.5;              // extra pop when timed at the lip
const AIR_RETURN = 2.5;              // 1/s — air-assist pulling you back over the face
const AIR_RETURN_BIAS = 1.0;         // m/s shoreward of the wave, so you come down on the face
const MAX_LAUNCH_VZ = 9;
const AIR_YAW_RATE = 7.0;
const AIR_PITCH_RATE = 6.5;
const LANDING_CLEAN = 0.6;
const LANDING_WIPEOUT = 0.35;

// ---- Carving tricks ----
const SNAP_ANGLE = 2.0;              // rad of continuous carve to score a snap/cutback
const SNAP_LIP_PSI = 0.65;           // within this phase of the crest = off the lip
const CUTBACK_SHOULDER_D = -12;      // this far ahead of the curl = cutback territory

// ---- Whitewater / tube ----
const FOAM_D = 1.5;                  // metres behind the peel = whitewater
const EATEN_TIME = 0.35;
const TUBE_D_MIN = -6;
const TUBE_D_MAX = 0.8;
const TUBE_EXIT_GRACE = 0.4;

// ---- Wipeout ----
const WIPEOUT_DURATION = 1.4;
const NOSEDIVE_SLOPE = 1.8;

// ---- Camera ----
const CAM_DISTANCE = 9;
const CAM_HEIGHT = 2.2;              // low, so the face and lip tower over the rider
const CAM_SIDE = 4.5;                // offset toward the beach so the face is in frame
const CAM_LOOK_UP = 1.8;             // aim above the rider, toward the lip
const CAM_SMOOTH = 4.0;
const CAM_YAW_SMOOTH = 3.0;
const CAM_LOOK_SMOOTH = 7.0;
const CAM_LOOK_AHEAD = 6;
const FOV_MIN = 60;
const FOV_MAX = 86;
const CAM_WIPEOUT_DIST = 15;
const CAM_WIPEOUT_HEIGHT = 8;
const CAM_MIN_Z_OFFSET = 2.0;

// ---- Particles ----
const MAX_PARTICLES = 480;
const PARTICLE_SIZE = 0.25;

const TAU = Math.PI * 2;

const GATE_POINTS: Record<GateKind, number> = { LOW: 400, MID: 400, HIGH: 600, AIR: 1000 };
const GATE_COLORS: Record<GateKind, string> = { LOW: '#00FFCC', MID: '#00FFCC', HIGH: '#FFB800', AIR: '#FF6EB4' };

// ============================================================================
// Types
// ============================================================================

type SurfState = 'PADDLING' | 'RIDING' | 'AIRBORNE' | 'WIPEOUT';

type WaveFrame = {
  /** Surface gradient component along board heading (downhill is negative). */
  slopeAlong: number;
  /** "Face quality": 1 = steep front face, 0 = back/flat. */
  face_q: number;
  z: number;
  /** Metres behind the peel of this crest (positive = broken). */
  d: number;
  /** Peel direction of this crest (+1/−1 along the crest). */
  peel: number;
  wc: WaveCoords;
};

// ============================================================================
// Module state
// ============================================================================

let active = false;
let surfState: SurfState = 'PADDLING';
let stateTimer = 0;
let lostTimer = 0;
let foamTimer = 0;

let posX = 0, posY = 0, posZ = 0;
let boardYaw = 0;
let leanAngle = 0;
let edgeEngagement = 0;
let speed = 0;
let vzRide = 0;              // vertical velocity while attached to the surface
let prevPsi = 0;             // phase last frame, to detect crossing the lip line

let velX = 0, velY = 0, velZ = 0;

// Air rotation tracking
let airYaw = 0;
let airPitch = 0;
let lastSpinMilestone = 0;
let lastFlipMilestone = 0;
let grabHeld = false;
let airStartZ = 0;
let airPeakZ = 0;

// Carve tracking (snaps & cutbacks)
let carveAccum = 0;

let pumpEnergy = 0;
let pumpTimingGood = false;

let wipeoutTimer = 0;

let inTube = false;
let tubeTimer = 0;
let tubeGrace = 0;           // brief dips out of the tube zone don't end the tube

// Score & meta
let scoreState: ScoreState;
let popupState: PopupState;
let gatesState: GatesState;
let waveSnapshot: WaveParams | null = null;

// Camera
const camPos = new THREE.Vector3();
const camLookAt = new THREE.Vector3();
let camYaw = 0;
let currentFOV = FOV_MIN;
let shakeIntensity = 0;
let shakeTimer = 0;
let timeStretch = 1;
let timeStretchTimer = 0;
let hitStopTimer = 0;

let savedCamPos: THREE.Vector3 | null = null;
let savedCamTarget: THREE.Vector3 | null = null;

let liveParams: WaveParams | null = null;
let liveSimTime = 0;

const keys = { left: false, right: false, up: false, down: false, shift: false, space: false };
let jumpPressed = false;
let dropInRequested = false;

let boardMesh: BoardSprite | null = null;

// Endless-ocean sampling buffers
const gamePos = new Float32Array(GAME_RES * GAME_RES * 3);
const gameFoam = new Float32Array(GAME_RES * GAME_RES);

// Particles
const particlePos = new Float32Array(MAX_PARTICLES * 3);
const particleVel = new Float32Array(MAX_PARTICLES * 3);
const particleAge = new Float32Array(MAX_PARTICLES);
const particleMaxAge = new Float32Array(MAX_PARTICLES);
const particleColor = new Float32Array(MAX_PARTICLES * 3);
let nextParticleIdx = 0;
let particleGeom: THREE.BufferGeometry | null = null;
let particlePoints: THREE.Points | null = null;
let particlePosAttr: THREE.BufferAttribute | null = null;
let particleColorAttr: THREE.BufferAttribute | null = null;

let speedLinesSprite: THREE.Sprite | null = null;

const riderCoords = makeCoords();
const tmpCoords = makeCoords();

// ============================================================================
// Helpers
// ============================================================================

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

function surfZ(x: number, y: number): number {
  return gameSurfaceZ(x, y, liveParams!, liveSimTime);
}

/**
 * How strongly the wave carries the rider toward the beach at phase psi:
 * fully on the face, fading over the crest onto the back and down into the
 * trough ahead.
 */
function carryFactor(psi: number): number {
  return smoothstep(-0.9, -0.2, psi) * (1 - smoothstep(1.7, 2.6, psi));
}

/** Velocity the wave lends the rider at the current position (world XY). */
function carryVelocity(wf: WaveFrame): { x: number; y: number } {
  const cv = crestSpeed() * (liveParams?.timeScale ?? 1) * carryFactor(wf.wc.psi);
  return { x: wf.wc.propX * cv, y: wf.wc.propY * cv };
}

// ============================================================================
// Wave frame
// ============================================================================

function computeWaveFrame(px: number, py: number, params: WaveParams, t: number, headingYaw: number): WaveFrame {
  const eps = 0.4;
  const z   = gameSurfaceZ(px,       py,       params, t);
  const zPx = gameSurfaceZ(px + eps, py,       params, t);
  const zPy = gameSurfaceZ(px,       py + eps, params, t);
  const dzdx = (zPx - z) / eps;
  const dzdy = (zPy - z) / eps;

  const wc = waveCoordsInto(riderCoords, px, py, t);
  const slopeAlong = dzdx * Math.cos(headingYaw) + dzdy * Math.sin(headingYaw);

  // Front face slopes down toward the beach (+prop)
  const maxSlope = Math.max(params.amplitude * (TAU / Math.max(params.wavelength, 0.01)), 0.01);
  const face_q = clamp(-(dzdx * wc.propX + dzdy * wc.propY) / maxSlope, 0, 1);

  const d = behindPeel(wc.n, wc.s, t);
  return { slopeAlong, face_q, z, d, peel: peelDir(wc.n), wc };
}

// ============================================================================
// Particles
// ============================================================================

function initParticles(): void {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particlePos[i * 3 + 2] = -999;
    particleAge[i] = 999;
    particleMaxAge[i] = 1;
    particleColor[i * 3] = 1;
    particleColor[i * 3 + 1] = 1;
    particleColor[i * 3 + 2] = 1;
  }
  particleGeom = new THREE.BufferGeometry();
  particlePosAttr = new THREE.BufferAttribute(particlePos, 3);
  particlePosAttr.setUsage(THREE.DynamicDrawUsage);
  particleColorAttr = new THREE.BufferAttribute(particleColor, 3);
  particleColorAttr.setUsage(THREE.DynamicDrawUsage);
  particleGeom.setAttribute('position', particlePosAttr);
  particleGeom.setAttribute('color', particleColorAttr);
  const mat = new THREE.PointsMaterial({
    size: PARTICLE_SIZE, transparent: true, opacity: 0.85, map: makeDotTexture(),
    sizeAttenuation: true, depthWrite: false, vertexColors: true,
  });
  particlePoints = new THREE.Points(particleGeom, mat);
  particlePoints.renderOrder = 20;
  particlePoints.frustumCulled = false;
  getScene().add(particlePoints);
}

/** Soft round dot so spray reads as droplets, not squares. */
function makeDotTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function spawnParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number,
  maxAge: number, r: number, g: number, b: number): void {
  const i = nextParticleIdx;
  nextParticleIdx = (nextParticleIdx + 1) % MAX_PARTICLES;
  particlePos[i * 3] = x; particlePos[i * 3 + 1] = y; particlePos[i * 3 + 2] = z;
  particleVel[i * 3] = vx; particleVel[i * 3 + 1] = vy; particleVel[i * 3 + 2] = vz;
  particleAge[i] = 0; particleMaxAge[i] = maxAge;
  particleColor[i * 3] = r; particleColor[i * 3 + 1] = g; particleColor[i * 3 + 2] = b;
}

function updateParticles(dt: number): void {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particleAge[i] += dt;
    if (particleAge[i] >= particleMaxAge[i]) { particlePos[i * 3 + 2] = -999; continue; }
    particlePos[i * 3]     += particleVel[i * 3] * dt;
    particlePos[i * 3 + 1] += particleVel[i * 3 + 1] * dt;
    particlePos[i * 3 + 2] += particleVel[i * 3 + 2] * dt;
    particleVel[i * 3 + 2] -= G * 0.6 * dt;
  }
  if (particlePosAttr) particlePosAttr.needsUpdate = true;
  if (particleColorAttr) particleColorAttr.needsUpdate = true;
}

/** Rail spray thrown sideways off the board, stronger when carving hard. */
function spawnRailSpray(count: number): void {
  const side = leanAngle >= 0 ? -1 : 1;  // spray flies to the outside of the turn
  const hx = Math.cos(boardYaw), hy = Math.sin(boardYaw);
  const sx = -hy * side, sy = hx * side;
  const power = 2 + Math.abs(speed) * 0.25;
  for (let i = 0; i < count; i++) {
    spawnParticle(
      posX - hx * 0.8 + (Math.random() - 0.5) * 0.4,
      posY - hy * 0.8 + (Math.random() - 0.5) * 0.4,
      posZ + 0.1,
      sx * power * (0.6 + Math.random()) + hx * speed * 0.3,
      sy * power * (0.6 + Math.random()) + hy * speed * 0.3,
      1.5 + Math.random() * 2.5 * (0.5 + edgeEngagement),
      0.4 + Math.random() * 0.5,
      1, 1, 1,
    );
  }
}

function spawnBurst(count: number, intensity: number, r: number, g: number, b: number): void {
  for (let j = 0; j < count; j++) {
    const ang = Math.random() * Math.PI * 2;
    const radius = Math.random() * 1.5;
    spawnParticle(
      posX + Math.cos(ang) * radius, posY + Math.sin(ang) * radius, posZ + 0.3,
      Math.cos(ang) * (3 + Math.random() * 4) * intensity,
      Math.sin(ang) * (3 + Math.random() * 4) * intensity,
      (2 + Math.random() * 4) * intensity,
      0.5 + Math.random() * 1.0,
      r, g, b,
    );
  }
}

/** Spray thrown off the lip where the wave is breaking — marks the curl. */
function spawnLipSpray(n: number, t: number, dt: number): void {
  const sp = peelS(n, t);
  const dir = peelDir(n);
  const count = Math.min(6, Math.round(dt * 160));
  for (let i = 0; i < count; i++) {
    const s = sp - dir * Math.random() * 4;
    const { x, y } = worldFromWave(n, 0.35 + Math.random() * 0.2, s, t);
    const z = surfZ(x, y) + 0.3;
    const wc = waveCoordsInto(tmpCoords, x, y, t);
    spawnParticle(
      x, y, z,
      wc.propX * (3 + Math.random() * 4) + wc.tanX * dir * Math.random() * 3,
      wc.propY * (3 + Math.random() * 4) + wc.tanY * dir * Math.random() * 3,
      3 + Math.random() * 5,
      0.6 + Math.random() * 0.6,
      1, 0.97, 0.9,
    );
  }
}

// ============================================================================
// Speed lines
// ============================================================================

function makeSpeedLinesSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 64; i++) {
    const ang = (i / 64) * Math.PI * 2 + (Math.random() - 0.5) * 0.05;
    const r0 = 80 + Math.random() * 20;
    const r1 = 120 + Math.random() * 14;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(ang) * r0, 128 + Math.sin(ang) * r0);
    ctx.lineTo(128 + Math.cos(ang) * r1, 128 + Math.sin(ang) * r1);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(20, 20, 1);
  sprite.renderOrder = 60;
  return sprite;
}

// ============================================================================
// Drop-in: place the rider on a fresh wave just ahead of the curl
// ============================================================================

function dropIn(t: number): void {
  const wc = waveCoordsInto(tmpCoords, posX, posY, t);
  // Crest at or behind the rider is the one arriving; a crest already past is gone.
  const n = wc.psi >= 0 ? wc.n : wc.n - 1;
  const dir = peelDir(n);
  const curl = peelS(n, t);
  // Keep the rider's spot along the crest if it is a sane distance ahead of the curl
  const ahead = dir * (wc.s - curl);
  const s = ahead > DROP_IN_AHEAD - 4 && ahead < DROP_IN_AHEAD + 6 ? wc.s : curl + dir * DROP_IN_AHEAD;

  const p = worldFromWave(n, 0.7, s, t);
  posX = p.x; posY = p.y;
  posZ = surfZ(posX, posY);

  const fc = waveCoordsInto(tmpCoords, posX, posY, t);
  // Down the line, angled slightly down the face
  const hx = fc.tanX * dir * Math.cos(0.25) + fc.propX * Math.sin(0.25);
  const hy = fc.tanY * dir * Math.cos(0.25) + fc.propY * Math.sin(0.25);
  boardYaw = Math.atan2(hy, hx);
  speed = peelSpeed();
  vzRide = 0;
  velX = 0; velY = 0; velZ = 0;
  leanAngle = 0; edgeEngagement = 0; carveAccum = 0;
  pumpEnergy = 0; airYaw = 0; airPitch = 0;
  inTube = false; tubeTimer = 0;
  jumpPressed = false; grabHeld = false;
  enterState('RIDING');
  snapCamera();
  spawnPopup(popupState, posX, posY, posZ + 2, dir > 0 ? 'DROP IN →' : '← DROP IN', '#FFFFFF');
  sfx.whoosh();
}

// ============================================================================
// Physics: PADDLING
// ============================================================================

function updatePaddling(wf: WaveFrame, dt: number): void {
  if (keys.left) boardYaw += PADDLE_TURN_RATE * dt;
  if (keys.right) boardYaw -= PADDLE_TURN_RATE * dt;
  if (keys.up) speed = Math.min(PADDLE_MAX_SPEED, speed + PADDLE_ACCEL * dt);
  if (keys.down) speed -= PADDLE_ACCEL * 0.5 * dt;
  speed -= PADDLE_DRAG * speed * Math.abs(speed) * dt;
  speed = clamp(speed, -2, PADDLE_MAX_SPEED);

  const hx = Math.cos(boardYaw), hy = Math.sin(boardYaw);
  posX += hx * speed * dt;
  posY += hy * speed * dt;
  posZ = lerp(posZ, surfZ(posX, posY), Math.min(20 * dt, 1));

  leanAngle *= 0.9;
  edgeEngagement *= 0.9;

  // Catch: paddling toward the beach on an open face
  const towardBeach = hx * wf.wc.propX + hy * wf.wc.propY;
  const open = wf.d < -FOAM_D;
  if (keys.up && open && wf.face_q > 0.3 && wf.wc.psi > 0.2 && wf.wc.psi < 1.6 && towardBeach > 0.2) {
    speed = Math.max(speed, peelSpeed() * 0.9);
    enterState('RIDING');
    sfx.whoosh();
    spawnPopup(popupState, posX, posY, posZ + 2, 'CAUGHT IT!', '#00FFCC');
    return;
  }

  if (stateTimer > AUTO_DROP_IN_S) dropIn(liveSimTime);
}

// ============================================================================
// Physics: RIDING
// ============================================================================

function updateRiding(wf: WaveFrame, dt: number): void {
  // ---- Carving ----
  const turnRate = BASE_TURN_RATE + Math.abs(speed) * SPEED_TURN_BONUS;
  const leanTarget = keys.left ? 1.0 : keys.right ? -1.0 : 0.0;
  leanAngle += (leanTarget - leanAngle) * 12 * dt;
  if (Math.abs(leanAngle) > 0.15) edgeEngagement = Math.min(1, edgeEngagement + 7 * dt);
  else edgeEngagement = Math.max(0, edgeEngagement - 4 * dt);
  const yawDelta = leanAngle * edgeEngagement * turnRate * dt;
  boardYaw += yawDelta;

  // ---- Speed ----
  const slope = wf.slopeAlong;
  speed += -G * SLOPE_GRAVITY * slope / Math.sqrt(1 + slope * slope) * dt;

  // The wave pulls you toward a trim speed: fast in the pocket, slow on the
  // shoulder, and only high on the face — sink to the bottom and you bog down.
  const faceK = clamp(wf.face_q * 2, 0, 1) * (1 - smoothstep(TRIM_HIGH_PSI, TRIM_LOW_PSI, wf.wc.psi));
  const pocketK = wf.d > 0 ? Math.exp(-wf.d / 2) : Math.exp(-((wf.d / POCKET_REACH) ** 2));
  const trim = peelSpeed() * lerp(TRIM_SHOULDER, TRIM_POCKET, pocketK) * faceK;
  if (speed < trim) speed += (trim - speed) * TRIM_ACCEL * dt;

  // Pump: build energy while going downhill, bleed it going uphill
  const downhill = slope < -0.05;
  pumpTimingGood = keys.shift && downhill;
  if (pumpTimingGood) pumpEnergy = Math.min(1, pumpEnergy + PUMP_BUILD * dt);
  else if (keys.shift) pumpEnergy = Math.max(0, pumpEnergy - PUMP_DRAIN * dt);
  else pumpEnergy = Math.max(0, pumpEnergy - 0.5 * dt);
  speed += pumpEnergy * PUMP_POWER * Math.max(wf.face_q, 0.1) * dt;
  if (pumpTimingGood && Math.random() < dt * 8) sfx.pump();

  // Drag
  const inFoam = wf.d > FOAM_D && wf.wc.psi > -0.6 && wf.wc.psi < 2.2;
  let drag = lerp(DRAG_FLAT, DRAG_FACE, wf.face_q * faceK);
  if (wf.wc.psi > TRIM_LOW_PSI - 0.2) drag = Math.max(drag, DRAG_BOTTOM);   // bogging in the flats
  if (keys.down) drag = DRAG_BRAKE;
  if (inFoam) drag = Math.max(drag, DRAG_FOAM);
  speed -= drag * speed * Math.abs(speed) * dt;
  speed = clamp(speed, 0, MAX_SPEED);

  // ---- Move: own speed along heading + the wave's carry ----
  const hx = Math.cos(boardYaw), hy = Math.sin(boardYaw);
  const carry = carryVelocity(wf);
  posX += (hx * speed + carry.x) * dt;
  posY += (hy * speed + carry.y) * dt;

  // ---- Vertical: stay glued unless the surface falls away faster than gravity ----
  const zNew = surfZ(posX, posY);
  if (dt > 1e-4) {
    const vzNew = (zNew - posZ) / dt;
    const dropAway = (vzRide - vzNew) / dt;   // downward accel needed to stay glued
    if (vzRide > LAUNCH_MIN_VZ && dropAway > G * LAUNCH_G) {
      launch(vzRide, wf, false);
      return;
    }
    // Arcade lip launch: climbing through the lip line projects you off it
    const lipK = lipStrength(wf.d);
    if (prevPsi > LIP_PSI && wf.wc.psi <= LIP_PSI && vzRide > LIP_LAUNCH_MIN_VZ && lipK > LIP_LAUNCH_MIN_K) {
      launch(vzRide + speed * LIP_PROJECT * lipK + 1.5, wf, lipK > 0.6);
      spawnPopup(popupState, posX, posY, posZ + 1.5, lipK > 0.6 ? 'OFF THE LIP!' : 'AIR!', '#FFCC00');
      return;
    }
    vzRide = lerp(vzRide, vzNew, 0.5);
  }
  prevPsi = wf.wc.psi;
  posZ = zNew;

  // ---- Wipeouts ----
  if (inFoam) {
    foamTimer += dt;
    if (foamTimer > EATEN_TIME) { triggerWipeout('EATEN!'); return; }
  } else {
    foamTimer = 0;
  }
  if (-slope > NOSEDIVE_SLOPE && speed > 20) { triggerWipeout('NOSEDIVE'); return; }

  // ---- Scoring: face time ----
  if (wf.face_q > 0.4 && speed > 4) addPoints(scoreState, SCORE_RATES.faceRidePerS * dt);

  // ---- Tube: in the pocket, under the lip, keeping pace with the curl ----
  const vLine = (hx * speed) * wf.wc.tanX * wf.peel + (hy * speed) * wf.wc.tanY * wf.peel;
  const tubeQ = wf.d > TUBE_D_MIN && wf.d < TUBE_D_MAX
    && wf.wc.psi > 0.2 && wf.wc.psi < 1.3
    && vLine > peelSpeed() * 0.7;
  if (tubeQ) {
    tubeGrace = TUBE_EXIT_GRACE;
    if (!inTube) {
      inTube = true;
      tubeTimer = 0;
      sfx.tubeIn();
      shake(0.15, 0.2);
    }
    tubeTimer += dt;
    addPoints(scoreState, SCORE_RATES.tubeRidePerS * dt);
    scoreState.tubeTimeS += dt;
  } else if (inTube) {
    tubeGrace -= dt;
    if (tubeGrace <= 0) exitTube();
    else tubeTimer += dt;
  }

  // ---- Carving tricks: snap off the lip, cutback on the shoulder ----
  if (Math.abs(leanAngle) > 0.5 && Math.sign(yawDelta) === Math.sign(carveAccum || yawDelta)) {
    carveAccum += yawDelta;
  } else {
    carveAccum = 0;
  }
  if (Math.abs(carveAccum) > SNAP_ANGLE && speed > 6) {
    if (wf.wc.psi < SNAP_LIP_PSI) awardTrick('SNAP!', 350, '#FFB800');
    else if (wf.d < CUTBACK_SHOULDER_D) awardTrick('CUTBACK!', 300, '#88FFEE');
    carveAccum = 0;
  }

  // ---- Pop (Space): bigger when timed climbing into the lip ----
  if (jumpPressed) {
    jumpPressed = false;
    const lipK = clamp(1 - Math.abs(wf.wc.psi - 0.3) / 0.7, 0, 1) * (vzRide > 1 ? 1 : 0.4);
    launch(Math.max(vzRide, 0) + POP_VZ + lipK * (LIP_POP_VZ + speed * 0.12), wf, lipK > 0.5);
    return;
  }

  // ---- Lost the wave: off the back or out in the flats ----
  if (carryFactor(wf.wc.psi) < 0.15 && wf.face_q < 0.1) {
    lostTimer += dt;
    if (lostTimer > LOST_TIME) {
      spawnPopup(popupState, posX, posY, posZ + 2, 'LOST IT', '#C8C8E8');
      scoreState.comboLevel = Math.max(0, scoreState.comboLevel - 2);
      enterState('PADDLING');
      return;
    }
  } else {
    lostTimer = 0;
  }

  // ---- Spray ----
  if (speed > 4 && Math.random() < dt * (12 + 40 * edgeEngagement)) spawnRailSpray(1 + Math.round(edgeEngagement * 2));
}

function exitTube(): void {
  inTube = false;
  sfx.tubeOut();
  if (tubeTimer > 1.0) {
    const pts = addPoints(scoreState, 250 * tubeTimer);
    bumpCombo(scoreState);
    sfx.comboUp(scoreState.comboLevel);
    spawnPopup(popupState, posX, posY, posZ + 1.5, `TUBE ${tubeTimer.toFixed(1)}s +${Math.round(pts)}`, '#FFD060');
    recordTrick(scoreState, 'TUBE RIDE', pts);
    hitStop(0.06);
  }
}

function awardTrick(name: string, raw: number, color: string): void {
  bumpCombo(scoreState);
  const pts = addPoints(scoreState, raw);
  spawnPopup(popupState, posX, posY, posZ + 1.5, `${name} +${Math.round(pts)}`, color);
  recordTrick(scoreState, name.replace('!', ''), pts);
  sfx.trick();
  sfx.comboUp(scoreState.comboLevel);
  spawnRailSpray(18);
  shake(0.2, 0.15);
  hitStop(0.05);
}

function launch(vz: number, wf: WaveFrame, bigPop: boolean): void {
  const carry = carryVelocity(wf);
  const hx = Math.cos(boardYaw), hy = Math.sin(boardYaw);
  velX = hx * speed + carry.x;
  velY = hy * speed + carry.y;
  velZ = Math.min(vz, MAX_LAUNCH_VZ);
  if (inTube) exitTube();
  enterState('AIRBORNE');
  airStartZ = posZ;
  airPeakZ = posZ;
  spawnBurst(20, 1.0, 1, 1, 1);
  sfx.jump();
  if (bigPop || vz > 7) {
    timeStretch = 0.5;
    timeStretchTimer = 0.45;
    shake(0.3, 0.2);
  }
}

// ============================================================================
// Physics: AIRBORNE
// ============================================================================

function updateAirborne(params: WaveParams, simTime: number, dt: number): void {
  velZ -= G * dt;

  // Air-assist: ease the shoreward velocity toward the wave's own speed so a
  // launch off the lip comes back down on the face instead of over the back.
  const wc = waveCoordsInto(tmpCoords, posX, posY, simTime);
  const vAlong = velX * wc.propX + velY * wc.propY;
  const target = crestSpeed() * params.timeScale + AIR_RETURN_BIAS;
  const dv = (target - vAlong) * (1 - Math.exp(-AIR_RETURN * dt));
  velX += wc.propX * dv;
  velY += wc.propY * dv;

  if (keys.left) airYaw += AIR_YAW_RATE * dt;
  if (keys.right) airYaw -= AIR_YAW_RATE * dt;
  if (keys.up) airPitch += AIR_PITCH_RATE * dt;
  if (keys.down) airPitch -= AIR_PITCH_RATE * dt;

  const spins = Math.floor((Math.abs(airYaw) + 0.35) / TAU);
  while (spins > lastSpinMilestone) {
    lastSpinMilestone++;
    const pts = addPoints(scoreState, SCORE_RATES.spinPer360);
    spawnPopup(popupState, posX, posY, posZ + 1.5, `${lastSpinMilestone * 360}! +${Math.round(pts)}`, '#FF6EB4');
    recordTrick(scoreState, `${lastSpinMilestone * 360} SPIN`, pts);
    sfx.trick();
  }
  const flips = Math.floor((Math.abs(airPitch) + 0.35) / TAU);
  while (flips > lastFlipMilestone) {
    lastFlipMilestone++;
    const pts = addPoints(scoreState, SCORE_RATES.flipPer360);
    const name = airPitch > 0 ? 'BACKFLIP' : 'FRONTFLIP';
    spawnPopup(popupState, posX, posY, posZ + 1.5, `${name}! +${Math.round(pts)}`, '#FFB800');
    recordTrick(scoreState, name, pts);
    sfx.flip();
  }

  const surfHere = surfZ(posX, posY);
  const altitude = Math.max(0, posZ - surfHere);
  const grabBonus = grabHeld ? 1 + SCORE_RATES.grabAirBonus : 1;
  if (altitude > 1) addPoints(scoreState, SCORE_RATES.airPerSPerMeter * altitude * dt * grabBonus);

  posX += velX * dt;
  posY += velY * dt;
  posZ += velZ * dt;
  airPeakZ = Math.max(airPeakZ, posZ);

  const zSurface = surfZ(posX, posY);
  if (posZ <= zSurface && velZ <= 0) {
    posZ = zSurface;
    const wfLand = computeWaveFrame(posX, posY, params, simTime, boardYaw);
    const carry = carryVelocity(wfLand);
    const relX = velX - carry.x;
    const relY = velY - carry.y;
    const relSpeed = Math.sqrt(relX * relX + relY * relY);

    // Board must be flat (pitch) and pointing where it's travelling (yaw)
    const pitchMod = ((airPitch % TAU) + TAU) % TAU;
    const pitchAlign = 1 - Math.min(pitchMod, TAU - pitchMod) / Math.PI;
    const effYaw = boardYaw + airYaw;
    const travelYaw = relSpeed > 1 ? Math.atan2(relY, relX) : effYaw;
    const dirAlign = (Math.cos(wrapAngle(travelYaw - effYaw)) + 1) * 0.5;
    const alignmentQ = pitchAlign * 0.6 + dirAlign * 0.4;

    if (alignmentQ < LANDING_WIPEOUT) {
      triggerWipeout('SLAM');
      return;
    }

    const height = airPeakZ - Math.max(airStartZ, zSurface);
    const trickPoints = lastSpinMilestone * SCORE_RATES.spinPer360 + lastFlipMilestone * SCORE_RATES.flipPer360;
    const clean = alignmentQ > LANDING_CLEAN;
    const earned = addPoints(scoreState, SCORE_RATES.cleanLandBase + height * 40 + alignmentQ * trickPoints * 0.5);
    if (clean) {
      bumpCombo(scoreState);
      sfx.comboUp(scoreState.comboLevel);
      hitStop(trickPoints > 0 ? 0.09 : 0.05);
      shake(0.35, 0.2);
    }
    spawnPopup(popupState, posX, posY, posZ + 1.5,
      clean ? `STOMPED! +${Math.round(earned)}` : `+${Math.round(earned)}`,
      clean ? '#00FFCC' : '#C8C8E8');
    if (grabHeld) {
      const grabPts = addPoints(scoreState, 150);
      spawnPopup(popupState, posX, posY, posZ + 2.4, `GRAB! +${Math.round(grabPts)}`, '#FF6EB4');
      sfx.trick();
    }
    sfx.land();
    spawnBurst(Math.round(10 + (1 - alignmentQ) * 16), 0.7 + (1 - alignmentQ) * 0.8, 1, 1, 1);

    speed = relSpeed * (0.6 + alignmentQ * 0.4);
    boardYaw = travelYaw;
    vzRide = 0;
    enterState('RIDING');
    velX = 0; velY = 0; velZ = 0;
    airYaw = 0; airPitch = 0;
    lastSpinMilestone = 0; lastFlipMilestone = 0;
    return;
  }

  if (posZ < -40) triggerWipeout('LOST AT SEA');
}

// ============================================================================
// Physics: WIPEOUT
// ============================================================================

function updateWipeout(dt: number): void {
  wipeoutTimer -= dt;
  airYaw += 4.0 * dt;
  airPitch += 2.0 * dt;
  posZ = surfZ(posX, posY) - 0.4;
  if (wipeoutTimer <= 0) dropIn(liveSimTime);
}

function triggerWipeout(label: string): void {
  if (surfState === 'WIPEOUT') return;
  spawnBurst(40, 1.4, 1, 1, 1);
  spawnPopup(popupState, posX, posY, posZ + 2, label, '#FF4444');
  breakCombo(scoreState);
  inTube = false;
  sfx.wipeout();
  shake(0.7, 0.5);
  hitStop(0.12);
  enterState('WIPEOUT');
}

// ============================================================================
// State transitions
// ============================================================================

function enterState(newState: SurfState): void {
  surfState = newState;
  prevPsi = waveCoordsInto(tmpCoords, posX, posY, liveSimTime).psi;
  stateTimer = 0;
  lostTimer = 0;
  foamTimer = 0;
  if (newState === 'WIPEOUT') {
    wipeoutTimer = WIPEOUT_DURATION;
    speed = 0;
    velX = 0; velY = 0; velZ = 0;
  }
  if (newState === 'PADDLING') {
    pumpEnergy = 0;
    edgeEngagement = 0;
    leanAngle = 0;
    speed = Math.min(speed, PADDLE_MAX_SPEED);
    inTube = false;
  }
  if (newState === 'AIRBORNE') {
    airYaw = 0; airPitch = 0;
    lastSpinMilestone = 0;
    lastFlipMilestone = 0;
    grabHeld = keys.space && !jumpPressed;
  }
}

// ============================================================================
// Camera
// ============================================================================

/** Hit-stop: freeze the simulation for a few frames to make an impact land. */
function hitStop(duration: number): void {
  hitStopTimer = Math.max(hitStopTimer, duration);
}

function shake(intensity: number, duration: number): void {
  shakeIntensity = Math.max(shakeIntensity, intensity);
  shakeTimer = Math.max(shakeTimer, duration);
}

function cameraTarget(dist: number, height: number, side: number): THREE.Vector3 {
  const wc = waveCoordsInto(tmpCoords, posX, posY, liveSimTime);
  return new THREE.Vector3(
    posX - Math.cos(camYaw) * dist + wc.propX * side,
    posY - Math.sin(camYaw) * dist + wc.propY * side,
    posZ + height,
  );
}

function snapCamera(): void {
  camYaw = boardYaw;
  camPos.copy(cameraTarget(CAM_DISTANCE, CAM_HEIGHT, CAM_SIDE));
  camLookAt.set(posX + Math.cos(camYaw) * CAM_LOOK_AHEAD, posY + Math.sin(camYaw) * CAM_LOOK_AHEAD, posZ + 1);
}

function updateCamera(dt: number): void {
  const camera = getCamera();

  // Follow the direction of travel, smoothed so spins and snaps don't whip the view
  const travelYaw = surfState === 'AIRBORNE' && (velX !== 0 || velY !== 0) ? Math.atan2(velY, velX) : boardYaw;
  camYaw += wrapAngle(travelYaw - camYaw) * (1 - Math.exp(-CAM_YAW_SMOOTH * dt));

  let dist = CAM_DISTANCE, height = CAM_HEIGHT, side = CAM_SIDE, lookAhead = CAM_LOOK_AHEAD;
  if (surfState === 'WIPEOUT') { dist = CAM_WIPEOUT_DIST; height = CAM_WIPEOUT_HEIGHT; side = 0; lookAhead = 0; }
  if (surfState === 'AIRBORNE') { dist = CAM_DISTANCE + 3; height = CAM_HEIGHT + 2; }
  if (surfState === 'PADDLING') { side = 0; }

  const target = cameraTarget(dist, height, side);
  const posAlpha = 1 - Math.exp(-CAM_SMOOTH * dt);
  camPos.lerp(target, posAlpha);

  if (liveParams) {
    const camSurfZ = surfZ(camPos.x, camPos.y);
    if (camPos.z < camSurfZ + CAM_MIN_Z_OFFSET) camPos.z = camSurfZ + CAM_MIN_Z_OFFSET;
  }

  const lookAlpha = 1 - Math.exp(-CAM_LOOK_SMOOTH * dt);
  camLookAt.x += (posX + Math.cos(camYaw) * lookAhead - camLookAt.x) * lookAlpha;
  camLookAt.y += (posY + Math.sin(camYaw) * lookAhead - camLookAt.y) * lookAlpha;
  camLookAt.z += (posZ + (surfState === 'WIPEOUT' ? 0.5 : CAM_LOOK_UP) - camLookAt.z) * lookAlpha;

  shakeTimer = Math.max(0, shakeTimer - dt);
  let shakeX = 0, shakeY = 0, shakeZ = 0;
  if (shakeTimer > 0) {
    const eff = shakeIntensity * Math.min(1, shakeTimer / 0.5);
    shakeX = (Math.random() - 0.5) * eff * 2;
    shakeY = (Math.random() - 0.5) * eff * 2;
    shakeZ = (Math.random() - 0.5) * eff * 1.5;
  } else {
    shakeIntensity = 0;
  }

  camera.position.set(camPos.x + shakeX, camPos.y + shakeY, camPos.z + shakeZ);
  camera.lookAt(camLookAt);

  const targetFOV = lerp(FOV_MIN, FOV_MAX, clamp(Math.abs(speed) / 24, 0, 1)) + (inTube ? 6 : 0);
  currentFOV += (targetFOV - currentFOV) * 4 * dt;
  camera.fov = currentFOV;
  camera.updateProjectionMatrix();
}

// ============================================================================
// HUD
// ============================================================================

function showHUD(): void {
  const el = document.getElementById('game-hud');
  if (el) el.style.display = 'flex';
}

function hideHUD(): void {
  const el = document.getElementById('game-hud');
  if (el) el.style.display = 'none';
}

function fmtScore(n: number): string {
  return Math.round(n).toLocaleString();
}

function setText(id: string, txt: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function setStyle(id: string, prop: string, val: string): void {
  const el = document.getElementById(id);
  if (el) (el.style as unknown as Record<string, string>)[prop] = val;
}

function updateHUD(): void {
  setText('hud-score', fmtScore(scoreState.score));

  const m = multiplier(scoreState);
  setText('hud-combo', m > 1 ? `x${m}` : '');
  const comboColors = ['#666680', '#00FFCC', '#88FFEE', '#FF6EB4', '#FFB800', '#FF8800', '#FF4488'];
  setStyle('hud-combo', 'color', comboColors[Math.min(scoreState.comboLevel, comboColors.length - 1)]);
  setStyle('hud-combo-fill', 'width', `${Math.round(scoreState.comboFreshness * 100)}%`);

  const seconds = Math.max(0, scoreState.timeRemaining);
  setText('hud-time', seconds.toFixed(1));
  setStyle('hud-time', 'color', scoreState.finalWaveActive ? '#FFB800' : '#C8C8E8');

  setStyle('hud-speed-fill', 'width', `${Math.round(clamp(Math.abs(speed) / 24, 0, 1) * 100)}%`);
  setStyle('hud-pump-fill', 'width', `${Math.round(pumpEnergy * 100)}%`);
  setStyle('hud-pump-fill', 'background', pumpTimingGood ? '#00FFCC' : '#FF6644');

  const stateEl = document.getElementById('hud-state');
  if (stateEl) {
    let label: string;
    let color: string;
    if (inTube) { label = '~ IN THE TUBE ~'; color = '#FFD060'; }
    else if (surfState === 'WIPEOUT') { label = 'WIPEOUT!'; color = '#FF4444'; }
    else if (surfState === 'AIRBORNE') { label = '— AIR —'; color = '#FFCC00'; }
    else if (surfState === 'RIDING') { label = foamTimer > 0 ? 'GET OUT OF THE FOAM!' : 'RIDING'; color = foamTimer > 0 ? '#FF6644' : '#00FFCC'; }
    else { label = 'PADDLE: HOLD W TOWARD THE BEACH'; color = 'rgba(255,255,255,0.6)'; }
    stateEl.textContent = label;
    stateEl.style.color = color;
  }

  setStyle('hud-tube-vignette', 'opacity', inTube ? '0.7' : '0');
  setStyle('hud-final-tint', 'opacity', scoreState.finalWaveActive ? '0.25' : '0');

  if (speedLinesSprite) {
    const sl = clamp((Math.abs(speed) - 12) / 14, 0, 1);
    (speedLinesSprite.material as THREE.SpriteMaterial).opacity = sl * 0.55;
  }
}

function showEndScreen(): void {
  const overlay = document.getElementById('hud-end-screen');
  if (!overlay) return;
  const prev = waveSnapshot ? getHighScore(waveSnapshot) : 0;
  const isNewBest = waveSnapshot ? submitScore(waveSnapshot, scoreState.score) : false;
  setText('hud-end-score', fmtScore(scoreState.score));
  setText('hud-end-trick', scoreState.topTrick);
  setText('hud-end-tube', `${scoreState.tubeTimeS.toFixed(1)}s`);
  setText('hud-end-gates', String(scoreState.gatesCleared));
  setText('hud-end-best', `${fmtScore(Math.max(prev, scoreState.score))}${isNewBest ? '  ✦ NEW BEST!' : ''}`);
  setStyle('hud-end-best', 'color', isNewBest ? '#FFB800' : '#C8C8E8');
  overlay.style.display = 'flex';
  if (isNewBest) sfx.bestRun();
}

function hideEndScreen(): void {
  setStyle('hud-end-screen', 'display', 'none');
}

// ============================================================================
// Input handlers
// ============================================================================

function onKeyDown(e: KeyboardEvent): void {
  if (e.code === 'KeyA' || e.code === 'ArrowLeft')  keys.left = true;
  if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
  if (e.code === 'KeyW' || e.code === 'ArrowUp')    { keys.up = true; e.preventDefault(); }
  if (e.code === 'KeyS' || e.code === 'ArrowDown')  { keys.down = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
  if (e.code === 'Space' && !e.repeat) {
    keys.space = true;
    if (surfState === 'AIRBORNE') grabHeld = true;
    else jumpPressed = true;
    e.preventDefault();
  }
  if (e.code === 'KeyR') dropInRequested = true;
  if (e.code === 'Escape') exitGameMode();
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'KeyA' || e.code === 'ArrowLeft')  keys.left = false;
  if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp')    keys.up = false;
  if (e.code === 'KeyS' || e.code === 'ArrowDown')  keys.down = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
  if (e.code === 'Space') { keys.space = false; grabHeld = false; }
}

// ============================================================================
// Public API
// ============================================================================

export function enterGameMode(params: WaveParams, simTime: number): void {
  const camera = getCamera();
  const controls = getControls();

  savedCamPos = camera.position.clone();
  savedCamTarget = controls.target.clone();

  liveParams = params;
  liveSimTime = simTime;

  keys.left = false; keys.right = false; keys.up = false; keys.down = false; keys.shift = false; keys.space = false;
  shakeIntensity = 0; shakeTimer = 0;
  timeStretch = 1; timeStretchTimer = 0;
  hitStopTimer = 0;
  dropInRequested = false;
  currentFOV = FOV_MIN;

  controls.enabled = false;

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  showHUD();
  hideEndScreen();
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.style.display = 'none';
  const timePanel = document.getElementById('time-panel');
  if (timePanel) timePanel.style.display = 'none';

  const surfBtn = document.getElementById('surf-btn');
  if (surfBtn) surfBtn.textContent = 'EXIT ✕';

  if (!boardMesh) {
    boardMesh = createBoardMesh();
    getScene().add(boardMesh.group);
  }
  if (!speedLinesSprite) {
    speedLinesSprite = makeSpeedLinesSprite();
    getScene().add(speedLinesSprite);
  }
  initParticles();

  scoreState = createScoreState();
  popupState = createPopupState(getScene());
  gatesState = createGates(getScene());
  startRun(scoreState);
  waveSnapshot = { ...params };

  const prevBest = getHighScore(params);
  setText('hud-wave-best', prevBest > 0 ? `BEST  ${fmtScore(prevBest)}` : '');

  setTheme('sunset');
  active = true;

  // Straight onto a wave — no dead paddling time at the start of a run
  posX = params.spawnX ?? 0;
  posY = params.spawnY ?? 0;
  resetBreakField();
  beginBreakFrame(params, simTime, posX, posY);
  dropIn(simTime);
}

export function exitGameMode(): void {
  if (!active) return;
  active = false;

  const camera = getCamera();
  const controls = getControls();

  if (savedCamPos) camera.position.copy(savedCamPos);
  if (savedCamTarget) controls.target.copy(savedCamTarget);
  if (savedCamTarget) camera.lookAt(savedCamTarget);
  camera.fov = 60;
  camera.updateProjectionMatrix();
  controls.enabled = true;

  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);

  hideHUD();
  hideEndScreen();
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.style.display = '';
  const timePanel = document.getElementById('time-panel');
  if (timePanel) timePanel.style.display = '';

  const surfBtn = document.getElementById('surf-btn');
  if (surfBtn) surfBtn.textContent = 'SURF ▶';

  if (boardMesh) {
    disposeBoardMesh(boardMesh, getScene());
    boardMesh = null;
  }
  if (speedLinesSprite) {
    getScene().remove(speedLinesSprite);
    speedLinesSprite.material.map?.dispose();
    speedLinesSprite.material.dispose();
    speedLinesSprite = null;
  }
  if (particlePoints) {
    getScene().remove(particlePoints);
    (particlePoints.material as THREE.PointsMaterial).map?.dispose();
    (particlePoints.material as THREE.Material).dispose();
    particleGeom?.dispose();
    particlePoints = null;
    particleGeom = null;
  }
  if (popupState) clearPopups(popupState);
  if (gatesState) clearGates(gatesState);

  setTheme('night');
}

export function isGameModeActive(): boolean { return active; }

/**
 * Time multiplier for the ocean simulation while in game mode: 0 during
 * hit-stop, <1 during slow-mo. Keeps the wave in sync with the rider.
 */
export function gameTimeFactor(): number {
  if (!active) return 1;
  if (hitStopTimer > 0) return 0;
  return timeStretchTimer > 0 ? timeStretch : 1;
}

/** Drop the rider onto the next wave (R key / respawn button). */
export function respawnPlayer(_params: WaveParams, _simTime: number): void {
  if (!active) return;
  dropInRequested = true;
}

/** Restart the run timer + score (without leaving game mode). */
export function restartRun(): void {
  if (!active || !liveParams) return;
  scoreState = createScoreState();
  if (popupState) clearPopups(popupState);
  if (gatesState) clearGates(gatesState);
  popupState = createPopupState(getScene());
  gatesState = createGates(getScene());
  startRun(scoreState);
  waveSnapshot = { ...liveParams };
  hideEndScreen();
  dropInRequested = true;
}

export function updateGameMode(params: WaveParams, simTime: number, rawDt: number): void {
  if (!active) return;
  liveParams = params;
  liveSimTime = simTime;

  // Hit-stop freezes physics; slow-mo stretches it (main.ts slows the ocean to match)
  let dt = rawDt;
  if (hitStopTimer > 0) {
    hitStopTimer = Math.max(0, hitStopTimer - rawDt);
    dt = 0;
  } else if (timeStretchTimer > 0) {
    timeStretchTimer = Math.max(0, timeStretchTimer - rawDt);
    dt *= timeStretch;
  } else {
    timeStretch = 1;
  }

  beginBreakFrame(params, simTime, posX, posY);

  if (dropInRequested) {
    dropInRequested = false;
    if (surfState !== 'WIPEOUT') breakCombo(scoreState);
    dropIn(simTime);
  }

  const wf = computeWaveFrame(posX, posY, params, simTime, boardYaw);
  stateTimer += dt;

  const wasFinalWave = scoreState.finalWaveActive;
  tickRunTimer(scoreState, dt);
  if (!wasFinalWave && scoreState.finalWaveActive) sfx.timeWarn();
  decayCombo(scoreState, dt);

  switch (surfState) {
    case 'PADDLING': updatePaddling(wf, dt); break;
    case 'RIDING':   updateRiding(wf, dt); break;
    case 'AIRBORNE': updateAirborne(params, simTime, dt); break;
    case 'WIPEOUT':  updateWipeout(dt); break;
  }
  jumpPressed = false;

  // Gates ride the wave down the line
  const onWave = surfState === 'RIDING' || surfState === 'AIRBORNE';
  const rc = waveCoordsInto(tmpCoords, posX, posY, simTime);
  const cleared = updateGates(gatesState, params, simTime, dt, {
    x: posX, y: posY, z: posZ, n: rc.n, s: rc.s,
    lineDir: onWave ? peelDir(rc.n) : 0,
    tanX: rc.tanX, tanY: rc.tanY,
  });
  for (const g of cleared) {
    const earned = addPoints(scoreState, GATE_POINTS[g.kind]);
    bumpCombo(scoreState);
    sfx.gate();
    sfx.comboUp(scoreState.comboLevel);
    spawnPopup(popupState, g.x, g.y, g.z + 1.5, `${g.kind} GATE +${Math.round(earned)}`, GATE_COLORS[g.kind]);
    spawnBurst(20, 1.2, 0, 1, 0.85);
    scoreState.gatesCleared++;
    shake(0.2, 0.18);
    hitStop(0.04);
  }

  // Curl spray on the rider's wave and the one behind
  if (dt > 0) {
    spawnLipSpray(rc.n, simTime, dt);
    spawnLipSpray(rc.n - 1, simTime, dt * 0.5);
  }

  updateParticles(dt);
  updatePopups(popupState, dt);

  if (boardMesh) {
    setBoardPose(boardMesh, posX, posY, posZ, boardYaw, surfState, leanAngle, airYaw, airPitch);
  }

  if (speedLinesSprite) {
    speedLinesSprite.position.copy(getCamera().position);
    speedLinesSprite.position.add(
      new THREE.Vector3().copy(camLookAt).sub(getCamera().position).normalize().multiplyScalar(2),
    );
  }

  updateCamera(rawDt);
  updateHUD();

  // Endless ocean: resample the breaking surface around the camera focus
  const cx = (posX + camPos.x) * 0.5;
  const cy = (posY + camPos.y) * 0.5;
  sampleGameSurface(params, simTime, cx, cy, GAME_EXTENT, GAME_RES, gamePos, gameFoam);
  updateMesh(gamePos, GAME_RES, gameFoam);
  setSunsetAnchor(cx, cy);

  if (scoreState.runState === 'running' && scoreState.timeRemaining <= 0) {
    endRun(scoreState);
    showEndScreen();
  }

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__esurf = {
      state: surfState, speed, psi: wf.wc.psi, d: wf.d, face: wf.face_q, vz: vzRide, z: posZ, peel: peelSpeed(),
      yaw: boardYaw, dir: wf.peel, propX: wf.wc.propX, propY: wf.wc.propY, tanX: wf.wc.tanX, tanY: wf.wc.tanY,
    };
  }
}
