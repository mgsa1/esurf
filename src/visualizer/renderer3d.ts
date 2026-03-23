/**
 * 3D visualizer renderer using Three.js.
 *
 * Renders the trochoidal ocean surface as an animated triangle mesh.
 * The mesh is a flat gridRes × gridRes grid in the XY plane with z displaced
 * each frame by the wave height function.
 *
 * Performance:
 * - Index buffer computed once at init (never changes).
 * - Position + color buffers pre-allocated, updated in-place each frame.
 * - DynamicDrawUsage hint for GPU driver optimization.
 * - No geometry rebuild — only needsUpdate = true on position/color attributes.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { surfaceZ } from '../math/trochoidal';
import type { SurfaceData, WaveParams } from '../types';

// Number of points used to trace the wave profile at y = 0
const PROFILE_SAMPLES = 300;

// Max supported gridRes: 200 → 200×200 = 40,000 vertices, 39,601 quads × 2 tris
const MAX_GRID_RES = 200;
const MAX_VERTS = MAX_GRID_RES * MAX_GRID_RES;
// Max triangle index for gridRes=200 is 39999 → fits Uint16Array (max 65535)
const MAX_INDICES = (MAX_GRID_RES - 1) * (MAX_GRID_RES - 1) * 6;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;

let meshGeometry: THREE.BufferGeometry;
let positionAttribute: THREE.BufferAttribute;
let colorAttribute: THREE.BufferAttribute;
let positionBuffer: Float32Array;
let colorBuffer: Float32Array;
let indexBuffer: Uint16Array;

// Game plane at y = 0 (the XZ slice the surfer rides)
let gamePlaneMesh: THREE.Mesh;
let gameProfileLine: THREE.Line;
let gameProfileBuffer: Float32Array;
let gameProfileAttribute: THREE.BufferAttribute;

// Wave origin markers: ring + vertical spike + text label
let wave1Ring: THREE.Line;
let wave1Spike: THREE.Line;
let wave1SpikeBuf: Float32Array;
let wave1SpikeAttr: THREE.BufferAttribute;
let wave1Label: THREE.Sprite;

let wave2Ring: THREE.Line;
let wave2Spike: THREE.Line;
let wave2SpikeBuf: Float32Array;
let wave2SpikeAttr: THREE.BufferAttribute;
let wave2Label: THREE.Sprite;

let waveMeshMaterial: THREE.MeshBasicMaterial;

let isInitialized = false;
let firstRenderDone = false;
let currentGridRes = 0;

// ---- Theme state ----
type Theme = 'night' | 'sunset';
let currentTheme: Theme = 'night';
let sunsetGrid: THREE.GridHelper;
let sunSprite: THREE.Sprite;
let sunsetSkyTexture: THREE.CanvasTexture;

/** Create a horizontal ring (closed loop) lying flat in the XY plane at z = 0. */
function createRing(radius: number, color: number): THREE.Line {
  const segments = 48;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 10;
  return line;
}

/** Create a two-point vertical line whose endpoints are updated each frame. */
function createSpike(color: number): { line: THREE.Line; buf: Float32Array; attr: THREE.BufferAttribute } {
  const buf = new Float32Array(6); // [x0,y0,z0, x1,y1,z1]
  const attr = new THREE.BufferAttribute(buf, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', attr);
  geo.setDrawRange(0, 2);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.65 });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 10;
  return { line, buf, attr };
}

/** Create a canvas-text sprite label (always faces camera). */
function createLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px "Courier New", monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 24);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3, 1.5, 1);
  sprite.renderOrder = 11;
  return sprite;
}

/**
 * Create a 2×256 canvas gradient texture for the sunset sky.
 * Canvas y=0 (top) maps to the screen top; y=255 (bottom) maps to the horizon.
 * Gradient: deep burnt-orange at zenith → warm orange → golden yellow at horizon.
 */
function createSunsetSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#C94015');  // deep burnt orange-red (zenith)
  grad.addColorStop(0.35, '#E86A20');  // warm orange
  grad.addColorStop(0.70, '#F5A040');  // golden amber
  grad.addColorStop(1.00, '#FFD070');  // golden yellow (horizon)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Create a large solid sun sprite — cream-white core with a soft warm orange edge.
 * Matches the near-solid sun disc in the design inspiration (no neon glow).
 */
function createSunSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.00, 'rgba(255, 250, 220, 1.0)');  // cream white core
  grad.addColorStop(0.70, 'rgba(255, 250, 200, 1.0)');  // solid warm white
  grad.addColorStop(0.85, 'rgba(255, 200, 120, 0.5)');  // soft warm orange edge
  grad.addColorStop(1.00, 'rgba(255, 160,  60, 0.0)');  // transparent
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(16, 16, 1);
  return sprite;
}

