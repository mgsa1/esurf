/**
 * Gates — glowing rings placed on the wave face, down the line from the
 * surfer. They live in wave coordinates (crest n, phase psi, crest-distance s)
 * so they travel with their wave. Each gate asks for a line:
 *
 *   LOW   — bottom of the face (drop in hard)
 *   MID   — trim line
 *   HIGH  — just under the lip
 *   AIR   — above the lip; you have to launch through it
 *
 * Clearing one = score + combo bump. A gate the break catches is swallowed.
 */

import * as THREE from 'three';
import { gameSurfaceZ, worldFromWave, behindPeel } from './breakField';
import type { WaveParams } from '../types';

const MAX_ACTIVE = 3;
const RING_RADIUS = 1.6;
const HIT_RADIUS = 2.1;
const RING_TUBE_RADIUS = 0.18;
const RING_LIFE_S = 14;
const SPAWN_AHEAD_MIN = 26;
const SPAWN_AHEAD_RANGE = 22;
const BEHIND_CULL = 12;            // metres behind the rider (down-line) before a missed gate expires

export type GateKind = 'LOW' | 'MID' | 'HIGH' | 'AIR';

interface GateSpec { psi: number; lift: number; color: number; weight: number }

const KINDS: Record<GateKind, GateSpec> = {
  LOW:  { psi: 1.45, lift: 1.0, color: 0x00FFCC, weight: 3 },
  MID:  { psi: 0.95, lift: 1.0, color: 0x00FFCC, weight: 3 },
  HIGH: { psi: 0.50, lift: 1.0, color: 0xFFB800, weight: 2 },
  AIR:  { psi: 0.30, lift: 4.2, color: 0xFF6EB4, weight: 1 },
};
const KIND_ORDER: GateKind[] = ['LOW', 'MID', 'HIGH', 'AIR'];

interface Gate {
  kind: GateKind;
  age: number;
  n: number;
  psi: number;
  s: number;
  lift: number;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
}

export interface GatesState {
  scene: THREE.Scene;
  gates: Gate[];
  spawnCooldown: number;
}

export interface ClearedGate {
  kind: GateKind;
  x: number;
  y: number;
  z: number;
}

export interface RiderOnWave {
  x: number;
  y: number;
  z: number;
  /** Crest index the rider is on. */
  n: number;
  /** Crest-distance of the rider. */
  s: number;
  /** Down-the-line direction the rider is heading (+1 / −1 along s; 0 = not on a wave, no spawns). */
  lineDir: number;
  tanX: number;
  tanY: number;
}

function makeRing(color: number): { ring: THREE.Mesh; glow: THREE.Mesh } {
  const ringGeo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 8;

  const glowGeo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS * 3, 8, 32);
  const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.20, depthWrite: false, fog: false });
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

function pickKind(): GateKind {
  const total = KIND_ORDER.reduce((a, k) => a + KINDS[k].weight, 0);
  let r = Math.random() * total;
  for (const k of KIND_ORDER) {
    r -= KINDS[k].weight;
    if (r <= 0) return k;
  }
  return 'MID';
}

function spawnGate(state: GatesState, rider: RiderOnWave): void {
  const kind = pickKind();
  const spec = KINDS[kind];
  const s = rider.s + rider.lineDir * (SPAWN_AHEAD_MIN + Math.random() * SPAWN_AHEAD_RANGE);
  const { ring, glow } = makeRing(spec.color);
  state.scene.add(ring);
  state.scene.add(glow);
  state.gates.push({ kind, age: 0, n: rider.n, psi: spec.psi, s, lift: spec.lift, ring, glow });
}

const UP = new THREE.Vector3(0, 0, 1);
const tmpTan = new THREE.Vector3();

/**
 * Tick the gate field: move gates with their wave, cull missed/swallowed
 * ones, detect clears, top up the field. Cleared gates are removed and
 * returned so the caller can award points.
 */
export function updateGates(
  state: GatesState, params: WaveParams, simTime: number, dt: number, rider: RiderOnWave,
): ClearedGate[] {
  state.spawnCooldown = Math.max(0, state.spawnCooldown - dt);
  const cleared: ClearedGate[] = [];
  tmpTan.set(rider.tanX, rider.tanY, 0);

  for (let i = state.gates.length - 1; i >= 0; i--) {
    const g = state.gates[i];
    g.age += dt;

    const { x, y } = worldFromWave(g.n, g.psi, g.s, simTime);
    const z = gameSurfaceZ(x, y, params, simTime) + g.lift;
    g.ring.position.set(x, y, z);
    g.glow.position.set(x, y, z);
    // Ring faces down the line so you ride straight through it
    g.ring.quaternion.setFromUnitVectors(UP, tmpTan);
    g.glow.quaternion.copy(g.ring.quaternion);
    const pulse = 0.7 + 0.3 * Math.sin(simTime * 4 + g.s * 0.3);
    (g.glow.material as THREE.MeshBasicMaterial).opacity = 0.10 + 0.18 * pulse;
    const scale = 1 + 0.05 * Math.sin(simTime * 6 + g.s * 0.5);
    g.ring.scale.setScalar(scale);
    g.glow.scale.setScalar(scale * 1.05);

    // Hit: rider's body centre within the ring
    const dx = rider.x - x;
    const dy = rider.y - y;
    const dz = rider.z + 0.8 - z;
    if (dx * dx + dy * dy + dz * dz < HIT_RADIUS * HIT_RADIUS) {
      cleared.push({ kind: g.kind, x, y, z });
      disposeGate(g, state.scene);
      state.gates.splice(i, 1);
      continue;
    }

    const passed = rider.n === g.n && rider.lineDir * (rider.s - g.s) > BEHIND_CULL;
    const swallowed = behindPeel(g.n, g.s, simTime) > 3;
    if (passed || swallowed || g.age >= RING_LIFE_S || Math.abs(g.n - rider.n) > 1) {
      disposeGate(g, state.scene);
      state.gates.splice(i, 1);
    }
  }

  if (rider.lineDir !== 0 && state.gates.length < MAX_ACTIVE && state.spawnCooldown <= 0) {
    spawnGate(state, rider);
    state.spawnCooldown = 0.6;
  }
  return cleared;
}
