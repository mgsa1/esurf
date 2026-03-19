# esurf — Design System

Derived from design inspirations in `docs/designs/`. This is the authoritative source for all visual decisions. Implementation steps in CLAUDE.md reference this file.

---

## Aesthetic

**Retrowave pixel art. 1980s California golden-hour surf scene.**

Not generic "retro" — specifically: the warm dusky palette of late-afternoon LA beach, point light sources, heavily saturated sunset sky, deep-blue chunky pixel waves with white foam dots, palm tree silhouettes. Think Sega/NEC PC-88 beach game meets synthwave album cover.

The visualizer is the "debug instrument" counterpart: same universe, nighttime palette, neon-on-dark. Scientific but retro — like a vectorscope at a beachside recording studio.

---

## Color Palette

### Game page — Golden Hour

| Role               | Hex       | Usage                                      |
|--------------------|-----------|--------------------------------------------|
| Sky top            | `#1E0A3C` | Canvas top, deep violet                    |
| Sky mid            | `#7B2D5C` | Sky gradient midpoint, purple-magenta      |
| Sky horizon        | `#D4623A` | Sky gradient near waterline, rust orange   |
| Sun disc           | `#FFD060` | Sun in sky_background.png                  |
| Wave deep          | `#0F2A6E` | Wave body fill — shadow/depth              |
| Wave mid           | `#1A4A9F` | Wave body fill — primary                   |
| Wave surface       | `#2E70C8` | Wave upper surface, lighter blue           |
| Wave crest stroke  | `#5299DC` | 1px stroke along wave top                  |
| Foam highlight     | `#B8DAFF` | Crest highlight dots (every ~8px)          |
| Foam white         | `#FFFFFF` | Peak foam pixels                           |
| Sand               | `#D4A870` | Beach foreground tint reference            |
| HUD text           | `#FFFFFF` | "esurf" title, button labels               |
| HUD bg             | `rgba(0,0,0,0.55)` | Pill behind HUD elements          |
| Page bg            | `#0D0A1A` | Behind the canvas letterbox                |

### Visualizer page — Neon Night

| Role               | Hex       | Usage                                      |
|--------------------|-----------|--------------------------------------------|
| Page bg            | `#0A0A1A` | Full page background                       |
| Panel bg           | `#10101E` | Left controls sidebar                      |
| Panel border       | `#2A2A4A` | Right edge of sidebar                      |
| Panel section bg   | `#16162A` | Collapsed/expanded group background        |
| Canvas bg          | `#0A0A1A` | Three.js canvas clear color                |
| Point cloud        | `#00FFCC` | Default point color (neon cyan)            |
| Text primary       | `#C8C8E8` | Slider labels, values                      |
| Text muted         | `#666680` | Section headers, min/max hints             |
| Accent             | `#FF6EB4` | Active slider thumb, focus rings           |
| Nav link           | `#00FFCC` | "Play Game →" link                         |
| Error text         | `#FF4444` | WebGL error message                        |

### Preset accent colors (visualizer sidebar buttons)

| Preset           | Border color | Active bg          |
|------------------|--------------|--------------------|
| basicSphere      | `#00FFCC`    | `rgba(0,255,204,0.15)` |
| choppyHarmonic   | `#FF6EB4`    | `rgba(255,110,180,0.15)` |
| noisyStorm       | `#FFB800`    | `rgba(255,184,0,0.15)` |
| twistedRibbon    | `#9B6EFF`    | `rgba(155,110,255,0.15)` |

---

## Typography

### Game page

- **"esurf" title**: `"Press Start 2P"` (Google Fonts), 10px, color `#FFFFFF`. Load via `<link>` in index.html.
- **"Open Visualizer →" button**: same font, 8px, wrapped in a HUD pill.

### Visualizer page

- **Page title "esurf — wave visualizer"**: `"Press Start 2P"`, 11px, color `#C8C8E8`, in sidebar header.
- **Slider labels / values**: `'Courier New', monospace`, 11px, `#C8C8E8`.
- **Section group headers** (WAVE SHAPE, FREQUENCY, etc.): `'Courier New', monospace`, 9px, uppercase, `#666680`, letter-spacing 0.1em.
- **Preset button labels**: `'Courier New', monospace`, 10px, uppercase.

Font loading: add `<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">` to both HTML pages.

---

## Layout

### index.html (game page)

```
┌──────────────────────────────────────────────────┐  full viewport
│ [esurf]  (top-left, 12px pad, HUD pill)          │
│                            [Open Visualizer →]    │  (top-right)
│                                                   │
│            #game-canvas — 480×270 upscaled        │
│         (centered, letterboxed on #0D0A1A bg)     │
│                                                   │
└──────────────────────────────────────────────────┘
```

- Canvas is centered with `margin: auto` in a flex container.
- HUD overlay is `position: absolute`, `top: 12px`, `left: 12px` / `right: 12px`.
- HUD pills: `padding: 4px 8px`, `border-radius: 4px`, `background: rgba(0,0,0,0.55)`, `border: 1px solid rgba(255,255,255,0.15)`.

### visualizer.html