/**
 * Initialize the Three.js scene on the given canvas.
 * Returns false if WebGL context creation fails.
 */
export function init(canvas: HTMLCanvasElement): boolean {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setClearColor(0x0a0a1a);
  } catch {
    return false;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);

  // z-up convention (matches the wave math: z = wave height)
  const aspect = canvas.clientWidth / canvas.clientHeight;
  camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(16, -16, 12);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Pre-allocate max-size buffers — reused every frame, zero GC
  positionBuffer = new Float32Array(MAX_VERTS * 3);
  colorBuffer    = new Float32Array(MAX_VERTS * 3);
  indexBuffer    = new Uint16Array(MAX_INDICES);

  meshGeometry = new THREE.BufferGeometry();

  positionAttribute = new THREE.BufferAttribute(positionBuffer, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  meshGeometry.setAttribute('position', positionAttribute);

  colorAttribute = new THREE.BufferAttribute(colorBuffer, 3);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  meshGeometry.setAttribute('color', colorAttribute);

  // Index buffer attribute — recomputed when gridRes changes, static otherwise
  const indexAttr = new THREE.BufferAttribute(indexBuffer, 1);
  meshGeometry.setIndex(indexAttr);

  meshGeometry.setDrawRange(0, 0);

  waveMeshMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    wireframe: true,
  });

  const mesh = new THREE.Mesh(meshGeometry, waveMeshMaterial);
  scene.add(mesh);

  // ---- Game plane: semi-transparent XZ plane at y = 0 ----
  // PlaneGeometry(1,1) lies in local XY with normal +Z.
  // After rotation.x = PI/2: local Y maps to world Z, plane lies at y = 0.
  // mesh.scale.x = world X extent, mesh.scale.y = world Z extent.
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0xFF6EB4,   // DESIGN.md accent pink — distinct from the wave mesh
    transparent: true,
    opacity: 0.07,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  gamePlaneMesh = new THREE.Mesh(planeGeo, planeMat);
  gamePlaneMesh.rotation.x = Math.PI / 2;
  gamePlaneMesh.renderOrder = 1;
  gamePlaneMesh.visible = false;
  scene.add(gamePlaneMesh);

  // ---- Wave profile at y = 0: the actual 2D gameplay wave ----
  // Sampled each frame via updateGamePlane(); drawn as a warm gold line.
  gameProfileBuffer = new Float32Array(PROFILE_SAMPLES * 3);
  const profileGeo = new THREE.BufferGeometry();
  gameProfileAttribute = new THREE.BufferAttribute(gameProfileBuffer, 3);
  gameProfileAttribute.setUsage(THREE.DynamicDrawUsage);
  profileGeo.setAttribute('position', gameProfileAttribute);
  profileGeo.setDrawRange(0, 0);

  const profileMat = new THREE.LineBasicMaterial({
    color: 0xFFD060,   // DESIGN.md sun gold — warm and clearly readable
  });
  gameProfileLine = new THREE.Line(profileGeo, profileMat);
  gameProfileLine.renderOrder = 2;
  gameProfileLine.visible = false;
  scene.add(gameProfileLine);

  // ---- Wave origin markers ----
  // Wave 1 (origin fixed at 0, 0): white ring + spike + "W1" label
  wave1Ring = createRing(1.6, 0xffffff);
  scene.add(wave1Ring);

  const w1s = createSpike(0xffffff);
  wave1Spike = w1s.line;
  wave1SpikeBuf = w1s.buf;
  wave1SpikeAttr = w1s.attr;
  scene.add(wave1Spike);

  wave1Label = createLabel('W1', '#ffffff');
  scene.add(wave1Label);

  // Wave 2 (origin parametrizable): teal ring + spike + "W2" label, hidden by default
  wave2Ring = createRing(1.6, 0x00ffcc);
  wave2Ring.visible = false;
  scene.add(wave2Ring);

  const w2s = createSpike(0x00ffcc);
  wave2Spike = w2s.line;
  wave2SpikeBuf = w2s.buf;
  wave2SpikeAttr = w2s.attr;
  wave2Spike.visible = false;
  scene.add(wave2Spike);

  wave2Label = createLabel('W2', '#00ffcc');
  wave2Label.visible = false;
  scene.add(wave2Label);

  // ---- Sunset theme objects (hidden by default, shown only in SURF MODE) ----

  // Pre-create the sky gradient texture (cheap — just a 2×256 canvas)
  sunsetSkyTexture = createSunsetSkyTexture();

  // Retro floor grid: dusty mauve, rotated to lie in the XY plane (Z-up world)
  // GridHelper default lies in the XZ plane (Y-up). rotation.x = π/2 → XY plane.
  sunsetGrid = new THREE.GridHelper(80, 20, 0x9868A0, 0x9868A0);
  sunsetGrid.rotation.x = Math.PI / 2;
  sunsetGrid.position.z = -6;  // below wave troughs (default amplitude ≈ 3)
  (sunsetGrid.material as THREE.LineBasicMaterial).transparent = true;
  (sunsetGrid.material as THREE.LineBasicMaterial).opacity = 0.55;
  sunsetGrid.visible = false;
  scene.add(sunsetGrid);

  // Sun sprite: far in the +X direction at horizon height
  sunSprite = createSunSprite();
  sunSprite.position.set(60, 0, 14);
  sunSprite.visible = false;
  scene.add(sunSprite);

  // Handle canvas resize
  const ro = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(canvas);

  isInitialized = true;
  return true;
}

