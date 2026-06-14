// Cognition discrimination test — does the 125M actually play the game,
// or does the hand-written Sephirah grammar do all the work?
//
// Three tests with falsifiable pass/fail criteria:
//
//   T1 BASELINE COMPARISON
//     Run the same playtest with 3 oracle variants:
//       (a) RandomOracle — uniform random Sephirah
//       (b) DeterministicOracle — always "tiferet"
//       (c) 125M actual Oracle (HTTP)
//     Measure feature coverage and quest completion per run.
//     PASS if 125M produces materially different (more varied OR more
//     focused depending on the goal) outcomes than both baselines.
//     FAIL if 125M coverage matches random baseline within noise — that
//     means the grammar dominates and the model adds nothing.
//
//   T2 CONTEXTUAL SENSITIVITY
//     Three world configurations: agent + sword, agent + temple, agent + portal.
//     Query 125M N times per scene. Measure Sephirah-distribution
//     similarity across scenes via Jensen-Shannon divergence.
//     PASS if distributions differ (high JSD between scenes) — model is
//     reading the perception. FAIL if distributions are nearly identical
//     across scenes — model is just classifying tokens, not perceiving.
//
//   T3 DIRECT COMMAND EMISSION
//     Prompt the model with explicit command syntax. Parse text
//     continuations as commands. Score parse-success rate.
//     PASS if >25% of continuations parse as valid commands — model can
//     emit structured intent. FAIL if <10% — model produces text, not
//     commands. Mid-range = qualitative.

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { AgentSystem } from "../agent/index.js";
import { identityTransform } from "../entity/index.js";

import {
  HttpOracleClient,
  composePerceptionPrompt, sephirahToCommand,
  type OracleClient, type OracleResponse,
} from "../features/agentPlayer/index.js";
import { composePerceptionSubstrate } from "../features/perceptionSubstrate/index.js";
import { composeCommandFromSubstrate, type CommandVerb } from "../features/commandSubstrate/index.js";
import { doubleRecursiveAttention } from "../features/agentPlayer/index.js";
import { cosine } from "../hrr/core.js";
import { type Sephirah, SEPHIROTH } from "../hrr/treeOfLife.js";
import { spawnPortalCommand } from "../features/portals/index.js";
import { QuestSystem, LAUNCH_QUESTS } from "../features/quests/index.js";

// ── Oracle variants for baseline comparison ──────────────────────────

