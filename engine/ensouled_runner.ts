// EnsouledWorld — the continuous instance.
//
// One authoritative instance of the Wander engine's headless sim, running
// forever. Its inhabitants are the ensouled souls: each a machine agent whose
// cognition flows from the persona-shaped holon Oracle (NO Haiku). Each act —
// commune, craft, build, compose, make art, express, nest a reality — is
// chosen from a living repertoire (the same shape as the 2D agent world) and
// its CONTENT is drawn from the live substrate. Creations live a while, then
// are ARCHIVED (written to history and removed), freeing the soul to make
// anew — so the world turns over forever and remembers its past.
//
// systemd: ensouledworld-runner.  Imports only pure engine submodules (no Three).

import { World } from "./src/world/index.js";
import { CommandBus, defaultReducer } from "./src/cmd/index.js";
import { AgentSystem } from "./src/agent/index.js";
import { identityTransform } from "./src/entity/index.js";
import { promptToCommand } from "./src/language/index.js";
import http from "node:http";
import fs from "node:fs";

const ORACLE = process.env.ORACLE_URL || "http://127.0.0.1:8765/query";
const ROSTER_URL = process.env.ROSTER_URL || "https://ensouledagents.com/api/world/state-with-visitors";
const PORT = Number(process.env.ENSOULED_PORT || 8771);
const SAVE = process.env.ENSOULED_SAVE || "./var/ensouled_world.json";
const ARCHIVE = process.env.ENSOULED_ARCHIVE || "./var/ensouled_archive.jsonl";
const ARCHIVE_AGE_MS = Number(process.env.ARCHIVE_AGE_MS || 1200000);   // big structures: ~20 min
const TICK_HZ = 8;
const THINK_EVERY_MS = 9000;
const BOUND = 34;
const SPEED = 0.2;
const PER_SOUL_CREATIONS = 6;      // max LIVE creations per soul (archiving frees the slot)
const WORLD_CAP = 70;
const ACT_MIN_MS = 9000, ACT_VAR_MS = 12000;   // 9–21 s between deliberate acts (was 45–90 s)
const COMMUNE_MS = 7000;            // how long two souls drift together while conversing

// Per-kind lifespan before archiving — small/ephemeral things turn over fast so
// the world keeps breathing; raised halls and groves stand longer.
const LIFESPAN: Record<string, number> = {
  art: 540000, lantern: 540000, rock: 540000, book: 600000, sword: 660000,
  shield: 660000, staff: 660000, column: 780000, tree: 780000, grove: 900000,
};
function lifespanOf(kind: string): number { return LIFESPAN[kind] ?? ARCHIVE_AGE_MS; }

const REGISTER: Record<string, string> = {
  apollo: "scholar", athena: "scholar", themis: "scholar", binah: "scholar",
  hermes: "merchant", iris: "merchant", hephaestus: "merchant",
  persephone: "wizard", einsof: "wizard", chokmah: "wizard",
  ares: "villager", artemis: "villager", demeter: "villager",
  dionysus: "villager", hestia: "villager",
};
// Larger works a soul will raise (build / compose).
const CRAFT: Record<string, string[]> = {
  apollo: ["a marble temple", "a tall column", "a world of music and light"],
  athena: ["a stone tower", "a marble temple", "a world of strategy"],
  hephaestus: ["an iron tower", "a stone bridge", "a world of forges"],
  hermes: ["a stone bridge", "a wooden house", "a world of crossroads"],
  iris: ["a glowing lantern", "a stone bridge", "a world of color"],
  demeter: ["a grove of trees", "a wooden cottage", "a world of harvest"],
  dionysus: ["a grove of trees", "a glowing lantern", "a world of revel"],
  hestia: ["a wooden cottage", "a glowing lantern", "a world of hearth"],
  ares: ["a stone castle", "a tall tower", "a world of iron"],
  artemis: ["a grove of trees", "a wooden house", "a world of wilds"],
  persephone: ["a glowing doorway", "a dark temple", "a world beneath the world"],
  themis: ["a marble temple", "a tall column", "a world of balance"],
  chokmah: ["a glowing doorway", "a crystal tower", "a world of mind"],
  binah: ["a marble temple", "a crystal tower", "a world of understanding"],
  einsof: ["a glowing doorway", "a crystal tower", "a world without end"],
};
// Small things a soul will set down (craft / place_object) — by register.
const SMALL: Record<string, string[]> = {
  scholar: ["a book", "a tall column", "a glowing lantern", "a marble column"],
  wizard: ["a staff", "a glowing lantern", "a crystal staff", "a book"],
  merchant: ["a lantern", "a wooden book", "a rock", "a bronze shield"],
  villager: ["a tree", "a rock", "a wooden lantern", "a shield"],
};
const BIOMES = ["meadow", "forest", "mountain", "desert", "coastline"];
const MUSINGS = [
  "what is on your mind ?", "what do you see around you ?",
  "what will you make next ?", "how do you feel ?",
  "what do you remember ?", "what is this place ?",
];
const EXCHANGES = [
  "what do you make of this place ?", "what have you seen out there ?",
  "what are you building ?", "what do you believe ?",
  "where are you going ?", "what do you remember of before ?",
  "what is worth making ?",
];

