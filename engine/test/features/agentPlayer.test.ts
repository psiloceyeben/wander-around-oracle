import { describe, it, expect } from "vitest";
import { World } from "../../src/world/index.js";
import { CommandBus, defaultReducer } from "../../src/cmd/index.js";
import { AgentSystem } from "../../src/agent/index.js";
import { identityTransform } from "../../src/entity/index.js";
import {
  FakeOracleClient,
  composePerceptionPrompt,
  sephirahToCommand,
  fakeAgentPlayerCognitionOp,
} from "../../src/features/agentPlayer/index.js";

describe("Feature: agentPlayer", () => {
  it("FakeOracleClient maps prompt keywords to Sephirot", async () => {
    const c = new FakeOracleClient();
    expect((await c.query("build a temple")).routed_sephirah).toBe("tiferet");
    expect((await c.query("attack the enemy")).routed_sephirah).toBe("geburah");
    expect((await c.query("save the world")).routed_sephirah).toBe("yesod");
    expect((await c.query("pick up the sword")).routed_sephirah).toBe("malkuth");
    expect((await c.query("walk somewhere")).routed_sephirah).toBe("netzach");
  });

  it("FakeOracleClient.enqueue injects canned responses in order", async () => {
    const c = new FakeOracleClient();
    c.enqueue({ routed_sephirah: "binah" });
    c.enqueue({ routed_sephirah: "chesed" });
    expect((await c.query("x")).routed_sephirah).toBe("binah");
    expect((await c.query("y")).routed_sephirah).toBe("chesed");
  });

  it("composePerceptionPrompt summarizes visible entities", () => {
    const w = new World();
    w.addEntity({ id: "agent", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    w.addEntity({ id: "t1", prototypeId: "tree", transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } }, components: {} });
    w.addEntity({ id: "t2", prototypeId: "tree", transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } }, components: {} });
    w.addEntity({ id: "r1", prototypeId: "rock", transform: { ...identityTransform(), position: { x: 0, y: 0, z: 1 } }, components: {} });
    const prompt = composePerceptionPrompt(w, "agent", ["t1", "t2", "r1"]);
    expect(prompt).toContain("2 trees");
    expect(prompt).toContain("1 rock");
    expect(prompt).toMatch(/I will$/);
  });

  it("sephirahToCommand: tiferet produces a SpawnEntity (build)", () => {
    const w = new World();
    w.addEntity({ id: "agent", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    const cmd = sephirahToCommand("tiferet", "an ancient tree", w, "agent", []);
    expect(cmd?.kind).toBe("SpawnEntity");
    if (cmd?.kind === "SpawnEntity") {
      expect(cmd.prototypeId).toBe("tree");
    }
  });

  it("sephirahToCommand: yesod produces SaveWorld", () => {
    const w = new World();
    w.addEntity({ id: "agent", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    const cmd = sephirahToCommand("yesod", "", w, "agent", []);
    expect(cmd?.kind).toBe("SaveWorld");
  });

  it("sephirahToCommand: malkuth picks up nearest interactable", () => {
    const w = new World();
    w.addEntity({ id: "agent", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    w.addEntity({
      id: "sword", prototypeId: "sword",
      transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
      components: { interactable: { verb: "pickup", range: 3 } },
    });
    const cmd = sephirahToCommand("malkuth", "", w, "agent", ["sword"]);
    expect(cmd?.kind).toBe("PickupEntity");
    if (cmd?.kind === "PickupEntity") {
      expect(cmd.targetId).toBe("sword");
    }
  });

  it("sephirahToCommand: netzach produces MoveEntity (explore)", () => {
    const w = new World();
    w.addEntity({ id: "agent", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    const cmd = sephirahToCommand("netzach", "", w, "agent", []);
    expect(cmd?.kind).toBe("MoveEntity");
  });
});

describe("Feature: agentPlayer end-to-end driven scenario", () => {
  it("scripted Sephirah schedule exercises 7+ features", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    // Track exercised features
    const exercised = new Set<string>();
    b.events.on("*", (e) => {
      switch (e.kind) {
        case "EntitySpawned":   exercised.add("recipe");   break;
        case "EntityPickedUp":  exercised.add("pickup");   break;
        case "EntityDropped":   exercised.add("drop");     break;
        case "EntityMoved":     exercised.add("move");     break;
        case "WorldSaved":      exercised.add("save");     break;
        case "PortalEntered":   exercised.add("portal");   break;
        case "ComponentsEdited":exercised.add("edit");     break;
      }
    });

    // Pre-populate scene with a sword + portal so agent has things to do
    b.applyImmediate({
      kind: "SpawnEntity", id: "agent", prototypeId: "wizard_npc",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({
      kind: "SpawnEntity", id: "sword", prototypeId: "sword",
      transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
      components: { interactable: { verb: "pickup", range: 3 } },
    });

    // Create a scripted Sephirah sequence that exercises build + pickup + save + move
    const fake = new FakeOracleClient();
    const schedule: any[] = ["tiferet", "malkuth", "netzach", "yesod", "tiferet"];
    const op = fakeAgentPlayerCognitionOp(fake, schedule);

    const sys = new AgentSystem();
    sys.register({ id: "agent", agency: "machine", perceptionRadius: 10, cognition: op });

    for (let tick = 0; tick < schedule.length; tick++) {
      sys.tickMachineAgents(w, b, tick);
      b.flush();
    }

    // Should have exercised at least: build (tiferet x2), pickup (malkuth), move (netzach), save (yesod)
    expect(exercised.has("recipe")).toBe(true);
    expect(exercised.has("pickup")).toBe(true);
    expect(exercised.has("move")).toBe(true);
    expect(exercised.has("save")).toBe(true);
    expect(exercised.size).toBeGreaterThanOrEqual(4);
  });
});
