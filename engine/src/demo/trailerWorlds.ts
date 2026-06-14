// Describe-and-wander TRAILER generator. Runs the REAL biome worldgen sim for a
// set of diverse worlds + spawns a landmark structure (recipes), then emits a
// forward-dolly "walking through it" camera path + build-in animation + clean
// captions per frame for the trailer harness. No research telemetry — this sells
// the experience: "you describe it, you walk into it."
//   npx tsx src/demo/trailerWorlds.ts [--out=/tmp/trailer.json] [--per=10]

import { generateChunkCommands } from "../features/biomeWorldgen/biome.js";
import { promptToSpawnCommand } from "../features/recipes/index.js";
import { writeFileSync } from "node:fs";

const PAL: Record<string, any> = {
  dawn:   { ground: 0x6a6048, sky: 0x3a3550, sun: 0xffd0b0, amb: 0x9a90b0, fog: [22, 60] },
  forest: { ground: 0x3a4a28, sky: 0x141a10, sun: 0xd0e0a0, amb: 0x8a9a70, fog: [16, 46] },
  frozen: { ground: 0xc4d2e2, sky: 0x16243a, sun: 0xbcd0ee, amb: 0x6a82a8, fog: [16, 48] },
  desert: { ground: 0xb89a5a, sky: 0x5a4a3a, sun: 0xffe0a0, amb: 0xc0a878, fog: [24, 64] },
  dusk:   { ground: 0x4a4030, sky: 0x2a1f30, sun: 0xff9050, amb: 0x9a70a0, fog: [16, 44] },
  coast:  { ground: 0xc2b078, sky: 0x3a4258, sun: 0xffcf9a, amb: 0x8aa0b8, fog: [20, 56] },
};

interface WSpec { caption: string; band: number[]; pal: string; structure: string; }
const WORLDS: WSpec[] = [
  { caption: "“a woodland at first light”",          band: [0, 1, 2],     pal: "dawn",   structure: "a tall stone tower" },
  { caption: "“a frozen waste under a pale sky”",     band: [-6, -5, -4],  pal: "frozen", structure: "an obelisk" },
  { caption: "“a desert, an ancient temple”",         band: [3, 4],        pal: "desert", structure: "an ancient temple" },
  { caption: "“a mountain pass at dusk”",             band: [-3, -2],      pal: "dusk",   structure: "a watchtower" },
  { caption: "“a palm coastline”",                    band: [5, 6, 7],     pal: "coast",  structure: "a wooden tower" },
];

function main() {
  const args = process.argv.slice(2);
  const out = (args.find((a) => a.startsWith("--out=")) || "--out=/tmp/trailer.json").slice(6);
  const per = parseInt((args.find((a) => a.startsWith("--per=")) || "--per=10").slice(6));
  const seed = 42;
  const frames: any[] = [];
  let rngS = 12345;
  const rng = () => { rngS = (rngS * 1103515245 + 12345) & 0x7fffffff; return rngS / 0x7fffffff; };
  const title = (t: string, s: string, n: number) => { for (let i = 0; i < n; i++) frames.push({ isTitle: true, title: t, subtitle: s, palette: PAL.dawn, fade: Math.min(1, Math.min(i + 1, n - i) / 2.5) }); };

  title("WANDER · AROUND", "you describe it —  you walk into it", 10);
  for (const w of WORLDS) {
    let ents: any[] = [];
    for (const cz of w.band) for (let cx = -2; cx <= 2; cx++) {
      const { commands } = generateChunkCommands({ cx, cy: 0, cz }, seed);
      for (const c of commands) ents.push({ kind: c.prototypeId, x: c.transform.position.x, z: c.transform.position.z });
    }
    // recenter around origin
    if (ents.length) {
      const mx = ents.reduce((s, e) => s + e.x, 0) / ents.length;
      const mz = ents.reduce((s, e) => s + e.z, 0) / ents.length;
      ents.forEach((e) => { e.x -= mx; e.z -= mz; });
    }
    // cap density for render perf (sample)
    if (ents.length > 220) { ents = ents.filter(() => rng() < 220 / ents.length); }
    // landmark structure at center
    try {
      const cmd: any = promptToSpawnCommand(w.structure, { x: 0, y: 0, z: 0 });
      if (cmd && cmd.prototypeId) ents.push({ kind: cmd.prototypeId, x: 0, z: 0, landmark: true });
      else ents.push({ kind: "tower", x: 0, z: 0, landmark: true });
    } catch { ents.push({ kind: "tower", x: 0, z: 0, landmark: true }); }

    for (let t = 0; t < per; t++) {
      const p = t / (per - 1);
      const ang = -1.15 + p * 1.5;          // arc around the landmark
      const R = 24 - p * 11;                 // glide inward (approach)
      const H = 8.5 - p * 3;
      const cam = { px: Math.sin(ang) * R, py: H, pz: Math.cos(ang) * R, lx: 0, ly: 1.6, lz: 0 };
      const assembly = Math.min(1, t / 3.5);
      const typeChars = Math.min(w.caption.length, Math.round((t / 5) * w.caption.length));
      frames.push({ caption: w.caption, typeChars, palette: PAL[w.pal], assembly, cam, entities: ents });
    }
  }
  title("WANDER · AROUND", "wanderaround.io", 8);
  writeFileSync(out, JSON.stringify({ frames, meta: { worlds: WORLDS.length, per } }, null, 0));
  console.log(`# ${frames.length} trailer frames (${WORLDS.length} worlds) -> ${out}`);
}
main();
