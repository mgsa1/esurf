# esurf

A browser-based surf game built on a real-time 3D parametric wave surface.

The player surfs a 2D wave derived from a user-defined 3D function — tweak the math live, see the wave change instantly.

---

## Local setup

```
npm install
npm run dev
```

Open `http://localhost:5173` for the game, `http://localhost:5173/visualizer.html` for the 3D visualizer.

---

## The parametric equation

The 3D surface is defined by a spherical-coordinate radius field:

```
r(θ, φ, t) = A
           + B1 * sin(kTheta*θ + kPhi*φ - omega*t + delta)
           + B2 * sin(2*kTheta*θ - omega2*t)
           + N  * noise(nScale*θ, nScale*φ, t)
```

Then the Cartesian point is:

```
x = sx * r * sin(φ) * cos(θ)
y = sy * r * sin(φ) * sin(θ)
z = sz * r * cos(φ)
```

**Each parameter in plain English:**

| Param | Meaning |
|-------|---------|
| A | Base radius — how big the surface is overall |
| B1 | Primary wave amplitude — height of the main wave |
| B2 | Secondary harmonic amplitude — adds a secondary ripple on top |
| kTheta | Frequency along θ — how many wave crests wrap around the equator |
| kPhi | Frequency along φ — how waves vary pole-to-pole |
| omega | Primary animation speed — how fast the wave travels (rad/s) |
| omega2 | Secondary animation speed — speed of the secondary harmonic |
| delta | Phase offset — shifts the wave pattern without changing shape |
| N | Noise amplitude — how much random turbulence is added |
| nScale | Noise spatial scale — higher = finer-grained turbulence |
| sx/sy/sz | Axis stretch factors — squeeze or elongate the surface on each axis |
| thetaMin/Max | θ range — how much of the sphere to sample (0–2π = full circle) |
| phiMin/Max | φ range — vertical extent (0.1–π-0.1 avoids degenerate poles) |
| thetaRes/phiRes | Sampling resolution — more samples = smoother surface, more CPU |
| timeScale | Simulation speed multiplier — 0 freezes, 2 doubles speed |
| phiBase | Center angle for the gameplay slice (π/4 = 45° from top) |
| phiAmp | How much the slice angle oscillates over time |
| phiSpeed | Speed of slice oscillation |
| phiPhase | Phase offset of slice oscillation |
| phiMinSafe/MaxSafe | Clamp limits to keep the slice away from degenerate poles |

---

## 3D → 2D mapping

The gameplay wave is a 2D parametric XZ cross-section from a time-varying φ-slice:

```
φ_slice(t) = clamp(phiBase + phiAmp * sin(phiSpeed * t + phiPhase), phiMinSafe, phiMaxSafe)
```

For each θ sample, we compute `x(θ,t)` and `z(θ,t)` from the 3D surface:
```
(x, _, z) = computePoint(θ, φ_slice(t), t, params)
```

The resulting curve `(x[i], z[i])` is the gameplay wave.

Local slope is derived as `dz/dx` from neighboring samples:
```
slope[i] = (z[i+1] - z[i-1]) / (x[i+1] - x[i-1])
```

The slope drives physics: the surfer accelerates downhill and decelerates uphill.

This mapping is isolated in `src/math/waveExtractor.ts` — replace `computePhiSlice` and `extract2DWave` to swap in a different projection strategy.

---

## Controls

| Key | Action |
|-----|--------|
| `←` Arrow Left | Move left |
| `→` Arrow Right | Move right |
| `Space` | Jump |

---

## Performance notes

- **Pre-allocated buffers**: `sampleSurface` writes into a caller-provided `Float32Array` — zero GC in the hot loop.
- **BufferAttribute.needsUpdate**: Three.js is told about position changes via `needsUpdate = true` + `setDrawRange`. The geometry is never rebuilt.
- **480×270 canvas**: The game runs at a low internal resolution and is CSS-upscaled with `image-rendering: pixelated` — cheap to render, sharp pixel art look.
- **Value noise**: Deterministic 3D hash-based noise (~10 multiply/adds per call) — no lookup tables, no dependencies.
- **Debounce**: The visualizer debounces surface recomputes by 50ms when `thetaRes × phiRes > 10,000` to keep the UI responsive at high resolutions.

---

## How to add a new parametric equation

1. In `src/math/parametric.ts`, add a new function:
   ```ts
   export function computeRadiusMyShape(theta: number, phi: number, t: number, params: WaveParams): number {
     // your equation here
   }
   ```

2. Add a new `Preset` to `src/presets.ts`:
   ```ts
   preset('myShape', { A: 4, B1: 1, ... })
   ```

3. To make it selectable in the visualizer, the preset will automatically appear in the presets row.

For a completely different surface parameterization, replace `computePoint` in `src/math/parametric.ts` and update `extract2DWave` in `src/math/waveExtractor.ts` accordingly.
