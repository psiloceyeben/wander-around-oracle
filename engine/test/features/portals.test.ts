import { describe, it, expect } from "vitest";
import { World } from "../../src/world/index.js";
import { CommandBus, defaultReducer } from "../../src/cmd/index.js";
import { spawnPortalCommand, PortalProximitySystem, findNearestPortal, PORTAL_ENTER_RADIUS } from "../../src/features/portals/index.js";
import { identityTransform } from "../../src/entity/index.js";

describe("Feature: portals", () => {
  it("spawnPortalCommand creates a doorway entity with immutable=true", () => {
    const cmd = spawnPortalCommand(
      { label: "Library", destination: { kind: "external", url: "https://example.com" } },
      { x: 5, y: 0, z: 5 },
    );
    expect(cmd.kind).toBe("SpawnEntity");
    expect(cmd.prototypeId).toBe("doorway");
    expect(cmd.components.interactable?.immutable).toBe(true);
  });

  it("ProximitySystem fires EnterPortal when player walks within radius", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const proximityNow = { t: 0 };
    const sys = new PortalProximitySystem({ now: () => proximityNow.t });
    // Spawn player + portal
    b.applyImmediate({
      kind: "SpawnEntity", id: "player", prototypeId: "player",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate(spawnPortalCommand(
      { label: "X", destination: { kind: "substrate", worldId: "sub-1" } },
      { x: 0, y: 0, z: 0 },
    ));
    proximityNow.t = 1000;
    const submitted = sys.tick(w, "player", b);
    expect(submitted).toBe(1);
    b.flush();
    // Look for the EnterPortal event
    let entered = 0;
    b.events.on("PortalEntered", () => entered++);
    // No new event because we already flushed; verify by submitting another tick after cooldown
    proximityNow.t = 5000;  // beyond cooldown
    sys.tick(w, "player", b);
    b.flush();
    expect(entered).toBe(1);
  });

  it("ProximitySystem respects cooldown", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const ntime = { t: 0 };
    const sys = new PortalProximitySystem({ now: () => ntime.t });
    b.applyImmediate({
      kind: "SpawnEntity", id: "player", prototypeId: "player",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate(spawnPortalCommand(
      { label: "X", destination: { kind: "substrate", worldId: "x" } },
      { x: 0, y: 0, z: 0 },
    ));
    ntime.t = 100;
    expect(sys.tick(w, "player", b)).toBe(1);
    ntime.t = 200;  // < cooldown
    expect(sys.tick(w, "player", b)).toBe(0);
    ntime.t = 2000;  // > cooldown
    expect(sys.tick(w, "player", b)).toBe(1);
  });

  it("findNearestPortal returns the closest doorway", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    b.applyImmediate(spawnPortalCommand({ label: "A", destination: { kind: "substrate", worldId: "a" } }, { x: 3, y: 0, z: 0 }));
    b.applyImmediate(spawnPortalCommand({ label: "B", destination: { kind: "substrate", worldId: "b" } }, { x: 1, y: 0, z: 0 }));
    const near = findNearestPortal(w, { x: 0, y: 0, z: 0 });
    expect(near?.transform.position.x).toBe(1);
  });

  it("PORTAL_ENTER_RADIUS is 2.2 (walk-through, not press-E)", () => {
    expect(PORTAL_ENTER_RADIUS).toBe(2.2);
  });
});
