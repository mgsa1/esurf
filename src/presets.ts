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
   * gentleSwell — long, slow rolling ocean swell.
   * Easy to ride: low acceleration, forgiving physics.
   */
  preset('gentleSwell', {
    amplitude: 1.0,
    wavelength: 30,
    speedFactor: 0.8,
  }),

  /**
   * surfBreak — classic beach break conditions.
   * Medium amplitude and speed — the default surf experience.
   */
  preset('surfBreak', {
    amplitude: 2.5,
    wavelength: 15,
    speedFactor: 1.0,
  }),

  /**
   * stormWave — fast, powerful, steep.
   * High acceleration on the wave face — hard to ride without speed.
   */
  preset('stormWave', {
    amplitude: 5.0,
    wavelength: 10,
    speedFactor: 1.4,
  }),
];
