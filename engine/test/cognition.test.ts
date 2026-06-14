import { describe, it, expect } from "vitest";
import { StubOracle, composePerception, oracleCognitionOp } from "../src/cognition/index.js";
import { World } from "../src/world/index.js";
import { CommandBus, defaultReducer } from "../src/cmd/index.js";
import { AgentSystem } from "../src/agent/index.js";
import { identityTransform } from "../src/entity/index.js";
import { SEPHIROTH } from "../src/hrr/index.js";

describe("Layer 7: Cognition substrate", () => {
  it("StubOracle returns a valid response with routed Sephirah", async () => {
    const oracle = new StubOracle();
    const perceptionVec = composePerception(new World(), "p", []); // empty
    const result = await oracle.query({ perception: perceptionVec, prompt: "test" });
    expect(SEPHIROTH).toContain(result.routedSephirah);
    expect(result.responseVec.real.length).toBe(1024);
  });

  it("composePerception with visible entities returns non-zero vector", () => {
    const w = new World();
    w.addEntity({ id: "a", prototypeId: "tree", transform: identityTransform(), components: {} });
    w.addEntity({ id: "b", prototypeId: "rock", transform: identityTransform(), components: {} });
    const v = composePerception(w, "p", ["a", "b"]);
    let m2 = 0;
    for (let i = 0; i < v.real.length; i++) m2 += v.real[i] ** 2 + v.imag[i] ** 2;
    expect(Math.sqrt(m2)).toBeGreaterThan(0.5);
  });

  it("oracleCognitionOp wander policy produces movement commands", async () => {
    const w = new World();
    const sys = new AgentSystem();
    const oracle = new StubOracle();
    sys.register({
      id: "npc",
      agency: "machine",
      perceptionRadius: 5,
      cognition: oracleCognitionOp(oracle, { policy: "wander" }),
    });
    w.addEntity({ id: "npc", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    w.addEntity({ id: "tree", prototypeId: "tree", transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } }, components: {} });
    const bus = new CommandBus(w, defaultReducer);
    sys.tickMachineAgents(w, bus, 1);
    bus.flush();
    // The NPC should have moved a small distance from origin
    const npc = w.getEntity("npc");
    const dx = npc!.transform.position.x;
    const dz = npc!.transform.position.z;
    expect(Math.abs(dx) + Math.abs(dz)).toBeGreaterThan(0);
    expect(Math.abs(dx) + Math.abs(dz)).toBeLessThan(0.4);  // wander step bounded
  });

  it("oracleCognitionOp idle policy emits no commands", () => {
    const w = new World();
    const sys = new AgentSystem();
    const oracle = new StubOracle();
    sys.register({
      id: "npc",
      agency: "machine",
      perceptionRadius: 5,
      cognition: oracleCognitionOp(oracle, { policy: "idle" }),
    });
    w.addEntity({ id: "npc", prototypeId: "wizard_npc", transform: identityTransform(), components: {} });
    const bus = new CommandBus(w, defaultReducer);
    sys.tickMachineAgents(w, bus, 1);
    bus.flush();
    expect(bus.logCount()).toBe(0);
  });
});
