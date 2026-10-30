/**
 * Score, combo, and run state for arcade game mode.
 *
 * - Score accumulates from face riding, tube riding, air time, tricks, and gates.
 * - Combo multiplier (x1 → x2 → x3 → x4 → x6 → x8 → x10) climbs on
 *   trick landings, gate clears, and tube exits. Each bump opens a
 *   COMBO_WINDOW_S window; if it runs out before the next bump, the combo
 *   drops one tier (and keeps draining). Resets on wipeout.
 * - World-space popup floaters (e.g. "+500 GATE!") are tracked here and
 *   rendered by gameMode.ts as billboard sprites.
 */

import * as THREE from 'three';

export type RunState = 'idle' | 'running' | 'ended';

export interface RunSummary {
  score: number;
  topTrick: string;
  tubeTimeS: number;
  gates: number;
  bestTrick: number;
  newBest: boolean;
  prevBest: number;
}

export const COMBO_TIERS = [1, 2, 3, 4, 6, 8, 10];
export const COMBO_WINDOW_S = 4.0;

export const SCORE_RATES = {
  faceRidePerS: 10,
  tubeRidePerS: 80,
  airPerSPerMeter: 50,
  spinPer360: 250,
  flipPer360: 350,
  grabAirBonus: 0.5,           // multiplier on air points while grab held
  cleanLandBase: 200,
  gateClear: 500,
};

export const RUN_DURATION_S = 60;
export const FINAL_WAVE_S = 10;   // last N seconds of the run = double multiplier

// ---- Module state ----

export interface ScoreState {
  runState: RunState;
  timeRemaining: number;
  score: number;
  comboLevel: number;        // index into COMBO_TIERS
  comboFreshness: number;    // 0–1, fraction of the combo window remaining
  bestTrickPoints: number;
  topTrick: string;
  tubeTimeS: number;
  gatesCleared: number;
  finalWaveActive: boolean;
}

export function createScoreState(): ScoreState {
  return {
    runState: 'idle',
    timeRemaining: RUN_DURATION_S,
    score: 0,
    comboLevel: 0,
    comboFreshness: 0,
    bestTrickPoints: 0,
    topTrick: '—',
    tubeTimeS: 0,
    gatesCleared: 0,
    finalWaveActive: false,
  };
}

export function multiplier(s: ScoreState): number {
  const base = COMBO_TIERS[Math.min(s.comboLevel, COMBO_TIERS.length - 1)];
  return s.finalWaveActive ? base * 2 : base;
}

export function startRun(s: ScoreState): void {
  s.runState = 'running';
  s.timeRemaining = RUN_DURATION_S;
  s.score = 0;
  s.comboLevel = 0;
  s.comboFreshness = 0;
  s.bestTrickPoints = 0;
  s.topTrick = '—';
  s.tubeTimeS = 0;
  s.gatesCleared = 0;
  s.finalWaveActive = false;
}

export function endRun(s: ScoreState): void {
  s.runState = 'ended';
}

export function tickRunTimer(s: ScoreState, dt: number): void {
  if (s.runState !== 'running') return;
  s.timeRemaining = Math.max(0, s.timeRemaining - dt);
  s.finalWaveActive = s.timeRemaining <= FINAL_WAVE_S && s.timeRemaining > 0;
}

/** Add raw points multiplied by current combo. Returns awarded amount. */
export function addPoints(s: ScoreState, raw: number): number {
  if (s.runState !== 'running') return 0;
  const m = multiplier(s);
  const awarded = raw * m;
  s.score += awarded;
  return awarded;
}

/** Advance combo by one tier and refresh the window (tier is capped at max). */
export function bumpCombo(s: ScoreState): boolean {
  s.comboFreshness = 1;
  if (s.comboLevel >= COMBO_TIERS.length - 1) return false;
  s.comboLevel++;
  return true;
}

