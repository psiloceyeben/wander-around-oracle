// Building specifications — ONE source of truth for enterable architecture.
//
// Each spec carries the dimensions the mesh builder constructs from AND the
// wall plan the collision system enforces, so what you see is exactly what
// blocks you — and every door gap you see is a door you can walk through.
//
// Wall boxes are entity-local (entity origin = ground center), axis-aligned
// unless `rot` (radians, around Y) is given. `yBase` lifts a wall off the
// ground (cella walls standing on the temple platform).

export interface WallBox {
  x: number; z: number;     // center, local
  hw: number; hd: number;   // half-extents
  h: number;                // height
  yBase?: number;
  rot?: number;
}

export interface StandPad {
  x: number; z: number;
  hw: number; hd: number;
  top: number;
}

export interface BuildingSpec {
  /** Loose bounding footprint radius (placement + AI awareness). */
  footprint: number;
  /** Standable slabs (temple platform, manor porch) — step-up floors. */
  stands?: StandPad[];
  walls: WallBox[];
}

// ── house ────────────────────────────────────────────────────────────
export const HOUSE = {
  W: 3.6, D: 3.0, H: 2.5, TH: 0.16,
  DOOR_W: 1.1, DOOR_H: 1.95, RISE: 1.35,
};

// ── tower ────────────────────────────────────────────────────────────
export const TOWER = {
  R: 1.35, H: 5.0, TH: 0.16, FACETS: 8,
  DOOR_H: 2.0,
};

// ── castle ───────────────────────────────────────────────────────────
export const CASTLE = {
  W: 7.6, TH: 0.3, H: 2.9,
  GATE_W: 2.2, GATE_H: 2.5,
  TOWER_R: 0.95, TOWER_H: 4.4,
  KEEP_W: 3.0, KEEP_D: 2.6, KEEP_H: 2.4, KEEP_Z: -1.6, KEEP_DOOR: 1.0,
};

// ── temple ───────────────────────────────────────────────────────────
export const TEMPLE = {
  PLAT_W: 5.4, PLAT_D: 3.8, PLAT_H: 0.36,
  COL_R: 0.22, COL_H: 2.7,
  CELLA_W: 2.8, CELLA_D: 2.2, CELLA_H: 2.2, CELLA_Z: -0.35, CELLA_TH: 0.14,
  CELLA_DOOR: 1.2,
};

function houseWalls(): WallBox[] {
  const { W, D, H, TH, DOOR_W } = HOUSE;
  const zf = D / 2 - TH / 2, seg = (W - DOOR_W) / 2;
  return [
    // front: two segments flanking the door gap
    { x: -(DOOR_W / 2 + seg / 2), z: zf, hw: seg / 2, hd: TH / 2, h: H },
    { x: +(DOOR_W / 2 + seg / 2), z: zf, hw: seg / 2, hd: TH / 2, h: H },
    { x: 0, z: -zf, hw: W / 2, hd: TH / 2, h: H },                       // back
    { x: -(W / 2 - TH / 2), z: 0, hw: TH / 2, hd: D / 2 - TH, h: H },    // left
    { x: +(W / 2 - TH / 2), z: 0, hw: TH / 2, hd: D / 2 - TH, h: H },    // right
  ];
}

function towerWalls(): WallBox[] {
  const { R, H, TH, FACETS } = TOWER;
  const walls: WallBox[] = [];
  const facetW = 2 * R * Math.tan(Math.PI / FACETS);
  for (let k = 0; k < FACETS; k++) {
    const a = (k / FACETS) * Math.PI * 2;
    if (k === 0) continue;                       // the door facet (faces +z)
    walls.push({
      x: Math.sin(a) * (R - TH / 2), z: Math.cos(a) * (R - TH / 2),
      hw: facetW / 2, hd: TH / 2, h: H, rot: a,
    });
  }
  return walls;
}

function castleWalls(): WallBox[] {
  const { W, TH, H, GATE_W, TOWER_R, TOWER_H,
          KEEP_W, KEEP_D, KEEP_H, KEEP_Z, KEEP_DOOR } = CASTLE;
  const half = W / 2, zc = half - TH / 2;
  const seg = (W - GATE_W) / 2;
  const walls: WallBox[] = [
    // front curtain split by the gate
    { x: -(GATE_W / 2 + seg / 2), z: zc, hw: seg / 2, hd: TH / 2, h: H },
    { x: +(GATE_W / 2 + seg / 2), z: zc, hw: seg / 2, hd: TH / 2, h: H },
    { x: 0, z: -zc, hw: half, hd: TH / 2, h: H },                        // back
    { x: -zc, z: 0, hw: TH / 2, hd: half - TH, h: H },                   // left
    { x: +zc, z: 0, hw: TH / 2, hd: half - TH, h: H },                   // right
  ];
  // corner towers
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    walls.push({ x: sx * (half - 0.3), z: sz * (half - 0.3),
                 hw: TOWER_R, hd: TOWER_R, h: TOWER_H });
  }
  // the keep — a small enterable house inside, door toward the courtyard
  const kzf = KEEP_Z + KEEP_D / 2 - 0.07, kseg = (KEEP_W - KEEP_DOOR) / 2;
  walls.push(
    { x: -(KEEP_DOOR / 2 + kseg / 2), z: kzf, hw: kseg / 2, hd: 0.07, h: KEEP_H },
    { x: +(KEEP_DOOR / 2 + kseg / 2), z: kzf, hw: kseg / 2, hd: 0.07, h: KEEP_H },
    { x: 0, z: KEEP_Z - KEEP_D / 2 + 0.07, hw: KEEP_W / 2, hd: 0.07, h: KEEP_H },
    { x: -(KEEP_W / 2 - 0.07), z: KEEP_Z, hw: 0.07, hd: KEEP_D / 2 - 0.14, h: KEEP_H },
    { x: +(KEEP_W / 2 - 0.07), z: KEEP_Z, hw: 0.07, hd: KEEP_D / 2 - 0.14, h: KEEP_H },
  );
  return walls;
}

