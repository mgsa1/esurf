/**
 * Player controller — moving-floor surf physics.
 *
 * The wave surface is a dynamic floor. The surfer cannot go below it.
 * All vertical energy comes from the wave: as a crest passes, the rising
 * surface pushes the surfer up (surfaceZdot). The surfer then slides down
 * the wave face under gravity, converting height into horizontal speed.
 *
 * Two modes:
 *   onSurface = true  — constrained to the wave floor. Slope-based gravity
 *                        drives lateral motion. Wave lift (surfaceZdot) is the
 *                        upward velocity when the crest arrives.
 *   onSurface = false — airborne. Only gravity (az = −g). Lands when worldZ
 *                        falls back to the wave surface.
 *
 * Arrow keys provide small steering force (not the primary speed source).
 * Speed builds naturally by riding down wave faces.
 */

import { surfaceZ, surfaceSlope, surfaceZdot } from '../math/trochoidal';
import type { WaveParams, PlayerState } from '../types';

const G            = 9.81;
const INPUT_ACCEL  = 6;     // world units/s² — lateral paddling (steering)
const JUMP_IMPULSE = 7;     // world units/s — vz added on jump
const MAX_VX       = 18;    // world units/s — horizontal speed cap
const MAX_VZ       = 20;    // world units/s — vertical speed cap
const SURFACE_DRAG = 0.92;  // velocity multiplier/s on surface
const AIR_DRAG     = 0.99;  // velocity multiplier/s in air

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class PlayerController {
  private state: PlayerState;

  constructor(initialX: number, initialZ: number) {
    this.state = { worldX: initialX, worldZ: initialZ, vx: 0, vz: 0, onSurface: true };
  }

  update(
    params: WaveParams,
    simTime: number,
    input: { left: boolean; right: boolean; jump: boolean },
    dt: number
  ): void {
    const { worldX, worldZ, vx, vz } = this.state;
    const D = params.planeOffset ?? 0;

    const sz = surfaceZ(worldX, D, params, simTime);
    const inContact = worldZ <= sz + 0.01;  // small tolerance to avoid jitter

    if (inContact) {
      // ---- On-surface mode ----
      // Slope-based tangential gravity: pulls surfer down wave faces.
      const slope = surfaceSlope(worldX, D, params, simTime);
      const norm  = Math.sqrt(1 + slope * slope);
      const ax    = -G * slope / norm
                  + (input.left  ? -INPUT_ACCEL : 0)
                  + (input.right ?  INPUT_ACCEL : 0);

      // Integrate horizontal velocity with surface friction
      let nvx = (vx + ax * dt) * Math.pow(SURFACE_DRAG, dt);
      nvx = clamp(nvx, -MAX_VX, MAX_VX);

      const nx = worldX + nvx * dt;
      const nz = surfaceZ(nx, D, params, simTime);

      if (input.jump) {
        // Launch: wave lift + jump impulse
        const waveLift = surfaceZdot(worldX, D, params, simTime);
        const nvz = clamp(waveLift + JUMP_IMPULSE, 0, MAX_VZ);
        this.state = { worldX: nx, worldZ: nz, vx: nvx, vz: nvz, onSurface: false };
      } else {
        // Riding the surface: store wave's vertical velocity for smooth transitions
        const waveLift = surfaceZdot(nx, D, params, simTime);
        this.state = { worldX: nx, worldZ: nz, vx: nvx, vz: waveLift, onSurface: true };
      }

    } else {
      // ---- Airborne mode ----
      const ax  = (input.left  ? -INPUT_ACCEL * 0.4 : 0)
                + (input.right ?  INPUT_ACCEL * 0.4 : 0);

      let nvz = clamp(vz - G * dt, -MAX_VZ, MAX_VZ);
      let nvx = clamp((vx + ax * dt) * Math.pow(AIR_DRAG, dt), -MAX_VX, MAX_VX);

      const nx  = worldX + nvx * dt;
      const nz  = worldZ + nvz * dt;

      // Land when z falls back to the wave surface
      const newSz = surfaceZ(nx, D, params, simTime);
      if (nz <= newSz) {
        this.state = { worldX: nx, worldZ: newSz, vx: nvx, vz: 0, onSurface: true };
      } else {
        this.state = { worldX: nx, worldZ: nz, vx: nvx, vz: nvz, onSurface: false };
      }
    }
  }

  getState(): PlayerState {
    return { ...this.state };
  }
}
