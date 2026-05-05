/**
 * 3D surfer + board mesh, styled as a 1980s California surfer.
 *
 * Design cues:
 *   - Chunky squared proportions (low-poly arcade silhouette)
 *   - Feathered blonde hair (volume above the head)
 *   - Wraparound mirror sunglasses (single dark band)
 *   - Hot pink + neon teal board with multi-stripe deck (Town & Country, Quiksilver era)
 *   - Yellow nose tip + tail block for visual asymmetry
 *   - Arms extended in surf stance (visible during turns)
 *   - Pink wetsuit top + golden trunks
 *
 * Tricks read clearly:
 *   - Yaw spin:  rotation around world Z (board nose orbits the camera)
 *   - Pitch flip: rotation around board's local Y
 *   - Lean carve: rotation around board's local X (heading axis)
 */

import * as THREE from 'three';

export interface BoardSprite {
  group: THREE.Group;
  board: THREE.Mesh;
  rider: THREE.Group;
}

export type SurfStateName = 'PADDLING' | 'RIDING' | 'AIRBORNE' | 'WIPEOUT';

const BOARD_LENGTH = 1.5;
const BOARD_WIDTH  = 0.34;
const BOARD_THICK  = 0.16;

// 1980s California palette
const COL = {
  boardBase:    0xFFFFFF,   // white deck
  boardStripe1: 0xFF3088,   // hot pink
  boardStripe2: 0x20E8E0,   // neon teal
  boardTip:     0xFFEC60,   // golden yellow
  boardBottom:  0xFF6EB4,   // pink underside

  wetsuit:      0xFF3088,   // hot pink top
  trunks:       0xFFEC60,   // golden trunks
  skin:         0xFFD8A8,   // sun-tanned
  hair:         0xFFEC60,   // bleached blond
  hairShadow:   0xFFB820,   // deeper blond
  shades:       0x1A0E2A,   // dark wraparound
  shadesGlint:  0xFF8848,   // sunset reflection on lens

  beltAccent:   0x20E8E0,   // cyan belt accent
};

function makeBoard(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-BOARD_LENGTH, 0);
  shape.bezierCurveTo(-BOARD_LENGTH, BOARD_WIDTH * 1.05,
                       BOARD_LENGTH * 0.55, BOARD_WIDTH,
                       BOARD_LENGTH, 0);
  shape.bezierCurveTo(BOARD_LENGTH * 0.55, -BOARD_WIDTH,
                      -BOARD_LENGTH, -BOARD_WIDTH * 1.05,
                      -BOARD_LENGTH, 0);
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: BOARD_THICK, bevelEnabled: true,
    bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2,
  });
  geom.translate(0, 0, -BOARD_THICK / 2);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: COL.boardBase }));
}

/** Pink underside — visible on flips and edge-on views. */
function makeBoardBottom(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-BOARD_LENGTH * 0.98, 0);
  shape.bezierCurveTo(-BOARD_LENGTH * 0.98, BOARD_WIDTH * 0.98,
                       BOARD_LENGTH * 0.55, BOARD_WIDTH * 0.93,
                       BOARD_LENGTH * 0.98, 0);
  shape.bezierCurveTo(BOARD_LENGTH * 0.55, -BOARD_WIDTH * 0.93,
                      -BOARD_LENGTH * 0.98, -BOARD_WIDTH * 0.98,
                      -BOARD_LENGTH * 0.98, 0);
  const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
  geom.translate(0, 0, -BOARD_THICK / 2 - 0.012);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: COL.boardBottom }));
}

/** Stack of pink + cyan deck stripes — Town & Country surfboard look. */
function makeDeckStripes(): THREE.Group {
  const g = new THREE.Group();
  const stripes: Array<{ width: number; offset: number; color: number }> = [
    { width: BOARD_WIDTH * 0.12, offset:  BOARD_WIDTH * 0.0,  color: COL.boardStripe1 },
    { width: BOARD_WIDTH * 0.06, offset:  BOARD_WIDTH * 0.20, color: COL.boardStripe2 },
    { width: BOARD_WIDTH * 0.06, offset: -BOARD_WIDTH * 0.20, color: COL.boardStripe2 },
  ];
  for (const s of stripes) {
    const shape = new THREE.Shape();
    const sl = BOARD_LENGTH * 0.88;
    shape.moveTo(-sl, s.offset - s.width / 2);
    shape.lineTo( sl, s.offset - s.width / 2);
    shape.lineTo( sl, s.offset + s.width / 2);
    shape.lineTo(-sl, s.offset + s.width / 2);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
    geo.translate(0, 0, BOARD_THICK / 2);
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: s.color })));
  }
  return g;
}

