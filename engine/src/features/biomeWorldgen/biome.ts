// Feature: Biome worldgen as chunk-data producer.
//
// Generates terrain + foliage entities for chunks as the player moves.
// Produces DATA first (entities + SpawnEntity commands); the projection
// builds meshes downstream. Deterministic from world.seed + chunk coords.
//
// Six biomes: meadow / forest / mountain / desert / frozen / coastline.
// Biome selection is climate-driven: two continuous noise fields
// (temperature + moisture) classify each chunk, so biomes form organic
// regions ~100m across instead of stripes. The same climate fields shape
// terrain height (terrainHeightAt), so the world substrate carries real
// elevation — projections read it, they don't invent it.

import { type ChunkCoord, chunkKey, CHUNK_SIZE } from "../../world/chunk.js";
import { World } from "../../world/world.js";
import { CommandBus } from "../../cmd/bus.js";
import { identityTransform } from "../../entity/types.js";
import { type Sephirah } from "../../hrr/treeOfLife.js";

export type BiomeName = "meadow" | "forest" | "mountain" | "desert" | "frozen" | "coastline";

interface FoliageSpec {
  prototypeId: string;
  density: number;
  meshTag?: string;
  /** Solid footprint (axis-aligned box) — omitted means walk-through. */
  collider?: { x: number; y: number; z: number };
  /** Small pickupable decoration (flowers, mushrooms). */
  pickup?: boolean;
}

interface BiomeSpec {
  name: BiomeName;
  foliage: ReadonlyArray<FoliageSpec>;
  /** Routing Sephirah for entities in this biome. */
  sephirah: Sephirah;
}

const BIOMES: Record<BiomeName, BiomeSpec> = {
  meadow: {
    name: "meadow", sephirah: "netzach",
    foliage: [
      { prototypeId: "grass",    density: 0.16 },
      { prototypeId: "flower",   density: 0.06, pickup: true },
      { prototypeId: "tree",     density: 0.015, collider: { x: 0.5, y: 3, z: 0.5 } },
      { prototypeId: "bush",     density: 0.02 },
    ],
  },
  forest: {
    name: "forest", sephirah: "netzach",
    foliage: [
      { prototypeId: "tree",     density: 0.14, collider: { x: 0.5, y: 3, z: 0.5 } },
      { prototypeId: "bush",     density: 0.05 },
      { prototypeId: "mushroom", density: 0.015, pickup: true },
      { prototypeId: "rock",     density: 0.02, collider: { x: 0.7, y: 0.7, z: 0.7 } },
    ],
  },
  mountain: {
    name: "mountain", sephirah: "geburah",
    foliage: [
      { prototypeId: "rock",     density: 0.10, collider: { x: 0.8, y: 0.8, z: 0.8 } },
      { prototypeId: "pine",     density: 0.06, collider: { x: 0.5, y: 4, z: 0.5 } },
      { prototypeId: "tree",     density: 0.01, collider: { x: 0.5, y: 3, z: 0.5 } },
    ],
  },
  desert: {
    name: "desert", sephirah: "malkuth",
    foliage: [
      { prototypeId: "cactus",   density: 0.035, collider: { x: 0.5, y: 1.8, z: 0.5 } },
      { prototypeId: "rock",     density: 0.045, collider: { x: 0.7, y: 0.7, z: 0.7 } },
      { prototypeId: "dune",     density: 0.012 },
    ],
  },
  frozen: {
    name: "frozen", sephirah: "binah",
    foliage: [
      { prototypeId: "pine",      density: 0.08, collider: { x: 0.5, y: 4, z: 0.5 } },
      { prototypeId: "ice_block", density: 0.04, collider: { x: 0.8, y: 0.9, z: 0.8 } },
      { prototypeId: "rock",      density: 0.03, collider: { x: 0.7, y: 0.7, z: 0.7 } },
    ],
  },
  coastline: {
    name: "coastline", sephirah: "yesod",
    foliage: [
      { prototypeId: "palm",     density: 0.03, collider: { x: 0.5, y: 3.5, z: 0.5 } },
      { prototypeId: "grass",    density: 0.05 },
      { prototypeId: "rock",     density: 0.025, collider: { x: 0.7, y: 0.7, z: 0.7 } },
    ],
  },
};

