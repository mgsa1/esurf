/**
 * Shared TypeScript interfaces for esurf.
 *
 * Wave model: superposition of two trochoidal (Gerstner) wave sources.
 *
 *   k  = 2π / wavelength
 *   ω  = speedFactor · √(9.81 · k)        (deep-water dispersion × user factor)
 *
 * Wave surface height (per source):
 *   z(x, y, t) = amplitude · cos(k·r − ω·t)        r = √((x−ox)² + (y−oy)²)
 *
 * Total surface = z₁ + z₂. The visualizer renders this as a 3D mesh; the
 * third-person SURF mode lets the rider move freely in (worldX, worldY).
 */

/**
 * All parameters controlling the trochoidal wave and simulation.
 *
 * Two wave sources can be active simultaneously. The total surface height is a
 * linear superposition: z_total = z1 + z2. This produces constructive interference
 * where crests coincide and destructive interference where a crest meets a trough.
 */
export interface WaveParams {
  // ---- Wave 1 (primary) ----
  /**
   * 'radial': concentric rings emanating from origin (0,0). Original behavior.
   * 'planar': parallel crests rolling in a fixed direction. Suited to surfing.
   */
  wave1Mode: 'radial' | 'planar';
  /** Wave 1 propagation direction in radians (planar mode only). 0 = +X, π/2 = +Y. */
  wave1Direction: number;
  /** Wave crest height above still water in world units (0.5–8). */
  amplitude: number;
  /** Spatial wavelength in world units (5–60). k = 2π/wavelength. */
  wavelength: number;
  /** Multiplies the dispersion-derived ω. 1 = physical speed, >1 = faster. */
  speedFactor: number;
  /** Animation speed multiplier (0 = frozen, 1 = normal, 2 = double). */
  timeScale: number;
  /** 3D visualizer grid resolution per axis (40–200). */
  gridRes: number;
  /** 3D visualizer grid half-width in world units (10–50). */
  gridExtent: number;
  /** Y-axis offset of the slice visualised in the visualizer (gold profile line + pink plane). */
  planeOffset: number;
  /** World-space X spawn coordinate for SURF mode (-30–30). */
  spawnX: number;
  /** World-space Y spawn coordinate for SURF mode (-30–30). */
  spawnY: number;

  // ---- Wave 2 (secondary) ----
  /** Enable the second wave source. When false, wave 2 contributes nothing. */
  wave2Enabled: boolean;
  /**
   * 'radial': concentric rings from (wave2OriginX, wave2OriginY).
   * 'planar': parallel crests rolling in wave2Direction (origin ignored).
   */
  wave2Mode: 'radial' | 'planar';
  /** Wave 2 propagation direction in radians (planar mode only). */
  wave2Direction: number;
  /** World-space X coordinate of the wave 2 origin — radial mode only (-250–250). */
  wave2OriginX: number;
  /** World-space Y coordinate of the wave 2 origin — radial mode only (-250–250). */
  wave2OriginY: number;
  /** Crest height of wave 2 above still water in world units (0–8). */
  wave2Amplitude: number;
  /** Spatial wavelength of wave 2 in world units (5–60). */
  wave2Wavelength: number;
  /** Speed multiplier for wave 2 (0.1–3). */
  wave2SpeedFactor: number;

  // ---- Wall (reflective boundary at +X grid edge) ----
  /** Enable a reflective wall at the +X grid edge. */
  wallEnabled: boolean;
  /** Fraction of wave energy reflected by the wall (0 = full absorption, 1 = perfect mirror). */
  wallReflection: number;
}

/**
 * Flat Float32Array of 3D surface sample points (x, y, z interleaved).
 * Length = gridRes * gridRes * 3.
 * Typed array for performance — pre-allocated, no per-frame GC.
 */
export type SurfaceData = Float32Array;

/**
 * A named preset — a WaveParams snapshot with a display name.
 */
export interface Preset {
  name: string;
  params: WaveParams;
}
