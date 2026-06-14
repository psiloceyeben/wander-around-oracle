import { describe, it, expect } from "vitest";
import { World } from "../src/world/index.js";
import { CommandBus, defaultReducer, type Command, type GameEvent } from "../src/cmd/index.js";
import { identityTransform } from "../src/entity/index.js";

function bus(): { world: World; bus: CommandBus; events: GameEvent[] } {
  const w = new World();
  const b = new CommandBus(w, defaultReducer);
  const events: GameEvent[] = [];
  b.events.on("*", (e) => events.push(e));
  return { world: w, bus: b, events };
}

describe("Layer 4: Command/Event substrate", () => {
  it("SpawnEntity command adds entity and emits EntitySpawned", () => {
    const { world, bus: b, events } = bus();
    b.submit({
      kind: "SpawnEntity",
      id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    });
    b.flush();
    expect(world.getEntity("e1")?.prototypeId).toBe("door");
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("EntitySpawned");
  });

  it("duplicate SpawnEntity is rejected", () => {
    const { bus: b, events } = bus();
    const cmd: Command = {
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    };
    b.submit(cmd);
    b.submit(cmd);
    b.flush();
    expect(events.filter((e) => e.kind === "EntitySpawned")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "CommandRejected")).toHaveLength(1);
  });

  it("MoveEntity emits EntityMoved with from/to transforms", () => {
    const { world, bus: b, events } = bus();
    b.applyImmediate({
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({
      kind: "MoveEntity", id: "e1",
      transform: { position: { x: 10, y: 0, z: 0 } },
    });
    const moveEvent = events.find((e) => e.kind === "EntityMoved");
    expect(moveEvent).toBeDefined();
    expect(world.getEntity("e1")?.transform.position.x).toBe(10);
  });

  it("PickupEntity stamps holder; DropEntity removes it", () => {
    const { world, bus: b } = bus();
    b.applyImmediate({
      kind: "SpawnEntity", id: "player", prototypeId: "player",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({
      kind: "SpawnEntity", id: "sword", prototypeId: "sword",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({ kind: "PickupEntity", targetId: "sword", holderId: "player" });
    expect(world.getEntity("sword")?.components.holder?.heldBy).toBe("player");
    b.applyImmediate({
      kind: "DropEntity", targetId: "sword", holderId: "player",
      dropTransform: { ...identityTransform(), position: { x: 5, y: 0, z: 0 } },
    });
    expect(world.getEntity("sword")?.components.holder).toBeUndefined();
    expect(world.getEntity("sword")?.transform.position.x).toBe(5);
  });

  it("Pickup of immutable entity is rejected", () => {
    const { bus: b, events } = bus();
    b.applyImmediate({
      kind: "SpawnEntity", id: "portal", prototypeId: "doorway",
      transform: identityTransform(),
      components: {
        interactable: { verb: "use", range: 3, immutable: true },
      },
    });
    b.applyImmediate({
      kind: "SpawnEntity", id: "player", prototypeId: "player",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({ kind: "PickupEntity", targetId: "portal", holderId: "player" });
    expect(events.some((e) => e.kind === "CommandRejected")).toBe(true);
  });

  it("Command log records applied commands but not rejected ones", () => {
    const { bus: b } = bus();
    b.applyImmediate({
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    });
    // duplicate → rejected
    b.applyImmediate({
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    });
    expect(b.logCount()).toBe(1);
  });

  it("Reducer is deterministic across two worlds with same command sequence", () => {
    const wa = new World();
    const wb = new World();
    const ba = new CommandBus(wa, defaultReducer);
    const bb = new CommandBus(wb, defaultReducer);
    const cmds: Command[] = [
      { kind: "SpawnEntity", id: "a", prototypeId: "door", transform: identityTransform(), components: {} },
      { kind: "SpawnEntity", id: "b", prototypeId: "tree", transform: identityTransform(), components: {} },
      { kind: "MoveEntity",  id: "a", transform: { position: { x: 5, y: 0, z: 0 } } },
    ];
    for (const c of cmds) { ba.applyImmediate(c); bb.applyImmediate(c); }
    expect(wa.entityCount()).toBe(wb.entityCount());
    expect(wa.getEntity("a")?.transform.position.x).toBe(wb.getEntity("a")?.transform.position.x);
  });

  it("EventBus subscribes by kind", () => {
    const { bus: b } = bus();
    let spawnCount = 0;
    b.events.on("EntitySpawned", () => spawnCount++);
    b.applyImmediate({
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({
      kind: "SpawnEntity", id: "e2", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    expect(spawnCount).toBe(2);
  });
});
