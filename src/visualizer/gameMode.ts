/**
 * Third-person GAME MODE — rail-energy surf physics on live Gerstner waves.
 *
 * Core metaphor: the surfer is a conduit between wave energy and board control.
 * The wave provides energy. The board converts it. The player times and directs.
 *
 * State machine:
 *   PADDLING  → RIDING:   wave face catches the surfer (face_q rises, wave pushes)
 *   RIDING    → AIRBORNE: Space at lip, or auto-launch from fast-rising crest
 *   AIRBORNE  → RIDING:   clean landing (board angle ≈ wave face angle)
 *   AIRBORNE  → WIPEOUT:  bad landing angle
 *   WIPEOUT   → PADDLING: after respawn timer
 *
 * Controls:
 *   A / D   : lean board (RIDING) / spin board (AIR) / rudder (PADDLING)
 *   W       : pump timing compress (RIDING) / paddle (PADDLING)
 *   S       : brake — increases drag (RIDING)
 *   Space   : jump off lip (edge-triggered, RIDING only)
 *   R       : respawn
 *   Esc     : exit game mode
 *
 * Camera: third-person follow cam behind and above the board.
 *         Spring-damper smoothing. Speed-responsive FOV. No mouse needed.
 */

import * as THREE from 'three';
import { surfaceZ } from '../math/trochoidal';
import { getCamera, getControls, getScene, setTheme } from './renderer3d';
import { createSpriteSheet, FRAME, FRAME_COUNT } from '../assets/surferSpriteSheet';
import type { WaveParams } from '../types';

// ============================================================================
// Constants
// ============================================================================

const G = 5.0;                     // light arcade gravity

// ---- Board dynamics ----
const LEAN_RATE          = 16.0;   // snappy direction changes on A/D
const ENGAGE_RATE        = 8.0;    // fast rail engagement
const DISENGAGE_RATE     = 3.0;    // hold edge longer after releasing input
const BASE_TURN_RADIUS   = 2.0;    // tighter turns
const SPEED_TURN_FACTOR  = 0.15;   // less turn radius growth with speed
const MAX_SPEED          = 28;     // controlled top speed

// ---- Drag (speed-squared model) ----
const DRAG_FACE          = 0.008;  // light on face — feels flowy
const DRAG_TROUGH        = 0.022;  // moderate off-face
const DRAG_BRAKE         = 0.25;   // very strong brake — can stop before next wave

// ---- Wave energy coupling ----
const COUPLING_STRENGTH  = 1.5;    // good wave push
const FACE_Q_RIDE_ENTER  = 0.12;   // easier to catch waves
const FACE_Q_RIDE_EXIT   = 0.01;   // very hard to fall off
const RIDE_EXIT_TIME     = 5.0;    // extremely forgiving

// ---- Pump timing ----
const PUMP_BUILD         = 4.0;
const PUMP_DRAIN         = 1.5;
const PUMP_POWER         = 10.0;   // strong pump — reward rhythm
const PUMP_SLOPE_DEAD    = 0.05;

// ---- Paddling ----
const PADDLE_ACCEL       = 6.0;    // faster paddling
const PADDLE_MAX_SPEED   = 6.0;    // faster max paddle speed
const PADDLE_DRAG        = 0.4;
const PADDLE_TURN_RATE   = 3.0;

// ---- Air ----
const BASE_JUMP_VZ       = 3.0;    // modest jump
const LIP_LAUNCH_FACTOR  = 0.35;   // subtle lip boost
const AIR_SPIN_RATE      = 5.0;
const LANDING_CLEAN      = 0.40;   // very forgiving clean landing
const LANDING_WIPEOUT    = 0.10;   // almost impossible to wipeout
const AUTO_LAUNCH_ZDOT   = 5.0;    // only launch on very fast-rising crests
const AUTO_LAUNCH_SPEED  = 8.0;    // need real speed to auto-launch
const LAUNCH_COOLDOWN    = 1.5;    // seconds before auto-launch can fire again after landing

// ---- Wipeout ----
const WIPEOUT_DURATION   = 1.2;    // faster recovery

