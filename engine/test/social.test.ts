import { describe, it, expect } from "vitest";
import { World } from "../src/world/index.js";
import { CommandBus, defaultReducer } from "../src/cmd/index.js";
import { InProcessRoomTransport, RoomClient } from "../src/social/index.js";
import { identityTransform } from "../src/entity/index.js";

describe("Layer 9: Social/network substrate", () => {
  it("Two clients sharing a room converge to the same world state", async () => {
    const transport = new InProcessRoomTransport();

    const wa = new World();
    const wb = new World();
    const ba = new CommandBus(wa, defaultReducer);
    const bb = new CommandBus(wb, defaultReducer);

    const ca = new RoomClient(transport, ba, { id: "alice", displayName: "Alice" });
    const cb = new RoomClient(transport, bb, { id: "bob",   displayName: "Bob"   });

    await ca.connect();
    await cb.connect();

    await ca.submit({
      kind: "SpawnEntity", id: "tower1", prototypeId: "tower",
      transform: identityTransform(), components: {},
    });

    expect(wa.getEntity("tower1")?.prototypeId).toBe("tower");
    expect(wb.getEntity("tower1")?.prototypeId).toBe("tower");
  });

  it("Late joiner catches up via backlog", async () => {
    const transport = new InProcessRoomTransport();

    const wa = new World();
    const ba = new CommandBus(wa, defaultReducer);
    const ca = new RoomClient(transport, ba, { id: "alice", displayName: "Alice" });
    await ca.connect();

    await ca.submit({
      kind: "SpawnEntity", id: "x", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    await ca.submit({
      kind: "SpawnEntity", id: "y", prototypeId: "rock",
      transform: identityTransform(), components: {},
    });

    // Late joiner
    const wb = new World();
    const bb = new CommandBus(wb, defaultReducer);
    const cb = new RoomClient(transport, bb, { id: "bob", displayName: "Bob" });
    await cb.connect();

    expect(wb.getEntity("x")?.prototypeId).toBe("tree");
    expect(wb.getEntity("y")?.prototypeId).toBe("rock");
    expect(wb.entityCount()).toBe(2);
  });

  it("Commands from one client cause events on another", async () => {
    const transport = new InProcessRoomTransport();
    const wa = new World();
    const wb = new World();
    const ba = new CommandBus(wa, defaultReducer);
    const bb = new CommandBus(wb, defaultReducer);
    const ca = new RoomClient(transport, ba, { id: "alice", displayName: "Alice" });
    const cb = new RoomClient(transport, bb, { id: "bob",   displayName: "Bob"   });
    await ca.connect();
    await cb.connect();

    let bobSawSpawn = 0;
    bb.events.on("EntitySpawned", () => bobSawSpawn++);

    await ca.submit({
      kind: "SpawnEntity", id: "house1", prototypeId: "house",
      transform: identityTransform(), components: {},
    });

    expect(bobSawSpawn).toBe(1);
  });
});