/** Deterministic FNV-1a + Mulberry32 for chunk seeding. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Continuous climate + terrain fields ───────────────────────────────
//
// Smooth value noise on a unit lattice. Hash per lattice point, smoothstep
// interpolation between corners. Deterministic from (seed, salt).

function latticeHash(ix: number, iz: number, seed: number, salt: number): number {
  let h = fnv1a(`${seed}:${salt}:${ix},${iz}`);
  return (h >>> 8) / 16777216; // [0, 1)
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0,1]. Input in "lattice units" (1 = one cell). */
export function valueNoise2(x: number, z: number, seed: number, salt: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = latticeHash(ix, iz, seed, salt);
  const b = latticeHash(ix + 1, iz, seed, salt);
  const c = latticeHash(ix, iz + 1, seed, salt);
  const d = latticeHash(ix + 1, iz + 1, seed, salt);
  const sx = smooth(fx), sz = smooth(fz);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function smoothstepRange(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface Climate { temp: number; moist: number; }

/** Continuous climate at a WORLD position. Near the origin the climate is
 *  pulled toward temperate forest/meadow so every seed spawns somewhere
 *  green and walkable; the pull fades out by ~4 chunks. */
export function climateAt(x: number, z: number, seed: number): Climate {
  let temp  = valueNoise2(x * 0.008, z * 0.008, seed, 11);
  let moist = valueNoise2(x * 0.008 + 37.3, z * 0.008 - 11.7, seed, 23);
  const dist = Math.sqrt(x * x + z * z);
  const pull = smoothstepRange(72, 18, dist); // 1 near origin → 0 by 72m
  temp  = temp  + (0.50 - temp)  * pull;
  moist = moist + (0.44 - moist) * pull;
  return { temp, moist };
}

function classify(c: Climate): BiomeName {
  if (c.temp < 0.34) return c.moist < 0.50 ? "frozen" : "mountain";
  if (c.temp < 0.62) return c.moist < 0.40 ? "meadow" : "forest";
  return c.moist < 0.52 ? "desert" : "coastline";
}

/** Biome at a WORLD position (continuous — used for ground tinting). */
export function biomeAtWorld(x: number, z: number, seed: number): BiomeName {
  return classify(climateAt(x, z, seed));
}

/** Terrain height (meters) at a world position. Gentle rolling hills,
 *  amplified in mountain climates, dipping below water level (-0.6) in
 *  coastline climates. The hub area (origin) is flattened so the spawn
 *  clearing reads as a meadow terrace. */
export function terrainHeightAt(x: number, z: number, seed: number): number {
  const broad = valueNoise2(x * 0.013, z * 0.013, seed, 31);
  const mid   = valueNoise2(x * 0.045, z * 0.045, seed, 41);
  let h = (broad - 0.5) * 5.2 + (mid - 0.5) * 1.5;

  const c = climateAt(x, z, seed);
  // Mountain ridges
  const wMountain = smoothstepRange(0.40, 0.24, c.temp) * smoothstepRange(0.42, 0.58, c.moist);
  if (wMountain > 0) {
    const ridge = valueNoise2(x * 0.02 + 91.7, z * 0.02 - 53.1, seed, 51);
    h += wMountain * ridge * 9.0;
  }
  // Coastline sinks toward (and below) water level
  const wCoast = smoothstepRange(0.60, 0.74, c.temp) * smoothstepRange(0.46, 0.60, c.moist);
  h -= wCoast * 3.2;
  // Frozen plateaus sit slightly high
  const wFrozen = smoothstepRange(0.40, 0.24, c.temp) * smoothstepRange(0.56, 0.40, c.moist);
  h += wFrozen * 0.9;

  // Flatten the hub: by dist 8 it's ~level, fading out by 30m.
  const dist = Math.sqrt(x * x + z * z);
  const flat = smoothstepRange(30, 8, dist);
  h *= (1 - flat * 0.92);
  return h;
}

/** Choose a biome for a chunk coordinate (climate sampled at chunk center). */
export function biomeFor(coord: ChunkCoord, seed: number): BiomeName {
  const x = coord.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const z = coord.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
  return biomeAtWorld(x, z, seed);
}

export interface WorldgenOpts {
  /** Circular regions where nothing spawns (hub plaza, building sites). */
  clearings?: ReadonlyArray<{ x: number; z: number; r: number }>;
}

/** The hub plaza — kept clear of generated foliage so the spawn area is an
 *  open meadow terrace with sight lines to the portal and workshop. */
export const DEFAULT_CLEARINGS: ReadonlyArray<{ x: number; z: number; r: number }> = [
  { x: 0, z: 0, r: 13 },
];

/** Generate entity commands for a chunk. Idempotent per (seed, coord).
 *  Returns the commands rather than submitting so the caller can batch.
 *  Entities are placed at terrain height; solid foliage carries colliders. */
export function generateChunkCommands(coord: ChunkCoord, seed: number, opts?: WorldgenOpts): {
  biome: BiomeName;
  commands: Array<{ kind: "SpawnEntity"; id: string; prototypeId: string; transform: any; components: any; sephirah?: Sephirah }>;
} {
  const biome = biomeFor(coord, seed);
  const spec = BIOMES[biome];
  const clearings = opts?.clearings ?? DEFAULT_CLEARINGS;
  const rng = mulberry32(fnv1a(`chunk:${seed}:${coord.cx},${coord.cy},${coord.cz}`));
  const commands = [];
  const baseId = `chunk-${coord.cx}-${coord.cy}-${coord.cz}`;
  let n = 0;
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (const fol of spec.foliage) {
        if (rng() < fol.density) {
          const wx = coord.cx * CHUNK_SIZE + lx + (rng() - 0.5) * 0.9;
          const wz = coord.cz * CHUNK_SIZE + lz + (rng() - 0.5) * 0.9;
          let cleared = false;
          for (const c of clearings) {
            const dx = wx - c.x, dz = wz - c.z;
            if (dx * dx + dz * dz < c.r * c.r) { cleared = true; break; }
          }
          if (cleared) break;
          const wy = terrainHeightAt(wx, wz, seed);
          // Don't plant land foliage under water
          if (wy < -0.45 && fol.prototypeId !== "rock") break;
          const id = `${baseId}-${fol.prototypeId}-${n++}`;
          const components: any = {
            renderable: { meshTag: fol.meshTag ?? fol.prototypeId },
            // Note: NO saveable — chunk content is regenerated from seed
          };
          if (fol.collider) {
            components.collider = { shape: "box", size: { ...fol.collider }, solid: true };
          }
          if (fol.pickup) {
            components.interactable = { verb: "pickup", range: 3 };
          }
          commands.push({
            kind: "SpawnEntity" as const,
            id,
            prototypeId: fol.prototypeId,
            transform: { ...identityTransform(), position: { x: wx, y: wy, z: wz } },
            components,
            sephirah: spec.sephirah,
          });
          break;  // one entity per cell
        }
      }
    }
  }
  return { biome, commands };
}