// ---- Camera ----
const CAM_DISTANCE       = 12;
const CAM_HEIGHT         = 6;
const CAM_SMOOTH         = 3.5;
const CAM_LOOK_SMOOTH    = 6.0;
const CAM_LOOK_AHEAD     = 5;
const FOV_MIN            = 55;
const FOV_MAX            = 82;
const CAM_WIPEOUT_DIST   = 18;
const CAM_WIPEOUT_HEIGHT = 10;
const CAM_MIN_Z_OFFSET   = 2.5;

// ---- Particles ----
const MAX_PARTICLES      = 300;
const PARTICLE_SIZE      = 0.25;

// ---- Wake trail ----
const WAKE_LENGTH        = 50;
const WAKE_SAMPLE_INTERVAL = 0.04;

// ---- HUD ----
const MAX_SPEED_HUD      = 20;

// ============================================================================
// Types
// ============================================================================

type SurfState = 'PADDLING' | 'RIDING' | 'AIRBORNE' | 'WIPEOUT';

type WaveFrame = {
  slope: number;
  curv: number;
  water_vr: number;
  face_q: number;
  radialX: number;
  radialY: number;
  tangentX: number;
  tangentY: number;
  phaseSpeed: number;
  zdot: number;
};

// ============================================================================
// Module state
// ============================================================================

let active = false;
let surfState: SurfState = 'PADDLING';
let stateTimer = 0;
let lowFaceTimer = 0;

let posX = 0, posY = 0, posZ = 0;
let boardYaw = 0;
let leanAngle = 0;
let edgeEngagement = 0;

let speed = 0;

let velX = 0, velY = 0, velZ = 0;
let airSpin = 0;

let pumpEnergy = 0;
let pumpTimingGood = false;

let wipeoutTimer = 0;
let launchCooldown = 0;        // seconds until auto-launch is allowed again

const camPos = new THREE.Vector3();
const camLookAt = new THREE.Vector3();
let currentFOV = FOV_MIN;

let savedCamPos: THREE.Vector3 | null = null;
let savedCamTarget: THREE.Vector3 | null = null;

let liveParams: WaveParams | null = null;
let liveSimTime = 0;

const keys = { left: false, right: false, up: false, down: false };
let jumpPressed = false;

let boardGroup: THREE.Group | null = null;

// Billboard sprite (pixel art surfer)
let surferSprite: THREE.Sprite | null = null;
let surferTexture: THREE.CanvasTexture | null = null;

// Particles
const particlePos = new Float32Array(MAX_PARTICLES * 3);
const particleVel = new Float32Array(MAX_PARTICLES * 3);
const particleAge = new Float32Array(MAX_PARTICLES);
const particleMaxAge = new Float32Array(MAX_PARTICLES);
let nextParticleIdx = 0;
let particleGeom: THREE.BufferGeometry | null = null;
let particlePoints: THREE.Points | null = null;
let particlePosAttr: THREE.BufferAttribute | null = null;

// Wake trail
const wakePos = new Float32Array(WAKE_LENGTH * 3);
let wakeCount = 0;
let wakeTimer = 0;
let wakeGeom: THREE.BufferGeometry | null = null;
let wakeLine: THREE.Line | null = null;
let wakePosAttr: THREE.BufferAttribute | null = null;

// ============================================================================
// Helpers
// ============================================================================

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ============================================================================
// Billboard sprite (pixel art surfer)
// ============================================================================

/** Sprite size in world units — proportional to old board (5.7×1.56). */
const SPRITE_SIZE = 4.0;
/**
 * Z offset so the board in the sprite sits at the water surface.
 * The board bottom is ~row 34 of 48 in the sprite, so the visual content
 * ends about 70% down from the top. The sprite is centered on its position,
 * so we lift by less than half to compensate for the empty bottom rows.
 */
const SPRITE_Z_OFFSET = SPRITE_SIZE * 0.3;

