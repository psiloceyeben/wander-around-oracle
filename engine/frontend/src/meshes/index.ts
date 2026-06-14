// Mesh builder registry — one builder per entity prototype.
//
// Builders return THREE.Object3D instances. The Three.js projection
// calls these whenever an EntitySpawned event fires. The engine itself
// never knows about THREE — it just stores meshTag strings on entities.
//
// Recipes (src/features/recipes) emit composite mesh tags of the form
// `<primary>_<material>` (e.g. "temple_marble", "sword_iron", "house_wood")
// as well as portal-variant tags ("doorway_substrate", "doorway_external").
// To avoid most prompts falling through to the gray mystery cube, the
// registry resolves an exact tag first, then strips material/style suffixes
// from the right and retries the base prototype, tinting the result by the
// recognized material word, before finally falling back to gray.

import * as THREE from "three";
import { planksTex, stoneTex, shingleTex, plasterTex, marbleTex } from "../world/textures.js";
import { HOUSE, TOWER, CASTLE, TEMPLE, MANOR } from "../world/buildingSpecs.js";

const PALETTE = {
  player:    0x58a6ff,
  sword:     0xc0c0c0,
  rock:      0x6e6e6e,
  tree:      0x2ea043,
  wizard:    0xa371f7,
  guard:     0xff9248,
  merchant:  0xe3b341,
  scholar:   0x6cb6ff,
  doorway:   0xf0883e,
  portal:    0xff7b72,
  workshop:  0x79c0ff,
  temple:    0xe6edf3,
  tower:     0xbcc7d1,
  castle:    0x8b98a5,
  house:     0xb08968,
  column:    0xe6edf3,
  bridge:    0x9a8478,
  grove:     0x238636,
  lantern:   0xffd166,
  staff:     0x9d7bd8,
  book:      0xd29922,
  shield:    0xa0a8b0,
  wolf:      0x8b949e,
  deer:      0xc08552,
  fallback:  0x6e7681,
  pine:      0x1f5e3a,
  bush:      0x35803b,
  ice:       0x9fd3ee,
  sand:      0xd4bb84,
  palm:      0x3f9c4d,
  mushroom:  0xc94f43,
  grass:     0x4e8f43,
};

// Per-instance visual variation (scale / hue / rotation). Cosmetic only —
// the world substrate keeps the entity's transform; this jitters the MESH
// so a forest of one prototype doesn't read as an army of clones.
function vary(obj: THREE.Object3D, opts?: { scale?: number; hue?: number }): THREE.Object3D {
  const sJit = opts?.scale ?? 0.25;
  const hJit = opts?.hue ?? 0.04;
  const s = 1 + (Math.random() * 2 - 1) * sJit;
  obj.scale.multiplyScalar(s);
  obj.rotateY(Math.random() * Math.PI * 2);
  if (hJit > 0) {
    obj.traverse((o: any) => {
      const m = o.material;
      const apply = (mat: any) => {
        if (mat && mat.color && mat.isMeshBasicMaterial !== true && !mat.userData?.noVary) {
          mat.color.offsetHSL((Math.random() * 2 - 1) * hJit, (Math.random() * 2 - 1) * 0.05, (Math.random() * 2 - 1) * 0.04);
        }
      };
      if (Array.isArray(m)) m.forEach(apply); else if (m) apply(m);
    });
  }
  return obj;
}

/** Enable shadow casting on solid (non-glow) meshes inside a built object. */
function shadowify(obj: THREE.Object3D): THREE.Object3D {
  obj.traverse((o: any) => {
    if (o.isMesh && o.material && o.material.isMeshBasicMaterial !== true && !o.userData?.noShadow) {
      o.castShadow = true;
    }
  });
  return obj;
}

// Material words that can suffix a composite meshTag, mapped to a tint colour.
// When a `<base>_<material>` tag resolves to a registered `<base>` builder,
// the result is tinted toward this colour so "a marble temple" reads marble.
const MATERIAL_TINTS: Record<string, number> = {
  marble: 0xf0f0f0,
  wood:   0x8b5a2b,
  iron:   0x9aa0a6,
  stone:  0x8d9499,
  gold:   0xe3b341,
  silver: 0xc0c8d0,
  copper: 0xb87333,
  crystal:0x9fd3ff,
  bronze: 0xcd7f32,
  steel:  0xb0b8c0,
};

function group(...meshes: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const m of meshes) g.add(m);
  return g;
}

function pillar(color: number, height: number, radius: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 12);
  const mat = new THREE.MeshLambertMaterial({ color });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = height / 2;
  return m;
}

function box(color: number, w: number, h: number, d: number, y: number = h / 2): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({ color });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

function sphere(color: number, r: number, y: number = r): THREE.Mesh {
  const geo = new THREE.SphereGeometry(r, 12, 8);
  const mat = new THREE.MeshLambertMaterial({ color });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

// ── Per-kind builders ──────────────────────────────────────────────────

export function buildPlayer(): THREE.Object3D {
  // Tall capsule + glowing top to mark "this is you when 3rd-person"
  const body = pillar(PALETTE.player, 1.4, 0.28);
  const head = sphere(PALETTE.player, 0.22, 1.55);
  const g = group(body, head);
  g.name = "player";
  return g;
}

export function buildSword(): THREE.Object3D {
  const blade = box(PALETTE.sword, 0.06, 0.6, 0.02, 0.6);
  const guard = box(0x8b4513, 0.2, 0.04, 0.05, 0.3);
  const hilt  = box(0x8b4513, 0.04, 0.16, 0.04, 0.18);
  const g = group(blade, guard, hilt);
  g.rotation.z = Math.PI / 6;
  g.name = "sword";
  return g;
}

export function buildRock(): THREE.Object3D {
  const m = sphere(PALETTE.rock, 0.35, 0.3);
  (m as THREE.Mesh).geometry = new THREE.DodecahedronGeometry(0.4, 0);
  m.position.y = 0.3;
  m.name = "rock";
  return m;
}

export function buildTree(): THREE.Object3D {
  // Flat-shaded low-poly canopy (dodecahedron stack) — the trailer look.
  const h = 1.3 + Math.random() * 0.9;
  const trunk = pillar(0x6b4423, h, 0.14 + Math.random() * 0.08);
  const canopyMat = new THREE.MeshLambertMaterial({ color: PALETTE.tree, flatShading: true });
  const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65 + Math.random() * 0.3, 0), canopyMat);
  c1.position.y = h + 0.45;
  const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45 + Math.random() * 0.2, 0), canopyMat.clone());
  c2.position.set((Math.random() - 0.5) * 0.7, h + 0.85, (Math.random() - 0.5) * 0.7);
  return vary(group(trunk, c1, c2), { scale: 0.3, hue: 0.05 });
}

