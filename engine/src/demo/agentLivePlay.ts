// Live terminal playback of the substrate agent. Prints clear-screen +
// ASCII frame + decision line every tick. Intended to be piped through
// asciinema for terminal recording, or watched directly in a terminal.
//
//   asciinema rec demo.cast --command='npx tsx src/demo/agentLivePlay.ts'

import { captureScriptedTour } from "./agentVideoTour.js";

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const r = captureScriptedTour({ outputPath: "/tmp/_unused.html" });
  const frameDelay = Number(process.env.FRAME_DELAY ?? "1500");

  console.log("─".repeat(60));
  console.log("Substrate Agent — Scripted Tour");
  console.log(`${r.frames.length} frames across 8 scenes`);
  console.log("Cognition: PerceptionSubstrate → routing → attention head → cleanup → HRR target");
  console.log("─".repeat(60));
  await sleep(2000);

  let lastScene = "";
  for (const f of r.frames) {
    clearScreen();
    if (f.scene !== lastScene) {
      console.log("━".repeat(60));
      console.log(`▶ ${f.scene}`);
      console.log(`  ${f.sceneDescription}`);
      console.log("━".repeat(60));
      console.log();
      lastScene = f.scene;
    } else {
      console.log("─".repeat(60));
      console.log(`▶ ${f.scene}  ·  tick ${f.tick}`);
      console.log("─".repeat(60));
      console.log();
    }

    console.log(f.ascii);
    console.log();

    const visKinds = Object.entries(f.visibleKinds)
      .map(([k, n]) => `${k}${n > 1 ? "×" + n : ""}`)
      .join("  ");
    console.log(`  see:     ${visKinds || "(nothing)"}`);
    console.log(`  hold:    ${f.holdingId ?? "(nothing)"}`);
    console.log();
    console.log(`  routing: ${f.topSephirahRaw.sephirah} ${f.topSephirahRaw.value.toFixed(2)}  →  ${f.topSephirahRefined.sephirah} ${f.topSephirahRefined.value.toFixed(2)}  (attention refined)`);
    console.log();
    console.log(`  ╭─ DECISION ─────────────────────────╮`);
    console.log(`  │  verb:   ${f.verb.padEnd(28)} │`);
    console.log(`  │  target: ${(f.targetId ?? "(none)").padEnd(28)} │`);
    console.log(`  ╰─────────────────────────────────────╯`);
    console.log();
    console.log(`  scores: ${f.rankedVerbs.slice(0, 4).map((v) => `${v.verb}:${v.score.toFixed(2)}`).join("  ")}`);

    await sleep(frameDelay);
  }

  console.log();
  console.log("─".repeat(60));
  console.log("Tour complete.");
  console.log("─".repeat(60));
}

main().catch((e) => { console.error(e); process.exit(1); });
