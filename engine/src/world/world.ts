// The World holds all chunks and provides global queries that span them.
// World-level operations route to the appropriate chunk based on position.

import { type EntityRecord, type EntityId } from "../entity/types.js";
import { Chunk, type ChunkCoord, chunkCoordFor, chunkKey, CHUNK_SIZE } from "./chunk.js";

export class World {
  readonly seed: number;
  /** Current simulation tick. Incremented by Layer 3. */
  tick: number = 0;
  private chunks = new Map<string, Chunk>();
  /** Index from entity id → chunk key, for fast cross-chunk lookup. */
  private entityChunk = new Map<EntityId, string>();

  constructor(seed: number = 0) {
    this.seed = seed;
  }

  getOrCreateChunk(coord: ChunkCoord): Chunk {
    const k = chunkKey(coord);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(coord);
      this.chunks.set(k, c);
    }
    return c;
  }

  getChunk(coord: ChunkCoord): Chunk | undefined {
    return this.chunks.get(chunkKey(coord));
  }

  addEntity(record: EntityRecord): void {
    const coord = chunkCoordFor(record.transform.position);
    const chunk = this.getOrCreateChunk(coord);
    chunk.addEntity(record);
    this.entityChunk.set(record.id, chunkKey(coord));
  }

  removeEntity(id: EntityId): EntityRecord | undefined {
    const ck = this.entityChunk.get(id);
    if (!ck) return undefined;
    const chunk = this.chunks.get(ck);
    if (!chunk) return undefined;
    const rec = chunk.removeEntity(id);
    this.entityChunk.delete(id);
    return rec;
  }

  /** Mutate an entity. If position changes between chunks, re-bucket. */
  updateEntity(id: EntityId, mutator: (r: EntityRecord) => void): EntityRecord | undefined {
    const ck = this.entityChunk.get(id);
    if (!ck) return undefined;
    const chunk = this.chunks.get(ck);
    if (!chunk) return undefined;
    const before = chunk.registry.get(id)?.record.transform.position;
    if (!before) return undefined;
    const beforePos = { x: before.x, y: before.y, z: before.z };

    const updated = chunk.updateEntity(id, mutator);
    if (!updated) return undefined;

    const newCoord = chunkCoordFor(updated.transform.position);
    const newKey = chunkKey(newCoord);
    if (newKey !== ck) {
      // Migrate to new chunk
      const removed = chunk.removeEntity(id)!;
      const newChunk = this.getOrCreateChunk(newCoord);
      newChunk.addEntity(removed);
      this.entityChunk.set(id, newKey);
      // beforePos can be inspected by caller via the returned record's prior
      // position if needed. (No-op suppression of unused-vars rule.)
      void beforePos;
    }
    return updated;
  }

  getEntity(id: EntityId): EntityRecord | undefined {
    const ck = this.entityChunk.get(id);
    if (!ck) return undefined;
    return this.chunks.get(ck)?.registry.get(id)?.record;
  }

  /** Range query: entities within radius of pos, across all relevant chunks. */
  *entitiesInRadius(pos: { x: number; y: number; z: number }, radius: number): IterableIterator<EntityRecord> {
    const minCx = Math.floor((pos.x - radius) / CHUNK_SIZE);
    const maxCx = Math.floor((pos.x + radius) / CHUNK_SIZE);
    const minCy = Math.floor((pos.y - radius) / CHUNK_SIZE);
    const maxCy = Math.floor((pos.y + radius) / CHUNK_SIZE);
    const minCz = Math.floor((pos.z - radius) / CHUNK_SIZE);
    const maxCz = Math.floor((pos.z + radius) / CHUNK_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const c = this.chunks.get(chunkKey({ cx, cy, cz }));
          if (c) yield* c.entitiesInRadius(pos, radius);
        }
      }
    }
  }

  /** All entities across all loaded chunks. Iterate in chunk-key order. */
  *allEntities(): IterableIterator<EntityRecord> {
    for (const c of this.chunks.values()) {
      for (const state of c.registry.all()) yield state.record;
    }
  }

  loadedChunkCount(): number { return this.chunks.size; }

  entityCount(): number { return this.entityChunk.size; }

  /** Iterate all loaded chunks. */
  *loadedChunks(): IterableIterator<Chunk> {
    for (const c of this.chunks.values()) yield c;
  }
}
