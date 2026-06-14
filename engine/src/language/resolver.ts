// Layer 8 — Language substrate.
//
// Text prompts enter as strings; the resolver decomposes them into substrate
// operations. The decomposition reads:
//   prompt -> { intent, primary, modifiers, materials, sephirah }
// and produces a SpawnEntity command with appropriate prototype id,
// transform, components, and Sephirah hint.
//
// The resolver is keyword-driven for the local fast path; for prompts it
// doesn't recognize, it falls back to the Oracle (Layer 7) which provides
// substrate-trained interpretation. Both paths produce the same command
// shape so downstream systems don't distinguish.

import { type Sephirah } from "../hrr/treeOfLife.js";
import { type Command, type SpawnEntityCommand } from "../cmd/types.js";
import { type ComponentBag, identityTransform } from "../entity/types.js";

export type Intent = "object" | "item" | "npc" | "world" | "command";

export interface Decomposition {
  intent: Intent;
  primary: string;           // canonical prototype id
  modifiers: string[];       // ["ancient", "ruined", "tall"]
  materials: string[];       // ["marble", "wood", "iron"]
  styles: string[];          // ["doric", "wizard"]
  sephirah?: Sephirah;       // routing hint
  raw: string;
}

const PRIMARY_TABLE: ReadonlyArray<{ patterns: RegExp[]; primary: string; intent: Intent; sephirah?: Sephirah }> = [
  // Architecture (object intent)
  { patterns: [/\btemple\b/i, /\btemples\b/i], primary: "temple", intent: "object", sephirah: "chesed" },
  { patterns: [/\btower\b/i], primary: "tower", intent: "object", sephirah: "tiferet" },
  { patterns: [/\bcastle\b/i], primary: "castle", intent: "object", sephirah: "geburah" },
  { patterns: [/\bmanor\b/i, /\bmansion\b/i, /\binn\b/i], primary: "manor", intent: "object", sephirah: "chesed" },
  { patterns: [/\bdoor(way)?\b/i], primary: "doorway", intent: "object", sephirah: "yesod" },
  { patterns: [/\bcolumn\b/i, /\bpillar\b/i], primary: "column", intent: "object", sephirah: "malkuth" },
  { patterns: [/\bhouse\b/i, /\bcottage\b/i, /\bhut\b/i], primary: "house", intent: "object", sephirah: "malkuth" },
  { patterns: [/\bbridge\b/i], primary: "bridge", intent: "object", sephirah: "yesod" },
  // Nature
  { patterns: [/\btree\b/i, /\btrees\b/i], primary: "tree", intent: "object", sephirah: "netzach" },
  { patterns: [/\bforest\b/i, /\bgrove\b/i], primary: "grove", intent: "object", sephirah: "netzach" },
  { patterns: [/\brock\b/i, /\bboulder\b/i], primary: "rock", intent: "object", sephirah: "malkuth" },
  // Items
  { patterns: [/\bsword\b/i], primary: "sword", intent: "item", sephirah: "geburah" },
  { patterns: [/\bshield\b/i], primary: "shield", intent: "item", sephirah: "geburah" },
  { patterns: [/\blantern\b/i, /\blamp\b/i], primary: "lantern", intent: "item", sephirah: "hod" },
  { patterns: [/\bstaff\b/i, /\bwand\b/i], primary: "staff", intent: "item", sephirah: "chokmah" },
  { patterns: [/\bbook\b/i, /\btome\b/i], primary: "book", intent: "item", sephirah: "binah" },
  // NPCs
  { patterns: [/\bwizard\b/i, /\bmage\b/i], primary: "wizard_npc", intent: "npc", sephirah: "chokmah" },
  { patterns: [/\bguard\b/i, /\bsoldier\b/i], primary: "guard_npc", intent: "npc", sephirah: "geburah" },
  { patterns: [/\bmerchant\b/i, /\btrader\b/i], primary: "merchant_npc", intent: "npc", sephirah: "malkuth" },
  { patterns: [/\bscholar\b/i, /\bsage\b/i], primary: "scholar_npc", intent: "npc", sephirah: "binah" },
  { patterns: [/\bwolf\b/i], primary: "wolf", intent: "npc", sephirah: "geburah" },
  { patterns: [/\bdeer\b/i, /\bdoe\b/i], primary: "deer", intent: "npc", sephirah: "netzach" },
  // World phrases
  { patterns: [/\bworld of\b/i, /^a world\b/i, /^the world\b/i], primary: "world", intent: "world", sephirah: "keter" },
  { patterns: [/\bisland\b/i], primary: "island", intent: "world", sephirah: "malkuth" },
];

const MATERIAL_TABLE: ReadonlyArray<{ pattern: RegExp; material: string }> = [
  { pattern: /\bmarble\b/i,  material: "marble" },
  { pattern: /\bwood(en)?\b/i, material: "wood" },
  { pattern: /\biron\b/i,    material: "iron" },
  { pattern: /\bstone\b/i,   material: "stone" },
  { pattern: /\bgold(en)?\b/i, material: "gold" },
  { pattern: /\bsilver\b/i,  material: "silver" },
  { pattern: /\bcopper\b/i,  material: "copper" },
  { pattern: /\bcrystal\b/i, material: "crystal" },
  { pattern: /\bbronze\b/i,  material: "bronze" },
  { pattern: /\bsteel\b/i,   material: "steel" },
];

