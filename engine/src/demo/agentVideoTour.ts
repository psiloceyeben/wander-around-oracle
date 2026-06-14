// Scripted scene tour — showcases the substrate agent's full vocabulary by
// putting it through curated scenes. Each scene exercises a different verb
// of the dictionary. The user sees a guided demo of:
//
//   Scene 1: Empty field — agent rests / spawns / saves (interior-driven)
//   Scene 2: Sword nearby — agent PICKS UP via HRR target selection
//   Scene 3: Holding sword + wizard — agent GIVES via HRR target sel
//   Scene 4: Doorway nearby — agent ENTERs the PORTAL (after attention boost)
//   Scene 5: Use-affordant object — agent USES it
//   Scene 6: NPC nearby — agent TALKs
//   Scene 7: Two NPCs — agent picks one via HRR cleanup (model bias decides)
//   Scene 8: Two pickups — same, HRR target selection visible
//
// Each scene runs 3 ticks with mild routing bias toward the verb's natural
// Sephirah. The HTML player shows the agent's decision per tick, the
// scene context, and the per-verb scores from cleanup.

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { AgentSystem } from "../agent/index.js";
import { identityTransform } from "../entity/index.js";
import { AsciiProjection } from "../projection/index.js";
import { composePerceptionSubstrate } from "../features/perceptionSubstrate/index.js";
import { composeCommandFromSubstrate } from "../features/commandSubstrate/index.js";
import { doubleRecursiveAttention } from "../features/agentPlayer/index.js";
import { spawnPortalCommand } from "../features/portals/index.js";
import { SEPHIROTH, type Sephirah } from "../hrr/treeOfLife.js";
import { writeFileSync } from "node:fs";

interface TourFrame {
  scene: string;
  sceneDescription: string;
  tick: number;
  ascii: string;
  visibleKinds: Record<string, number>;
  routingRaw: Record<string, number>;
  routingRefined: Record<string, number>;
  topSephirahRaw: { sephirah: string; value: number };
  topSephirahRefined: { sephirah: string; value: number };
  rankedVerbs: Array<{ verb: string; score: number; affordable: boolean; cos: number; affinity: number }>;
  verb: string;
  commandKind: string | null;
  targetId: string | null;
  holdingId: string | null;
}

function biasRouting(dominant: Sephirah[], jitter: () => number, peak: number = 0.5): Record<string, number> {
  const out: Record<string, number> = {};
  const others = SEPHIROTH.filter((s) => !dominant.includes(s));
  const eachDom = peak / dominant.length;
  const eachOther = (1 - peak) / others.length;
  for (const s of SEPHIROTH) {
    const base = dominant.includes(s) ? eachDom : eachOther;
    // Small jitter so each tick of the same scene varies slightly
    out[s] = Math.max(0, base + (jitter() - 0.5) * 0.05);
  }
  // Re-normalize
  let sum = 0;
  for (const s of SEPHIROTH) sum += out[s];
  if (sum > 0) for (const s of SEPHIROTH) out[s] /= sum;
  return out;
}

