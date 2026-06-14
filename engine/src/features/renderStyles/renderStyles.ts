// Feature: Render-style switching as projection swap.
//
// Style isn't a property of the world; it's a property of the viewer.
// Switching style means swapping which Projection (Layer 5) is attached.
// Two players in the same world can view different styles simultaneously
// because the world is HRR substrate and renderings are projections.

import { type Projection } from "../../projection/types.js";
import { World } from "../../world/world.js";
import { EventBus } from "../../cmd/bus.js";

export type StyleName = "toon-physical" | "watercolor" | "voxel" | "paper-mario" | "ascii";

export interface StyleRegistry {
  register(name: StyleName, factory: () => Projection): void;
  has(name: StyleName): boolean;
  create(name: StyleName): Projection;
  list(): StyleName[];
}

export class SimpleStyleRegistry implements StyleRegistry {
  private factories = new Map<StyleName, () => Projection>();
  register(name: StyleName, factory: () => Projection): void { this.factories.set(name, factory); }
  has(name: StyleName): boolean { return this.factories.has(name); }
  create(name: StyleName): Projection {
    const f = this.factories.get(name);
    if (!f) throw new Error(`unknown render style: ${name}`);
    return f();
  }
  list(): StyleName[] { return Array.from(this.factories.keys()); }
}

/** Manage the currently-active projection. Swap by re-binding to a new projection. */
export class RenderStyleManager {
  private active: Projection | null = null;
  private activeName: StyleName | null = null;
  private world: World;
  private events: EventBus;
  private registry: StyleRegistry;

  constructor(opts: { world: World; events: EventBus; registry: StyleRegistry; initial?: StyleName }) {
    this.world = opts.world;
    this.events = opts.events;
    this.registry = opts.registry;
    if (opts.initial) this.swap(opts.initial);
  }

  current(): StyleName | null { return this.activeName; }
  currentProjection(): Projection | null { return this.active; }

  /** Switch to a new style. Detaches the current projection cleanly,
   *  instantiates the new one, replays world state, hooks events. */
  swap(name: StyleName): void {
    if (this.activeName === name) return;
    if (!this.registry.has(name)) throw new Error(`unknown style: ${name}`);

    // Tear down current
    if (this.active) {
      try { this.active.destroy(); } catch {}
      this.active = null;
    }

    // Build new
    const proj = this.registry.create(name);
    proj.init(this.world);
    // Forward events to the new projection
    this.events.on("*", (e) => {
      try { proj.onEvent(e); } catch {}
    });
    this.active = proj;
    this.activeName = name;
  }

  render(alpha: number = 0): void {
    this.active?.render(alpha);
  }
}