/** Golden nose tip — makes yaw direction obvious during spins. */
function makeBoardNoseTip(): THREE.Mesh {
  const tip = new THREE.Shape();
  tip.moveTo(BOARD_LENGTH * 0.7, 0);
  tip.bezierCurveTo(BOARD_LENGTH * 0.7, BOARD_WIDTH * 0.6,
                     BOARD_LENGTH * 0.95, BOARD_WIDTH * 0.4,
                     BOARD_LENGTH, 0);
  tip.bezierCurveTo(BOARD_LENGTH * 0.95, -BOARD_WIDTH * 0.4,
                     BOARD_LENGTH * 0.7, -BOARD_WIDTH * 0.6,
                     BOARD_LENGTH * 0.7, 0);
  const geom = new THREE.ExtrudeGeometry(tip, { depth: 0.018, bevelEnabled: false });
  geom.translate(0, 0, BOARD_THICK / 2);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: COL.boardTip }));
}

/** Tail block — a square golden patch at the back of the board. */
function makeBoardTail(): THREE.Mesh {
  const tail = new THREE.Shape();
  const tl = BOARD_LENGTH * 0.85;
  const tw = BOARD_WIDTH * 0.55;
  tail.moveTo(-BOARD_LENGTH, -tw);
  tail.lineTo(-tl,           -tw);
  tail.lineTo(-tl,            tw);
  tail.lineTo(-BOARD_LENGTH,  tw);
  const geom = new THREE.ExtrudeGeometry(tail, { depth: 0.018, bevelEnabled: false });
  geom.translate(0, 0, BOARD_THICK / 2);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: COL.boardTip }));
}

/** A small fin under the tail. */
function makeFin(): THREE.Mesh {
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(0, -0.18);
  fin.lineTo(-0.18, -0.20);
  fin.lineTo(-0.10, 0);
  const geom = new THREE.ExtrudeGeometry(fin, { depth: 0.025, bevelEnabled: false });
  geom.translate(-BOARD_LENGTH * 0.85, -0.012, -BOARD_THICK / 2);
  geom.rotateX(Math.PI / 2);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: COL.boardStripe2 }));
}

