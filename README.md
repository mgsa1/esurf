# esurf

A tunable ocean surface you can surf. Design a wave in 3D, then ride it.

Two pages share state via localStorage:

- **Game** (`/`) — 2D pixel art surf game. Half-pipe physics on a trochoidal wave cross-section.
- **Visualizer** (`/visualizer.html`) — 3D interactive wave surface with sliders, dual-wave interference, and a first-person SURF mode.

---

## Setup

```
npm install
npm run dev
```

Open `http://localhost:5173` for the game, `http://localhost:5173/visualizer.html` for the visualizer.

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
| `planeOffset` | 0–30 | Distance of the 2D game plane from origin along y-axis |
| `spawnX` / `spawnY` | ±30 | Player spawn position in SURF mode |
| `gridRes` | 40–200 | 3D visualizer resolution per axis |
| `gridExtent` | 10–250 | 3D grid half-width in world units |
| `wave2Enabled` | bool | Enable second wave source |
| `wave2OriginX/Y` | ±50 | Origin of wave 2 |
| `wave2Amplitude` | 0–8 | Height of wave 2 |
| `wave2Wavelength` | 5–60 | Wavelength of wave 2 |
| `wave2SpeedFactor` | 0.1–3 | Speed of wave 2 |

---

## 3D → 2D mapping

The game slices the 3D surface at `y = planeOffset`, producing a 2D wave profile:

```
z_game(x, t) = surfaceZ(x, planeOffset, params, t)
```

Slope is computed analytically (chain rule on the circular wave):

```
dz/dx = −A · k · (x / r) · sin(k·r − ω·t)     where r = √(x² + D²)
```

This slope is the authoritative incline that drives the surfer's gravity physics. Wave 2 contributions are added by superposition.

---

## Game physics

The surfer is a point mass constrained to the wave floor. No engine — all speed builds from slope gravity and wave energy.

**Three states:**

| State | Trigger | Physics |
|-------|---------|---------|
| **Riding** | On surface | Slope gravity: `ax = −g · slope / √(1 + slope²)`. Weight-shift lean (← →) offsets effective slope ±0.20. Surface drag 0.97/s. |
| **Grinding** | At wave crest, \|slope\| < 0.12, \|vx\| > 1.5 | Locked to crest ridge. Heavy friction (0.85/s) bleeds speed. Exits when speed drops below 0.3. |
| **Airborne** | Jump or auto-launch | Pure gravity (9.81 m/s²). Subtle air steering (±0.6 m/s²). Lands when z returns to wave surface. |

**Jump:** Space gives a speed-scaled impulse (5 + \|vx\| × 0.35, capped at 11 m/s).

**Auto-launch:** If the wave rises faster than 2.5 m/s under a surfer moving faster than 3 m/s, the wave tosses them airborne.

**Wave lift:** `dz/dt` — when a crest rises under you, the floor imparts upward velocity. This is the core energy source.

---

## Visualizer SURF mode

The SURF button on the visualizer enters a third-person game mode directly on the 3D wave mesh.

**State machine:** PADDLING → RIDING → AIRBORNE → WIPEOUT → PADDLING

| Key | Action |
|-----|--------|
| `A` / `D` | Carve (riding) / spin (air) / rudder (paddling) |
| `W` | Pump (riding) / paddle (paddling) |
| `S` | Brake |
| `Space` | Jump off lip |
| `R` | Respawn |
| `Esc` | Exit surf mode |

Physics: rail-energy model with speed-squared drag, wave face coupling, and pump timing. The wave provides energy; the player times and directs it. Camera follows with spring-damper smoothing and speed-responsive FOV.

Entering SURF mode switches to a sunset theme (warm orange sky, solid ocean surface, retro grid floor).

---

## Controls

### Game page (`/`)

| Key | Action |
|-----|--------|
| `←` / `→` | Weight-shift lean |
| `Space` | Jump |

### Visualizer page (`/visualizer.html`)

| Input | Action |
|-------|--------|
| Sliders | Adjust wave parameters in real-time |
| Preset buttons | Load gentleSwell, surfBreak, or stormWave |
| Mouse drag/scroll | Orbit and zoom the 3D view |
| SURF button | Enter first-person surf mode |
| DEV LOG button | Toggle development roadmap panel |

---

## Presets

| Name | Amplitude | Wavelength | Speed | Feel |
|------|-----------|-----------|-------|------|
| **gentleSwell** | 1.0 | 30 | 0.8 | Long, slow rolling ocean |
| **surfBreak** | 2.5 | 15 | 1.0 | Classic beach break |
| **stormWave** | 5.0 | 10 | 1.4 | Fast, powerful, steep |

---

## Performance

- **Pre-allocated buffers** — `sampleSurface` writes into a caller-provided `Float32Array`. Zero GC in the hot loop.
- **BufferAttribute.needsUpdate** — geometry is never rebuilt. Position and color buffers are updated in-place with `DynamicDrawUsage`.
- **480×270 canvas** — game runs at low internal resolution, CSS-upscaled with `image-rendering: pixelated`.
- **Analytical derivatives** — slope (`dz/dx`) and wave lift (`dz/dt`) are closed-form, not numerical.
- **Debounce** — visualizer debounces recomputes by 50ms when `gridRes > 120`.

---

## Project structure

```
src/
├── types.ts                  # WaveParams, PlayerState, Preset
├── presets.ts                # 3 wave presets
├── store/
│   └── params.ts             # localStorage read/write with fallback
├── math/
│   ├── trochoidal.ts         # Wave equation, slope, time derivative, 2D sampling
│   └── sampler.ts            # 3D grid sampling for visualizer
├── game/
│   ├── main.ts               # Game loop
│   ├── player.ts             # Half-pipe surf physics
│   ├── renderer2d.ts         # Canvas 2D pixel art rendering
│   └── controls.ts           # Keyboard input
└── visualizer/
    ├── main.ts               # Visualizer loop, wave 2 propagation
    ├── renderer3d.ts         # Three.js scene, mesh, themes
    ├── uiControls.ts         # Slider panel, presets
    └── gameMode.ts           # Third-person SURF mode
```

---

## Adding a new wave equation

1. Add a new function in `src/math/trochoidal.ts` matching the `surfaceZ` signature.
2. Add a `Preset` to `src/presets.ts` — it will appear automatically in the visualizer.
3. If the equation changes the derivative structure, update `surfaceSlope` and `surfaceZdot` to match.

---

## Tech stack

| | |
|-|-|
| Build | Vite (multi-page) |
| Language | TypeScript (strict) |
| 3D | Three.js r170 |
| 2D | Canvas 2D API |
| State | localStorage |
| Font | Press Start 2P |
