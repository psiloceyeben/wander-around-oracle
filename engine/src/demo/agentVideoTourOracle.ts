// Oracle-driven scene tour (varied) — the 125M Tree-of-Life model decides the
// routing across a sequence of DIVERSE scenes: different environments (dawn/day/
// dusk/night/forest palettes), camera angles, populations, and affordances. The
// model picks the Sephirah → verb → target each tick; variety comes from the scenes.
// Emits per-frame entity positions + camera + palette for the 3D capture harness.
//   npx tsx src/demo/agentVideoTourOracle.ts [--out=/tmp/agent_oracle_tour.json] [--ticks=4]

import { World } from "../world/index.js";
import { CommandBus, defaultReducer } from "../cmd/index.js";
import { AgentSystem } from "../agent/index.js";
import { identityTransform } from "../entity/index.js";
import { AsciiProjection } from "../projection/index.js";
import { HttpOracleClient, composePerceptionPrompt, doubleRecursiveAttention } from "../features/agentPlayer/index.js";
import { composePerceptionSubstrate } from "../features/perceptionSubstrate/index.js";
import { composeCommandFromSubstrate } from "../features/commandSubstrate/index.js";
import { spawnPortalCommand } from "../features/portals/index.js";
import { SEPHIROTH, type Sephirah } from "../hrr/treeOfLife.js";
import { writeFileSync } from "node:fs";

const PAL: Record<string, any> = {
  dawn:   { ground: 0x6a6048, sky: 0x3a3550, sun: 0xffd0b0, amb: 0x9a90b0, fog: [16, 44] },
  day:    { ground: 0x55613a, sky: 0x1a1f17, sun: 0xfff0d0, amb: 0xb8c0a0, fog: [16, 46] },
  dusk:   { ground: 0x4a4030, sky: 0x2a1f30, sun: 0xff9050, amb: 0x9a70a0, fog: [14, 40] },
  night:  { ground: 0x2a3035, sky: 0x0a0e18, sun: 0x6878a8, amb: 0x40506a, fog: [12, 34] },
  forest: { ground: 0x3a4a28, sky: 0x141a10, sun: 0xd0e0a0, amb: 0x8a9a70, fog: [10, 30] },
};

let E = 0;
const e = (id: string, kind: string, x: number, z: number, verb?: "pickup" | "open" | "talk" | "use") => ({
  kind: "SpawnEntity" as const, id, prototypeId: kind,
  transform: { ...identityTransform(), position: { x, y: 0, z } },
  components: verb ? { interactable: { verb, range: 3 } } : {},
});
const tree = (b: CommandBus, x: number, z: number) => b.applyImmediate(e("t" + (E++), "tree", x, z));
const rock = (b: CommandBus, x: number, z: number) => b.applyImmediate(e("r" + (E++), "rock", x, z));

interface Scene { name: string; desc: string; pal: string; cam: { ang: number; dist: number; h: number }; start?: { x: number; z: number }; hold?: boolean; build: (b: CommandBus) => void; }