function createSurferSprite(): THREE.Sprite {
  const { canvas, frameCount } = createSpriteSheet();
  surferTexture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  surferTexture.magFilter = THREE.NearestFilter;
  surferTexture.minFilter = THREE.NearestFilter;
  surferTexture.repeat.set(1 / frameCount, 1);
  surferTexture.offset.x = FRAME.RIDE / frameCount;

  const mat = new THREE.SpriteMaterial({
    map: surferTexture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(SPRITE_SIZE, SPRITE_SIZE, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function setSpriteFrame(frameIdx: number): void {
  if (!surferTexture) return;
  surferTexture.offset.x = frameIdx / FRAME_COUNT;
}

/** Pick the right animation frame based on current surf state and lean. */
function selectFrame(): number {
  switch (surfState) {
    case 'PADDLING':  return FRAME.PADDLE;
    case 'AIRBORNE':  return FRAME.AIRBORNE;
    case 'WIPEOUT':   return FRAME.WIPEOUT;
    case 'RIDING': {
      if (leanAngle > 0.35)  return FRAME.LEAN_LEFT;
      if (leanAngle < -0.35) return FRAME.LEAN_RIGHT;
      return FRAME.RIDE;
    }
    default: return FRAME.RIDE;
  }
}

function updateBoardTransform(_slope: number, _radialX: number, _radialY: number): void {
  if (!surferSprite) return;
  surferSprite.position.set(posX, posY, posZ + SPRITE_Z_OFFSET);
  setSpriteFrame(selectFrame());
  // Suppress unused — kept for API consistency with physics callers
  void _slope; void _radialX; void _radialY;
}

function updateBoardTransformAir(): void {
  if (!surferSprite) return;
  surferSprite.position.set(posX, posY, posZ + SPRITE_Z_OFFSET);
  setSpriteFrame(selectFrame());
}

// ============================================================================
// Wave frame computation
// ============================================================================

function computeWaveFrame(px: number, py: number, params: WaveParams, t: number): WaveFrame {
  const r = Math.sqrt(px * px + py * py);
  const radialX = r > 0.01 ? px / r : 1;
  const radialY = r > 0.01 ? py / r : 0;
  const tangentX = -radialY;
  const tangentY = radialX;

  const k1 = (2 * Math.PI) / Math.max(params.wavelength, 0.01);
  const omega1 = params.speedFactor * Math.sqrt(G * k1);
  const t1 = t % ((2 * Math.PI) / Math.max(omega1, 0.001));
  const phase1 = k1 * r - omega1 * t1;
  const sinP1 = Math.sin(phase1);
  const cosP1 = Math.cos(phase1);

  let slope    = -params.amplitude * k1 * sinP1;
  let water_vr =  params.amplitude * omega1 * sinP1;
  let curv     = -params.amplitude * k1 * k1 * cosP1;
  let zdot     =  params.amplitude * omega1 * sinP1;

  const phaseSpeed = omega1 / k1;

  if (params.wave2Enabled && params.wave2Amplitude > 0) {
    const dx2 = px - params.wave2OriginX;
    const dy2 = py - params.wave2OriginY;
    const r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (r2 > 0.01) {
      const k2 = (2 * Math.PI) / Math.max(params.wave2Wavelength, 0.01);
      const omega2 = params.wave2SpeedFactor * Math.sqrt(G * k2);
      const t2 = t % ((2 * Math.PI) / Math.max(omega2, 0.001));
      const phase2 = k2 * r2 - omega2 * t2;
      const proj = (dx2 / r2) * radialX + (dy2 / r2) * radialY;
      slope    += -params.wave2Amplitude * k2 * Math.sin(phase2) * proj;
      water_vr +=  params.wave2Amplitude * omega2 * Math.sin(phase2) * proj;
      curv     += -params.wave2Amplitude * k2 * k2 * Math.cos(phase2) * proj;
      zdot     +=  params.wave2Amplitude * omega2 * Math.sin(phase2);
    }
  }

  const maxSlope = Math.max(params.amplitude * k1, 0.01);
  const face_q = clamp(-slope / maxSlope, 0, 1);

  return { slope, curv, water_vr, face_q, radialX, radialY, tangentX, tangentY, phaseSpeed, zdot };
}

// ============================================================================
// Particle system
// ============================================================================

function initParticles(): void {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particlePos[i * 3 + 2] = -999;
    particleAge[i] = 999;
    particleMaxAge[i] = 1;
  }
  particleGeom = new THREE.BufferGeometry();
  particlePosAttr = new THREE.BufferAttribute(particlePos, 3);
  particlePosAttr.setUsage(THREE.DynamicDrawUsage);
  particleGeom.setAttribute('position', particlePosAttr);
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: PARTICLE_SIZE, transparent: true,
    opacity: 0.65, sizeAttenuation: true, depthWrite: false,
  });
  particlePoints = new THREE.Points(particleGeom, mat);
  particlePoints.renderOrder = 20;
  getScene().add(particlePoints);
}

function spawnParticle(x: number, y: number, z: number,
  vx: number, vy: number, vz: number, maxAge: number): void {
  const i = nextParticleIdx;
  nextParticleIdx = (nextParticleIdx + 1) % MAX_PARTICLES;
  particlePos[i * 3] = x; particlePos[i * 3 + 1] = y; particlePos[i * 3 + 2] = z;
  particleVel[i * 3] = vx; particleVel[i * 3 + 1] = vy; particleVel[i * 3 + 2] = vz;
  particleAge[i] = 0; particleMaxAge[i] = maxAge;
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
}

function spawnWakeSpray(count: number, spreadScale: number): void {
  const tailX = posX - Math.cos(boardYaw) * 2.5;
  const tailY = posY - Math.sin(boardYaw) * 2.5;
  const perpX = -Math.sin(boardYaw);
  const perpY = Math.cos(boardYaw);
  for (let j = 0; j < count; j++) {
    const spread = (Math.random() - 0.5) * spreadScale;
    spawnParticle(
      tailX + perpX * spread, tailY + perpY * spread, posZ + 0.2,
      -Math.cos(boardYaw) * speed * 0.3 + (Math.random() - 0.5) * 2,
      -Math.sin(boardYaw) * speed * 0.3 + (Math.random() - 0.5) * 2,
      1.5 + Math.random() * 2.5,
      0.5 + Math.random() * 0.8,
    );
  }
}

function spawnCarveSpray(count: number): void {
  const railSide = leanAngle > 0 ? 1 : -1;
  const perpX = -Math.sin(boardYaw) * railSide;
  const perpY = Math.cos(boardYaw) * railSide;
  for (let j = 0; j < count; j++) {
    spawnParticle(
      posX + perpX * 1.2, posY + perpY * 1.2, posZ + 0.3,
      perpX * (3 + Math.random() * 3), perpY * (3 + Math.random() * 3),
      2 + Math.random() * 3,
      0.3 + Math.random() * 0.5,
    );
  }
}

function spawnBurst(count: number, intensity: number): void {
  for (let j = 0; j < count; j++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.5;
    spawnParticle(
      posX + Math.cos(angle) * r, posY + Math.sin(angle) * r, posZ + 0.2,
      Math.cos(angle) * (2 + Math.random() * 3) * intensity,
      Math.sin(angle) * (2 + Math.random() * 3) * intensity,
      (2 + Math.random() * 4) * intensity,
      0.5 + Math.random() * 1.5,
    );
  }
}

// ============================================================================
// Wake trail
// ============================================================================

function initWake(): void {
  for (let i = 0; i < WAKE_LENGTH * 3; i++) wakePos[i] = 0;
  wakeGeom = new THREE.BufferGeometry();
  wakePosAttr = new THREE.BufferAttribute(wakePos, 3);
  wakePosAttr.setUsage(THREE.DynamicDrawUsage);
  wakeGeom.setAttribute('position', wakePosAttr);
  wakeGeom.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color: 0x66aadd, transparent: true, opacity: 0.35, depthWrite: false,
  });
  wakeLine = new THREE.Line(wakeGeom, mat);
  wakeLine.renderOrder = 19;
  getScene().add(wakeLine);
}

