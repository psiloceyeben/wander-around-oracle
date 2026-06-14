import { describe, it, expect } from "vitest";
import { promptToSpawnCommand, recipeFromDecomposition } from "../../src/features/recipes/index.js";
import { decomposePrompt } from "../../src/language/index.js";

describe("Feature: recipes", () => {
  it("promptToSpawnCommand for an item returns SpawnEntity with pickup interactable", () => {
    const cmd = promptToSpawnCommand("an iron sword", { x: 0, y: 0, z: 0 });
    expect(cmd?.kind).toBe("SpawnEntity");
    if (cmd?.kind === "SpawnEntity") {
      expect(cmd.prototypeId).toBe("sword");
      expect(cmd.components.interactable?.verb).toBe("pickup");
    }
  });

  it("promptToSpawnCommand for an NPC attaches AI + collider", () => {
    const cmd = promptToSpawnCommand("a wandering wizard", { x: 0, y: 0, z: 0 });
    if (cmd?.kind === "SpawnEntity") {
      expect(cmd.components.ai).toBeDefined();
      expect(cmd.components.ai?.policy).toBe("wander");
      expect(cmd.components.collider?.shape).toBe("capsule");
    }
  });

  it("temple recipe creates 4 column parts", () => {
    const d = decomposePrompt("a marble temple");
    const r = recipeFromDecomposition(d);
    expect(r.parts.length).toBe(4);
    expect(r.parts.every((p) => p.meshTag.startsWith("column"))).toBe(true);
  });

  it("world prompts return null (handled by portals feature)", () => {
    const cmd = promptToSpawnCommand("a world of frozen seas", { x: 0, y: 0, z: 0 });
    expect(cmd).toBeNull();
  });

  it("saveable component is added to all builds (persistent)", () => {
    const cmd = promptToSpawnCommand("a wooden door", { x: 0, y: 0, z: 0 });
    if (cmd?.kind === "SpawnEntity") {
      expect(cmd.components.saveable?.persistent).toBe(true);
    }
  });
});