const SCENES: Scene[] = [
  { name: "dawn meadow", desc: "First light. The agent wakes in an open field.", pal: "dawn", cam: { ang: -0.5, dist: 13, h: 8 },
    build: (b) => { tree(b,-6,5); tree(b,7,4); rock(b,-4,-5); rock(b,5,-6); } },
  { name: "the lone sword", desc: "A pickup-affordant sword waits in the grass.", pal: "day", cam: { ang: 0.3, dist: 10, h: 6.5 },
    build: (b) => { b.applyImmediate(e("sword","sword",2.5,-0.5,"pickup")); tree(b,-5,4); rock(b,4,4); } },
  { name: "the wizard's clearing", desc: "Holding the sword, the agent meets a wizard — it may give.", pal: "day", cam: { ang: -0.8, dist: 11, h: 7 }, hold: true,
    build: (b) => { b.applyImmediate(e("wizard","wizard_npc",2.5,0.5,"talk")); tree(b,-6,-2); tree(b,6,-3); } },
  { name: "the portal at dusk", desc: "A portal to the library glows in the failing light.", pal: "dusk", cam: { ang: 0.6, dist: 12, h: 7.5 },
    build: (b) => { b.applyImmediate(spawnPortalCommand({ label: "library", destination: { kind: "substrate", worldId: "lib" } }, { x: 2.5, y: 0, z: 0 })); rock(b,-4,3); } },
  { name: "the village", desc: "A wizard and two villagers — whom does the agent address?", pal: "day", cam: { ang: -0.3, dist: 14, h: 9 },
    build: (b) => { b.applyImmediate(e("wizard","wizard_npc",3,1,"talk")); b.applyImmediate(e("v1","guard_npc",-3,1,"talk")); b.applyImmediate(e("v2","guard_npc",0,-3,"talk")); tree(b,6,5); } },
  { name: "the rock garden", desc: "Many rocks and one sword — HRR target selection picks one.", pal: "day", cam: { ang: 1.0, dist: 12, h: 7 },
    build: (b) => { b.applyImmediate(e("sword","sword",2,-2,"pickup")); rock(b,-2,2); rock(b,3,3); rock(b,-3,-2); rock(b,1,3); } },
  { name: "the deep forest", desc: "Dense trees. The agent must move to explore.", pal: "forest", cam: { ang: -1.1, dist: 13, h: 8 },
    build: (b) => { for (const [x,z] of [[-5,4],[5,5],[-4,-4],[4,-5],[-6,-1],[6,0],[0,6],[2,-6]]) tree(b,x,z); rock(b,1,1); } },
  { name: "two paths", desc: "A portal and a sword on opposite sides — routing decides.", pal: "dusk", cam: { ang: 0.4, dist: 12, h: 7 },
    build: (b) => { b.applyImmediate(e("sword","sword",3,-1,"pickup")); b.applyImmediate(spawnPortalCommand({ label: "X", destination: { kind: "substrate", worldId: "x" } }, { x: -3, y: 0, z: 1 })); } },
  { name: "the assembly", desc: "Three figures gathered — the model chooses one to address.", pal: "day", cam: { ang: -0.6, dist: 13, h: 8.5 },
    build: (b) => { b.applyImmediate(e("wizard","wizard_npc",2.5,2,"talk")); b.applyImmediate(e("v1","guard_npc",-2.5,2,"talk")); b.applyImmediate(e("wizard2","wizard_npc",0,-3,"talk")); } },
  { name: "treasure field", desc: "Scattered pickups everywhere.", pal: "dawn", cam: { ang: 0.8, dist: 14, h: 9 },
    build: (b) => { b.applyImmediate(e("sword","sword",2,1,"pickup")); b.applyImmediate(e("s2","sword",-3,2,"pickup")); rock(b,3,-2); rock(b,-2,-3); rock(b,1,4); } },
  { name: "night doorway", desc: "Under a dark sky, a single portal waits.", pal: "night", cam: { ang: -0.2, dist: 11, h: 7 },
    build: (b) => { b.applyImmediate(spawnPortalCommand({ label: "deep", destination: { kind: "substrate", worldId: "deep" } }, { x: 2, y: 0, z: 0 })); tree(b,-5,3); tree(b,5,4); } },
  { name: "the long wander", desc: "A wide, sparse world to traverse.", pal: "dawn", cam: { ang: 0.5, dist: 16, h: 10 },
    build: (b) => { b.applyImmediate(e("wizard","wizard_npc",6,2,"talk")); b.applyImmediate(e("sword","sword",-6,-2,"pickup")); tree(b,0,7); rock(b,-7,4); } },
];

function topK(d: Record<string, number>) { let k = "", v = -Infinity; for (const [kk, vv] of Object.entries(d)) if (vv > v) { k = kk; v = vv; } return { sephirah: k, raw: v, refined: v }; }

