/**
 * Parameter persistence via localStorage.
 * Key: 'esurf-params'
 * Both pages share params through this store.
 * The visualizer writes on every change; the game reads on load.
 */

import type { WaveParams } from '../types';

const STORAGE_KEY = 'esurf-params';

/**
 * Default WaveParams — surfable wave at normal speed.
 */
export function getDefaultParams(): WaveParams {
  return {
    amplitude: 3.5,
    wavelength: 18,
    speedFactor: 1.0,
    timeScale: 1,
    gridRes: 80,
    gridExtent: 30,
    planeOffset: 18,
    spawnX: 6,
    spawnY: 18,
    wave2Enabled: false,
    wave2OriginX: 0,
    wave2OriginY: -20,
    wave2Amplitude: 2.0,
    wave2Wavelength: 12,
    wave2SpeedFactor: 1.0,
    wallEnabled: false,
    wallReflection: 0.3,
  };
}

/**
 * Persist params to localStorage. Silent — never throws.
 */
export function saveParams(p: WaveParams): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

/**
 * Load params from localStorage.
 * Runtime guard: rejects stale spherical-model params and any parse errors.
 */
export function loadParams(): WaveParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultParams();
    const parsed = JSON.parse(raw) as Partial<WaveParams>;
    // Guard: old spherical model stored A, B1, etc. — these lack amplitude/wavelength.
    if (typeof parsed.amplitude !== 'number' || typeof parsed.wavelength !== 'number') {
      return getDefaultParams();
    }
    // Merge with defaults so new fields added in future versions get values.
    return { ...getDefaultParams(), ...parsed };
  } catch {
    return getDefaultParams();
  }
}