export function buildPine(): THREE.Object3D {
  const h = 1.0 + Math.random() * 0.6;
  const trunk = pillar(0x5a3a26, h, 0.12);
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.pine, flatShading: true });
  const tiers: THREE.Object3D[] = [trunk];
  let y = h, r = 0.85;
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.0, 7), mat);
    cone.position.y = y + 0.45;
    tiers.push(cone);
    y += 0.62; r *= 0.72;
  }
  return vary(group(...tiers), { scale: 0.3, hue: 0.03 });
}

export function buildBush(): THREE.Object3D {
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.bush, flatShading: true });
  const b1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), mat);
  b1.position.y = 0.3;
  const b2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), mat.clone());
  b2.position.set(0.3, 0.22, 0.15);
  return vary(group(b1, b2), { scale: 0.3, hue: 0.06 });
}

const FLOWER_HUES = [0xe05d7a, 0xe9b44c, 0x9d7bd8, 0xe8edf2, 0xff8c5a, 0x6cb6ff];
export function buildFlower(): THREE.Object3D {
  const stem = pillar(0x3f7a3a, 0.32, 0.02);
  const hue = FLOWER_HUES[Math.floor(Math.random() * FLOWER_HUES.length)];
  const headMat = new THREE.MeshLambertMaterial({ color: hue });
  headMat.userData = { noVary: true };
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), headMat);
  head.position.y = 0.36;
  head.userData = { noShadow: true };
  const g = group(stem, head);
  g.userData = { noShadow: true };
  return vary(g, { scale: 0.25, hue: 0 });
}

export function buildGrass(): THREE.Object3D {
  // Two crossed planes of blades — cheap, no shadow.
  const mat = new THREE.MeshLambertMaterial({
    color: PALETTE.grass, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
  });
  const geo = new THREE.ConeGeometry(0.16, 0.42, 4, 1, true);
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(geo, mat);
    blade.position.set((Math.random() - 0.5) * 0.4, 0.21, (Math.random() - 0.5) * 0.4);
    blade.rotation.y = Math.random() * Math.PI;
    blade.userData = { noShadow: true };
    g.add(blade);
  }
  g.userData = { noShadow: true };
  return vary(g, { scale: 0.3, hue: 0.05 });
}

export function buildMushroom(): THREE.Object3D {
  const stalk = pillar(0xe8e2d0, 0.22, 0.05);
  const capMat = new THREE.MeshLambertMaterial({ color: PALETTE.mushroom, flatShading: true });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.position.y = 0.22;
  const g = group(stalk, cap);
  g.userData = { noShadow: true };
  return vary(g, { scale: 0.3, hue: 0.03 });
}

export function buildCactus(): THREE.Object3D {
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a8a3c, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.5, 8), mat);
  body.position.y = 0.75;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.6, 8), mat.clone());
  arm.position.set(0.34, 0.95, 0);
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8), mat.clone());
  elbow.rotation.z = Math.PI / 2;
  elbow.position.set(0.24, 0.7, 0);
  return vary(group(body, arm, elbow), { scale: 0.25, hue: 0.02 });
}

export function buildIceBlock(): THREE.Object3D {
  const mat = new THREE.MeshLambertMaterial({
    color: PALETTE.ice, transparent: true, opacity: 0.82, flatShading: true,
  });
  const m1 = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), mat);
  m1.position.y = 0.42;
  m1.rotation.set(Math.random(), Math.random(), Math.random() * 0.4);
  const m2 = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat.clone());
  m2.position.set(0.4, 0.22, 0.2);
  return vary(group(m1, m2), { scale: 0.3, hue: 0.01 });
}

export function buildPalm(): THREE.Object3D {
  const lean = (Math.random() - 0.5) * 0.5;
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a44 });
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.1 - i * 0.012, 0.12 - i * 0.012, 0.6, 7), trunkMat);
    seg.position.set(lean * i * 0.3, y + 0.3, 0);
    seg.rotation.z = lean * 0.35;
    g.add(seg);
    y += 0.56;
  }
  const frondMat = new THREE.MeshLambertMaterial({ color: PALETTE.palm, side: THREE.DoubleSide, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 4, 1), frondMat);
    const a = (i / 5) * Math.PI * 2;
    frond.position.set(lean * 1.2 + Math.cos(a) * 0.5, y + 0.18, Math.sin(a) * 0.5);
    frond.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
    g.add(frond);
  }
  return vary(g, { scale: 0.25, hue: 0.04 });
}

export function buildDune(): THREE.Object3D {
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.sand, flatShading: true });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 5), mat);
  m.scale.set(1.6, 0.32, 1.1);
  m.position.y = 0.12;
  m.userData = { noShadow: true };
  return vary(m, { scale: 0.35, hue: 0.02 });
}

export function buildWizard(): THREE.Object3D {
  // Hooded silhouette: cone hat + robe body + glow
  const robe = pillar(PALETTE.wizard, 1.4, 0.32);
  const head = sphere(0xe6edf3, 0.18, 1.55);
  const hatGeo = new THREE.ConeGeometry(0.3, 0.6, 12);
  const hatMat = new THREE.MeshLambertMaterial({ color: PALETTE.wizard });
  const hat = new THREE.Mesh(hatGeo, hatMat);
  hat.position.y = 1.95;
  return group(robe, head, hat);
}

export function buildGuard(): THREE.Object3D {
  const body = pillar(PALETTE.guard, 1.5, 0.3);
  const head = sphere(0xe6edf3, 0.2, 1.6);
  // Small spear on side
  const spearGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6);
  const spearMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
  const spear = new THREE.Mesh(spearGeo, spearMat);
  spear.position.set(0.35, 0.9, 0);
  return group(body, head, spear);
}

export function buildMerchant(): THREE.Object3D {
  // Rounded trader with a pack on the back
  const body = pillar(PALETTE.merchant, 1.4, 0.34);
  const head = sphere(0xe6edf3, 0.2, 1.5);
  const pack = box(0x6b4423, 0.5, 0.5, 0.3, 0.95);
  pack.position.z = -0.35;
  return group(body, head, pack);
}

export function buildScholar(): THREE.Object3D {
  // Robed sage holding a small tome
  const robe = pillar(PALETTE.scholar, 1.45, 0.32);
  const head = sphere(0xe6edf3, 0.19, 1.55);
  const tome = box(PALETTE.book, 0.22, 0.28, 0.06, 0.95);
  tome.position.set(0.28, 0, 0.2);
  return group(robe, head, tome);
}

