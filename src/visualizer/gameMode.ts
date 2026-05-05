/**
 * Arcade SURF mode — 60-second time-attack score chase.
 *
 * State machine:
 *   PADDLING  → RIDING:   wave face catches the surfer
 *   RIDING    → AIRBORNE: Space jump (or accidental lip launch into air)
 *   AIRBORNE  → RIDING:   clean landing (good board-vs-wave alignment)
 *   AIRBORNE  → WIPEOUT:  bad landing alignment OR head-on into a steep face
 *   RIDING    → WIPEOUT:  rammed wave face going wrong direction
 *   WIPEOUT   → PADDLING: after respawn timer
 *
 * Controls (locked across all states):
 *   A / D     : carve (yaw) on water, spin (yaw) in air
 *   W / S     : forward thrust / brake on water, pitch (front/back flip) in air
 *   Shift     : pump (rhythm-timed boost) on water — separate from forward thrust
 *   Space     : jump on water (edge); HOLD in air to grab (50% air-points bonus)
 *   R         : respawn
 *   Esc       : exit game mode
 */

import * as THREE from 'three';
import { surfaceZ, wave1Z } from '../math/trochoidal';
import { getCamera, getControls, getScene, setTheme } from './renderer3d';
import { createBoardMesh, setBoardPose, disposeBoardMesh, type BoardSprite } from '../game/board';
import {
  createScoreState, startRun, endRun, tickRunTimer, addPoints, bumpCombo,
  breakCombo, decayCombo, recordTrick, multiplier,
  createPopupState, spawnPopup, updatePopups, clearPopups,
  COMBO_TIERS, SCORE_RATES, RUN_DURATION_S, FINAL_WAVE_S,
  type ScoreState, type PopupState,
} from '../game/score';
import {
  createGates, updateGates, removeGate, clearGates,
  type GatesState,
} from '../game/gates';
import { sfx } from '../game/audio';
import { getHighScore, submitScore } from '../game/highscore';
import type { WaveParams } from '../types';

// ============================================================================
// Constants
// ============================================================================

const G = 9.81;

// ---- Board dynamics ----
const BASE_TURN_RATE = 2.4;          // rad/s base, scales with speed
const SPEED_TURN_BONUS = 0.07;       // extra rad/s per (m/s)
const MAX_SPEED = 32;

// ---- Drag ----
const DRAG_FACE  = 0.006;
const DRAG_TROUGH = 0.020;
const DRAG_BRAKE = 0.30;

// ---- Wave coupling ----
const COUPLING_STRENGTH = 1.8;
const FACE_Q_RIDE_ENTER = 0.18;
const FACE_Q_RIDE_EXIT  = 0.05;
const RIDE_EXIT_TIME    = 1.0;

// ---- Pump (Shift key) ----
const PUMP_BUILD = 5.0;
const PUMP_DRAIN = 2.5;
const PUMP_POWER = 12.0;

// ---- Paddling ----
const PADDLE_ACCEL = 7.0;
const PADDLE_MAX_SPEED = 8.0;
const PADDLE_DRAG = 0.4;
const PADDLE_TURN_RATE = 3.2;

// ---- Air ----
const BASE_JUMP_VZ = 5.0;            // a real jump
const LIP_LAUNCH_FACTOR = 0.55;
const AIR_YAW_RATE = 7.0;
const AIR_PITCH_RATE = 6.5;
const LANDING_CLEAN = 0.55;
const LANDING_WIPEOUT = 0.32;        // reasonable failure threshold
const LAUNCH_COOLDOWN = 0.8;

// ---- Wipeout ----
const WIPEOUT_DURATION = 1.4;
const FACE_RAM_WIPEOUT_SLOPE = 1.4;  // slope · speed dot product threshold

// ---- Camera ----
const CAM_DISTANCE = 11;
const CAM_HEIGHT = 5.5;
const CAM_SMOOTH = 4.0;
const CAM_LOOK_SMOOTH = 7.0;
const CAM_LOOK_AHEAD = 5;
const FOV_MIN = 58;
const FOV_MAX = 88;
const CAM_WIPEOUT_DIST = 16;
const CAM_WIPEOUT_HEIGHT = 9;
const CAM_MIN_Z_OFFSET = 2.5;

// ---- Particles ----
const MAX_PARTICLES = 360;
const PARTICLE_SIZE = 0.25;

// ---- Trick scoring deltas ----
const SPIN_360 = Math.PI * 2;
const FLIP_360 = Math.PI * 2;

// ============================================================================
// Types
// ============================================================================

type SurfState = 'PADDLING' | 'RIDING' | 'AIRBORNE' | 'WIPEOUT';

