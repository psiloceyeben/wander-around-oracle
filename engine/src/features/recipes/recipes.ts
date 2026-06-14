// Feature: Recipes — prompt → recipe → SpawnEntity command.
//
// Extends Layer 8's promptToCommand with richer recipe components:
//   - Materials from decomposition map to mesh tags
//   - Modifiers map to render component variants
//   - Behavior policy attached to NPC entities
//   - Part-tree for compound entities
//
// All output flows as SpawnEntity commands; no direct world mutation.

import { type Command, type SpawnEntityCommand } from "../../cmd/types.js";
import { type ComponentBag, identityTransform } from "../../entity/types.js";
import { decomposePrompt, type Decomposition } from "../../language/resolver.js";

export interface RecipePart {
  id: string;
  meshTag: string;
  offset?: { x: number; y: number; z: number };
}

export interface Recipe {
  id: string;
  prototypeId: string;
  meshTag: string;
  parts: RecipePart[];
  material?: string;
  decomp: Decomposition;
}

let _idCounter = 1;
function nextId(prefix: string): string { return `${prefix}-${(_idCounter++).toString(36)}`; }

export function recipeFromDecomposition(d: Decomposition): Recipe {
  const id = nextId(d.primary);
  const material = d.materials[0];
  const meshTag = material ? `${d.primary}_${material}` : d.primary;
  // Compound entities: temples get column parts, NPCs get body+head+arms
  const parts: RecipePart[] = [];
  if (d.primary === "temple") {
    for (let i = 0; i < 4; i++) {
      parts.push({
        id: `${id}-col${i}`,
        meshTag: material ? `column_${material}` : "column",
        offset: { x: (i % 2 ? 2 : -2), y: 0, z: (i < 2 ? -2 : 2) },
      });
    }
  } else if (d.intent === "npc") {
    parts.push({ id: `${id}-body`, meshTag: `${d.primary}_body`, offset: { x: 0, y: 0.5, z: 0 } });
    parts.push({ id: `${id}-head`, meshTag: `${d.primary}_head`, offset: { x: 0, y: 1.4, z: 0 } });
  }
  return { id, prototypeId: d.primary, meshTag, parts, material, decomp: d };
}

/** Recipe → SpawnEntity command. Components derived from recipe + intent. */
export function recipeToSpawnCommand(
  r: Recipe,
  position: { x: number; y: number; z: number },
): SpawnEntityCommand {
  const components: ComponentBag = {
    renderable: { meshTag: r.meshTag },
  };
  if (r.parts.length > 0) {
    components.partTree = {
      parts: r.parts.map((p) => ({
        id: p.id,
        transform: { ...identityTransform(), position: p.offset ?? { x: 0, y: 0, z: 0 } },
        renderableTag: p.meshTag,
      })),
    };
  }
  if (r.decomp.intent === "npc") {
    components.ai = { policy: "wander", perceptionRadius: 10, state: {} };
    components.collider = { shape: "capsule", size: { x: 0.5, y: 1.8, z: 0.5 }, solid: true };
  }
  if (r.decomp.intent === "item") {
    components.interactable = { verb: "pickup", range: 3 };
    components.collider = { shape: "box", size: { x: 0.4, y: 0.4, z: 0.4 }, solid: false };
  }
  if (r.decomp.intent === "object") {
    // Architecture-class collider, sized by primary. Enterable buildings
    // (house/tower/castle) are bounding-only (solid: false) — the game
    // client enforces their wall plans, door gaps included. Low solids
    // (temple platform, bridge deck) stay solid so they read as floor.
    const ARCH: Record<string, { size: { x: number; y: number; z: number }; solid: boolean }> = {
      tree:   { size: { x: 1.5, y: 5.0, z: 1.5 }, solid: true },
      rock:   { size: { x: 1.0, y: 1.0, z: 1.0 }, solid: true },
      house:  { size: { x: 3.6, y: 2.5, z: 3.0 }, solid: false },
      tower:  { size: { x: 2.7, y: 5.0, z: 2.7 }, solid: false },
      castle: { size: { x: 7.6, y: 2.9, z: 7.6 }, solid: false },
      manor:  { size: { x: 8.6, y: 3.0, z: 4.4 }, solid: false },
      temple: { size: { x: 5.4, y: 0.36, z: 3.8 }, solid: true },
      bridge: { size: { x: 3.6, y: 0.5, z: 1.2 }, solid: true },
      grove:  { size: { x: 0.6, y: 0.6, z: 0.6 }, solid: false },
      column: { size: { x: 0.5, y: 2.4, z: 0.5 }, solid: true },
    };
    const a = ARCH[r.decomp.primary] ?? { size: { x: 2.5, y: 3.5, z: 2.5 }, solid: true };
    components.collider = { shape: "box", size: { ...a.size }, solid: a.solid };
  }
  components.saveable = { persistent: true };
  return {
    kind: "SpawnEntity",
    id: r.id,
    prototypeId: r.prototypeId,
    transform: { ...identityTransform(), position: { ...position } },
    components,
    sephirah: r.decomp.sephirah,
  };
}

/** Full pipeline: text prompt → command. */
export function promptToSpawnCommand(prompt: string, position: { x: number; y: number; z: number }): Command | null {
  const d = decomposePrompt(prompt);
  if (d.intent === "world") {
    // World prompts spawn portal-doorway (handled by portals feature)
    return null;
  }
  return recipeToSpawnCommand(recipeFromDecomposition(d), position);
}