function topOf(d: Record<string, number>): { sephirah: string; value: number } {
  let bestKey = ""; let bestVal = -Infinity;
  for (const [k, v] of Object.entries(d)) if (v > bestVal) { bestKey = k; bestVal = v; }
  return { sephirah: bestKey, value: bestVal };
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SceneSpec {
  name: string;
  description: string;
  /** Sephirot the model would route to for this scene (mild bias). */
  routingBias: Sephirah[];
  /** Build the scene in the world. */
  setup: (bus: CommandBus) => void;
  /** Optional: state to put on the agent before the scene runs. */
  preState?: (bus: CommandBus) => void;
  /** How many ticks to capture for this scene. */
  ticks?: number;
}

const SCENES: SceneSpec[] = [
  {
    name: "1 · empty field",
    description: "Nothing visible. Agent's decision is purely interior — REST / SPAWN / SAVE / MOVE.",
    routingBias: ["binah", "keter", "yesod"],
    setup: () => {/* nothing */},
    ticks: 3,
  },
  {
    name: "2 · sword nearby",
    description: "A pickup-affordant sword in perception. Scene-affordance attention boosts malkuth → PICKUP wins.",
    routingBias: ["binah", "chesed"],  // model routes contemplative, attention overrides
    setup: (b) => b.applyImmediate({
      kind: "SpawnEntity", id: "sword-2", prototypeId: "sword",
      transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
      components: { interactable: { verb: "pickup", range: 3 } },
    }),
    ticks: 3,
  },
  {
    name: "3 · holding sword + wizard",
    description: "Agent holds the sword and a talk-affordant wizard is near. Substrate considers GIVE (drop near talker).",
    routingBias: ["chesed", "tiferet"],
    setup: (b) => b.applyImmediate({
      kind: "SpawnEntity", id: "wiz-3", prototypeId: "wizard_npc",
      transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
      components: { interactable: { verb: "talk", range: 3 } },
    }),
    preState: (b) => {
      // Spawn the sword and force-pick-up so agent is holding it
      b.applyImmediate({
        kind: "SpawnEntity", id: "sword-3", prototypeId: "sword",
        transform: { ...identityTransform(), position: { x: 0, y: 0, z: 0 } },
        components: { interactable: { verb: "pickup", range: 3 } },
      });
      b.applyImmediate({ kind: "PickupEntity", targetId: "sword-3", holderId: "agent" });
    },
    ticks: 3,
  },
  {
    name: "4 · doorway nearby",
    description: "A use-affordant doorway in perception. Attention boosts yesod+keter → ENTER_PORTAL wins (despite USE sharing the affordance).",
    routingBias: ["chesed", "binah"],  // model routes wrong, attention corrects
    setup: (b) => b.applyImmediate(spawnPortalCommand(
      { label: "library", destination: { kind: "substrate", worldId: "lib" } },
      { x: 2, y: 0, z: 0 },
    )),
    ticks: 3,
  },
  {
    name: "5 · NPC nearby",
    description: "A talk-affordant NPC. Attention boosts chesed/binah/tiferet → TALK wins.",
    routingBias: ["geburah", "hod"],  // model routes wrong, attention corrects
    setup: (b) => b.applyImmediate({
      kind: "SpawnEntity", id: "vil-5", prototypeId: "wizard_npc",
      transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
      components: { interactable: { verb: "talk", range: 3 } },
    }),
    ticks: 3,
  },
  {
    name: "6 · two same-affordance pickups",
    description: "A sword and a rock — both pickup-affordant. HRR-native target selection picks ONE based on intent resonance.",
    routingBias: ["malkuth"],
    setup: (b) => {
      b.applyImmediate({
        kind: "SpawnEntity", id: "sword-6", prototypeId: "sword",
        transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
        components: { interactable: { verb: "pickup", range: 3 } },
      });
      b.applyImmediate({
        kind: "SpawnEntity", id: "rock-6", prototypeId: "rock",
        transform: { ...identityTransform(), position: { x: -2, y: 0, z: 0 } },
        components: { interactable: { verb: "pickup", range: 3 } },
      });
    },
    ticks: 3,
  },
  {
    name: "7 · two talkers",
    description: "A wizard and a villager — both talk-affordant. HRR target selection picks one.",
    routingBias: ["chesed"],
    setup: (b) => {
      b.applyImmediate({
        kind: "SpawnEntity", id: "wiz-7", prototypeId: "wizard_npc",
        transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
        components: { interactable: { verb: "talk", range: 3 } },
      });
      b.applyImmediate({
        kind: "SpawnEntity", id: "vil-7", prototypeId: "guard_npc",
        transform: { ...identityTransform(), position: { x: -2, y: 0, z: 0 } },
        components: { interactable: { verb: "talk", range: 3 } },
      });
    },
    ticks: 3,
  },
  {
    name: "8 · portal AND sword",
    description: "Both affordances present. Routing bias decides — model leans malkuth, picks PICKUP over ENTER_PORTAL.",
    routingBias: ["malkuth"],
    setup: (b) => {
      b.applyImmediate({
        kind: "SpawnEntity", id: "sword-8", prototypeId: "sword",
        transform: { ...identityTransform(), position: { x: 2, y: 0, z: 0 } },
        components: { interactable: { verb: "pickup", range: 3 } },
      });
      b.applyImmediate(spawnPortalCommand(
        { label: "X", destination: { kind: "substrate", worldId: "x" } },
        { x: -2, y: 0, z: 0 },
      ));
    },
    ticks: 3,
  },
];

export function captureScriptedTour(opts: {
  outputPath?: string;
  width?: number;
  height?: number;
}): { frames: TourFrame[]; htmlPath: string; jsonPath: string } {
  const outputPath = opts.outputPath ?? "/tmp/agent_tour.html";
  const jsonPath = outputPath.replace(/\.html$/, ".json");
  const jitter = makeRng(123);

  const frames: TourFrame[] = [];

  for (const scene of SCENES) {
    const world = new World(42);
    const bus = new CommandBus(world, defaultReducer);
    const agents = new AgentSystem();
    const proj = new AsciiProjection({ width: opts.width ?? 24, height: opts.height ?? 10 });
    proj.init(world);
    bus.events.on("*", (e) => proj.onEvent(e));

    bus.applyImmediate({
      kind: "SpawnEntity", id: "agent", prototypeId: "player",
      transform: identityTransform(), components: {},
    });
    agents.register({ id: "agent", agency: "human", perceptionRadius: 12 });

    if (scene.preState) scene.preState(bus);
    scene.setup(bus);

    const ticks = scene.ticks ?? 3;
    for (let i = 0; i < ticks; i++) {
      agents.refreshPerception(world, "agent", i);
      const me = world.getEntity("agent")!;
      proj.setFocus(me.transform.position);

      const perception = composePerceptionSubstrate(world, "agent", {
        radius: 12, includeHolding: true,
      });
      const routingRaw = biasRouting(scene.routingBias, jitter, 0.5);
      const att = doubleRecursiveAttention(routingRaw as Partial<Record<Sephirah, number>>, perception);
      const selection = composeCommandFromSubstrate(
        att.routing as Partial<Record<Sephirah, number>>,
        perception, world, "agent",
      );

      const ascii = proj.renderToString();
      const visibleKinds: Record<string, number> = {};
      for (const [k, v] of perception.visibleByKind) visibleKinds[k] = v;

      const targetId = (() => {
        const cmd = selection.command;
        if (!cmd) return null;
        if (cmd.kind === "PickupEntity") return cmd.targetId;
        if (cmd.kind === "DropEntity") return cmd.targetId;
        if (cmd.kind === "EnterPortal") return cmd.portalId;
        if (cmd.kind === "EditComponents") return cmd.id;
        return null;
      })();

      frames.push({
        scene: scene.name,
        sceneDescription: scene.description,
        tick: i,
        ascii,
        visibleKinds,
        routingRaw,
        routingRefined: att.routing,
        topSephirahRaw: topOf(routingRaw),
        topSephirahRefined: topOf(att.routing),
        rankedVerbs: selection.ranked.slice(0, 6).map((r) => ({
          verb: r.verb, score: r.score, affordable: r.affordable,
          cos: r.cos, affinity: r.affinity,
        })),
        verb: selection.verb,
        commandKind: selection.command?.kind ?? null,
        targetId,
        holdingId: perception.holdingEntityId,
      });

      // Apply so subsequent ticks see post-action state
      if (selection.command) bus.applyImmediate(selection.command);
    }
  }

  writeFileSync(jsonPath, JSON.stringify({ frames, scenes: SCENES.map((s) => s.name) }, null, 2));
  const html = renderTourHtml(frames);
  writeFileSync(outputPath, html);
  console.log(`# Tour HTML: ${outputPath}`);
  console.log(`# Tour JSON: ${jsonPath}`);
  return { frames, htmlPath: outputPath, jsonPath };
}

function renderTourHtml(frames: TourFrame[]): string {
  const framesJson = JSON.stringify(frames);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Substrate Agent — Scripted Tour</title>
<style>
:root { color-scheme: dark; }
body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: #0d1117; color: #c9d1d9; margin: 0; padding: 16px; }
h1 { font-size: 18px; margin: 0 0 4px; color: #58a6ff; }
.meta { font-size: 12px; color: #8b949e; margin-bottom: 16px; }
.scene-banner { background: #1f6feb22; border: 1px solid #1f6feb; padding: 10px 14px;
  border-radius: 6px; margin-bottom: 12px; }
.scene-banner h2 { margin: 0 0 4px; font-size: 14px; color: #58a6ff; }
.scene-banner p { margin: 0; font-size: 12px; color: #8b949e; line-height: 1.5; }
.layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.frame { background: #161b22; border: 1px solid #30363d; padding: 12px; border-radius: 6px; }
.frame h3 { font-size: 11px; margin: 0 0 8px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; font-weight: normal; }
pre { margin: 0; line-height: 1.0; font-size: 18px; color: #e6edf3; }
.controls { display: flex; gap: 8px; margin: 12px 0; align-items: center; flex-wrap: wrap; }
button { background: #21262d; border: 1px solid #30363d; color: #c9d1d9;
  padding: 6px 12px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px; }
button:hover { background: #30363d; }
button.primary { background: #238636; border-color: #2ea043; }
button.primary:hover { background: #2ea043; }
input[type=range] { flex: 1; min-width: 200px; }
.verb { display: inline-block; padding: 3px 10px; border-radius: 12px; font-weight: bold; }
.verb.pickup { background: #ff7b7222; color: #ff7b72; }
.verb.move { background: #d2a8ff22; color: #d2a8ff; }
.verb.rest { background: #a371f722; color: #a371f7; }
.verb.enter_portal { background: #ffa65722; color: #ffa657; }
.verb.talk { background: #7ee78722; color: #7ee787; }
.verb.give { background: #56d36422; color: #56d364; }
.verb.spawn { background: #f0883e22; color: #f0883e; }
.verb.save { background: #79c0ff22; color: #79c0ff; }
.verb.inspect, .verb.use { background: #d2a8ff22; color: #d2a8ff; }
.verb.drop { background: #ff7b7222; color: #ff7b72; }
.bar { display: inline-block; height: 8px; background: #1f6feb; vertical-align: middle;
  margin-right: 4px; border-radius: 2px; }
.bar.refined { background: #2ea043; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
td { padding: 3px 4px; }
td.k { color: #c9d1d9; }
td.v { color: #e6edf3; text-align: right; font-variant-numeric: tabular-nums; }
.kind-pill { display: inline-block; padding: 1px 6px; margin: 2px; border-radius: 8px;
  background: #21262d; border: 1px solid #30363d; font-size: 11px; color: #8b949e; }
.target { color: #ffa657; font-weight: bold; }
.tick-num { color: #58a6ff; font-weight: bold; }
.legend { font-size: 11px; color: #8b949e; margin-top: 8px; }
.legend span { margin-right: 12px; }
</style>
</head>
<body>
<h1>Substrate Agent — Scripted Tour</h1>
<div class="meta">
  ${frames.length} frames across 8 scenes · routing: mild Sephirah bias per scene + jitter ·
  cognition: PerceptionSubstrate → routing → double-recursive attention → CommandSubstrate cleanup → HRR target selection
</div>
<div id="banner" class="scene-banner"></div>
<div class="controls">
  <button id="playBtn" class="primary">▶ Play</button>
  <button id="prevBtn">◀ Prev</button>
  <button id="nextBtn">Next ▶</button>
  <input id="scrub" type="range" min="0" max="${frames.length - 1}" value="0">
  <span><span class="tick-num">frame <span id="frameNum">0</span></span> / ${frames.length - 1}</span>
  <select id="speed">
    <option value="2500">slow (2.5s)</option>
    <option value="1500" selected>medium (1.5s)</option>
    <option value="800">fast (0.8s)</option>
  </select>
</div>
<div class="layout">
  <div class="frame">
    <h3>World — centered on agent</h3>
    <pre id="ascii"></pre>
    <div class="legend">
      <span>@ agent</span><span>/ sword</span><span>* rock</span>
      <span>w wizard</span><span>g villager</span><span>O doorway</span>
    </div>
    <div style="margin-top: 12px;">
      <strong>Visible:</strong> <span id="visible"></span>
    </div>
    <div style="margin-top: 6px;">
      <strong>Holding:</strong> <span id="holding"></span>
    </div>
  </div>
  <div class="frame">
    <h3>Agent's decision this tick</h3>
    <div style="font-size: 16px; margin-bottom: 12px;">
      Verb: <span id="verb" class="verb">—</span>
      <span id="targetDisplay" style="margin-left: 12px;"></span>
    </div>
    <div style="font-size: 12px; margin-bottom: 8px;">
      Routing top: <span id="routingTop"></span>
    </div>
    <h3 style="margin-top: 12px;">Routing distribution (raw → refined by attention)</h3>
    <div id="routingBars"></div>
    <h3 style="margin-top: 12px;">Verb scores (top 6)</h3>
    <table id="verbTable"></table>
  </div>
</div>
<script>
const frames = ${framesJson};
let cur = 0;
let timer = null;

function render(i) {
  const f = frames[i];
  document.getElementById('frameNum').textContent = i;
  document.getElementById('banner').innerHTML =
    '<h2>' + f.scene + '</h2><p>' + f.sceneDescription + '</p>';
  document.getElementById('ascii').textContent = f.ascii;
  const verbEl = document.getElementById('verb');
  verbEl.textContent = f.verb;
  verbEl.className = 'verb ' + f.verb.toLowerCase();
  document.getElementById('targetDisplay').innerHTML = f.targetId
    ? '→ <span class="target">' + f.targetId + '</span>'
    : '';
  document.getElementById('routingTop').textContent =
    f.topSephirahRaw.sephirah + ' (' + f.topSephirahRaw.value.toFixed(3) + ') → ' +
    f.topSephirahRefined.sephirah + ' (' + f.topSephirahRefined.value.toFixed(3) + ')';
  const vis = Object.entries(f.visibleKinds)
    .map(([k, n]) => '<span class="kind-pill">' + k + (n > 1 ? ' ×' + n : '') + '</span>')
    .join('');
  document.getElementById('visible').innerHTML = vis || '<span style="color:#8b949e">(nothing)</span>';
  document.getElementById('holding').innerHTML = f.holdingId
    ? '<span class="target">' + f.holdingId + '</span>'
    : '<span style="color:#8b949e">(nothing)</span>';

  const allSephs = Array.from(new Set([...Object.keys(f.routingRaw), ...Object.keys(f.routingRefined)]));
  allSephs.sort((a, b) => (f.routingRefined[b] || 0) - (f.routingRefined[a] || 0));
  const bars = allSephs.map(s => {
    const raw = f.routingRaw[s] || 0;
    const ref = f.routingRefined[s] || 0;
    return '<div style="margin-bottom:2px;font-size:11px;">' +
      '<span style="display:inline-block;width:80px;color:#8b949e">' + s + '</span>' +
      '<span class="bar" style="width:' + Math.round(raw*300) + 'px;opacity:0.5"></span>' +
      '<span class="bar refined" style="width:' + Math.round(ref*300) + 'px"></span>' +
      ' <span style="font-size:10px;color:#8b949e">' + raw.toFixed(2) + '→' + ref.toFixed(2) + '</span>' +
      '</div>';
  }).join('');
  document.getElementById('routingBars').innerHTML = bars;

  const rows = f.rankedVerbs.map((r, idx) =>
    '<tr style="' + (idx === 0 ? 'background:#1f6feb22' : '') + '">' +
    '<td class="k">' + r.verb + (r.affordable ? '' : ' <span style="color:#f85149" title="not affordable">·</span>') + '</td>' +
    '<td class="v">' + r.score.toFixed(3) + '</td>' +
    '<td class="v" style="color:#8b949e">cos ' + r.cos.toFixed(2) + '</td>' +
    '<td class="v" style="color:#8b949e">aff ' + r.affinity.toFixed(2) + '</td>' +
    '</tr>'
  ).join('');
  document.getElementById('verbTable').innerHTML = rows;

  document.getElementById('scrub').value = i;
}

function play() {
  if (timer) return;
  document.getElementById('playBtn').textContent = '⏸ Pause';
  const speed = parseInt(document.getElementById('speed').value);
  timer = setInterval(() => {
    if (cur >= frames.length - 1) { pause(); return; }
    cur++;
    render(cur);
  }, speed);
}
function pause() { if (timer) clearInterval(timer); timer = null; document.getElementById('playBtn').textContent = '▶ Play'; }

document.getElementById('playBtn').onclick = () => timer ? pause() : play();
document.getElementById('prevBtn').onclick = () => { pause(); cur = Math.max(0, cur - 1); render(cur); };
document.getElementById('nextBtn').onclick = () => { pause(); cur = Math.min(frames.length - 1, cur + 1); render(cur); };
document.getElementById('scrub').oninput = e => { pause(); cur = parseInt(e.target.value); render(cur); };
document.getElementById('speed').onchange = () => { if (timer) { pause(); play(); } };
render(0);
</script>
</body>
</html>`;
}

if (typeof process !== "undefined" && /agentVideoTour\.(js|ts)$/.test(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith("--out="));
  const outputPath = outArg ? outArg.slice("--out=".length) : "/tmp/agent_tour.html";
  const r = captureScriptedTour({ outputPath });
  console.log(`\n✓ Captured ${r.frames.length} tour frames.`);
}
