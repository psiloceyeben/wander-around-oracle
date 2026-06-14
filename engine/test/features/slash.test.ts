import { describe, it, expect } from "vitest";
import { World } from "../../src/world/index.js";
import { CommandBus, defaultReducer } from "../../src/cmd/index.js";
import { SlashDispatcher, defaultSlashCommands } from "../../src/features/slashCommands/index.js";

describe("Feature: slashCommands", () => {
  it("/time 14 emits SetTimeOfDay command", async () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const sd = new SlashDispatcher(b, { hud: () => {} });
    sd.registerMany(defaultSlashCommands({}));
    const events: any[] = [];
    b.events.on("TimeChanged", (e) => events.push(e));
    const r = await sd.dispatch("/time 14");
    b.flush();
    expect(r.ok).toBe(true);
    expect(events).toHaveLength(1);
    if (events[0]?.kind === "TimeChanged") expect(events[0].hours).toBe(14);
  });

  it("unknown command returns ok=false", async () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const sd = new SlashDispatcher(b);
    const r = await sd.dispatch("/nope foo");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown command/);
  });

  it("handler receives parsed tokens AND raw rest", async () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const sd = new SlashDispatcher(b);
    let seenTokens: string[] = [];
    let seenRest = "";
    sd.register({
      name: "echo", args: ["msg"],
      description: "Test handler",
      handler: ({ tokens, rest }) => { seenTokens = tokens; seenRest = rest; },
    });
    await sd.dispatch("/echo hello world how are you");
    expect(seenTokens).toEqual(["hello", "world", "how", "are", "you"]);
    expect(seenRest).toBe("hello world how are you");
  });

  it("autocomplete returns matching commands by prefix", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const sd = new SlashDispatcher(b);
    sd.registerMany(defaultSlashCommands({}));
    const matches = sd.autocomplete("/sa");
    expect(matches.map((c) => c.name)).toContain("save");
  });

  it("save command emits WorldSaved event", async () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    const sd = new SlashDispatcher(b);
    sd.registerMany(defaultSlashCommands({}));
    const events: any[] = [];
    b.events.on("WorldSaved", (e) => events.push(e));
    await sd.dispatch("/save mygame");
    b.flush();
    expect(events).toHaveLength(1);
  });
});
