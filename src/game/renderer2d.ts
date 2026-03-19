/**
 * 2D pixel art game renderer.
 *
 * Internal resolution: 480×270 (upscaled via CSS, image-rendering: pixelated).
 * The camera follows the surfer — worldX of the player is the horizontal center.
 *
 * Coordinate mapping:
 *   PIXELS_PER_UNIT = 40
 *   CANVAS_W = 480, CANVAS_H = 270
 *   HORIZON_Y = 140   (screen y for worldZ = 0, i.e. still water level)
 *
 *   screenX(worldX) = CANVAS_W/2 + (worldX − cameraX) * PIXELS_PER_UNIT
 *   screenY(worldZ) = HORIZON_Y  − worldZ * PIXELS_PER_UNIT
 *
 * Layer order (back to front):
 *   1. Sky background (#1E0A3C fallback or sky_background.png)
 *   2. Wave body (trochoidal parametric curve)
 *   3. Ocean floor line
 *   4. Surfer sprite
 */

import { sampleSurface2D } from '../math/trochoidal';
import type { WaveParams, PlayerState } from '../types';

// ---- Coordinate constants ----
const CANVAS_W      = 480;
const CANVAS_H      = 270;
const PPU           = 40;           // pixels per world unit
const HORIZON_Y     = 155;          // screen y for worldZ = 0 (still water)
const WAVE_SAMPLES  = 120;          // θ samples for drawing the trochoidal curve

// ---- Canvas context ----
let ctx: CanvasRenderingContext2D;
let surferFront: HTMLImageElement | null = null;
let surferBack:  HTMLImageElement | null = null;

function screenX(worldX: number, cameraX: number): number {
  return CANVAS_W / 2 + (worldX - cameraX) * PPU;
}

function screenY(worldZ: number): number {
  return HORIZON_Y - worldZ * PPU;
}

function loadImage(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

/**
 * Initialize the renderer on the given canvas.
 * Assets load asynchronously — game is immediately playable with fallbacks.
 */
export function initRenderer(canvas: HTMLCanvasElement): void {
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  const c = canvas.getContext('2d');
  if (!c) throw new Error('Failed to get 2D canvas context');
  ctx = c;
  ctx.imageSmoothingEnabled = false;

  surferFront = loadImage(new URL('../assets/surfer_sprite_front.png', import.meta.url).href);
  surferBack  = loadImage(new URL('../assets/surfer_sprite_back.png',  import.meta.url).href);
}

/**
 * Draw one frame of the game.
 * @param params   — current wave params (for trochoidal sampling)
 * @param player   — current player state
 * @param simTime  — current simulation time
 */
export function drawFrame(
  params: WaveParams,
  player: PlayerState,
  simTime: number
): void {
  const cameraX  = player.worldX;
  const halfW    = (CANVAS_W / 2) / PPU + 2;  // world units half-width of view + margin

  // ---- Layer 1: Sky background ----
  ctx.fillStyle = '#1E0A3C';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ---- Layer 2: Wave body ----
  // Sample the parametric trochoidal surface
  const wavePts = sampleSurface2D(params, simTime, cameraX, halfW, WAVE_SAMPLES);
  const floorY  = screenY(0);

  if (wavePts.length > 1) {
    // a. Primary wave body fill (#1A4A9F) — from crest down to z=0 floor
    ctx.beginPath();
    ctx.moveTo(screenX(wavePts[0][0], cameraX), screenY(wavePts[0][1]));
    for (let i = 1; i < wavePts.length; i++) {
      ctx.lineTo(screenX(wavePts[i][0], cameraX), screenY(wavePts[i][1]));
    }
    ctx.lineTo(screenX(wavePts[wavePts.length - 1][0], cameraX), floorY);
    ctx.lineTo(screenX(wavePts[0][0], cameraX), floorY);
    ctx.closePath();
    ctx.fillStyle = '#1A4A9F';
    ctx.fill();

    // b. Depth stripe (#0F2A6E) — offset crest down 8px for layered depth look
    ctx.beginPath();
    ctx.moveTo(screenX(wavePts[0][0], cameraX), screenY(wavePts[0][1]) + 8);
    for (let i = 1; i < wavePts.length; i++) {
      ctx.lineTo(screenX(wavePts[i][0], cameraX), screenY(wavePts[i][1]) + 8);
    }
    ctx.lineTo(screenX(wavePts[wavePts.length - 1][0], cameraX), floorY);
    ctx.lineTo(screenX(wavePts[0][0], cameraX), floorY);
    ctx.closePath();
    ctx.fillStyle = '#0F2A6E';
    ctx.fill();

    // c. Crest stroke (#5299DC)
    ctx.beginPath();
    ctx.moveTo(screenX(wavePts[0][0], cameraX), screenY(wavePts[0][1]));
    for (let i = 1; i < wavePts.length; i++) {
      ctx.lineTo(screenX(wavePts[i][0], cameraX), screenY(wavePts[i][1]));
    }
    ctx.strokeStyle = '#5299DC';
    ctx.lineWidth = 1;
    ctx.stroke();

    // d. Foam dots along the crest
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < wavePts.length; i += 2) {
      const sx = screenX(wavePts[i][0], cameraX);
      const sy = screenY(wavePts[i][1]);
      if (sx >= 0 && sx <= CANVAS_W && Math.sin(sx * 0.7 + simTime * 2) > 0.6) {
        ctx.fillRect(Math.round(sx), Math.round(sy), 2, 1);
      }
    }
  }

  // ---- Layer 3: Ocean floor line (z = 0) ----
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(CANVAS_W, floorY);
  ctx.strokeStyle = '#2E70C8';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ---- Layer 4: Surfer sprite ----
  const px = Math.round(screenX(player.worldX, cameraX) - 8);
  const py = Math.round(screenY(player.worldZ) - 24);

  const sprite = player.vx < 0 ? surferBack : surferFront;
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    ctx.drawImage(sprite, px, py, 16, 24);
  } else {
    ctx.fillStyle = '#FFD060';
    ctx.fillRect(px + 4, py + 4, 8, 16);
  }
}