function makeRider(): THREE.Group {
  const g = new THREE.Group();

  // Legs (golden trunks shorts) — two short cylinders, knees slightly bent for surf stance
  const legGeom = new THREE.CylinderGeometry(0.08, 0.07, 0.42, 8);
  const legMat  = new THREE.MeshBasicMaterial({ color: COL.trunks });
  const legL = new THREE.Mesh(legGeom, legMat);
  legL.position.set(-0.05, -0.12, 0.21);
  g.add(legL);
  const legR = new THREE.Mesh(legGeom.clone(), legMat);
  legR.position.set(-0.05, 0.12, 0.21);
  g.add(legR);

  // Trunks waistband — small flat band
  const waist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.10, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: COL.trunks, side: THREE.DoubleSide }),
  );
  waist.position.set(-0.05, 0, 0.46);
  waist.rotation.x = Math.PI / 2;
  g.add(waist);

  // Torso — pink wetsuit top, slightly leaning forward (surf stance)
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.20, 0.45, 4, 10),
    new THREE.MeshBasicMaterial({ color: COL.wetsuit }),
  );
  torso.position.set(0, 0, 0.70);
  torso.rotation.y = -0.18;   // slight forward lean — surf stance
  g.add(torso);

  // Cyan belt accent across the chest (Quiksilver-era vibe)
  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.21, 0.08, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: COL.beltAccent, side: THREE.DoubleSide }),
  );
  belt.position.set(0, 0, 0.58);
  belt.rotation.x = Math.PI / 2;
  g.add(belt);

  // Arms — extended for balance, one forward (the front arm) and one back
  const armGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.50, 6);
  const armMat = new THREE.MeshBasicMaterial({ color: COL.skin });
  const armFront = new THREE.Mesh(armGeom, armMat);
  armFront.position.set(0.30, 0.00, 0.78);
  armFront.rotation.z = Math.PI * 0.42;   // pointing slightly forward+up
  armFront.rotation.x = 0.20;
  g.add(armFront);
  const armBack = new THREE.Mesh(armGeom.clone(), armMat);
  armBack.position.set(-0.18, 0.00, 0.78);
  armBack.rotation.z = -Math.PI * 0.30;
  armBack.rotation.x = -0.10;
  g.add(armBack);

  // Head — sun-tanned sphere
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.20, 14, 10),
    new THREE.MeshBasicMaterial({ color: COL.skin }),
  );
  head.position.set(0.06, 0, 1.10);   // slight forward shift to match stance
  g.add(head);

  // Hair — chunky golden volume on top + back, feathered look
  const hairTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshBasicMaterial({ color: COL.hair }),
  );
  hairTop.position.set(0.06, 0, 1.13);
  g.add(hairTop);
  // A hair "puff" at the back — adds volume, makes the silhouette read 80s
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshBasicMaterial({ color: COL.hairShadow }),
  );
  hairBack.position.set(-0.10, 0, 1.07);
  g.add(hairBack);
  // Bangs — a small flat patch in front
  const bangs = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6),
    new THREE.MeshBasicMaterial({ color: COL.hair }),
  );
  bangs.position.set(0.20, 0, 1.18);
  g.add(bangs);

  // Sunglasses — a single dark band across the face
  const shadesGeom = new THREE.BoxGeometry(0.05, 0.36, 0.10);
  const shadesMat  = new THREE.MeshBasicMaterial({ color: COL.shades });
  const shades = new THREE.Mesh(shadesGeom, shadesMat);
  shades.position.set(0.20, 0, 1.13);
  g.add(shades);
  // Sunset glint on the lenses (a thin warm strip)
  const glintGeom = new THREE.BoxGeometry(0.012, 0.34, 0.02);
  const glintMat  = new THREE.MeshBasicMaterial({ color: COL.shadesGlint });
  const glint = new THREE.Mesh(glintGeom, glintMat);
  glint.position.set(0.225, 0, 1.16);
  g.add(glint);

  return g;
}

export function createBoardMesh(): BoardSprite {
  const group = new THREE.Group();
  const board = makeBoard();
  group.add(board);
  group.add(makeBoardBottom());
  group.add(makeDeckStripes());
  group.add(makeBoardNoseTip());
  group.add(makeBoardTail());
  group.add(makeFin());
  const rider = makeRider();
  group.add(rider);
  return { group, board, rider };
}

/**
 * Apply pose to the surfer mesh.
 *
 *   yaw   → rotation around world Z (board nose follows heading)
 *   pitch → rotation around board's local Y (front/back flip in air)
 *   roll  → rotation around board's local X (carve lean / wipeout tumble)
 */
export function setBoardPose(
  b: BoardSprite,
  posX: number, posY: number, posZ: number,
  boardYaw: number,
  state: SurfStateName,
  leanAngle: number,
  airYaw: number,
  airPitch: number,
): void {
  b.group.position.set(posX, posY, posZ);

  const yaw = boardYaw + (state === 'AIRBORNE' || state === 'WIPEOUT' ? airYaw : 0);
  const pitch = state === 'AIRBORNE' ? airPitch : 0;
  const roll = state === 'WIPEOUT' ? airPitch : leanAngle * 0.55;

  b.group.rotation.set(0, 0, 0, 'ZYX');
  b.group.rotateZ(yaw);
  b.group.rotateY(pitch);
  b.group.rotateX(roll);

  // Wipeout slump
  const c = state === 'WIPEOUT' ? 0.5 : 0;
  b.rider.scale.set(1, 1, 1 - c * 0.3);
  b.rider.position.z = -c * 0.1;
}

export function disposeBoardMesh(b: BoardSprite, scene: THREE.Scene): void {
  scene.remove(b.group);
  b.group.traverse(obj => {
    const m = obj as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
      else (m.material as THREE.Material).dispose();
    }
  });
}
