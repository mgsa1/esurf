/**
 * Game page entry point.
 *
 * Loop: compute dt → advance simTime → update player physics → draw frame.
 * Params are loaded from localStorage (written by the visualizer) on startup.
 */

import { loadParams } from '../store/params';
import { surfaceZ } from '../math/trochoidal';
import { initRenderer, drawFrame, getViewHalfW } from './renderer2d';
import { PlayerController } from './player';
import { initControls, getInput } from './controls';
import type { WaveParams } from '../types';

let params: WaveParams = loadParams();
let simTime = 0;
let lastTimestamp = 0;

function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('esurf: missing #game-canvas');
    return;
  }

  initRenderer(canvas);
  initControls();

  // Camera is fixed at wavelength × 1.5 — slopes are 0.93–1.08 across the entire
  // visible window (vs 0.30 at wavelength × 0.25). This is where the physics feel fun.
  const D         = params.planeOffset ?? 0;
  const CAMERA_X  = params.wavelength * 1.5;
  const SPRITE_MARGIN = 0.3;  // world units — keeps sprite fully inside the view
  const startX    = CAMERA_X;
  const startZ    = Math.max(surfaceZ(startX, D, params, 0), 0);  // floor guard at t=0
  const player    = new PlayerController(startX, startZ);

  function loop(timestamp: number) {
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
    lastTimestamp = timestamp;

    simTime += dt * params.timeScale;

    const viewHalfW = getViewHalfW(params);
    player.update(
      params, simTime, getInput(), dt,
      CAMERA_X - viewHalfW + SPRITE_MARGIN,
      CAMERA_X + viewHalfW - SPRITE_MARGIN
    );
    drawFrame(params, player.getState(), simTime, CAMERA_X);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame((ts) => {
    lastTimestamp = ts;
    requestAnimationFrame(loop);
  });
}

main();
