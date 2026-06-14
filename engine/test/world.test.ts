import { describe, it, expect } from "vitest";
import { World, CHUNK_SIZE, chunkCoordFor } from "../src/world/index.js";
import { type EntityRecord, identityTransform } from "../src/entity/index.js";

function entity(id: string, prototypeId: string, x: number, y: number, z: number): EntityRecord {
  return {
    id,
    prototypeId,
    transform: { ...identityTransform(), position: { x, y, z } },
    components: {},
  };
}

describe("Layer 2: World substrate", () => {
  it("chunkCoordFor maps positions to correct chunks", () => {
    expect(chunkCoordFor({ x: 0, y: 0, z: 0 })).toEqual({ cx: 0, cy: 0, cz: 0 });
    expect(chunkCoordFor({ x: CHUNK_SIZE, y: 0, z: 0 })).toEqual({ cx: 1, cy: 0, cz: 0 });
    expect(chunkCoordFor({ x: -1, y: 0, z: 0 })).toEqual({ cx: -1, cy: 0, cz: 0 });
  });

  it("addEntity routes to the correct chunk", () => {
    const w = new World();
    w.addEntity(entity("e1", "door", 0, 0, 0));
    w.addEntity(entity("e2", "tree", 20, 0, 0));  // different chunk
    expect(w.loadedChunkCount()).toBe(2);
    expect(w.entityCount()).toBe(2);
  });

  it("getEntity returns the right entity across chunks", () => {
    const w = new World();
    w.addEntity(entity("e1", "door", 0, 0, 0));
    w.addEntity(entity("e2", "tree", 20, 0, 0));
    expect(w.getEntity("e1")?.prototypeId).toBe("door");
    expect(w.getEntity("e2")?.prototypeId).toBe("tree");
  });

  it("removeEntity decrements count and chunk index", () => {
    const w = new World();
    w.addEntity(entity("e1", "door", 0, 0, 0));
    w.removeEntity("e1");
    expect(w.entityCount()).toBe(0);
    expect(w.getEntity("e1")).toBeUndefined();
  });

  it("entitiesInRadius finds entities across chunk boundaries", () => {
    const w = new World();
    w.addEntity(entity("near", "door", 0, 0, 0));
    w.addEntity(entity("edge", "tree", CHUNK_SIZE - 0.5, 0, 0));  // edge of chunk 0
    w.addEntity(entity("over", "rock", CHUNK_SIZE + 0.5, 0, 0));   // chunk 1
    w.addEntity(entity("far", "tower", 100, 0, 0));                // far away
    const found = Array.from(w.entitiesInRadius({ x: CHUNK_SIZE, y: 0, z: 0 }, 5)).map((e) => e.id);
    expect(found.sort()).toEqual(["edge", "over"]);
  });

  it("updateEntity that crosses chunk boundary re-buckets", () => {
    const w = new World();
    w.addEntity(entity("mover", "rock", 0, 0, 0));
    expect(w.loadedChunkCount()).toBe(1);
    w.updateEntity("mover", (r) => { r.transform.position.x = CHUNK_SIZE + 5; });
    // Original chunk still loaded (empty), new chunk loaded
    expect(w.loadedChunkCount()).toBe(2);
    // Entity is now in the new chunk
    expect(w.getEntity("mover")?.transform.position.x).toBe(CHUNK_SIZE + 5);
  });

  it("chunk's HRR vector grows with entities and shrinks with removals", () => {
    const w = new World();
    const chunk0 = w.getOrCreateChunk({ cx: 0, cy: 0, cz: 0 });
    // Initially zero
    let m2 = 0;
    for (let i = 0; i < chunk0.vec.real.length; i++) m2 += chunk0.vec.real[i] ** 2 + chunk0.vec.imag[i] ** 2;
    expect(Math.sqrt(m2)).toBeCloseTo(0, 6);

    w.addEntity(entity("e1", "door", 0, 0, 0));
    w.addEntity(entity("e2", "tree", 1, 0, 0));
    m2 = 0;
    for (let i = 0; i < chunk0.vec.real.length; i++) m2 += chunk0.vec.real[i] ** 2 + chunk0.vec.imag[i] ** 2;
    expect(Math.sqrt(m2)).toBeGreaterThan(0.1);

    const beforeMag = Math.sqrt(m2);
    w.removeEntity("e1");
    m2 = 0;
    for (let i = 0; i < chunk0.vec.real.length; i++) m2 += chunk0.vec.real[i] ** 2 + chunk0.vec.imag[i] ** 2;
    expect(Math.sqrt(m2)).toBeLessThan(beforeMag);
  });
});
