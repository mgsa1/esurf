# esurf

A tunable ocean surface you can surf. Design a wave in 3D, then ride it.

A single page (`/`) renders the 3D trochoidal surface with sliders, dual-wave interference, a reflective wall, and a third-person SURF mode that drops a board onto the live mesh.

---

## Setup

```
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Wave math

The surface uses trochoidal (Gerstner) waves with deep-water dispersion:

```
k = 2π / wavelength
ω = speedFactor · √(9.81 · k)
```

Two independent circular wave sources are superposed:

```
z₁(x, y, t) = A₁ · cos(k₁ · r₁ − ω₁·t)       r₁ = √(x² + y²)
z₂(x, y, t) = A₂ · cos(k₂ · r₂ − ω₂·t)       r₂ = √((x − ox)² + (y − oy)²)

Total surface: z = z₁ + z₂
```

Where crests align you get constructive interference (tall wave). Where a crest meets a trough, destructive interference (calm water).

### Parameters

| Parameter | Range | Meaning |
|-----------|-------|---------|
| `amplitude` | 0.5–8 | Wave 1 height |
| `wavelength` | 5–60 | Spatial period |
| `speedFactor` | 0.1–3 | Multiplier on dispersion-derived speed |
| `timeScale` | 0–2 | Simulation speed (0 = frozen) |
| `planeOffset` | 0–30 | Y-axis offset of the cross-section visualised in the panel |
| `spawnX` / `spawnY` | ±30 | Player spawn position in SURF mode |
| `gridRes` | 40–200 | 3D visualizer resolution per axis |
| `gridExtent` | 10–250 | 3D grid half-width in world units |
| `wave2Enabled` | bool | Enable second wave source |
| `wave2OriginX/Y` | ±50 | Origin of wave 2 |
| `wave2Amplitude` | 0–8 | Height of wave 2 |
| `wave2Wavelength` | 5–60 | Wavelength of wave 2 |
| `wave2SpeedFactor` | 0.1–3 | Speed of wave 2 |
| `wallEnabled` | bool | Enable reflective wall at +X grid edge |
| `wallReflection` | 0–1 | Fraction of wave energy reflected by the wall |

---

## Visualizer SURF mode

The SURF button drops you onto the live wave for a 60-second score run.

In SURF mode every crest **peels**: a break point runs along it and chases you
down the line (`src/game/breakField.ts`). Just ahead of the curl is the pocket
(fastest, steepest, tube zone); behind it is whitewater that eats you; far out
on the shoulder the wave flattens and you bog down. The ocean is endless — the
mesh follows the rider. The visualizer itself keeps the pure wave math.

**State machine:** RIDING ⇄ AIRBORNE, RIDING → WIPEOUT → drop-in, RIDING → PADDLING (lost the wave) → catch / drop-in

| Key | Action |
|-----|--------|
| `A` / `D` | Carve (riding) / spin (air) / steer (paddling) |
| `W` | Paddle (paddling) / backflip (air) |
| `S` | Stall (riding) / frontflip (air) |
| `Shift` | Pump — hold while going downhill to build speed |
| `Space` | Pop (bigger near the lip) / hold in air to grab |
| `R` | Drop in on the next wave |
| `Esc` | Exit surf mode |

Physics: no motor. The wave carries you while you are on its face and pulls you
toward a trim speed that is highest in the pocket and on the upper face. Climbing
through the lip line launches you; the steeper the lip and the faster you hit it,
the bigger the air. Airs, snaps (hard carve off the lip), cutbacks (on the
shoulder), tubes and gates bump a combo that drains if you stop scoring.

Entering SURF mode switches to a sunset theme (warm orange sky, shaded ocean with whitewater, retro grid floor).

---

## Visualizer controls

| Input | Action |
|-------|--------|
| Sliders | Adjust wave parameters in real-time |
| Preset buttons | Load `longboardCruise`, `crossSeas`, or `bigWaveDay` |
| Mouse drag/scroll | Orbit and zoom the 3D view |
| SURF button | Enter third-person surf mode |
| DEV LOG button | Toggle development roadmap panel |

---

## Presets

| Name | Amplitude | Wavelength | Speed | Feel |
|------|-----------|-----------|-------|------|
| **longboardCruise** | 2.5 | 50 | 0.7 | Mellow, wide swells |
| **crossSeas** | 3.5 | 30 | 1.0 | Two sources colliding at an angle |
| **bigWaveDay** | 6.0 | 18 | 1.3 | Steep, fast, closely-spaced peaks |

---

## Performance

- **Pre-allocated buffers** — `sampleSurface` writes into a caller-provided `Float32Array`. Zero GC in the hot loop.
- **BufferAttribute.needsUpdate** — geometry is never rebuilt. Position and color buffers are updated in-place with `DynamicDrawUsage`.
- **Causal epoch model** — slider changes propagate as wavefronts rather than snapping the whole grid: rings from a radial source, a straight front from the up-wave edge for planar waves. The steady-state path skips the per-point epoch lookup.
- **Debounce** — visualizer debounces recomputes by 50ms when `gridRes > 120`.

---

## Project structure

```
src/
├── types.ts                  # WaveParams, SurfaceData, Preset
├── presets.ts                # 3 wave presets
├── store/
│   └── params.ts             # localStorage read/write with fallback
├── math/
│   ├── trochoidal.ts         # surfaceZ, wave2Z (combined surface)
│   ├── liveSurface.ts        # causal epoch model: parameter changes propagate as wavefronts
│   └── sampler.ts            # 3D grid sampling for visualizer
├── game/
│   ├── breakField.ts         # peeling breaks, lip, whitewater (SURF mode surface)
│   ├── gates.ts              # gates riding on the wave face
│   ├── score.ts              # score, timed combo window, popups
│   ├── board.ts              # surfer + board mesh
│   ├── audio.ts / highscore.ts
├── assets/
│   └── surferSpriteSheet.ts  # Procedural pixel-art board sprite (SURF mode)
└── visualizer/
    ├── main.ts               # Visualizer loop
    ├── renderer3d.ts         # Three.js scene, mesh, themes
    ├── uiControls.ts         # Slider panel, presets
    └── gameMode.ts           # Third-person SURF mode
```

---

## Adding a new wave equation

1. Add a new function in `src/math/trochoidal.ts` matching the `surfaceZ` signature.
2. Add a `Preset` to `src/presets.ts` — it will appear automatically in the visualizer.

---

## Tech stack

| | |
|-|-|
| Build | Vite |
| Language | TypeScript (strict) |
| 3D | Three.js r170 |
| State | localStorage |
| Font | Press Start 2P |