function addWakePoint(x: number, y: number, z: number): void {
  for (let i = (WAKE_LENGTH - 1) * 3; i >= 3; i -= 3) {
    wakePos[i] = wakePos[i - 3]; wakePos[i + 1] = wakePos[i - 2]; wakePos[i + 2] = wakePos[i - 1];
  }
  wakePos[0] = x; wakePos[1] = y; wakePos[2] = z;
  if (wakeCount < WAKE_LENGTH) wakeCount++;
  if (wakePosAttr) wakePosAttr.needsUpdate = true;
  if (wakeGeom) wakeGeom.setDrawRange(0, wakeCount);
}

function clearWake(): void {
  wakeCount = 0;
  for (let i = 0; i < WAKE_LENGTH * 3; i++) wakePos[i] = 0;
  if (wakeGeom) wakeGeom.setDrawRange(0, 0);
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

  const slopeMag = Math.sqrt(1 + wf.slope * wf.slope);
  const gravAccel = -G * wf.slope / slopeMag;
  const boardDotRadial = Math.cos(boardYaw) * wf.radialX + Math.sin(boardYaw) * wf.radialY;
  speed += gravAccel * boardDotRadial * 0.3 * dt;

  speed -= PADDLE_DRAG * speed * Math.abs(speed) * dt;
  speed = clamp(speed, -2, PADDLE_MAX_SPEED);

  posX += Math.cos(boardYaw) * speed * dt;
  posY += Math.sin(boardYaw) * speed * dt;
  posX = clamp(posX, -extent, extent);
  posY = clamp(posY, -extent, extent);
  // Smooth surface tracking to avoid blinking
  const paddleTargetZ = surfaceZ(posX, posY, liveParams!, liveSimTime);
  posZ = lerp(posZ, paddleTargetZ, Math.min(20 * dt, 1));

  leanAngle *= 0.9;
  edgeEngagement *= 0.9;

  if (wf.face_q > FACE_Q_RIDE_ENTER && speed > 1.0) {
    enterState('RIDING');
    speed += 3.0;  // catch boost — feel the wave grab you
  }
}

