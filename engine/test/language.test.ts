import { describe, it, expect } from "vitest";
import { decomposePrompt, promptToCommand } from "../src/language/index.js";

describe("Layer 8: Language substrate", () => {
  it("identifies temple as object", () => {
    const d = decomposePrompt("a small Doric temple");
    expect(d.intent).toBe("object");
    expect(d.primary).toBe("temple");
    expect(d.styles).toContain("doric");
    expect(d.styles).toContain("small");
    expect(d.sephirah).toBe("chesed");
  });

  it("identifies wizard as NPC and routes to chokmah", () => {
    const d = decomposePrompt("a fancy wizard");
    expect(d.intent).toBe("npc");
    expect(d.primary).toBe("wizard_npc");
    expect(d.sephirah).toBe("chokmah");
  });

  it("identifies sword as item with material", () => {
    const d = decomposePrompt("an iron sword");
    expect(d.intent).toBe("item");
    expect(d.primary).toBe("sword");
    expect(d.materials).toContain("iron");
    expect(d.sephirah).toBe("geburah");
  });

  it("identifies world phrase as world intent", () => {
    const d = decomposePrompt("a world of frozen seas");
    expect(d.intent).toBe("world");
    expect(d.primary).toBe("world");
    expect(d.sephirah).toBe("keter");
  });

  it("falls back to object intent for unrecognized prompts", () => {
    const d = decomposePrompt("a thing that does not match anything specific");
    expect(d.intent).toBe("object");
    expect(d.primary).toBe("object");
  });

  it("promptToCommand emits SpawnEntity with appropriate components", () => {
    const cmd = promptToCommand("a glowing copper lantern", { x: 5, y: 0, z: 5 });
    expect(cmd?.kind).toBe("SpawnEntity");
    if (cmd?.kind === "SpawnEntity") {
      expect(cmd.prototypeId).toBe("lantern");
      expect(cmd.transform.position.x).toBe(5);
      expect(cmd.components.interactable?.verb).toBe("pickup");
      expect(cmd.sephirah).toBe("hod");
    }
  });

  it("promptToCommand for world prompt creates a doorway portal", () => {
    const cmd = promptToCommand("a world of marble cities", { x: 0, y: 0, z: 0 });
    expect(cmd?.kind).toBe("SpawnEntity");
    if (cmd?.kind === "SpawnEntity") {
      expect(cmd.prototypeId).toBe("doorway");
      expect(cmd.components.interactable?.immutable).toBe(true);
    }
  });

  it("NPC prompt produces entity with AI component", () => {
    const cmd = promptToCommand("a wandering scholar", { x: 0, y: 0, z: 0 });
    if (cmd?.kind === "SpawnEntity") {
      expect(cmd.components.ai).toBeDefined();
      expect(cmd.components.ai?.policy).toBe("wander");
    }
  });
});
