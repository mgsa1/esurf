# Architectural Decisions (locked in eng review 2026-03-18)

## Page
Single Vite page:
- `index.html` → `src/visualizer/main.ts` — 3D mathematical surface visualizer with a third-person SURF mode

## Parameter persistence
localStorage (`esurf-params` key). The visualizer writes on every slider change.
`loadParams()` must try/catch and fall back to `getDefaultParams()`.

## 3D geometry updates
Pre-allocated `Float32Array` position buffer. Update in-place per frame, set `attr.needsUpdate = true`. Never rebuild geometry.

## Types
All shared interfaces in `src/types.ts`: `WaveParams`, `SurfaceData`, `Preset`.

## Runtime guards (critical — silent failures without these)
1. `loadParams()`: try/catch → fall back to `getDefaultParams()`
2. Trochoidal phase: cycle `t = t % (2π / max(omega, 0.001))` before `sin()`/`cos()` to prevent float overflow

## Design system
Visual decisions live in `DESIGN.md`.

---

# Development Steps

Copy each prompt below into Claude Code in order. Each step is self-contained.

---

## Step 1 — Project scaffold

```text
Set up the Vite + TypeScript + Three.js project for esurf.

Create:
- package.json with dependencies: vite, typescript, three, @types/three
- vite.config.ts: default single-page build (Vite picks up index.html automatically)
- tsconfig.json: strict mode, moduleResolution bundler, target ES2020
- index.html: visualizer page shell, links to src/visualizer/main.ts via <script type="module">
- src/types.ts: all shared TypeScript interfaces —
    WaveParams (
      A, B1, B2, kTheta, kPhi, omega, omega2, delta, N, nScale,
      sx, sy, sz,
      thetaMin, thetaMax, phiMin, phiMax, thetaRes, phiRes,
      timeScale, thetaSlice
    ),
    SurfaceData (typed array of 3D points),
    Preset (name: string, params: WaveParams)
- src/store/params.ts:
    saveParams(p: WaveParams): void (localStorage),
    loadParams(): WaveParams (try/catch → getDefaultParams()),
    getDefaultParams(): WaveParams
  with sensible defaults:
    A=5, B1=1.2, B2=0.3, kTheta=3, kPhi=2, omega=0.8, omega2=0.4, delta=0,
    N=0.5, nScale=1, sx=1, sy=1, sz=1,
    thetaMin=0, thetaMax=2π, phiMin=0.1, phiMax=π-0.1, thetaRes=80, phiRes=60,
    timeScale=1, thetaSlice=0
- Folder structure (empty index files are fine): src/math/, src/visualizer/, src/store/

Do not implement rendering yet. Just the scaffold, types, and store.


Step 2 - Math layerImplement the math layer for esurf. Reference src/types.ts for all types.

Create:

src/math/noise.ts
  3D value noise. Hash-based: hash(ix,iy,iz) = some fast integer mix (e.g. bit ops on primes).
  Trilinear interpolation over the 8 surrounding integer lattice corners.
  Smooth fade curve: t = t*t*(3-2*t). Output range ≈ [-1, 1]. Must be deterministic.
  Export: noise(x: number, y: number, z: number): number

src/math/parametric.ts
  Implements:
    r(θ, φ, t) =
      A
      + B1*sin(kTheta*θ + kPhi*φ - omega*t + delta)
      + B2*sin(2*kTheta*θ - omega2*t)
      + N*noise(nScale*θ, nScale*φ, t_cycled)

  Guard:
    cycle t_cycled = t % (2*Math.PI / Math.max(params.omega, params.omega2, 0.001))
    before sin() to prevent float overflow at long session lengths.

  Then:
    x = sx * r * sin(φ) * cos(θ)
    y = sy * r * sin(φ) * sin(θ)
    z = sz * r * cos(φ)

  Export:
    computeRadius(theta: number, phi: number, t: number, params: WaveParams): number
    computePoint(theta: number, phi: number, t: number, params: WaveParams): [number, number, number]

src/math/sampler.ts
  Samples all (θ,φ) combinations using nested loops over thetaRes × phiRes.
  Pre-allocates Float32Array of size thetaRes * phiRes * 3 (x,y,z interleaved).
  Writes into an existing buffer to avoid allocation in the hot loop (accept buffer as parameter).
  Export: sampleSurface(params: WaveParams, t: number, buffer: Float32Array): SurfaceData

src/presets.ts
  Export PRESETS: Preset[] with exactly four entries:
  - basicSphere: A=5, B1=0.5, B2=0, N=0 — gentle round wave
  - choppyHarmonic: A=4, B1=1.5, B2=1.0, kTheta=5, kPhi=4 — sharp choppy wave
  - noisyStorm: A=4, B1=0.8, B2=0.3, N=1.5, nScale=2, omega=1.2 — turbulent
  - twistedRibbon: A=3, B1=1.2, kTheta=8, kPhi=1, sz=2, sx=0.5 — asymmetric twist

  Each preset must have at least one of B1, B2, N > 0 (non-flat wave at t=0).

Add comments in each file explaining the math and any performance decisions.

Step 3 - 3D Visualiser page
Implement the 3D visualizer page for esurf.

The visualizer is a mathematical surface plotter. Dark background. Point cloud rendering.

Create:

src/visualizer/renderer3d.ts
  Three.js scene.
  Scene background: #0A0A1A (not default black — see DESIGN.md).
  Camera: PerspectiveCamera(60, aspect, 0.1, 1000).
  Initial position: (12, 8, 12), lookAt(0, 0, 0).
  OrbitControls for mouse rotation/zoom
    (import from 'three/addons/controls/OrbitControls.js').
  enableDamping: true, dampingFactor: 0.05.

  Geometry:
    BufferGeometry with PointsMaterial:
      color #00FFCC,
      size 0.08,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85

  Pre-allocate position Float32Array of size maxRes * maxRes * 3 (use 250*250*3).

  Export a class-based or function-based renderer API, but keep the signature consistent:
    init(canvas: HTMLCanvasElement): boolean
      - sets up scene, camera, renderer, controls
      - returns false if WebGL context fails

    update(surfaceData: SurfaceData): void
      - writes into the pre-allocated buffer
      - sets attr.needsUpdate = true
      - updates drawRange to match actual point count
      - never rebuilds geometry

    render(): void
      - calls controls.update()
      - calls renderer.render(scene, camera)

src/visualizer/uiControls.ts
  Slider panel for all WaveParams. Follow DESIGN.md for colors, typography, and layout.

  Slider ranges:
    A: 1–10, B1: 0–3, B2: 0–2, kTheta: 1–10, kPhi: 1–10
    omega: 0–3, omega2: 0–3, delta: 0–6.28, N: 0–3, nScale: 0.1–5
    sx/sy/sz: 0.1–3, thetaRes: 10–200 (step 10), phiRes: 10–200 (step 10)
    thetaMin/thetaMax: 0–6.28, phiMin/phiMax: 0.01–3.14
    timeScale: 0–2, phiBase: 0.01–3.13, phiAmp: 0–1.2, phiSpeed: 0–3, phiPhase: 0–6.28
    phiMinSafe/phiMaxSafe: 0.01–3.13

  Render sliders in 7 named groups using <details open> / <summary> elements:
    WAVE SHAPE: A, B1, B2, N, nScale
    FREQUENCY: kTheta, kPhi
    ANIMATION: omega, omega2, delta, timeScale
    SLICE MOTION: phiBase, phiAmp, phiSpeed, phiPhase
    SLICE LIMITS: phiMinSafe, phiMaxSafe
    SCALE: sx, sy, sz
    SAMPLING: thetaMin, thetaMax, phiMin, phiMax, thetaRes, phiRes

  Each slider row: grid with 3 columns — label (80px), range input (flex), value display (36px).

  Accessibility:
  - each <input type="range"> must have:
      aria-label="{param name}: {plain English description} ({min}–{max})"
      aria-valuemin
      aria-valuemax
      aria-valuenow (updated on input)
  - preset buttons must have aria-label="Load {preset name} preset"

  Preset buttons row at top of panel (one per PRESETS entry), each with its distinct accent color border (see DESIGN.md "Preset accent colors").

  On any change:
  - update displayed value
  - call onChange(newParams)

  Debounce:
  - add 50ms debounce only when thetaRes × phiRes > 10,000
  - slider still updates visually immediately

  Export:
    initControls(container: HTMLElement, initial: WaveParams, onChange: (p: WaveParams) => void): void

src/visualizer/main.ts
  Load params using loadParams() from src/store/params.ts.
  Init renderer3d on #three-canvas.
  Init uiControls in #controls-panel.

  On control change:
  - saveParams()
  - recompute surface
  - update renderer

  Pre-allocate surface buffer once.

  Animation loop with requestAnimationFrame:
  - increment simTime each frame using params.timeScale
  - recompute surface with sampleSurface(params, simTime, preallocatedBuffer)
  - renderer3d.update(surfaceData)
  - renderer3d.render()

visualizer.html
  Layout: flex row.
  Left: #controls-panel (280px fixed, scrollable).
  Right: #three-canvas fills remaining space.

  Load "Press Start 2P" from Google Fonts.

  Colors and typography: follow DESIGN.md "Visualizer page — Neon Night" palette.

  Panel header row:
  - "esurf" title (Press Start 2P, 11px, #C8C8E8) left

  Three.js canvas clear color: #0A0A1A.

  Loading state:
  - show "INITIALIZING..." centered in canvas
  - Press Start 2P, 10px, #00FFCC
  - hide after first render() call

  WebGL error state:
  - if context creation fails, show "WebGL not available." centered (#FF4444)
  - sliders still work

Step 4 - Integration pass and readme

Final integration and polish pass for esurf.

1. Verify the runtime guards from:
   - src/store/params.ts
   - src/math/parametric.ts

   Add any that are missing.

2. Verify the full flow works:
   - npm run dev starts without TypeScript errors
   - Visualizer page (/) loads with the Three.js mesh
   - Changing a slider in the visualizer updates the surface in real-time
   - Each preset produces a visually distinct surface

3. Write README.md covering:
   - Local setup: npm install && npm run dev
   - The parametric equation: explain each parameter in plain English
   - Performance notes: BufferAttribute.needsUpdate, value noise, pre-allocated buffers
   - How to add a new parametric equation: implement a new equation function matching the computeRadius signature and add a Preset to src/presets.ts

4. Fix any broken imports, type errors, or runtime errors found during verification.

Keep the implementation focused on a stable, fun physics toy.