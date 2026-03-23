/**
 * Shared TypeScript interfaces for esurf.
 *
 * Wave model: single trochoidal (Gerstner) wave propagating in the +x direction.
 *
 *   k  = 2π / wavelength
 *   ω  = speedFactor · √(9.81 · k)        (deep-water dispersion × user factor)
 *
 * Wave surface height:
 *   surfaceZ(x, t) = amplitude · cos(k·x − ω·t)
 *
 * Volumetric acceleration at (worldX, worldZ, t):
 *   ax = −amplitude · g · k · exp(k · worldZ) · sin(k·worldX − ω·t)
 *   az =  amplitude · g · k · exp(k · worldZ) · cos(k·worldX − ω·t) − g
 *
 * The exp(k·worldZ) factor decays exponentially below still water (worldZ = 0),
 * giving physically correct wave influence throughout the water column.
 * The surfer moves freely in 2D (worldX, worldZ) driven by this field.
 */

/**
 * All parameters controlling the trochoidal wave and simulation.
 *
 * Two wave sources can be active simultaneously. The total surface height is a
 * linear superposition: z_total = z1 + z2. This produces constructive interference
 * where crests coincide and destructive interference where a crest meets a trough.
 */
export interface WaveParams {
  // ---- Wave 1 (primary, origin fixed at 0,0) ----
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
  /** Distance of the 2D game plane from the origin along the y-axis (0–30). */
  planeOffset: number;
  /** World-space X spawn coordinate for first-person game mode (-30–30). */
  spawnX: number;
  /** World-space Y spawn coordinate for first-person game mode (-30–30). */
  spawnY: number;

  // ---- Wave 2 (secondary, configurable origin) ----
  /** Enable the second wave source. When false, wave 2 contributes nothing. */
  wave2Enabled: boolean;
  /** World-space X coordinate of the wave 2 origin (-50–50). */
  wave2OriginX: number;
  /** World-space Y coordinate of the wave 2 origin (-50–50). */
  wave2OriginY: number;
  /** Crest height of wave 2 above still water in world units (0–8). */
  wave2Amplitude: number;
  /** Spatial wavelength of wave 2 in world units (5–60). */
  wave2Wavelength: number;
  /** Speed multiplier for wave 2 (0.1–3). */
  wave2SpeedFactor: number;
}

/**
 * Flat Float32Array of 3D surface sample points (x, y, z interleaved).
 * Length = gridRes * gridRes * 3.
 * Typed array for performance — pre-allocated, no per-frame GC.
 */
export type SurfaceData = Float32Array;

/**
 * Player state — 2D body in the wave cross-section (xz plane).
 *
 * worldX: position along wave propagation direction (world units)
 * worldZ: height above/below still water level (0 = still water surface)
 * vx, vz: velocity components (world units/s)
 * onSurface: true when in contact with the wave floor
 *
 * Physics regimes:
 *   onSurface = true,  isGrinding = false → slope-based gravity drives lateral motion
 *   onSurface = true,  isGrinding = true  → locked to wave crest, sliding along lip
 *   onSurface = false, isGrinding = false → airborne, only gravity (az = −g)
 */
export interface PlayerState {
  worldX: number;
  worldZ: number;
  vx: number;
  vz: number;
  onSurface: boolean;
  /** True while the surfer is grinding along a wave crest (lip slide). */
  isGrinding: boolean;
}

/**
 * A named preset — a WaveParams snapshot with a display name.
 */
export interface Preset {
  name: string;
  params: WaveParams;
}
