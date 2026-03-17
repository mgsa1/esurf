---

## PRE-REVIEW SYSTEM AUDIT

**Branch:** `main` (no commits)  
**State:** Clean greenfield — zero code, zero TODOs, zero technical debt  
**Prior reviews:** None  
**What's in flight:** Nothing. Pure blank canvas.

The plan being reviewed proposes a **2D side-scrolling wave surfer**. The user has explicitly overridden this, demanding a **3D function projected onto 2D canvas** with a **retrowave/synthwave aesthetic** (purple sky, flat pixel fills, bold silhouettes, neon grid lines — exactly like the reference images: city-at-night pool scene, sunset beach shop, modernist pool house).

The original plan's argument "3D is too hard for V1" is now the premise under review. Let me challenge it.

---

## STEP 0 — Premise Challenge & Dream State

**0A. Is 3D projection actually hard here?**

No. The user is describing the classic **OutRun / synthwave grid projection** — a technique from 1986 arcade games, not modern 3D engines. The math is:

```
project(worldX, worldY, worldZ):
  depth = worldY - cam.y          // how far "into" screen
  scale = focalLength / depth
  screenX = canvas.cx + worldX * scale
  screenY = canvas.cy - worldZ * scale
```

That's it. No matrix multiplication, no WebGL, no normals. Canvas 2D can render a 30×30 grid of colored quads at 60fps trivially (~900 draw calls). The original plan's concern was overblown — this is **completely achievable in vanilla Canvas 2D for V1.**

**0B. What the plan gets wrong:**

The current plan renders a 1D wave profile: `y = f(x, t)`. You're surfing a *silhouette* of a curve.

What the user wants — and what's genuinely more interesting — is a **2D surface**: `z = f(x, y, t)`. This lets you:
- Have interference between x-waves and y-waves
- Show saddle points, basins, ridgelines
- Create radially symmetric ripples: `sin(√(x²+y²) − t)`
- Build legitimately complex mathematical terrain

The retrowave grid IS the function visualizer. Every vertex height IS the math.

**0C. Dream State:**

```
  CURRENT PLAN                THIS PLAN (revised)           12-MONTH IDEAL
  ─────────────────────       ───────────────────────       ────────────────────────
  2D side view wave           Retrowave grid                Shareable URL: 
  y = f(x,t) only             z = f(x,y,t) surface          "surf this function"
  Sliders for terms           Sliders + live preview        Typed expression editor
  Static beach BG             Animated retrowave scene      Unlockable wave palettes
  Score: speed/air            Score: speed/air/combo        Leaderboard per function
```

The 12-month ideal is a **math playground that's genuinely beautiful** — people share screenshots of their wave shapes because the visuals are stunning even when you're not playing.

---

Now let me select a mode: