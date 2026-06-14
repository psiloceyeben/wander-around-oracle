import { describe, it, expect } from "vitest";
import { World } from "../src/world/index.js";
import { Scheduler, BASE_TICK_HZ } from "../src/time/index.js";

describe("Layer 3: Time substrate", () => {
  it("tick increments per step", () => {
    const w = new World();
    const s = new Scheduler(w);
    expect(w.tick).toBe(0);
    s.step();
    expect(w.tick).toBe(1);
    s.stepN(10);
    expect(w.tick).toBe(11);
  });

  it("every-1 system runs on every tick", () => {
    const w = new World();
    const s = new Scheduler(w);
    let count = 0;
    s.register({ name: "test", every: 1, system: () => { count++; } });
    s.stepN(10);
    expect(count).toBe(10);
  });

  it("every-N system runs every Nth tick", () => {
    const w = new World();
    const s = new Scheduler(w);
    let count1 = 0;
    let count6 = 0;
    s.register({ name: "fast", every: 1, system: () => { count1++; } });
    s.register({ name: "slow", every: 6, system: () => { count6++; } });
    s.stepN(60);
    expect(count1).toBe(60);
    expect(count6).toBe(10);  // ticks 6, 12, 18, 24, 30, 36, 42, 48, 54, 60
  });

  it("dt reflects multi-rate cadence", () => {
    const w = new World();
    const s = new Scheduler(w);
    let lastDt = 0;
    s.register({ name: "slow", every: 6, system: (ctx) => { lastDt = ctx.dt; } });
    s.stepN(60);
    // Each invocation should see dt = 6 * (1/60) = 0.1s
    expect(lastDt).toBeCloseTo(0.1, 4);
  });

  it("priority orders systems within the same tick", () => {
    const w = new World();
    const s = new Scheduler(w);
    const order: string[] = [];
    s.register({ name: "low",  every: 1, priority: 0,  system: () => order.push("low") });
    s.register({ name: "high", every: 1, priority: 10, system: () => order.push("high") });
    s.register({ name: "mid",  every: 1, priority: 5,  system: () => order.push("mid") });
    s.step();
    expect(order).toEqual(["high", "mid", "low"]);
  });

  it("unregister removes a system", () => {
    const w = new World();
    const s = new Scheduler(w);
    let count = 0;
    s.register({ name: "test", every: 1, system: () => { count++; } });
    s.step();
    expect(count).toBe(1);
    s.unregister("test");
    s.step();
    expect(count).toBe(1);
  });

  it("runFor advances world tick at BASE_TICK_HZ", () => {
    const w = new World();
    const s = new Scheduler(w);
    s.runFor(0.5);
    expect(w.tick).toBe(BASE_TICK_HZ / 2);
  });

  it("system receives world reference", () => {
    const w = new World();
    const s = new Scheduler(w);
    let seenWorld: World | null = null;
    s.register({ name: "test", every: 1, system: (ctx) => { seenWorld = ctx.world; } });
    s.step();
    expect(seenWorld).toBe(w);
  });
});