// ============================================================================
// Physics: RIDING
// ============================================================================

function updateRiding(wf: WaveFrame, params: WaveParams, simTime: number, dt: number, extent: number): void {
  // 1. Rail-based carving
  const leanTarget = keys.left ? 1.0 : keys.right ? -1.0 : 0.0;
  leanAngle += (leanTarget - leanAngle) * LEAN_RATE * dt;

  if (Math.abs(leanAngle) > 0.15) {
    edgeEngagement = Math.min(1, edgeEngagement + ENGAGE_RATE * dt);
  } else {
    edgeEngagement = Math.max(0, edgeEngagement - DISENGAGE_RATE * dt);
  }

  const turnRadius = BASE_TURN_RADIUS + Math.abs(speed) * SPEED_TURN_FACTOR;
  const curvature = (leanAngle * edgeEngagement) / turnRadius;
  boardYaw += curvature * speed * dt;

  // 2. Slope gravity
  const slopeMag = Math.sqrt(1 + wf.slope * wf.slope);
  const gravAccel = -G * wf.slope / slopeMag;
  const boardDotRadial = Math.cos(boardYaw) * wf.radialX + Math.sin(boardYaw) * wf.radialY;
  speed += gravAccel * boardDotRadial * dt;

  // 3. Wave energy coupling — only on the wave face, not the backside
  // face_q > 0 = front face (where energy is), face_q ≈ 0 = back/trough
  // boardDotRadial > 0 = heading toward wave origin (into the face)
  const wavePush = COUPLING_STRENGTH * wf.water_vr * wf.face_q;
  speed += wavePush * Math.max(boardDotRadial, 0) * dt;

  // 4. Pump timing
  const slopeAlongHeading = wf.slope * boardDotRadial;
  const goingDownhill = slopeAlongHeading < -PUMP_SLOPE_DEAD;
  const goingUphill = slopeAlongHeading > PUMP_SLOPE_DEAD;
  const isPumping = keys.up;

  const goodTiming = (isPumping && goingDownhill) || (!isPumping && goingUphill);
  const badTiming = (isPumping && goingUphill) || (!isPumping && goingDownhill);
  pumpTimingGood = goodTiming;

  if (goodTiming) {
    pumpEnergy = Math.min(1, pumpEnergy + PUMP_BUILD * dt);
  } else if (badTiming) {
    pumpEnergy = Math.max(0, pumpEnergy - PUMP_DRAIN * dt);
  } else {
    pumpEnergy = Math.max(0, pumpEnergy - 0.5 * dt);
  }

  // Pump only effective on the face, not the backside
  speed += pumpEnergy * PUMP_POWER * Math.max(wf.face_q, 0.1) * dt;

  // 5. Drag — higher on the backside/trough, low on the face
  const backsidePenalty = wf.face_q < 0.1 ? 0.03 : 0;  // extra drag on the back
  let dragCoeff = lerp(DRAG_TROUGH, DRAG_FACE, wf.face_q) + backsidePenalty;
  if (keys.down) dragCoeff = DRAG_BRAKE;
  speed -= dragCoeff * speed * Math.abs(speed) * dt;
  speed = clamp(speed, -MAX_SPEED, MAX_SPEED);

  // 6. Integrate position
  posX += Math.cos(boardYaw) * speed * dt;
  posY += Math.sin(boardYaw) * speed * dt;
  posX = clamp(posX, -extent, extent);
  posY = clamp(posY, -extent, extent);
  // Smooth surface tracking — fast lerp to avoid blinking but stay glued
  const targetZ = surfaceZ(posX, posY, params, simTime);
  posZ = lerp(posZ, targetZ, Math.min(30 * dt, 1));

  // 7. Jump / launch
  if (jumpPressed) {
    jumpPressed = false;
    const lip_steep = clamp(Math.abs(wf.slope) / 1.5, 0, 1);
    const near_crest = clamp(1 - Math.abs(posZ - params.amplitude) /
      Math.max(params.amplitude * 0.4, 0.1), 0, 1);
    const launch_q = lip_steep * near_crest;

    velX = Math.cos(boardYaw) * speed;
    velY = Math.sin(boardYaw) * speed;
    velZ = Math.abs(speed) * LIP_LAUNCH_FACTOR * launch_q + BASE_JUMP_VZ;

    const normLen = Math.sqrt(wf.slope * wf.slope + 1);
    velX += (-wf.slope * wf.radialX / normLen) * Math.abs(speed) * launch_q * 0.3;
    velY += (-wf.slope * wf.radialY / normLen) * Math.abs(speed) * launch_q * 0.3;

    airSpin = 0;
    enterState('AIRBORNE');
    spawnBurst(18, 1.0 + launch_q);
    return;
  }

  // Auto-launch — only when wave is rising very fast, surfer has real speed, and cooldown elapsed
  launchCooldown = Math.max(launchCooldown - dt, 0);
  if (wf.zdot > AUTO_LAUNCH_ZDOT && Math.abs(speed) > AUTO_LAUNCH_SPEED && launchCooldown <= 0) {
    velX = Math.cos(boardYaw) * speed;
    velY = Math.sin(boardYaw) * speed;
    velZ = clamp(wf.zdot * 0.2, 1.5, 4.0);   // small pop, not a rocket
    airSpin = 0;
    enterState('AIRBORNE');
    spawnBurst(12, 0.8);
    return;
  }

  // 8. Spray particles
  if (Math.abs(speed) > 4) spawnWakeSpray(1, 1.5);
  if (Math.abs(leanAngle) > 0.5 && edgeEngagement > 0.4 && Math.abs(speed) > 5) spawnCarveSpray(2);

  // 9. Riding → Paddling transition
  if (wf.face_q < FACE_Q_RIDE_EXIT && Math.abs(speed) < 2.5) {
    lowFaceTimer += dt;
    if (lowFaceTimer > RIDE_EXIT_TIME) enterState('PADDLING');
  } else {
    lowFaceTimer = 0;
  }
}