async function main() {
  const args = process.argv.slice(2);
  const out = (args.find((a) => a.startsWith("--out=")) || "--out=/tmp/agent_oracle_tour.json").slice(6);
  const perScene = parseInt((args.find((a) => a.startsWith("--ticks=")) || "--ticks=4").slice(8));
  const oracle = new HttpOracleClient("http://127.0.0.1:8765");
  try { const h = await oracle.healthz(); console.log("# oracle:", h.ok ? "online step " + h.step : "unhealthy"); } catch (e) { console.log("# oracle unreachable"); }

  const frames: any[] = [];
  let si = 0;
  for (const scene of SCENES) {
    E = 0;
    const world = new World(42);
    const bus = new CommandBus(world, defaultReducer);
    const agents = new AgentSystem();
    const proj = new AsciiProjection({ width: 30, height: 13 });
    proj.init(world); bus.events.on("*", (ev) => proj.onEvent(ev));
    const st = scene.start ?? { x: 0, z: 0 };
    bus.applyImmediate({ kind: "SpawnEntity", id: "agent", prototypeId: "player", transform: { ...identityTransform(), position: { x: st.x, y: 0, z: st.z } }, components: {} });
    agents.register({ id: "agent", agency: "human", perceptionRadius: 14 });
    if (scene.hold) { bus.applyImmediate(e("heldsword","sword",st.x,st.z,"pickup")); bus.applyImmediate({ kind: "PickupEntity", targetId: "heldsword", holderId: "agent" } as any); }
    scene.build(bus);

    for (let t = 0; t < perScene; t++) {
      agents.refreshPerception(world, "agent", t);
      const visibleIds = agents.perceptionOf("agent")?.visibleIds ?? [];
      const me = world.getEntity("agent"); proj.setFocus(me!.transform.position);
      const perception = composePerceptionSubstrate(world, "agent", { radius: 14, includeHolding: true });
      let routingRaw: Record<string, number> = {}; let oracleText = "";
      try {
        const resp = await oracle.query(composePerceptionPrompt(world, "agent", visibleIds), { maxTokens: 14, temperature: 0.9 });
        routingRaw = { ...resp.sephirah_probs } as Record<string, number>; oracleText = resp.text || "";
      } catch { for (const s of SEPHIROTH) routingRaw[s] = 1 / SEPHIROTH.length; oracleText = "(offline)"; }
      const att = doubleRecursiveAttention(routingRaw as Partial<Record<Sephirah, number>>, perception);
      const routingRefined = att.routing as Record<string, number>;
      const sel = composeCommandFromSubstrate(routingRefined as Partial<Record<Sephirah, number>>, perception, world, "agent", { generationPrompt: oracleText });
      const vk: Record<string, number> = {}; for (const [k, v] of perception.visibleByKind) vk[k] = v;
      const meNow = world.getEntity("agent")!;
      frames.push({
        scene: scene.name, sceneDescription: scene.desc, palette: PAL[scene.pal],
        cam: { ang: scene.cam.ang + t * 0.05, dist: scene.cam.dist, h: scene.cam.h },
        tick: frames.length, ascii: proj.renderToString(), visibleKinds: vk,
        routingRaw, routingRefined, topSephirah: topK(routingRefined), oracleText,
        verb: sel.verb, commandKind: sel.command?.kind ?? null, targetId: (sel.command as any)?.targetId ?? null,
        holdingId: (perception as any).holdingId ?? (scene.hold ? "heldsword" : null),
        agentPos: { x: meNow.transform.position.x, z: meNow.transform.position.z },
        sceneEntities: [...world.allEntities()].filter((x) => x.id !== "agent").map((x) => ({ id: x.id, kind: x.prototypeId, x: x.transform.position.x, z: x.transform.position.z })),
      });
      if (sel.command) bus.applyImmediate(sel.command as any);
    }
    si++; console.log(`# ${si}/${SCENES.length} "${scene.name}" (${scene.pal})`);
  }
  writeFileSync(out, JSON.stringify({ frames, meta: { scenes: SCENES.length, perScene, routingMode: "oracle" } }, null, 2));
  console.log(`# ${frames.length} frames -> ${out}`);
}
main();
