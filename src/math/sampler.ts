/**
 * Surface sampler for the 3D visualizer.
 *
 * Samples z(r, t) = A · cos(k·r − ω·t) on a flat gridRes × gridRes grid,
 * where r = √(x²+y²) — radially symmetric circular wave from the origin.
 * This produces concentric expanding rings in the 3D visualizer.
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
 * @param params  — wave parameters
 * @param t       — simulation time
 * @param buffer  — pre-allocated Float32Array of size >= gridRes * gridRes * 3
 * @returns the same buffer (typed as SurfaceData) — caller reuses it each frame
 */
export function sampleSurface(
  params: WaveParams,
  t: number,
  buffer: Float32Array,
  wave2AlphaFn?: (x: number, y: number) => number,
): SurfaceData {
  const { gridRes, gridExtent } = params;
  const step = (2 * gridExtent) / (gridRes - 1);

  let idx = 0;
  for (let xi = 0; xi < gridRes; xi++) {
    const x = -gridExtent + xi * step;
    for (let yi = 0; yi < gridRes; yi++) {
      const y = -gridExtent + yi * step;
      const alpha = wave2AlphaFn !== undefined ? wave2AlphaFn(x, y) : undefined;
      buffer[idx++] = x;
      buffer[idx++] = y;
      buffer[idx++] = surfaceZ(x, y, params, t, alpha);
    }
  }

  return buffer;
}
