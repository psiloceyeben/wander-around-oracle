// Agent video capture — record substrate-agent play as a self-contained HTML video.
//
// Runs the substrate-paradigm agent (PerceptionSubstrate + CommandSubstrate +
// double recursive attention head + HRR target selection) for N ticks in a
// rich world. Captures per tick:
//   - ASCII frame (AsciiProjection of the world centered on the agent)
//   - Selected verb + target
//   - Routing distribution (raw model + attention-refined)
//   - Top-3 verb scores from substrate cleanup
//   - Agent reasoning trace (intent, perception summary)
//
// Emits a single .html file with embedded JS that plays back the frames as
// an animated video — pause, scrub, speed control. Opens in any browser.
// Zero deps. Self-contained. Save and share.

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { AgentSystem } from "../agent/index.js";
import { identityTransform } from "../entity/index.js";
import { AsciiProjection } from "../projection/index.js";
import { HttpOracleClient, composePerceptionPrompt } from "../features/agentPlayer/index.js";
import { composePerceptionSubstrate } from "../features/perceptionSubstrate/index.js";
import { composeCommandFromSubstrate } from "../features/commandSubstrate/index.js";
import { doubleRecursiveAttention } from "../features/agentPlayer/index.js";
import { spawnPortalCommand } from "../features/portals/index.js";
import { SEPHIROTH, type Sephirah } from "../hrr/treeOfLife.js";
import { writeFileSync } from "node:fs";

interface Frame {
  tick: number;
  ascii: string;
  perceptionPrompt: string;
  visibleKinds: Record<string, number>;
  routingRaw: Record<string, number>;
  routingRefined: Record<string, number>;
  topSephirah: { sephirah: string; raw: number; refined: number };
  oracleText: string;
  rankedVerbs: Array<{ verb: string; score: number; affordable: boolean }>;
  verb: string;
  commandKind: string | null;
  targetId: string | null;
  agentPos: { x: number; z: number };
  holdingId: string | null;
}

function topK(
  d: Record<string, number>, k: number,
): Array<{ key: string; value: number }> {
  return Object.entries(d)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, k);
}

function uniformRouting(): Record<string, number> {
  const u: Record<string, number> = {};
  for (const s of SEPHIROTH) u[s] = 1 / SEPHIROTH.length;
  return u;
}

/** Tiny seedable RNG (mulberry32) — keeps the noised-uniform run reproducible. */
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

/** Noised uniform routing — uniform mean + per-tick Dirichlet-ish jitter so
 *  verb selection varies tick to tick without needing a model call. Good for
 *  showcasing the agent's full vocabulary in a sub-second capture. */
function noisedRouting(rng: () => number, noise: number): Record<string, number> {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const s of SEPHIROTH) {
    // Exponential jitter — sample from exp distribution, normalize. Gives
    // peaks on different Sephirot each tick.
    const u = Math.max(1e-9, rng());
    const x = -Math.log(u);
    const v = (1 - noise) * 0.1 + noise * x;
    out[s] = v;
    sum += v;
  }
  for (const s of SEPHIROTH) out[s] /= sum;
  return out;
}

/** Cycle-biased routing — each tick is biased toward a specific Sephirah,
 *  cycling through all 10. Showcases the substrate translating each routing
 *  regime to its appropriate verb. */
function cycleBiasedRouting(tick: number): Record<string, number> {
  const out: Record<string, number> = {};
  const dominant = SEPHIROTH[tick % SEPHIROTH.length];
  for (const s of SEPHIROTH) out[s] = s === dominant ? 0.6 : 0.044;
  return out;
}