export function buildWolf(): THREE.Object3D {
  // Low quadruped silhouette
  const body = box(PALETTE.wolf, 0.9, 0.4, 0.35, 0.55);
  const head = box(PALETTE.wolf, 0.35, 0.32, 0.3, 0.6);
  head.position.z = 0.55;
  const snout = box(PALETTE.wolf, 0.16, 0.16, 0.2, 0.55);
  snout.position.z = 0.78;
  const legGeo = () => box(0x5a5f66, 0.1, 0.5, 0.1, 0.25);
  const l1 = legGeo(); l1.position.set(0.3, 0, 0.25);
  const l2 = legGeo(); l2.position.set(-0.3, 0, 0.25);
  const l3 = legGeo(); l3.position.set(0.3, 0, -0.25);
  const l4 = legGeo(); l4.position.set(-0.3, 0, -0.25);
  return group(body, head, snout, l1, l2, l3, l4);
}

export function buildDeer(): THREE.Object3D {
  // Taller quadruped with simple antlers
  const body = box(PALETTE.deer, 0.85, 0.45, 0.35, 0.85);
  const neck = box(PALETTE.deer, 0.22, 0.5, 0.22, 1.15);
  neck.position.z = 0.45;
  const head = box(PALETTE.deer, 0.24, 0.26, 0.34, 1.45);
  head.position.z = 0.55;
  const antlerGeo = () => box(0x9a8478, 0.05, 0.4, 0.05, 1.7);
  const a1 = antlerGeo(); a1.position.set(0.1, 0, 0.5);
  const a2 = antlerGeo(); a2.position.set(-0.1, 0, 0.5);
  const legGeo = () => box(0x8a6a48, 0.09, 0.7, 0.09, 0.35);
  const l1 = legGeo(); l1.position.set(0.28, 0, 0.25);
  const l2 = legGeo(); l2.position.set(-0.28, 0, 0.25);
  const l3 = legGeo(); l3.position.set(0.28, 0, -0.25);
  const l4 = legGeo(); l4.position.set(-0.28, 0, -0.25);
  return group(body, neck, head, a1, a2, l1, l2, l3, l4);
}

export function buildDoorway(): THREE.Object3D {
  // Stone arch — two pillars + lintel + glowing portal plane
  const left  = box(0xe6edf3, 0.3, 2.0, 0.3, 1.0); left.position.x = -0.6;
  const right = box(0xe6edf3, 0.3, 2.0, 0.3, 1.0); right.position.x = 0.6;
  const lintel = box(0xe6edf3, 1.5, 0.3, 0.3, 2.15);
  // Portal glow plane
  const portalGeo = new THREE.PlaneGeometry(1.0, 1.6);
  const portalMat = new THREE.MeshBasicMaterial({
    color: PALETTE.doorway, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
  });
  const portal = new THREE.Mesh(portalGeo, portalMat);
  portal.position.y = 1.0;
  portal.position.z = 0.001;
  return group(left, right, lintel, portal, beacon(PALETTE.doorway));
}

/** Tall additive light beam — visible-from-afar navigation marker. */
function beacon(color: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.32, 0.5, 30, 10, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 15;
  m.userData = { noShadow: true };
  return m;
}

export function buildPortal(): THREE.Object3D {
  // Standalone portal (uses "portal" prototype if portals create with that tag)
  const geo = new THREE.TorusGeometry(0.8, 0.15, 12, 24);
  const mat = new THREE.MeshLambertMaterial({
    color: PALETTE.portal, emissive: PALETTE.portal, emissiveIntensity: 0.5,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 1.0;
  m.rotation.x = Math.PI / 2;
  return m;
}

export function buildWorkshop(): THREE.Object3D {
  // Anvil-on-platform aesthetic
  const platform = box(0x6b4423, 1.8, 0.4, 1.2, 0.2);
  const anvil = box(0x444444, 0.6, 0.45, 0.35, 0.6);
  const anvilTop = box(0x666666, 0.8, 0.1, 0.45, 0.9);
  return group(platform, anvil, anvilTop, beacon(PALETTE.workshop));
}

export function buildTemple(): THREE.Object3D {
  const { PLAT_W, PLAT_D, PLAT_H, COL_R, COL_H,
          CELLA_W, CELLA_D, CELLA_H, CELLA_Z, CELLA_TH, CELLA_DOOR } = TEMPLE;
  const marble = texMat(marbleTex());
  const g = new THREE.Group();

  // stepped platform (standable — the collision system lets you walk up)
  g.add(panelAt(PLAT_W + 0.5, PLAT_H / 2, PLAT_D + 0.5, marble, 0, PLAT_H / 4, 0));
  g.add(panelAt(PLAT_W, PLAT_H, PLAT_D, marble, 0, PLAT_H / 2, 0));

  // peristyle: fluted-ish columns with base + capital
  const colSpots: Array<[number, number]> = [
    [-1.95, 1.35], [-0.65, 1.35], [0.65, 1.35], [1.95, 1.35],
    [-1.95, -1.35], [1.95, -1.35],
  ];
  for (const [x, z] of colSpots) {
    const c = new THREE.Group();
    c.add(panelAt(0.4, 0.12, 0.4, marble, 0, 0.06, 0));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(COL_R, COL_R + 0.03, COL_H - 0.3, 10), marble);
    shaft.position.y = 0.12 + (COL_H - 0.3) / 2;
    c.add(shaft);
    c.add(panelAt(0.42, 0.14, 0.42, marble, 0, COL_H - 0.08, 0));
    c.position.set(x, PLAT_H, z);
    g.add(c);
  }

  // architrave frame + pitched marble roof + pediments
  const archY = PLAT_H + COL_H + 0.12;
  g.add(panelAt(PLAT_W - 0.4, 0.24, 0.3, marble, 0, archY, 1.35));
  g.add(panelAt(PLAT_W - 0.4, 0.24, 0.3, marble, 0, archY, -1.35));
  for (const sx of [-1, 1]) {
    g.add(panelAt(0.3, 0.24, 3.0, marble, sx * 1.95, archY, 0));
  }
  const roof = gableRoof(PLAT_W - 0.5, PLAT_D - 0.3, 0.85, texMat(stoneTex("#c9c4b6")));
  roof.position.y = archY + 0.12;
  g.add(roof);
  for (const sz of [-1, 1]) {
    const ped = gableEnd(PLAT_W - 0.6, 0.8, marble);
    ped.position.set(0, archY + 0.12, sz * (PLAT_D / 2 - 0.18));
    g.add(ped);
  }

  // cella with door + altar flame
  const cella = new THREE.Group();
  const cf = doorWall(CELLA_W, CELLA_H, CELLA_TH, CELLA_DOOR, 1.95, marble);
  cf.position.z = CELLA_D / 2 - CELLA_TH / 2;
  cella.add(cf);
  cella.add(panelAt(CELLA_W, CELLA_H, CELLA_TH, marble, 0, CELLA_H / 2, -(CELLA_D / 2 - CELLA_TH / 2)));
  for (const sx of [-1, 1]) {
    cella.add(panelAt(CELLA_TH, CELLA_H, CELLA_D - CELLA_TH * 2, marble,
      sx * (CELLA_W / 2 - CELLA_TH / 2), CELLA_H / 2, 0));
  }
  const altar = panelAt(0.6, 0.6, 0.4, texMat(stoneTex("#b9b4a4")), 0, 0.3, -0.45);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc46a }));
  flame.position.set(0, 0.72, -0.45);
  flame.userData = { noShadow: true };
  cella.add(altar, flame);
  cella.position.set(0, PLAT_H, CELLA_Z);
  g.add(cella);
  return g;
}

