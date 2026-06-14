// ASCII projection — minimal headless renderer used for tests and CI.
// Renders a 2D top-down view of the world centered on a target position.
// Each entity prototype gets a single-character glyph; the player gets '@'.
// Empty cells are '.'. Useful for verifying the world without a GPU.

import { type Projection, SimpleMeshTagRegistry, entityMeshTag } from "./types.js";
import { World } from "../world/index.js";
import { type EntityRecord } from "../entity/types.js";
import { type GameEvent } from "../cmd/types.js";

/** Paint priority — higher means paints later, winning paint conflicts. */
function entityPaintPriority(prototypeId: string): number {
  if (prototypeId === "player") return 100;
  if (prototypeId.endsWith("_npc")) return 80;
  if (prototypeId === "doorway") return 60;
  if (prototypeId === "sword" || prototypeId === "shield") return 50;
  return 0;
}

const DEFAULT_GLYPHS: Record<string, string> = {
  player:     "@",
  door:       "D",
  doorway:    "O",
  tree:       "T",
  rock:       "*",
  sword:      "/",
  shield:     "U",
  wizard_npc: "w",
  guard_npc:  "g",
  workshop:   "W",
  portal:     "Π",
};

export class AsciiProjection implements Projection {
  readonly name = "ascii";
  private world: World | null = null;
  readonly glyphs = new SimpleMeshTagRegistry<string>(() => "?");
  /** Visible area: 2W+1 by 2H+1 cells centered on focus. */
  width: number = 20;
  height: number = 10;
  focus: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  constructor(opts?: { width?: number; height?: number }) {
    if (opts?.width) this.width = opts.width;
    if (opts?.height) this.height = opts.height;
    for (const [k, g] of Object.entries(DEFAULT_GLYPHS)) {
      this.glyphs.register(k, () => g);
    }
  }

  init(world: World): void {
    this.world = world;
  }

  onEvent(_event: GameEvent): void {
    // ASCII reads world state each render; no incremental state needed.
  }

  render(_alpha: number): string {
    if (!this.world) return "";
    return this.renderToString();
  }

  /** Return the ASCII grid as a string. */
  renderToString(): string {
    if (!this.world) return "";
    const w = this.width, h = this.height;
    const grid: string[][] = [];
    for (let row = 0; row < h; row++) {
      grid.push(new Array(w).fill("."));
    }
    const minX = this.focus.x - Math.floor(w / 2);
    const minZ = this.focus.z - Math.floor(h / 2);

    // Sort entities so the player (and other priority glyphs) paint last,
    // winning the cell paint over biome/foliage. Convention: agency-type
    // entities (player, NPCs) win over decoration.
    const sorted = Array.from(this.world.allEntities()).sort((a, b) => {
      const pa = entityPaintPriority(a.prototypeId);
      const pb = entityPaintPriority(b.prototypeId);
      return pa - pb;
    });
    for (const e of sorted) {
      const cx = Math.floor(e.transform.position.x - minX);
      const cz = Math.floor(e.transform.position.z - minZ);
      if (cx < 0 || cx >= w || cz < 0 || cz >= h) continue;
      grid[cz][cx] = this.glyphs.build(entityMeshTag(e));
    }
    return grid.map((row) => row.join("")).join("\n");
  }

  setFocus(pos: { x: number; y: number; z: number }): void {
    this.focus = { ...pos };
  }

  /** Find an entity at a given grid cell — used for tests. */
  entityAtCell(col: number, row: number): EntityRecord | undefined {
    if (!this.world) return undefined;
    const worldX = this.focus.x - Math.floor(this.width / 2) + col;
    const worldZ = this.focus.z - Math.floor(this.height / 2) + row;
    for (const e of this.world.allEntities()) {
      if (Math.floor(e.transform.position.x) === worldX &&
          Math.floor(e.transform.position.z) === worldZ) return e;
    }
    return undefined;
  }

  destroy(): void {
    this.world = null;
  }
}