// ============================================================================
// Physics: AIRBORNE
// ============================================================================

function updateAirborne(wf: WaveFrame, params: WaveParams, simTime: number, dt: number, extent: number): void {
  velZ -= G * dt;

  const airDragFactor = Math.exp(-0.04 * dt);
  velX *= airDragFactor;
  velY *= airDragFactor;

  if (keys.left)  airSpin += AIR_SPIN_RATE * dt;
  if (keys.right) airSpin -= AIR_SPIN_RATE * dt;

  posX += velX * dt;
  posY += velY * dt;
  posZ += velZ * dt;
  posX = clamp(posX, -extent, extent);
  posY = clamp(posY, -extent, extent);

  const zSurface = surfaceZ(posX, posY, params, simTime);
  // Only land when actually below surface and moving downward (prevents bounce loops)
  if (posZ <= zSurface && velZ <= 0) {
    posZ = zSurface;

    const landingWF = computeWaveFrame(posX, posY, params, simTime);
    const waveNormX = -landingWF.slope * landingWF.radialX;
    const waveNormY = -landingWF.slope * landingWF.radialY;
    const waveNormZ = 1.0;
    const wnLen = Math.sqrt(waveNormX * waveNormX + waveNormY * waveNormY + waveNormZ * waveNormZ);

    // All landings succeed — speed penalty scales with alignment quality
    const landSpeed = Math.sqrt(velX * velX + velY * velY);
    const velDotNorm = velX * waveNormX / wnLen + velY * waveNormY / wnLen + velZ * waveNormZ / wnLen;
    const alignmentQ = clamp(1 - Math.abs(velDotNorm) / Math.max(landSpeed + Math.abs(velZ), 0.1) * 0.8, 0, 1);

    // Good landing keeps 85-100% speed, bad landing keeps 40-85%
    const preserve = 0.4 + alignmentQ * 0.6;
    speed = landSpeed * preserve;
    boardYaw = landSpeed > 0.5 ? Math.atan2(velY, velX) : boardYaw + airSpin;
    enterState('RIDING');
    launchCooldown = LAUNCH_COOLDOWN;  // prevent immediate re-launch
    spawnBurst(Math.round(8 + (1 - alignmentQ) * 15), 0.7 + (1 - alignmentQ) * 0.8);

    velX = 0; velY = 0; velZ = 0;
    airSpin = 0;
    return;
  }

  if (posZ < 0) {
    posZ = 0;
    speed = Math.sqrt(velX * velX + velY * velY) * 0.5;
    launchCooldown = LAUNCH_COOLDOWN;
    boardYaw = speed > 0.5 ? Math.atan2(velY, velX) : boardYaw;
    enterState('RIDING');
    spawnBurst(12, 1.0);
    velX = 0; velY = 0; velZ = 0;
    airSpin = 0;
  }

  // Suppress unused parameter warnings — wf is computed by caller and used for
  // board transform in the dispatch switch. Keeping the parameter for API consistency.
  void wf;
}

