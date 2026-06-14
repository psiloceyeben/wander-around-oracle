import { describe, it, expect } from "vitest";
import { World } from "../src/world/index.js";
import { CommandBus, defaultReducer } from "../src/cmd/index.js";
import {
  AxiomRegistry, axiomGuarded,
  axiomIdLength, axiomEntityCap, axiomSanctuary,
} from "../src/axiom/index.js";
import { identityTransform } from "../src/entity/index.js";

describe("Layer 10: Constraint/axiom substrate", () => {
  it("AxiomRegistry approves a command when no axioms reject", () => {
    const reg = new AxiomRegistry();
    const d = reg.check({
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    }, new World());
    expect(d.approved).toBe(true);
  });

  it("axiomIdLength rejects entity ids over 256 chars", () => {
    const reg = new AxiomRegistry();
    reg.add(axiomIdLength);
    const longId = "x".repeat(300);
    const d = reg.check({
      kind: "SpawnEntity", id: longId, prototypeId: "door",
      transform: identityTransform(), components: {},
    }, new World());
    expect(d.approved).toBe(false);
    expect(d.reason).toMatch(/256 chars/);
  });

  it("axiomEntityCap rejects spawns past the limit", () => {
    const w = new World();
    const reg = new AxiomRegistry();
    reg.add(axiomEntityCap(2));

    // Two spawns OK
    expect(reg.check({ kind: "SpawnEntity", id: "a", prototypeId: "x", transform: identityTransform(), components: {} }, w).approved).toBe(true);
    w.addEntity({ id: "a", prototypeId: "x", transform: identityTransform(), components: {} });

    expect(reg.check({ kind: "SpawnEntity", id: "b", prototypeId: "x", transform: identityTransform(), components: {} }, w).approved).toBe(true);
    w.addEntity({ id: "b", prototypeId: "x", transform: identityTransform(), components: {} });

    // Third spawn rejected
    const d = reg.check({ kind: "SpawnEntity", id: "c", prototypeId: "x", transform: identityTransform(), components: {} }, w);
    expect(d.approved).toBe(false);
  });

  it("axiomSanctuary blocks RemoveEntity inside a region", () => {
    const w = new World();
    const reg = new AxiomRegistry();
    reg.add(axiomSanctuary({ x: 0, y: 0, z: 0 }, 10));

    // Entity inside the sanctuary
    w.addEntity({ id: "inside", prototypeId: "tree", transform: identityTransform(), components: {} });
    // Entity outside the sanctuary
    w.addEntity({ id: "outside", prototypeId: "tree", transform: { ...identityTransform(), position: { x: 100, y: 0, z: 0 } }, components: {} });

    expect(reg.check({ kind: "RemoveEntity", id: "inside" }, w).approved).toBe(false);
    expect(reg.check({ kind: "RemoveEntity", id: "outside" }, w).approved).toBe(true);
  });

  it("axiomGuarded reducer rejects commands via CommandRejected event", () => {
    const w = new World();
    const reg = new AxiomRegistry();
    reg.add(axiomEntityCap(1));
    const bus = new CommandBus(w, axiomGuarded(defaultReducer, reg));

    bus.applyImmediate({
      kind: "SpawnEntity", id: "a", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    expect(w.entityCount()).toBe(1);

    const events = bus.applyImmediate({
      kind: "SpawnEntity", id: "b", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    expect(events[0].kind).toBe("CommandRejected");
    expect(w.entityCount()).toBe(1);
  });
});