const STYLE_TABLE: ReadonlyArray<{ pattern: RegExp; style: string }> = [
  { pattern: /\bancient\b/i,     style: "ancient" },
  { pattern: /\bruined\b/i,      style: "ruined" },
  { pattern: /\bdoric\b/i,       style: "doric" },
  { pattern: /\bionic\b/i,       style: "ionic" },
  { pattern: /\bcorinthian\b/i,  style: "corinthian" },
  { pattern: /\bwizard\b/i,      style: "wizard" },
  { pattern: /\bfancy\b/i,       style: "fancy" },
  { pattern: /\bfantasy\b/i,     style: "fantasy" },
  { pattern: /\bsmall\b/i,       style: "small" },
  { pattern: /\btall\b/i,        style: "tall" },
  { pattern: /\bbrutalist\b/i,   style: "brutalist" },
  { pattern: /\brenaissance\b/i, style: "renaissance" },
];

const MODIFIER_TABLE: ReadonlyArray<{ pattern: RegExp; modifier: string }> = [
  { pattern: /\bglowing\b/i,  modifier: "glowing" },
  { pattern: /\bbroken\b/i,   modifier: "broken" },
  { pattern: /\benchanted\b/i, modifier: "enchanted" },
  { pattern: /\bhuge\b/i,     modifier: "huge" },
  { pattern: /\btiny\b/i,     modifier: "tiny" },
];

export function decomposePrompt(prompt: string): Decomposition {
  const raw = prompt.trim();
  let primary = "object";
  let intent: Intent = "object";
  let sephirah: Sephirah | undefined;
  for (const row of PRIMARY_TABLE) {
    if (row.patterns.some((p) => p.test(raw))) {
      primary = row.primary;
      intent = row.intent;
      sephirah = row.sephirah;
      break;
    }
  }
  const materials: string[] = [];
  for (const m of MATERIAL_TABLE) if (m.pattern.test(raw)) materials.push(m.material);
  const styles: string[] = [];
  for (const s of STYLE_TABLE) if (s.pattern.test(raw)) styles.push(s.style);
  const modifiers: string[] = [];
  for (const m of MODIFIER_TABLE) if (m.pattern.test(raw)) modifiers.push(m.modifier);
  return { intent, primary, modifiers, materials, styles, sephirah, raw };
}

let _nextEntityIdCounter = 1;
function nextEntityId(prefix: string): string {
  const idx = _nextEntityIdCounter++;
  return `${prefix}-${idx.toString(36)}`;
}

/** Compile a decomposition into a SpawnEntity command at a target position. */
export function decompositionToSpawnCommand(
  decomp: Decomposition,
  position: { x: number; y: number; z: number },
): SpawnEntityCommand {
  const id = nextEntityId(decomp.primary);
  const components: ComponentBag = {
    renderable: { meshTag: decomp.primary },
  };
  // NPCs get an AI component
  if (decomp.intent === "npc") {
    components.ai = { policy: "wander", perceptionRadius: 8, state: {} };
    components.collider = { shape: "capsule", size: { x: 0.5, y: 1.8, z: 0.5 }, solid: true };
  }
  // Items get pickup interactability
  if (decomp.intent === "item") {
    components.interactable = { verb: "pickup", range: 3 };
  }
  // Architecture gets a solid box collider
  if (decomp.intent === "object" && decomp.primary !== "tree" && decomp.primary !== "rock") {
    components.collider = { shape: "box", size: { x: 4, y: 6, z: 4 }, solid: true };
  }
  return {
    kind: "SpawnEntity",
    id,
    prototypeId: decomp.primary,
    transform: { ...identityTransform(), position: { ...position } },
    components,
    sephirah: decomp.sephirah,
  };
}

/** Convenience: full prompt → command pipeline. */
export function promptToCommand(
  prompt: string,
  position: { x: number; y: number; z: number },
): Command | null {
  const decomp = decomposePrompt(prompt);
  if (decomp.intent === "world") {
    // World prompts spawn a portal-doorway rather than an object — that's a
    // distinct command path. For Layer 8 we emit a Spawn of a "doorway" so
    // the engine has something to render; the multi-world Layer 9 layer
    // upgrades portals to cross-world handles.
    return {
      kind: "SpawnEntity",
      id: nextEntityId("doorway"),
      prototypeId: "doorway",
      transform: { ...identityTransform(), position: { ...position } },
      components: {
        renderable: { meshTag: "doorway" },
        interactable: { verb: "use", range: 3, immutable: true },
      },
      sephirah: decomp.sephirah ?? "yesod",
    };
  }
  return decompositionToSpawnCommand(decomp, position);
}
