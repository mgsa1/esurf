# esurf — Design System

Authoritative source for visual decisions. Implementation references this file.

---

## Aesthetic

**Visualizer (default):** Neon-on-dark scientific instrument. Same universe as the surf scene, but rendered as a vectorscope at a beachside recording studio.

**SURF mode:** Retrowave 1980s California golden-hour. Warm dusky palette, saturated sunset sky, retro grid floor — invoked when the rider drops onto the wave.

---

## Color Palette

### Visualizer — Neon Night

| Role               | Hex       | Usage                                      |
|--------------------|-----------|--------------------------------------------|
| Page bg            | `#0A0A1A` | Full page background                       |
| Panel bg           | `#10101E` | Left controls sidebar                      |
| Panel border       | `#2A2A4A` | Right edge of sidebar                      |
| Panel section bg   | `#16162A` | Collapsed/expanded group background        |
| Canvas bg          | `#0A0A1A` | Three.js canvas clear color                |
| Wave crest         | `#00FFCC` | Mesh top color (neon cyan)                 |
| Wave trough        | `#0A0A2A` | Mesh bottom color (near-black)             |
| Text primary       | `#C8C8E8` | Slider labels, values                      |
| Text muted         | `#666680` | Section headers, min/max hints             |
| Accent             | `#FF6EB4` | Active slider thumb, focus rings           |
| SURF button        | `#00FFCC` | Enter SURF mode                            |
| Error text         | `#FF4444` | WebGL error message                        |

### SURF mode — Golden Hour

| Role               | Hex       | Usage                                      |
|--------------------|-----------|--------------------------------------------|
| Sky zenith         | `#C94015` | Top of gradient sky                        |
| Sky mid            | `#E86A20` | Warm orange band                           |
| Sky horizon        | `#FFD070` | Golden yellow at horizon                   |
| Sun core           | `#FFFAC8` | Cream-white sun disc                       |
| Sun edge           | `#FFA03C` | Soft warm orange                           |
| Wave crest (sunset)| `#FFA050` | Mesh crest color                           |
| Wave trough (sunset)| `#1A4035`| Mesh trough color                          |
| Floor grid         | `#9868A0` | Dusty mauve retro grid                     |
| Fog                | `#CC6020` | Warm amber atmospheric fog                 |

### Preset accent colors (visualizer sidebar buttons)

| Preset            | Border color | Active bg                |
|-------------------|--------------|--------------------------|
| longboardCruise   | `#00FFCC`    | `rgba(0,255,204,0.15)`   |
| crossSeas         | `#FF6EB4`    | `rgba(255,110,180,0.15)` |
| bigWaveDay        | `#FFB800`    | `rgba(255,184,0,0.15)`   |

---

## Typography

- **Page title "esurf — wave visualizer"**: `"Press Start 2P"`, 11px, color `#C8C8E8`, in sidebar header.
- **Slider labels / values**: `'Courier New', monospace`, 11px, `#C8C8E8`.
- **Section group headers**: `'Courier New', monospace`, 9px, uppercase, `#666680`, letter-spacing 0.1em.
- **Preset button labels**: `'Courier New', monospace`, 10px, uppercase.
- **HUD readouts (SURF mode)**: `"Press Start 2P"`, 6–8px, white or neon cyan.

Font loading: `<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">`.

---

## Layout

### index.html

```
┌────────────────┬────────────────────────────────┐
│ #controls-panel│                                 │
│   280px fixed  │        #three-canvas            │
│   scrollable   │        flex-1, full height      │
│                │                                 │
│  [header]      │                                 │
│  [presets row] │                                 │
│  ▼ WAVE        │                                 │
│  ▼ GAME        │                                 │
│  ▼ SAMPLING    │                                 │
│  ▼ WAVE 2      │                                 │
│  ▼ WALL        │                                 │
└────────────────┴────────────────────────────────┘
```

- Panel header: `14px` padding, "esurf" title + "SURF ▶" button + "DEV LOG" button.
- Group sections: collapsible with `<details>/<summary>` tags.
- Slider rows: `display: grid; grid-template-columns: 80px 1fr 56px; gap: 4px; align-items: center`.
- Time control: vertical slider in a floating panel on the right edge of the canvas.

---

## Loading & Error States

- **Loading**: Before Three.js first render, `#three-canvas` shows centered text: `"INITIALIZING..."` in `"Press Start 2P"` 10px `#00FFCC`. Removed on first `render()` call.
- **WebGL unavailable**: If context creation fails, show `"WebGL not available."` centered in `#FF4444`. Sliders still function (math layer is independent).

---

## Interaction Design

### Slider feedback
- Value display updates live on `input`, not on `change`.
- Surface recomputes immediately. 50ms debounce only when `gridRes > 120`.

### Preset buttons
- Row of buttons at top of controls panel, each with its own accent color border.
- Click fills all sliders with preset values and triggers onChange.
- Active state: accent background fill (`rgba(color, 0.15)`).

### SURF mode
- Press SURF button or `Esc` to toggle.
- Controls hint shown bottom-right: `A/D: CARVE · W: PUMP · S: BRAKE · SPACE: JUMP · R: RESPAWN`.

---

## Not in Scope (v1)

- Sound / music
- Score display
- Animated sky (parallax clouds, moving sun)
- Dark mode toggle for visualizer
