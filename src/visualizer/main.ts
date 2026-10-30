/**
 * Visualizer page entry point.
 *
 * Connects: loadParams → renderer3d → uiControls → animation loop.
 * Pre-allocates the surface buffer once; reuses it every frame.
 *
 * Parameter changes propagate as wavefronts (see math/liveSurface.ts): the
 * renderer and the SURF game both read the same live surface.
 */

import { loadParams, saveParams } from '../store/params';
import { sampleSurface } from '../math/sampler';
import { resetLiveSurface, onParamsChanged, prepareLiveSurface, liveZOverride } from '../math/liveSurface';
import { init, update, updateGamePlane, updateOriginMarkers, updateWallMarker, render } from './renderer3d';
import { enterGameMode, exitGameMode, isGameModeActive, updateGameMode, respawnPlayer, restartRun, gameTimeFactor } from './gameMode';
import { getHighScore } from '../game/highscore';
import { initControls, initTimeControl } from './uiControls';
import type { WaveParams } from '../types';

let params: WaveParams = loadParams();
let simTime = 0;
let lastTimestamp = 0;

// Pre-allocated surface buffer — max gridRes 200 × 200 × 3 floats
const surfaceBuffer = new Float32Array(200 * 200 * 3);

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

  const endRestartBtn = document.getElementById('end-restart-btn');
  if (endRestartBtn) {
    endRestartBtn.addEventListener('click', () => restartRun());
  }
  const endExitBtn = document.getElementById('end-exit-btn');
  if (endExitBtn) {
    endExitBtn.addEventListener('click', () => exitGameMode());
  }

  // Wave score-potential + best-score preview in the editor
  function updateWaveBestPreview() {
    const el = document.getElementById('wave-best-display');
    if (!el) return;
    const best = getHighScore(params);
    el.textContent = best > 0 ? `BEST  ${best.toLocaleString()}` : 'NO BEST YET';
    el.style.color = best > 0 ? '#FFB800' : 'rgba(200,200,232,0.4)';
  }
  updateWaveBestPreview();

  initControls(controlsPanel, params, (newParams: WaveParams) => {
    const mergedParams = { ...newParams, timeScale: params.timeScale };

    onParamsChanged(params, mergedParams, simTime);
    params = mergedParams;
    saveParams(params);

    prepareLiveSurface(params, simTime);
    const surface = sampleSurface(params, simTime, surfaceBuffer, liveZOverride(params, simTime));
    update(surface, params.gridRes);
    updateWaveBestPreview();
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

    simTime += dt * params.timeScale * gameTimeFactor();

    prepareLiveSurface(params, simTime);

    if (isGameModeActive()) {
      // SURF mode draws its own endless, breaking ocean around the rider
      updateGameMode(params, simTime, dt);
    } else {
      const surface = sampleSurface(params, simTime, surfaceBuffer, liveZOverride(params, simTime));
      update(surface, params.gridRes);
      updateGamePlane(params, simTime);
      updateOriginMarkers(params, simTime);
      updateWallMarker(params);
    }

    render();
    requestAnimationFrame(loop);
  }

  // Settled ocean on load — waves already cover the grid
  resetLiveSurface(params);

  requestAnimationFrame((ts) => {
    lastTimestamp = ts;
    prepareLiveSurface(params, 0);
    const surface = sampleSurface(params, 0, surfaceBuffer, liveZOverride(params, 0));
    update(surface, params.gridRes);
    updateGamePlane(params, 0);
    updateOriginMarkers(params, 0);
    updateWallMarker(params);
    render();
    requestAnimationFrame(loop);
  });
}

main();