```
┌────────────────┬────────────────────────────────┐
│ #controls-panel│                                 │
│   280px fixed  │        #three-canvas            │
│   scrollable   │        flex-1, full height      │
│                │                                 │
│  [header]      │                                 │
│  [presets row] │                                 │
│  ▼ WAVE SHAPE  │                                 │
│    A  [====]   │                                 │
│    B1 [====]   │                                 │
│    ...         │                                 │
│  ▼ FREQUENCY   │                                 │
│    ...         │                                 │
└────────────────┴────────────────────────────────┘
```

- Panel header: `14px` padding, "esurf" title + "Play Game →" link on same row.
- Group sections: collapsible with `<details>/<summary>` tags. All open by default.
- Slider rows: `display: grid; grid-template-columns: 80px 1fr 36px; gap: 4px; align-items: center`.

---

## Control Panel Slider Groups

Render sliders in these 6 named groups (not a flat list):

| Group label   | Params                                              |
|---------------|-----------------------------------------------------|
| WAVE SHAPE    | A, B1, B2, N, nScale                               |
| FREQUENCY     | kTheta, kPhi                                        |
| ANIMATION     | omega, omega2, delta                                |
| GAME PLANE    | thetaSlice                                          |
| SCALE         | sx, sy, sz                                          |
| SAMPLING      | thetaMin, thetaMax, phiMin, phiMax, thetaRes, phiRes |

timeScale lives in its own floating panel on the right edge of the canvas (not in the sidebar).

**Game plane geometry**: thetaSlice defines a flat vertical half-plane through the z-axis. The 2D gameplay wave is the curve obtained by fixing θ = thetaSlice and sweeping φ from phiMin to phiMax. This half-plane correctly intersects the ocean floor (z = 0) at φ = π/2.

Each group is a `<details open>` element. `<summary>` shows the group label in muted uppercase.

---

## Wave Rendering Spec (2D game canvas)

### Layer order (back to front)

1. **sky_background.png** — `drawImage(img, 0, 0, 480, 270)` stretched to fill.
2. **Wave body** — generated from WaveData2D each frame:
   - Height mapping: `screenY(z) = clamp(WAVE_CENTER_Y - (z - Z_BASELINE) * WAVE_SCALE, 20, 240)`
   - `screenX = wave.xs[i] * 480` (xs are normalized to [0,1] for rendering)
   - Fill path from wave crest to `y=270` (canvas bottom): fill with `#1A4A9F`.
   - Draw second fill offset by +8px: fill with `#0F2A6E` (adds depth stripe).
   - Draw crest stroke 1px: `#5299DC`.
   - Scatter foam dots: every 8 screen-x pixels along the crest, draw a 2×1 white rect if `Math.sin(x * 0.7 + simTime * 2) > 0.6`.
3. **beach_foreground.png** — `drawImage(img, 0, 220, 480, 50)` anchored to bottom.
4. **Surfer sprite** — `drawImage(sprite, Math.round(px), Math.round(py), 16, 24)`.
   - `px = wave.xs[Math.round(playerState.sampleIndex)] * 480 - 8` (center sprite on wave x position)
   - `py = screenY(playerState.z) - 24` (sprite sits on top of wave crest)

### Height mapping formula
```
const WAVE_CENTER_Y = 160;       // screen y for wave at default z
const WAVE_SCALE    = 35;        // pixels per unit of z
const Z_BASELINE    = ...;       // choose based on default phiBase / default params
screenY(z) = clamp(WAVE_CENTER_Y - (z - Z_BASELINE) * WAVE_SCALE, 20, 240)
normalizeXToScreen(xNorm) = xNorm * 480   // xs are pre-normalized in waveExtractor
```

Export these constants from `renderer2d.ts` for use in `player.ts` coordinate transforms.

---

## Loading & Error States

### Visualizer page

- **Loading**: Before Three.js first render, `#three-canvas` shows centered text: `"INITIALIZING..."` in `"Press Start 2P"` 10px `#00FFCC`. Remove on first `render()` call.
- **WebGL unavailable**: If `renderer.getContext()` fails, show: `"WebGL not available."` centered, `#FF4444`, same font. Panel still renders and sliders still work (math layer is independent).

### Game page

- **Asset loading**: Sky and foreground PNGs load async. Until loaded, fill background with `#1E0A3C` (sky top color) and draw the wave — game is playable immediately, sprites appear when ready.
- **No loading spinner** — pixel art loads fast enough; avoid generic spinner.

---

## Interaction Design

### Slider feedback
- Value display updates live (`oninput`), not on commit (`onchange`).
- On param change: surface recomputes immediately (no debounce at default resolution; add 50ms debounce only if thetaRes × phiRes > 10,000).

### Preset buttons
- Row of 4 buttons at top of controls panel, each with its own accent color border.
- On click: fill all sliders with preset values, trigger onChange with new params.
- Active state: accent background fill (`rgba(color, 0.15)`).

### Game controls
- Controls: `ArrowLeft` / `ArrowRight` to move, `Space` to jump.
- No on-screen controls for the prototype (desktop-first).
- On mobile: show a fixed notice `"Desktop only — use arrow keys + space"` centered on the canvas (pixel font, semi-transparent overlay).

---

## Not in Scope (v1)

- Mobile virtual joystick (see TODOS.md for future work)
- Sound / music
- Particle effects (foam splashes)
- Score display
- Animated sky (moving sun, parallax clouds)
- Dark mode toggle for visualizer
