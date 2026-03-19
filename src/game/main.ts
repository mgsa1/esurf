/**
 * Game page entry point.
 *
 * Loop: compute dt → advance simTime → update player physics → draw frame.
 * Params are loaded from localStorage (written by the visualizer) on startup.
 */

import { loadParams } from '../store/params';
import { surfaceZ } from '../math/trochoidal';
import { initRenderer, drawFrame } from './renderer2d';
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

  // Start on the downslope of a crest — surfer immediately feels slope gravity
  const D      = params.planeOffset ?? 0;
  const startX = params.wavelength * 0.25;
  const startZ = surfaceZ(startX, D, params, 0);
  const player = new PlayerController(startX, startZ);

  function loop(timestamp: number) {
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
    lastTimestamp = timestamp;

    simTime += dt * params.timeScale;

    player.update(params, simTime, getInput(), dt);
    drawFrame(params, player.getState(), simTime);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame((ts) => {
    lastTimestamp = ts;
    requestAnimationFrame(loop);
  });
}

main();
