import { describe, it, expect } from "vitest";
import { InputRegistry } from "../../src/agent/inputRegistry.js";
import { renderHelpText } from "../../src/features/helpOverlay/index.js";
import { World } from "../../src/world/index.js";
import { CommandBus, defaultReducer } from "../../src/cmd/index.js";
import { WorkshopSession, InMemoryCreationLibrary, spawnCreation } from "../../src/features/workshop/index.js";
import { FPSGuardrail, QUALITY_LOW, QUALITY_HIGH } from "../../src/features/fpsGuardrail/index.js";
import { SimpleStyleRegistry, RenderStyleManager } from "../../src/features/renderStyles/index.js";
import { AsciiProjection } from "../../src/projection/index.js";
import { generateChunkCommands, biomeFor, BiomeStreamingSystem } from "../../src/features/biomeWorldgen/index.js";
import { wanderPolicy, followPolicy, adaptivePolicy } from "../../src/features/npcBehavior/index.js";
import { AmbientPolish } from "../../src/features/ambientPolish/index.js";
import { identityTransform } from "../../src/entity/index.js";

describe("Feature: InputRegistry", () => {
  it("register + findMatches finds binding by code", () => {
    const r = new InputRegistry();
    let fired = 0;
    r.register({
      code: "KeyE", contexts: ["play"],
      action: "Test", description: "Test handler",
      handler: () => { fired++; return true; },
      ownerModule: "test",
    });
    const e = { code: "KeyE", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false } as any;
    const matches = r.findMatches(e, "play");
    expect(matches.length).toBe(1);
    matches[0].handler(e);
    expect(fired).toBe(1);
  });

  it("findConflicts detects same-key same-context bindings", () => {
    const r = new InputRegistry();
    r.register({ code: "KeyE", contexts: ["play"], action: "A", description: "A", handler: () => {}, ownerModule: "modA" });
    r.register({ code: "KeyE", contexts: ["play"], action: "B", description: "B", handler: () => {}, ownerModule: "modB" });
    const conflicts = r.findConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].key).toBe("KeyE");
  });
});

describe("Feature: helpOverlay", () => {
  it("renderHelpText produces output with registered bindings", () => {
    const r = new InputRegistry();
    r.register({ code: "KeyE", contexts: ["play"], action: "Pickup", description: "Pick up entity", handler: () => {}, ownerModule: "pickup" });
    const text = renderHelpText({ inputs: r });
    expect(text).toContain("Pickup");
    expect(text).toContain("E");
    expect(text).toContain("pickup");
  });

  it("includes slash commands when provided", () => {
    const r = new InputRegistry();
    const text = renderHelpText({
      inputs: r,
      slashCommands: [{ name: "save", args: ["name"], description: "Save world", handler: () => {} }],
    });
    expect(text).toContain("/save");
    expect(text).toContain("Save world");
  });
});

describe("Feature: workshop", () => {
  it("addPart spawns entity at offset from origin", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const sess = new WorkshopSession({ bus: b, world: w, origin: { x: 10, y: 0, z: 10 } });
    const id = sess.addPart("column", { x: 2, y: 0, z: 0 });
    expect(w.getEntity(id)?.transform.position.x).toBe(12);
    expect(sess.partIds.length).toBe(1);
  });

  it("save creates a Creation in the library", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const lib = new InMemoryCreationLibrary();
    const sess = new WorkshopSession({ bus: b, world: w });
    sess.addPart("column", { x: -2, y: 0, z: 0 });
    sess.addPart("column", { x:  2, y: 0, z: 0 });
    const c = sess.save(lib, "my-arch", "two columns");
    expect(c.parts.length).toBe(2);
    expect(lib.list().length).toBe(1);
  });

  it("spawnCreation places parts into world", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const lib = new InMemoryCreationLibrary();
    const sess = new WorkshopSession({ bus: b, world: w });
    sess.addPart("rock", { x: 0, y: 0, z: 0 });
    const c = sess.save(lib, "rocky");
    sess.close();
    const rootId = spawnCreation(c, b, { x: 100, y: 0, z: 100 });
    const root = w.getEntity(rootId);
    expect(root?.components.partTree?.parts.length).toBe(1);
  });
});

