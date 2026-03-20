/**
 * Player controller — half-pipe surf physics.
 *
 * The wave surface is a dynamic floor. The surfer cannot go below it.
 * Slope gravity is the primary engine: the surfer accelerates down wave faces
 * and decelerates going up, converting kinetic ↔ potential energy like a
 * skateboarder in a half-pipe. Wave lift (surfaceZdot) provides upward energy
 * as crests rise under the surfer.
 *
 * Three states:
 *   onSurface = true,  isGrinding = false — slope-based gravity drives lateral motion.
 *                                           Controls provide a small weight-shift lean.
 *   onSurface = true,  isGrinding = true  — surfer is locked to a wave crest (lip slide).
 *                                           High friction bleeds horizontal speed.
 *   onSurface = false, isGrinding = false — airborne. Only gravity (az = −g).
 *                                           Lands when worldZ falls back to the wave.
 *
 * Arrow keys provide weight-shift lean (small slope offset), not engine thrust.
 * Speed builds naturally by riding down wave faces.
 */

import { surfaceZ, surfaceSlope, surfaceZdot } from '../math/trochoidal';
import type { WaveParams, PlayerState } from '../types';

const G                  = 9.81;
const LEAN_SLOPE_OFFSET  = 0.20;   // dimensionless — weight-shift lean adds to effective slope
const AIR_LEAN           = 0.6;    // m/s² — subtle horizontal steering in the air
const MAX_VX             = 18;     // world units/s — horizontal speed cap
const MAX_VZ             = 20;     // world units/s — vertical speed cap
const SURFACE_DRAG       = 0.97;   // velocity multiplier/s on surface
const AIR_DRAG           = 0.99;   // velocity multiplier/s in air
// Auto-launch: fast surfer on a rapidly-rising crest is tossed airborne by the wave
const WAVE_LAUNCH_ZDOT   = 2.5;    // m/s — wave must be rising at least this fast
const WAVE_LAUNCH_VX_MIN = 3.0;    // m/s — surfer must be moving at least this fast
// Grind (lip slide): surfer locks to the wave crest and slides along the ridge
const CREST_SLOPE_THRESH = 0.12;   // |slope| below this → potentially at a crest or trough
const GRIND_MIN_SPEED    = 1.5;    // m/s — minimum |vx| to enter a grind
const GRIND_EXIT_SPEED   = 0.3;    // m/s — |vx| below this → exit grind, resume riding
const GRIND_FRICTION     = 0.85;   // velocity multiplier/s while grinding (heavy deceleration)
const SLOPE_EPS          = 0.05;   // world-unit offset for second-derivative approximation

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Approximate the second spatial derivative of the wave surface at worldX.
 * d²z/dx² ≈ (slope(x+ε) − slope(x−ε)) / (2ε)
 * Negative → concave-down → crest (local maximum).
 * Positive → concave-up  → trough (local minimum).
 */
function surfaceSecondDeriv(worldX: number, D: number, params: WaveParams, t: number): number {
  const sRight = surfaceSlope(worldX + SLOPE_EPS, D, params, t);
  const sLeft  = surfaceSlope(worldX - SLOPE_EPS, D, params, t);
  return (sRight - sLeft) / (2 * SLOPE_EPS);
}

export class PlayerController {
  private state: PlayerState;

  constructor(initialX: number, initialZ: number) {
    this.state = { worldX: initialX, worldZ: initialZ, vx: 0, vz: 0, onSurface: true, isGrinding: false };
  }