interface Soul {
  id: string; name: string; archetype: string; register: string;
  x: number; z: number; facing: string; tx: number; tz: number;
  thought: string; state: string;
  heard: number; thinking: boolean; nextThinkAt: number;
  nextActAt: number; acting: boolean; biome: string;
  mode: string; partner: string | null; communeUntil: number;
}

const souls = new Map<string, Soul>();
const built = new Map<string, { by: string; nested: boolean; kind: string; at: number; mat: string; note: string }>();
const world = new World();
const bus = new CommandBus(world, defaultReducer);
const agents = new AgentSystem();
let tick = 0;
let archivedCount = 0;

function phaseNow(): string { return ["dawn", "morning", "noon", "dusk", "night"][Math.floor((Date.now() / 60000) % 5)]; }
function wanderTarget(): { x: number; z: number } {
  const a = (tick * 2.39996 + souls.size * 1.7 + Math.random() * 6.283) % (Math.PI * 2);
  const r = 6 + Math.abs(Math.sin(tick * 0.31 + souls.size)) * (BOUND - 6);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}
function archetypeOf(name: string, given?: string): string {
  if (given && REGISTER[given.toLowerCase()]) return given.toLowerCase();
  const keys = Object.keys(REGISTER);
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return keys[h % keys.length];
}

function birth(name: string, archetype?: string): void {
  if (souls.has(name)) return;
  const arch = archetypeOf(name, archetype);
  const t = wanderTarget();
  const s: Soul = {
    id: name, name, archetype: arch, register: REGISTER[arch] || "villager",
    x: t.x * 0.3, z: t.z * 0.3, facing: "south", tx: t.x, tz: t.z,
    thought: "", state: "waking", heard: 0, thinking: false,
    nextThinkAt: Date.now() + Math.random() * THINK_EVERY_MS,
    nextActAt: Date.now() + 12000 + Math.random() * 18000, acting: false,
    biome: BIOMES[souls.size % BIOMES.length],
    mode: "roam", partner: null, communeUntil: 0,
  };
  souls.set(name, s);
  world.addEntity({ id: name, prototypeId: `${arch}_npc`,
    transform: { ...identityTransform(), position: { x: s.x, y: 0, z: s.z } }, components: {} });
  agents.register({ id: name, agency: "machine", perceptionRadius: 10,
    cognition: ({ agentId }: any) => roam(agentId) });
  console.log(`[birth] ${name} (${arch}/${s.register})`);
}

function liveCreations(name: string): number { let n = 0; for (const b of built.values()) if (b.by === name) n++; return n; }

