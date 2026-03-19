/**
 * Visualizer page entry point.
 *
 * Connects: loadParams → renderer3d → uiControls → animation loop.
 * Pre-allocates the surface buffer once; reuses it every frame.
 */

import { loadParams, saveParams } from '../store/params';
import { sampleSurface } from '../math/sampler';
import { wave2PhaseVelocity } from '../math/trochoidal';
import { init, update, updateGamePlane, updateOriginMarkers, render } from './renderer3d';
import { initControls, initTimeControl } from './uiControls';
import type { WaveParams } from '../types';

let params: WaveParams = loadParams();
let simTime = 0;
let lastTimestamp = 0;

// Pre-allocated surface buffer — max gridRes 200 × 200 × 3 floats
const surfaceBuffer = new Float32Array(200 * 200 * 3);

type Wave2PropState = {
  toggleTime: number;   // simTime when toggle fired
  turningOn: boolean;   // true = fade in, false = fade out
  ox: number;           // wave2OriginX at time of toggle
  oy: number;           // wave2OriginY at time of toggle
  c: number;            // phase velocity ω/k
  wavelength: number;   // wave2Wavelength (sets smoothing width)
  gridExtent: number;   // grid half-size (for auto-complete check)
};
let propState: Wave2PropState | null = null;

/**
 * Returns a per-point wave2 alpha function for the current frame, or undefined
 * when no propagation is active (fast path).
 *
 * The wavefront travels at speed c from (ox, oy). Each point transitions via a
 * sigmoid centered at the moment the front arrives, spread over half a wavelength.
 */
function makeAlphaFn(t: number): ((x: number, y: number) => number) | undefined {
  if (propState === null) return undefined;

  const { toggleTime, turningOn, ox, oy, c, wavelength, gridExtent } = propState;
  const wavefrontR = (t - toggleTime) * c;
  const smoothDist = wavelength * 0.5;

  // Auto-complete: wavefront has crossed the entire grid with margin for sigmoid tail
  if (wavefrontR > gridExtent * Math.SQRT2 + smoothDist * 3) {
    propState = null;
    return undefined;
  }

  return (x: number, y: number): number => {
    const dx = x - ox;
    const dy = y - oy;
    const r = Math.sqrt(dx * dx + dy * dy);
    const progress = (wavefrontR - r) / smoothDist;
    const sigmoid = 1 / (1 + Math.exp(-progress * 4));
    return turningOn ? sigmoid : 1 - sigmoid;
  };
}

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
    const wave2Toggled = newParams.wave2Enabled !== params.wave2Enabled;
    const mergedParams = { ...newParams, timeScale: params.timeScale };

    if (wave2Toggled) {
      propState = {
        toggleTime: simTime,
        turningOn: newParams.wave2Enabled,
        ox: newParams.wave2OriginX,
        oy: newParams.wave2OriginY,
        c: wave2PhaseVelocity(newParams),
        wavelength: newParams.wave2Wavelength,
        gridExtent: newParams.gridExtent,
      };
    }

    params = mergedParams;
    saveParams(params);

    // When fading out, keep wave2Enabled true so wave2Z computes the cosine value;
    // the alpha envelope reduces it to zero at each point over time.
    const renderParams = (propState !== null && !params.wave2Enabled)
      ? { ...params, wave2Enabled: true }
      : params;
    const alphaFn = makeAlphaFn(simTime);
    const surface = sampleSurface(renderParams, simTime, surfaceBuffer, alphaFn);
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

    const alphaFn = makeAlphaFn(simTime);
    const renderParams = (propState !== null && !params.wave2Enabled)
      ? { ...params, wave2Enabled: true }
      : params;
    const surface = sampleSurface(renderParams, simTime, surfaceBuffer, alphaFn);
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
