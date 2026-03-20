/**
 * 2D pixel art game renderer.
 *
 * Internal resolution: 480×270 (upscaled via CSS, image-rendering: pixelated).
 * The camera is FIXED in world space — cameraX is passed in and never changes.
 * Waves roll through the frame; the surfer moves within the fixed view.
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
 *   3. Foam on steep wave sections
 *   4. Ocean floor line
 *   5. Surfer sprite
 */

import { sampleSurface2D } from '../math/trochoidal';
import type { WaveParams, PlayerState } from '../types';

// ---- Coordinate constants ----
const CANVAS_W      = 480;
const CANVAS_H      = 270;
const HORIZON_Y     = 155;          // screen y for worldZ = 0 (still water / ocean floor)
const WAVE_TOP_PAD  = 20;           // px of breathing room above the wave crest
const DEFAULT_PPU   = 40;           // pixels per world unit at default amplitude — never exceeded
const PPU_MIN       = 10;           // safety floor for extreme amplitudes
const WAVE_SAMPLES  = 120;          // x samples for drawing the trochoidal curve

/** Slope magnitude above which foam appears (steep / breaking wave sections). */
const FOAM_SLOPE_THRESHOLD = 0.85;

/**
 * Compute pixels-per-world-unit so the tallest possible wave crest fits on screen.
 * maxAmplitude = wave1.amplitude + wave2.amplitude (if enabled).
 * Surfer appears smaller for large-amplitude waves — intentional per design.
 */
function computePPU(params: WaveParams): number {
  const maxAmp = params.amplitude + (params.wave2Enabled ? params.wave2Amplitude : 0);
  return Math.max(PPU_MIN, Math.min(DEFAULT_PPU, (HORIZON_Y - WAVE_TOP_PAD) / Math.max(maxAmp, 0.5)));
}

/**
 * Half-width of the camera view in world units at the current wave scale.
 * Call each frame in main.ts to recompute player bounds when params change.
 */
export function getViewHalfW(params: WaveParams): number {
  return (CANVAS_W / 2) / computePPU(params);
}

// ---- Canvas context ----
let ctx: CanvasRenderingContext2D;
let surferFront: HTMLImageElement | null = null;
let surferBack:  HTMLImageElement | null = null;

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
 * @param cameraX  — fixed world-space X that the camera is centered on (never changes)
 */
export function drawFrame(
  params: WaveParams,
  player: PlayerState,
  simTime: number,
  cameraX: number
): void {
  // Dynamic scale: PPU adapts to wave amplitude so the full crest always fits on screen.
  const ppu   = computePPU(params);
  const halfW = getViewHalfW(params) + 2;  // sample a little beyond the edges

  // Local coordinate helpers — capture ppu and cameraX for this frame.
  const sX = (worldX: number) => CANVAS_W / 2 + (worldX - cameraX) * ppu;
  const sY = (worldZ: number) => HORIZON_Y - worldZ * ppu;
  // Clamp wave z to ocean floor: troughs below z=0 are invisible.
  const crZ = (z: number) => Math.max(z, 0);

  // ---- Layer 1: Sky background ----
  ctx.fillStyle = '#1E0A3C';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ---- Layer 2: Wave body ----
  const wavePts = sampleSurface2D(params, simTime, cameraX, halfW, WAVE_SAMPLES);
  const floorY  = sY(0);

  if (wavePts.length > 1) {
    // a. Primary wave body fill (#1A4A9F) — from crest down to z=0 floor
    ctx.beginPath();
    ctx.moveTo(sX(wavePts[0][0]), sY(crZ(wavePts[0][1])));
    for (let i = 1; i < wavePts.length; i++) {
      ctx.lineTo(sX(wavePts[i][0]), sY(crZ(wavePts[i][1])));
    }
    ctx.lineTo(sX(wavePts[wavePts.length - 1][0]), floorY);
    ctx.lineTo(sX(wavePts[0][0]), floorY);
    ctx.closePath();
    ctx.fillStyle = '#1A4A9F';
    ctx.fill();

    // b. Depth stripe (#0F2A6E) — offset crest down 8px for layered depth look
    ctx.beginPath();
    ctx.moveTo(sX(wavePts[0][0]), sY(crZ(wavePts[0][1])) + 8);
    for (let i = 1; i < wavePts.length; i++) {
      ctx.lineTo(sX(wavePts[i][0]), sY(crZ(wavePts[i][1])) + 8);
    }
    ctx.lineTo(sX(wavePts[wavePts.length - 1][0]), floorY);
    ctx.lineTo(sX(wavePts[0][0]), floorY);
    ctx.closePath();
    ctx.fillStyle = '#0F2A6E';
    ctx.fill();

    // c. Crest stroke (#5299DC)
    ctx.beginPath();
    ctx.moveTo(sX(wavePts[0][0]), sY(crZ(wavePts[0][1])));
    for (let i = 1; i < wavePts.length; i++) {
      ctx.lineTo(sX(wavePts[i][0]), sY(crZ(wavePts[i][1])));
    }
    ctx.strokeStyle = '#5299DC';
    ctx.lineWidth = 1;
    ctx.stroke();

    // d. Foam on steep wave sections — animated white dots above the crest.
    //    Only drawn where the surface is above z=0. Serves as future tube-zone indicator.
    for (let i = 1; i < wavePts.length - 1; i++) {
      if (wavePts[i][1] <= 0) continue;
      const dx = wavePts[i + 1][0] - wavePts[i - 1][0];
      const dz = wavePts[i + 1][1] - wavePts[i - 1][1];
      const slope = dx > 1e-6 ? dz / dx : 0;
      if (Math.abs(slope) > FOAM_SLOPE_THRESHOLD) {
        const sx = sX(wavePts[i][0]);
        const sy = sY(wavePts[i][1]);
        for (let j = 0; j < 3; j++) {
          const alpha = 0.55 + 0.45 * Math.sin(sx * 0.4 + simTime * 5 + j * 2.1);
          ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
          ctx.fillRect(Math.round(sx + (j - 1) * 3), Math.round(sy - 1 - j), 2, 1);
        }
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
  // While grinding, the surfer crouches low on the lip — shift the sprite down
  // by 6px and squash the height to 16px to suggest the low crouch position.
  const grindOffset = player.isGrinding ? 6 : 0;
  const spriteH     = player.isGrinding ? 16 : 24;
  const px = Math.round(sX(player.worldX) - 8);
  const py = Math.round(sY(player.worldZ) - spriteH + grindOffset);

  const sprite = player.vx < 0 ? surferBack : surferFront;
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    ctx.drawImage(sprite, px, py, 16, spriteH);
  } else {
    ctx.fillStyle = player.isGrinding ? '#FF8800' : '#FFD060';
    ctx.fillRect(px + 4, py + 4, 8, spriteH - 8);
  }
}
