# Architectural Decisions (locked in eng review 2026-03-18)

## Pages
Two separate Vite pages:
- `index.html` → `src/game/main.ts` — 2D pixel art surf game (1980s California sunset beach style)
- `visualizer.html` → `src/visualizer/main.ts` — 3D mathematical surface visualizer

## 3D → 2D mapping
The gameplay is strictly 2D. The surfable wave is a 2D parametric curve obtained from a θ-slice of the 3D surface.

**Why θ-slice and not φ-slice:**
- A fixed φ defines a cone (z/r = cos(φ) = const), which never reaches z = 0 for φ < π/2. It cannot span the wave face to the ocean floor.
- A fixed θ defines a flat vertical half-plane through the z-axis. Sweeping φ from phiMin to phiMax traces the wave face naturally from the top (φ ≈ 0, z ≈ sz·A) down to the ocean floor (φ = π/2, z = 0 exactly).

Define:
- `simTime += dt * timeScale`
- `thetaSlice` = fixed θ angle for the game plane (WaveParams field, default 0)

For each φ in `[phiMin, phiMax]`:
- `[x, y, z] = computePoint(thetaSlice, φ, simTime, params)`
- `h = sqrt(x² + y²)` — in-plane horizontal distance from z-axis
- `xs[i] = i / (phiRes - 1)` — uniform [0,1] for rendering
- `zs[i] = z`
- `slopes[i] = dz/dh` — from central differences on h and z

The gameplay wave is the sampled 2D curve `(xs[i], zs[i])` with slopes for gravity physics.

Implemented in `src/math/waveExtractor.ts` (standalone file — swap point for future strategies).

## Parameter sharing
localStorage (`esurf-params` key). Both pages read on load, visualizer writes on every change.  
`loadParams()` must try/catch and fall back to `getDefaultParams()`.

## 2D canvas
Internal resolution `480×270`, CSS-upscaled to fill viewport with `image-rendering: pixelated`.

## 3D geometry updates
Pre-allocated `Float32Array` position buffer. Update in-place per frame, set `attr.needsUpdate = true`. Never rebuild geometry.

## Noise
3D value noise (hash-based integer lookup + trilinear lerp). ~20 lines, deterministic, zero dependencies.

## Types
All shared interfaces in `src/types.ts`: `WaveParams`, `SurfaceData`, `WaveData2D`, `PlayerState`, `Preset`.

## Runtime guards (critical — silent failures without these)
1. `loadParams()`: try/catch → fall back to `getDefaultParams()`
2. `computeRadius()`: cycle `t = t % (2π / max(omega, omega2, 0.001))` before `sin()` to prevent float overflow
3. `waveExtractor`: guard `phiRes >= 3`
4. `player.ts`: clamp player sample position to `[0, waveData.xs.length - 1]` before slope lookup
5. `waveExtractor`: if `abs(h[i+1] - h[i-1]) < 1e-6`, set slope to `0`

## Design system
All visual decisions are in `DESIGN.md`. Steps 3 and 4 reference it for colors, typography, layout, and component specs.

---

# Development Steps

Copy each prompt below into Claude Code in order. Each step is self-contained.

---

## Step 1 — Project scaffold

