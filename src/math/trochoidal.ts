/**
 * Trochoidal wave math for esurf.
 *
 * Two independent wave sources are superposed:
 *
 *   Wave 1 (origin at 0, 0):
 *     z1(x, y, t) = A1 · cos(k1·r1 − ω1·t)   r1 = √(x²+y²)
 *
 *   Wave 2 (origin at ox, oy — parametrizable):
 *     z2(x, y, t) = A2 · cos(k2·r2 − ω2·t)   r2 = √((x−ox)²+(y−oy)²)
 *
 *   Total surface: z = z1 + z2
 *
 * The sum produces constructive interference where crests align and destructive
 * interference where a crest meets a trough. Interference patterns rotate as the
 * two waves propagate at different speeds or wavelengths.
 *
 * The game slices at y = planeOffset (distance D from the origin), giving:
 *   z_game(x, t) = z1(x, D, t) + z2(x, D, t)
 *
 * Derived constants:
 *   k = 2π / wavelength
 *   ω = speedFactor · √(9.81 · k)   (deep-water dispersion × user factor)
 *
 * t overflow guard: cycle t before sin/cos to prevent float precision loss.
 */

import type { WaveParams } from '../types';

const G = 9.81;

/** Derive k, ω, and tCycled from WaveParams and current time. */
function derived(params: WaveParams, t: number): { k: number; omega: number; phase: number } {
  const k = (2 * Math.PI) / Math.max(params.wavelength, 0.01);
  const omega = params.speedFactor * Math.sqrt(G * k);
  const period = (2 * Math.PI) / Math.max(omega, 0.001);
  const tCycled = t % period;
  return { k, omega, phase: tCycled };
}

/** Height contribution from wave 2 at (worldX, worldY). Returns 0 when disabled. */
function wave2Z(worldX: number, worldY: number, params: WaveParams, t: number): number {
  if (!params.wave2Enabled || params.wave2Amplitude === 0) return 0;
  const k2 = (2 * Math.PI) / Math.max(params.wave2Wavelength, 0.01);
  const omega2 = params.wave2SpeedFactor * Math.sqrt(G * k2);
  const period2 = (2 * Math.PI) / Math.max(omega2, 0.001);
  const tCycled2 = t % period2;
  const dx = worldX - params.wave2OriginX;
  const dy = worldY - params.wave2OriginY;
  const r2 = Math.sqrt(dx * dx + dy * dy);
  return params.wave2Amplitude * Math.cos(k2 * r2 - omega2 * tCycled2);
}

/**
 * Height of the combined wave surface at (worldX, worldY) and time.
 *
 * z = z1 + z2
 * z1 = A1 · cos(k1 · √(x²+y²) − ω1·t)
 * z2 = A2 · cos(k2 · √((x−ox)²+(y−oy)²) − ω2·t)   [if wave2Enabled]
 */
export function surfaceZ(worldX: number, worldY: number, params: WaveParams, t: number): number {
  const { k, omega, phase } = derived(params, t);
  const r = Math.sqrt(worldX * worldX + worldY * worldY);
  return params.amplitude * Math.cos(k * r - omega * phase) + wave2Z(worldX, worldY, params, t);
}

/**
 * Analytical slope dz/dx of the combined wave surface at (worldX, planeOffset).
 *
 * Each wave contributes independently (superposition → derivatives add):
 *
 *   dz1/dx = −A1·k1·(x / r1)·sin(k1·r1 − ω1·t)         r1 = √(x²+D²)
 *   dz2/dx = −A2·k2·((x−ox) / r2)·sin(k2·r2 − ω2·t)    r2 = √((x−ox)²+(D−oy)²)
 *
 * Used for slope-based tangential gravity in player physics.
 * Returns 0 near the wave origin (r < 1e-6) to avoid divide-by-zero.
 */
export function surfaceSlope(
  worldX: number,
  planeOffset: number,
  params: WaveParams,
  t: number
): number {
  const { k, omega, phase } = derived(params, t);
  const D = planeOffset;
  const r = Math.sqrt(worldX * worldX + D * D);
  let slope = r < 1e-6 ? 0 : -params.amplitude * k * (worldX / r) * Math.sin(k * r - omega * phase);

  // Wave 2 slope contribution
  if (params.wave2Enabled && params.wave2Amplitude !== 0) {
    const k2 = (2 * Math.PI) / Math.max(params.wave2Wavelength, 0.01);
    const omega2 = params.wave2SpeedFactor * Math.sqrt(G * k2);
    const period2 = (2 * Math.PI) / Math.max(omega2, 0.001);
    const tCycled2 = t % period2;
    const dx = worldX - params.wave2OriginX;
    const dy = D - params.wave2OriginY;
    const r2 = Math.sqrt(dx * dx + dy * dy);
    if (r2 >= 1e-6) {
      slope += -params.wave2Amplitude * k2 * (dx / r2) * Math.sin(k2 * r2 - omega2 * tCycled2);
    }
  }

  return slope;
}

/**
 * Time derivative of the combined wave surface height at (worldX, planeOffset).
 *
 *   dz1/dt = A1·ω1·sin(k1·r1 − ω1·t)
 *   dz2/dt = A2·ω2·sin(k2·r2 − ω2·t)   [if wave2Enabled]
 *
 * Positive = surface is rising (crest arriving). This is the upward velocity
 * the wave floor imparts to the surfer on contact — the source of all vertical
 * energy in the surf physics.
 */
export function surfaceZdot(
  worldX: number,
  planeOffset: number,
  params: WaveParams,
  t: number
): number {
  const { k, omega, phase } = derived(params, t);
  const D = planeOffset;
  const r = Math.sqrt(worldX * worldX + D * D);
  let zdot = params.amplitude * omega * Math.sin(k * r - omega * phase);

  // Wave 2 time derivative contribution
  if (params.wave2Enabled && params.wave2Amplitude !== 0) {
    const k2 = (2 * Math.PI) / Math.max(params.wave2Wavelength, 0.01);
    const omega2 = params.wave2SpeedFactor * Math.sqrt(G * k2);
    const period2 = (2 * Math.PI) / Math.max(omega2, 0.001);
    const tCycled2 = t % period2;
    const dx = worldX - params.wave2OriginX;
    const dy = D - params.wave2OriginY;
    const r2 = Math.sqrt(dx * dx + dy * dy);
    zdot += params.wave2Amplitude * omega2 * Math.sin(k2 * r2 - omega2 * tCycled2);
  }

  return zdot;
}

/**
 * Sample the combined wave surface as an array of [x, z] screen points for the game renderer.
 *
 * Samples x uniformly over [cameraX − halfWidth, cameraX + halfWidth] in n steps.
 * Delegates to surfaceZ, which includes both wave1 and wave2 (if enabled).
 *
 * Used by renderer2d.ts to draw the wave profile.
 */
export function sampleSurface2D(
  params: WaveParams,
  t: number,
  cameraX: number,
  halfWidth: number,
  n: number
): Array<[x: number, z: number]> {
  const result: Array<[number, number]> = [];

  const xMin = cameraX - halfWidth;
  const xMax = cameraX + halfWidth;
  const dx = (xMax - xMin) / (n - 1);
  const D = params.planeOffset ?? 0;

  for (let i = 0; i < n; i++) {
    const x = xMin + i * dx;
    result.push([x, surfaceZ(x, D, params, t)]);
  }

  return result;
}