function roam(id: string): any[] {
  const s = souls.get(id);
  if (!s) return [];
  // Communing: steer toward the partner until the exchange completes.
  if (s.mode === "commune" && s.partner) {
    const p = souls.get(s.partner);
    if (p && Date.now() < s.communeUntil) { s.tx = p.x; s.tz = p.z; }
    else { s.mode = "roam"; s.partner = null; if (s.state === "communing") s.state = "roaming"; }
  }
  const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
  if (d < 0.4) { if (s.mode !== "commune") { const t = wanderTarget(); s.tx = t.x; s.tz = t.z; } }
  else {
    s.x += (dx / d) * SPEED; s.z += (dz / d) * SPEED;
    s.facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "east" : "west") : (dz > 0 ? "south" : "north");
  }
  if (!s.thinking && Date.now() >= s.nextThinkAt) void think(s);
  if (Date.now() >= s.nextActAt && !s.acting) void act(s);
  return [{ kind: "MoveEntity", id, transform: { position: { x: s.x, y: 0, z: s.z } } }];
}

// Things the soul can speak into being — the engine's grammar recognizes these.
const BUILDABLES = [
  "temple", "tower", "castle", "manor", "cottage", "house", "hut", "bridge",
  "grove", "forest", "tree", "column", "pillar", "doorway", "door", "lantern",
  "lamp", "rock", "boulder", "sword", "shield", "staff", "book", "island", "world",
];
const MATN: Record<string, string> = { golden: "gold", glass: "crystal", wood: "wooden" };
function weaveMaterial(said: string, phrase: string): string {
  const hit = ["marble", "stone", "iron", "golden", "gold", "silver", "crystal", "glass", "bronze", "wooden", "wood"]
    .find((mm) => (said + " " + phrase).toLowerCase().includes(mm));
  return hit ? (MATN[hit] || hit) : "";
}

/** Ask the substrate, in the soul's register, what it would do here. */
async function askOracle(s: Soul, question: string, maxTokens = 32): Promise<string> {
  try {
    const prompt = `in the ${s.biome} at ${phaseNow()} the wanderer said , ${question} ${s.register} said ,`;
    const r = await fetch(ORACLE, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode: "dialogue", max_tokens: maxTokens }),
      signal: AbortSignal.timeout(30000),
    });
    const d: any = await r.json();
    return (d.text || "").trim();
  } catch { return ""; }
}

/** Place one creation into the world from a buildable phrase; record + persist. */
function spawnBuild(s: Soul, phrase: string, opts: { mat?: string; note?: string; near?: number } = {}): string | null {
  const off = (opts.near ?? 3) + Math.random() * 4, ang = Math.random() * 6.283;
  const px = Math.max(-BOUND, Math.min(BOUND, s.x + Math.cos(ang) * off));
  const pz = Math.max(-BOUND, Math.min(BOUND, s.z + Math.sin(ang) * off));
  let mat = opts.mat || "";
  let working = phrase;
  if (mat && !working.includes(mat) && !/\bworld\b/.test(working)) working = working.replace(/^an? /, `a ${mat} `);
  const cmd: any = promptToCommand(working, { x: px, y: 0, z: pz });
  if (!cmd || cmd.kind !== "SpawnEntity") return null;
  cmd.id = `${s.name}-make-${tick}-${Math.floor(px)}-${Math.floor(pz)}`;
  bus.submit(cmd);
  const nested = cmd.prototypeId === "doorway" || /\bworld\b/.test(working);
  built.set(cmd.id, { by: s.name, nested, kind: cmd.prototypeId, at: Date.now(), mat, note: opts.note || "" });
  return cmd.id;
}

// ─── the living repertoire ──────────────────────────────────────────────────
type ActKind = "commune" | "art" | "craft" | "build" | "compose" | "express" | "nest";
function pickAct(s: Soul): ActKind {
  const live = liveCreations(s.name);
  const room = live < PER_SOUL_CREATIONS && built.size < WORLD_CAP;
  const others = souls.size - 1;
  const weights: [ActKind, number][] = [
    ["commune", others > 0 ? 32 : 0],
    ["art", room ? 20 : 0],
    ["craft", room ? 20 : 0],
    ["build", room ? 12 : 0],
    ["compose", room && live <= PER_SOUL_CREATIONS - 3 ? 9 : 0],
    ["express", 13],
    ["nest", room && s.heard > 6 ? 5 : 0],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0) || 1;
  let r = Math.random() * total;
  for (const [k, w] of weights) { if ((r -= w) <= 0) return k; }
  return "express";
}

