// Feature: Workshop editor.
//
// A workshop session is an isolated context where the player composes a
// part-tree creation, then saves it as a named Creation that can be spawned
// later. The workshop is a UI surface on top of the engine — all mutations
// flow through commands (SpawnEntity / EditComponents / RemoveEntity).
//
// Persistence: creations are stored separately from the main world save
// (per-player creation library) so they survive world-reset.

import { CommandBus } from "../../cmd/bus.js";
import { World } from "../../world/world.js";
import { type EntityId, identityTransform } from "../../entity/types.js";
import { decomposePrompt } from "../../language/resolver.js";

export interface Creation {
  id: string;
  name: string;
  description: string;
  prototypeId: string;
  /** Representative mesh tag for the root entity so the projection renders a
   *  recognizable mesh (the first part's tag) rather than the synthetic
   *  `creation:Name` prototype which has no registered builder. */
  meshTag: string;
  parts: Array<{ id: string; renderableTag: string; transform: any }>;
  createdAt: number;
}

export interface CreationLibrary {
  list(): Creation[];
  save(c: Creation): void;
  load(id: string): Creation | undefined;
  remove(id: string): void;
}

export class InMemoryCreationLibrary implements CreationLibrary {
  private byId = new Map<string, Creation>();
  list(): Creation[] { return Array.from(this.byId.values()).sort((a, b) => b.createdAt - a.createdAt); }
  save(c: Creation): void { this.byId.set(c.id, c); }
  load(id: string): Creation | undefined { return this.byId.get(id); }
  remove(id: string): void { this.byId.delete(id); }
}

let _workshopIdCounter = 1;
function nextWorkshopId(): string { return `workshop-${(_workshopIdCounter++).toString(36)}`; }

export class WorkshopSession {
  readonly id: string;
  readonly bus: CommandBus;
  readonly world: World;
  readonly origin: { x: number; y: number; z: number };
  readonly partIds: EntityId[] = [];
  private active = true;

  constructor(opts: {
    bus: CommandBus;
    world: World;
    origin?: { x: number; y: number; z: number };
  }) {
    this.id = nextWorkshopId();
    this.bus = opts.bus;
    this.world = opts.world;
    this.origin = opts.origin ?? { x: 0, y: 0, z: 0 };
  }

  isActive(): boolean { return this.active; }

  /** Add a part to the workshop bench at offset from the workshop origin. */
  addPart(prototypeId: string, offset: { x: number; y: number; z: number }, meshTag?: string): EntityId {
    const id = `${this.id}-part-${this.partIds.length}`;
    const pos = {
      x: this.origin.x + offset.x,
      y: this.origin.y + offset.y,
      z: this.origin.z + offset.z,
    };
    this.bus.applyImmediate({
      kind: "SpawnEntity",
      id, prototypeId,
      transform: { ...identityTransform(), position: pos },
      components: {
        renderable: { meshTag: meshTag ?? prototypeId },
        // No saveable — workshop parts are ephemeral until saved as a Creation
      },
    });
    this.partIds.push(id);
    return id;
  }

  /** Convenience: decompose a natural-language prompt into a prototype + mesh
   *  tag and add it as a bench part, auto-spreading parts so they don't stack.
   *  Returns the spawned part's entity id. */
  addPartByPrompt(prompt: string): EntityId {
    const d = decomposePrompt(prompt);
    const primary = d.primary === "object" || d.intent === "world" ? "rock" : d.primary;
    const material = d.materials[0];
    const meshTag = material ? `${primary}_${material}` : primary;
    // Spread parts on a small grid around the bench origin.
    const n = this.partIds.length;
    const offset = { x: (n % 3) * 1.5 - 1.5, y: 0, z: Math.floor(n / 3) * 1.5 };
    return this.addPart(primary, offset, meshTag);
  }

  /** The bench parts as lightweight descriptors for UI listing. */
  listParts(): Array<{ id: EntityId; meshTag: string }> {
    return this.partIds.map((id) => {
      const e = this.world.getEntity(id);
      return { id, meshTag: e?.components.renderable?.meshTag ?? "part" };
    });
  }

  /** Remove a part from the bench. */
  removePart(id: EntityId): void {
    const idx = this.partIds.indexOf(id);
    if (idx >= 0) {
      this.partIds.splice(idx, 1);
      this.bus.applyImmediate({ kind: "RemoveEntity", id });
    }
  }

  /** Snapshot the bench as a Creation and persist to the library. */
  save(library: CreationLibrary, name: string, description: string = ""): Creation {
    const parts: Creation["parts"] = [];
    for (const id of this.partIds) {
      const e = this.world.getEntity(id);
      if (!e) continue;
      parts.push({
        id,
        renderableTag: e.components.renderable?.meshTag ?? e.prototypeId,
        transform: {
          position: {
            x: e.transform.position.x - this.origin.x,
            y: e.transform.position.y - this.origin.y,
            z: e.transform.position.z - this.origin.z,
          },
          rotation: e.transform.rotation,
          scale: e.transform.scale,
        },
      });
    }
    const creation: Creation = {
      id: `creation-${Date.now().toString(36)}`,
      name,
      description,
      prototypeId: `creation:${name}`,
      // Render the root as the first part's mesh so the projection shows a
      // recognizable object; if there are no parts, fall back to a rock.
      meshTag: parts[0]?.renderableTag ?? "rock",
      parts,
      createdAt: Date.now(),
    };
    library.save(creation);
    return creation;
  }

  /** Convenience wrapper around save() with sensible defaults — derives a name
   *  if none is given. Returns the created Creation. */
  saveToLibrary(library: CreationLibrary, name?: string, description: string = ""): Creation {
    const finalName = (name && name.trim()) || `creation ${new Date().toLocaleTimeString()}`;
    return this.save(library, finalName, description);
  }

  /** End the session — remove all parts from the world. */
  close(): void {
    if (!this.active) return;
    this.active = false;
    for (const id of this.partIds.slice()) this.removePart(id);
  }
}

/** Spawn a saved creation into the world at a position. Returns the root entity id. */
export function spawnCreation(creation: Creation, bus: CommandBus, position: { x: number; y: number; z: number }): EntityId {
  const rootId = `${creation.id}-${Date.now().toString(36)}`;
  bus.applyImmediate({
    kind: "SpawnEntity",
    id: rootId,
    prototypeId: creation.prototypeId,
    transform: { ...identityTransform(), position: { ...position } },
    components: {
      // Use the representative mesh tag (a registered builder) rather than the
      // synthetic `creation:Name` prototype, which has no builder and would
      // render as the gray fallback cube.
      renderable: { meshTag: creation.meshTag ?? creation.parts[0]?.renderableTag ?? "rock" },
      partTree: {
        parts: creation.parts.map((p) => ({
          id: p.id,
          transform: p.transform,
          renderableTag: p.renderableTag,
        })),
      },
      saveable: { persistent: true },
    },
    sephirah: "tiferet",
  });
  return rootId;
}
