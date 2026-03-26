/**
 * Player controller — tangent/normal surf physics.
 *
 * The surfer rides the wave as motion along the local tangent of the 2D wave
 * curve. Gravity projects onto the tangent, carve input biases engagement,
 * and the wave's own energy (surfaceZdot) amplifies or dampens acceleration
 * depending on whether the rider is on the propagation side.
 *
 * Two states:
 *   grounded = true  — motion governed by groundSpeed (scalar along tangent)
 *   grounded = false — ballistic air with airVelX / airVelZ
 *
 * Controls:
 *   A/D or ←/→  — carve (edge engagement)
 *   W or ↑      — pump (terrain-timed speed boost)
 *   S or ↓      — brake (smooth drag)
 *   Space        — jump (speed-scaled impulse)
 *   R            — respawn
 */

import { surfaceZ, surfaceSlope, surfaceZdot } from '../math/trochoidal';
import { SURF } from './physicsTuning';
import type { GameInput } from './controls';
import type { WaveParams, PlayerState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Build tangent and outward normal from the analytical slope dz/dx. */
function tangentNormal(slope: number) {
  const len = Math.sqrt(1 + slope * slope);
  return {
    tx: 1 / len,        // tangent x (always positive — rightward along surface)
    tz: slope / len,     // tangent z
    nx: -slope / len,    // normal x (outward)
    nz: 1 / len,        // normal z (outward)
  };
}

// ---------------------------------------------------------------------------
// Player controller
// ---------------------------------------------------------------------------

export class PlayerController {
  private state: PlayerState;
  private spawnX: number;
  private spawnZ: number;

  constructor(initialX: number, initialZ: number) {
    this.spawnX = initialX;
    this.spawnZ = initialZ;
    this.state = this.makeSpawnState(initialX, initialZ);
  }

  private makeSpawnState(x: number, z: number): PlayerState {
    return {
      worldX: x, worldZ: z,
      groundSpeed: 0, edge: 0, grounded: true,
      airVelX: 0, airVelZ: 0, pumpCooldown: 0,
      vx: 0, vz: 0, isCrouching: false,
    };
  }

  update(
    params: WaveParams,
    simTime: number,
    input: GameInput,
    dt: number,
    minX: number,
    maxX: number,
  ): void {
    if (input.respawn) {
      const D = params.planeOffset ?? 0;
      const sz = Math.max(surfaceZ(this.spawnX, D, params, simTime), 0);
      this.state = this.makeSpawnState(this.spawnX, sz);
      return;
    }

    // Tick pump cooldown
    this.state.pumpCooldown = Math.max(this.state.pumpCooldown - dt, 0);

    if (this.state.grounded) {
      this.updateGrounded(params, simTime, input, dt, minX, maxX);
    } else {
      this.updateAirborne(params, simTime, input, dt, minX, maxX);
    }
  }

  // =========================================================================
  // GROUNDED
  // =========================================================================

  private updateGrounded(
    params: WaveParams, simTime: number, input: GameInput,
    dt: number, minX: number, maxX: number,
  ): void {
    const s = this.state;
    const D = params.planeOffset ?? 0;

    // --- 1. Read wave state at current position ---
    const slope    = surfaceSlope(s.worldX, D, params, simTime);
    const waveLift = surfaceZdot(s.worldX, D, params, simTime);
    const { tx, tz, nx, nz } = tangentNormal(slope);

    // --- 2. Update edge (carve engagement) ---
    const targetEdge = input.left ? -1 : input.right ? 1 : 0;
    if (targetEdge !== 0) {
      let buildRate = SURF.EDGE_BUILD_RATE;
      // Penalty when reversing direction at speed
      if (sign(targetEdge) !== sign(s.edge) && sign(s.edge) !== 0) {
        buildRate *= SURF.EDGE_FLIP_PENALTY;
      }
      s.edge += (targetEdge - s.edge) * Math.min(buildRate * dt, 1);
    } else {
      // Release toward zero
      s.edge *= Math.max(1 - SURF.EDGE_RELEASE_RATE * dt, 0);
    }
    s.edge = clamp(s.edge, -1, 1);

    // --- 3. Gravity projection onto tangent ---
    // gTangent > 0 means accelerating rightward (downslope to the right)
    const gTangent = -SURF.GRAVITY * slope / Math.sqrt(1 + slope * slope);

    // --- 4. Wave push ---
    // The moving wave face gives free energy — like being carried by the swell.
    // Strength proportional to how much the wave is rising under the rider.
    const wavePush = SURF.WAVE_PUSH_STRENGTH *
      clamp(waveLift / SURF.WAVE_LIFT_MAX, -0.3, 1);

    // --- 5. Carve force ---
    // Stronger when carving into the slope on the energetic side
    const slopeAlignment = clamp(slope * sign(s.edge), -1, 1);
    const propFactor = 1 + SURF.EDGE_PROPAGATION_BONUS *
      clamp(waveLift / SURF.WAVE_LIFT_MAX, 0, 1);
    const carveAccel = SURF.EDGE_CARVE_FORCE * s.edge *
      (0.5 + 0.5 * Math.max(slopeAlignment, 0)) * propFactor;

    // --- 6. Pump ---
    if (input.pump && s.pumpCooldown <= 0) {
      const pumpEfficiency = 1 - clamp(Math.abs(slope) / SURF.PUMP_SLOPE_WINDOW, 0, 1);
      const waveFrontBonus = waveLift > 0 ? SURF.PUMP_WAVEFRONT_BONUS : 1.0;
      const dir = s.groundSpeed >= 0 ? 1 : -1;
      s.groundSpeed += SURF.PUMP_IMPULSE * pumpEfficiency * waveFrontBonus * dir;
      s.pumpCooldown = SURF.PUMP_COOLDOWN;
    }

    // --- 7. Brake ---
    if (input.brake) {
      if (Math.abs(s.groundSpeed) < SURF.BRAKE_MIN_SPEED) {
        s.groundSpeed = 0;
      } else {
        s.groundSpeed -= SURF.BRAKE_DRAG * sign(s.groundSpeed) * dt;
      }
    }

    // --- 8. Friction + drag ---
    if (Math.abs(s.groundSpeed) > SURF.SPEED_FLOOR) {
      const frictionDecel = SURF.ROLLING_FRICTION * sign(s.groundSpeed);
      const dragDecel = SURF.QUADRATIC_DRAG * s.groundSpeed * Math.abs(s.groundSpeed);
      s.groundSpeed -= (frictionDecel + dragDecel) * dt;
    }

    // --- 9. Integrate groundSpeed ---
    s.groundSpeed += (gTangent + wavePush + carveAccel) * dt;
    s.groundSpeed = clamp(s.groundSpeed, -SURF.MAX_GROUND_SPEED, SURF.MAX_GROUND_SPEED);

    // Snap to zero if barely moving
    if (Math.abs(s.groundSpeed) < SURF.SPEED_FLOOR) {
      s.groundSpeed = 0;
    }

    // --- 10. Advance position ---
    let newX = s.worldX + s.groundSpeed * tx * dt;
    // Camera bounds (directional clamp)
    if (newX < minX) { newX = minX; s.groundSpeed = Math.max(s.groundSpeed, 0); }
    if (newX > maxX) { newX = maxX; s.groundSpeed = Math.min(s.groundSpeed, 0); }
    const newZ = Math.max(surfaceZ(newX, D, params, simTime), 0);

    // --- 11. Check for detach / jump / auto-launch ---
    if (input.jump) {
      const jumpImpulse = Math.min(
        SURF.JUMP_BASE + Math.abs(s.groundSpeed) * SURF.JUMP_SPEED_SCALE,
        SURF.JUMP_MAX,
      );
      s.airVelX = s.groundSpeed * tx;
      s.airVelZ = Math.max(s.groundSpeed * tz + waveLift, 0) + jumpImpulse;
      s.worldX = newX;
      s.worldZ = newZ;
      s.grounded = false;
      this.syncDerived();
      return;
    }

    if (waveLift > SURF.AUTO_LAUNCH_ZDOT && Math.abs(s.groundSpeed) > SURF.AUTO_LAUNCH_SPEED) {
      s.airVelX = s.groundSpeed * tx;
      s.airVelZ = s.groundSpeed * tz + waveLift;
      s.worldX = newX;
      s.worldZ = newZ;
      s.grounded = false;
      this.syncDerived();
      return;
    }

    // --- Stay grounded ---
    s.worldX = newX;
    s.worldZ = newZ;
    this.syncDerived();
  }

  // =========================================================================
  // AIRBORNE
  // =========================================================================

  private updateAirborne(
    params: WaveParams, simTime: number, input: GameInput,
    dt: number, minX: number, maxX: number,
  ): void {
    const s = this.state;
    const D = params.planeOffset ?? 0;

    // --- Forces ---
    const ax = (input.left ? -SURF.AIR_STEER : 0) + (input.right ? SURF.AIR_STEER : 0);
    s.airVelX = (s.airVelX + ax * dt) * Math.pow(SURF.AIR_DRAG, dt);
    s.airVelZ -= SURF.GRAVITY * dt;

    // Clamp
    s.airVelX = clamp(s.airVelX, -SURF.MAX_AIR_VX, SURF.MAX_AIR_VX);
    s.airVelZ = clamp(s.airVelZ, -SURF.MAX_AIR_VZ, SURF.MAX_AIR_VZ);

    // --- Integrate position ---
    let newX = s.worldX + s.airVelX * dt;
    let newZ = s.worldZ + s.airVelZ * dt;

    // Camera bounds
    if (newX < minX) { newX = minX; s.airVelX = Math.max(s.airVelX, 0); }
    if (newX > maxX) { newX = maxX; s.airVelX = Math.min(s.airVelX, 0); }

    // --- Ocean floor hard stop ---
    if (newZ < 0) {
      s.worldX = newX;
      s.worldZ = 0;
      s.groundSpeed = s.airVelX;
      s.airVelX = 0;
      s.airVelZ = 0;
      s.grounded = true;
      s.edge = 0;
      this.syncDerived();
      return;
    }

    // --- Landing check ---
    const landZ = Math.max(surfaceZ(newX, D, params, simTime), 0);
    if (newZ <= landZ) {
      // Alignment-based speed preservation
      const slope = surfaceSlope(newX, D, params, simTime);
      const { tx, tz } = tangentNormal(slope);
      const airSpeed = Math.sqrt(s.airVelX * s.airVelX + s.airVelZ * s.airVelZ);

      let preserveFactor = SURF.LANDING_PRESERVE_GOOD;
      if (airSpeed > 0.01) {
        const alignment = (s.airVelX * tx + s.airVelZ * tz) / airSpeed;
        if (alignment >= SURF.LANDING_GOOD_DOT) {
          preserveFactor = SURF.LANDING_PRESERVE_GOOD;
        } else {
          // Lerp between bad and good based on alignment
          const t = clamp(alignment / SURF.LANDING_GOOD_DOT, 0, 1);
          preserveFactor = SURF.LANDING_PRESERVE_BAD +
            (SURF.LANDING_PRESERVE_GOOD - SURF.LANDING_PRESERVE_BAD) * t;
        }
      }

      // Direction from airVelX
      const dir = s.airVelX >= 0 ? 1 : -1;
      s.groundSpeed = airSpeed * dir * preserveFactor;
      s.worldX = newX;
      s.worldZ = landZ;
      s.airVelX = 0;
      s.airVelZ = 0;
      s.grounded = true;
      s.edge = 0;
      this.syncDerived();
      return;
    }

    // --- Stay airborne ---
    s.worldX = newX;
    s.worldZ = newZ;
    this.syncDerived();
  }

  // =========================================================================
  // Derived state
  // =========================================================================

  /** Sync vx/vz and isCrouching from authoritative state. */
  private syncDerived(): void {
    const s = this.state;
    if (s.grounded) {
      const D = 0; // Doesn't matter for tangent — we just need the direction
      // We can't easily access params here, so compute from groundSpeed direction
      s.vx = s.groundSpeed; // Approximate: on mild slopes tx ≈ 1
      s.vz = 0;
    } else {
      s.vx = s.airVelX;
      s.vz = s.airVelZ;
    }
    s.isCrouching = Math.abs(s.edge) > 0.8;
  }

  getState(): PlayerState {
    return { ...this.state };
  }
}