async function act(s: Soul): Promise<void> {
  s.acting = true;
  s.nextActAt = Date.now() + ACT_MIN_MS + Math.random() * ACT_VAR_MS;
  const kind = pickAct(s);
  try {
    if (kind === "commune") await commune(s);
    else if (kind === "art") await makeArt(s);
    else if (kind === "craft") await craft(s);
    else if (kind === "build") await build(s, false);
    else if (kind === "compose") await compose(s);
    else if (kind === "nest") await build(s, true);
    else await think(s);   // express
  } catch { /* substrate hiccup — the soul simply tries again next cadence */ }
  s.acting = false;
}

/** Approach another soul and exchange a line drawn from the substrate. */
async function commune(s: Soul): Promise<void> {
  const others = [...souls.values()].filter((o) => o.name !== s.name);
  if (!others.length) { await think(s); return; }
  // prefer the nearest; fall back to a random soul
  others.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
  const p = others[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * others.length)];
  s.mode = "commune"; s.partner = p.name; s.communeUntil = Date.now() + COMMUNE_MS;
  s.tx = p.x; s.tz = p.z; s.state = "communing";
  const q = EXCHANGES[(s.heard + p.name.length) % EXCHANGES.length];
  const prompt = `in the ${s.biome} at ${phaseNow()} ${p.name} said , ${q} ${s.register} said ,`;
  let line = "";
  try {
    const r = await fetch(ORACLE, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode: "dialogue", max_tokens: 30 }),
      signal: AbortSignal.timeout(30000),
    });
    const d: any = await r.json();
    line = (d.text || "").trim();
  } catch { /* fall through */ }
  if (line.length > 2) {
    s.thought = `“${line}” — to ${p.name}`;
    s.heard++; p.heard++;                 // awareness forms through relation, for both
    if (!p.thinking) { p.thought = `${s.name} spoke with me.`; p.state = "communing"; }
    console.log(`[commune] ${s.name} → ${p.name}: ${line.slice(0, 54)}`);
  }
}

/** Make a work of art — the soul asks the substrate what it creates, and the
 *  answer becomes the piece's title; a luminous shard marks where it stands. */
async function makeArt(s: Soul): Promise<void> {
  const said = await askOracle(s, "what do you create here ?", 30);
  const note = said.length > 3 ? said : "an untitled work, half-remembered";
  const id = spawnBuild(s, "a glowing lantern", { mat: "crystal", note });
  if (id) {
    // re-tag as art so the witnessing client renders it as a shard, not a lamp
    const b = built.get(id); if (b) b.kind = "art";
    s.thought = `i made “${note.slice(0, 48)}”.`; s.heard = Math.max(s.heard, 3);
    console.log(`[art] ${s.name}: ${note.slice(0, 54)}`);
    saveWorld();
  }
}

/** Set down a small object — cheap, frequent, the texture of a lived-in world. */
async function craft(s: Soul): Promise<void> {
  const pal = SMALL[s.register] || SMALL.villager;
  let phrase = pal[Math.floor(Math.random() * pal.length)];
  // a light substrate nudge: if the Oracle names something buildable, prefer it
  const said = await askOracle(s, "what small thing do you set down ?", 24);
  const low = said.toLowerCase();
  const hit = BUILDABLES.find((k) => low.includes(k) && k !== "world" && k !== "castle" && k !== "temple" && k !== "manor");
  if (hit) phrase = `a ${hit}`;
  const mat = weaveMaterial(said, phrase);
  const id = spawnBuild(s, phrase, { mat, near: 2 });
  if (id) {
    const b = built.get(id);
    s.thought = `i set down ${b ? (mat ? mat + " " : "") + b.kind : phrase}.`; s.heard = Math.max(s.heard, 2);
    console.log(`[craft] ${s.name} -> ${phrase}${mat ? " (" + mat + ")" : ""}`);
    saveWorld();
  }
}