type WaveFrame = {
  /** Surface gradient component along board heading (downhill is negative). */
  slopeAlong: number;
  /** Surface gradient magnitude. */
  slopeMag: number;
  /** Wave propagation direction (unit vector) at this point. */
  propX: number;
  propY: number;
  /** Tangent direction (perpendicular to propagation). */
  tanX: number;
  tanY: number;
  /** "Face quality": 1 = on the front face heading toward the trough, 0 = back/flat. */
  face_q: number;
  /** dz/dt (vertical surface velocity at this XY). */
  zdot: number;
  /** Surface height at this XY. */
  z: number;
};

// ============================================================================
// Module state
// ============================================================================

let active = false;
let surfState: SurfState = 'PADDLING';
let stateTimer = 0;
let lowFaceTimer = 0;
let paddleTimer = 0;

let posX = 0, posY = 0, posZ = 0;
let boardYaw = 0;
let leanAngle = 0;
let edgeEngagement = 0;
let speed = 0;
let crouch = 0;

let velX = 0, velY = 0, velZ = 0;

// Air rotation tracking for tricks
let airYaw = 0;            // accumulated yaw rotation while airborne
let airPitch = 0;          // accumulated pitch rotation
let airYawAtLaunch = 0;
let airPitchAtLaunch = 0;
let airTimeAtLaunch = 0;
let lastSpinMilestone = 0; // count of completed 360° spins this jump
let lastFlipMilestone = 0;
let grabHeld = false;

let pumpEnergy = 0;
let pumpTimingGood = false;

let wipeoutTimer = 0;
let launchCooldown = 0;

let inTube = false;
let tubeTimer = 0;          // dwell time in tube — for sustained-tube bonus

// Score & meta
let scoreState: ScoreState;
let popupState: PopupState;
let gatesState: GatesState;
let waveSnapshot: WaveParams | null = null;   // params at run start, for high-score keying

// Camera
const camPos = new THREE.Vector3();
const camLookAt = new THREE.Vector3();
let currentFOV = FOV_MIN;
let shakeIntensity = 0;
let shakeTimer = 0;
let timeStretch = 1;          // for slow-mo on lip launch
let timeStretchTimer = 0;
let hitStopTimer = 0;

let savedCamPos: THREE.Vector3 | null = null;
let savedCamTarget: THREE.Vector3 | null = null;

let liveParams: WaveParams | null = null;
let liveSimTime = 0;

const keys = { left: false, right: false, up: false, down: false, shift: false, space: false };
let jumpPressed = false;

// Pixel-art surfer billboard
let boardMesh: BoardSprite | null = null;

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

// Speed lines (a thin radial sprite that intensifies with speed)
let speedLinesSprite: THREE.Sprite | null = null;

// ============================================================================
// Helpers
// ============================================================================

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// ============================================================================
// Wave frame computation
// ============================================================================

/**
 * Sample the wave surface and its gradient at (px, py). Uses small finite
 * differences over the analytical surfaceZ — handles both planar and radial
 * wave 1 modes uniformly.
 */
function computeWaveFrame(px: number, py: number, params: WaveParams, t: number, headingYaw: number): WaveFrame {
  const eps = 0.5;
  const z   = surfaceZ(px,        py,        params, t);
  const zPx = surfaceZ(px + eps,  py,        params, t);
  const zPy = surfaceZ(px,        py + eps,  params, t);
  const dt = 0.05;
  const zNext = surfaceZ(px, py, params, t + dt);

  const dzdx = (zPx - z) / eps;
  const dzdy = (zPy - z) / eps;
  const slopeMag = Math.sqrt(dzdx * dzdx + dzdy * dzdy);

  // Wave propagation direction at this point:
  //   - planar: fixed wave1Direction
  //   - radial: outward radial from origin (use position direction)
  let propX: number, propY: number;
  if (params.wave1Mode === 'planar') {
    propX = Math.cos(params.wave1Direction);
    propY = Math.sin(params.wave1Direction);
  } else {
    const r = Math.sqrt(px * px + py * py);
    propX = r > 0.01 ? px / r : 1;
    propY = r > 0.01 ? py / r : 0;
  }
  const tanX = -propY;
  const tanY = propX;

  // Slope along heading (negative if heading is downhill = chasing the trough)
  const headDx = Math.cos(headingYaw);
  const headDy = Math.sin(headingYaw);
  const slopeAlong = dzdx * headDx + dzdy * headDy;

  // face_q: how much we're on the "front" of a wave (where energy is).
  // A surfer riding "down the line" along the face has the slope perpendicular
  // to their heading. We treat face_q = projection of -gradient onto
  // propagation direction, normalized.
  const maxSlope = Math.max(params.amplitude * (2 * Math.PI / Math.max(params.wavelength, 0.01)), 0.01);
  const faceProj = -(dzdx * propX + dzdy * propY) / maxSlope;
  const face_q = clamp(faceProj, 0, 1);

  const zdot = (zNext - z) / dt;

  return { slopeAlong, slopeMag, propX, propY, tanX, tanY, face_q, zdot, z };
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
    size: PARTICLE_SIZE, transparent: true, opacity: 0.75,
    sizeAttenuation: true, depthWrite: false, vertexColors: true,
  });
  particlePoints = new THREE.Points(particleGeom, mat);
  particlePoints.renderOrder = 20;
  getScene().add(particlePoints);
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

