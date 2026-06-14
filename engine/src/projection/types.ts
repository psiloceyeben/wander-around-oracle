// Layer 5 — Projection substrate.
//
// A projection is a function (World) → render output. Multiple projections
// can coexist; the player chooses which to view. The world is never
// projection-aware: it does not know if it is being rendered as Three.js
// 3D, as ASCII text, as a voxel grid, or as Paper Mario. Switching styles
// is swapping the projection, not modifying the world.
//
// This is the architectural answer to render-style switching that the v7.2
// game struggled with. In v7.2 the scene graph was the source of truth, so
// re-styling required mutating mesh materials in place — expensive and
// buggy. Here the world is HRR substrate; the projection reads it and
// produces output.
//
// The renderer interface below is generic across projections. Three.js,
// ASCII, voxel, and any future style all implement the same interface.

import { type EntityRecord } from "../entity/types.js";
import { type GameEvent } from "../cmd/types.js";
import { World } from "../world/index.js";

/** A projection consumes world state and events, produces a render artifact.
 *  The lifecycle: attach once at startup, receive every game event, refresh
 *  the artifact on demand (per render frame). */
export interface Projection {
  /** Friendly name. */
  readonly name: string;

  /** Called once on attach with the initial world. */
  init(world: World): void;

  /** Called for each game event after the reducer applies a command.
   *  Projections use this to incrementally update their render artifact
   *  rather than re-scanning the world every frame. */
  onEvent(event: GameEvent): void;

  /** Called at render time. Projections that interpolate between simulation
   *  steps use the alpha to blend; static projections ignore it. */
  render(alpha: number): void;

  /** Detach. Cleanup resources. */
  destroy(): void;
}

/** A mesh-tag registry maps entity render tags ("door", "wizard_robe", etc.)
 *  to projection-specific render data. The world's entities carry meshTag
 *  strings; each projection has its own registry of what those strings mean
 *  in its display vocabulary. */
export interface MeshTagRegistry<T> {
  register(tag: string, builder: () => T): void;
  build(tag: string): T;
  has(tag: string): boolean;
}

/** Simple registry implementation usable by any projection. */
export class SimpleMeshTagRegistry<T> implements MeshTagRegistry<T> {
  private builders = new Map<string, () => T>();
  private fallback?: () => T;

  constructor(fallback?: () => T) {
    this.fallback = fallback;
  }

  register(tag: string, builder: () => T): void {
    this.builders.set(tag, builder);
  }

  build(tag: string): T {
    const b = this.builders.get(tag) ?? this.fallback;
    if (!b) throw new Error(`MeshTagRegistry: no builder for tag "${tag}" and no fallback`);
    return b();
  }

  has(tag: string): boolean {
    return this.builders.has(tag);
  }
}

/** Helper: extract the meshTag from an entity, or fall back to prototypeId. */
export function entityMeshTag(e: EntityRecord): string {
  return e.components.renderable?.meshTag ?? e.prototypeId;
}