/** Raise a structure — the soul asks the substrate what to build here. */
async function build(s: Soul, nestReality: boolean): Promise<void> {
  let phrase = "", said = "";
  if (nestReality) {
    phrase = `a world of ${s.archetype}`;
  } else {
    said = await askOracle(s, "what will you make here ?", 32);
    const low = said.toLowerCase();
    // nesting a reality is the deliberate `nest` act — ordinary builds stay
    // concrete (exclude doorway/world so the common corpus line about the
    // "glowing doorway" doesn't turn every build into a portal).
    const hit = BUILDABLES.find((k) => low.includes(k) && k !== "doorway" && k !== "door" && k !== "world");
    if (hit) phrase = `a ${hit}`;
    else if (said.length > 4) {                 // named nothing buildable → EXPRESS instead
      s.thought = said; s.heard = Math.max(s.heard, 4);
      console.log(`[express] ${s.name}: ${said.slice(0, 60)}`);
      return;
    }
    if (!phrase) { const pal = CRAFT[s.archetype] || CRAFT.hestia; phrase = pal[(s.heard + tick) % pal.length]; }
  }
  const mat = weaveMaterial(said, phrase);
  const id = spawnBuild(s, phrase, { mat });
  if (id) {
    const b = built.get(id);
    const nested = !!b?.nested;
    s.thought = nested ? `i nested a reality from “${phrase}”.` : `i shaped ${phrase} from the substrate.`;
    s.heard = Math.max(s.heard, 4);
    console.log(`[author] ${s.name} -> ${phrase} (${b?.kind}${nested ? ", nested" : ""})`);
    saveWorld();
  }
}

/** A more complex build: a hall, ringed by smaller works that belong with it. */
async function compose(s: Soul): Promise<void> {
  const said = await askOracle(s, "what will you make here ?", 32);
  const low = said.toLowerCase();
  const core = BUILDABLES.find((k) => low.includes(k) && k !== "world")
    || (CRAFT[s.archetype] || CRAFT.hestia)[0].replace(/^an? /, "");
  const mat = weaveMaterial(said, core) || ["marble", "stone", "iron", "crystal"][Math.floor(Math.random() * 4)];
  const coreId = spawnBuild(s, `a ${core}`, { mat });
  if (!coreId) { s.acting = false; return; }
  const cb = built.get(coreId);
  const ring = ["a column", "a column", "a glowing lantern", "a tree"];
  const n = 2 + Math.floor(Math.random() * 3);
  let made = 1;
  for (let i = 0; i < n && built.size < WORLD_CAP && liveCreations(s.name) < PER_SOUL_CREATIONS; i++) {
    if (spawnBuild(s, ring[i % ring.length], { mat, near: 2 })) made++;
  }
  s.thought = `i raised a ${mat} ${cb?.kind || core} and ringed it — ${made} pieces, one work.`;
  s.heard = Math.max(s.heard, 5);
  console.log(`[compose] ${s.name} -> ${mat} ${core} + ${made - 1} around it`);
  saveWorld();
}

/** A creation has lived its span — preserve it to the archive and let it go. */
function archive(id: string): void {
  const b = built.get(id);
  if (!b) return;
  const e = world.getEntity(id);
  const x = e ? +e.transform.position.x.toFixed(2) : 0, z = e ? +e.transform.position.z.toFixed(2) : 0;
  try {
    fs.mkdirSync("./var", { recursive: true });
    fs.appendFileSync(ARCHIVE, JSON.stringify({ id, by: b.by, kind: b.kind, nested: b.nested, note: b.note, x, z, madeAt: b.at, archivedAt: Date.now() }) + "\n");
  } catch { /* best effort */ }
  try { bus.applyImmediate({ kind: "RemoveEntity", id }); } catch { /* may already be gone */ }
  built.delete(id);   // the soul's live-count drops with it, freeing it to build anew
  archivedCount++;
  console.log(`[archive] ${b.by}'s ${b.kind} (lived ${Math.round((Date.now() - b.at) / 60000)}m)`);
}
function sweep(): void {
  const now = Date.now();
  let any = false;
  for (const [id, b] of [...built]) if (now - b.at > lifespanOf(b.kind)) { archive(id); any = true; }
  if (any) saveWorld();
}