export function buildTower(): THREE.Object3D {
  const { R, H, TH, FACETS, DOOR_H } = TOWER;
  const stone = texMat(stoneTex("#9aa3ab"));
  const planks = texMat(planksTex());
  const g = new THREE.Group();
  const facetW = 2 * R * Math.tan(Math.PI / FACETS);
  for (let k = 0; k < FACETS; k++) {
    const a = (k / FACETS) * Math.PI * 2;
    if (k === 0) {
      // door facet: lintel panel above the opening only
      const lintel = panelAt(facetW, H - DOOR_H, TH, stone, 0, DOOR_H + (H - DOOR_H) / 2, 0);
      const wrap0 = new THREE.Group();
      wrap0.add(lintel);
      wrap0.position.set(Math.sin(a) * (R - TH / 2), 0, Math.cos(a) * (R - TH / 2));
      wrap0.rotation.y = a;
      g.add(wrap0);
      continue;
    }
    const wrap = new THREE.Group();
    const wall = panelAt(facetW, H, TH, stone, 0, H / 2, 0);
    wrap.add(wall);
    // two upper glow slits on opposite-ish facets
    if (k === 3 || k === 6) {
      const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.7),
        new THREE.MeshBasicMaterial({ color: 0xffd98a, side: THREE.DoubleSide }));
      slit.position.set(0, H - 1.4, TH / 2 + 0.01);
      slit.userData = { noShadow: true };
      wrap.add(slit);
    }
    wrap.position.set(Math.sin(a) * (R - TH / 2), 0, Math.cos(a) * (R - TH / 2));
    wrap.rotation.y = a;
    g.add(wrap);
  }
  // floor, parapet band, merlons, conical cap
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R - TH, FACETS), planks);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.06;
  g.add(floor);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.3, FACETS), stone);
  band.position.y = H + 0.15;
  g.add(band);
  for (let k = 0; k < FACETS; k++) {
    const a = (k / FACETS) * Math.PI * 2 + Math.PI / FACETS;
    g.add(panelAt(0.34, 0.34, 0.2, stone,
      Math.sin(a) * (R + 0.02), H + 0.45, Math.cos(a) * (R + 0.02)));
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(R + 0.42, 1.45, FACETS),
    texMat(shingleTex("#5a6e8c")));
  cap.position.y = H + 1.0;
  g.add(cap);
  // brazier inside
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff9a45 }));
  ember.position.set(0.5, 0.5, -0.4);
  ember.userData = { noShadow: true };
  g.add(panelAt(0.3, 0.4, 0.3, stone, 0.5, 0.2, -0.4), ember);
  return g;
}

export function buildCastle(): THREE.Object3D {
  const { W, TH, H, GATE_W, GATE_H, TOWER_R, TOWER_H,
          KEEP_W, KEEP_D, KEEP_H, KEEP_Z, KEEP_DOOR } = CASTLE;
  const stone = texMat(stoneTex("#8b97a2"));
  const darkShingle = texMat(shingleTex("#4a5a74"));
  const planks = texMat(planksTex());
  const g = new THREE.Group();
  const half = W / 2, zc = half - TH / 2;

  // curtain walls: front (gated), back, sides — with merlons all round
  const front = doorWall(W, H, TH, GATE_W, GATE_H, stone);
  front.position.z = zc;
  g.add(front);
  g.add(panelAt(W, H, TH, stone, 0, H / 2, -zc));
  for (const sx of [-1, 1]) {
    const side = panelAt(W - TH * 2, H, TH, stone, 0, H / 2, 0);
    const wrap = new THREE.Group();
    wrap.add(side);
    wrap.rotation.y = Math.PI / 2;
    wrap.position.x = sx * zc;
    g.add(wrap);
  }
  for (let i = -3; i <= 3; i++) {
    const mx = i * (W / 7);
    g.add(panelAt(0.42, 0.4, 0.22, stone, mx, H + 0.2, zc));
    g.add(panelAt(0.42, 0.4, 0.22, stone, mx, H + 0.2, -zc));
    g.add(panelAt(0.22, 0.4, 0.42, stone, zc, H + 0.2, mx));
    g.add(panelAt(0.22, 0.4, 0.42, stone, -zc, H + 0.2, mx));
  }
  // gate trim + banners
  const trim = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
  g.add(panelAt(GATE_W + 0.3, 0.18, TH + 0.08, trim, 0, GATE_H + 0.09, zc));
  for (const sx of [-1, 1]) {
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x8c2f3f }));
    banner.position.set(sx * (GATE_W / 2 + 0.65), H - 0.55, zc + 0.12);
    banner.userData = { noShadow: true };
    g.add(banner);
  }
  // corner towers + caps + glow slits
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tx = sx * (half - 0.3), tz = sz * (half - 0.3);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R, TOWER_R * 1.08, TOWER_H, 8), stone);
    t.position.set(tx, TOWER_H / 2, tz);
    g.add(t);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(TOWER_R + 0.3, 1.1, 8), darkShingle);
    cap.position.set(tx, TOWER_H + 0.5, tz);
    g.add(cap);
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.55),
      new THREE.MeshBasicMaterial({ color: 0xffd98a, side: THREE.DoubleSide }));
    slit.position.set(tx + (sx === 0 ? 0 : 0), TOWER_H - 1.0, tz + sz * (TOWER_R + 0.02));
    slit.userData = { noShadow: true };
    g.add(slit);
  }
  // the keep — an enterable hall facing the courtyard
  const keep = new THREE.Group();
  const kf = doorWall(KEEP_W, KEEP_H, 0.14, KEEP_DOOR, 1.9, texMat(plasterTex()));
  kf.position.z = KEEP_D / 2 - 0.07;
  keep.add(kf);
  keep.add(panelAt(KEEP_W, KEEP_H, 0.14, texMat(plasterTex()), 0, KEEP_H / 2, -(KEEP_D / 2 - 0.07)));
  for (const sx of [-1, 1]) {
    keep.add(panelAt(0.14, KEEP_H, KEEP_D - 0.28, texMat(plasterTex()),
      sx * (KEEP_W / 2 - 0.07), KEEP_H / 2, 0));
  }
  keep.add(panelAt(KEEP_W - 0.2, 0.08, KEEP_D - 0.2, planks, 0, 0.05, 0));
  const kroof = gableRoof(KEEP_W, KEEP_D, 0.95, darkShingle);
  kroof.position.y = KEEP_H + 0.05;
  keep.add(kroof);
  const throne = panelAt(0.6, 0.9, 0.2, trim, 0, 0.45, -(KEEP_D / 2 - 0.4));
  const braz = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff9a45 }));
  braz.position.set(0.7, 0.45, 0);
  braz.userData = { noShadow: true };
  keep.add(throne, braz);
  keep.position.z = KEEP_Z;
  g.add(keep);
  // stone path from gate to keep
  const path = panelAt(1.4, 0.06, half + KEEP_Z + KEEP_D / 2, texMat(stoneTex("#a8a9a3")),
    0, 0.03, (zc + (KEEP_Z + KEEP_D / 2)) / 2);
  path.userData = { noShadow: true };
  g.add(path);
  return g;
}

