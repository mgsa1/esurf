/**
 * Procedurally-spawned buoy gates — glowing rings on the wave surface that
 * give the player a target to ride toward. Clearing one = score + combo bump.
 *
 * Spawn rule: when fewer than MAX_ACTIVE gates exist, place a new one ahead
 * of the surfer along its current heading, ~SPAWN_DIST units away, snapped
 * to the wave surface.
 */

import * as THREE from 'three';
import { surfaceZ } from '../math/trochoidal';
import type { WaveParams } from '../types';

const MAX_ACTIVE = 3;
const RING_RADIUS = 1.6;
const HIT_RADIUS = 2.2;
const SPAWN_DIST = 22;
const SPAWN_ANGLE_VARIANCE = 0.45; // radians left/right of heading
const RING_TUBE_RADIUS = 0.18;
const RING_LIFE_S = 12;            // gates auto-expire if never hit

interface Gate {
  alive: boolean;
  age: number;
  worldX: number;
  worldY: number;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
}

export interface GatesState {
  scene: THREE.Scene;
  gates: Gate[];
  spawnCooldown: number;
}

function makeRing(): { ring: THREE.Mesh; glow: THREE.Mesh } {
  const ringGeo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00FFCC, transparent: true, opacity: 0.95, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 8;

  const glowGeo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS * 3, 8, 32);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x00FFCC, transparent: true, opacity: 0.20, depthWrite: false });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.renderOrder = 7;
  return { ring, glow };
}

export function createGates(scene: THREE.Scene): GatesState {
  return { scene, gates: [], spawnCooldown: 0 };
}

function disposeGate(g: Gate, scene: THREE.Scene): void {
  scene.remove(g.ring);
  scene.remove(g.glow);
  g.ring.geometry.dispose();
  (g.ring.material as THREE.Material).dispose();
  g.glow.geometry.dispose();
  (g.glow.material as THREE.Material).dispose();
}

export function clearGates(state: GatesState): void {
  for (const g of state.gates) disposeGate(g, state.scene);
  state.gates = [];
  state.spawnCooldown = 0;
}

/**
 * Spawn a new gate ahead of the surfer.
 * Position is offset by SPAWN_DIST along a slightly randomized heading, then
 * clamped to the gridExtent. Z snaps to the wave surface.
 */
function spawnGate(state: GatesState, params: WaveParams, simTime: number,
  posX: number, posY: number, headingYaw: number): void {
  const angle = headingYaw + (Math.random() - 0.5) * 2 * SPAWN_ANGLE_VARIANCE;
  let gx = posX + Math.cos(angle) * SPAWN_DIST;
  let gy = posY + Math.sin(angle) * SPAWN_DIST;
  const limit = params.gridExtent - 4;
  gx = Math.max(-limit, Math.min(limit, gx));
  gy = Math.max(-limit, Math.min(limit, gy));
  const gz = surfaceZ(gx, gy, params, simTime);

  const { ring, glow } = makeRing();
  ring.position.set(gx, gy, gz + 0.5);
  glow.position.set(gx, gy, gz + 0.5);
  // Stand the rings vertically — torus default lies in XY, rotate around X to face up
  ring.rotation.x = Math.PI / 2;
  glow.rotation.x = Math.PI / 2;
  state.scene.add(ring);
  state.scene.add(glow);

  state.gates.push({ alive: true, age: 0, worldX: gx, worldY: gy, ring, glow });
}

/**
 * Tick the gate field — pulse the rings, follow the wave surface,
 * cull expired gates, and spawn new ones if the field is below the cap.
 *
 * Returns the indexes of any gates the surfer just passed through; caller
 * is responsible for awarding points and triggering effects, then calling
 * removeGate(state, idx) for each.
 */
export function updateGates(
  state: GatesState, params: WaveParams, simTime: number, dt: number,
  posX: number, posY: number, posZ: number, headingYaw: number,
): number[] {
  state.spawnCooldown = Math.max(0, state.spawnCooldown - dt);

  // Update existing gates: bob with the wave, pulse the glow
  for (const g of state.gates) {
    if (!g.alive) continue;
    g.age += dt;
    const z = surfaceZ(g.worldX, g.worldY, params, simTime);
    g.ring.position.z = z + 0.5;
    g.glow.position.z = z + 0.5;
    const pulse = 0.7 + 0.3 * Math.sin(simTime * 4 + g.worldX * 0.3);
    (g.glow.material as THREE.MeshBasicMaterial).opacity = 0.10 + 0.18 * pulse;
    const scale = 1 + 0.05 * Math.sin(simTime * 6 + g.worldY * 0.5);
    g.ring.scale.setScalar(scale);
    g.glow.scale.setScalar(scale * 1.05);
  }

  // Cull expired
  const expired: number[] = [];
  for (let i = state.gates.length - 1; i >= 0; i--) {
    if (state.gates[i].age >= RING_LIFE_S) expired.push(i);
  }
  for (const i of expired) {
    disposeGate(state.gates[i], state.scene);
    state.gates.splice(i, 1);
  }

  // Hit detection — gate clears
  const cleared: number[] = [];
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    const dx = posX - g.worldX;
    const dy = posY - g.worldY;
    const dz = posZ - g.ring.position.z;
    const distXY = Math.sqrt(dx * dx + dy * dy);
    if (distXY < HIT_RADIUS && Math.abs(dz) < 2.5) {
      cleared.push(i);
    }
  }

  // Top up to MAX_ACTIVE
  if (state.gates.length < MAX_ACTIVE && state.spawnCooldown <= 0) {
    spawnGate(state, params, simTime, posX, posY, headingYaw);
    state.spawnCooldown = 0.25;
  }

  void posZ; // posZ used in hit detection above
  return cleared;
}

/** Remove a gate (e.g. after it was cleared). Returns its world position. */
export function removeGate(state: GatesState, idx: number): { x: number; y: number; z: number } | null {
  const g = state.gates[idx];
  if (!g) return null;
  const out = { x: g.worldX, y: g.worldY, z: g.ring.position.z };
  disposeGate(g, state.scene);
  state.gates.splice(idx, 1);
  return out;
}
