/**
 * Visualizer page entry point.
 *
 * Connects: loadParams → renderer3d → uiControls → animation loop.
 * Pre-allocates the surface buffer once; reuses it every frame.
 */

import { loadParams, saveParams } from '../store/params';
import { sampleSurface } from '../math/sampler';
import { init, update, updateGamePlane, updateOriginMarkers, render } from './renderer3d';
import { initControls, initTimeControl } from './uiControls';
import type { WaveParams } from '../types';

let params: WaveParams = loadParams();
let simTime = 0;
let lastTimestamp = 0;

// Pre-allocated surface buffer — max gridRes 200 × 200 × 3 floats
const surfaceBuffer = new Float32Array(200 * 200 * 3);

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

  initControls(controlsPanel, params, (newParams: WaveParams) => {
    params = { ...newParams, timeScale: params.timeScale };
    saveParams(params);
    const surface = sampleSurface(params, simTime, surfaceBuffer);
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

    const surface = sampleSurface(params, simTime, surfaceBuffer);
    update(surface, params.gridRes);
    updateGamePlane(params, simTime);
    updateOriginMarkers(params, simTime);
    render();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame((ts) => {
    lastTimestamp = ts;
    const surface = sampleSurface(params, 0, surfaceBuffer);
    update(surface, params.gridRes);
    updateGamePlane(params, 0);
    updateOriginMarkers(params, 0);
    render();
    requestAnimationFrame(loop);
  });
}

main();