export async function captureAgentVideo(opts: {
  ticks?: number;
  oracleEndpoint?: string;
  useUniformRouting?: boolean;
  /** If true, use noised-uniform routing instead of static uniform. Makes
   *  verb selection vary per tick — better for video showcase. */
  noisedRouting?: boolean;
  /** If true, cycle through Sephirah biases each tick — showcases every
   *  routing → verb translation in the substrate. */
  cycleBias?: boolean;
  /** Penalty applied to recently-used verbs to encourage variety
   *  (action satiation). 0 = disabled. Default 0.15. */
  recentVerbDecay?: number;
  outputPath?: string;
  worldSeed?: number;
  width?: number;
  height?: number;
}): Promise<{ frames: Frame[]; htmlPath: string; jsonPath: string }> {
  const TICKS = opts.ticks ?? 40;
  const useUniform = opts.useUniformRouting ?? false;
  const useNoised = opts.noisedRouting ?? false;
  const useCycle = opts.cycleBias ?? false;
  const recentDecay = opts.recentVerbDecay ?? 0.15;
  const rng = makeRng(opts.worldSeed ?? 42);
  const outputPath = opts.outputPath ?? "/tmp/agent_play.html";
  // Track recent verbs to apply satiation penalty
  const recentVerbs: string[] = [];
  const RECENT_WINDOW = 3;
  const jsonPath = outputPath.replace(/\.html$/, ".json");
  const oracle = useUniform
    ? null
    : new HttpOracleClient(opts.oracleEndpoint ?? "http://127.0.0.1:8765");

  if (oracle) {
    const h = await oracle.healthz();
    if (!h.ok) {
      console.warn("# Oracle unhealthy — falling back to uniform routing");
    }
  }

  // ── Rich world: agent + sword + rock + portal + wizard + villager ──
  const world = new World(opts.worldSeed ?? 7);
  const bus = new CommandBus(world, defaultReducer);
  const agents = new AgentSystem();
  const proj = new AsciiProjection({ width: opts.width ?? 32, height: opts.height ?? 14 });
  proj.init(world);
  bus.events.on("*", (e) => proj.onEvent(e));

  bus.applyImmediate({
    kind: "SpawnEntity", id: "agent", prototypeId: "player",
    transform: identityTransform(), components: {},
  });
  agents.register({ id: "agent", agency: "human", perceptionRadius: 12 });

  bus.applyImmediate({
    kind: "SpawnEntity", id: "sword", prototypeId: "sword",
    transform: { ...identityTransform(), position: { x: 2, y: 0, z: -1 } },
    components: { interactable: { verb: "pickup", range: 3 }, saveable: { persistent: true } },
  });
  bus.applyImmediate({
    kind: "SpawnEntity", id: "rock", prototypeId: "rock",
    transform: { ...identityTransform(), position: { x: -3, y: 0, z: 2 } },
    components: { interactable: { verb: "pickup", range: 3 } },
  });
  bus.applyImmediate({
    kind: "SpawnEntity", id: "wizard", prototypeId: "wizard_npc",
    transform: { ...identityTransform(), position: { x: 4, y: 0, z: 3 } },
    components: { interactable: { verb: "talk", range: 3 } },
  });
  bus.applyImmediate({
    kind: "SpawnEntity", id: "villager", prototypeId: "guard_npc",
    transform: { ...identityTransform(), position: { x: -2, y: 0, z: -3 } },
    components: { interactable: { verb: "talk", range: 3 } },
  });
  bus.applyImmediate(spawnPortalCommand(
    { label: "library", destination: { kind: "substrate", worldId: "lib" } },
    { x: 5, y: 0, z: -3 },
  ));
  bus.applyImmediate({
    kind: "SpawnEntity", id: "tree1", prototypeId: "tree",
    transform: { ...identityTransform(), position: { x: -5, y: 0, z: 5 } },
    components: {},
  });
  bus.applyImmediate({
    kind: "SpawnEntity", id: "tree2", prototypeId: "tree",
    transform: { ...identityTransform(), position: { x: 6, y: 0, z: 6 } },
    components: {},
  });

  const frames: Frame[] = [];

  for (let tick = 0; tick < TICKS; tick++) {
    agents.refreshPerception(world, "agent", tick);
    const visibleIds = agents.perceptionOf("agent")?.visibleIds ?? [];
    const me = world.getEntity("agent");
    if (!me) break;
    proj.setFocus(me.transform.position);

    // 1. Perception
    const perception = composePerceptionSubstrate(world, "agent", {
      radius: 12, includeHolding: true,
    });

    // 2. Routing
    let routingRaw: Record<string, number>;
    let oracleText = "";
    if (oracle) {
      try {
        const prompt = composePerceptionPrompt(world, "agent", visibleIds);
        const resp = await oracle.query(prompt, { maxTokens: 12, temperature: 0.85 });
        routingRaw = { ...resp.sephirah_probs } as Record<string, number>;
        oracleText = resp.text;
      } catch (e) {
        routingRaw = useNoised ? noisedRouting(rng, 0.7) : uniformRouting();
        oracleText = `(oracle err: ${(e as Error).message.slice(0, 40)})`;
      }
    } else if (useCycle) {
      routingRaw = cycleBiasedRouting(tick);
    } else if (useNoised) {
      routingRaw = noisedRouting(rng, 0.7);
    } else {
      routingRaw = uniformRouting();
    }

    // 3. Attention refinement
    const att = doubleRecursiveAttention(routingRaw as Partial<Record<Sephirah, number>>, perception);
    const routingRefined = att.routing as Record<string, number>;

    // 4. Apply recent-verb satiation: decay routing weight to Sephirot whose
    //    dominant verb was recently used. Pushes the agent toward variety
    //    without changing the substrate's core scoring logic.
    if (recentDecay > 0 && recentVerbs.length > 0) {
      const recencyMap = new Map<string, number>();
      recentVerbs.forEach((v, i) => recencyMap.set(v, (i + 1) / recentVerbs.length));
      // We can't penalize verbs directly in routing; instead lift OTHER Sephirot
      // by a tiny amount per "recent verb counted." This is a soft novelty
      // signal that the substrate cleanup can respond to.
      // (Cleaner future: penalize verb scores directly inside composeCommand-
      // FromSubstrate via a hook.)
      for (const s of SEPHIROTH) {
        const r = routingRefined[s] ?? 0;
        const novelty = 1 - 0.5 * (recencyMap.get(s) ?? 0);
        routingRefined[s] = r * novelty;
      }
      // Re-normalize
      let sum = 0;
      for (const s of SEPHIROTH) sum += routingRefined[s] ?? 0;
      if (sum > 0) for (const s of SEPHIROTH) routingRefined[s] = (routingRefined[s] ?? 0) / sum;
    }

    // 5. Substrate cleanup → command
    const selection = composeCommandFromSubstrate(
      routingRefined as Partial<Record<Sephirah, number>>,
      perception, world, "agent",
      { generationPrompt: oracleText },
    );

    // Track for satiation
    if (selection.verb !== "NONE") {
      recentVerbs.push(selection.verb);
      if (recentVerbs.length > RECENT_WINDOW) recentVerbs.shift();
    }

    // 5. Capture frame BEFORE applying command (shows pre-action state)
    const ascii = proj.renderToString();
    const visibleKinds: Record<string, number> = {};
    for (const [k, v] of perception.visibleByKind) visibleKinds[k] = v;
    const topRefined = topK(routingRefined, 1)[0];
    const topRaw = routingRaw[topRefined.key];

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
      tick,
      ascii,
      perceptionPrompt: composePerceptionPrompt(world, "agent", visibleIds),
      visibleKinds,
      routingRaw, routingRefined,
      topSephirah: { sephirah: topRefined.key, raw: topRaw, refined: topRefined.value },
      oracleText,
      rankedVerbs: selection.ranked.slice(0, 5).map((r) => ({
        verb: r.verb, score: r.score, affordable: r.affordable,
      })),
      verb: selection.verb,
      commandKind: selection.command?.kind ?? null,
      targetId,
      agentPos: { x: me.transform.position.x, z: me.transform.position.z },
      holdingId: perception.holdingEntityId,
    });

    // 6. Apply
    if (selection.command) bus.applyImmediate(selection.command);
  }

  // Write JSON sidecar (useful for re-rendering or analysis)
  writeFileSync(jsonPath, JSON.stringify({ frames, meta: { ticks: TICKS, routingMode: oracle ? "oracle" : "uniform" } }, null, 2));
  console.log(`# JSON: ${jsonPath}  (${frames.length} frames)`);

  // Write self-contained HTML player
  const html = renderHtmlPlayer(frames, { useOracle: !!oracle, ticks: TICKS });
  writeFileSync(outputPath, html);
  console.log(`# HTML: ${outputPath}  (open in browser)`);
  return { frames, htmlPath: outputPath, jsonPath };
}

