/**
 * Surface sampler for the 3D visualizer.
 *
 * Samples the ocean surface on a flat gridRes × gridRes grid.
 *
 * Performance:
 * - Pre-allocated Float32Array is passed in and written in-place (no GC pressure).
 * - Interleaved [x, y, z, x, y, z, ...] layout for direct Three.js BufferAttribute use.
 */

import { surfaceZ } from './trochoidal';
import type { WaveParams, SurfaceData } from '../types';

/**
 * Sample the 3D ocean surface on a flat grid.
 *
 * @param params  — wave parameters (used for gridRes/gridExtent and as fallback Z)
 * @param t       — simulation time
 * @param buffer  — pre-allocated Float32Array of size >= gridRes * gridRes * 3
 * @param zOverride — optional per-point function that replaces the entire Z computation.
 *        When provided, surfaceZ is NOT called — the override handles both wave sources.
 *        Used by the causal epoch model to propagate parameter changes as wavefronts.
 * @returns the same buffer (typed as SurfaceData) — caller reuses it each frame
 */
export function sampleSurface(
  params: WaveParams,
  t: number,
  buffer: Float32Array,
  zOverride?: (x: number, y: number) => number,
): SurfaceData {
  const { gridRes, gridExtent } = params;
  const step = (2 * gridExtent) / (gridRes - 1);

  let idx = 0;
  for (let xi = 0; xi < gridRes; xi++) {
    const x = -gridExtent + xi * step;
    for (let yi = 0; yi < gridRes; yi++) {
      const y = -gridExtent + yi * step;
      buffer[idx++] = x;
      buffer[idx++] = y;
      buffer[idx++] = zOverride !== undefined ? zOverride(x, y) : surfaceZ(x, y, params, t);
    }
  }

  return buffer;
}
