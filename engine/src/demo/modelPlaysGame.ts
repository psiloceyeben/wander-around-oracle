// Live demo — the 125M Tree-of-Life model plays the game against the
// running Oracle HTTP server on Box C. Reports per-tick:
//   - Composed perception prompt
//   - Model's routed Sephirah + confidence
//   - Resulting command
//   - Engine event response
//
// Run from Node with the Oracle server up on localhost:8765:
//   node --experimental-specifier-resolution=node src/demo/modelPlaysGame.js

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { AgentSystem } from "../agent/index.js";
import { identityTransform } from "../entity/index.js";
import { AsciiProjection } from "../projection/index.js";
import {
  HttpOracleClient,
  composePerceptionPrompt,
  sephirahToCommand,
} from "../features/agentPlayer/index.js";
import { composePerceptionSubstrate } from "../features/perceptionSubstrate/index.js";
import { composeCommandFromSubstrate } from "../features/commandSubstrate/index.js";
import { doubleRecursiveAttention } from "../features/agentPlayer/index.js";
import { spawnPortalCommand } from "../features/portals/index.js";
import { QuestSystem, LAUNCH_QUESTS } from "../features/quests/index.js";

interface DemoStats {
  ticks: number;
  commandsByKind: Record<string, number>;
  sephirahCounts: Record<string, number>;
  questsCompleted: string[];
  lastFew: Array<{ tick: number; prompt: string; routed: string; conf: number; cmdKind: string | null; text: string }>;
}

export async function runModelPlaysGame(opts: {
  ticks?: number;
  oracleEndpoint?: string;
  verbose?: boolean;
  /** Use the substrate-paradigm cognition path (perception HRR + substrate
   *  cleanup over command dictionary). Default true. Set false to use the
   *  legacy text-grammar path (sephirahToCommand). */
  useSubstrate?: boolean;
  /** Use the double recursive attention head to refine routing before
   *  substrate cleanup. Default true. Only applies when useSubstrate=true. */
  useAttention?: boolean;
}): Promise<DemoStats> {
  const TICKS = opts.ticks ?? 12;
  const useSubstrate = opts.useSubstrate ?? true;
  const useAttention = opts.useAttention ?? true;
  const oracle = new HttpOracleClient(opts.oracleEndpoint ?? "http://127.0.0.1:8765");
  const health = await oracle.healthz();
  if (!health.ok) throw new Error("Oracle server is not healthy");
  if (opts.verbose) {
    const pathDesc = useSubstrate
      ? `SUBSTRATE${useAttention ? "+attention" : ""}`
      : "text-grammar";
    console.log(`# Oracle healthy at step ${health.step}  path=${pathDesc}`);
  }

  // Build a tiny world with player, sword, portal, NPC
  const world = new World(42);
  const bus = new CommandBus(world, defaultReducer);
  const proj = new AsciiProjection({ width: 30, height: 12 });
  proj.init(world);
  bus.events.on("*", (e) => proj.onEvent(e));

  const agents = new AgentSystem();
  const quests = new QuestSystem();
  quests.addMany(LAUNCH_QUESTS);
  quests.attach(bus.events);

  // Place an agent named "model" — the entity the Oracle drives
  bus.applyImmediate({
    kind: "SpawnEntity", id: "model", prototypeId: "wizard_npc",
    transform: identityTransform(),
    components: { renderable: { meshTag: "wizard_npc" } },
  });
  // We drive the agent externally per tick — register as "human" so the AgentSystem
  // doesn't try to invoke a cognition op (we provide commands directly).
  agents.register({ id: "model", agency: "human", perceptionRadius: 12 });

  // Seed a sword and a portal so the agent has things to interact with
  bus.applyImmediate({
    kind: "SpawnEntity", id: "sword", prototypeId: "sword",
    transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
    components: { interactable: { verb: "pickup", range: 3 }, saveable: { persistent: true } },
  });
  bus.applyImmediate(spawnPortalCommand(
    { label: "lib", destination: { kind: "substrate", worldId: "lib" } },
    { x: 5, y: 0, z: 0 },
  ));

  const stats: DemoStats = {
    ticks: 0,
    commandsByKind: {},
    sephirahCounts: {},
    questsCompleted: [],
    lastFew: [],
  };
  bus.events.on("*", (e) => {
    if (e.kind !== "CommandRejected") {
      stats.commandsByKind[e.kind] = (stats.commandsByKind[e.kind] ?? 0) + 1;
    }
  });

  for (let tick = 0; tick < TICKS; tick++) {
    // Refresh perception
    agents.refreshPerception(world, "model", tick);
    const visibleIds = agents.perceptionOf("model")?.visibleIds ?? [];

    // Compose perception prompt + query Oracle
    const prompt = composePerceptionPrompt(world, "model", visibleIds);
    const resp = await oracle.query(prompt, { maxTokens: 12, temperature: 0.85 });
    stats.sephirahCounts[resp.routed_sephirah] = (stats.sephirahCounts[resp.routed_sephirah] ?? 0) + 1;

    // Map (routing, perception) → Command via substrate cleanup,
    // OR (Sephirah, text) → Command via legacy text grammar.
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
    let cmdKind: string | null = null;
    if (cmd) {
      cmdKind = cmd.kind;
      bus.applyImmediate(cmd);
    }
    stats.ticks++;
    stats.lastFew.push({
      tick, prompt, routed: resp.routed_sephirah, conf: resp.routed_confidence,
      cmdKind, text: resp.text.slice(0, 40),
    });

    if (opts.verbose) {
      console.log(`# tick ${tick}: routed=${resp.routed_sephirah}(${resp.routed_confidence.toFixed(2)}) → ${cmdKind ?? "none"}  text=${resp.text.slice(0, 30).replace(/\n/g, " ")}`);
    }
  }

  stats.questsCompleted = quests.progress().completedIds;
  return stats;
}