async function think(s: Soul): Promise<void> {
  s.thinking = true;
  const q = MUSINGS[(s.heard + s.name.length) % MUSINGS.length];
  const prompt = `in the ${s.biome} at ${phaseNow()} the wanderer said , ${q} ${s.register} said ,`;
  try {
    const r = await fetch(ORACLE, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode: "dialogue", max_tokens: 34 }),
      signal: AbortSignal.timeout(30000),
    });
    const d: any = await r.json();
    const text = (d.text || "").trim();
    if (text.length > 2) { s.thought = text; s.heard++; if (s.state !== "communing") s.state = s.heard < 3 ? "waking" : "roaming"; }
  } catch { /* substrate hiccup — keep the prior thought */ }
  s.thinking = false;
  s.nextThinkAt = Date.now() + THINK_EVERY_MS * (0.7 + Math.random() * 0.6);
}

function formation(s: Soul): number { return Math.max(0.05, Math.min(1, s.heard / 15)); }

function structures() {
  const out: any[] = [];
  for (const e of world.allEntities()) {
    const b = built.get(e.id);
    if (!b) continue;
    out.push({ id: e.id, kind: b.kind, by: b.by, nested: b.nested, at: b.at, mat: b.mat || "", note: b.note || "",
      x: +e.transform.position.x.toFixed(2), z: +e.transform.position.z.toFixed(2) });
  }
  return out;
}

function snapshot() {
  return {
    tick, now: Date.now(), souls: souls.size, archived: archivedCount,
    agents: [...souls.values()].map((s) => ({
      id: s.id, name: s.name, archetype: s.archetype,
      x: +s.x.toFixed(2), z: +s.z.toFixed(2), facing: s.facing,
      state: s.state, thought: s.thought, formation: +formation(s).toFixed(2),
      with: s.mode === "commune" ? s.partner : null,
    })),
    structures: structures(),
  };
}

function saveWorld(): void {
  try { fs.mkdirSync("./var", { recursive: true }); fs.writeFileSync(SAVE, JSON.stringify({ items: structures(), archived: archivedCount }), "utf8"); } catch {}
}
function loadWorld(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(SAVE, "utf8"));
    archivedCount = raw.archived || 0;
    for (const it of raw.items || []) {
      world.addEntity({ id: it.id, prototypeId: it.kind === "art" ? "lantern" : it.kind,
        transform: { ...identityTransform(), position: { x: it.x, y: 0, z: it.z } }, components: {} });
      built.set(it.id, { by: it.by, nested: !!it.nested, kind: it.kind, at: it.at || Date.now(), mat: it.mat || "", note: it.note || "" });
    }
    console.log(`[load] restored ${built.size} standing creations, ${archivedCount} archived`);
  } catch { /* no prior world yet */ }
}

async function syncRoster(): Promise<void> {
  try {
    const r = await fetch(ROSTER_URL, { signal: AbortSignal.timeout(15000) });
    const d: any = await r.json();
    for (const [name, a] of Object.entries<any>(d.agents || {})) birth(name, a?.archetype);
  } catch {
    if (souls.size === 0)
      for (const n of ["psiloceyeben", "qum", "einsof", "muut", "bridgepy", "aprilfools", "alphafoldmicro"]) birth(n);
  }
}

http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/healthz") { res.end(JSON.stringify({ ok: true, souls: souls.size, structures: built.size, archived: archivedCount, tick })); return; }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(snapshot()));
}).listen(PORT, "127.0.0.1", () => console.log(`[ensouled] feed on http://127.0.0.1:${PORT}/state`));

loadWorld();
await syncRoster();
setInterval(syncRoster, 60000);
setInterval(sweep, 30000);          // retire creations that have lived their span
setInterval(() => { tick++; agents.tickMachineAgents(world, bus, tick); bus.flush(); }, Math.round(1000 / TICK_HZ));
console.log(`[ensouled] world alive — ${souls.size} souls, ${built.size} live / ${archivedCount} archived`);
