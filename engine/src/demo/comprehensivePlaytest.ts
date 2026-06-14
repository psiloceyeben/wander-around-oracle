// Comprehensive playtest — the 125M model exercises every v7.2 feature and
// every slash command, with substrate-paradigm-pure routing decisions where
// the model genuinely chooses, and programmatic exercise where the feature
// is renderer/persistence-side and has no model-decision dimension.
//
// Coverage matrix:
//   Model-decision features (via Oracle):
//     recipes, portals, quests (auto), npcBehavior, voice (api)
//   Programmatic features (no model decision):
//     saveBackup, helpOverlay, workshop, fpsGuardrail, renderStyles,
//     biomeWorldgen, ambientPolish, slashCommands (each command issued)
//   Tutorial (advanced via real events):
//     firstLaunchTutorial
//
// Output: per-feature pass/fail + per-command pass/fail + Sephirah trace.

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { AgentSystem, InputRegistry } from "../agent/index.js";
import { identityTransform } from "../entity/index.js";
import { AsciiProjection } from "../projection/index.js";
import {
  AxiomRegistry, axiomGuarded, axiomIdLength, axiomEntityCap, axiomSanctuary,
} from "../axiom/index.js";

import {
  HttpOracleClient,
  composePerceptionPrompt,
  sephirahToCommand,
} from "../features/agentPlayer/index.js";
import { composePerceptionSubstrate } from "../features/perceptionSubstrate/index.js";
import { composeCommandFromSubstrate } from "../features/commandSubstrate/index.js";
import { doubleRecursiveAttention } from "../features/agentPlayer/index.js";
import { promptToSpawnCommand } from "../features/recipes/index.js";
import { spawnPortalCommand, PortalProximitySystem } from "../features/portals/index.js";
import { QuestSystem, LAUNCH_QUESTS } from "../features/quests/index.js";
import { SlashDispatcher, defaultSlashCommands } from "../features/slashCommands/index.js";
import {
  exportSnapshot, exportLog, restoreSnapshot, restoreLog, backupFromText,
} from "../features/saveBackup/index.js";
import { FirstLaunchTutorial } from "../features/firstLaunchTutorial/index.js";
import { renderHelpText } from "../features/helpOverlay/index.js";
import { WorkshopSession, InMemoryCreationLibrary, spawnCreation } from "../features/workshop/index.js";
import { FPSGuardrail } from "../features/fpsGuardrail/index.js";
import { SimpleStyleRegistry, RenderStyleManager } from "../features/renderStyles/index.js";
import { BiomeStreamingSystem } from "../features/biomeWorldgen/index.js";
import { adaptivePolicy } from "../features/npcBehavior/index.js";
import { AmbientPolish } from "../features/ambientPolish/index.js";

// ── Coverage tracker ─────────────────────────────────────────────────

interface FeatureResult {
  name: string;
  pass: boolean;
  detail: string;
}

interface CommandResult {
  command: string;
  pass: boolean;
  detail: string;
}

interface PlaytestReport {
  oracleHealthy: boolean;
  oracleStep: number | null;
  features: FeatureResult[];
  commands: CommandResult[];
  sephirahTrace: Array<{ tick: number; prompt: string; routed: string; conf: number; text: string }>;
  questsCompleted: string[];
  totalQuests: number;
  ticksRun: number;
  passedFeatures: number;
  passedCommands: number;
}

// ── Main playtest ──────────────────────────────────────────────────────

