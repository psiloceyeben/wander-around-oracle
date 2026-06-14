// Terrain projection — streamed, vertex-colored ground tiles.
//
// The terrain SHAPE lives in the engine (terrainHeightAt / climateAt in
// the biomeWorldgen feature — pure functions of world seed). This module
// only projects that field into Three.js meshes: one 16×16m tile per
// chunk, 16×16 segments, vertex heights from terrainHeightAt and vertex
// colors blended from the climate field. A translucent water plane sits
// at WATER_LEVEL and follows the player.
//
// Substrate paradigm: the world substrate carries elevation; this file is
// a read-only projection of it, exactly like ThreeProjection for entities.

import * as THREE from "three";
import { terrainHeightAt, climateAt } from "@engine/features/biomeWorldgen/index.js";

export const WATER_LEVEL = -0.6;
const TILE = 16;          // must match engine CHUNK_SIZE
const SEGS = 16;          // vertices per tile edge (17×17 grid)

// Ground palette per climate corner — blended continuously so biome
// transitions read as gradients, not seams.
const COL_MEADOW   = new THREE.Color(0x5a8f4e);
const COL_FOREST   = new THREE.Color(0x3e7440);
const COL_MOUNTAIN = new THREE.Color(0x7d7f82);
const COL_DESERT   = new THREE.Color(0xcdb178);
const COL_FROZEN   = new THREE.Color(0xdfe8ee);
const COL_COAST    = new THREE.Color(0xc7b387);
const COL_UNDERWATER = new THREE.Color(0x8a8467);
const COL_SNOWCAP  = new THREE.Color(0xeef3f6);

function groundColorAt(x: number, z: number, seed: number, h: number, out: THREE.Color): void {
  const c = climateAt(x, z, seed);
  // Temperature axis: frozen/mountain → temperate → desert/coast
  if (c.temp < 0.34) {
    out.copy(c.moist < 0.5 ? COL_FROZEN : COL_MOUNTAIN);
    if (c.moist >= 0.5) {
      // High mountain → snow cap blend
      const snow = Math.max(0, Math.min(1, (h - 5.0) / 3.0));
      out.lerp(COL_SNOWCAP, snow);
    }
  } else if (c.temp < 0.62) {
    const t = (c.temp - 0.34) / 0.28;
    out.copy(c.moist < 0.40 ? COL_MEADOW : COL_FOREST);
    // Edge blend toward the cold side
    if (t < 0.25) out.lerp(c.moist < 0.5 ? COL_FROZEN : COL_MOUNTAIN, (0.25 - t) * 2.2);
  } else {
    const t = (c.temp - 0.62) / 0.38;
    out.copy(c.moist < 0.52 ? COL_DESERT : COL_COAST);
    if (t < 0.2) out.lerp(c.moist < 0.40 ? COL_MEADOW : COL_FOREST, (0.2 - t) * 2.5);
  }
  // Below water — darken to lakebed
  if (h < WATER_LEVEL + 0.25) out.lerp(COL_UNDERWATER, 0.7);
  // Slight deterministic mottling so large fields aren't flat color
  const mottle = ((Math.imul((x * 73856093) ^ (z * 19349663), 2654435761) >>> 16) & 0xff) / 255;
  out.offsetHSL(0, 0, (mottle - 0.5) * 0.045);
}

function buildTile(cx: number, cz: number, seed: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(TILE, TILE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  const ox = cx * TILE + TILE / 2;
  const oz = cz * TILE + TILE / 2;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + ox;
    const wz = pos.getZ(i) + oz;
    const h = terrainHeightAt(wx, wz, seed);
    pos.setY(i, h);
    groundColorAt(wx, wz, seed, h, tmp);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(ox, 0, oz);
  mesh.receiveShadow = true;
  mesh.name = `terrain-${cx},${cz}`;
  return mesh;
}

export class TerrainStreamer {
  private scene: THREE.Scene;
  private seed: number;
  private radius: number;
  private unloadBeyond: number;
  private tiles = new Map<string, THREE.Mesh>();
  readonly water: THREE.Mesh;

  constructor(opts: { scene: THREE.Scene; seed: number; radius?: number }) {
    this.scene = opts.scene;
    this.seed = opts.seed;
    this.radius = opts.radius ?? 3;
    this.unloadBeyond = this.radius + 2;

    const waterGeo = new THREE.PlaneGeometry(TILE * 24, TILE * 24);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshLambertMaterial({
      color: 0x3a6b9c, transparent: true, opacity: 0.78,
    });
    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.position.y = WATER_LEVEL;
    this.water.name = "water";
    this.scene.add(this.water);
  }

  setRadius(r: number): void {
    this.radius = r;
    this.unloadBeyond = r + 2;
  }

  /** Height query (delegates to the engine field). */
  heightAt(x: number, z: number): number {
    return terrainHeightAt(x, z, this.seed);
  }

  /** Stream tiles around the player. Cheap when nothing changes. */
  update(px: number, pz: number): void {
    const pcx = Math.floor(px / TILE);
    const pcz = Math.floor(pz / TILE);
    for (let dx = -this.radius; dx <= this.radius; dx++) {
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        const k = `${cx},${cz}`;
        if (this.tiles.has(k)) continue;
        const tile = buildTile(cx, cz, this.seed);
        this.scene.add(tile);
        this.tiles.set(k, tile);
      }
    }
    for (const [k, tile] of this.tiles) {
      const [cx, cz] = k.split(",").map(Number);
      const d = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
      if (d <= this.unloadBeyond) continue;
      this.scene.remove(tile);
      tile.geometry.dispose();
      (tile.material as THREE.Material).dispose();
      this.tiles.delete(k);
    }
    // Water follows the player so the sea never ends
    this.water.position.x = px;
    this.water.position.z = pz;
  }

  /** Per-frame: a slow breath on the waterline so the sea reads alive. */
  tickWater(tSec: number): void {
    this.water.position.y = WATER_LEVEL + Math.sin(tSec * 0.45) * 0.05;
    (this.water.material as THREE.MeshLambertMaterial).opacity =
      0.74 + Math.sin(tSec * 0.3 + 1.7) * 0.05;
  }

  tileCount(): number { return this.tiles.size; }
}
