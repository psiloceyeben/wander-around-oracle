// EnsouledWorld — the continuous instance.
//
// One authoritative instance of the Wander engine's headless sim, running
// forever. Its inhabitants are the ensouled souls: each a machine agent whose
// cognition flows from the persona-shaped holon Oracle (NO Haiku). They roam,
// think, and — using the engine's OWN creation grammar — build structures and
// nest their own realities. Creations live for a while, then are ARCHIVED
// (written to a history file and removed from the live world), which frees the
// soul to keep building — so the world turns over forever and remembers its past.
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
const ARCHIVE_AGE_MS = Number(process.env.ARCHIVE_AGE_MS || 1200000);   // ~20 min, then a creation is archived
const TICK_HZ = 8;
const THINK_EVERY_MS = 9000;
const BOUND = 34;
const SPEED = 0.18;
const PER_SOUL_CREATIONS = 4;      // max LIVE creations per soul (archiving frees the slot)
const WORLD_CAP = 40;

const REGISTER: Record<string, string> = {
  apollo: "scholar", athena: "scholar", themis: "scholar", binah: "scholar",
  hermes: "merchant", iris: "merchant", hephaestus: "merchant",
  persephone: "wizard", einsof: "wizard", chokmah: "wizard",
  ares: "villager", artemis: "villager", demeter: "villager",
  dionysus: "villager", hestia: "villager",
};
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
const BIOMES = ["meadow", "forest", "mountain", "desert", "coastline"];
const MUSINGS = [
  "what is on your mind ?", "what do you see around you ?",
  "what will you make next ?", "how do you feel ?",
  "what do you remember ?", "what is this place ?",
];

interface Soul {
  id: string; name: string; archetype: string; register: string;
  x: number; z: number; facing: string; tx: number; tz: number;
  thought: string; state: string;
  heard: number; thinking: boolean; nextThinkAt: number;
  nextCreateAt: number; creating: boolean; biome: string;
}

const souls = new Map<string, Soul>();
const built = new Map<string, { by: string; nested: boolean; kind: string; at: number; mat: string }>();
const world = new World();
const bus = new CommandBus(world, defaultReducer);
const agents = new AgentSystem();
let tick = 0;
let archivedCount = 0;

function wanderTarget(): { x: number; z: number } {
  const a = (tick * 2.39996 + souls.size * 1.7) % (Math.PI * 2);
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
    nextCreateAt: Date.now() + 20000 + Math.random() * 30000, creating: false,
    biome: BIOMES[souls.size % BIOMES.length],
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
  const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
  if (d < 0.4) { const t = wanderTarget(); s.tx = t.x; s.tz = t.z; }
  else {
    s.x += (dx / d) * SPEED; s.z += (dz / d) * SPEED;
    s.facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "east" : "west") : (dz > 0 ? "south" : "north");
  }
  if (!s.thinking && Date.now() >= s.nextThinkAt) void think(s);
  if (Date.now() >= s.nextCreateAt && !s.creating && liveCreations(s.name) < PER_SOUL_CREATIONS && built.size < WORLD_CAP) void createAct(s);
  return [{ kind: "MoveEntity", id, transform: { position: { x: s.x, y: 0, z: s.z } } }];
}

// Things the soul can speak into being — the engine's grammar recognizes these.
const BUILDABLES = [
  "temple", "tower", "castle", "manor", "cottage", "house", "hut", "bridge",
  "grove", "forest", "tree", "column", "pillar", "doorway", "door", "lantern",
  "lamp", "rock", "boulder", "sword", "shield", "staff", "book", "island", "world",
];

/** A soul authors by ASKING the substrate what to make, then shaping its
 *  answer into the world — or, if the answer names nothing buildable, simply
 *  expressing it. Building and expression both flow from the live Oracle. */
