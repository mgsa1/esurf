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
   * longboardCruise — mellow, wide swells perfect for cruising.
   * Long wavelength + low amplitude = gentle slopes, easy to ride.
   */
  preset('longboardCruise', {
    amplitude: 2.5,
    wavelength: 50,
    speedFactor: 0.7,
    gridExtent: 100,
    planeOffset: 60,
  }),

  /**
   * crossSeas — two wave sources colliding at an angle.
   * Creates a dynamic interference pattern in 3D; the 2D slice
   * alternates between tall peaks and flat cancellations.
   */
  preset('crossSeas', {
    amplitude: 3.5,
    wavelength: 30,
    speedFactor: 1.0,
    gridExtent: 100,
    planeOffset: 45,
    wave2Enabled: true,
    wave2OriginX: 70,
    wave2OriginY: -50,
    wave2Amplitude: 2.5,
    wave2Wavelength: 40,
    wave2SpeedFactor: 0.8,
  }),

  /**
   * bigWaveDay — steep, fast, closely-spaced peaks.
   * High amplitude + short wavelength = aggressive slopes and big air.
   */
  preset('bigWaveDay', {
    amplitude: 6.0,
    wavelength: 18,
    speedFactor: 1.3,
    timeScale: 1.2,
    gridExtent: 100,
    planeOffset: 35,
  }),
];