describe("Feature: fpsGuardrail", () => {
  it("applies low preset when threshold breached", async () => {
    let applied: any = null;
    const tref = { t: 0 };
    const g = new FPSGuardrail({
      thresholdFps: 30,
      measurementSeconds: 0.05,
      applyQuality: (q) => { applied = q; },
      promptUser: async () => "low",
      now: () => tref.t,
    });
    g.init();
    for (let i = 0; i < 5; i++) {
      tref.t += 50;  // 20fps
      g.tick();
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(applied).toEqual(QUALITY_LOW);
  });

  it("keeps high preset when fps is above threshold", async () => {
    let applied: any = null;
    const tref = { t: 0 };
    const g = new FPSGuardrail({
      thresholdFps: 30,
      measurementSeconds: 0.05,
      applyQuality: (q) => { applied = q; },
      now: () => tref.t,
    });
    g.init();
    for (let i = 0; i < 5; i++) {
      tref.t += 16;  // 60fps
      g.tick();
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(applied).toBeNull();
  });

  it("QUALITY_LOW preset has reduced pixel ratio and biome radius", () => {
    expect(QUALITY_LOW.pixelRatio).toBeLessThan(QUALITY_HIGH.pixelRatio);
    expect(QUALITY_LOW.biomeRadiusChunks).toBeLessThan(QUALITY_HIGH.biomeRadiusChunks);
  });
});

describe("Feature: renderStyles", () => {
  it("registers + swaps projections", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const reg = new SimpleStyleRegistry();
    reg.register("ascii", () => new AsciiProjection({ width: 5, height: 5 }));
    const mgr = new RenderStyleManager({ world: w, events: b.events, registry: reg, initial: "ascii" });
    expect(mgr.current()).toBe("ascii");
    expect(mgr.currentProjection()?.name).toBe("ascii");
  });

  it("style swap tears down + reinitializes", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const reg = new SimpleStyleRegistry();
    reg.register("ascii", () => new AsciiProjection({ width: 5, height: 5 }));
    reg.register("paper-mario", () => new AsciiProjection({ width: 10, height: 10 }));
    const mgr = new RenderStyleManager({ world: w, events: b.events, registry: reg, initial: "ascii" });
    mgr.swap("paper-mario");
    expect(mgr.current()).toBe("paper-mario");
  });
});

describe("Feature: biomeWorldgen", () => {
  it("biomeFor is deterministic", () => {
    const a = biomeFor({ cx: 5, cy: 0, cz: 2 }, 42);
    const b = biomeFor({ cx: 5, cy: 0, cz: 2 }, 42);
    expect(a).toBe(b);
  });

  it("generateChunkCommands produces entities", () => {
    const { commands, biome } = generateChunkCommands({ cx: 0, cy: 0, cz: 0 }, 100);
    expect(biome).toBeDefined();
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((c) => c.kind === "SpawnEntity")).toBe(true);
  });

  it("BiomeStreamingSystem loads chunks within radius", () => {
    const w = new World(7);
    const b = new CommandBus(w, defaultReducer);
    const sys = new BiomeStreamingSystem({ radiusChunks: 1 });
    sys.tick(w, b, { x: 0, y: 0, z: 0 });
    // 3x3 = 9 chunks around player
    expect(sys.loadedCount()).toBe(9);
    expect(w.entityCount()).toBeGreaterThan(0);
  });
});

describe("Feature: npcBehavior", () => {
  it("wanderPolicy produces a small move command", () => {
    const w = new World();
    w.addEntity({ id: "npc", prototypeId: "rock", transform: identityTransform(), components: {} });
    const policy = wanderPolicy({ step: 0.2 });
    const cmds = policy({ agentId: "npc", world: w, perception: { visibleIds: [], refreshedAtTick: 1 }, tick: 1 });
    expect(cmds.length).toBe(1);
    expect(cmds[0].kind).toBe("MoveEntity");
  });

  it("followPolicy moves toward visible target", () => {
    const w = new World();
    w.addEntity({ id: "npc", prototypeId: "guard", transform: identityTransform(), components: {} });
    w.addEntity({ id: "target", prototypeId: "player", transform: { ...identityTransform(), position: { x: 10, y: 0, z: 0 } }, components: {} });
    const policy = followPolicy();
    const cmds = policy({ agentId: "npc", world: w, perception: { visibleIds: ["target"], refreshedAtTick: 1 }, tick: 1 });
    expect(cmds.length).toBe(1);
    if (cmds[0].kind === "MoveEntity") {
      expect(cmds[0].transform.position!.x).toBeGreaterThan(0);
    }
  });

  it("adaptivePolicy switches modes by distance", () => {
    const w = new World();
    w.addEntity({ id: "npc", prototypeId: "guard", transform: identityTransform(), components: {} });
    w.addEntity({ id: "p", prototypeId: "player", transform: { ...identityTransform(), position: { x: 3, y: 0, z: 0 } }, components: {} });
    const policy = adaptivePolicy({ hostileRange: 5, followRange: 12 });
    const cmds = policy({ agentId: "npc", world: w, perception: { visibleIds: ["p"], refreshedAtTick: 1 }, tick: 1 });
    expect(cmds.length).toBeGreaterThan(0);
  });
});

describe("Feature: ambientPolish", () => {
  it("emits chime on EntitySpawned event", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const chimes: string[] = [];
    const amb = new AmbientPolish(b.events, { playChime: (k) => chimes.push(k) });
    amb.attach();
    b.applyImmediate({
      kind: "SpawnEntity", id: "x", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    expect(chimes).toContain("built");
  });

  it("footstep cadence respects interval", () => {
    const ntime = { t: 0 };
    let steps = 0;
    const events = new (class { on = () => () => {}; emit = () => {}; } as any)();
    const amb = new AmbientPolish(events, { playFootstep: () => steps++ }, { now: () => ntime.t });
    amb.tickFootsteps(true, "grass");
    ntime.t = 100;
    amb.tickFootsteps(true, "grass");  // < 350ms threshold
    ntime.t = 500;
    amb.tickFootsteps(true, "grass");  // > threshold
    expect(steps).toBe(2);
  });
});
