// Multi-feature demo — every layer + every v7.2 feature composed.
//
// Spawns a player, biome chunks load around them, NPCs wander with adaptive
// policy, quests track progress, slash commands work, a tutorial fires on
// first launch, axioms enforce a sanctuary region, render-style is the
// ASCII projection (so it runs headless). End-to-end exercise of:
//
//   L0 HRR substrate
//   L1 Entity
//   L2 World (chunked, biome-loaded)
//   L3 Time (multi-rate scheduler)
//   L4 Commands/Events (full reducer + typed event bus)
//   L5 Projection (ASCII + style manager)
//   L6 Agent (player + machine agents)
//   L7 Cognition (StubOracle + adaptive policy)
//   L8 Language (prompt → command via recipes)
//   L9 Social (in-process room — optional)
//   L10 Axiom (sanctuary)
//   + Recipes, Portals, Quests, Slash, Save, Tutorial, Help, Workshop,
//     FPSGuardrail, RenderStyles, BiomeWorldgen, NpcBehavior, Voice, AmbientPolish

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { Scheduler } from "../time/index.js";
import { AgentSystem, InputRegistry } from "../agent/index.js";
import { identityTransform } from "../entity/index.js";
import {
  AxiomRegistry, axiomGuarded, axiomIdLength, axiomEntityCap, axiomSanctuary,
} from "../axiom/index.js";
import { AsciiProjection } from "../projection/index.js";

import { promptToSpawnCommand } from "../features/recipes/index.js";
import { spawnPortalCommand, PortalProximitySystem } from "../features/portals/index.js";
import { QuestSystem, LAUNCH_QUESTS } from "../features/quests/index.js";
import { SlashDispatcher, defaultSlashCommands } from "../features/slashCommands/index.js";
import { exportSnapshot, restoreSnapshot } from "../features/saveBackup/index.js";
import { FirstLaunchTutorial } from "../features/firstLaunchTutorial/index.js";
import { renderHelpText } from "../features/helpOverlay/index.js";
import { WorkshopSession, InMemoryCreationLibrary } from "../features/workshop/index.js";
import { FPSGuardrail } from "../features/fpsGuardrail/index.js";
import { SimpleStyleRegistry, RenderStyleManager } from "../features/renderStyles/index.js";
import { BiomeStreamingSystem } from "../features/biomeWorldgen/index.js";
import { wanderPolicy, adaptivePolicy } from "../features/npcBehavior/index.js";
import { AmbientPolish } from "../features/ambientPolish/index.js";

export interface FullStackDemo {
  world: World;
  bus: CommandBus;
  scheduler: Scheduler;
  agents: AgentSystem;
  inputs: InputRegistry;
  axioms: AxiomRegistry;
  quests: QuestSystem;
  slash: SlashDispatcher;
  proj: AsciiProjection;
  styleMgr: RenderStyleManager;
  portals: PortalProximitySystem;
  biome: BiomeStreamingSystem;
  ambient: AmbientPolish;
  tutorial: FirstLaunchTutorial;
  creations: InMemoryCreationLibrary;
  fpsGuardrail: FPSGuardrail;
  /** Run N simulation ticks, returns ASCII render at end. */
  run(ticks: number): string;
}

