import { describe, it, expect } from "vitest";
import { setupDemo, runDemo } from "../src/demo/index.js";

describe("End-to-end demo (all 10 layers)", () => {
  it("setupDemo populates the world with player, items, NPC", () => {
    const state = setupDemo();
    expect(state.world.getEntity("player")?.prototypeId).toBe("player");
    expect(state.agents.has("player")).toBe(true);
    // Wizard NPC should be a registered machine agent
    expect(state.agents.machineCount()).toBe(1);
    // At least 5 spawned entities
    expect(state.world.entityCount()).toBeGreaterThanOrEqual(5);
  });

  it("runDemo advances simulation and player ends up moved", () => {
    const state = setupDemo();
    const startX = state.world.getEntity("player")!.transform.position.x;
    runDemo(state, 60);
    const endX = state.world.getEntity("player")!.transform.position.x;
    // World tick should have advanced
    expect(state.world.tick).toBe(60);
    // Player should have moved
    expect(Math.abs(endX - startX)).toBeGreaterThan(0);
  });

  it("Wizard NPC moves under Oracle-driven wander policy", () => {
    const state = setupDemo();
    const wizardEntity = Array.from(state.world.allEntities()).find((e) => e.prototypeId === "wizard_npc")!;
    const startPos = { ...wizardEntity.transform.position };
    runDemo(state, 60);
    const endPos = state.world.getEntity(wizardEntity.id)!.transform.position;
    expect(Math.abs(endPos.x - startPos.x) + Math.abs(endPos.z - startPos.z)).toBeGreaterThan(0);
  });

  it("ASCII projection produces a recognizable grid after sim", () => {
    const state = setupDemo();
    const grid = runDemo(state, 30);
    expect(grid).toContain("@");  // player glyph
    // Grid is non-empty and multi-line
    expect(grid.split("\n").length).toBeGreaterThan(5);
  });

  it("Axiom layer is active (sanctuary prevents destruction near 10,0,10)", () => {
    const state = setupDemo();
    state.bus.applyImmediate({
      kind: "SpawnEntity", id: "victim", prototypeId: "tree",
      transform: { position: { x: 10, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
      components: {},
    });
    expect(state.world.getEntity("victim")).toBeDefined();
    // Try to destroy inside sanctuary — should be rejected
    const events = state.bus.applyImmediate({ kind: "RemoveEntity", id: "victim" });
    expect(events[0].kind).toBe("CommandRejected");
    expect(state.world.getEntity("victim")).toBeDefined();
  });

  it("Determinism: two identical demos produce the same final state", () => {
    const s1 = setupDemo();
    const s2 = setupDemo();
    runDemo(s1, 60);
    runDemo(s2, 60);
    // Both worlds reach same tick
    expect(s1.world.tick).toBe(s2.world.tick);
    // Player position is identical
    const p1 = s1.world.getEntity("player")!.transform.position;
    const p2 = s2.world.getEntity("player")!.transform.position;
    expect(p1.x).toBeCloseTo(p2.x, 6);
    expect(p1.z).toBeCloseTo(p2.z, 6);
  });
});
