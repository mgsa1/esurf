/**
 * Wave presets — three distinct trochoidal wave configurations.
 */

import { getDefaultParams } from './store/params';
import type { Preset, WaveParams } from './types';

function preset(name: string, overrides: Partial<WaveParams>): Preset {
  return { name, params: { ...getDefaultParams(), ...overrides } };
}

export const PRESETS: Preset[] = [
  /**
   * timeAttackBay — calibrated for the 60-second arcade run.
   * Planar swells rolling toward the player, moderate amplitude,
   * tight enough wavelength to spawn frequent gates and tube windows.
   */
  preset('timeAttackBay', {
    wave1Mode: 'planar',
    wave1Direction: Math.PI,
    amplitude: 3.5,
    wavelength: 22,
    speedFactor: 1.0,
    gridExtent: 50,
    spawnX: 0,
    spawnY: 0,
  }),

  /**
   * bigWaveDay — steep, fast, closely-spaced planar swells.
   * High amplitude + short wavelength = aggressive slopes and big air.
   */
  preset('bigWaveDay', {
    wave1Mode: 'planar',
    wave1Direction: Math.PI,
    amplitude: 6.0,
    wavelength: 18,
    speedFactor: 1.3,
    timeScale: 1.0,
    gridExtent: 60,
  }),

  /**
   * crossSeas — planar swell + a radial source at an angle.
   * Creates dynamic interference: tall peaks where they align, flat
   * cancellations where they cross out of phase.
   */
  preset('crossSeas', {
    wave1Mode: 'planar',
    wave1Direction: Math.PI,
    amplitude: 3.0,
    wavelength: 26,
    speedFactor: 1.0,
    gridExtent: 60,
    wave2Enabled: true,
    wave2OriginX: 30,
    wave2OriginY: -30,
    wave2Amplitude: 2.0,
    wave2Wavelength: 30,
    wave2SpeedFactor: 0.8,
  }),

  /**
   * longboardCruise — mellow, wide planar swells.
   * Long wavelength + low amplitude = gentle slopes, low ceiling,
   * easy survival run for warming up.
   */
  preset('longboardCruise', {
    wave1Mode: 'planar',
    wave1Direction: Math.PI,
    amplitude: 2.0,
    wavelength: 40,
    speedFactor: 0.7,
    gridExtent: 80,
  }),
];
