/**
 * Visualizer page entry point.
 *
 * Connects: loadParams → renderer3d → uiControls → animation loop.
 * Pre-allocates the surface buffer once; reuses it every frame.
 *
 * === Causal epoch model ===
 *
 * Both wave sources (wave1 and wave2) maintain a timeline of "epochs" — parameter
 * snapshots. Each epoch's wavefront expands from its origin at phase velocity c.
 * At any grid point, the newest epoch whose wavefront has reached it determines
 * the wave value. Already-emitted wavefronts keep their original parameters.
 *
 * This means changing amplitude, wavelength, origin, etc. only affects newly
 * emitted waves — old rings propagate undisturbed until overtaken.
 */

import { loadParams, saveParams } from '../store/params';
import { sampleSurface } from '../math/sampler';
import { init, update, updateGamePlane, updateOriginMarkers, updateWallMarker, render } from './renderer3d';
import { enterGameMode, exitGameMode, isGameModeActive, updateGameMode, respawnPlayer } from './gameMode';
import { initControls, initTimeControl } from './uiControls';
import type { WaveParams } from '../types';

let params: WaveParams = loadParams();
let simTime = 0;
let lastTimestamp = 0;

// Pre-allocated surface buffer — max gridRes 200 × 200 × 3 floats
const surfaceBuffer = new Float32Array(200 * 200 * 3);

// ---------------------------------------------------------------------------
// Causal epoch model
// ---------------------------------------------------------------------------

const G = 9.81;
const MIN_EPOCH_GAP = 0.05; // min simTime seconds between epochs (coalesces rapid slider drags)
const MAX_EPOCHS = 100;      // hard cap per wave source

/**
 * A snapshot of wave parameters active during a time interval.
 * The wavefront expands from (originX, originY) starting at startTime.
 * Points beyond the wavefront see no contribution from this epoch.
 */
type WaveEpoch = {
  startTime: number;
  originX: number;
  originY: number;
  amplitude: number;
  k: number;       // 2π / wavelength
  omega: number;   // speedFactor * √(g·k)
  c: number;       // ω / k (phase velocity)
  enabled: boolean; // false = "silence" epoch (wave turning off)
};

/**
 * Wall epoch — tracks wall state changes. The activation front is planar,
 * propagating from x = gridExtent inward at wave1's phase velocity.
 * Distance metric: perpendicular distance to wall = gridExtent - x.
 */
type WallEpoch = {
  startTime: number;
  enabled: boolean;
  reflection: number;  // 0–1
  c: number;           // propagation speed (wave1's phase velocity at time of change)
  smooth: number;      // transition width (half of wave1's wavelength)
};

// Stored newest-first. Index 0 = most recent epoch.
let wave1Epochs: WaveEpoch[] = [];
let wave2Epochs: WaveEpoch[] = [];
let wallEpochs: WallEpoch[] = [];

/** Wave1 params that trigger a new epoch when changed. */
const WAVE1_KEYS: (keyof WaveParams)[] = ['amplitude', 'wavelength', 'speedFactor'];
/** Wave2 params that trigger a new epoch when changed. */
const WAVE2_KEYS: (keyof WaveParams)[] = [
  'wave2Enabled', 'wave2OriginX', 'wave2OriginY',
  'wave2Amplitude', 'wave2Wavelength', 'wave2SpeedFactor',
];
/** Wall params that trigger a new wall epoch when changed. */
const WALL_KEYS: (keyof WaveParams)[] = ['wallEnabled', 'wallReflection'];

function wave1Changed(a: WaveParams, b: WaveParams): boolean {
  return WAVE1_KEYS.some(k => a[k] !== b[k]);
}
function wave2Changed(a: WaveParams, b: WaveParams): boolean {
  return WAVE2_KEYS.some(k => a[k] !== b[k]);
}
function wallChanged(a: WaveParams, b: WaveParams): boolean {
  return WALL_KEYS.some(k => a[k] !== b[k]);
}