// ============================================================================
// Physics: WIPEOUT
// ============================================================================

function updateWipeout(params: WaveParams, simTime: number, dt: number): void {
  wipeoutTimer -= dt;
  airSpin += 2.0 * dt;
  posZ = surfaceZ(posX, posY, params, simTime);
  if (wipeoutTimer <= 0) respawnPlayer(params, simTime);
}

// ============================================================================
// State transitions
// ============================================================================

function enterState(newState: SurfState): void {
  surfState = newState;
  stateTimer = 0;
  lowFaceTimer = 0;
  if (newState === 'WIPEOUT') { wipeoutTimer = WIPEOUT_DURATION; speed = 0; }
  if (newState === 'PADDLING') { pumpEnergy = 0; edgeEngagement = 0; leanAngle = 0; }
}

// ============================================================================
// Camera
// ============================================================================

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

  camera.position.copy(camPos);
  camera.lookAt(camLookAt);

  const targetFOV = lerp(FOV_MIN, FOV_MAX, clamp(Math.abs(speed) / MAX_SPEED_HUD, 0, 1));
  currentFOV += (targetFOV - currentFOV) * 3 * dt;
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

function updateHUD(): void {
  const speedFill = document.getElementById('hud-speed-fill');
  if (speedFill) {
    speedFill.style.width = `${Math.round(clamp(Math.abs(speed) / MAX_SPEED_HUD, 0, 1) * 100)}%`;
  }

  const pumpFill = document.getElementById('hud-pump-fill');
  if (pumpFill) {
    pumpFill.style.width = `${Math.round(pumpEnergy * 100)}%`;
    pumpFill.style.background = pumpTimingGood ? '#00FFCC' : '#FF6644';
  }

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

  const pumpHint = document.getElementById('hud-pump-hint');
  if (pumpHint) {
    if (surfState === 'RIDING') {
      pumpHint.style.display = '';
      pumpHint.textContent = pumpTimingGood ? (keys.up ? 'PUMP ✓' : 'FLOW ✓') : (keys.up ? 'PUMP ✗' : '');
      pumpHint.style.color = pumpTimingGood ? '#00FFCC' : '#FF6644';
    } else {
      pumpHint.style.display = 'none';
    }
  }
}

// ============================================================================
// Input handlers
// ============================================================================

function onKeyDown(e: KeyboardEvent): void {
  if (e.code === 'KeyA' || e.code === 'ArrowLeft')  keys.left = true;
  if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
  if (e.code === 'KeyW' || e.code === 'ArrowUp')    { keys.up = true; e.preventDefault(); }
  if (e.code === 'KeyS' || e.code === 'ArrowDown')   { keys.down = true; e.preventDefault(); }
  if (e.code === 'Space' && !e.repeat)               { jumpPressed = true; e.preventDefault(); }
  if (e.code === 'KeyR' && liveParams) respawnPlayer(liveParams, liveSimTime);
  if (e.code === 'Escape') exitGameMode();
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'KeyA' || e.code === 'ArrowLeft')  keys.left = false;
  if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp')    keys.up = false;
  if (e.code === 'KeyS' || e.code === 'ArrowDown')   keys.down = false;
}

