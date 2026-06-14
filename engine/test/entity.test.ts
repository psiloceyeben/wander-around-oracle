import { describe, it, expect } from "vitest";
import {
  EntityRegistry,
  type EntityRecord,
  identityTransform,
  entityToVec,
  registerPrototype,
  knownPrototypes,
  roleVecOf,
} from "../src/entity/index.js";
import { cleanup, cosine, queryRole, kindVec } from "../src/hrr/index.js";

function makeEntity(id: string, prototypeId: string, overrides: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id,
    prototypeId,
    transform: identityTransform(),
    components: {},
    ...overrides,
  };
}

describe("Layer 1: Entity substrate", () => {
  it("EntityRegistry add/get/remove", () => {
    const reg = new EntityRegistry();
    const e = makeEntity("e1", "door");
    reg.add(e);
    expect(reg.has("e1")).toBe(true);
    expect(reg.size()).toBe(1);
    expect(reg.get("e1")!.record.prototypeId).toBe("door");
    reg.remove("e1");
    expect(reg.has("e1")).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it("entityToVec produces a unit vector", () => {
    const e = makeEntity("e1", "door");
    const v = entityToVec(e);
    // magnitude near 1 (composeBindings normalizes)
    let m2 = 0;
    for (let i = 0; i < v.real.length; i++) m2 += v.real[i] ** 2 + v.imag[i] ** 2;
    expect(Math.sqrt(m2)).toBeCloseTo(1.0, 5);
  });

  it("entity vectors cleanup-classify their prototype kind", () => {
    registerPrototype("door");
    registerPrototype("tree");
    registerPrototype("wizard_npc");
    registerPrototype("sword");

    const e = makeEntity("e1", "door");
    const v = entityToVec(e);
    const recovered = queryRole(v, roleVecOf("kind"));
    const result = cleanup(recovered, knownPrototypes());
    expect(result.label).toBe("door");
  });

  it("different prototype entities are distinguishable by kind query", () => {
    registerPrototype("door");
    registerPrototype("tree");
    const e1 = entityToVec(makeEntity("a", "door"));
    const e2 = entityToVec(makeEntity("b", "tree"));
    // The two whole-entity vectors share position+components bindings so
    // they're not orthogonal, but their kind bindings differ. The cosine
    // is therefore non-zero but the kind query disambiguates them cleanly.
    expect(cosine(e1, e2)).toBeLessThan(0.75);
    // Kind queries on each should return the right prototype
    expect(cleanup(queryRole(e1, roleVecOf("kind")), knownPrototypes()).label).toBe("door");
    expect(cleanup(queryRole(e2, roleVecOf("kind")), knownPrototypes()).label).toBe("tree");
  });

  it("update re-encodes the HRR vector", () => {
    const reg = new EntityRegistry();
    reg.add(makeEntity("e1", "door"));
    const v1 = reg.get("e1")!.vec;
    reg.update("e1", (r) => { r.transform.position.x = 10; });
    const v2 = reg.get("e1")!.vec;
    // Position changed → encoded position bucket changed → entity vector differs
    expect(cosine(v1, v2)).toBeLessThan(0.99);
  });

  it("components encode and decode via role:components query", () => {
    registerPrototype("wizard_npc");
    const e = makeEntity("npc1", "wizard_npc", {
      components: {
        ai: { policy: "wander", perceptionRadius: 8, state: {} },
        renderable: { meshTag: "wizard_robe" },
      },
    });
    const v = entityToVec(e);
    // The components vector should be retrievable
    const compRecovered = queryRole(v, roleVecOf("components"));
    // It's a superposition of role:value bindings; we expect non-trivial magnitude
    let m2 = 0;
    for (let i = 0; i < compRecovered.real.length; i++) m2 += compRecovered.real[i] ** 2 + compRecovered.imag[i] ** 2;
    expect(Math.sqrt(m2)).toBeGreaterThan(0.1);
  });
});
