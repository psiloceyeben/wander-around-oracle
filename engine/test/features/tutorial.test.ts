import { describe, it, expect } from "vitest";
import { World } from "../../src/world/index.js";
import { CommandBus, defaultReducer } from "../../src/cmd/index.js";
import { FirstLaunchTutorial, COMPANION_ID } from "../../src/features/firstLaunchTutorial/index.js";
import { identityTransform } from "../../src/entity/index.js";

describe("Feature: firstLaunchTutorial", () => {
  it("start spawns companion + enters greet step", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    let spoken: string[] = [];
    const t = new FirstLaunchTutorial(b.events, b, {
      speak: (s) => spoken.push(s),
      schedule: () => {},  // freeze delay-based advancement
    });
    const started = t.start({ playerPosition: { x: 0, y: 0, z: 0 } });
    expect(started).toBe(true);
    expect(t.isActive()).toBe(true);
    expect(w.getEntity(COMPANION_ID)?.prototypeId).toBe("wizard_npc");
    expect(t.currentStepId()).toBe("greet");
    expect(spoken[0]).toMatch(/Hello/);
  });

  it("EntitySpawned event advances from suggest_prompt to applaud_spawn", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    let scheduledFns: Array<() => void> = [];
    const t = new FirstLaunchTutorial(b.events, b, {
      schedule: (fn) => scheduledFns.push(fn),
    });
    t.start();
    // Fire the greet delay to advance to suggest_prompt
    scheduledFns.shift()?.();
    expect(t.currentStepId()).toBe("suggest_prompt");
    // Player spawns something
    b.applyImmediate({
      kind: "SpawnEntity", id: "thing", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    expect(t.currentStepId()).toBe("applaud_spawn");
  });

  it("storage.isCompleted=true blocks start unless force=true", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    let completed = true;
    const t = new FirstLaunchTutorial(b.events, b, {
      storage: {
        isCompleted: () => completed,
        setCompleted: () => { completed = true; },
        reset: () => { completed = false; },
      },
    });
    expect(t.start()).toBe(false);
    expect(t.start({ force: true })).toBe(true);
  });

  it("abort despawns companion", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const t = new FirstLaunchTutorial(b.events, b, { schedule: () => {} });
    t.start();
    expect(w.getEntity(COMPANION_ID)).toBeDefined();
    t.abort();
    expect(w.getEntity(COMPANION_ID)).toBeUndefined();
    expect(t.isActive()).toBe(false);
  });
});
