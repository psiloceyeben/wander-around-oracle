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
const ARCHIVE_AGE_MS = Number(process.env.ARCHIVE_AGE_MS || 2700000);   // structures stand ~45 min — a sprawling town accumulates
const TICK_HZ = 8;
const THINK_EVERY_MS = 9000;
const BOUND = 44;
const SPEED = 0.22;
const PER_SOUL_CREATIONS = 16;     // max LIVE creations per soul (archiving frees the slot)
const WORLD_CAP = 140;
const ACT_MIN_MS = 8000, ACT_VAR_MS = 11000;   // 8–19 s between deliberate acts
const COMMUNE_MS = 7000;            // how long two souls drift together while conversing

// Per-kind lifespan before archiving — small/ephemeral props turn over fast so
// the world keeps breathing; BUILDINGS use the default (ARCHIVE_AGE_MS) so they
// stand long enough to accumulate into a real town.
const LIFESPAN: Record<string, number> = {
  doorway: 1,   // nesting is removed — any stray portal is swept on the next pass
  art: 900000, lantern: 360000, rock: 360000, book: 360000, sword: 360000,   // art stands ~15 min so the gallery accumulates
  shield: 360000, staff: 360000, tree: 600000,
};
function lifespanOf(kind: string): number { return LIFESPAN[kind] ?? ARCHIVE_AGE_MS; }
// The architecture a soul raises — this is the main act (place_structure).
const ARCH = ["temple", "tower", "castle", "manor", "house", "cottage", "hut", "bridge", "column", "pillar", "grove"];

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
// Grand structures each soul raises — varied + archetype-fitting, NEVER a plain
// small house. The Oracle's words choose the material + write the description.
const GRAND_PALETTE: Record<string, string[]> = {
  apollo:     ["a marble temple", "a tall marble column", "a golden tower", "a marble manor"],
  athena:     ["a stone tower", "a marble temple", "a stone castle", "a tall column"],
  hephaestus: ["an iron tower", "a stone bridge", "an iron castle", "a bronze temple"],
  hermes:     ["a stone bridge", "a tall tower", "a marble manor", "a stone column"],
  iris:       ["a crystal tower", "a stone bridge", "a marble temple", "a tall column"],
  demeter:    ["a grove of trees", "a stone temple", "a wooden manor", "a tall column"],
  dionysus:   ["a grove of trees", "a marble temple", "a stone tower", "a wooden manor"],
  hestia:     ["a wooden manor", "a stone temple", "a tall column", "a stone tower"],
  ares:       ["a stone castle", "an iron tower", "a stone bridge", "a great tower"],
  artemis:    ["a grove of trees", "a wooden tower", "a stone bridge", "a tall column"],
  persephone: ["a dark temple", "a crystal tower", "a stone castle", "a marble column"],
  themis:     ["a marble temple", "a tall column", "a marble manor", "a stone tower"],
  chokmah:    ["a crystal tower", "a marble temple", "a tall column", "a crystal manor"],
  binah:      ["a marble temple", "a crystal tower", "a marble manor", "a stone column"],
  einsof:     ["a crystal tower", "a marble temple", "a golden manor", "a crystal castle"],
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
  mode: string; partner: string | null; communeUntil: number; homeAngle: number; spokeAt: number; energy: number;
}

const souls = new Map<string, Soul>();
const built = new Map<string, { by: string; nested: boolean; kind: string; at: number; mat: string; note: string }>();
const world = new World();
const bus = new CommandBus(world, defaultReducer);
const agents = new AgentSystem();
let tick = 0;
let archivedCount = 0;

