// Demo world — a tiny end-to-end exercise of the engine.
//
// Spawns a player at origin, places a few entities around (tree, rock, sword),
// adds a wandering wizard NPC, registers a sanctuary axiom around (10, 0, 10),
// runs the simulation for 30 ticks (0.5s game time), and renders ASCII to a
// string. Used in tests to verify all 10 layers compose correctly.

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { Scheduler } from "../time/index.js";
import { AgentSystem, intentToMoveCommand } from "../agent/index.js";
import { promptToCommand } from "../language/index.js";
import { StubOracle, oracleCognitionOp } from "../cognition/index.js";
import { AsciiProjection } from "../projection/index.js";
import { AxiomRegistry, axiomGuarded, axiomIdLength, axiomSanctuary, axiomEntityCap } from "../axiom/index.js";
import { identityTransform } from "../entity/index.js";

export interface DemoState {
  world: World;
  bus: CommandBus;
  scheduler: Scheduler;
  agents: AgentSystem;
  proj: AsciiProjection;
  oracle: StubOracle;
}

export function setupDemo(): DemoState {
  const world = new World(/* seed */ 42);

  // Axioms: platform id-length + 1000-entity cap + sanctuary
  const axioms = new AxiomRegistry();
  axioms.add(axiomIdLength);
  axioms.add(axiomEntityCap(1000));
  axioms.add(axiomSanctuary({ x: 10, y: 0, z: 10 }, 5));

  const bus = new CommandBus(world, axiomGuarded(defaultReducer, axioms));
  const scheduler = new Scheduler(world);
  const agents = new AgentSystem();
  const proj = new AsciiProjection({ width: 30, height: 12 });
  proj.init(world);
  const oracle = new StubOracle();

  // Forward events to the projection
  bus.events.on("*", (e) => proj.onEvent(e));

  // Spawn the player
  bus.applyImmediate({
    kind: "SpawnEntity", id: "player", prototypeId: "player",
    transform: identityTransform(),
    components: {
      collider: { shape: "capsule", size: { x: 0.5, y: 1.8, z: 0.5 }, solid: true },
    },
  });
  agents.register({ id: "player", agency: "human", perceptionRadius: 12 });

  // Spawn a few entities via the language layer (prompt → command)
  for (const { prompt, position } of [
    { prompt: "an iron sword",       position: { x: 2, y: 0, z: 0 } },
    { prompt: "a wooden door",       position: { x: -2, y: 0, z: 1 } },
    { prompt: "an ancient tree",     position: { x: 0, y: 0, z: 3 } },
    { prompt: "a rock",              position: { x: -3, y: 0, z: -2 } },
    { prompt: "a wandering wizard",  position: { x: 5, y: 0, z: 5 } },
  ]) {
    const cmd = promptToCommand(prompt, position);
    if (cmd) bus.applyImmediate(cmd);
  }

  // Register the wizard NPC as a machine agent with Oracle cognition.
  // The most recently spawned wizard_npc will have an id ending in a
  // sequence number; we look it up by prototype.
  const wizard = Array.from(world.allEntities()).find((e) => e.prototypeId === "wizard_npc");
  if (wizard) {
    agents.register({
      id: wizard.id,
      agency: "machine",
      perceptionRadius: 10,
      cognition: oracleCognitionOp(oracle, { policy: "wander" }),
    });
  }

  // Tick the NPC every 6 base ticks (10 Hz) — the multi-rate substrate metabolism pattern
  scheduler.register({
    name: "npc-cognition",
    every: 6,
    system: (ctx) => {
      agents.tickMachineAgents(ctx.world, bus, ctx.tick);
      bus.flush();
    },
  });

  // Tick the projection focus to follow the player every base tick
  scheduler.register({
    name: "proj-focus",
    every: 1,
    system: () => {
      const p = world.getEntity("player");
      if (p) proj.setFocus(p.transform.position);
    },
  });

  return { world, bus, scheduler, agents, proj, oracle };
}

/** Run the demo for `ticks` simulation steps. Player walks a small path. */
export function runDemo(state: DemoState, ticks: number = 30): string {
  const playerWalk = [
    { forward: 1, right: 0, up: 0 },
    { forward: 1, right: 1, up: 0 },
    { forward: 0, right: 1, up: 0 },
    { forward: -1, right: 0, up: 0 },
  ];
  let walkIdx = 0;

  for (let t = 0; t < ticks; t++) {
    // Submit a player move every 5 ticks
    if (t % 5 === 0) {
      const p = state.world.getEntity("player");
      if (p) {
        const intent = playerWalk[walkIdx % playerWalk.length];
        walkIdx++;
        const cmd = intentToMoveCommand("player", intent, p.transform.position, { yaw: 0 }, 1);
        if (cmd) state.bus.submit(cmd);
      }
    }
    state.bus.flush();
    state.scheduler.step();
  }
  return state.proj.renderToString();
}
