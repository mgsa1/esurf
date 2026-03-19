# TODOS

## TODO-1: BroadcastChannel live-sync

**What:** When params are changed in the visualizer tab, broadcast them to any open game tabs in real-time (currently localStorage only syncs on game page load).

**Why:** Enables a compelling demo where you can tweak wave parameters in the visualizer and watch the game wave update live without navigating away.

**Pros:** Better DX for wave design; makes the parameter-game coupling immediately visible.

**Cons:** Small added complexity (BroadcastChannel + event handler in game page). Must fall back gracefully when no visualizer tab is open.

**Context:** Currently `params.ts` saves to localStorage. The game page reads on load. The BroadcastChannel would be an additive layer — visualizer posts on every param change, game subscribes and applies. localStorage stays as the persistence layer.

**Depends on / blocked by:** Core implementation (localStorage params) must exist first.

---

## TODO-2: Shareable preset URL format

**What:** Encode current `WaveParams` as base64 JSON in the URL hash (e.g. `/visualizer.html#eyJBIjo1...`). Both pages read from URL hash on load, falling back to localStorage then defaults.

**Why:** Makes it easy to share interesting wave configurations as links.

**Pros:** Zero server infrastructure. Bookmarkable, shareable, great for showcasing the parametric system.

**Cons:** URL gets long for complex configs. Need to validate decoded params (malformed input).

**Context:** With 17 parameters, a base64-encoded JSON blob is ~200 chars in the URL hash. Guards needed: JSON.parse in try/catch, schema validation against min/max ranges per param.

**Depends on / blocked by:** Core implementation must exist first. Build after TODO-1 so URL and BroadcastChannel both use the same params format.

---

## TODO-3: WebWorker offloading for surface sampling

**What:** Move the `r(θ,φ,t)` computation loop into a WebWorker, returning vertex positions to the main thread via `SharedArrayBuffer` or `postMessage` with transferable `Float32Array`.

**Why:** At resolutions above 200×200 (40k vertices), the main thread JS loop may cause frame drops and UI jank. Workers keep the main thread free.

**Pros:** Unlocks high-fidelity surface rendering without frame rate impact. Clean separation of math from rendering.

**Cons:** `SharedArrayBuffer` requires cross-origin isolation headers (COOP/COEP). `postMessage` with transfer avoids this but has a round-trip latency. Adds complexity to the animation loop (async vertex delivery).

**Context:** At 100×100 (default), the main thread is fine. This becomes relevant when users push resolution sliders above 150. Start by profiling with Chrome DevTools before implementing.

**Depends on / blocked by:** Core implementation. Profile first — don't implement until there's evidence of jank at realistic resolutions.

---

## TODO-4: phiSlice as a live control

**What:** Expose φ₀ (the fixed phi angle used in `waveExtractor.ts`) as a slider in both the visualizer and the game UI, stored in `WaveParams`.

**Why:** φ₀ is currently hard-coded to π/4. Changing it sweeps a different latitude band of the 3D surface, producing strong slope and shape variation for free — no extractor rewrite needed, no extra sampling cost.

**Pros:** High bang-for-buck. One new `WaveParams` field + one slider + remove the hard-coded constant from `waveExtractor.ts`. Dramatically expands the gameplay variety available from the existing fixed-slice strategy, making it feel like a new control without paying for a more expensive projection method.

**Cons:** φ₀ near 0 or π makes `sin(φ)` → 0, collapsing x-coordinates to a point (degenerate wave). Guard: clamp slider to [0.1, π - 0.1].

**Context:** `waveExtractor.ts` is already the designated swap point for projection strategies. The constant `π/4` on line N is the only thing that needs to become a param lookup. Add `phiSlice: number` to `WaveParams` with default π/4, min 0.1, max ~2.8.

**Depends on / blocked by:** Core implementation (Step 2). Trivial to add in or after Step 5.

---

## TODO-5: Animated foam spray on wave crest

**What:** Replace the static sin()-scatter foam dots on the wave crest with short-lived pixel bursts. At each frame, sample the 3–5 highest-velocity crest points (where the wave slope changes most steeply). At those x-positions, emit a 2–3px pixel burst that persists for 2–3 frames then fades (simple alpha decay on a small particle array).

**Why:** The current `sin(x * 0.7 + t * 2) > 0.6` scatter is deterministic and visually regular — it reads as a pattern, not foam. Velocity-driven bursts make the foam feel physically responsive to the wave shape.

**Pros:** Significantly improves visual fidelity at the game's most visually prominent feature (the wave crest) for minimal performance cost (~10 particles max). Stays within the 480×270 pixel art aesthetic. Makes each wave preset feel distinctly different (choppy waves foam more than gentle ones).

**Cons:** Requires tracking a small particle array in renderer2d.ts across frames (tiny bit of state). Must compute wave velocity (delta of heights between frames — one extra Float32Array of size thetaRes).

**Context:** The foam is currently drawn in `renderer2d.ts` layer 2e. The particle array would live in the renderer module's closure. Wave velocity = `heights[i] - prevHeights[i]` per frame. Threshold for burst: `|velocity| > 0.15` (tune to taste).

**Depends on / blocked by:** Core implementation (Step 4). Add after the basic wave renderer is working.