/**
 * Rebuild the index buffer when gridRes changes.
 * Triangle winding: two triangles per quad cell, consistent CCW order.
 */
function rebuildIndices(gridRes: number): void {
  let idx = 0;
  for (let row = 0; row < gridRes - 1; row++) {
    for (let col = 0; col < gridRes - 1; col++) {
      const a = row * gridRes + col;
      const b = a + 1;
      const c = a + gridRes;
      const d = c + 1;
      // Triangle 1: a, c, b
      indexBuffer[idx++] = a;
      indexBuffer[idx++] = c;
      indexBuffer[idx++] = b;
      // Triangle 2: b, c, d
      indexBuffer[idx++] = b;
      indexBuffer[idx++] = c;
      indexBuffer[idx++] = d;
    }
  }
  const indexAttr = meshGeometry.getIndex()!;
  indexAttr.needsUpdate = true;
}

/**
 * Write new surface data into the pre-allocated buffers.
 * @param surfaceData — Float32Array of [x,y,z,...] interleaved, from sampler.ts
 * @param gridRes     — current grid resolution (to set drawRange correctly)
 */
export function update(surfaceData: SurfaceData, gridRes: number): void {
  if (!isInitialized) return;

  const vertCount = gridRes * gridRes;
  const triCount  = (gridRes - 1) * (gridRes - 1) * 2;

  // Rebuild index buffer if resolution changed
  if (gridRes !== currentGridRes) {
    rebuildIndices(gridRes);
    currentGridRes = gridRes;
  }

  // Copy position data
  positionBuffer.set(surfaceData.subarray(0, vertCount * 3));
  positionAttribute.needsUpdate = true;

  // Per-vertex color: smooth gradient from trough to crest.
  // Crest  (z = +max): #00FFCC neon cyan  → [0.00, 1.00, 0.80]
  // Trough (z = -max): #0A0A2A near-black → [0.04, 0.04, 0.17]
  // Normalise using the actual min/max z this frame so the full colour
  // range is always used regardless of amplitude.
  let zMin =  Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const z = positionBuffer[i * 3 + 2];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const zRange = zMax - zMin || 1;  // guard against flat surface

  for (let i = 0; i < vertCount; i++) {
    const z = positionBuffer[i * 3 + 2];
    const t = (z - zMin) / zRange;  // 0 at trough, 1 at crest
    if (currentTheme === 'sunset') {
      // Trough: dark teal  #1A4035 → [0.10, 0.25, 0.21]
      // Crest:  warm orange #FFA050 → [1.00, 0.63, 0.31]
      colorBuffer[i * 3    ] = 0.10 + (1.00 - 0.10) * t;  // R: 0.10 → 1.00
      colorBuffer[i * 3 + 1] = 0.25 + (0.63 - 0.25) * t;  // G: 0.25 → 0.63
      colorBuffer[i * 3 + 2] = 0.21 + (0.31 - 0.21) * t;  // B: 0.21 → 0.31
    } else {
      // Night (original): near-black #0A0A2A → neon cyan #00FFCC
      colorBuffer[i * 3    ] = 0.04 + (0.00 - 0.04) * t;  // R: 0.04 → 0.00
      colorBuffer[i * 3 + 1] = 0.04 + (1.00 - 0.04) * t;  // G: 0.04 → 1.00
      colorBuffer[i * 3 + 2] = 0.17 + (0.80 - 0.17) * t;  // B: 0.17 → 0.80
    }
  }
  colorAttribute.needsUpdate = true;

  meshGeometry.setDrawRange(0, triCount * 3);
}

/**
 * Update the game-plane visualisation each frame.
 *
 * - Scales the semi-transparent background plane to match the current gridExtent.
 * - Samples surfaceZ(x, 0, params, t) along x ∈ [−gridExtent, +gridExtent] and
 *   writes the trochoidal profile as a gold Line at y = 0.
 */