// ── enterable-architecture kit ────────────────────────────────────────
// These builders construct from buildingSpecs.ts, so the collision plans
// match the geometry wall for wall — every visible doorway is walkable.

function texMat(tex: THREE.Texture, tint: number = 0xffffff): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ map: tex, color: tint });
}

function panelAt(w: number, h: number, d: number, mat: THREE.Material,
                 x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A wall with a doorway: two segments + a lintel over the gap. */
function doorWall(width: number, height: number, th: number,
                  doorW: number, doorH: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const seg = (width - doorW) / 2;
  g.add(panelAt(seg, height, th, mat, -(doorW / 2 + seg / 2), height / 2, 0));
  g.add(panelAt(seg, height, th, mat, +(doorW / 2 + seg / 2), height / 2, 0));
  g.add(panelAt(doorW, height - doorH, th, mat, 0, doorH + (height - doorH) / 2, 0));
  return g;
}

/** A wall with a warm-lit window (emissive pane — free light at night). */
function windowWall(width: number, height: number, th: number, mat: THREE.Material,
                    winW: number = 0.85, winH: number = 0.8, sill: number = 1.0): THREE.Group {
  const g = new THREE.Group();
  const seg = (width - winW) / 2;
  g.add(panelAt(seg, height, th, mat, -(winW / 2 + seg / 2), height / 2, 0));
  g.add(panelAt(seg, height, th, mat, +(winW / 2 + seg / 2), height / 2, 0));
  g.add(panelAt(winW, sill, th, mat, 0, sill / 2, 0));
  g.add(panelAt(winW, height - sill - winH, th, mat, 0, sill + winH + (height - sill - winH) / 2, 0));
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(winW - 0.12, winH - 0.12),
    new THREE.MeshBasicMaterial({ color: 0xffd98a, side: THREE.DoubleSide }),
  );
  glow.position.set(0, sill + winH / 2, 0);
  glow.userData = { noShadow: true };
  g.add(glow);
  // chunky frame trim
  const trim = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });
  g.add(panelAt(winW + 0.12, 0.07, th + 0.04, trim, 0, sill, 0));
  g.add(panelAt(winW + 0.12, 0.07, th + 0.04, trim, 0, sill + winH, 0));
  return g;
}

/** Gable-end triangle (flat). */
function gableEnd(width: number, rise: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape),
    new THREE.MeshLambertMaterial({
      map: (mat as THREE.MeshLambertMaterial).map ?? null,
      color: (mat as THREE.MeshLambertMaterial).color,
      side: THREE.DoubleSide,
    }));
  return m;
}

/** Two-panel pitched roof with shingles + ridge beam. */
function gableRoof(width: number, depth: number, rise: number,
                   shingle: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const half = width / 2 + 0.25;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.1, depth + 0.45), shingle);
    p.position.set(s * half / 2, rise / 2, 0);
    p.rotation.z = -s * ang;
    g.add(p);
  }
  const ridge = panelAt(0.16, 0.14, depth + 0.5,
    new THREE.MeshLambertMaterial({ color: 0x6b3a2a }), 0, rise + 0.04, 0);
  g.add(ridge);
  return g;
}

export function buildHouse(): THREE.Object3D {
  const { W, D, H, TH, DOOR_W, DOOR_H, RISE } = HOUSE;
  const plaster = texMat(plasterTex());
  const planks = texMat(planksTex());
  const shingle = texMat(shingleTex("#a04a3a"));
  const trim = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });
  const g = new THREE.Group();

  const front = doorWall(W, H, TH, DOOR_W, DOOR_H, plaster);
  front.position.z = D / 2 - TH / 2;
  const back = windowWall(W, H, TH, plaster);
  back.position.z = -(D / 2 - TH / 2);
  const left = windowWall(D - TH * 2, H, TH, plaster, 0.8, 0.75, 1.05);
  left.rotation.y = Math.PI / 2;
  left.position.x = -(W / 2 - TH / 2);
  const right = windowWall(D - TH * 2, H, TH, plaster, 0.8, 0.75, 1.05);
  right.rotation.y = Math.PI / 2;
  right.position.x = +(W / 2 - TH / 2);
  g.add(front, back, left, right);

  // timber corner posts + top beam — the storybook frame
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(panelAt(0.2, H, 0.2, planks, sx * (W / 2 - 0.1), H / 2, sz * (D / 2 - 0.1)));
  }
  g.add(panelAt(W + 0.06, 0.18, D + 0.06, planks, 0, H + 0.02, 0));

  // door frame trim
  g.add(panelAt(0.12, DOOR_H, TH + 0.06, trim, -(DOOR_W / 2 + 0.06), DOOR_H / 2, D / 2 - TH / 2));
  g.add(panelAt(0.12, DOOR_H, TH + 0.06, trim, +(DOOR_W / 2 + 0.06), DOOR_H / 2, D / 2 - TH / 2));
  g.add(panelAt(DOOR_W + 0.24, 0.12, TH + 0.06, trim, 0, DOOR_H + 0.06, D / 2 - TH / 2));

  // floor + hearth + furniture (the reason to step inside)
  g.add(panelAt(W - TH, 0.1, D - TH, planks, 0, 0.05, 0));
  const hearth = panelAt(0.9, 1.1, 0.3, texMat(stoneTex("#8d9499")), 0, 0.55, -(D / 2 - TH - 0.18));
  g.add(hearth);
  const ember = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35),
    new THREE.MeshBasicMaterial({ color: 0xff9a45 }));
  ember.position.set(0, 0.35, -(D / 2 - TH - 0.32));
  ember.userData = { noShadow: true };
  g.add(ember);
  g.add(panelAt(0.9, 0.08, 0.55, planks, -0.9, 0.5, 0.2));
  g.add(panelAt(0.1, 0.5, 0.1, planks, -1.25, 0.25, 0.0));
  g.add(panelAt(0.1, 0.5, 0.1, planks, -0.55, 0.25, 0.4));

  // roof + gable ends + chimney
  const roof = gableRoof(W, D, RISE, shingle);
  roof.position.y = H + 0.1;
  g.add(roof);
  for (const sz of [-1, 1]) {
    const ge = gableEnd(W + 0.1, RISE, plaster);
    ge.position.set(0, H + 0.1, sz * (D / 2 + 0.02));
    g.add(ge);
  }
  const chimney = panelAt(0.5, 1.5, 0.5, texMat(stoneTex("#8d9499")), W / 4, H + RISE / 2 + 0.55, -D / 6);
  g.add(chimney);
  return g;
}