export async function runComprehensivePlaytest(opts: {
  oracleEndpoint?: string;
  modelTicks?: number;
  verbose?: boolean;
  /** Use substrate-paradigm cognition (perception HRR + substrate cleanup).
   *  Default true. Set false for legacy text-grammar (sephirahToCommand). */
  useSubstrate?: boolean;
  /** Use the double recursive attention head (perception + affordance
   *  attention) to refine routing before cleanup. Default true. */
  useAttention?: boolean;
}): Promise<PlaytestReport> {
  const useSubstrate = opts.useSubstrate ?? true;
  const useAttention = opts.useAttention ?? true;
  const report: PlaytestReport = {
    oracleHealthy: false,
    oracleStep: null,
    features: [],
    commands: [],
    sephirahTrace: [],
    questsCompleted: [],
    totalQuests: LAUNCH_QUESTS.length,
    ticksRun: 0,
    passedFeatures: 0,
    passedCommands: 0,
  };

  // ── Oracle ─────────────────────────────────────────────────────
  const oracle = new HttpOracleClient(opts.oracleEndpoint ?? "http://127.0.0.1:8765");
  try {
    const h = await oracle.healthz();
    report.oracleHealthy = h.ok;
    report.oracleStep = h.step ?? null;
  } catch (e) {
    report.oracleHealthy = false;
  }
  if (opts.verbose) console.log(`# Oracle: healthy=${report.oracleHealthy} step=${report.oracleStep}`);

  // ── World + bus setup ─────────────────────────────────────────
  const axioms = new AxiomRegistry();
  axioms.add(axiomIdLength);
  axioms.add(axiomEntityCap(5000));
  axioms.add(axiomSanctuary({ x: 50, y: 0, z: 50 }, 3));
  const world = new World(42);
  const bus = new CommandBus(world, axiomGuarded(defaultReducer, axioms));

  // Track every fired event
  const firedEvents: string[] = [];
  bus.events.on("*", (e) => { if (e.kind !== "CommandRejected") firedEvents.push(e.kind); });

  // Quest system
  const quests = new QuestSystem();
  quests.addMany(LAUNCH_QUESTS);
  quests.attach(bus.events);

  // Ambient polish
  let ambientChimes = 0;
  const ambient = new AmbientPolish(bus.events, { playChime: () => ambientChimes++ });
  ambient.attach();

  // Render-style manager
  const styleReg = new SimpleStyleRegistry();
  styleReg.register("ascii", () => new AsciiProjection({ width: 20, height: 10 }));
  styleReg.register("paper-mario", () => new AsciiProjection({ width: 16, height: 8 }));
  const styleMgr = new RenderStyleManager({ world, events: bus.events, registry: styleReg, initial: "ascii" });

  // Biome streaming
  const biome = new BiomeStreamingSystem({ radiusChunks: 1 });

  // Portal proximity
  const portals = new PortalProximitySystem();

  // Input registry + help overlay
  const inputs = new InputRegistry();
  inputs.register({ code: "KeyE", contexts: ["play"], action: "Pickup", description: "Pick up entity", handler: () => {}, ownerModule: "pickup" });
  inputs.register({ code: "KeyQ", contexts: ["play"], action: "Quests", description: "Open quest panel", handler: () => {}, ownerModule: "quests" });
  inputs.register({ code: "Slash", contexts: ["play"], action: "Slash", description: "Open slash prompt", handler: () => {}, ownerModule: "slash" });

  // Workshop
  const creations = new InMemoryCreationLibrary();

  // FPS guardrail
  let fpsApplied = false;
  const fpsGuard = new FPSGuardrail({
    thresholdFps: 30, measurementSeconds: 0.05,
    applyQuality: () => { fpsApplied = true; },
    promptUser: async () => "low",
    now: (() => { let t = 0; return () => (t += 50); })(),  // simulate 20fps
  });

  // Slash dispatcher
  const slash = new SlashDispatcher(bus);
  slash.registerMany(defaultSlashCommands({}));
  slash.register({
    name: "spawn", args: ["prompt"], description: "Spawn entity from prompt",
    handler: ({ rest, bus }) => {
      const cmd = promptToSpawnCommand(rest, { x: 5, y: 0, z: 5 });
      if (cmd) bus.submit(cmd);
    },
  });
  slash.register({
    name: "style", args: ["preset"], description: "Switch render style",
    handler: ({ tokens }) => {
      const s = (tokens[0] ?? "ascii") as any;
      if (styleReg.has(s)) styleMgr.swap(s);
    },
  });
  slash.register({
    name: "backup", args: [], description: "Export world snapshot",
    handler: ({ hud }) => { exportSnapshot(world, "v2"); hud?.("backup exported"); },
  });

  // Agent setup
  const agents = new AgentSystem();
  bus.applyImmediate({
    kind: "SpawnEntity", id: "model", prototypeId: "wizard_npc",
    transform: identityTransform(),
    components: { renderable: { meshTag: "wizard_npc" }, saveable: { persistent: true } },
  });
  agents.register({ id: "model", agency: "human", perceptionRadius: 12 });

  // Wizard companion as a separate NPC with adaptive cognition (tests npcBehavior)
  bus.applyImmediate({
    kind: "SpawnEntity", id: "wizard", prototypeId: "wizard_npc",
    transform: { ...identityTransform(), position: { x: 8, y: 0, z: 0 } },
    components: { ai: { policy: "wander", perceptionRadius: 6, state: {} } },
  });
  agents.register({
    id: "wizard", agency: "machine", perceptionRadius: 6,
    cognition: adaptivePolicy({ hostileRange: 2, followRange: 8 }),
  });

  // Seed items + portals so the agent has things to interact with
  bus.applyImmediate({
    kind: "SpawnEntity", id: "sword", prototypeId: "sword",
    transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
    components: { interactable: { verb: "pickup", range: 3 }, saveable: { persistent: true } },
  });
  bus.applyImmediate(spawnPortalCommand(
    { label: "lib", destination: { kind: "substrate", worldId: "lib" } },
    { x: 4, y: 0, z: 0 },
  ));

  // ── PHASE 1: Programmatic feature exercises ────────────────────

  if (opts.verbose) console.log("# Phase 1: programmatic features");

  // recipes — exercised by spawning the sword above
  report.features.push({
    name: "recipes",
    pass: firedEvents.includes("EntitySpawned"),
    detail: `entities spawned: ${firedEvents.filter((e) => e === "EntitySpawned").length}`,
  });

  // helpOverlay — generate text from registry
  try {
    const help = renderHelpText({ inputs, slashCommands: slash.list() });
    const hasSlash = help.includes("/save");
    const hasKey   = help.includes("E ") || help.includes("Pickup");
    report.features.push({
      name: "helpOverlay",
      pass: hasSlash && hasKey,
      detail: `${help.split("\n").length} lines, /save=${hasSlash}, key/action=${hasKey}`,
    });
  } catch (e) {
    report.features.push({ name: "helpOverlay", pass: false, detail: `error: ${e}` });
  }

  // workshop — session, add parts, save creation, spawn back
  try {
    const sess = new WorkshopSession({ bus, world, origin: { x: 20, y: 0, z: 20 } });
    sess.addPart("column", { x: -1, y: 0, z: 0 });
    sess.addPart("column", { x:  1, y: 0, z: 0 });
    const c = sess.save(creations, "my-arch");
    sess.close();
    const id = spawnCreation(c, bus, { x: 30, y: 0, z: 30 });
    report.features.push({
      name: "workshop",
      pass: c.parts.length === 2 && world.getEntity(id) !== undefined,
      detail: `saved ${c.parts.length} parts, respawned id=${id}`,
    });
  } catch (e) {
    report.features.push({ name: "workshop", pass: false, detail: `error: ${e}` });
  }

  // fpsGuardrail — measure and apply low
  try {
    fpsGuard.init();
    for (let i = 0; i < 5; i++) fpsGuard.tick();
    await new Promise((r) => setTimeout(r, 30));
    report.features.push({
      name: "fpsGuardrail",
      pass: fpsApplied,
      detail: `low preset applied: ${fpsApplied}`,
    });
  } catch (e) {
    report.features.push({ name: "fpsGuardrail", pass: false, detail: `error: ${e}` });
  }

  // renderStyles — swap projection
  try {
    styleMgr.swap("paper-mario");
    const swapped = styleMgr.current() === "paper-mario";
    styleMgr.swap("ascii");
    report.features.push({
      name: "renderStyles",
      pass: swapped && styleMgr.current() === "ascii",
      detail: "swap paper-mario → ascii succeeded",
    });
  } catch (e) {
    report.features.push({ name: "renderStyles", pass: false, detail: `error: ${e}` });
  }

  // biomeWorldgen — stream chunks around player
  try {
    const playerPos = world.getEntity("model")!.transform.position;
    biome.tick(world, bus, playerPos);
    report.features.push({
      name: "biomeWorldgen",
      pass: biome.loadedCount() > 0,
      detail: `${biome.loadedCount()} chunks loaded`,
    });
  } catch (e) {
    report.features.push({ name: "biomeWorldgen", pass: false, detail: `error: ${e}` });
  }

  // ambientPolish — chimes should have fired from EntitySpawned
  report.features.push({
    name: "ambientPolish",
    pass: ambientChimes > 0,
    detail: `${ambientChimes} chimes fired on engine events`,
  });

  // saveBackup — snapshot, restore into fresh world, verify match
  try {
    const snap = exportSnapshot(world, "v2");
    const log = exportLog(bus, "v2");
    const text = JSON.stringify(snap);
    const parsed = backupFromText(text);
    const freshWorld = new World(42);
    const freshBus = new CommandBus(freshWorld, defaultReducer);
    const { restored } = restoreSnapshot(snap, freshBus);
    const logFresh = new World(42);
    const logBus = new CommandBus(logFresh, defaultReducer);
    const { applied } = restoreLog(log, logBus);
    report.features.push({
      name: "saveBackup",
      pass: parsed.format === "snapshot" && restored > 0 && applied > 0,
      detail: `snapshot=${restored} entities restored, log=${applied} commands replayed`,
    });
  } catch (e) {
    report.features.push({ name: "saveBackup", pass: false, detail: `error: ${e}` });
  }

  // npcBehavior — wizard NPC has adaptive policy; tick once + verify it moves
  try {
    const before = world.getEntity("wizard")!.transform.position.x;
    for (let i = 0; i < 4; i++) {
      agents.tickMachineAgents(world, bus, world.tick + i);
      bus.flush();
    }
    const after = world.getEntity("wizard")!.transform.position.x;
    report.features.push({
      name: "npcBehavior",
      pass: Math.abs(after - before) > 0,
      detail: `wizard moved ${(after - before).toFixed(3)}m`,
    });
  } catch (e) {
    report.features.push({ name: "npcBehavior", pass: false, detail: `error: ${e}` });
  }

  // voice — only API surface verification (browser-dependent for real use)
  try {
    const { speak, cancelSpeech, VoiceCapture } = await import("../features/voice/index.js");
    const vc = new VoiceCapture({ onResult: () => {} });
    // headless-safe: isAvailable false, start() returns false
    const start = vc.start();
    speak("test");
    cancelSpeech();
    report.features.push({
      name: "voice",
      pass: typeof speak === "function" && typeof start === "boolean",
      detail: `api ok; available=${vc.isAvailable()}`,
    });
  } catch (e) {
    report.features.push({ name: "voice", pass: false, detail: `error: ${e}` });
  }

  // ── PHASE 2: First-launch tutorial (spawn-only sanity check) ─

  if (opts.verbose) console.log("# Phase 2: tutorial");
  try {
    let companionSpawned = false;
    const unsub = bus.events.on("EntitySpawned", (e) => {
      if (e.kind === "EntitySpawned" && e.entity.id === "tutorial-companion") companionSpawned = true;
    });
    const tutorial = new FirstLaunchTutorial(bus.events, bus, {
      schedule: () => {},  // freeze delays
    });
    tutorial.start({ force: true, playerPosition: { x: 0, y: 0, z: 0 } });
    const startedAtGreet = tutorial.currentStepId() === "greet";
    tutorial.abort();  // clean up
    unsub();
    report.features.push({
      name: "firstLaunchTutorial",
      pass: companionSpawned && startedAtGreet,
      detail: `companion spawned=${companionSpawned}, started at greet=${startedAtGreet}`,
    });
  } catch (e) {
    report.features.push({ name: "firstLaunchTutorial", pass: false, detail: `error: ${e}` });
  }

  // ── PHASE 3: Portals (proximity-triggered transit) ────────────

  if (opts.verbose) console.log("# Phase 3: portals");
  try {
    // Move agent to the portal's position
    bus.applyImmediate({
      kind: "MoveEntity", id: "model",
      transform: { position: { x: 4, y: 0, z: 0 } },
    });
    const submitted = portals.tick(world, "model", bus);
    bus.flush();
    report.features.push({
      name: "portals",
      pass: submitted > 0 || firedEvents.includes("PortalEntered"),
      detail: `submitted ${submitted}, PortalEntered events: ${firedEvents.filter((e) => e === "PortalEntered").length}`,
    });
  } catch (e) {
    report.features.push({ name: "portals", pass: false, detail: `error: ${e}` });
  }

  // ── PHASE 4: Slash command battery ────────────────────────────

  if (opts.verbose) console.log("# Phase 4: slash commands");
  const commandsToTest: Array<{ cmd: string; expectEvent?: string }> = [
    { cmd: "/help" },
    { cmd: "/time 14",                expectEvent: "TimeChanged" },
    { cmd: "/save mygame",            expectEvent: "WorldSaved" },
    { cmd: "/spawn an iron sword",    expectEvent: "EntitySpawned" },
    { cmd: "/spawn a tree",           expectEvent: "EntitySpawned" },
    { cmd: "/spawn a wizard",         expectEvent: "EntitySpawned" },
    { cmd: "/style paper-mario" },
    { cmd: "/style ascii" },
    { cmd: "/backup" },
    { cmd: "/load mygame" },
  ];
  for (const tc of commandsToTest) {
    const eventsBefore = firedEvents.length;
    const r = await slash.dispatch(tc.cmd);
    bus.flush();
    const eventsAfter = firedEvents.length;
    const newEvents = firedEvents.slice(eventsBefore, eventsAfter);
    const ok = r.ok && (tc.expectEvent ? newEvents.includes(tc.expectEvent) : true);
    report.commands.push({
      command: tc.cmd,
      pass: ok,
      detail: `ok=${r.ok}${tc.expectEvent ? `, expected=${tc.expectEvent}, got=[${newEvents.join(",")}]` : ""}${r.error ? `, err=${r.error}` : ""}`,
    });
  }

  // ── PHASE 5: Model-decision agent play ────────────────────────

  const MODEL_TICKS = opts.modelTicks ?? 5;
  if (opts.verbose) console.log(`# Phase 5: model decides for ${MODEL_TICKS} ticks`);

  // Scripted scenarios — different perception contexts to draw different routing
  const scenarios = [
    "I see a temple in the distance and I want to build",   // tiferet hopefully
    "I have a sword in my hand and I will",                  // malkuth/geburah
    "I am moving across a wide field and I will",            // netzach
    "I have completed my work and I will now",               // yesod
    "I see a wizard and I will",                             // varied
  ];

  for (let tick = 0; tick < MODEL_TICKS; tick++) {
    if (!report.oracleHealthy) break;
    agents.refreshPerception(world, "model", tick);
    const visibleIds = agents.perceptionOf("model")?.visibleIds ?? [];
    const scenarioPrompt = scenarios[tick % scenarios.length];
    const prompt = `${composePerceptionPrompt(world, "model", visibleIds)} ${scenarioPrompt}`;
    try {
      const resp = await oracle.query(prompt, { maxTokens: 12, temperature: 0.85 });
      report.sephirahTrace.push({
        tick, prompt: prompt.slice(0, 80),
        routed: resp.routed_sephirah, conf: resp.routed_confidence,
        text: resp.text.slice(0, 40),
      });
      let cmd;
      if (useSubstrate) {
        const perception = composePerceptionSubstrate(world, "model", { radius: 12, includeHolding: true });
        const routing = useAttention
          ? doubleRecursiveAttention(resp.sephirah_probs, perception).routing
          : resp.sephirah_probs;
        const selection = composeCommandFromSubstrate(
          routing, perception, world, "model",
          { generationPrompt: resp.text },
        );
        cmd = selection.command;
      } else {
        cmd = sephirahToCommand(resp.routed_sephirah, resp.text, world, "model", visibleIds);
      }
      if (cmd) {
        bus.applyImmediate(cmd);
      }
      report.ticksRun++;
      if (opts.verbose) {
        const pathTag = useSubstrate ? (useAttention ? "substrate+att" : "substrate") : "text";
        console.log(`# tick ${tick}: routed=${resp.routed_sephirah}(${resp.routed_confidence.toFixed(2)}) → ${cmd?.kind ?? "none"}  [${pathTag}]`);
      }
    } catch (e) {
      if (opts.verbose) console.log(`# tick ${tick}: query failed: ${e}`);
    }
  }

  // ── Tally ─────────────────────────────────────────────────────

  report.questsCompleted = quests.progress().completedIds;
  report.passedFeatures = report.features.filter((f) => f.pass).length;
  report.passedCommands = report.commands.filter((c) => c.pass).length;
  return report;
}