function makeWave1Epoch(startTime: number, p: WaveParams): WaveEpoch {
  const k = (2 * Math.PI) / Math.max(p.wavelength, 0.01);
  const omega = p.speedFactor * Math.sqrt(G * k);
  return { startTime, originX: 0, originY: 0, amplitude: p.amplitude, k, omega, c: omega / k, enabled: true };
}

function makeWave2Epoch(startTime: number, p: WaveParams): WaveEpoch {
  const k = (2 * Math.PI) / Math.max(p.wave2Wavelength, 0.01);
  const omega = p.wave2SpeedFactor * Math.sqrt(G * k);
  return {
    startTime, originX: p.wave2OriginX, originY: p.wave2OriginY,
    amplitude: p.wave2Amplitude, k, omega, c: omega / k, enabled: p.wave2Enabled,
  };
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
function pushEpoch(epochs: WaveEpoch[], epoch: WaveEpoch): void {
  if (epochs.length > 0 && epoch.startTime - epochs[0].startTime < MIN_EPOCH_GAP) {
    epochs[0] = epoch; // update in place — too soon for a new ring
    return;
  }
  epochs.unshift(epoch);
  if (epochs.length > MAX_EPOCHS) epochs.length = MAX_EPOCHS;
}

/** Push a wall epoch with the same coalescing logic. */
function pushWallEpoch(epoch: WallEpoch): void {
  if (wallEpochs.length > 0 && epoch.startTime - wallEpochs[0].startTime < MIN_EPOCH_GAP) {
    wallEpochs[0] = epoch;
    return;
  }
  wallEpochs.unshift(epoch);
  if (wallEpochs.length > MAX_EPOCHS) wallEpochs.length = MAX_EPOCHS;
}

/**
 * Remove epochs that are fully superseded (a newer epoch's wavefront covers
 * the entire grid, so no point ever falls through to older epochs).
 */
function pruneEpochs(epochs: WaveEpoch[], t: number, gridDiag: number): void {
  for (let i = 1; i < epochs.length; i++) {
    const newer = epochs[i - 1];
    const smooth = Math.PI / newer.k;
    if (newer.c * (t - newer.startTime) > gridDiag + smooth * 3) {
      epochs.length = i; // epoch i and all older are invisible
      break;
    }
  }
}

/** Sigmoid: 0 outside wavefront, 1 inside, smooth transition over smoothDist. */
function causalAlpha(wavefrontR: number, pointR: number, smoothDist: number): number {
  const progress = (wavefrontR - pointR) / smoothDist;
  return 1 / (1 + Math.exp(-progress * 4));
}

/**
 * Compute the causal wave contribution at (x, y) from an epoch list.
 *
 * Iterates newest-first. The first epoch whose wavefront has firmly reached
 * this point claims it. At wavefront edges, blends with what's behind (older
 * epochs or zero). Recursion depth is bounded by the number of overlapping
 * wavefront edges at one point (typically 1–2).
 */
function computeCausalWave(
  x: number, y: number, t: number,
  epochs: WaveEpoch[], fromIndex: number,
): number {
  for (let i = fromIndex; i < epochs.length; i++) {
    const e = epochs[i];
    const dx = x - e.originX;
    const dy = y - e.originY;
    const r = Math.sqrt(dx * dx + dy * dy);
    const wavefrontR = e.c * (t - e.startTime);
    const smooth = Math.PI / e.k; // half wavelength

    // Wavefront hasn't reached — try older epoch
    if (r > wavefrontR + smooth) continue;

    // Compute this epoch's Z (cycle t to prevent float overflow)
    const period = (2 * Math.PI) / Math.max(e.omega, 0.001);
    const tCycled = t % period;
    const eZ = e.enabled ? e.amplitude * Math.cos(e.k * r - e.omega * tCycled) : 0;

    // Firmly inside this epoch's coverage
    if (r <= wavefrontR - smooth) return eZ;

    // At wavefront edge — blend with what's behind
    const alpha = causalAlpha(wavefrontR, r, smooth);
    const behind = computeCausalWave(x, y, t, epochs, i + 1);
    return alpha * eZ + (1 - alpha) * behind;
  }
  return 0; // no epoch has reached this point
}

/** Prune wall epochs whose newer neighbor's front has crossed the full grid width. */
function pruneWallEpochs(t: number, gridExtent: number): void {
  for (let i = 1; i < wallEpochs.length; i++) {
    const newer = wallEpochs[i - 1];
    if (newer.c * (t - newer.startTime) > 2 * gridExtent + newer.smooth * 3) {
      wallEpochs.length = i;
      break;
    }
  }
}

/**
 * Compute the effective wall reflection coefficient at a given perpendicular
 * distance from the wall. Newest wall epoch whose front has reached this
 * distance wins, with sigmoid blending at the front edge.
 */
function computeWallReflection(
  wallDist: number, t: number, fromIndex: number,
): number {
  for (let i = fromIndex; i < wallEpochs.length; i++) {
    const e = wallEpochs[i];
    const frontDist = e.c * (t - e.startTime);

    if (wallDist > frontDist + e.smooth) continue; // front hasn't reached

    const eRefl = e.enabled ? e.reflection : 0;

    if (wallDist <= frontDist - e.smooth) return eRefl; // firmly inside

    // At the front edge — blend with what's behind
    const alpha = causalAlpha(frontDist, wallDist, e.smooth);
    const behind = computeWallReflection(wallDist, t, i + 1);
    return alpha * eRefl + (1 - alpha) * behind;
  }
  return 0; // no wall epoch reached this point
}

/** True when a single wall epoch covers the full grid width. */
function isWallSteady(t: number, gridExtent: number): boolean {
  if (wallEpochs.length === 0) return true;
  if (wallEpochs.length > 1) return false;
  const e = wallEpochs[0];
  return e.c * (t - e.startTime) > 2 * gridExtent + e.smooth * 3;
}

/**
 * True when an epoch list is in steady state: a single epoch whose wavefront
 * covers the entire grid. In this state the analytical surfaceZ gives the
 * same result, so we can skip the epoch computation (fast path).
 */
function isSteady(epochs: WaveEpoch[], t: number, gridDiag: number): boolean {
  if (epochs.length === 0) return true;
  if (epochs.length > 1) return false;
  const e = epochs[0];
  const smooth = Math.PI / e.k;
  return e.c * (t - e.startTime) > gridDiag + smooth * 3;
}

/**
 * Build a per-point Z override for sampleSurface, or return undefined when
 * all epoch lists are steady and the wall is off (fast path).
 *
 * Wall reflection uses the virtual mirror source technique: evaluate wave
 * epochs at the point mirrored across x = gridExtent. The effective reflection
 * coefficient at each point is determined by wall epochs (planar front
 * propagating from the wall inward).
 */
function makeZOverride(t: number, p: WaveParams): ((x: number, y: number) => number) | undefined {
  const gridDiag = p.gridExtent * Math.SQRT2;

  // Prune old epochs that are fully superseded
  pruneEpochs(wave1Epochs, t, gridDiag);
  pruneEpochs(wave2Epochs, t, gridDiag);
  pruneWallEpochs(t, p.gridExtent);

  const waveSteady = isSteady(wave1Epochs, t, gridDiag) && isSteady(wave2Epochs, t, gridDiag);
  const wSteady = isWallSteady(t, p.gridExtent);
  const wallActive = wallEpochs.length > 0 && wallEpochs[0].enabled && wallEpochs[0].reflection > 0;

  // Fast path: no epoch computation needed, no wall reflection
  if (waveSteady && wSteady && !wallActive) return undefined;

  const wallX = p.gridExtent;

  // When wall is steady, cache the fixed reflection to skip per-point wall epoch lookup
  const steadyRefl = wSteady ? (wallActive ? wallEpochs[0].reflection : 0) : -1;

  return (x: number, y: number): number => {
    let z = computeCausalWave(x, y, t, wave1Epochs, 0)
          + computeCausalWave(x, y, t, wave2Epochs, 0);

    // Wall reflection: per-point coefficient from wall epochs, then mirror source
    const refl = steadyRefl >= 0 ? steadyRefl : computeWallReflection(wallX - x, t, 0);
    if (refl > 0) {
      const mx = 2 * wallX - x;
      z += refl * computeCausalWave(mx, y, t, wave1Epochs, 0);
      z += refl * computeCausalWave(mx, y, t, wave2Epochs, 0);
    }

    return z;
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function main() {
  const canvas = document.getElementById('three-canvas') as HTMLCanvasElement | null;
  const controlsPanel = document.getElementById('controls-panel') as HTMLElement | null;
  const timePanel = document.getElementById('time-panel') as HTMLElement | null;

  if (!canvas || !controlsPanel) {
    console.error('esurf visualizer: missing #three-canvas or #controls-panel');
    return;
  }

  const ok = init(canvas);
  if (!ok) {
    const errEl = document.getElementById('loading-overlay');
    if (errEl) {
      errEl.style.color = '#FF4444';
      errEl.textContent = 'WebGL not available.';
    }
  }

  // Wire SURF button — must be after init() so getCamera/getControls are ready
  const surfBtn = document.getElementById('surf-btn');
  if (surfBtn && ok) {
    surfBtn.addEventListener('click', () => {
      if (isGameModeActive()) exitGameMode();
      else enterGameMode(params, simTime);
    });
  }

  const respawnBtn = document.getElementById('respawn-btn');
  if (respawnBtn) {
    respawnBtn.addEventListener('click', () => respawnPlayer(params, simTime));
  }

  initControls(controlsPanel, params, (newParams: WaveParams) => {
    const mergedParams = { ...newParams, timeScale: params.timeScale };

    if (wave1Changed(params, mergedParams)) {
      pushEpoch(wave1Epochs, makeWave1Epoch(simTime, mergedParams));
    }
    if (wave2Changed(params, mergedParams)) {
      pushEpoch(wave2Epochs, makeWave2Epoch(simTime, mergedParams));
    }
    if (wallChanged(params, mergedParams)) {
      pushWallEpoch(makeWallEpoch(simTime, mergedParams));
    }

    params = mergedParams;
    saveParams(params);

    const zFn = makeZOverride(simTime, params);
    const surface = sampleSurface(params, simTime, surfaceBuffer, zFn);
    update(surface, params.gridRes);
  });

  if (timePanel) {
    initTimeControl(timePanel, params, (newParams: WaveParams) => {
      params = { ...params, timeScale: newParams.timeScale };
      saveParams(params);
    });
  }

  function loop(timestamp: number) {
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
    lastTimestamp = timestamp;

    simTime += dt * params.timeScale;

    const zFn = makeZOverride(simTime, params);
    const surface = sampleSurface(params, simTime, surfaceBuffer, zFn);
    update(surface, params.gridRes);

    if (isGameModeActive()) {
      updateGameMode(params, simTime, dt);
    } else {
      updateGamePlane(params, simTime);
      updateOriginMarkers(params, simTime);
      updateWallMarker(params);
    }

    render();
    requestAnimationFrame(loop);
  }

  // Initialize epoch lists — startTime far in past so waves cover the grid on load
  wave1Epochs = [makeWave1Epoch(-1e6, params)];
  if (params.wave2Enabled) {
    wave2Epochs = [makeWave2Epoch(-1e6, params)];
  }
  if (params.wallEnabled) {
    wallEpochs = [makeWallEpoch(-1e6, params)];
  }

  requestAnimationFrame((ts) => {
    lastTimestamp = ts;
    const zFn = makeZOverride(0, params);
    const surface = sampleSurface(params, 0, surfaceBuffer, zFn);
    update(surface, params.gridRes);
    updateGamePlane(params, 0);
    updateOriginMarkers(params, 0);
    updateWallMarker(params);
    render();
    requestAnimationFrame(loop);
  });
}

main();
