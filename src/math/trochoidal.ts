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

/** Phase velocity c = ω/k for wave 2. Used by the visualizer to pace propagation effects. */
export function wave2PhaseVelocity(params: WaveParams): number {
  const k2 = (2 * Math.PI) / Math.max(params.wave2Wavelength, 0.01);
  const omega2 = params.wave2SpeedFactor * Math.sqrt(G * k2);
  return omega2 / k2;
}

/** Height contribution from wave 2 at (worldX, worldY). Returns 0 when disabled.
 *  Optional `alpha` overrides the enabled flag with a continuous [0..1] multiplier,
 *  used by the visualizer to propagate toggle changes as a wavefront. */
export function wave2Z(worldX: number, worldY: number, params: WaveParams, t: number, alpha?: number): number {
  const eff = alpha ?? (params.wave2Enabled ? 1 : 0);
  if (eff === 0 || params.wave2Amplitude === 0) return 0;
  const k2 = (2 * Math.PI) / Math.max(params.wave2Wavelength, 0.01);
  const omega2 = params.wave2SpeedFactor * Math.sqrt(G * k2);
  const period2 = (2 * Math.PI) / Math.max(omega2, 0.001);
  const tCycled2 = t % period2;
  const dx = worldX - params.wave2OriginX;
  const dy = worldY - params.wave2OriginY;
  const r2 = Math.sqrt(dx * dx + dy * dy);
  return params.wave2Amplitude * eff * Math.cos(k2 * r2 - omega2 * tCycled2);
}

/**
 * Height of the combined wave surface at (worldX, worldY) and time.
 *
 * z = z1 + z2
 * z1 = A1 · cos(k1 · √(x²+y²) − ω1·t)
 * z2 = A2 · cos(k2 · √((x−ox)²+(y−oy)²) − ω2·t)   [if wave2Enabled]
 */
/** Optional `wave2Alpha` overrides the wave2Enabled flag with a [0..1] multiplier.
 *  When undefined the binary params.wave2Enabled flag is used (normal path). */
export function surfaceZ(worldX: number, worldY: number, params: WaveParams, t: number, wave2Alpha?: number): number {
  const { k, omega, phase } = derived(params, t);
  const r = Math.sqrt(worldX * worldX + worldY * worldY);
  return params.amplitude * Math.cos(k * r - omega * phase) + wave2Z(worldX, worldY, params, t, wave2Alpha);
}