// ============================================================================
// Public API
// ============================================================================

export function enterGameMode(params: WaveParams, simTime: number): void {
  const camera = getCamera();
  const controls = getControls();

  savedCamPos = camera.position.clone();
  savedCamTarget = controls.target.clone();

  posX = params.spawnX ?? 6;
  posY = params.spawnY ?? (params.planeOffset ?? 18);
  posZ = surfaceZ(posX, posY, params, simTime);
  velX = 0; velY = 0; velZ = 0;
  speed = 0;
  boardYaw = Math.atan2(posY, posX) + Math.PI * 0.5;
  leanAngle = 0; edgeEngagement = 0;
  pumpEnergy = 0; pumpTimingGood = false;
  airSpin = 0; jumpPressed = false;
  keys.left = false; keys.right = false; keys.up = false; keys.down = false;
  wipeoutTimer = 0; lowFaceTimer = 0;

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
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.style.display = 'none';
  const timePanel = document.getElementById('time-panel');
  if (timePanel) timePanel.style.display = 'none';

  const surfBtn = document.getElementById('surf-btn');
  if (surfBtn) surfBtn.textContent = 'EXIT ✕';

  surferSprite = createSurferSprite();
  getScene().add(surferSprite);
  initParticles();
  initWake();
  clearWake();

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
  const controlsPanel = document.getElementById('controls-panel');
  if (controlsPanel) controlsPanel.style.display = '';
  const timePanel = document.getElementById('time-panel');
  if (timePanel) timePanel.style.display = '';

  const surfBtn = document.getElementById('surf-btn');
  if (surfBtn) surfBtn.textContent = 'SURF ▶';

  if (surferSprite) {
    getScene().remove(surferSprite);
    surferSprite.material.dispose();
    if (surferTexture) { surferTexture.dispose(); surferTexture = null; }
    surferSprite = null;
  }
  if (boardGroup) { getScene().remove(boardGroup); boardGroup = null; }
  if (particlePoints) { getScene().remove(particlePoints); particlePoints = null; particleGeom = null; }
  if (wakeLine) { getScene().remove(wakeLine); wakeLine = null; wakeGeom = null; }

  setTheme('night');
}

export function isGameModeActive(): boolean { return active; }

export function respawnPlayer(params: WaveParams, simTime: number): void {
  posX = params.spawnX ?? 6;
  posY = params.spawnY ?? (params.planeOffset ?? 18);
  posZ = surfaceZ(posX, posY, params, simTime);
  velX = 0; velY = 0; velZ = 0;
  speed = 0;
  boardYaw = Math.atan2(posY, posX) + Math.PI * 0.5;
  leanAngle = 0; edgeEngagement = 0;
  pumpEnergy = 0; airSpin = 0;
  jumpPressed = false; wipeoutTimer = 0; lowFaceTimer = 0;
  launchCooldown = 0;
  enterState('PADDLING');
  clearWake();
}

export function updateGameMode(params: WaveParams, simTime: number, dt: number): void {
  if (!active) return;
  liveParams = params;
  liveSimTime = simTime;

  const extent = (params.gridExtent ?? 20) - 1;
  const wf = computeWaveFrame(posX, posY, params, simTime);
  stateTimer += dt;

  switch (surfState) {
    case 'PADDLING':
      updatePaddling(wf, dt, extent);
      updateBoardTransform(wf.slope, wf.radialX, wf.radialY);
      break;
    case 'RIDING':
      updateRiding(wf, params, simTime, dt, extent);
      updateBoardTransform(wf.slope, wf.radialX, wf.radialY);
      break;
    case 'AIRBORNE':
      updateAirborne(wf, params, simTime, dt, extent);
      updateBoardTransformAir();
      break;
    case 'WIPEOUT':
      updateWipeout(params, simTime, dt);
      updateBoardTransformAir();
      break;
  }

  jumpPressed = false;

  if (surfState === 'RIDING' || surfState === 'PADDLING') {
    wakeTimer += dt;
    if (wakeTimer >= WAKE_SAMPLE_INTERVAL) {
      wakeTimer = 0;
      addWakePoint(posX, posY, posZ);
    }
  }

  updateParticles(dt);
  updateCamera(dt);
  updateHUD();
}
