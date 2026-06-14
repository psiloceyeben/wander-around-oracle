import { describe, it, expect } from "vitest";
import {
  HRR_DIM,
  bind, unbind, involution,
  cosine, magnitude, normalize,
  superpose, composeBindings, queryRole,
  cleanup,
  seedVec, idVec, roleVec, kindVec,
} from "../src/hrr/index.js";

describe("Layer 0: HRR substrate", () => {
  it("seed vectors are unit magnitude", () => {
    const v = seedVec("door");
    expect(magnitude(v)).toBeCloseTo(1.0, 6);
  });

  it("seed vectors are deterministic across calls", () => {
    const a = seedVec("door");
    const b = seedVec("door");
    expect(cosine(a, b)).toBeCloseTo(1.0, 6);
  });

  it("different seeds produce approximately orthogonal vectors", () => {
    const a = seedVec("door");
    const b = seedVec("tree");
    // Random unit vectors in 1024-d complex should have small cosine
    expect(Math.abs(cosine(a, b))).toBeLessThan(0.15);
  });

  it("seedVec dimensionality", () => {
    const v = seedVec("test");
    expect(v.real.length).toBe(HRR_DIM);
    expect(v.imag.length).toBe(HRR_DIM);
  });

  it("involution is self-inverse: involution(involution(a)) == a", () => {
    const a = seedVec("hello");
    const aa = involution(involution(a));
    expect(cosine(a, aa)).toBeCloseTo(1.0, 6);
  });

  it("bind is associative on inverses: bind(a, b) then unbind(_, a) ≈ b", () => {
    const a = roleVec("kind");
    const b = kindVec("door");
    const bound = bind(a, b);
    const recovered = unbind(bound, a);
    // Recovered b should be highly correlated with original b
    expect(cosine(recovered, b)).toBeGreaterThan(0.9);
  });

  it("superposition retrieval: three bindings, query each role", () => {
    const role_kind   = roleVec("kind");
    const role_owner  = roleVec("owner");
    const role_state  = roleVec("state");

    const val_door  = kindVec("door");
    const val_alice = idVec("alice");
    const val_open  = seedVec("state:open");

    const entity = composeBindings([
      [role_kind,  val_door],
      [role_owner, val_alice],
      [role_state, val_open],
    ]);

    // Query each role and verify the recovered vector cleans up to the right value
    const dict = [
      { label: "door",  vec: val_door  },
      { label: "alice", vec: val_alice },
      { label: "open",  vec: val_open  },
      { label: "tree",  vec: kindVec("tree") },
      { label: "bob",   vec: idVec("bob") },
      { label: "closed",vec: seedVec("state:closed") },
    ];

    const recoveredKind  = queryRole(entity, role_kind);
    const recoveredOwner = queryRole(entity, role_owner);
    const recoveredState = queryRole(entity, role_state);

    expect(cleanup(recoveredKind,  dict).label).toBe("door");
    expect(cleanup(recoveredOwner, dict).label).toBe("alice");
    expect(cleanup(recoveredState, dict).label).toBe("open");
  });

  it("superposition retrieval scales: 6 bindings", () => {
    const roles = ["kind", "owner", "state", "color", "size", "tier"].map(roleVec);
    const valLabels = ["door", "alice", "open", "red", "large", "epic"];
    const vals = valLabels.map(seedVec);

    const entity = composeBindings(roles.map((r, i) => [r, vals[i]] as [any, any]));

    const dict = valLabels.map((lab, i) => ({ label: lab, vec: vals[i] }));

    for (let i = 0; i < roles.length; i++) {
      const recovered = queryRole(entity, roles[i]);
      const winner = cleanup(recovered, dict);
      expect(winner.label).toBe(valLabels[i]);
    }
  });

  it("normalize produces unit magnitude", () => {
    const a = seedVec("a");
    const b = seedVec("b");
    const sum = superpose([a, b], false);
    expect(magnitude(sum)).not.toBeCloseTo(1.0, 1); // unlikely to be 1 before normalize
    normalize(sum);
    expect(magnitude(sum)).toBeCloseTo(1.0, 6);
  });

  it("cosine of vector with itself is 1", () => {
    const a = seedVec("x");
    expect(cosine(a, a)).toBeCloseTo(1.0, 6);
  });
});