function templeWalls(): WallBox[] {
  const { PLAT_H, COL_R, COL_H, CELLA_W, CELLA_D, CELLA_H, CELLA_Z,
          CELLA_TH, CELLA_DOOR } = TEMPLE;
  const walls: WallBox[] = [];
  // peristyle columns: four across the front, two rear corners
  const colXs = [-1.95, -0.65, 0.65, 1.95];
  for (const x of colXs) walls.push({ x, z: 1.35, hw: COL_R, hd: COL_R, h: COL_H, yBase: PLAT_H });
  for (const x of [-1.95, 1.95]) walls.push({ x, z: -1.35, hw: COL_R, hd: COL_R, h: COL_H, yBase: PLAT_H });
  // cella
  const zf = CELLA_Z + CELLA_D / 2 - CELLA_TH / 2;
  const seg = (CELLA_W - CELLA_DOOR) / 2;
  walls.push(
    { x: -(CELLA_DOOR / 2 + seg / 2), z: zf, hw: seg / 2, hd: CELLA_TH / 2, h: CELLA_H, yBase: PLAT_H },
    { x: +(CELLA_DOOR / 2 + seg / 2), z: zf, hw: seg / 2, hd: CELLA_TH / 2, h: CELLA_H, yBase: PLAT_H },
    { x: 0, z: CELLA_Z - CELLA_D / 2 + CELLA_TH / 2, hw: CELLA_W / 2, hd: CELLA_TH / 2, h: CELLA_H, yBase: PLAT_H },
    { x: -(CELLA_W / 2 - CELLA_TH / 2), z: CELLA_Z, hw: CELLA_TH / 2, hd: CELLA_D / 2 - CELLA_TH, h: CELLA_H, yBase: PLAT_H },
    { x: +(CELLA_W / 2 - CELLA_TH / 2), z: CELLA_Z, hw: CELLA_TH / 2, hd: CELLA_D / 2 - CELLA_TH, h: CELLA_H, yBase: PLAT_H },
  );
  return walls;
}

// ── manor — the flagship: three rooms, porch, two roof heights ───────
export const MANOR = {
  HALL_W: 5.0, HALL_D: 4.2, HALL_H: 3.0, HX: -1.7,
  WING_W: 3.6, WING_D: 4.2, WING_H: 2.5, WX: 2.6,
  TH: 0.16, DOOR_W: 1.2, DOOR_H: 2.0,
  SHARED_X: 0.8,                       // hall/wing party wall
  PORCH: { x: -1.7, z: 2.75, hw: 1.4, hd: 0.65, top: 0.22 },
};

function manorWalls(): WallBox[] {
  const { HALL_H, WING_H, TH, DOOR_W, SHARED_X } = MANOR;
  const zf = 2.1 - TH / 2;             // front/back wall centerlines
  const walls: WallBox[] = [
    // hall front: two segments around the main door (door centered x=-1.7)
    { x: -3.25, z: zf, hw: 0.95, hd: TH / 2, h: HALL_H },
    { x: -0.45, z: zf, hw: 0.65, hd: TH / 2, h: HALL_H },
    // wing front (window only — solid)
    { x: 2.6, z: zf, hw: 1.8, hd: TH / 2, h: WING_H },
    // backs (hall + wing heights differ)
    { x: -1.7, z: -zf, hw: 2.5, hd: TH / 2, h: HALL_H },
    { x: 2.6, z: -zf, hw: 1.8, hd: TH / 2, h: WING_H },
    // west (hall) + east (wing) gables
    { x: -4.2 + TH / 2, z: 0, hw: TH / 2, hd: 2.1 - TH, h: HALL_H },
    { x: 4.4 - TH / 2, z: 0, hw: TH / 2, hd: 2.1 - TH, h: WING_H },
    // shared party wall with interior doorway (gap z 0.1..1.1)
    { x: SHARED_X, z: -0.96, hw: 0.07, hd: 1.06, h: WING_H },
    { x: SHARED_X, z: 1.56, hw: 0.07, hd: 0.46, h: WING_H },
    // wing partition (study | bedroom) with interior doorway (gap x 2.15..3.05)
    { x: 1.55, z: 0, hw: 0.6, hd: 0.07, h: WING_H },
    { x: 3.65, z: 0, hw: 0.6, hd: 0.07, h: WING_H },
    // porch columns
    { x: -2.75, z: 3.1, hw: 0.14, hd: 0.14, h: 2.3 },
    { x: -0.65, z: 3.1, hw: 0.14, hd: 0.14, h: 2.3 },
  ];
  return walls;
}

/** Wall plans by prototype — the collision system's map of architecture. */
export const BUILDING_SPECS: Record<string, BuildingSpec> = {
  house:  { footprint: 2.4, walls: houseWalls() },
  tower:  { footprint: 1.9, walls: towerWalls() },
  castle: { footprint: 4.6, walls: castleWalls() },
  temple: {
    footprint: 3.2,
    stands: [{ x: 0, z: 0, hw: TEMPLE.PLAT_W / 2 + 0.3, hd: TEMPLE.PLAT_D / 2 + 0.3,
               top: TEMPLE.PLAT_H }],
    walls: templeWalls(),
  },
  manor:  { footprint: 5.0, stands: [MANOR.PORCH], walls: manorWalls() },
};