/** Reset combo (wipeout, prolonged paddle). */
export function breakCombo(s: ScoreState): void {
  s.comboLevel = 0;
  s.comboFreshness = 0;
}

/** Drain the combo window; drop one tier each time it empties. */
export function decayCombo(s: ScoreState, dt: number): void {
  if (s.runState !== 'running' || s.comboLevel === 0) return;
  s.comboFreshness -= dt / COMBO_WINDOW_S;
  if (s.comboFreshness <= 0) {
    s.comboLevel--;
    s.comboFreshness = s.comboLevel > 0 ? 1 : 0;
  }
}

export function recordTrick(s: ScoreState, name: string, points: number): void {
  if (points > s.bestTrickPoints) {
    s.bestTrickPoints = points;
    s.topTrick = name;
  }
}

// ============================================================================
// Score popups (world-space "+500" floaters)
// ============================================================================

const MAX_POPUPS = 16;
const POPUP_LIFE_S = 1.4;

export interface ScorePopup {
  alive: boolean;
  age: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  text: string;
  color: string;
  sprite: THREE.Sprite | null;
}

export interface PopupState {
  pool: ScorePopup[];
  scene: THREE.Scene;
  active: number;
}

function makePopupSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(text, 256, 32);
  ctx.fillText(text, 256, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(8, 1, 1);
  sprite.renderOrder = 50;
  return sprite;
}

export function createPopupState(scene: THREE.Scene): PopupState {
  const pool: ScorePopup[] = [];
  for (let i = 0; i < MAX_POPUPS; i++) {
    pool.push({ alive: false, age: 0, worldX: 0, worldY: 0, worldZ: 0, text: '', color: '#ffffff', sprite: null });
  }
  return { pool, scene, active: 0 };
}

export function spawnPopup(p: PopupState, x: number, y: number, z: number, text: string, color: string): void {
  // Find a slot
  let slot = p.pool.find(s => !s.alive);
  if (!slot) {
    // Recycle the oldest
    slot = p.pool.reduce((a, b) => (a.age > b.age ? a : b));
    if (slot.sprite) {
      p.scene.remove(slot.sprite);
      slot.sprite.material.map?.dispose();
      slot.sprite.material.dispose();
      slot.sprite = null;
    }
  }
  slot.alive = true;
  slot.age = 0;
  slot.worldX = x;
  slot.worldY = y;
  slot.worldZ = z;
  slot.text = text;
  slot.color = color;
  if (slot.sprite) {
    p.scene.remove(slot.sprite);
    slot.sprite.material.map?.dispose();
    slot.sprite.material.dispose();
  }
  slot.sprite = makePopupSprite(text, color);
  slot.sprite.position.set(x, y, z);
  p.scene.add(slot.sprite);
  p.active++;
}

export function updatePopups(p: PopupState, dt: number): void {
  for (const slot of p.pool) {
    if (!slot.alive || !slot.sprite) continue;
    slot.age += dt;
    if (slot.age >= POPUP_LIFE_S) {
      p.scene.remove(slot.sprite);
      slot.sprite.material.map?.dispose();
      slot.sprite.material.dispose();
      slot.sprite = null;
      slot.alive = false;
      p.active = Math.max(0, p.active - 1);
      continue;
    }
    const t = slot.age / POPUP_LIFE_S;
    slot.sprite.position.z = slot.worldZ + t * 4;     // float up
    const fade = 1 - t;
    (slot.sprite.material as THREE.SpriteMaterial).opacity = fade;
    const scale = 4 + t * 1.5;
    slot.sprite.scale.set(scale * 2, scale * 0.25, 1);
  }
}

export function clearPopups(p: PopupState): void {
  for (const slot of p.pool) {
    if (slot.sprite) {
      p.scene.remove(slot.sprite);
      slot.sprite.material.map?.dispose();
      slot.sprite.material.dispose();
      slot.sprite = null;
    }
    slot.alive = false;
    slot.age = 0;
  }
  p.active = 0;
}