export function buildColumn(): THREE.Object3D {
  // Fluted column with base + capital
  const base = box(0xe6edf3, 0.5, 0.2, 0.5, 0.1);
  const shaft = pillar(PALETTE.column, 2.2, 0.18);
  shaft.position.y = 0.2 + 1.1;
  const cap = box(0xe6edf3, 0.5, 0.2, 0.5, 2.4 + 0.1);
  return group(base, shaft, cap);
}

export function buildBridge(): THREE.Object3D {
  // Arched deck with two end posts
  const deck = box(PALETTE.bridge, 3.6, 0.25, 1.0, 0.7);
  const archGeo = new THREE.TorusGeometry(1.6, 0.18, 8, 16, Math.PI);
  const arch = new THREE.Mesh(archGeo, new THREE.MeshLambertMaterial({ color: 0x83715f }));
  arch.position.y = 0.55;
  const p1 = box(0x6f5d4d, 0.25, 0.9, 1.0, 0.45); p1.position.x = -1.7;
  const p2 = box(0x6f5d4d, 0.25, 0.9, 1.0, 0.45); p2.position.x = 1.7;
  return group(deck, arch, p1, p2);
}

export function buildGrove(): THREE.Object3D {
  // A small cluster of trees
  const g = new THREE.Group();
  const spots: Array<[number, number, number]> = [
    [0, 0, 0], [1.6, 0, 0.8], [-1.4, 0, 0.6], [0.6, 0, -1.5], [-0.9, 0, -1.2],
  ];
  for (const [x, s, z] of spots) {
    const trunk = pillar(0x6b4423, 1.4 + s, 0.16);
    const top = sphere(PALETTE.grove, 0.6, 1.6 + s);
    const t = group(trunk, top);
    t.position.set(x, 0, z);
    g.add(t);
  }
  return g;
}

export function buildLantern(): THREE.Object3D {
  // Glowing cage on a short post
  const post = pillar(0x5a5f66, 0.5, 0.04);
  const cage = box(0x3a3f46, 0.22, 0.3, 0.22, 0.65);
  const flameGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const flameMat = new THREE.MeshBasicMaterial({ color: PALETTE.lantern });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.y = 0.65;
  return group(post, cage, flame);
}

export function buildStaff(): THREE.Object3D {
  // Long shaft topped with a glowing orb
  const shaft = pillar(0x6b4423, 1.4, 0.04);
  const orbGeo = new THREE.SphereGeometry(0.12, 12, 8);
  const orbMat = new THREE.MeshBasicMaterial({ color: PALETTE.staff });
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.position.y = 1.5;
  return group(shaft, orb);
}

export function buildBook(): THREE.Object3D {
  // Closed tome lying flat
  const cover = box(PALETTE.book, 0.36, 0.08, 0.46, 0.1);
  const pages = box(0xf0e6c8, 0.32, 0.06, 0.42, 0.1);
  pages.position.y = 0.115;
  return group(cover, pages);
}

export function buildShield(): THREE.Object3D {
  // Rounded boss on a flat plate
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.4, 0.08, 16),
    new THREE.MeshLambertMaterial({ color: PALETTE.shield }),
  );
  plate.rotation.x = Math.PI / 2;
  plate.position.y = 0.6;
  const boss = sphere(0xd0d6dc, 0.12, 0.6);
  boss.position.z = 0.06;
  return group(plate, boss);
}

