import { describe, it, expect } from "vitest";
import { World } from "../src/world/index.js";
import { CommandBus, defaultReducer } from "../src/cmd/index.js";
import { AgentSystem, intentToMoveCommand, interactCommand } from "../src/agent/index.js";
import { identityTransform } from "../src/entity/index.js";

describe("Layer 6: Player/agent substrate", () => {
  it("Register and unregister agents", () => {
    const sys = new AgentSystem();
    sys.register({ id: "player", agency: "human", perceptionRadius: 10 });
    expect(sys.has("player")).toBe(true);
    expect(sys.agency("player")).toBe("human");
    sys.unregister("player");
    expect(sys.has("player")).toBe(false);
  });

  it("Machine agent requires cognition op", () => {
    const sys = new AgentSystem();
    expect(() => sys.register({ id: "npc", agency: "machine", perceptionRadius: 10 })).toThrow();
  });

  it("Perception finds visible entities within radius", () => {
    const w = new World();
    const sys = new AgentSystem();
    sys.register({ id: "p", agency: "human", perceptionRadius: 5 });

    w.addEntity({ id: "p", prototypeId: "player", transform: identityTransform(), components: {} });
    w.addEntity({ id: "near", prototypeId: "tree", transform: { ...identityTransform(), position: { x: 3, y: 0, z: 0 } }, components: {} });
    w.addEntity({ id: "far",  prototypeId: "rock", transform: { ...identityTransform(), position: { x: 50, y: 0, z: 0 } }, components: {} });

    const p = sys.refreshPerception(w, "p", 1);
    expect(p.visibleIds).toContain("near");
    expect(p.visibleIds).not.toContain("far");
    expect(p.visibleIds).not.toContain("p");
  });

  it("Machine agent emits commands via cognition op", () => {
    const w = new World();
    const sys = new AgentSystem();
    let invocations = 0;
    sys.register({
      id: "npc1",
      agency: "machine",
      perceptionRadius: 10,
      cognition: ({ agentId }) => {
        invocations++;
        return [{
          kind: "MoveEntity", id: agentId,
          transform: { position: { x: 1, y: 0, z: 0 } },
        }];
      },
    });
    w.addEntity({ id: "npc1", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    const b = new CommandBus(w, defaultReducer);
    sys.tickMachineAgents(w, b, 1);
    b.flush();
    expect(invocations).toBe(1);
    expect(w.getEntity("npc1")?.transform.position.x).toBe(1);
  });

  it("intentToMoveCommand translates forward into world-axis movement", () => {
    const cmd = intentToMoveCommand(
      "player",
      { forward: 1, right: 0, up: 0 },
      { x: 0, y: 0, z: 0 },
      { yaw: 0 },
      1.0,
    );
    expect(cmd).not.toBeNull();
    if (cmd && cmd.kind === "MoveEntity") {
      // Facing yaw=0 means forward is -Z
      expect(cmd.transform.position!.z).toBeCloseTo(-1, 5);
      expect(cmd.transform.position!.x).toBeCloseTo(0, 5);
    }
  });

  it("intentToMoveCommand returns null for zero intent", () => {
    const cmd = intentToMoveCommand(
      "player",
      { forward: 0, right: 0, up: 0 },
      { x: 0, y: 0, z: 0 },
      { yaw: 0 },
    );
    expect(cmd).toBeNull();
  });

  it("interactCommand produces PickupEntity for pickup verb", () => {
    const cmd = interactCommand("player", "sword", "pickup");
    expect(cmd?.kind).toBe("PickupEntity");
    if (cmd?.kind === "PickupEntity") {
      expect(cmd.targetId).toBe("sword");
      expect(cmd.holderId).toBe("player");
    }
  });
});