function renderHtmlPlayer(frames: Frame[], meta: { useOracle: boolean; ticks: number }): string {
  const framesJson = JSON.stringify(frames);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Substrate Agent — Plays Wander</title>
<style>
:root { color-scheme: dark; }
body {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: #0d1117; color: #c9d1d9; margin: 0; padding: 16px;
}
h1 { font-size: 18px; margin: 0 0 8px; color: #58a6ff; }
.meta { font-size: 12px; color: #8b949e; margin-bottom: 16px; }
.layout { display: grid; grid-template-columns: minmax(420px, 1fr) 1fr; gap: 16px; }
.frame {
  background: #161b22; border: 1px solid #30363d; padding: 12px;
  border-radius: 6px;
}
.frame h2 { font-size: 13px; margin: 0 0 8px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; font-weight: normal; }
pre { margin: 0; line-height: 1.2; font-size: 14px; color: #e6edf3; }
.ascii { font-size: 16px; line-height: 1.0; letter-spacing: 0.05em; }
.controls { display: flex; gap: 8px; margin: 12px 0; align-items: center; flex-wrap: wrap; }
button {
  background: #21262d; border: 1px solid #30363d; color: #c9d1d9;
  padding: 6px 12px; border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px;
}
button:hover { background: #30363d; }
button.primary { background: #238636; border-color: #2ea043; }
button.primary:hover { background: #2ea043; }
input[type=range] { flex: 1; min-width: 200px; }
.tick { color: #58a6ff; font-weight: bold; }
.verb {
  display: inline-block; padding: 2px 8px; border-radius: 12px;
  background: #1f6feb33; color: #58a6ff; font-weight: bold;
}
.verb.pickup { background: #f8513933; color: #ff7b72; }
.verb.move, .verb.rest { background: #d2a8ff33; color: #d2a8ff; }
.verb.enter_portal { background: #f0883e33; color: #ffa657; }
.verb.talk, .verb.give { background: #56d36433; color: #7ee787; }
.verb.spawn { background: #f0883e33; color: #ffa657; }
.verb.save { background: #58a6ff33; color: #79c0ff; }
.verb.inspect, .verb.examine, .verb.use { background: #a371f733; color: #d2a8ff; }
.bar {
  display: inline-block; height: 10px; background: #58a6ff;
  vertical-align: middle; margin-right: 4px; border-radius: 2px;
}
.bar.refined { background: #2ea043; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
td { padding: 2px 4px; }
td.k { color: #8b949e; }
td.v { color: #e6edf3; text-align: right; font-variant-numeric: tabular-nums; }
.kind-pill {
  display: inline-block; padding: 1px 6px; margin: 2px; border-radius: 8px;
  background: #21262d; border: 1px solid #30363d; font-size: 11px; color: #8b949e;
}
.target { color: #ffa657; font-weight: bold; }
.legend { font-size: 11px; color: #8b949e; margin-top: 8px; }
.legend span { margin-right: 12px; }
</style>
</head>
<body>
<h1>Substrate Agent — Plays Wander Around</h1>
<div class="meta">
  ${meta.ticks} ticks · routing: ${meta.useOracle ? "Oracle (125M Tree-of-Life)" : "uniform (substrate-only)"} ·
  cognition path: PerceptionSubstrate → routing → double-recursive attention → CommandSubstrate cleanup → HRR target selection
</div>
<div class="controls">
  <button id="playBtn" class="primary">▶ Play</button>
  <button id="prevBtn">◀ Prev</button>
  <button id="nextBtn">Next ▶</button>
  <input id="scrub" type="range" min="0" max="${frames.length - 1}" value="0">
  <span><span class="tick">tick <span id="tickNum">0</span></span> / ${frames.length - 1}</span>
  <select id="speed">
    <option value="2000">0.5×</option>
    <option value="1000" selected>1×</option>
    <option value="500">2×</option>
    <option value="250">4×</option>
    <option value="100">10×</option>
  </select>
</div>
<div class="layout">
  <div class="frame">
    <h2>World (ASCII projection, centered on agent)</h2>
    <pre id="ascii" class="ascii"></pre>
    <div class="legend">
      <span>@ agent</span><span>/ sword</span><span>* rock</span>
      <span>w wizard</span><span>g villager</span><span>O portal</span>
      <span>T tree</span><span>. empty</span>
    </div>
  </div>
  <div class="frame">
    <h2>Cognition trace</h2>
    <div style="margin-bottom: 8px;">
      Verb: <span id="verb" class="verb">—</span>
      <span id="targetDisplay" style="margin-left: 12px;"></span>
    </div>
    <div style="margin-bottom: 8px;">
      Routing top: <span id="routingTop"></span>
    </div>
    <div style="margin-bottom: 8px;">
      Visible: <span id="visible"></span>
    </div>
    <h2 style="margin-top: 12px;">Routing distribution (raw → refined)</h2>
    <div id="routingBars"></div>
    <h2 style="margin-top: 12px;">Verb scores (top 5)</h2>
    <table id="verbTable"></table>
    <h2 style="margin-top: 12px;">Oracle text continuation</h2>
    <pre id="oracleText" style="font-size: 11px; color: #8b949e; white-space: pre-wrap;"></pre>
  </div>
</div>
<script>
const frames = ${framesJson};
let cur = 0;
let timer = null;

function render(i) {
  const f = frames[i];
  document.getElementById('tickNum').textContent = f.tick;
  document.getElementById('ascii').textContent = f.ascii;
  const verbEl = document.getElementById('verb');
  verbEl.textContent = f.verb;
  verbEl.className = 'verb ' + f.verb.toLowerCase();
  document.getElementById('targetDisplay').innerHTML = f.targetId
    ? '→ <span class="target">' + f.targetId + '</span>'
    : '';
  document.getElementById('routingTop').textContent =
    f.topSephirah.sephirah + ' (raw ' + f.topSephirah.raw.toFixed(3) + ' → refined ' + f.topSephirah.refined.toFixed(3) + ')';
  const vis = Object.entries(f.visibleKinds)
    .map(([k, n]) => '<span class="kind-pill">' + k + (n > 1 ? ' ×' + n : '') + '</span>')
    .join('');
  document.getElementById('visible').innerHTML = vis || '<span style="color:#8b949e">nothing</span>';

  // Routing bars
  const allSephs = Array.from(new Set([...Object.keys(f.routingRaw), ...Object.keys(f.routingRefined)]));
  allSephs.sort((a, b) => (f.routingRefined[b] || 0) - (f.routingRefined[a] || 0));
  const bars = allSephs.map(s => {
    const raw = f.routingRaw[s] || 0;
    const ref = f.routingRefined[s] || 0;
    return '<div style="margin-bottom:2px;font-size:11px;">' +
      '<span style="display:inline-block;width:80px;color:#8b949e">' + s + '</span>' +
      '<span class="bar" style="width:' + (raw*200) + 'px;opacity:0.5"></span>' +
      '<span class="bar refined" style="width:' + (ref*200) + 'px"></span>' +
      ' <span style="font-size:10px;color:#8b949e">' + raw.toFixed(2) + '→' + ref.toFixed(2) + '</span>' +
      '</div>';
  }).join('');
  document.getElementById('routingBars').innerHTML = bars;

  // Verb scores
  const rows = f.rankedVerbs.map(r =>
    '<tr><td class="k">' + r.verb + (r.affordable ? '' : ' <span style="color:#f85149">·</span>') + '</td>' +
    '<td class="v">' + r.score.toFixed(3) + '</td></tr>'
  ).join('');
  document.getElementById('verbTable').innerHTML = rows;

  document.getElementById('oracleText').textContent = f.oracleText || '(no text continuation)';
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
function pause() {
  if (timer) clearInterval(timer);
  timer = null;
  document.getElementById('playBtn').textContent = '▶ Play';
}

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

// CLI runner — tsx agentVideoCapture.ts [ticks] [--uniform|--noised|--cycle] [--out=path.html]
if (typeof process !== "undefined" && /agentVideoCapture\.(js|ts)$/.test(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const useUniform = args.includes("--uniform-routing");
  const useNoised = args.includes("--noised");
  const useCycle = args.includes("--cycle");
  const oracleArg = args.find((a) => a.startsWith("--oracle="));
  const oracleEndpoint = oracleArg ? oracleArg.slice("--oracle=".length) : undefined;
  const ticks = Number(args.find((a) => !a.startsWith("--")) ?? 40);
  const outArg = args.find((a) => a.startsWith("--out="));
  const outputPath = outArg ? outArg.slice("--out=".length) : "/tmp/agent_play.html";
  captureAgentVideo({
    ticks,
    useUniformRouting: useUniform || useNoised || useCycle,
    noisedRouting: useNoised,
    cycleBias: useCycle,
    oracleEndpoint,
    outputPath,
  })
    .then((r) => {
      console.log(`\n✓ Captured ${r.frames.length} frames.`);
      console.log(`  HTML: ${r.htmlPath}`);
      console.log(`  JSON: ${r.jsonPath}`);
    })
    .catch((e) => { console.error("capture failed:", e); process.exit(1); });
}