export function setupFullStackDemo(): FullStackDemo {
  const world = new World(42);

  // L10 axioms
  const axioms = new AxiomRegistry();
  axioms.add(axiomIdLength);
  axioms.add(axiomEntityCap(5000));
  axioms.add(axiomSanctuary({ x: 30, y: 0, z: 30 }, 5));

  // L4 command bus with axiom guard
  const bus = new CommandBus(world, axiomGuarded(defaultReducer, axioms));

  // L3 scheduler
  const scheduler = new Scheduler(world);

  // L6 agents + input registry
  const agents = new AgentSystem();
  const inputs = new InputRegistry();
  inputs.register({
    code: "KeyE", contexts: ["play"], action: "Pickup",
    description: "Pick up / drop the aimed entity",
    handler: () => {}, ownerModule: "pickup",
  });
  inputs.register({
    code: "KeyQ", contexts: ["play"], action: "Open Quests",
    description: "Open the quest panel",
    handler: () => {}, ownerModule: "quests",
  });
  inputs.register({
    code: "Slash", contexts: ["play"], action: "Slash command",
    description: "Open the slash command prompt",
    handler: () => {}, ownerModule: "slash",
  });

  // L5 projection — ASCII via style manager
  const styleReg = new SimpleStyleRegistry();
  styleReg.register("ascii", () => {
    const p = new AsciiProjection({ width: 40, height: 16 });
    return p;
  });
  styleReg.register("paper-mario", () => new AsciiProjection({ width: 24, height: 12 }));
  const styleMgr = new RenderStyleManager({
    world, events: bus.events, registry: styleReg, initial: "ascii",
  });
  const proj = styleMgr.currentProjection() as AsciiProjection;

  // Features
  const quests = new QuestSystem();
  quests.addMany(LAUNCH_QUESTS);
  quests.attach(bus.events);

  const slash = new SlashDispatcher(bus);
  slash.registerMany(defaultSlashCommands({}));
  // /style swap via the manager
  slash.register({
    name: "style", args: ["preset"],
    description: "Switch render style",
    handler: ({ tokens }) => {
      const s = (tokens[0] ?? "ascii") as any;
      if (styleReg.has(s)) styleMgr.swap(s);
    },
  });
  // /spawn from prompt via recipes
  slash.register({
    name: "spawn", args: ["prompt"],
    description: "Spawn an entity via prompt",
    handler: ({ rest, bus }) => {
      const cmd = promptToSpawnCommand(rest, { x: 5, y: 0, z: 5 });
      if (cmd) bus.submit(cmd);
    },
  });

  const portals = new PortalProximitySystem();
  const biome = new BiomeStreamingSystem({ radiusChunks: 2 });
  const ambient = new AmbientPolish(bus.events, {
    emitParticlePuff: () => {},
    playFootstep: () => {},
    playChime: () => {},
  });
  ambient.attach();

  const tutorial = new FirstLaunchTutorial(bus.events, bus, {
    schedule: () => {},  // step delays no-op for headless demo
  });

  const creations = new InMemoryCreationLibrary();

  const fpsGuardrail = new FPSGuardrail({
    applyQuality: () => {},
    now: () => 0,
  });

  // Spawn player
  bus.applyImmediate({
    kind: "SpawnEntity", id: "player", prototypeId: "player",
    transform: identityTransform(),
    components: {
      collider: { shape: "capsule", size: { x: 0.5, y: 1.8, z: 0.5 }, solid: true },
      saveable: { persistent: true },
    },
  });
  agents.register({ id: "player", agency: "human", perceptionRadius: 12 });

  // Spawn three initial entities via the recipes pipeline
  for (const { prompt, position } of [
    { prompt: "an iron sword",      position: { x: 2, y: 0, z: 0 } },
    { prompt: "a wandering wizard", position: { x: 5, y: 0, z: 5 } },
    { prompt: "a wooden door",      position: { x: -2, y: 0, z: 0 } },
  ]) {
    const cmd = promptToSpawnCommand(prompt, position);
    if (cmd) bus.applyImmediate(cmd);
  }

  // Wire the wizard NPC as a machine agent with adaptive policy
  const wizard = Array.from(world.allEntities()).find((e) => e.prototypeId === "wizard_npc");
  if (wizard) {
    agents.register({
      id: wizard.id,
      agency: "machine",
      perceptionRadius: 10,
      cognition: adaptivePolicy({ hostileRange: 3, followRange: 8 }),
    });
  }

  // Spawn portals around the player
  for (const { pos, dest } of [
    { pos: { x: -8, y: 0, z: 0 },  dest: { kind: "substrate", worldId: "library" } as const },
    { pos: { x: 8,  y: 0, z: 0 },  dest: { kind: "substrate", worldId: "archive" } as const },
  ]) {
    bus.applyImmediate(spawnPortalCommand({ label: "Sub", destination: dest }, pos));
  }

  // Schedule the multi-rate ticks
  scheduler.register({
    name: "agents-cognition",
    every: 6,  // 10 Hz
    system: () => {
      agents.tickMachineAgents(world, bus, world.tick);
      bus.flush();
    },
  });
  scheduler.register({
    name: "portal-proximity",
    every: 2,  // 30 Hz
    system: () => { portals.tick(world, "player", bus); bus.flush(); },
  });
  scheduler.register({
    name: "biome-streaming",
    every: 30,  // 2 Hz
    system: () => {
      const p = world.getEntity("player");
      if (p) biome.tick(world, bus, p.transform.position);
    },
  });
  scheduler.register({
    name: "projection-focus",
    every: 1,
    system: () => {
      const p = world.getEntity("player");
      if (p) proj.setFocus(p.transform.position);
    },
  });

  // Tutorial fires once (force=true for the demo)
  tutorial.start({ force: true, playerPosition: { x: 0, y: 0, z: 0 } });

  function run(ticks: number): string {
    scheduler.stepN(ticks);
    return proj.renderToString();
  }

  return {
    world, bus, scheduler, agents, inputs, axioms, quests, slash, proj, styleMgr,
    portals, biome, ambient, tutorial, creations, fpsGuardrail, run,
  };
}

export { renderHelpText, exportSnapshot, restoreSnapshot, WorkshopSession, wanderPolicy };
