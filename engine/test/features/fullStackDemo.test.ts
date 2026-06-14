import { describe, it, expect } from "vitest";
import { setupFullStackDemo } from "../../src/demo/fullStack.js";

describe("Multi-feature demo (all 14 features + all 10 layers)", () => {
  it("sets up successfully with player + NPC + portals", () => {
    const d = setupFullStackDemo();
    expect(d.world.getEntity("player")).toBeDefined();
    expect(d.agents.machineCount()).toBe(1);  // the wizard
    // At least 6 entities: player + sword + wizard + door + 2 portals
    expect(d.world.entityCount()).toBeGreaterThanOrEqual(6);
  });

  it("runs simulation ticks and renders ASCII", () => {
    const d = setupFullStackDemo();
    const out = d.run(30);
    expect(out).toContain("@");  // player glyph
    expect(d.world.tick).toBe(30);
  });

  it("quests progress as engine events fire", () => {
    const d = setupFullStackDemo();
    d.run(30);
    const p = d.quests.progress();
    expect(p.completed).toBeGreaterThan(0);  // q-first-build at minimum
  });

  it("slash dispatcher emits commands from /spawn", async () => {
    const d = setupFullStackDemo();
    const beforeCount = d.world.entityCount();
    await d.slash.dispatch("/spawn an ancient tree");
    d.bus.flush();
    expect(d.world.entityCount()).toBeGreaterThan(beforeCount);
  });

  it("style swap via /style works", async () => {
    const d = setupFullStackDemo();
    expect(d.styleMgr.current()).toBe("ascii");
    await d.slash.dispatch("/style paper-mario");
    expect(d.styleMgr.current()).toBe("paper-mario");
  });

  it("axiom sanctuary blocks destruction near (30,0,30)", () => {
    const d = setupFullStackDemo();
    d.bus.applyImmediate({
      kind: "SpawnEntity", id: "victim", prototypeId: "tree",
      transform: { position: { x: 30, y: 0, z: 30 }, rotation: { x:0,y:0,z:0,w:1 }, scale: { x:1,y:1,z:1 } },
      components: {},
    });
    const events = d.bus.applyImmediate({ kind: "RemoveEntity", id: "victim" });
    expect(events[0].kind).toBe("CommandRejected");
  });

  it("biome streaming loads chunks around player", () => {
    const d = setupFullStackDemo();
    d.run(60);  // tick biome-streaming at every 30 → 2 firings
    expect(d.biome.loadedCount()).toBeGreaterThan(0);
  });

  it("portal proximity submits EnterPortal when player walks close", () => {
    const d = setupFullStackDemo();
    // Move player to position 8 (near the second portal)
    d.bus.applyImmediate({
      kind: "MoveEntity", id: "player",
      transform: { position: { x: 8, y: 0, z: 0 } },
    });
    let portalEntered = false;
    d.bus.events.on("PortalEntered", () => { portalEntered = true; });
    d.run(5);  // a few ticks of proximity checking
    expect(portalEntered).toBe(true);
  });

  it("tutorial spawned companion", () => {
    const d = setupFullStackDemo();
    expect(d.world.getEntity("tutorial-companion")).toBeDefined();
  });
});