  /**
   * Advance physics by one frame.
   *
   * @param minX  Left boundary (world units) — surfer cannot go further left.
   * @param maxX  Right boundary (world units) — surfer cannot go further right.
   *              Pass CAMERA_X ± (VIEW_HALF_W − SPRITE_MARGIN) from main.ts.
   */
  update(
    params: WaveParams,
    simTime: number,
    input: { left: boolean; right: boolean; jump: boolean },
    dt: number,
    minX: number,
    maxX: number
  ): void {
    const { worldX, worldZ, vx, vz } = this.state;
    const D = params.planeOffset ?? 0;

    const sz = surfaceZ(worldX, D, params, simTime);
    const inContact = worldZ <= sz + 0.01;  // small tolerance to avoid jitter

    if (inContact) {
      // ---- On-surface mode ----
      const slope = surfaceSlope(worldX, D, params, simTime);

      // Weight-shift lean: left/right key adds a small offset to the effective slope.
      // This shifts the board angle slightly, like leaning your body over the rail.
      const leanDir        = input.left ? -1 : input.right ? 1 : 0;
      const effectiveSlope = slope + LEAN_SLOPE_OFFSET * leanDir;
      const norm           = Math.sqrt(1 + effectiveSlope * effectiveSlope);
      const ax             = -G * effectiveSlope / norm;

      // Integrate horizontal velocity with surface friction
      let nvx = (vx + ax * dt) * Math.pow(SURFACE_DRAG, dt);
      nvx = clamp(nvx, -MAX_VX, MAX_VX);

      // Advance position, then clamp to camera bounds.
      // Directional clamp: only zero the velocity component pushing into the wall.
      let nx = worldX + nvx * dt;
      if (nx < minX) { nx = minX; nvx = Math.max(nvx, 0); }
      if (nx > maxX) { nx = maxX; nvx = Math.min(nvx, 0); }

      // Floor at z=0 — wave surface can dip below still water; ocean floor does not.
      const nz = Math.max(surfaceZ(nx, D, params, simTime), 0);

      // Wave lift at new position — used for auto-launch and jump impulse.
      const waveLift = surfaceZdot(nx, D, params, simTime);

      if (input.jump) {
        // Space: speed-scaled jump impulse (fast surfer jumps much higher).
        const jumpImpulse = Math.min(5 + Math.abs(nvx) * 0.35, 11);
        const nvz = clamp(waveLift + jumpImpulse, 0, MAX_VZ);
        this.state = { worldX: nx, worldZ: nz, vx: nvx, vz: nvz, onSurface: false, isGrinding: false };
        return;
      }

      // Crest detection: |slope| ≈ 0 AND concave-down (second derivative < 0).
      // This cleanly distinguishes crests (local maxima) from troughs (local minima, secondDeriv > 0).
      const secondDeriv = surfaceSecondDeriv(nx, D, params, simTime);
      const isAtCrest   = Math.abs(slope) < CREST_SLOPE_THRESH && secondDeriv < 0;

      if (isAtCrest && Math.abs(nvx) > GRIND_MIN_SPEED) {
        // ---- Grind (lip slide) ----
        // Lock to crest, bleed horizontal speed with heavy friction.
        const gvx = clamp(nvx * Math.pow(GRIND_FRICTION, dt), -MAX_VX, MAX_VX);
        const gvz = waveLift;  // ride vertically with the moving crest
        if (Math.abs(gvx) < GRIND_EXIT_SPEED) {
          // Speed bled off — drop back to normal surface riding.
          this.state = { worldX: nx, worldZ: nz, vx: gvx, vz: gvz, onSurface: true, isGrinding: false };
        } else {
          this.state = { worldX: nx, worldZ: nz, vx: gvx, vz: gvz, onSurface: true, isGrinding: true };
        }
      } else if (waveLift > WAVE_LAUNCH_ZDOT && Math.abs(nvx) > WAVE_LAUNCH_VX_MIN) {
        // Auto-launch: wave rising fast + surfer moving fast → wave tosses surfer airborne.
        this.state = { worldX: nx, worldZ: nz, vx: nvx, vz: clamp(waveLift, 0, MAX_VZ), onSurface: false, isGrinding: false };
      } else {
        // Riding the surface: carry wave's vertical velocity for smooth transitions.
        this.state = { worldX: nx, worldZ: nz, vx: nvx, vz: waveLift, onSurface: true, isGrinding: false };
      }

    } else {
      // ---- Airborne mode ----
      const ax  = (input.left  ? -AIR_LEAN : 0)
                + (input.right ?  AIR_LEAN : 0);

      let nvz = clamp(vz - G * dt, -MAX_VZ, MAX_VZ);
      let nvx = clamp((vx + ax * dt) * Math.pow(AIR_DRAG, dt), -MAX_VX, MAX_VX);

      let nx = worldX + nvx * dt;
      let nz = worldZ + nvz * dt;

      // Clamp to camera bounds (directional, same as on-surface).
      if (nx < minX) { nx = minX; nvx = Math.max(nvx, 0); }
      if (nx > maxX) { nx = maxX; nvx = Math.min(nvx, 0); }

      // Ocean floor hard stop at z=0.
      if (nz < 0) {
        this.state = { worldX: nx, worldZ: 0, vx: nvx, vz: 0, onSurface: true, isGrinding: false };
        return;
      }

      // Land when z falls back to the wave surface (or floor, whichever is higher).
      const landZ = Math.max(surfaceZ(nx, D, params, simTime), 0);
      if (nz <= landZ) {
        this.state = { worldX: nx, worldZ: landZ, vx: nvx, vz: 0, onSurface: true, isGrinding: false };
      } else {
        this.state = { worldX: nx, worldZ: nz, vx: nvx, vz: nvz, onSurface: false, isGrinding: false };
      }
    }
  }

  getState(): PlayerState {
    return { ...this.state };
  }
}
