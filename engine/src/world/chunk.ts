// Layer 2 — World substrate: chunks.
//
// A chunk is a cubic region of space (default 16m on a side) that holds
// every entity whose position falls in its bounds. Each chunk owns:
//   - a TS-side EntityRegistry of its entities
//   - an HRR "chunk vector" that is the superposition of (id_vec ⊛ entity_vec) for all entities
//   - a spatial bucket for fast in-chunk range queries
//
// The world's authoritative state for a region is the chunk's HRR vector;
// the EntityRegistry is the working-memory projection for systems that
// benefit from named-record access (rendering, scripting, physics).

import { type HRRVec } from "../hrr/types.js";
import { addInto, bind } from "../hrr/core.js";
import { EntityRegistry } from "../entity/registry.js";
import { emptyRegistryVec } from "../entity/encode.js";
import { type EntityRecord, type EntityId } from "../entity/types.js";

export const CHUNK_SIZE = 16;

export interface ChunkCoord {
  cx: number;
  cy: number;
  cz: number;
}

export function chunkKey(c: ChunkCoord): string {
  return `${c.cx},${c.cy},${c.cz}`;
}

export function chunkCoordFor(pos: { x: number; y: number; z: number }): ChunkCoord {
  return {
    cx: Math.floor(pos.x / CHUNK_SIZE),
    cy: Math.floor(pos.y / CHUNK_SIZE),
    cz: Math.floor(pos.z / CHUNK_SIZE),
  };
}

export class Chunk {
  readonly coord: ChunkCoord;
  readonly registry = new EntityRegistry();
  /** HRR vector: superposition of all (id_vec ⊛ entity_vec) in this chunk. */
  readonly vec: HRRVec = emptyRegistryVec();

  constructor(coord: ChunkCoord) {
    this.coord = coord;
  }

  addEntity(record: EntityRecord): void {
    const state = this.registry.add(record);
    const idV = this.registry.idVecFor(record.id);
    addInto(this.vec, bind(idV, state.vec));
  }

  removeEntity(id: EntityId): EntityRecord | undefined {
    const state = this.registry.get(id);
    if (!state) return undefined;
    const idV = this.registry.idVecFor(id);
    const bound = bind(idV, state.vec);
    // subtract from chunk vec
    for (let k = 0; k < this.vec.real.length; k++) {
      this.vec.real[k] -= bound.real[k];
      this.vec.imag[k] -= bound.imag[k];
    }
    this.registry.remove(id);
    return state.record;
  }

  /** Re-encode an entity after mutation: subtract old, update, add new. */
  updateEntity(id: EntityId, mutator: (r: EntityRecord) => void): EntityRecord | undefined {
    const state = this.registry.get(id);
    if (!state) return undefined;
    const idV = this.registry.idVecFor(id);
    const oldBound = bind(idV, state.vec);
    // Subtract old binding from chunk vec
    for (let k = 0; k < this.vec.real.length; k++) {
      this.vec.real[k] -= oldBound.real[k];
      this.vec.imag[k] -= oldBound.imag[k];
    }
    // Mutate + re-encode
    this.registry.update(id, mutator);
    const newState = this.registry.get(id)!;
    addInto(this.vec, bind(idV, newState.vec));
    return newState.record;
  }

  /** TS-side spatial query: entities within radius of position. */
  *entitiesInRadius(pos: { x: number; y: number; z: number }, radius: number): IterableIterator<EntityRecord> {
    const r2 = radius * radius;
    for (const state of this.registry.all()) {
      const dx = state.record.transform.position.x - pos.x;
      const dy = state.record.transform.position.y - pos.y;
      const dz = state.record.transform.position.z - pos.z;
      if (dx * dx + dy * dy + dz * dz <= r2) yield state.record;
    }
  }

  size(): number { return this.registry.size(); }
}