/** System: stream-load chunks within radius of the player, and (optionally)
 *  unload chunk entities once the player has moved far enough away. Unloaded
 *  chunks regenerate identically from the seed when revisited. */
export class BiomeStreamingSystem {
  private radiusChunks: number;
  private unloadBeyond: number | null;
  private clearings?: ReadonlyArray<{ x: number; z: number; r: number }>;
  private loaded = new Set<string>();
  private chunkEntities = new Map<string, string[]>();

  constructor(opts?: {
    radiusChunks?: number;
    /** Chebyshev chunk distance beyond which loaded chunks are despawned.
     *  Omit (or null) to keep every visited chunk loaded forever. */
    unloadBeyond?: number | null;
    clearings?: ReadonlyArray<{ x: number; z: number; r: number }>;
  }) {
    this.radiusChunks = opts?.radiusChunks ?? 4;
    this.unloadBeyond = opts?.unloadBeyond ?? null;
    this.clearings = opts?.clearings;
  }

  /** Call each tick. Loads chunks within radius of the playerPos. */
  tick(world: World, bus: CommandBus, playerPos: { x: number; y: number; z: number }): number {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    let loaded = 0;
    for (let dx = -this.radiusChunks; dx <= this.radiusChunks; dx++) {
      for (let dz = -this.radiusChunks; dz <= this.radiusChunks; dz++) {
        const coord = { cx: pcx + dx, cy: 0, cz: pcz + dz };
        const k = chunkKey(coord);
        if (this.loaded.has(k)) continue;
        const { commands } = generateChunkCommands(coord, world.seed, { clearings: this.clearings ?? DEFAULT_CLEARINGS });
        const ids: string[] = [];
        for (const cmd of commands) {
          bus.applyImmediate(cmd);
          ids.push(cmd.id);
        }
        this.loaded.add(k);
        this.chunkEntities.set(k, ids);
        loaded += commands.length;
      }
    }

    if (this.unloadBeyond !== null) {
      for (const k of Array.from(this.loaded)) {
        const [cx, , cz] = k.split(",").map(Number);
        const d = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
        if (d <= this.unloadBeyond) continue;
        const ids = this.chunkEntities.get(k) ?? [];
        for (const id of ids) {
          const e = world.getEntity(id);
          if (!e) continue;
          if (e.components.holder) continue; // never despawn something held
          bus.applyImmediate({ kind: "RemoveEntity", id });
        }
        this.loaded.delete(k);
        this.chunkEntities.delete(k);
      }
    }
    return loaded;
  }

  setRadius(r: number): void { this.radiusChunks = r; }
  loadedCount(): number { return this.loaded.size; }
  reset(): void { this.loaded.clear(); this.chunkEntities.clear(); }
}