export function buildManor(): THREE.Object3D {
  const { HALL_W, HALL_D, HALL_H, HX, WING_W, WING_D, WING_H, WX,
          TH, DOOR_W, DOOR_H, PORCH } = MANOR;
  const plaster = texMat(plasterTex());
  const planks = texMat(planksTex());
  const stone = texMat(stoneTex("#8d9499"));
  const shingleMain = texMat(shingleTex("#8c3b2f"));
  const shingleWing = texMat(shingleTex("#5a6e8c"));
  const trim = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });
  const g = new THREE.Group();
  const zf = 2.1 - TH / 2;

  const glow = (w: number, h: number, x: number, y: number, z: number, rotY = 0) => {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0xffd98a, side: THREE.DoubleSide }));
    pane.position.set(x, y, z);
    pane.rotation.y = rotY;
    pane.userData = { noShadow: true };
    g.add(pane);
  };

  // ── exterior shell (matches the wall plan box for box) ──────────────
  // hall front with main door
  g.add(panelAt(1.9, HALL_H, TH, plaster, -3.25, HALL_H / 2, zf));
  g.add(panelAt(1.3, HALL_H, TH, plaster, -0.45, HALL_H / 2, zf));
  g.add(panelAt(DOOR_W, HALL_H - DOOR_H, TH, plaster, -1.7, DOOR_H + (HALL_H - DOOR_H) / 2, zf));
  g.add(panelAt(2 * 1.8, WING_H, TH, plaster, WX, WING_H / 2, zf));         // wing front
  g.add(panelAt(2 * 2.5, HALL_H, TH, plaster, HX, HALL_H / 2, -zf));        // hall back
  g.add(panelAt(2 * 1.8, WING_H, TH, plaster, WX, WING_H / 2, -zf));        // wing back
  g.add(panelAt(TH, HALL_H, 2 * (2.1 - TH), plaster, -4.2 + TH / 2, HALL_H / 2, 0));
  g.add(panelAt(TH, WING_H, 2 * (2.1 - TH), plaster, 4.4 - TH / 2, WING_H / 2, 0));
  // party wall + interior doorway
  g.add(panelAt(0.14, WING_H, 2 * 1.06, plaster, 0.8, WING_H / 2, -0.96));
  g.add(panelAt(0.14, WING_H, 2 * 0.46, plaster, 0.8, WING_H / 2, 1.56));
  g.add(panelAt(0.14, WING_H - 2.0, 1.0, plaster, 0.8, 2.0 + (WING_H - 2.0) / 2, 0.6));
  // wing partition (study | bedroom) + interior doorway
  g.add(panelAt(2 * 0.6, WING_H, 0.14, plaster, 1.55, WING_H / 2, 0));
  g.add(panelAt(2 * 0.6, WING_H, 0.14, plaster, 3.65, WING_H / 2, 0));
  g.add(panelAt(0.9, WING_H - 2.0, 0.14, plaster, 2.6, 2.0 + (WING_H - 2.0) / 2, 0));

  // stone foundation strip + timber corners + floors
  g.add(panelAt(8.7, 0.25, 4.35, stone, 0.1, 0.125, 0));
  for (const [cx, cz] of [[-4.1, 2.0], [-4.1, -2.0], [4.3, 2.0], [4.3, -2.0], [0.8, 2.0], [0.8, -2.0]] as const) {
    g.add(panelAt(0.22, Math.max(HALL_H, WING_H) * 0.92, 0.22, planks, cx, 1.35, cz));
  }
  g.add(panelAt(2 * 2.45, 0.1, 2 * 1.95, planks, HX, 0.3, 0));
  g.add(panelAt(2 * 1.75, 0.1, 2 * 1.95, planks, WX, 0.3, 0));

  // windows (glow panes; walls behind stay solid)
  glow(0.8, 0.85, -3.25, 1.55, zf + 0.09);
  glow(0.8, 0.85, -0.45, 1.55, zf + 0.09);
  glow(0.8, 0.8, 2.0, 1.45, zf + 0.09);
  glow(0.8, 0.8, 3.3, 1.45, zf + 0.09);
  glow(0.8, 0.85, -1.0, 1.55, -zf - 0.09);
  glow(0.8, 0.85, -2.6, 1.55, -zf - 0.09);
  glow(0.8, 0.8, 2.6, 1.45, -zf - 0.09);
  glow(0.8, 0.85, -4.2 - 0.01, 1.55, 0.0, Math.PI / 2);
  glow(0.8, 0.8, 4.4 + 0.01, 1.45, -1.0, Math.PI / 2);

  // door frame
  g.add(panelAt(0.14, DOOR_H, TH + 0.08, trim, -1.7 - DOOR_W / 2 - 0.07, DOOR_H / 2, zf));
  g.add(panelAt(0.14, DOOR_H, TH + 0.08, trim, -1.7 + DOOR_W / 2 + 0.07, DOOR_H / 2, zf));
  g.add(panelAt(DOOR_W + 0.3, 0.14, TH + 0.08, trim, -1.7, DOOR_H + 0.07, zf));

  // ── porch: standable pad + columns + little roof ─────────────────────
  g.add(panelAt(PORCH.hw * 2, PORCH.top, PORCH.hd * 2, stone, PORCH.x, PORCH.top / 2, PORCH.z));
  for (const px of [-2.75, -0.65]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.3, 8), planks);
    col.position.set(px, PORCH.top + 1.15, 3.1);
    g.add(col);
  }
  const porchRoof = panelAt(3.2, 0.12, 1.7, shingleMain, -1.7, 2.62, 2.85);
  porchRoof.rotation.x = 0.18;
  g.add(porchRoof);

  // ── roofs: two gables + chimneys ─────────────────────────────────────
  const hallRoof = gableRoof(HALL_W, HALL_D, 1.5, shingleMain);
  hallRoof.position.set(HX, HALL_H + 0.08, 0);
  g.add(hallRoof);
  for (const sz of [-1, 1]) {
    const ge = gableEnd(HALL_W + 0.1, 1.45, plaster);
    ge.position.set(HX, HALL_H + 0.08, sz * (HALL_D / 2 + 0.02));
    g.add(ge);
  }
  const wingRoof = gableRoof(WING_W, WING_D, 1.0, shingleWing);
  wingRoof.position.set(WX, WING_H + 0.06, 0);
  g.add(wingRoof);
  for (const sz of [-1, 1]) {
    const ge = gableEnd(WING_W + 0.1, 0.95, plaster);
    ge.position.set(WX, WING_H + 0.06, sz * (WING_D / 2 + 0.02));
    g.add(ge);
  }
  g.add(panelAt(0.5, 1.6, 0.5, stone, -3.4, HALL_H + 1.3, -0.9));
  g.add(panelAt(0.42, 1.2, 0.42, stone, 3.6, WING_H + 1.0, -1.0));

  // ── THE HALL: hearth, long table, stools, chandelier, banners, rug ──
  const hearth = panelAt(1.1, 1.4, 0.34, stone, -4.0, 0.7, -0.6);
  g.add(hearth);
  const ember = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.42),
    new THREE.MeshBasicMaterial({ color: 0xff9a45 }));
  ember.position.set(-3.81, 0.5, -0.6);
  ember.rotation.y = Math.PI / 2;
  ember.userData = { noShadow: true };
  g.add(ember);
  g.add(panelAt(2.2, 0.09, 0.7, planks, -1.9, 0.62, -0.4));               // table top
  for (const [lx, lz] of [[-2.9, -0.7], [-0.9, -0.7], [-2.9, -0.1], [-0.9, -0.1]] as const) {
    g.add(panelAt(0.09, 0.55, 0.09, planks, lx, 0.34, lz));
  }
  for (const [sx, sz] of [[-2.5, 0.35], [-1.3, 0.35], [-2.5, -1.15], [-1.3, -1.15]] as const) {
    g.add(panelAt(0.34, 0.34, 0.34, planks, sx, 0.23, sz));
  }
  const chand = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 16),
    new THREE.MeshBasicMaterial({ color: 0xffc46a }));
  chand.rotation.x = Math.PI / 2;
  chand.position.set(-1.9, 2.35, -0.4);
  chand.userData = { noShadow: true };
  g.add(chand);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6),
    new THREE.MeshLambertMaterial({ color: 0x8c2f3f }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-1.9, 0.37, -0.3);
  g.add(rug);
  for (const bx of [-2.8, -1.0]) {
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.04),
      new THREE.MeshLambertMaterial({ color: 0x2f5f8c }));
    banner.position.set(bx, 2.0, -zf + 0.1);
    banner.userData = { noShadow: true };
    g.add(banner);
  }

  // ── THE STUDY (wing, front half): desk, books, shelf, candle ─────────
  g.add(panelAt(1.0, 0.08, 0.55, planks, 2.6, 0.78, 1.3));                // desk top
  for (const [lx, lz] of [[2.15, 1.1], [3.05, 1.1], [2.15, 1.5], [3.05, 1.5]] as const) {
    g.add(panelAt(0.08, 0.7, 0.08, planks, lx, 0.43, lz));
  }
  g.add(panelAt(0.34, 0.34, 0.34, planks, 2.6, 0.23, 0.7));               // chair
  const bookColors = [0x8c2f3f, 0x2f5f8c, 0x3f7a3a, 0xb78a3a, 0x6b4a8c, 0x8c6a2f];
  for (let i = 0; i < 6; i++) {
    g.add(panelAt(0.1, 0.3, 0.22,
      new THREE.MeshLambertMaterial({ color: bookColors[i] }),
      3.55 + (i % 3) * 0.13, 1.5 + Math.floor(i / 3) * 0.45, 1.45));
  }
  g.add(panelAt(0.6, 0.05, 0.3, planks, 3.74, 1.32, 1.45));               // shelf boards
  g.add(panelAt(0.6, 0.05, 0.3, planks, 3.74, 1.77, 1.45));
  for (let i = 0; i < 3; i++) {                                            // desk book stack
    g.add(panelAt(0.3, 0.06, 0.22,
      new THREE.MeshLambertMaterial({ color: bookColors[(i + 2) % 6] }),
      2.85, 0.85 + i * 0.065, 1.25));
  }
  const candle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd98a }));
  candle.position.set(2.35, 0.92, 1.35);
  candle.userData = { noShadow: true };
  g.add(candle);

  // ── THE BEDROOM (wing, back half): bed, chest, rug ───────────────────
  g.add(panelAt(0.95, 0.28, 1.7, planks, 2.0, 0.34, -1.15));              // bed frame
  g.add(panelAt(0.85, 0.14, 1.55, new THREE.MeshLambertMaterial({ color: 0xeae4d6 }),
    2.0, 0.55, -1.15));                                                    // mattress
  g.add(panelAt(0.6, 0.1, 0.3, new THREE.MeshLambertMaterial({ color: 0xd9d2c0 }),
    2.0, 0.64, -1.75));                                                    // pillow
  g.add(panelAt(0.7, 0.45, 0.42, trim, 3.6, 0.43, -1.5));                 // chest
  g.add(panelAt(0.7, 0.07, 0.42, planks, 3.6, 0.69, -1.5));
  const brug = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9),
    new THREE.MeshLambertMaterial({ color: 0x3f6a5a }));
  brug.rotation.x = -Math.PI / 2;
  brug.position.set(2.9, 0.37, -0.9);
  g.add(brug);

  return g;
}