```text
Set up the Vite + TypeScript + Three.js project for esurf.

Create:
- package.json with dependencies: vite, typescript, three, @types/three
- vite.config.ts: multi-page build with input { game: 'index.html', visualizer: 'visualizer.html' }
- tsconfig.json: strict mode, moduleResolution bundler, target ES2020
- index.html: game page shell, links to src/game/main.ts via <script type="module">
- visualizer.html: visualizer page shell, links to src/visualizer/main.ts via <script type="module">
- src/types.ts: all shared TypeScript interfaces —
    WaveParams (
      A, B1, B2, kTheta, kPhi, omega, omega2, delta, N, nScale,
      sx, sy, sz,
      thetaMin, thetaMax, phiMin, phiMax, thetaRes, phiRes,
      timeScale, thetaSlice
    ),
    SurfaceData (typed array of 3D points),
    WaveData2D (parallel Float32Arrays: xs, zs, slopes, all length phiRes),
    PlayerState (sampleIndex, z, vx, vz, onGround: boolean),
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
- Folder structure (empty index files are fine): src/math/, src/game/, src/visualizer/, src/store/

Do not implement rendering or game logic. Just the scaffold, types, and store.


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

src/math/waveExtractor.ts
  The gameplay is strictly 2D and is derived from a θ-slice of the 3D surface.

  Fix θ = params.thetaSlice (a flat vertical half-plane through the z-axis).
  Sweep φ from params.phiMin to params.phiMax in params.phiRes steps.

  For each φ_i:
    [x, y, z] = computePoint(thetaSlice, φ_i, simTime, params)
    xs[i] = i / (phiRes - 1)          // uniform [0,1] for rendering
    zs[i] = z
    rawH[i] = sqrt(x² + y²)           // in-plane horizontal distance

  Compute slopes from central differences on rawH and zs:
    slopes[i] = (zs[next] - zs[prev]) / (rawH[next] - rawH[prev])

  Guard:
    if phiRes < 3, throw Error('phiRes must be >= 3')
    if abs(rawH[next] - rawH[prev]) < 1e-6, set slopes[i] = 0

  Export:
    extract2DWave(params: WaveParams, simTime: number): WaveData2D

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
  - "Play Game →" link (#00FFCC) right

  Three.js canvas clear color: #0A0A1A.

  Loading state:
  - show "INITIALIZING..." centered in canvas
  - Press Start 2P, 10px, #00FFCC
  - hide after first render() call

  WebGL error state:
  - if context creation fails, show "WebGL not available." centered (#FF4444)
  - sliders still work

Step 4 - 2D Pixel art beach game

Implement the 2D pixel art surf game for esurf.

Visual style:
1980s California sunset beach pixel art.

Assets in src/assets/:
- sky_background.png
- beach_foreground.png
- surfer_sprite_front.png
- surfer_sprite_back.png

Create:

src/game/renderer2d.ts
  Internal canvas: 480×270 pixels.
  CSS: width 100%, image-rendering: pixelated.
  Follow DESIGN.md "Wave Rendering Spec" for all colors and layer logic.

  Coordinate mapping helpers (export from this file for player.ts to use):
    normalizeXToScreen(xNorm) = xNorm * 480
    screenY(z) = clamp(WAVE_CENTER_Y - (z - Z_BASELINE) * WAVE_SCALE, 20, 240)

  Choose sensible constants for:
    Z_BASELINE based on default phiBase / default parameters
    WAVE_CENTER_Y and WAVE_SCALE for stable on-screen framing

  Render layers in order (back to front):
    1. sky_background.png
       - drawImage stretched to fill 480×270
       - if not yet loaded, fill #1E0A3C

    2. Wave body — from WaveData2D:
       a. Build crest path: for each sample use screenX = wave.xs[i] * 480, screenY = screenY(wave.zs[i])
       b. Fill crest-to-bottom path with #1A4A9F (primary wave body)
       c. Offset crest path down by +8px, fill with #0F2A6E (depth stripe — layered ocean look)
       d. Draw crest stroke 1px: #5299DC
       e. Foam dots: for each screenX at step 8, if sin(screenX * 0.7 + simTime * 2) > 0.6 draw a 2×1 white (#FFFFFF) rect at (screenX, crestY)

    3. beach_foreground.png
       - drawImage(img, 0, 220, 480, 50) anchored to bottom
       - if not loaded, skip

    4. Surfer sprite
       - use surfer_sprite_front.png (or back if vx < 0)
       - px = Math.round(wave.xs[Math.round(playerState.sampleIndex)] * 480 - 8)
       - py = Math.round(screenY(playerState.z) - 24)
       - drawImage(sprite, px, py, 16, 24)

  Asset loading:
  - preload all 4 images on init
  - game renders immediately; assets appear as they load

  Export:
    initRenderer(canvas: HTMLCanvasElement): void
    drawFrame(wave: WaveData2D, player: PlayerState, simTime: number): void

src/game/player.ts
  PlayerController class.

  State:
    PlayerState — sampleIndex (0 to thetaRes-1, float), z, vx, vz, onGround

  update(
    wave: WaveData2D,
    input: { left: boolean, right: boolean, jump: boolean },
    dt: number
  ): void

    - Clamp sampleIndex to [0, wave.xs.length - 1] before any lookup (critical guard).
    - On ground:
      - move along the sampled wave by updating sampleIndex
      - use the local slope from wave.slopes at the current sample as the authoritative incline
      - adjust motion using slope
      - apply friction
      - snap z to the wave.zs value at current sample
      - if jump pressed, set vz = jumpImpulse and onGround = false
    - Airborne:
      - apply gravity to vz
      - advance z by vz * dt
      - advance sampleIndex by vx * dt
      - land when z <= wave.zs at current sample

  Export:
    class PlayerController with getState(): PlayerState

src/game/controls.ts
  Track keydown/keyup for ArrowLeft, ArrowRight, Space.
  Export:
    initControls(): void
    getInput(): { left: boolean, right: boolean, jump: boolean }

src/game/main.ts
  Load params with loadParams() (fallback to getDefaultParams()).
  Init canvas (#game-canvas), renderer2d, player (start at sampleIndex = thetaRes / 2), controls.

  Maintain simulation time separately:
    simTime += dt * params.timeScale

  requestAnimationFrame loop:
    - compute dt from rAF timestamps
    - clamp dt to a safe max (e.g. 0.05)
    - increment simTime using timeScale
    - extract2DWave(params, simTime) → wave
    - player.update(wave, getInput(), dt)
    - drawFrame(wave, player.getState(), simTime)

index.html
  Load "Press Start 2P" from Google Fonts.
  Page background: #0D0A1A.
  Canvas centered with margin:auto in a flex container.

  #game-canvas:
  - 480×270 internal resolution
  - CSS width: 100vw
  - CSS height: 100vh
  - object-fit: contain
  - image-rendering: pixelated

  HUD overlay (position:absolute, pointer-events:none except buttons):
    Top-left:
      "esurf" in Press Start 2P, 10px, #FFFFFF
      wrapped in pill (see DESIGN.md "HUD pills")
    Top-right:
      "Open Visualizer →" button
      Press Start 2P, 8px, #FFFFFF
      same pill style
      pointer-events:auto
    Bottom-center:
      "← → SPACE" hint
      Press Start 2P, 7px, rgba(255,255,255,0.4)
      no pill — ghost text only

  Both top pills:
  - top: 12px
  - padding: 4px 8px
  - border-radius: 4px
  - background: rgba(0,0,0,0.55)
  - border: 1px solid rgba(255,255,255,0.15)

  Mobile notice:
  - if window.innerWidth < 768, show centered overlay
    "Desktop only — use arrow keys + space"
    Press Start 2P, 8px, rgba(0,0,0,0.75) bg

  Link to src/game/main.ts.

Step 5 - Integration pass and readme

Final integration and polish pass for esurf.

1. Verify the runtime guards from:
   - src/store/params.ts
   - src/math/parametric.ts
   - src/math/waveExtractor.ts
   - src/game/player.ts

   Add any that are missing.

2. Verify the full flow works:
   - npm run dev starts without TypeScript errors
   - Game page (/) loads with default params and a visible animated wave
   - Surfer responds to ArrowLeft, ArrowRight, Space
   - Visualizer page (/visualizer.html) loads with the Three.js point cloud
   - Changing a slider in the visualizer updates the surface in real-time
   - Navigating from visualizer → game shows the wave matching the last-saved params
   - Each of the 4 presets produces a visually distinct wave on both pages

3. Write README.md covering:
   - Local setup: npm install && npm run dev
   - The parametric equation: explain each parameter in plain English
   - 3D → 2D mapping:
     "The gameplay wave is a 2D parametric XZ cross-section from a time-varying φ-slice.
      For each θ sample, compute x(θ,t) and z(θ,t) from the 3D surface,
      then derive local slope as dz/dx from neighboring samples."
   - Performance notes:
     BufferAttribute.needsUpdate, 480×270 upscaled canvas, value noise, pre-allocated buffers
   - How to add a new parametric equation:
     implement a new equation function matching the computeRadius signature,
     add a Preset to src/presets.ts
   - Controls:
     ArrowLeft/Right to move, Space to jump

4. Fix any broken imports, type errors, or runtime errors found during verification.

Do not add a score system.
Keep the implementation focused on a stable, fun physics toy.