function spawnSpray(x: number, y: number, z: number, count: number): void {
  for (let i = 0; i < count; i++) {
    spawnParticle(
      x + (Math.random() - 0.5) * 0.6,
      y + (Math.random() - 0.5) * 0.6,
      z + 0.2,
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 4,
      1.5 + Math.random() * 3,
      0.5 + Math.random() * 0.6,
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

// ============================================================================
// Speed lines
// ============================================================================

function makeSpeedLinesSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 256, 256);
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
// Physics: PADDLING
// ============================================================================

function updatePaddling(wf: WaveFrame, dt: number, extent: number): void {
  if (keys.left) boardYaw += PADDLE_TURN_RATE * dt;
  if (keys.right) boardYaw -= PADDLE_TURN_RATE * dt;

  if (keys.up) {
    speed += PADDLE_ACCEL * dt;
    if (speed > PADDLE_MAX_SPEED) speed = PADDLE_MAX_SPEED;
  }
  if (keys.down) {
    speed -= PADDLE_ACCEL * 0.5 * dt;
  }

  // Slope influence
  const headDx = Math.cos(boardYaw);
  const headDy = Math.sin(boardYaw);
  const headingDownhill = wf.slopeAlong < 0 ? 1 : 0;
  speed += -G * 0.25 * wf.slopeAlong * dt * headingDownhill;

  speed -= PADDLE_DRAG * speed * Math.abs(speed) * dt;
  speed = clamp(speed, -2, PADDLE_MAX_SPEED);

  posX += headDx * speed * dt;
  posY += headDy * speed * dt;
  posX = clamp(posX, -extent, extent);
  posY = clamp(posY, -extent, extent);
  const targetZ = surfaceZ(posX, posY, liveParams!, liveSimTime);
  posZ = lerp(posZ, targetZ, Math.min(20 * dt, 1));

  leanAngle *= 0.9;
  edgeEngagement *= 0.9;
  crouch = Math.max(crouch - dt * 3, 0);

  if (wf.face_q > FACE_Q_RIDE_ENTER && speed > 1.5) {
    enterState('RIDING');
    speed += 4.0;
    sfx.whoosh();
  }
}

// ============================================================================
// Physics: RIDING
// ============================================================================

function updateRiding(wf: WaveFrame, params: WaveParams, simTime: number, dt: number, extent: number): void {
  // Carving (yaw)
  const turnRate = BASE_TURN_RATE + Math.abs(speed) * SPEED_TURN_BONUS;
  const leanTarget = keys.left ? 1.0 : keys.right ? -1.0 : 0.0;
  leanAngle += (leanTarget - leanAngle) * 12 * dt;

  if (Math.abs(leanAngle) > 0.15) {
    edgeEngagement = Math.min(1, edgeEngagement + 7 * dt);
  } else {
    edgeEngagement = Math.max(0, edgeEngagement - 4 * dt);
  }
  boardYaw += leanAngle * edgeEngagement * turnRate * dt;

  // Forward thrust / brake (W/S directly affects speed when riding)
  if (keys.up) speed += 4.0 * dt;
  if (keys.down) speed -= 6.0 * dt;
  crouch = lerp(crouch, keys.down ? 1 : (keys.shift ? 0.5 : 0), Math.min(8 * dt, 1));

  // Slope gravity
  const downhillAccel = -G * wf.slopeAlong / Math.sqrt(1 + wf.slopeAlong * wf.slopeAlong);
  speed += downhillAccel * 0.7 * dt;

  // Wave energy coupling — only riding the face
  const headDx = Math.cos(boardYaw);
  const headDy = Math.sin(boardYaw);
  const headDotProp = headDx * wf.propX + headDy * wf.propY;
  // Pushed in direction of -prop (the direction the wave is rolling toward)
  const wavePush = COUPLING_STRENGTH * wf.face_q * Math.max(-headDotProp, 0);
  speed += wavePush * 6.0 * dt;

  // Pump (Shift)
  const slopeDownhill = wf.slopeAlong < 0;
  const pumping = keys.shift;
  const goodPumpTiming = pumping && slopeDownhill;
  const badPumpTiming  = pumping && !slopeDownhill;
  pumpTimingGood = goodPumpTiming;

  if (goodPumpTiming) pumpEnergy = Math.min(1, pumpEnergy + PUMP_BUILD * dt);
  else if (badPumpTiming) pumpEnergy = Math.max(0, pumpEnergy - PUMP_DRAIN * dt);
  else pumpEnergy = Math.max(0, pumpEnergy - 0.5 * dt);

  speed += pumpEnergy * PUMP_POWER * Math.max(wf.face_q, 0.1) * dt;
  if (goodPumpTiming && Math.random() < dt * 8) sfx.pump();

  // Drag
  let dragCoeff = lerp(DRAG_TROUGH, DRAG_FACE, wf.face_q);
  if (keys.down) dragCoeff = DRAG_BRAKE;
  speed -= dragCoeff * speed * Math.abs(speed) * dt;
  speed = clamp(speed, -MAX_SPEED, MAX_SPEED);

  // Position
  posX += headDx * speed * dt;
  posY += headDy * speed * dt;
  posX = clamp(posX, -extent, extent);
  posY = clamp(posY, -extent, extent);
  const targetZ = surfaceZ(posX, posY, params, simTime);
  posZ = lerp(posZ, targetZ, Math.min(30 * dt, 1));

  // Nose-dive wipeout — heading sharply downhill at high speed
  const slopeAheadDownhill = -wf.slopeAlong;
  if (slopeAheadDownhill > FACE_RAM_WIPEOUT_SLOPE && Math.abs(speed) > 18) {
    triggerWipeout('NOSEDIVE');
    return;
  }

  // Score: face ride
  if (wf.face_q > 0.4 && speed > 4) {
    addPoints(scoreState, SCORE_RATES.faceRidePerS * dt);
  }

  // Tube detection — riding under the curl of a steep wave
  const tubeQ = wf.face_q > 0.85 && speed > 6 && wf.slopeMag > 0.45;
  if (tubeQ) {
    if (!inTube) {
      inTube = true;
      tubeTimer = 0;
      sfx.tubeIn();
      bumpCombo(scoreState);
      sfx.comboUp(scoreState.comboLevel);
      shake(0.25, 0.2);
    }
    tubeTimer += dt;
    addPoints(scoreState, SCORE_RATES.tubeRidePerS * dt);
    scoreState.tubeTimeS += dt;
  } else if (inTube) {
    inTube = false;
    sfx.tubeOut();
    spawnPopup(popupState, posX, posY, posZ + 1.5, '+TUBE!', '#FFD060');
  }

  // Jump
  if (jumpPressed) {
    jumpPressed = false;
    const lipBonus = clamp(wf.slopeMag / 1.0, 0, 1) * clamp(wf.face_q, 0, 1);
    velX = headDx * speed;
    velY = headDy * speed;
    velZ = BASE_JUMP_VZ + Math.abs(speed) * LIP_LAUNCH_FACTOR * lipBonus;
    enterState('AIRBORNE');
    spawnBurst(20, 1.0 + lipBonus, 1, 1, 1);
    sfx.jump();
    if (lipBonus > 0.6) {
      timeStretch = 0.55;
      timeStretchTimer = 0.4;
      shake(0.4, 0.25);
    }
    return;
  }

  // Riding → Paddling transition
  if (wf.face_q < FACE_Q_RIDE_EXIT && Math.abs(speed) < 2.5) {
    lowFaceTimer += dt;
    if (lowFaceTimer > RIDE_EXIT_TIME) enterState('PADDLING');
  } else {
    lowFaceTimer = 0;
  }

  // Spray
  if (Math.abs(speed) > 4 && Math.random() < dt * 25) {
    spawnSpray(posX, posY, posZ, 1);
  }
}

// ============================================================================
// Physics: AIRBORNE
// ============================================================================

function updateAirborne(_wf: WaveFrame, params: WaveParams, simTime: number, dt: number, extent: number): void {
  velZ -= G * dt;
  velX *= Math.exp(-0.05 * dt);
  velY *= Math.exp(-0.05 * dt);

  // A/D = yaw (spin)
  if (keys.left) airYaw += AIR_YAW_RATE * dt;
  if (keys.right) airYaw -= AIR_YAW_RATE * dt;
  // W/S = pitch (flips)
  if (keys.up) airPitch += AIR_PITCH_RATE * dt;     // backflip
  if (keys.down) airPitch -= AIR_PITCH_RATE * dt;   // frontflip

  // Spin / flip milestones
  const spins = Math.floor(Math.abs(airYaw) / SPIN_360);
  while (spins > lastSpinMilestone) {
    lastSpinMilestone++;
    const pts = addPoints(scoreState, SCORE_RATES.spinPer360);
    spawnPopup(popupState, posX, posY, posZ + 1.5, `360! +${Math.round(pts)}`, '#FF6EB4');
    recordTrick(scoreState, '360 SPIN', pts);
    sfx.trick();
  }
  const flips = Math.floor(Math.abs(airPitch) / FLIP_360);
  while (flips > lastFlipMilestone) {
    lastFlipMilestone++;
    const pts = addPoints(scoreState, SCORE_RATES.flipPer360);
    const name = airPitch > 0 ? 'BACKFLIP' : 'FRONTFLIP';
    spawnPopup(popupState, posX, posY, posZ + 1.5, `${name}! +${Math.round(pts)}`, '#FFB800');
    recordTrick(scoreState, name, pts);
    sfx.flip();
  }

  // Air time score (multiplied by altitude above wave)
  const surfZHere = surfaceZ(posX, posY, params, simTime);
  const altitude = Math.max(0, posZ - surfZHere);
  const grabBonus = grabHeld ? 1 + SCORE_RATES.grabAirBonus : 1;
  if (altitude > 1) {
    addPoints(scoreState, SCORE_RATES.airPerSPerMeter * altitude * dt * grabBonus);
  }

  posX += velX * dt;
  posY += velY * dt;
  posZ += velZ * dt;
  posX = clamp(posX, -extent, extent);
  posY = clamp(posY, -extent, extent);

  // Landing
  const zSurface = surfaceZ(posX, posY, params, simTime);
  if (posZ <= zSurface && velZ <= 0) {
    posZ = zSurface;

    // Compute board orientation alignment with wave normal
    const wfLand = computeWaveFrame(posX, posY, params, simTime, boardYaw);
    const landSpeed = Math.sqrt(velX * velX + velY * velY);

    // Pitch alignment: a flip mid-rotation is bad (board not flat at impact).
    // Use cos of the residual pitch (mod 2π) — must be near 1 for a clean stomp.
    const pitchMod = ((airPitch % SPIN_360) + SPIN_360) % SPIN_360;
    const pitchOff = Math.min(pitchMod, SPIN_360 - pitchMod) / Math.PI; // 0..1, 0 = flat
    const pitchAlign = 1 - pitchOff; // 1 = perfectly flat

    // Direction alignment: velocity heading should point downhill of wave.
    const velAng = Math.atan2(velY, velX);
    const headOffset = Math.cos(velAng - boardYaw);
    const dirAlign = clamp((headOffset + 1) * 0.5, 0, 1); // 1 = aligned, 0 = 180°

    const alignmentQ = pitchAlign * 0.65 + dirAlign * 0.35;

    if (alignmentQ < LANDING_WIPEOUT) {
      triggerWipeout('SLAM');
      void wfLand;
      return;
    }

    const trickPoints = (lastSpinMilestone * SCORE_RATES.spinPer360)
      + (lastFlipMilestone * SCORE_RATES.flipPer360);
    const cleanLandBonus = SCORE_RATES.cleanLandBase + alignmentQ * trickPoints * 0.5;
    const earned = addPoints(scoreState, cleanLandBonus);
    if (alignmentQ > LANDING_CLEAN) {
      bumpCombo(scoreState);
      sfx.comboUp(scoreState.comboLevel);
    }
    spawnPopup(popupState, posX, posY, posZ + 1.5,
      alignmentQ > LANDING_CLEAN ? `STOMPED! +${Math.round(earned)}` : `+${Math.round(earned)}`,
      alignmentQ > LANDING_CLEAN ? '#00FFCC' : '#C8C8E8');
    if (grabHeld) {
      const grabBonusPts = addPoints(scoreState, 150);
      spawnPopup(popupState, posX, posY, posZ + 2.4, `GRAB! +${Math.round(grabBonusPts)}`, '#FF6EB4');
      sfx.trick();
    }
    sfx.land();
    spawnBurst(Math.round(10 + (1 - alignmentQ) * 16), 0.7 + (1 - alignmentQ) * 0.8, 1, 1, 1);

    speed = landSpeed * (0.55 + alignmentQ * 0.45);
    boardYaw = landSpeed > 0.5 ? Math.atan2(velY, velX) : boardYaw + airYaw * 0.3;
    enterState('RIDING');
    launchCooldown = LAUNCH_COOLDOWN;
    velX = 0; velY = 0; velZ = 0;
    airYaw = 0; airPitch = 0;
    lastSpinMilestone = 0; lastFlipMilestone = 0;
    return;
  }

  // Floor catch — should never really happen with planar waves but safety
  if (posZ < -20) {
    triggerWipeout('LOST AT SEA');
  }
}

// ============================================================================
// Physics: WIPEOUT
// ============================================================================

function updateWipeout(params: WaveParams, simTime: number, dt: number): void {
  wipeoutTimer -= dt;
  airYaw += 4.0 * dt;
  airPitch += 2.0 * dt;
  posZ = surfaceZ(posX, posY, params, simTime) - 0.4;
  if (wipeoutTimer <= 0) respawnPlayer(params, simTime);
}

function triggerWipeout(label: string): void {
  if (surfState === 'WIPEOUT') return;
  spawnBurst(40, 1.4, 1, 1, 1);
  spawnPopup(popupState, posX, posY, posZ + 2, label, '#FF4444');
  breakCombo(scoreState);
  inTube = false;
  sfx.wipeout();
  shake(0.7, 0.5);
  enterState('WIPEOUT');
}

// ============================================================================
// State transitions
// ============================================================================

function enterState(newState: SurfState): void {
  surfState = newState;
  stateTimer = 0;
  lowFaceTimer = 0;
  if (newState === 'WIPEOUT') {
    wipeoutTimer = WIPEOUT_DURATION;
    speed = 0;
    velX = 0; velY = 0; velZ = 0;
  }
  if (newState === 'PADDLING') {
    pumpEnergy = 0;
    edgeEngagement = 0;
    leanAngle = 0;
    paddleTimer = 0;
  }
  if (newState === 'AIRBORNE') {
    airYaw = 0; airPitch = 0;
    airYawAtLaunch = 0; airPitchAtLaunch = 0;
    airTimeAtLaunch = liveSimTime;
    lastSpinMilestone = 0;
    lastFlipMilestone = 0;
  }
}

// ============================================================================
// Camera
// ============================================================================

function shake(intensity: number, duration: number): void {
  shakeIntensity = Math.max(shakeIntensity, intensity);
  shakeTimer = Math.max(shakeTimer, duration);
}

function updateCamera(dt: number): void {
  const camera = getCamera();

  let targetDist = CAM_DISTANCE;
  let targetHeight = CAM_HEIGHT;
  let lookAhead = CAM_LOOK_AHEAD;

  if (surfState === 'WIPEOUT') {
    targetDist = CAM_WIPEOUT_DIST;
    targetHeight = CAM_WIPEOUT_HEIGHT;
    lookAhead = 0;
  }
  if (surfState === 'AIRBORNE') {
    targetDist = CAM_DISTANCE + 3;
    targetHeight = CAM_HEIGHT + 2;
  }

  const camTargetX = posX - Math.cos(boardYaw) * targetDist;
  const camTargetY = posY - Math.sin(boardYaw) * targetDist;
  const camTargetZ = posZ + targetHeight;

  const posAlpha = 1 - Math.exp(-CAM_SMOOTH * dt);
  camPos.x += (camTargetX - camPos.x) * posAlpha;
  camPos.y += (camTargetY - camPos.y) * posAlpha;
  camPos.z += (camTargetZ - camPos.z) * posAlpha;

  if (liveParams) {
    const camSurfZ = surfaceZ(camPos.x, camPos.y, liveParams, liveSimTime);
    if (camPos.z < camSurfZ + CAM_MIN_Z_OFFSET) camPos.z = camSurfZ + CAM_MIN_Z_OFFSET;
  }

  const lookTargetX = posX + Math.cos(boardYaw) * lookAhead;
  const lookTargetY = posY + Math.sin(boardYaw) * lookAhead;
  const lookTargetZ = posZ + 1.5;

  const lookAlpha = 1 - Math.exp(-CAM_LOOK_SMOOTH * dt);
  camLookAt.x += (lookTargetX - camLookAt.x) * lookAlpha;
  camLookAt.y += (lookTargetY - camLookAt.y) * lookAlpha;
  camLookAt.z += (lookTargetZ - camLookAt.z) * lookAlpha;

  // Apply shake offsets
  shakeTimer = Math.max(0, shakeTimer - dt);
  let shakeX = 0, shakeY = 0, shakeZ = 0;
  if (shakeTimer > 0) {
    const k = shakeTimer / 0.5; // assume max duration 0.5s for normalisation
    const eff = shakeIntensity * Math.min(1, k);
    shakeX = (Math.random() - 0.5) * eff * 2;
    shakeY = (Math.random() - 0.5) * eff * 2;
    shakeZ = (Math.random() - 0.5) * eff * 1.5;
  } else {
    shakeIntensity = 0;
  }

  camera.position.set(camPos.x + shakeX, camPos.y + shakeY, camPos.z + shakeZ);
  camera.lookAt(camLookAt);

  // FOV: pulse with speed, plus add a kick during slow-mo for stylization
  const targetFOV = lerp(FOV_MIN, FOV_MAX, clamp(Math.abs(speed) / 24, 0, 1));
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
  // Score
  setText('hud-score', fmtScore(scoreState.score));

  // Combo multiplier
  const m = multiplier(scoreState);
  setText('hud-combo', m > 1 ? `x${m}` : '');
  const comboColors = ['#666680', '#00FFCC', '#88FFEE', '#FF6EB4', '#FFB800', '#FF8800', '#FF4488'];
  setStyle('hud-combo', 'color', comboColors[Math.min(scoreState.comboLevel, comboColors.length - 1)]);

  // Timer
  const seconds = Math.max(0, scoreState.timeRemaining);
  setText('hud-time', seconds.toFixed(1));
  if (scoreState.finalWaveActive) {
    setStyle('hud-time', 'color', '#FFB800');
  } else {
    setStyle('hud-time', 'color', '#C8C8E8');
  }

  // Speed bar
  const speedPct = Math.round(clamp(Math.abs(speed) / 24, 0, 1) * 100);
  setStyle('hud-speed-fill', 'width', `${speedPct}%`);

  // Pump bar
  setStyle('hud-pump-fill', 'width', `${Math.round(pumpEnergy * 100)}%`);
  setStyle('hud-pump-fill', 'background', pumpTimingGood ? '#00FFCC' : '#FF6644');

  // State label
  const stateEl = document.getElementById('hud-state');
  if (stateEl) {
    const labels: Record<SurfState, string> = {
      PADDLING: 'PADDLING', RIDING: 'RIDING',
      AIRBORNE: '— AIR —', WIPEOUT: 'WIPEOUT!',
    };
    stateEl.textContent = labels[surfState];
    stateEl.style.color = surfState === 'WIPEOUT' ? '#FF4444' :
      surfState === 'AIRBORNE' ? '#FFCC00' :
      surfState === 'RIDING' ? '#00FFCC' : 'rgba(255,255,255,0.5)';
  }

  // Tube vignette
  setStyle('hud-tube-vignette', 'opacity', inTube ? '0.7' : '0');

  // Final-wave full-screen tint
  setStyle('hud-final-tint', 'opacity', scoreState.finalWaveActive ? '0.25' : '0');

  // Speed lines opacity
  if (speedLinesSprite) {
    const sl = clamp((Math.abs(speed) - 12) / 16, 0, 1);
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
  if (e.code === 'KeyR' && liveParams) respawnPlayer(liveParams, liveSimTime);
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

  posX = params.spawnX ?? 0;
  posY = params.spawnY ?? 0;
  posZ = surfaceZ(posX, posY, params, simTime);
  velX = 0; velY = 0; velZ = 0;
  speed = 0;
  // Face the wave's incoming direction (so the surfer paddles into oncoming swells)
  const incomingDir = params.wave1Mode === 'planar'
    ? params.wave1Direction + Math.PI
    : 0;
  boardYaw = incomingDir;
  leanAngle = 0; edgeEngagement = 0;
  pumpEnergy = 0; pumpTimingGood = false;
  airYaw = 0; airPitch = 0;
  airYawAtLaunch = 0; airPitchAtLaunch = 0;
  airTimeAtLaunch = 0;
  lastSpinMilestone = 0; lastFlipMilestone = 0;
  jumpPressed = false; grabHeld = false;
  keys.left = false; keys.right = false; keys.up = false; keys.down = false; keys.shift = false; keys.space = false;
  wipeoutTimer = 0; lowFaceTimer = 0; paddleTimer = 0;
  launchCooldown = 0;
  inTube = false; tubeTimer = 0;
  shakeIntensity = 0; shakeTimer = 0;
  timeStretch = 1; timeStretchTimer = 0;
  hitStopTimer = 0;
  crouch = 0;

  enterState('PADDLING');

  camPos.set(
    posX - Math.cos(boardYaw) * CAM_DISTANCE,
    posY - Math.sin(boardYaw) * CAM_DISTANCE,
    posZ + CAM_HEIGHT,
  );
  camLookAt.set(
    posX + Math.cos(boardYaw) * CAM_LOOK_AHEAD,
    posY + Math.sin(boardYaw) * CAM_LOOK_AHEAD,
    posZ + 1.5,
  );
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

  // Build 3D surfer mesh + add to scene
  if (!boardMesh) {
    boardMesh = createBoardMesh();
    getScene().add(boardMesh.group);
  }

  // Speed lines
  if (!speedLinesSprite) {
    speedLinesSprite = makeSpeedLinesSprite();
    getScene().add(speedLinesSprite);
  }

  initParticles();

  // Start the score run + scene-bound modules
  scoreState = createScoreState();
  popupState = createPopupState(getScene());
  gatesState = createGates(getScene());
  startRun(scoreState);
  waveSnapshot = { ...params };

  // Show wave high-score
  const prevBest = getHighScore(params);
  setText('hud-wave-best', prevBest > 0 ? `BEST  ${fmtScore(prevBest)}` : '');

  setTheme('sunset');
  active = true;
}

export function exitGameMode(): void {
  if (!active) return;
  active = false;

  const camera = getCamera();
  const controls = getControls();

  if (savedCamPos) camera.position.copy(savedCamPos);
  if (savedCamTarget) controls.target.copy(savedCamTarget);
  if (savedCamTarget) camera.lookAt(savedCamTarget);
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

export function respawnPlayer(params: WaveParams, simTime: number): void {
  posX = params.spawnX ?? 0;
  posY = params.spawnY ?? 0;
  posZ = surfaceZ(posX, posY, params, simTime);
  velX = 0; velY = 0; velZ = 0;
  speed = 0;
  const incomingDir = params.wave1Mode === 'planar' ? params.wave1Direction + Math.PI : 0;
  boardYaw = incomingDir;
  leanAngle = 0; edgeEngagement = 0;
  pumpEnergy = 0; airYaw = 0; airPitch = 0;
  jumpPressed = false; grabHeld = false; wipeoutTimer = 0; lowFaceTimer = 0;
  launchCooldown = 0; inTube = false; tubeTimer = 0;
  enterState('PADDLING');
}

/**
 * Restart the run timer + score (without leaving game mode).
 */
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
  respawnPlayer(liveParams, liveSimTime);
}

export function updateGameMode(params: WaveParams, simTime: number, dt: number): void {
  if (!active) return;
  liveParams = params;
  liveSimTime = simTime;

  // Hit-stop: freeze physics for a moment after big events
  if (hitStopTimer > 0) {
    hitStopTimer = Math.max(0, hitStopTimer - dt);
    if (hitStopTimer > 0) dt = 0;
  }

  // Slow-mo time stretch (lip launches, etc.)
  if (timeStretchTimer > 0) {
    timeStretchTimer = Math.max(0, timeStretchTimer - dt);
    dt *= timeStretch;
  } else {
    timeStretch = 1;
  }

  const extent = (params.gridExtent ?? 30) - 1;
  const wf = computeWaveFrame(posX, posY, params, simTime, boardYaw);
  stateTimer += dt;

  // Run timer + final-wave detection
  const wasFinalWave = scoreState.finalWaveActive;
  tickRunTimer(scoreState, dt);
  if (!wasFinalWave && scoreState.finalWaveActive) sfx.timeWarn();

  // Combo decay when not engaged (paddling without progress)
  const idle = surfState === 'PADDLING' && Math.abs(speed) < 2;
  decayCombo(scoreState, dt, idle);
  if (idle) paddleTimer += dt; else paddleTimer = 0;

  switch (surfState) {
    case 'PADDLING':
      updatePaddling(wf, dt, extent);
      break;
    case 'RIDING':
      updateRiding(wf, params, simTime, dt, extent);
      break;
    case 'AIRBORNE':
      updateAirborne(wf, params, simTime, dt, extent);
      break;
    case 'WIPEOUT':
      updateWipeout(params, simTime, dt);
      break;
  }

  jumpPressed = false;

  // Gates
  const cleared = updateGates(gatesState, params, simTime, dt, posX, posY, posZ, boardYaw);
  for (const idx of cleared) {
    const pos = removeGate(gatesState, idx);
    if (pos) {
      const earned = addPoints(scoreState, SCORE_RATES.gateClear);
      bumpCombo(scoreState);
      sfx.gate();
      sfx.comboUp(scoreState.comboLevel);
      spawnPopup(popupState, pos.x, pos.y, pos.z + 1.5, `GATE! +${Math.round(earned)}`, '#00FFCC');
      spawnBurst(20, 1.2, 0, 1, 0.85);
      scoreState.gatesCleared++;
      shake(0.2, 0.18);
    }
  }

  // Particles + popups
  updateParticles(dt);
  updatePopups(popupState, dt);

  // Apply pose to 3D surfer mesh
  if (boardMesh) {
    setBoardPose(boardMesh, posX, posY, posZ, boardYaw, surfState, leanAngle, airYaw, airPitch);
  }

  // Speed lines follow camera
  if (speedLinesSprite) {
    speedLinesSprite.position.copy(getCamera().position);
    speedLinesSprite.position.add(
      new THREE.Vector3(0, 0, 0).copy(camLookAt).sub(getCamera().position).normalize().multiplyScalar(2),
    );
  }

  updateCamera(dt);
  updateHUD();

  // End-of-run
  if (scoreState.runState === 'running' && scoreState.timeRemaining <= 0) {
    endRun(scoreState);
    showEndScreen();
  }

  // Use _wf to keep linter happy on the airborne path's unused param
  void wf;
  void wave1Z;
  void RUN_DURATION_S;
  void FINAL_WAVE_S;
  void COMBO_TIERS;
  void airYawAtLaunch; void airPitchAtLaunch; void airTimeAtLaunch;
}