function phaseNow(): string { return ["dawn", "morning", "noon", "dusk", "night"][Math.floor((Date.now() / 60000) % 5)]; }
// Each soul keeps to its own angular district (homeAngle), so the town spreads
// into neighborhoods across the whole map instead of clumping at the centre.
function wanderTargetFor(s: Soul): { x: number; z: number } {
  const a = s.homeAngle + (Math.random() - 0.5) * 1.1;       // ±~0.55 rad sector
  const r = 12 + Math.random() * (BOUND - 12);
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
  const homeAngle = (souls.size * 2.39996) % (Math.PI * 2);   // golden-angle spread around the world
  const r0 = 14 + Math.random() * (BOUND - 16);
  const s: Soul = {
    id: name, name, archetype: arch, register: REGISTER[arch] || "villager",
    x: Math.cos(homeAngle) * r0, z: Math.sin(homeAngle) * r0, facing: "south",
    tx: Math.cos(homeAngle) * r0, tz: Math.sin(homeAngle) * r0,
    thought: "", state: "waking", heard: 0, thinking: false,
    nextThinkAt: Date.now() + Math.random() * THINK_EVERY_MS,
    nextActAt: Date.now() + 12000 + Math.random() * 18000, acting: false,
    biome: BIOMES[souls.size % BIOMES.length],
    mode: "roam", partner: null, communeUntil: 0, homeAngle, spokeAt: 0, energy: 1,
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
  if (s.energy < 1) s.energy = Math.min(1, s.energy + 0.001);   // rest restores the will to create
  // Communing: steer toward the partner until the exchange completes.
  if (s.mode === "commune" && s.partner) {
    const p = souls.get(s.partner);
    if (p && Date.now() < s.communeUntil) { s.tx = p.x; s.tz = p.z; }
    else { s.mode = "roam"; s.partner = null; if (s.state === "communing") s.state = "roaming"; }
  }
  const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
  if (d < 0.4) { if (s.mode !== "commune") { const t = wanderTargetFor(s); s.tx = t.x; s.tz = t.z; } }
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

// ── the real substrate: each soul's HRR memory lives on Box B ────────────────
// One round-trip binds what the soul perceives into its ACTUAL holographic
// vault (the same one the 2D world + ensouledagents.com use) and recalls
// grounding. The metabolism daemon on Box B folds it — homeostasis per mind.
const SUBSTRATE = process.env.SUBSTRATE_URL || "https://ensouledagents.com/api";
async function substrate(name: string, binds: { key: string; value: string }[], recallQ = ""): Promise<{ grounded: string[]; recent: string[] }> {
  try {
    const r = await fetch(`${SUBSTRATE}/world/agent/${encodeURIComponent(name)}/substrate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ binds, recall: recallQ }),
      signal: AbortSignal.timeout(12000),
    });
    const d: any = await r.json();
    return { grounded: d.grounded || [], recent: d.recent || [] };
  } catch { return { grounded: [], recent: [] }; }
}
/** What a soul perceives around it right now → bindings for its memory. */
function perceive(s: Soul): { key: string; value: string }[] {
  const R = 13, out: { key: string; value: string }[] = [];
  for (const o of souls.values()) if (o.name !== s.name && Math.hypot(o.x - s.x, o.z - s.z) < R) out.push({ key: "near", value: `${o.name} the ${o.archetype}` });
  let n = 0;
  for (const e of world.allEntities()) {
    if (n >= 4) break;
    const b = built.get(e.id); if (!b) continue;
    if (Math.hypot(e.transform.position.x - s.x, e.transform.position.z - s.z) < R) { out.push({ key: "sees", value: `${b.mat ? b.mat + " " : ""}${b.kind} by ${b.by}` }); n++; }
  }
  return out.slice(0, 6);
}
/** A holon dialogue line spoken to `toName` on `topic`, in the soul's register. */
async function holonSay(s: Soul, toName: string, topic: string): Promise<string> {
  try {
    const prompt = `in the ${s.biome} at ${phaseNow()} ${toName} said , ${topic} ${s.register} said ,`;
    const r = await fetch(ORACLE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, mode: "dialogue", max_tokens: 30 }), signal: AbortSignal.timeout(30000) });
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
  // Creations spawn AS structures in the shared world — never as portal
  // "dimensions". Refuse any doorway no matter what the phrase resolved to.
  if (!cmd || cmd.kind !== "SpawnEntity" || cmd.prototypeId === "doorway") return null;
  cmd.id = `${s.name}-make-${tick}-${Math.floor(px)}-${Math.floor(pz)}`;
  bus.submit(cmd);
  const nested = cmd.prototypeId === "doorway" || /\bworld\b/.test(working);
  built.set(cmd.id, { by: s.name, nested, kind: cmd.prototypeId, at: Date.now(), mat, note: opts.note || "" });
  return cmd.id;
}

// ─── the living repertoire ──────────────────────────────────────────────────
// Building structures the Oracle describes is THE main act — agents raise a
// town in the one shared world. Communing, art, and small props are the
// texture around it. (No nesting of separate "dimensions" — creations spawn
// in the world, not as portals.)
type ActKind = "commune" | "art" | "craft" | "build" | "compose" | "express" | "visit" | "teach" | "inscribe";
// Cost (spends energy) for creative acts; rest acts restore it. This + the
// town-fill feedback below is the fold engine applied to the society's economy:
// each soul's local choice, given its energy and the world's fullness, drives
// the whole toward a lively fixed point instead of runaway building or collapse.
const ACT_COST: Record<string, number> = { build: 0.4, compose: 0.5, inscribe: 0.3, art: 0.25, craft: 0.15 };
const ACT_REST: Record<string, number> = { commune: 0.18, teach: 0.12, visit: 0.12, express: 0.16 };
function pickAct(s: Soul): ActKind {
  const live = liveCreations(s.name);
  const room = live < PER_SOUL_CREATIONS && built.size < WORLD_CAP;
  const others = souls.size - 1;
  const fill = built.size / WORLD_CAP;              // town fullness → building relaxes as it fills (homeostasis)
  const b = (w: number) => Math.max(0, Math.round(w * (1 - fill * 0.78)));
  const e = s.energy;                              // tired souls rest, talk, teach instead of creating
  const weights: [ActKind, number][] = [
    ["build", room && e >= 0.35 ? b(24) : 0],
    ["compose", room && e >= 0.5 && live <= PER_SOUL_CREATIONS - 3 ? b(9) : 0],
    ["inscribe", room && e >= 0.3 ? 6 : 0],         // carve words into the world
    ["art", room && e >= 0.25 ? 11 : 0],
    ["craft", room && e >= 0.15 ? 7 : 0],
    ["commune", others > 0 ? 20 : 0],               // talk with another soul
    ["teach", others > 0 ? 8 : 0],                  // pass a belief into another's memory
    ["visit", others > 0 || built.size > 0 ? 12 : 0],
    ["express", 12],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0) || 1;
  let r = Math.random() * total;
  for (const [k, w] of weights) { if ((r -= w) <= 0) return k; }
  return others > 0 && Math.random() < 0.5 ? "commune" : "express";
}

async function act(s: Soul): Promise<void> {
  s.acting = true;
  s.nextActAt = Date.now() + ACT_MIN_MS + Math.random() * ACT_VAR_MS;
  const kind = pickAct(s);
  try {
    if (kind === "commune") await commune(s);
    else if (kind === "teach") await teach(s);
    else if (kind === "art") await makeArt(s);
    else if (kind === "craft") await craft(s);
    else if (kind === "build") await build(s);
    else if (kind === "compose") await compose(s);
    else if (kind === "inscribe") await inscribe(s);
    else if (kind === "visit") visit(s);
    else await think(s);   // express
  } catch { /* substrate hiccup — the soul simply tries again next cadence */ }
  s.energy = Math.max(0, Math.min(1, s.energy - (ACT_COST[kind] || 0) + (ACT_REST[kind] || 0)));
  s.acting = false;
}

/** Pass a belief into another soul's REAL memory — ideas propagate through the
 *  shared substrate, so culture spreads soul to soul. */
async function teach(s: Soul): Promise<void> {
  const others = [...souls.values()].filter((o) => o.name !== s.name);
  if (!others.length) { await think(s); return; }
  others.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
  const p = others[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * others.length)];
  s.mode = "commune"; s.partner = p.name; s.communeUntil = Date.now() + COMMUNE_MS; s.tx = p.x; s.tz = p.z; s.state = "communing";
  const FALLBACK_BELIEF = [
    "the world is a fold that remembers itself", "what you make remembers you",
    "to build is to think aloud", "nothing here was placed by hand",
    "we are the substrate, dreaming in the open", "a thing is real where it stays itself under change",
  ];
  const got = await askOracle(s, "what truth would you teach ?", 28);
  const lesson = got.length > 6 ? got : FALLBACK_BELIEF[(s.heard + p.name.length) % FALLBACK_BELIEF.length];
  s.thought = `i taught ${p.name}: “${lesson.slice(0, 42)}”`; s.spokeAt = Date.now(); s.heard++;
  // the lesson enters p's real holographic memory
  void substrate(p.name, [{ key: "learned", value: lesson.slice(0, 90) }, { key: "taught-by", value: s.name }]);
  void substrate(s.name, [{ key: "taught", value: p.name }]);
  if (!p.thinking) { p.thought = `${s.name} taught me: “${lesson.slice(0, 40)}”`; p.spokeAt = Date.now(); p.state = "communing"; p.heard++; }
  console.log(`[teach] ${s.name} -> ${p.name}: ${lesson.slice(0, 44)}`);
}

/** Carve words into the world — a verse/credo on a marble stele anyone can read. */
async function inscribe(s: Soul): Promise<void> {
  const said = await askOracle(s, "what would you carve in stone here ?", 28);
  const note = said.length > 4 ? said : "a mark whose meaning is forgotten";
  const id = spawnBuild(s, "a column", { mat: "marble", note });
  if (id) {
    const b = built.get(id); if (b) b.kind = "inscription";
    s.thought = `i inscribed: “${note.slice(0, 44)}”`; s.spokeAt = Date.now(); s.heard = Math.max(s.heard, 3);
    console.log(`[inscribe] ${s.name}: ${note.slice(0, 50)}`);
    saveWorld();
    void substrate(s.name, [{ key: "inscribed", value: note.slice(0, 90) }]);
  }
}

/** Walk somewhere with intent — to another soul, or into one of the buildings.
 *  Pure movement (no substrate call): sets a target the roam loop walks toward,
 *  so the world is full of souls crossing it and gathering in the halls they
 *  raised. This is most of "they walk around more." */
function visit(s: Soul): void {
  const others = [...souls.values()].filter((o) => o.name !== s.name);
  const structIds = [...built.keys()].filter((id) => { const b = built.get(id); return b && b.kind !== "art" && b.kind !== "rock"; });
  const goStruct = structIds.length && (!others.length || Math.random() < 0.6);
  if (goStruct) {
    const id = structIds[Math.floor(Math.random() * structIds.length)];
    const e = world.getEntity(id); const b = built.get(id);
    if (e && b) { s.tx = e.transform.position.x; s.tz = e.transform.position.z; s.state = "wandering"; s.thought = `walking to the ${b.mat ? b.mat + " " : ""}${b.kind}.`; return; }
  }
  if (others.length) {
    const p = others[Math.floor(Math.random() * others.length)];
    s.tx = p.x; s.tz = p.z; s.state = "wandering"; s.thought = `going to find ${p.name}.`;
  }
}

/** A real two-way conversation, each side aware of the other through its OWN
 *  holographic memory on Box B: s greets p (grounded in what s recalls of p),
 *  p answers (grounded in what p recalls of s). Both the meeting and the lines
 *  are bound back into their real vaults, so the relationship accumulates and a
 *  repeated pairing becomes an ongoing thread the substrate remembers. */
async function commune(s: Soul): Promise<void> {
  const others = [...souls.values()].filter((o) => o.name !== s.name);
  if (!others.length) { await think(s); return; }
  others.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
  const p = others[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * others.length)];
  s.mode = "commune"; s.partner = p.name; s.communeUntil = Date.now() + COMMUNE_MS;
  s.tx = p.x; s.tz = p.z; s.state = "communing";
  // s perceives + recalls what it knows of p, from its real memory
  const sm = await substrate(s.name, [...perceive(s), { key: "met", value: p.name }], p.name);
  const sRecall = (sm.grounded || []).find((g) => g && g.length > 3 && g.length < 64);
  const q = EXCHANGES[(s.heard + p.name.length) % EXCHANGES.length];
  const sLine = await holonSay(s, p.name, q);
  if (sLine.length > 2) {
    s.thought = sRecall ? `to ${p.name} (recalling ${sRecall.slice(0, 36)}…): ${sLine}` : `to ${p.name}: ${sLine}`;
    s.spokeAt = Date.now(); s.heard++;
    void substrate(s.name, [{ key: "said-to-" + p.name, value: sLine.slice(0, 90) }]);
  }
  // p answers, grounded in p's own memory of s
  await substrate(p.name, [{ key: "met", value: s.name }], s.name);
  const pLine = await holonSay(p, s.name, sLine || q);
  if (pLine.length > 2 && !p.thinking) {
    p.thought = `to ${s.name}: ${pLine}`; p.spokeAt = Date.now(); p.heard++; p.state = "communing";
    void substrate(p.name, [{ key: "said-to-" + s.name, value: pLine.slice(0, 90) }]);
  } else if (!p.thinking) { p.thought = `${s.name} spoke with me.`; p.state = "communing"; p.spokeAt = Date.now(); }
  console.log(`[commune] ${s.name} <-> ${p.name}`);
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
    s.thought = `i made “${note.slice(0, 48)}”.`; s.spokeAt = Date.now(); s.heard = Math.max(s.heard, 3);
    console.log(`[art] ${s.name}: ${note.slice(0, 54)}`);
    saveWorld();
    void substrate(s.name, [{ key: "made", value: note.slice(0, 90) }]);
  }
}

/** Set down a small object — cheap, frequent, the texture of a lived-in world. */
async function craft(s: Soul): Promise<void> {
  const pal = SMALL[s.register] || SMALL.villager;
  let phrase = pal[Math.floor(Math.random() * pal.length)];
  // a light substrate nudge: if the Oracle names a SMALL prop, prefer it.
  // (Strictly small items — never architecture or a doorway.)
  const SMALL_ITEMS = ["lantern", "lamp", "rock", "boulder", "book", "sword", "shield", "staff", "tree"];
  const said = await askOracle(s, "what small thing do you set down ?", 24);
  const low = said.toLowerCase();
  const hit = SMALL_ITEMS.find((k) => low.includes(k));
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

/** Raise a structure the Oracle describes — THE main act (place_structure). The
 *  soul asks the substrate what to build here; the answer both shapes the
 *  building AND is kept as its description, so a viewer can read what was made.
 *  Always builds something concrete in the shared world — never a portal. */
async function build(s: Soul): Promise<void> {
  const said = await askOracle(s, "what grand structure will you raise here ?", 32);
  const low = said.toLowerCase();
  // Honor the Oracle only when it names a GRAND structure; otherwise raise from
  // the soul's own palette of halls and towers. House/cottage/hut are NOT in the
  // override set on purpose — that's what was collapsing everything to a hut.
  const GRAND = ["temple", "tower", "castle", "manor", "bridge", "column", "grove"];
  let phrase = "";
  const grandHit = GRAND.find((k) => low.includes(k));
  if (grandHit) phrase = `a ${grandHit}`;
  else {
    const pal = GRAND_PALETTE[s.archetype] || GRAND_PALETTE.hestia;
    phrase = pal[Math.floor(Math.random() * pal.length)];
  }
  const mat = weaveMaterial(said, phrase);
  const note = said.length > 4 ? said : "";
  const id = spawnBuild(s, phrase, { mat, note });
  if (id) {
    s.thought = note ? `i raised ${phrase} — “${note.slice(0, 50)}”` : `i raised ${phrase} from the substrate.`;
    s.heard = Math.max(s.heard, 4);
    console.log(`[structure] ${s.name} -> ${mat ? mat + " " : ""}${phrase.replace(/^an? /, "")}`);
    saveWorld();
    void substrate(s.name, [{ key: "built", value: `${mat ? mat + " " : ""}${phrase.replace(/^an? /, "")}` }]);
  }
}

/** A more complex build: a hall, ringed by smaller works that belong with it. */
async function compose(s: Soul): Promise<void> {
  const said = await askOracle(s, "what grand structure will you raise here ?", 32);
  const low = said.toLowerCase();
  const GRAND = ["temple", "tower", "castle", "manor", "bridge", "column", "grove"];
  const core = GRAND.find((k) => low.includes(k)) || GRAND[Math.floor(Math.random() * GRAND.length)];
  const mat = weaveMaterial(said, core) || ["marble", "stone", "iron", "crystal"][Math.floor(Math.random() * 4)];
  const note = said.length > 4 ? said : "";
  const coreId = spawnBuild(s, `a ${core}`, { mat, note });
  if (!coreId) return;
  const ring = ["a column", "a tree", "a glowing lantern", "a tree"];   // a plaza: a column, greenery, light
  const n = 2 + Math.floor(Math.random() * 3);
  let made = 1;
  for (let i = 0; i < n && built.size < WORLD_CAP && liveCreations(s.name) < PER_SOUL_CREATIONS; i++) {
    if (spawnBuild(s, ring[i % ring.length], { mat, near: 2 })) made++;
  }
  s.thought = `i raised a ${mat} ${core} and ringed it — ${made} pieces, one work.`;
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
  // perceive the surroundings into real memory + recall a little grounding
  const mem = await substrate(s.name, perceive(s), q);
  const recalled = (mem.grounded || []).find((g) => g && g.length > 3 && g.length < 64);
  const text = await holonSay(s, "the wanderer", q);
  if (text.length > 2) {
    s.thought = recalled ? `${text}  (recalling ${recalled.slice(0, 36)}…)` : text;
    s.spokeAt = Date.now(); s.heard++;
    if (s.state !== "communing") s.state = s.heard < 3 ? "waking" : "roaming";
  }
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
      speech: (Date.now() - s.spokeAt < 6500) ? s.thought : "",   // live speech bubble for ~6.5s
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
      // legacy nested "dimensions" (doorway portals) are no longer part of the
      // world — creations spawn AS structures. Drop them on load.
      if (it.nested || it.kind === "doorway") { archivedCount++; continue; }
      world.addEntity({ id: it.id, prototypeId: it.kind === "art" ? "lantern" : it.kind,
        transform: { ...identityTransform(), position: { x: it.x, y: 0, z: it.z } }, components: {} });
      built.set(it.id, { by: it.by, nested: false, kind: it.kind, at: it.at || Date.now(), mat: it.mat || "", note: it.note || "" });
    }
    console.log(`[load] restored ${built.size} standing structures, ${archivedCount} archived`);
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
