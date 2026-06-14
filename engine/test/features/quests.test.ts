import { describe, it, expect } from "vitest";
import { World } from "../../src/world/index.js";
import { CommandBus, defaultReducer } from "../../src/cmd/index.js";
import { QuestSystem, LAUNCH_QUESTS } from "../../src/features/quests/index.js";
import { identityTransform } from "../../src/entity/index.js";

describe("Feature: quests", () => {
  it("attach + spawn completes q-first-build", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    let completedQ: string | null = null;
    const qs = new QuestSystem({ onComplete: (q) => { completedQ = q.id; } });
    qs.addMany(LAUNCH_QUESTS);
    qs.attach(b.events);

    b.applyImmediate({
      kind: "SpawnEntity", id: "x", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    expect(completedQ).toBe("q-first-build");
    expect(qs.isCompleted("q-first-build")).toBe(true);
  });

  it("temple spawn completes q-build-temple", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const qs = new QuestSystem();
    qs.addMany(LAUNCH_QUESTS);
    qs.attach(b.events);
    b.applyImmediate({
      kind: "SpawnEntity", id: "t1", prototypeId: "temple",
      transform: identityTransform(), components: {},
    });
    expect(qs.isCompleted("q-build-temple")).toBe(true);
  });

  it("five builds completes q-five-builds", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const qs = new QuestSystem();
    qs.addMany(LAUNCH_QUESTS);
    qs.attach(b.events);
    for (let i = 0; i < 5; i++) {
      b.applyImmediate({
        kind: "SpawnEntity", id: `b${i}`, prototypeId: "rock",
        transform: identityTransform(), components: {},
      });
    }
    expect(qs.isCompleted("q-five-builds")).toBe(true);
  });

  it("progress reports total + completed counts", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const qs = new QuestSystem();
    qs.addMany(LAUNCH_QUESTS);
    qs.attach(b.events);
    b.applyImmediate({
      kind: "SpawnEntity", id: "x", prototypeId: "wizard_npc",
      transform: identityTransform(), components: {},
    });
    const p = qs.progress();
    expect(p.total).toBe(LAUNCH_QUESTS.length);
    expect(p.completed).toBe(1);
    expect(p.completedIds).toContain("q-first-build");
  });
});
