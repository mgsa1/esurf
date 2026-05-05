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
Visual decisions live in `DESIGN.md`. Project overview and parameter reference live in `README.md`.