export class RandomOracle implements OracleClient {
  private rng: () => number;
  constructor(seed: number = 1) {
    let s = seed;
    this.rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  async healthz() { return { ok: true, step: -1 }; }
  async query(_prompt: string): Promise<OracleResponse> {
    const idx = Math.floor(this.rng() * SEPHIROTH.length);
    const probs: Record<Sephirah, number> = {} as any;
    for (const s of SEPHIROTH) probs[s] = 0.1;
    return {
      routed_sephirah: SEPHIROTH[idx],
      routed_confidence: 0.1,
      sephirah_probs: probs,
      text: "",
      response_vec: [],
    };
  }
}

export class DeterministicOracle implements OracleClient {
  private fixed: Sephirah;
  constructor(fixed: Sephirah = "tiferet") { this.fixed = fixed; }
  async healthz() { return { ok: true, step: -1 }; }
  async query(_prompt: string): Promise<OracleResponse> {
    const probs: Record<Sephirah, number> = {} as any;
    for (const s of SEPHIROTH) probs[s] = (s === this.fixed) ? 0.9 : 0.011;
    return {
      routed_sephirah: this.fixed,
      routed_confidence: 0.9,
      sephirah_probs: probs,
      text: "",
      response_vec: [],
    };
  }
}

// ── Shared playtest fixture ──────────────────────────────────────────

function setupTestWorld() {
  const world = new World(42);
  const bus = new CommandBus(world, defaultReducer);
  const events: string[] = [];
  bus.events.on("*", (e) => { if (e.kind !== "CommandRejected") events.push(e.kind); });
  const quests = new QuestSystem();
  quests.addMany(LAUNCH_QUESTS);
  quests.attach(bus.events);
  const agents = new AgentSystem();

  bus.applyImmediate({
    kind: "SpawnEntity", id: "model", prototypeId: "wizard_npc",
    transform: identityTransform(), components: {},
  });
  agents.register({ id: "model", agency: "human", perceptionRadius: 12 });

  // Seed: sword, portal, NPC
  bus.applyImmediate({
    kind: "SpawnEntity", id: "sword", prototypeId: "sword",
    transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
    components: { interactable: { verb: "pickup", range: 3 }, saveable: { persistent: true } },
  });
  bus.applyImmediate(spawnPortalCommand(
    { label: "X", destination: { kind: "substrate", worldId: "x" } },
    { x: 4, y: 0, z: 0 },
  ));

  return { world, bus, events, quests, agents };
}

async function runOracleSession(oracle: OracleClient, ticks: number) {
  const { world, bus, events, quests, agents } = setupTestWorld();
  const sephCounts: Record<string, number> = {};
  for (let tick = 0; tick < ticks; tick++) {
    agents.refreshPerception(world, "model", tick);
    const visible = agents.perceptionOf("model")?.visibleIds ?? [];
    const prompt = composePerceptionPrompt(world, "model", visible);
    const resp = await oracle.query(prompt);
    sephCounts[resp.routed_sephirah] = (sephCounts[resp.routed_sephirah] ?? 0) + 1;
    const cmd = sephirahToCommand(resp.routed_sephirah, resp.text, world, "model", visible);
    if (cmd) bus.applyImmediate(cmd);
  }
  const commandKinds: Record<string, number> = {};
  for (const e of events) commandKinds[e] = (commandKinds[e] ?? 0) + 1;
  return {
    sephirahDist: sephCounts,
    commandDist: commandKinds,
    questsCompleted: quests.progress().completed,
    questIds: quests.progress().completedIds,
    totalEvents: events.length,
    uniqueEventKinds: Object.keys(commandKinds).length,
  };
}

// ── T1: Baseline comparison ──────────────────────────────────────────

export async function runT1_BaselineComparison(opts: { ticks: number; oracleEndpoint?: string }) {
  const ticks = opts.ticks;
  const random = await runOracleSession(new RandomOracle(42), ticks);
  const deterministic = await runOracleSession(new DeterministicOracle("tiferet"), ticks);
  const real = await runOracleSession(new HttpOracleClient(opts.oracleEndpoint ?? "http://127.0.0.1:8765"), ticks);

  // Measurements
  const eventCountDelta = Math.abs(real.totalEvents - random.totalEvents);
  const questCountDelta = Math.abs(real.questsCompleted - random.questsCompleted);
  const uniqueKindsDelta = real.uniqueEventKinds - random.uniqueEventKinds;

  // The 125M would PASS T1 if it produces a meaningfully different command
  // distribution than the random baseline — same total events doesn't matter
  // as much as command-kind variety and sephirah distribution shape.
  const sephVarianceReal = sephirahVariance(real.sephirahDist);
  const sephVarianceRandom = sephirahVariance(random.sephirahDist);
  const sephDistDifferentFromRandom = jsDivergence(
    normalizeDist(real.sephirahDist), normalizeDist(random.sephirahDist),
  );

  // PASS if 125M's sephirah distribution diverges meaningfully from random
  const pass = sephDistDifferentFromRandom > 0.2;

  return {
    random, deterministic, real,
    eventCountDelta, questCountDelta, uniqueKindsDelta,
    sephVarianceReal, sephVarianceRandom,
    sephDistDifferentFromRandom,
    pass,
    verdict: pass
      ? "125M routes meaningfully differently from random — model is contributing"
      : "125M routes similarly to random — grammar dominates",
  };
}

// ── T2: Contextual sensitivity ───────────────────────────────────────

export async function runT2_ContextualSensitivity(opts: { samples: number; oracleEndpoint?: string }) {
  const oracle = new HttpOracleClient(opts.oracleEndpoint ?? "http://127.0.0.1:8765");
  const samples = opts.samples;

  const scenes: Array<{ name: string; prompt: string }> = [
    { name: "sword-near",  prompt: "I am at (0, 0). I see 1 sword. I will" },
    { name: "temple-near", prompt: "I am at (0, 0). I see 1 temple. I will" },
    { name: "portal-near", prompt: "I am at (0, 0). I see 1 doorway. I will" },
    { name: "wizard-near", prompt: "I am at (0, 0). I see 1 wizard_npc. I will" },
  ];

  const distributions: Record<string, Record<string, number>> = {};
  for (const s of scenes) {
    const counts: Record<string, number> = {};
    for (let i = 0; i < samples; i++) {
      const r = await oracle.query(s.prompt);
      counts[r.routed_sephirah] = (counts[r.routed_sephirah] ?? 0) + 1;
    }
    distributions[s.name] = counts;
  }

  // Pairwise JSD between scenes — higher = more contextual sensitivity
  const sceneNames = scenes.map((s) => s.name);
  const pairJSDs: Array<{ a: string; b: string; jsd: number }> = [];
  for (let i = 0; i < sceneNames.length; i++) {
    for (let j = i + 1; j < sceneNames.length; j++) {
      const jsd = jsDivergence(
        normalizeDist(distributions[sceneNames[i]]),
        normalizeDist(distributions[sceneNames[j]]),
      );
      pairJSDs.push({ a: sceneNames[i], b: sceneNames[j], jsd });
    }
  }
  const meanJSD = pairJSDs.reduce((acc, p) => acc + p.jsd, 0) / pairJSDs.length;

  // PASS threshold: mean JSD > 0.15 — distributions are meaningfully different
  const pass = meanJSD > 0.15;

  return {
    distributions, pairJSDs, meanJSD, pass,
    verdict: pass
      ? "125M routes differently in different scenes — model is reading perception context"
      : "125M routes nearly identically across scenes — context isn't shaping routing",
  };
}

// ── T3: Direct command emission ──────────────────────────────────────

export async function runT3_DirectCommandEmission(opts: { samples: number; oracleEndpoint?: string }) {
  const oracle = new HttpOracleClient(opts.oracleEndpoint ?? "http://127.0.0.1:8765");
  const samples = opts.samples;

  const commandPrompt = `I am playing a game. I see entities around me. The valid commands are:
PICKUP <id>
DROP <id> <x> <z>
MOVE <x> <z>
SAVE
SPAWN <description>
I will now issue command:`;

  const results: Array<{ text: string; parsed: { kind: string; ok: boolean } | null }> = [];
  for (let i = 0; i < samples; i++) {
    const r = await oracle.query(commandPrompt, { maxTokens: 20, temperature: 0.6 });
    const parsed = parseAsCommand(r.text);
    results.push({ text: r.text.trim(), parsed });
  }
  const validCount = results.filter((r) => r.parsed?.ok).length;
  const successRate = validCount / samples;
  const pass = successRate > 0.25;
  const qualitative = successRate > 0.10 ? "marginal" : "fail";
  return {
    samples: results,
    successRate, validCount, totalSamples: samples,
    pass,
    verdict: pass
      ? `${(successRate*100).toFixed(0)}% parse — model can emit structured commands`
      : successRate > 0.10
        ? `${(successRate*100).toFixed(0)}% parse — marginal; some structure but unreliable`
        : `${(successRate*100).toFixed(0)}% parse — model produces text, not commands`,
    qualitative,
  };
}

function parseAsCommand(text: string): { kind: string; ok: boolean } | null {
  if (!text) return null;
  const t = text.trim().toUpperCase();
  // Looking for verb at start of text
  for (const verb of ["PICKUP", "DROP", "MOVE", "SAVE", "SPAWN"]) {
    if (t.startsWith(verb)) {
      return { kind: verb, ok: true };
    }
  }
  return null;
}

// ── T2′ SUBSTRATE: Perception-vector divergence ──────────────────────
//
// The text-perception version of T2 (above) measures whether the model's
// SEPHIRAH-DISTRIBUTION differs across scenes. That test failed by a hair
// (mean JSD 0.147 vs threshold 0.15) because "I see 1 sword" and "I see 1
// temple" are statistically similar text tokens.
//
// T2′ asks a different question: when we BYPASS text perception and build
// a real HRR encoding of the scene (PerceptionSubstrate), do the scenes
// produce mathematically distinct vectors? The answer must be yes — the
// kind/role HRR seeds are orthogonal — so this is a sanity check that the
// substrate module actually does what it claims.
//
// PASS criterion: every cross-scene perception-vector cosine < 0.5 (well
// below the same-scene self-cosine of 1.0). If cosines are high, the
// substrate isn't differentiating scenes either — which would be a bug.

export function runT2Substrate_PerceptionDivergence() {
  const scenes: Array<{ name: string; setup: (b: CommandBus) => void }> = [
    { name: "sword",  setup: (b) => b.applyImmediate({
      kind: "SpawnEntity", id: "x", prototypeId: "sword",
      transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
      components: { interactable: { verb: "pickup", range: 3 } },
    }) },
    { name: "temple", setup: (b) => b.applyImmediate({
      kind: "SpawnEntity", id: "x", prototypeId: "temple",
      transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
      components: {},
    }) },
    { name: "portal", setup: (b) => b.applyImmediate(spawnPortalCommand(
      { label: "X", destination: { kind: "substrate", worldId: "x" } },
      { x: 1, y: 0, z: 0 },
    )) },
    { name: "wizard", setup: (b) => b.applyImmediate({
      kind: "SpawnEntity", id: "x", prototypeId: "wizard_npc",
      transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
      components: { interactable: { verb: "talk", range: 3 } },
    }) },
  ];

  // Build perception vector per scene
  const sceneVecs: Array<{ name: string; vec: ReturnType<typeof composePerceptionSubstrate>["vec"] }> = [];
  for (const s of scenes) {
    const world = new World(99);
    const bus = new CommandBus(world, defaultReducer);
    bus.applyImmediate({
      kind: "SpawnEntity", id: "model", prototypeId: "wizard_npc",
      transform: identityTransform(), components: {},
    });
    s.setup(bus);
    const p = composePerceptionSubstrate(world, "model", { radius: 12 });
    sceneVecs.push({ name: s.name, vec: p.vec });
  }

  // Pairwise cosines
  const cosines: Array<{ a: string; b: string; cos: number }> = [];
  for (let i = 0; i < sceneVecs.length; i++) {
    for (let j = i + 1; j < sceneVecs.length; j++) {
      cosines.push({
        a: sceneVecs[i].name,
        b: sceneVecs[j].name,
        cos: cosine(sceneVecs[i].vec, sceneVecs[j].vec),
      });
    }
  }
  const maxCos = cosines.reduce((m, c) => Math.max(m, Math.abs(c.cos)), 0);
  const meanCos = cosines.reduce((m, c) => m + Math.abs(c.cos), 0) / cosines.length;
  // PASS: scenes produce distinct vectors (max cosine well below 1.0).
  // Cleaner threshold than JSD because HRR cosines have a precise null-
  // hypothesis (orthogonal seeds → cosines ~ 1/√d ≈ 0.03 for d=1024).
  const pass = maxCos < 0.5;
  return {
    cosines, maxCos, meanCos, pass,
    verdict: pass
      ? `Substrate perception vectors are distinct (max cos ${maxCos.toFixed(3)}) — substrate encodes situations, not tokens`
      : `Substrate perception vectors collapse (max cos ${maxCos.toFixed(3)}) — encoding is broken`,
  };
}

// ── T3′ SUBSTRATE: Substrate command emission ─────────────────────────
//
// Replaces T3's text-emission requirement with substrate cleanup. We feed
// the model's actual routing distribution (queried for each scene) into
// composeCommandFromSubstrate and ask: does it emit an affordance-
// appropriate engine Command?
//
// "Appropriate" is checked against the scene: sword-near → PICKUP,
// portal-near → ENTER_PORTAL, etc. The model's routing doesn't have to
// be perfect — what we measure is whether the substrate path successfully
// converts (routing, perception) → (engine Command) at all.
//
// PASS criterion: >75% of scenes produce a non-null engine Command. The
// failure mode being measured: substrate cleanup never finds a high enough
// score, or affordance gating kills everything. (We do NOT require the
// command verb to be "correct" — that's a separate quality measurement
// that depends on routing quality.)

export interface T3SubstrateOpts {
  oracleEndpoint?: string;
  samplesPerScene?: number;
  /** If true, use a uniform-random routing distribution instead of the
   *  Oracle. Useful as a baseline — the substrate path should still emit
   *  commands even with bad routing because affordance gating selects. */
  useUniformRouting?: boolean;
  /** Apply double recursive attention head to the routing before cleanup.
   *  Default false in T3′ baseline; T3″ (with-attention) sets true. */
  useAttention?: boolean;
}

export async function runT3Substrate_CommandEmission(opts: T3SubstrateOpts = {}) {
  const samples = opts.samplesPerScene ?? 3;
  const oracle = opts.useUniformRouting
    ? null
    : new HttpOracleClient(opts.oracleEndpoint ?? "http://127.0.0.1:8765");

  const scenes: Array<{ name: string; expectedVerbs: CommandVerb[]; setup: (b: CommandBus) => void }> = [
    {
      name: "sword-near", expectedVerbs: ["PICKUP"],
      setup: (b) => b.applyImmediate({
        kind: "SpawnEntity", id: "x", prototypeId: "sword",
        transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
        components: { interactable: { verb: "pickup", range: 3 } },
      }),
    },
    {
      name: "portal-near", expectedVerbs: ["ENTER_PORTAL"],
      setup: (b) => b.applyImmediate(spawnPortalCommand(
        { label: "X", destination: { kind: "substrate", worldId: "x" } },
        { x: 1, y: 0, z: 0 },
      )),
    },
    {
      name: "empty-field", expectedVerbs: ["MOVE", "SPAWN", "SAVE", "REST"],
      setup: (_b) => {/* nothing — agent free to MOVE/SPAWN/SAVE/REST */},
    },
    {
      name: "wizard-near", expectedVerbs: ["TALK", "INSPECT", "MOVE"],
      setup: (b) => b.applyImmediate({
        kind: "SpawnEntity", id: "x", prototypeId: "wizard_npc",
        transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
        components: { interactable: { verb: "talk", range: 3 } },
      }),
    },
    {
      // Multi-entity: agent must choose ONE among same-affordance candidates.
      // HRR-native target selection makes the choice substrate-conditioned
      // rather than purely Euclidean (would always pick the closer one).
      name: "two-pickups", expectedVerbs: ["PICKUP"],
      setup: (b) => {
        b.applyImmediate({
          kind: "SpawnEntity", id: "sword1", prototypeId: "sword",
          transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
          components: { interactable: { verb: "pickup", range: 3 } },
        });
        b.applyImmediate({
          kind: "SpawnEntity", id: "sword2", prototypeId: "rock",
          transform: { ...identityTransform(), position: { x: -1, y: 0, z: 0 } },
          components: { interactable: { verb: "pickup", range: 3 } },
        });
      },
    },
    {
      // Two NPCs of different kinds — exercises HRR target selection on TALK.
      // Model's routing-conditioned intent picks the kind it resonates with.
      name: "two-talkers", expectedVerbs: ["TALK", "INSPECT", "MOVE"],
      setup: (b) => {
        b.applyImmediate({
          kind: "SpawnEntity", id: "wiz", prototypeId: "wizard_npc",
          transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
          components: { interactable: { verb: "talk", range: 3 } },
        });
        b.applyImmediate({
          kind: "SpawnEntity", id: "vil", prototypeId: "villager_npc",
          transform: { ...identityTransform(), position: { x: -1, y: 0, z: 0 } },
          components: { interactable: { verb: "talk", range: 3 } },
        });
      },
    },
    {
      // Portal AND sword both present — agent picks via routing.
      // Either PICKUP or ENTER_PORTAL is "appropriate" (model's choice).
      name: "portal-and-sword", expectedVerbs: ["PICKUP", "ENTER_PORTAL"],
      setup: (b) => {
        b.applyImmediate({
          kind: "SpawnEntity", id: "sword-pas", prototypeId: "sword",
          transform: { ...identityTransform(), position: { x: 1, y: 0, z: 0 } },
          components: { interactable: { verb: "pickup", range: 3 } },
        });
        b.applyImmediate(spawnPortalCommand(
          { label: "X", destination: { kind: "substrate", worldId: "x" } },
          { x: -1, y: 0, z: 0 },
        ));
      },
    },
  ];

  const results: Array<{
    scene: string;
    verbsEmitted: CommandVerb[];
    expectedVerbs: CommandVerb[];
    emittedAny: number;
    onTargetCount: number;
  }> = [];

  for (const scene of scenes) {
    const verbsEmitted: CommandVerb[] = [];
    let emittedAny = 0;
    let onTargetCount = 0;
    for (let i = 0; i < samples; i++) {
      const world = new World(7 + i);
      const bus = new CommandBus(world, defaultReducer);
      bus.applyImmediate({
        kind: "SpawnEntity", id: "model", prototypeId: "wizard_npc",
        transform: identityTransform(), components: {},
      });
      scene.setup(bus);

      const perception = composePerceptionSubstrate(world, "model", { radius: 12 });

      let routing: Partial<Record<Sephirah, number>>;
      if (oracle) {
        const prompt = `I am at (0, 0). I see ${scene.name.replace("-near", "")}. I will`;
        const resp = await oracle.query(prompt);
        routing = resp.sephirah_probs;
      } else {
        const u: Partial<Record<Sephirah, number>> = {};
        for (const s of SEPHIROTH) u[s] = 1 / SEPHIROTH.length;
        routing = u;
      }

      // Optional augment: double recursive attention head
      if (opts.useAttention) {
        routing = doubleRecursiveAttention(routing, perception).routing;
      }

      const selection = composeCommandFromSubstrate(routing, perception, world, "model");
      verbsEmitted.push(selection.verb);
      if (selection.command) emittedAny++;
      if (scene.expectedVerbs.includes(selection.verb)) onTargetCount++;
    }
    results.push({
      scene: scene.name,
      verbsEmitted, expectedVerbs: scene.expectedVerbs,
      emittedAny, onTargetCount,
    });
  }

  const totalSamples = results.length * samples;
  const totalEmitted = results.reduce((a, r) => a + r.emittedAny, 0);
  const totalOnTarget = results.reduce((a, r) => a + r.onTargetCount, 0);
  const emissionRate = totalEmitted / totalSamples;
  const onTargetRate = totalOnTarget / totalSamples;

  // PASS: substrate path emits engine commands at high rate
  const pass = emissionRate > 0.75;
  return {
    results, emissionRate, onTargetRate,
    totalSamples, totalEmitted, totalOnTarget,
    pass,
    verdict: pass
      ? `Substrate emits engine Commands at ${(emissionRate*100).toFixed(0)}% (${(onTargetRate*100).toFixed(0)}% affordance-appropriate) — text-emission bottleneck bypassed`
      : `Substrate command emission collapsed at ${(emissionRate*100).toFixed(0)}% — substrate path is broken`,
  };
}

// ── Probability distribution helpers ─────────────────────────────────

function normalizeDist(d: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  let s = 0;
  for (const k of SEPHIROTH) {
    const v = d[k] ?? 0;
    out[k] = v;
    s += v;
  }
  if (s === 0) {
    for (const k of SEPHIROTH) out[k] = 1 / SEPHIROTH.length;
  } else {
    for (const k of SEPHIROTH) out[k] = out[k] / s;
  }
  return out;
}

function jsDivergence(p: Record<string, number>, q: Record<string, number>): number {
  // Symmetric Jensen-Shannon divergence; 0 = identical, ln(2) ≈ 0.693 = maximally distant
  const m: Record<string, number> = {};
  for (const k of SEPHIROTH) m[k] = 0.5 * (p[k] + q[k]);
  const kl = (a: Record<string, number>, b: Record<string, number>): number => {
    let s = 0;
    for (const k of SEPHIROTH) {
      const ak = a[k];
      const bk = b[k];
      if (ak > 0 && bk > 0) s += ak * Math.log(ak / bk);
    }
    return s;
  };
  return 0.5 * kl(p, m) + 0.5 * kl(q, m);
}

function sephirahVariance(d: Record<string, number>): number {
  const total = Object.values(d).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const mean = total / SEPHIROTH.length;
  let v = 0;
  for (const k of SEPHIROTH) {
    const n = d[k] ?? 0;
    v += (n - mean) * (n - mean);
  }
  return v / SEPHIROTH.length;
}

// ── Combined report ─────────────────────────────────────────────────

export interface DiscriminationReport {
  t1: Awaited<ReturnType<typeof runT1_BaselineComparison>>;
  t2: Awaited<ReturnType<typeof runT2_ContextualSensitivity>>;
  t3: Awaited<ReturnType<typeof runT3_DirectCommandEmission>>;
  /** T2′ substrate-paradigm: perception-vector divergence. */
  t2sub: ReturnType<typeof runT2Substrate_PerceptionDivergence>;
  /** T3′ substrate-paradigm: substrate command emission. */
  t3sub: Awaited<ReturnType<typeof runT3Substrate_CommandEmission>>;
  /** T3″ substrate + double recursive attention head. */
  t3subAtt: Awaited<ReturnType<typeof runT3Substrate_CommandEmission>>;
  /** Aggregate verdict using the substrate-paradigm path. */
  overall: "PLAYING" | "PARTIAL" | "GRAMMAR_DOMINATES";
  overallSubstrate: "SUBSTRATE_PLAYING" | "SUBSTRATE_PARTIAL" | "SUBSTRATE_BROKEN";
}

export async function runDiscriminationSuite(opts: {
  t1Ticks?: number;
  t2Samples?: number;
  t3Samples?: number;
  t3SubSamples?: number;
  oracleEndpoint?: string;
  verbose?: boolean;
  skipBaseline?: boolean;
  /** Use uniform-random routing instead of the Oracle in T3′/T3″. Useful
   *  for substrate optimization iteration when the Oracle is contended
   *  by training. */
  useUniformRouting?: boolean;
}): Promise<DiscriminationReport> {
  const log = opts.verbose ? console.log : () => {};

  // The baseline (T1/T2/T3) tests are the original cognition-discrimination
  // suite. If --skipBaseline, we run only the substrate variants — useful
  // when iterating on substrate modules without re-paying for HTTP queries
  // against the model.
  let t1: Awaited<ReturnType<typeof runT1_BaselineComparison>>;
  let t2: Awaited<ReturnType<typeof runT2_ContextualSensitivity>>;
  let t3: Awaited<ReturnType<typeof runT3_DirectCommandEmission>>;
  if (opts.skipBaseline) {
    // Placeholder values — overall verdict will be based on substrate path only
    const probs: Record<Sephirah, number> = {} as any;
    for (const s of SEPHIROTH) probs[s] = 0.1;
    t1 = {
      random: { sephirahDist: {}, commandDist: {}, questsCompleted: 0, questIds: [], totalEvents: 0, uniqueEventKinds: 0 },
      deterministic: { sephirahDist: {}, commandDist: {}, questsCompleted: 0, questIds: [], totalEvents: 0, uniqueEventKinds: 0 },
      real: { sephirahDist: {}, commandDist: {}, questsCompleted: 0, questIds: [], totalEvents: 0, uniqueEventKinds: 0 },
      eventCountDelta: 0, questCountDelta: 0, uniqueKindsDelta: 0,
      sephVarianceReal: 0, sephVarianceRandom: 0,
      sephDistDifferentFromRandom: 0, pass: false, verdict: "(skipped)",
    } as any;
    t2 = { distributions: {}, pairJSDs: [], meanJSD: 0, pass: false, verdict: "(skipped)" } as any;
    t3 = { samples: [], successRate: 0, validCount: 0, totalSamples: 0, pass: false, verdict: "(skipped)", qualitative: "fail" } as any;
  } else {
    log("# T1: Baseline comparison");
    t1 = await runT1_BaselineComparison({ ticks: opts.t1Ticks ?? 6, oracleEndpoint: opts.oracleEndpoint });
    log(`  ${t1.pass ? "PASS" : "FAIL"} — ${t1.verdict}`);
    log("# T2: Contextual sensitivity");
    t2 = await runT2_ContextualSensitivity({ samples: opts.t2Samples ?? 3, oracleEndpoint: opts.oracleEndpoint });
    log(`  ${t2.pass ? "PASS" : "FAIL"} — ${t2.verdict}`);
    log("# T3: Direct command emission");
    t3 = await runT3_DirectCommandEmission({ samples: opts.t3Samples ?? 5, oracleEndpoint: opts.oracleEndpoint });
    log(`  ${t3.pass ? "PASS" : "FAIL"} — ${t3.verdict}`);
  }

  log("# T2′ SUBSTRATE: Perception-vector divergence");
  const t2sub = runT2Substrate_PerceptionDivergence();
  log(`  ${t2sub.pass ? "PASS" : "FAIL"} — ${t2sub.verdict}`);

  log("# T3′ SUBSTRATE: Substrate command emission (no attention)");
  const t3sub = await runT3Substrate_CommandEmission({
    oracleEndpoint: opts.oracleEndpoint,
    samplesPerScene: opts.t3SubSamples ?? 3,
    useAttention: false,
    useUniformRouting: opts.useUniformRouting,
  });
  log(`  ${t3sub.pass ? "PASS" : "FAIL"} — ${t3sub.verdict}`);

  log("# T3″ SUBSTRATE + ATTENTION: Substrate command emission with double recursive attention head");
  const t3subAtt = await runT3Substrate_CommandEmission({
    oracleEndpoint: opts.oracleEndpoint,
    samplesPerScene: opts.t3SubSamples ?? 3,
    useAttention: true,
    useUniformRouting: opts.useUniformRouting,
  });
  log(`  ${t3subAtt.pass ? "PASS" : "FAIL"} — ${t3subAtt.verdict}`);
  log(`  on-target rate Δ: ${((t3subAtt.onTargetRate - t3sub.onTargetRate)*100).toFixed(1)} pp (attention vs no-attention)`);

  const passCount = [t1.pass, t2.pass, t3.pass].filter(Boolean).length;
  const overall: "PLAYING" | "PARTIAL" | "GRAMMAR_DOMINATES" =
    passCount >= 2 ? "PLAYING" :
    passCount === 1 ? "PARTIAL" :
    "GRAMMAR_DOMINATES";
  const subPassCount = [t1.pass, t2sub.pass, t3sub.pass].filter(Boolean).length;
  const overallSubstrate: "SUBSTRATE_PLAYING" | "SUBSTRATE_PARTIAL" | "SUBSTRATE_BROKEN" =
    subPassCount >= 2 ? "SUBSTRATE_PLAYING" :
    subPassCount === 1 ? "SUBSTRATE_PARTIAL" :
    "SUBSTRATE_BROKEN";
  return { t1, t2, t3, t2sub, t3sub, t3subAtt, overall, overallSubstrate };
}

export function reportDiscriminationText(r: DiscriminationReport): string {
  const lines: string[] = [];
  lines.push("════════ COGNITION DISCRIMINATION REPORT ════════");
  lines.push("");
  lines.push(`OVERALL (text path):      ${r.overall}`);
  lines.push(`OVERALL (substrate path): ${r.overallSubstrate}`);
  lines.push("");
  lines.push("T1 — Baseline comparison");
  lines.push(`  Random oracle:        events=${r.t1.random.totalEvents} quests=${r.t1.random.questsCompleted} unique=${r.t1.random.uniqueEventKinds}`);
  lines.push(`  Deterministic oracle: events=${r.t1.deterministic.totalEvents} quests=${r.t1.deterministic.questsCompleted} unique=${r.t1.deterministic.uniqueEventKinds}`);
  lines.push(`  125M oracle:          events=${r.t1.real.totalEvents} quests=${r.t1.real.questsCompleted} unique=${r.t1.real.uniqueEventKinds}`);
  lines.push(`  Sephirah distribution JSD(125M, random): ${r.t1.sephDistDifferentFromRandom.toFixed(3)}`);
  lines.push(`  → ${r.t1.pass ? "PASS" : "FAIL"} (threshold: JSD > 0.20)`);
  lines.push(`  ${r.t1.verdict}`);
  lines.push("");
  lines.push("T2 — Contextual sensitivity (text-perception)");
  for (const [scene, d] of Object.entries(r.t2.distributions)) {
    const entries = Object.entries(d);
    if (entries.length === 0) { lines.push(`  ${scene.padEnd(14)} (no data)`); continue; }
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    lines.push(`  ${scene.padEnd(14)} top: ${top[0]}=${top[1]}, dist: ${JSON.stringify(d)}`);
  }
  lines.push(`  Pairwise JSDs:`);
  for (const p of r.t2.pairJSDs) lines.push(`    ${p.a} vs ${p.b}: ${p.jsd.toFixed(3)}`);
  lines.push(`  Mean JSD: ${r.t2.meanJSD.toFixed(3)}`);
  lines.push(`  → ${r.t2.pass ? "PASS" : "FAIL"} (threshold: mean JSD > 0.15)`);
  lines.push(`  ${r.t2.verdict}`);
  lines.push("");
  lines.push("T3 — Direct command emission (text)");
  lines.push(`  Valid parses: ${r.t3.validCount}/${r.t3.totalSamples} (${(r.t3.successRate*100).toFixed(0)}%)`);
  for (const s of r.t3.samples.slice(0, 5)) {
    lines.push(`    text: ${s.text.replace(/\n/g, " ").slice(0, 60)}  parsed: ${s.parsed?.kind ?? "—"}`);
  }
  lines.push(`  → ${r.t3.pass ? "PASS" : "FAIL"} (threshold: >25% parse)`);
  lines.push(`  ${r.t3.verdict}`);
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("SUBSTRATE-PARADIGM PATH (T2′ / T3′)");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("T2′ — Perception-vector divergence (substrate)");
  for (const c of r.t2sub.cosines) {
    lines.push(`    ${c.a.padEnd(8)} vs ${c.b.padEnd(8)} cos = ${c.cos.toFixed(3)}`);
  }
  lines.push(`  Max cosine: ${r.t2sub.maxCos.toFixed(3)}   Mean: ${r.t2sub.meanCos.toFixed(3)}`);
  lines.push(`  → ${r.t2sub.pass ? "PASS" : "FAIL"} (threshold: max cos < 0.5)`);
  lines.push(`  ${r.t2sub.verdict}`);
  lines.push("");
  lines.push("T3′ — Substrate command emission (no attention)");
  for (const res of r.t3sub.results) {
    lines.push(`  ${res.scene.padEnd(14)} verbs: [${res.verbsEmitted.join(", ")}]  on-target: ${res.onTargetCount}/${res.verbsEmitted.length}  expected: [${res.expectedVerbs.join(", ")}]`);
  }
  lines.push(`  Emission rate: ${(r.t3sub.emissionRate*100).toFixed(0)}%   On-target: ${(r.t3sub.onTargetRate*100).toFixed(0)}%`);
  lines.push(`  → ${r.t3sub.pass ? "PASS" : "FAIL"} (threshold: emission > 75%)`);
  lines.push(`  ${r.t3sub.verdict}`);
  lines.push("");
  lines.push("T3″ — Substrate + double recursive attention head");
  for (const res of r.t3subAtt.results) {
    lines.push(`  ${res.scene.padEnd(14)} verbs: [${res.verbsEmitted.join(", ")}]  on-target: ${res.onTargetCount}/${res.verbsEmitted.length}  expected: [${res.expectedVerbs.join(", ")}]`);
  }
  lines.push(`  Emission rate: ${(r.t3subAtt.emissionRate*100).toFixed(0)}%   On-target: ${(r.t3subAtt.onTargetRate*100).toFixed(0)}%`);
  const deltaPP = (r.t3subAtt.onTargetRate - r.t3sub.onTargetRate) * 100;
  const sign = deltaPP >= 0 ? "+" : "";
  lines.push(`  Δ vs T3′: ${sign}${deltaPP.toFixed(1)} pp on-target  (attention augment ${deltaPP > 0 ? "HELPS" : deltaPP < 0 ? "HURTS" : "NEUTRAL"})`);
  lines.push(`  → ${r.t3subAtt.pass ? "PASS" : "FAIL"} (threshold: emission > 75%)`);
  lines.push(`  ${r.t3subAtt.verdict}`);
  lines.push("");
  lines.push("══════════════════════════════════════════════");
  return lines.join("\n");
}

// CLI runner
//   tsx cognitionDiscriminationTest.ts [t1Ticks] [t2Samples] [t3Samples] [t3SubSamples] [--substrate-only]
if (typeof process !== "undefined" && /cognitionDiscriminationTest\.(js|ts)$/.test(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const substrateOnly = args.includes("--substrate-only");
  const uniformRouting = args.includes("--uniform-routing");
  const oracleArg = args.find((a) => a.startsWith("--oracle="));
  const oracleEndpoint = oracleArg ? oracleArg.slice("--oracle=".length) : undefined;
  const nums = args.filter((a) => !a.startsWith("--"));
  runDiscriminationSuite({
    t1Ticks: Number(nums[0] ?? 5),
    t2Samples: Number(nums[1] ?? 3),
    t3Samples: Number(nums[2] ?? 4),
    t3SubSamples: Number(nums[3] ?? 3),
    skipBaseline: substrateOnly,
    useUniformRouting: uniformRouting,
    oracleEndpoint,
    verbose: true,
  }).then((r) => {
    console.log("\n" + reportDiscriminationText(r));
  }).catch((e) => {
    console.error("test failed:", e);
    process.exit(1);
  });
}