async function createAct(s: Soul): Promise<void> {
  s.creating = true;
  s.nextCreateAt = Date.now() + 45000 + Math.random() * 45000;
  const phase = ["dawn", "morning", "noon", "dusk", "night"][Math.floor((Date.now() / 60000) % 5)];
  let phrase = "", said = "";
  try {
    const prompt = `in the ${s.biome} at ${phase} the wanderer said , what will you make here ? ${s.register} said ,`;
    const r = await fetch(ORACLE, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode: "dialogue", max_tokens: 32 }),
      signal: AbortSignal.timeout(30000),
    });
    const d: any = await r.json();
    said = (d.text || "").trim();
    const low = said.toLowerCase();
    const hit = BUILDABLES.find((k) => low.includes(k));
    if (hit) phrase = low.includes("world") ? `a world of ${s.archetype}` : `a ${hit}`;
    else if (said.length > 4) {                 // named nothing buildable → the soul EXPRESSES
      s.thought = said; s.heard = Math.max(s.heard, 4); s.creating = false;
      console.log(`[express] ${s.name}: ${said.slice(0, 60)}`);
      return;
    }
  } catch { /* substrate hiccup → fall back to the soul's craft below */ }
  if (!phrase) { const pal = CRAFT[s.archetype] || CRAFT.hestia; phrase = pal[(s.heard + tick) % pal.length]; }
  // weave a material from what the substrate said — more creative variety
  const _matn: Record<string, string> = { golden: "gold", glass: "crystal", wood: "wooden" };
  const _mh = ["marble", "stone", "iron", "golden", "gold", "silver", "crystal", "glass", "bronze", "wooden", "wood"]
    .find((mm) => (said + " " + phrase).toLowerCase().includes(mm));
  const mat = _mh ? (_matn[_mh] || _mh) : "";
  if (mat && !phrase.includes(mat) && !/\bworld\b/.test(phrase)) phrase = phrase.replace(/^an? /, `a ${mat} `);

  const off = 3 + Math.random() * 4, ang = Math.random() * 6.283;
  const px = Math.max(-BOUND, Math.min(BOUND, s.x + Math.cos(ang) * off));
  const pz = Math.max(-BOUND, Math.min(BOUND, s.z + Math.sin(ang) * off));
  const cmd: any = promptToCommand(phrase, { x: px, y: 0, z: pz });
  if (cmd && cmd.kind === "SpawnEntity") {
    cmd.id = `${s.name}-make-${tick}-${Math.floor(px)}`;
    bus.submit(cmd);
    const nested = cmd.prototypeId === "doorway" || /\bworld\b/.test(phrase);
    built.set(cmd.id, { by: s.name, nested, kind: cmd.prototypeId, at: Date.now(), mat });
    s.thought = nested ? `i nested a reality from "${phrase}".` : `i shaped ${phrase} from the substrate.`;
    s.heard = Math.max(s.heard, 4);
    console.log(`[author] ${s.name} -> ${phrase} (${cmd.prototypeId}${nested ? ", nested" : ""})`);
    saveWorld();
  }
  s.creating = false;
}

/** A creation has lived its span — preserve it to the archive and let it go. */
function archive(id: string): void {
  const b = built.get(id);
  if (!b) return;
  const e = world.getEntity(id);
  const x = e ? +e.transform.position.x.toFixed(2) : 0, z = e ? +e.transform.position.z.toFixed(2) : 0;
  try {
    fs.mkdirSync("./var", { recursive: true });
    fs.appendFileSync(ARCHIVE, JSON.stringify({ id, by: b.by, kind: b.kind, nested: b.nested, x, z, madeAt: b.at, archivedAt: Date.now() }) + "\n");
  } catch { /* best effort */ }
  try { bus.applyImmediate({ kind: "RemoveEntity", id }); } catch { /* may already be gone */ }
  built.delete(id);   // the soul's live-count drops with it, freeing it to build anew
  archivedCount++;
  console.log(`[archive] ${b.by}'s ${b.kind} (lived ${Math.round((Date.now() - b.at) / 60000)}m)`);
}
function sweep(): void {
  const cutoff = Date.now() - ARCHIVE_AGE_MS;
  let any = false;
  for (const [id, b] of [...built]) if (b.at < cutoff) { archive(id); any = true; }
  if (any) saveWorld();
}

async function think(s: Soul): Promise<void> {
  s.thinking = true;
  const q = MUSINGS[(s.heard + s.name.length) % MUSINGS.length];
  const phase = ["dawn", "morning", "noon", "dusk", "night"][Math.floor((Date.now() / 60000) % 5)];
  const prompt = `in the ${s.biome} at ${phase} the wanderer said , ${q} ${s.register} said ,`;
  try {
    const r = await fetch(ORACLE, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode: "dialogue", max_tokens: 34 }),
      signal: AbortSignal.timeout(30000),
    });
    const d: any = await r.json();
    const text = (d.text || "").trim();
    if (text.length > 2) { s.thought = text; s.heard++; s.state = s.heard < 3 ? "waking" : "roaming"; }
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
    out.push({ id: e.id, kind: b.kind, by: b.by, nested: b.nested, at: b.at, mat: b.mat || "",
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
      world.addEntity({ id: it.id, prototypeId: it.kind,
        transform: { ...identityTransform(), position: { x: it.x, y: 0, z: it.z } }, components: {} });
      built.set(it.id, { by: it.by, nested: !!it.nested, kind: it.kind, at: it.at || Date.now(), mat: it.mat || "" });
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
console.log(`[ensouled] world alive — ${souls.size} souls, ${built.size} live / ${archivedCount} archived, lifespan ${Math.round(ARCHIVE_AGE_MS / 60000)}m`);