export function updateGamePlane(params: WaveParams, t: number): void {
  if (!isInitialized) return;

  const { gridExtent, amplitude } = params;
  const planeOffset = params.planeOffset ?? 0;

  // Position the plane at y = planeOffset
  gamePlaneMesh.position.y = planeOffset;

  // Size the background plane: full X extent, tall enough for any amplitude
  gamePlaneMesh.scale.x = gridExtent * 2;
  gamePlaneMesh.scale.y = amplitude * 4 + 4;  // ±(2A + 2) covers crests + troughs

  // Sample the wave profile at y = planeOffset
  const step = (2 * gridExtent) / (PROFILE_SAMPLES - 1);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const x = -gridExtent + i * step;
    gameProfileBuffer[i * 3    ] = x;
    gameProfileBuffer[i * 3 + 1] = planeOffset;            // y = planeOffset (game slice)
    gameProfileBuffer[i * 3 + 2] = surfaceZ(x, planeOffset, params, t);
  }
  gameProfileAttribute.needsUpdate = true;
  gameProfileLine.geometry.setDrawRange(0, PROFILE_SAMPLES);
}

/**
 * Update both wave origin markers each frame.
 *
 * Wave 1 (origin always at x=0, y=0):
 *   - White ring at z=0, spike from spikeBottom up to current surfaceZ(0,0,t)
 *   - "W1" label floats above the spike top
 *
 * Wave 2 (origin at wave2OriginX, wave2OriginY):
 *   - Teal ring + spike + "W2" label
 *   - Hidden entirely when wave2Enabled = false
 */
export function updateOriginMarkers(params: WaveParams, t: number): void {
  if (!isInitialized) return;

  // Spike bottom sits two combined amplitudes below still water
  const spikeBottom = -(params.amplitude + params.wave2Amplitude) * 2;

  // ---- Wave 1: fixed at (0, 0) ----
  const z1 = surfaceZ(0, 0, params, t);
  wave1Ring.position.set(0, 0, 0);
  wave1SpikeBuf[0] = 0; wave1SpikeBuf[1] = 0; wave1SpikeBuf[2] = spikeBottom;
  wave1SpikeBuf[3] = 0; wave1SpikeBuf[4] = 0; wave1SpikeBuf[5] = z1;
  wave1SpikeAttr.needsUpdate = true;
  wave1Label.position.set(0, 0, z1 + 2.5);

  // ---- Wave 2: at (wave2OriginX, wave2OriginY), shown only when enabled ----
  const show2 = params.wave2Enabled;
  wave2Ring.visible  = show2;
  wave2Spike.visible = show2;
  wave2Label.visible = show2;

  if (show2) {
    const ox = params.wave2OriginX;
    const oy = params.wave2OriginY;
    const z2 = surfaceZ(ox, oy, params, t);
    wave2Ring.position.set(ox, oy, 0);
    wave2SpikeBuf[0] = ox; wave2SpikeBuf[1] = oy; wave2SpikeBuf[2] = spikeBottom;
    wave2SpikeBuf[3] = ox; wave2SpikeBuf[4] = oy; wave2SpikeBuf[5] = z2;
    wave2SpikeAttr.needsUpdate = true;
    wave2Label.position.set(ox, oy, z2 + 2.5);
  }
}

export function getCamera(): THREE.PerspectiveCamera { return camera; }
export function getControls(): OrbitControls           { return controls; }
export function getRenderer(): THREE.WebGLRenderer     { return renderer; }
export function getScene(): THREE.Scene                { return scene; }

/**
 * Advance controls and render one frame.
 */
export function render(): void {
  if (!isInitialized) return;

  // Skip OrbitControls update in game mode — camera is driven by gameMode.ts
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);

  if (!firstRenderDone) {
    firstRenderDone = true;
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
  }
}

/**
 * Switch between the "Neon Night" visualizer theme and the SURF MODE
 * "1980s California Sunset Beach" theme.
 *
 * Night:  near-black bg, neon cyan → near-black wave gradient, no fog
 * Sunset: burnt-orange gradient sky, warm orange → dark teal wave gradient,
 *         dusty mauve retro floor grid, solid sun disc, warm amber fog
 *
 * Called by gameMode.ts on enter/exit. All sunset objects are pre-allocated
 * in init() and simply shown/hidden here — no per-call allocation.
 */
export function setTheme(theme: Theme): void {
  if (!isInitialized) return;
  currentTheme = theme;
  if (theme === 'sunset') {
    scene.background = sunsetSkyTexture;
    renderer.setClearColor(0xE86A20);
    scene.fog = new THREE.FogExp2(0xCC6020, 0.015);
    waveMeshMaterial.wireframe = false;  // solid ocean surface
    sunsetGrid.visible = true;
    sunSprite.visible = true;
  } else {
    scene.background = new THREE.Color(0x0a0a1a);
    renderer.setClearColor(0x0a0a1a);
    scene.fog = null;
    waveMeshMaterial.wireframe = true;   // restore wireframe for night mode
    sunsetGrid.visible = false;
    sunSprite.visible = false;
  }
}