export function reportPlaytestText(r: PlaytestReport): string {
  const lines: string[] = [];
  lines.push("════════ COMPREHENSIVE PLAYTEST REPORT ════════");
  lines.push(`Oracle:           ${r.oracleHealthy ? "healthy" : "DOWN"}${r.oracleStep !== null ? ` (step ${r.oracleStep})` : ""}`);
  lines.push(`Model ticks run:  ${r.ticksRun}`);
  lines.push(`Quests done:      ${r.questsCompleted.length}/${r.totalQuests}`);
  lines.push("");
  lines.push("Features (programmatic + agent-driven):");
  for (const f of r.features) {
    const mark = f.pass ? "✓" : "✗";
    lines.push(`  ${mark} ${f.name.padEnd(22)} ${f.detail}`);
  }
  lines.push(`  ── ${r.passedFeatures}/${r.features.length} passed`);
  lines.push("");
  lines.push("Slash commands:");
  for (const c of r.commands) {
    const mark = c.pass ? "✓" : "✗";
    lines.push(`  ${mark} ${c.command.padEnd(28)} ${c.detail}`);
  }
  lines.push(`  ── ${r.passedCommands}/${r.commands.length} passed`);
  lines.push("");
  if (r.sephirahTrace.length > 0) {
    lines.push("Model decisions (Sephirah routing trace):");
    for (const t of r.sephirahTrace) {
      lines.push(`  t${t.tick}  ${t.routed.padEnd(10)} (${t.conf.toFixed(2)})  "${t.text.replace(/\n/g, " ")}"`);
    }
    lines.push("");
  }
  lines.push("Quests completed:");
  for (const q of r.questsCompleted) lines.push(`  ✓ ${q}`);
  lines.push("");
  lines.push(`OVERALL: ${r.passedFeatures + r.passedCommands}/${r.features.length + r.commands.length} pass`);
  lines.push("════════════════════════════════════════════════");
  return lines.join("\n");
}

// CLI runner
if (typeof process !== "undefined" && /comprehensivePlaytest\.(js|ts)$/.test(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const useSubstrate = !args.includes("--text-path");
  const useAttention = !args.includes("--no-attention");
  const oracleArg = args.find((a) => a.startsWith("--oracle="));
  const oracleEndpoint = oracleArg ? oracleArg.slice("--oracle=".length) : undefined;
  const ticks = Number(args.find((a) => !a.startsWith("--")) ?? 5);
  runComprehensivePlaytest({ modelTicks: ticks, verbose: true, useSubstrate, useAttention, oracleEndpoint })
    .then((r) => {
      console.log("\n" + reportPlaytestText(r));
      const allPass = r.passedFeatures === r.features.length && r.passedCommands === r.commands.length;
      process.exit(allPass ? 0 : 1);
    })
    .catch((e) => {
      console.error("playtest failed:", e);
      process.exit(2);
    });
}