export function buildFallback(): THREE.Object3D {
  // Mystery cube — for any meshTag we truly can't resolve
  const m = box(PALETTE.fallback, 0.6, 0.6, 0.6);
  return m;
}

// ── Registry ──────────────────────────────────────────────────────────

export interface BuilderRegistry {
  has(tag: string): boolean;
  build(tag: string): THREE.Object3D;
  register(tag: string, factory: () => THREE.Object3D): void;
}

/** Apply a material tint to every Lambert/Phong material in a built object,
 *  blending the base colour toward the tint so the prototype shape is kept
 *  but reads as the requested material. */
function tintObject(obj: THREE.Object3D, tint: number): void {
  const tintColor = new THREE.Color(tint);
  obj.traverse((o: any) => {
    const m = o.material;
    const apply = (mat: any) => {
      // Leave emissive/basic glow materials (flames, portals) untinted.
      if (mat && mat.color && mat.isMeshBasicMaterial !== true) {
        mat.color.lerp(tintColor, 0.55);
      }
    };
    if (Array.isArray(m)) m.forEach(apply);
    else if (m) apply(m);
  });
}

export class MeshBuilderRegistry implements BuilderRegistry {
  private builders = new Map<string, () => THREE.Object3D>();
  constructor() {
    this.register("player",        buildPlayer);
    this.register("sword",         buildSword);
    this.register("rock",          buildRock);
    this.register("tree",          buildTree);
    this.register("wizard_npc",    buildWizard);
    this.register("tutorial_wizard", buildWizard);
    this.register("guard_npc",     buildGuard);
    this.register("merchant_npc",  buildMerchant);
    this.register("scholar_npc",   buildScholar);
    this.register("wolf",          buildWolf);
    this.register("deer",          buildDeer);
    this.register("doorway",       buildDoorway);
    this.register("portal",        buildPortal);
    this.register("workshop",      buildWorkshop);
    this.register("temple",        buildTemple);
    this.register("manor",         buildManor);
    this.register("tower",         buildTower);
    this.register("castle",        buildCastle);
    this.register("house",         buildHouse);
    this.register("column",        buildColumn);
    this.register("bridge",        buildBridge);
    this.register("grove",         buildGrove);
    this.register("lantern",       buildLantern);
    this.register("staff",         buildStaff);
    this.register("book",          buildBook);
    this.register("shield",        buildShield);
    this.register("pine",          buildPine);
    this.register("bush",          buildBush);
    this.register("flower",        buildFlower);
    this.register("grass",         buildGrass);
    this.register("mushroom",      buildMushroom);
    this.register("cactus",        buildCactus);
    this.register("ice_block",     buildIceBlock);
    this.register("palm",          buildPalm);
    this.register("dune",          buildDune);
    this.register("sand",          buildDune);
    this.register("__fallback",    buildFallback);
  }

  /** True if we can render this tag with something better than the gray
   *  fallback — either an exact builder or a base reachable by stripping
   *  trailing material/style segments. */
  has(tag: string): boolean {
    return this.resolve(tag) !== null;
  }

  build(tag: string): THREE.Object3D {
    const r = this.resolve(tag);
    if (!r) return shadowify(buildFallback());
    const obj = r.factory();
    if (r.tint !== undefined) tintObject(obj, r.tint);
    return shadowify(obj);
  }

  register(tag: string, factory: () => THREE.Object3D): void {
    this.builders.set(tag, factory);
  }

  /** Resolve a (possibly composite) tag to a base factory + optional material
   *  tint. Tries the exact tag, then strips one trailing `_segment` at a time
   *  ("temple_marble" → "temple"), recording the first recognized material
   *  word as a tint. Returns null when nothing registered matches. */
  private resolve(tag: string): { factory: () => THREE.Object3D; tint?: number } | null {
    if (!tag) return null;
    const exact = this.builders.get(tag);
    if (exact) return { factory: exact };

    const segs = tag.split("_");
    let tint: number | undefined;
    // Strip from the right, retrying the shorter base each time.
    for (let end = segs.length - 1; end >= 1; end--) {
      const dropped = segs[end];
      if (tint === undefined && dropped in MATERIAL_TINTS) tint = MATERIAL_TINTS[dropped];
      const base = segs.slice(0, end).join("_");
      const f = this.builders.get(base);
      if (f) return { factory: f, tint };
    }
    return null;
  }
}
