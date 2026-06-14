// EntityRegistry: the working-memory store for entity records + HRR vectors.
// The HRR registry vector is owned at the world layer; this registry holds
// the TS-record / HRR-vector pairs and provides id-keyed access.

import { type EntityRecord, type EntityState, type EntityId } from "./types.js";
import { entityToVec, registerPrototype } from "./encode.js";
import { idVec } from "../hrr/seed.js";

export class EntityRegistry {
  private byId = new Map<EntityId, EntityState>();
  private idVecCache = new Map<EntityId, ReturnType<typeof idVec>>();

  add(record: EntityRecord): EntityState {
    registerPrototype(record.prototypeId);
    const vec = entityToVec(record);
    const state: EntityState = { record, vec };
    this.byId.set(record.id, state);
    return state;
  }

  get(id: EntityId): EntityState | undefined {
    return this.byId.get(id);
  }

  has(id: EntityId): boolean {
    return this.byId.has(id);
  }

  remove(id: EntityId): EntityState | undefined {
    const s = this.byId.get(id);
    this.byId.delete(id);
    this.idVecCache.delete(id);
    return s;
  }

  /** Update the TS record AND re-encode the HRR vector. Use when transform
   *  or components change. */
  update(id: EntityId, mutator: (r: EntityRecord) => void): EntityState | undefined {
    const s = this.byId.get(id);
    if (!s) return undefined;
    mutator(s.record);
    s.vec = entityToVec(s.record);
    return s;
  }

  /** Cached id vector for binding into registry HRR vectors. */
  idVecFor(id: EntityId): ReturnType<typeof idVec> {
    let v = this.idVecCache.get(id);
    if (!v) {
      v = idVec(id);
      this.idVecCache.set(id, v);
    }
    return v;
  }

  size(): number { return this.byId.size; }

  /** Iterate over all entity states. */
  *all(): IterableIterator<EntityState> {
    for (const s of this.byId.values()) yield s;
  }

  /** Return all ids — useful for save and snapshot. */
  ids(): EntityId[] {
    return Array.from(this.byId.keys());
  }
}