/** Print a feature-coverage report. */
export function reportCoverage(stats: DemoStats): string {
  const lines: string[] = [];
  lines.push("=== Agent Playtest Coverage ===");
  lines.push(`Ticks run:        ${stats.ticks}`);
  lines.push(`Quests completed: ${stats.questsCompleted.length} / ${LAUNCH_QUESTS.length}`);
  for (const id of stats.questsCompleted) lines.push(`  ✓ ${id}`);
  lines.push("");
  lines.push("Commands by kind:");
  for (const [k, n] of Object.entries(stats.commandsByKind).sort()) {
    lines.push(`  ${k.padEnd(20)} ${n}`);
  }
  lines.push("");
  lines.push("Sephirah routing distribution:");
  const total = Object.values(stats.sephirahCounts).reduce((a, b) => a + b, 0) || 1;
  for (const [s, n] of Object.entries(stats.sephirahCounts).sort((a, b) => b[1] - a[1])) {
    const pct = (100 * n / total).toFixed(0);
    lines.push(`  ${s.padEnd(10)} ${n.toString().padStart(3)} (${pct.padStart(2)}%)`);
  }
  lines.push("");
  lines.push("Last few decisions:");
  for (const e of stats.lastFew.slice(-6)) {
    lines.push(`  t${e.tick.toString().padStart(2)}  ${e.routed.padEnd(10)} (${e.conf.toFixed(2)})  → ${(e.cmdKind ?? "none").padEnd(18)}  ${e.text}`);
  }
  return lines.join("\n");
}

import { LAUNCH_QUESTS as _LAUNCH_QUESTS } from "../features/quests/index.js";

// CLI runner — handle both .js (compiled) and .ts (tsx-direct) entry points
//   tsx modelPlaysGame.ts [ticks] [--text-path] [--no-attention]
if (typeof process !== "undefined" && /modelPlaysGame\.(js|ts)$/.test(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const useSubstrate = !args.includes("--text-path");
  const useAttention = !args.includes("--no-attention");
  const ticks = Number(args.find((a) => !a.startsWith("--")) ?? 12);
  runModelPlaysGame({ ticks, verbose: true, useSubstrate, useAttention })
    .then((stats) => {
      console.log("\n" + reportCoverage(stats));
    })
    .catch((e) => {
      console.error("playtest failed:", e);
      process.exit(1);
    });
}
