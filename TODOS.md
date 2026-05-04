# TODOS

## TODO-1: Shareable preset URL format

**What:** Encode current `WaveParams` as base64 JSON in the URL hash (e.g. `/#eyJBIjo1...`). Read from URL hash on load, falling back to localStorage then defaults.

**Why:** Makes it easy to share interesting wave configurations as links.

**Pros:** Zero server infrastructure. Bookmarkable, shareable, great for showcasing the parametric system.

**Cons:** URL gets long for complex configs. Need to validate decoded params (malformed input).

**Context:** With ~17 parameters, a base64-encoded JSON blob is ~200 chars in the URL hash. Guards needed: JSON.parse in try/catch, schema validation against min/max ranges per param.

---

## TODO-2: WebWorker offloading for surface sampling

**What:** Move the surface sampling loop into a WebWorker, returning vertex positions to the main thread via `SharedArrayBuffer` or `postMessage` with transferable `Float32Array`.

**Why:** At resolutions above 200×200 (40k vertices), the main thread JS loop may cause frame drops and UI jank. Workers keep the main thread free.

**Pros:** Unlocks high-fidelity surface rendering without frame rate impact. Clean separation of math from rendering.

**Cons:** `SharedArrayBuffer` requires cross-origin isolation headers (COOP/COEP). `postMessage` with transfer avoids this but has a round-trip latency. Adds complexity to the animation loop (async vertex delivery).

**Context:** At 100×100 (default), the main thread is fine. This becomes relevant when users push resolution sliders above 150. Profile with Chrome DevTools first — don't implement until there's evidence of jank at realistic resolutions.

---

## TODO-3: Drop marbles onto the wave surface

**What:** A "MARBLES" button in the visualizer panel header (next to SURF) that drops a batch of colorful marbles onto the 3D wave surface. Marbles fall under gravity, bounce off the surface using reflection physics, and scatter based on wave slope and motion. Purely visual/fun — no rider collision.

**Why:** Makes the wave surface tangible and interactive. Watching marbles bounce and scatter reveals the wave's shape, slope, and motion in a way that static geometry doesn't.

**How:**
- New file: `src/visualizer/marbles3d.ts`
- Pre-allocated ring buffer (48 marbles max), same pattern as `gameMode.ts` particle system
- THREE.Points with per-vertex colors (6-color pixel art palette: coral, teal, yellow, mint, pink, seafoam)
- Each click spawns 5–10 marbles at random (x, y) within `gridExtent`, high z, downward velocity only
- Physics per frame: gravity → integrate → bounce detection against `surfaceZ(x, y, params, t)`
- Bounce: compute 3D surface normal via finite differences on `surfaceZ`, reflect velocity, scale by restitution (~0.65)
- Wave push: add an upward boost on bounce so rising crests launch marbles higher (estimate `dz/dt` via finite difference on `surfaceZ`)
- Settle/lifetime cleanup: kill marbles when speed < 0.25 or age > 15s
- Button hidden during SURF mode (already handled — it's inside `#controls-panel` which hides)
- Update marbles in the `else` branch of the main loop (visualizer-only, not during SURF mode)

**Key physics detail:** Marbles start with only downward velocity. On first bounce off a sloped surface, normal reflection converts vertical momentum into horizontal — marbles naturally scatter on slopes and stay put on flat water.

**Pros:** Low complexity, high visual payoff. Zero-cost when idle (skip update/draw when no marbles alive). Reuses existing patterns (ring buffer, THREE.Points, `surfaceZ`).

**Cons:** 4–6 extra `surfaceZ` calls per marble per frame for normal computation (finite differences). At 48 marbles that's ~240 trig evaluations — negligible.

**Depends on / blocked by:** Core visualizer implementation (renderer3d, trochoidal math).
