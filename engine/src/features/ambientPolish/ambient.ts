// Feature: Ambient polish — particles + footstep audio.
//
// Projection-side feel. Schedules sound + visual effects that aren't world
// state. Hooks into engine events: EntitySpawned → spawn dust puff, player
// movement → footstep timing.
//
// Headless-safe (audio + visuals are no-ops without DOM/Three.js context).

import { EventBus } from "../../cmd/bus.js";

export interface AmbientHooks {
  /** Called when a particle puff should be spawned at a world position. */
  emitParticlePuff?: (pos: { x: number; y: number; z: number }, kind: "dust" | "voice" | "place") => void;
  /** Called when a footstep sound should play. */
  playFootstep?: (surface: "grass" | "stone" | "wood" | "sand") => void;
  /** Called when a UI chime should play. */
  playChime?: (kind: "pickup" | "drop" | "built" | "save") => void;
}

export class AmbientPolish {
  private hooks: AmbientHooks;
  private events: EventBus;
  private unsubs: Array<() => void> = [];
  private footstepIntervalMs = 350;
  private lastFootstep: number | null = null;
  private now: () => number;

  constructor(events: EventBus, hooks: AmbientHooks = {}, opts?: { now?: () => number }) {
    this.events = events;
    this.hooks = hooks;
    this.now = opts?.now ?? (typeof performance !== "undefined" ? () => performance.now() : () => Date.now());
  }

  attach(): void {
    this.unsubs.push(this.events.on("EntitySpawned", (e) => {
      if (e.kind !== "EntitySpawned") return;
      const pos = e.entity.transform.position;
      this.hooks.emitParticlePuff?.({ x: pos.x, y: pos.y + 0.5, z: pos.z }, "place");
      this.hooks.playChime?.("built");
    }));
    this.unsubs.push(this.events.on("EntityPickedUp", () => {
      this.hooks.playChime?.("pickup");
    }));
    this.unsubs.push(this.events.on("EntityDropped", (e) => {
      if (e.kind !== "EntityDropped") return;
      this.hooks.emitParticlePuff?.(e.transform.position, "place");
      this.hooks.playChime?.("drop");
    }));
    this.unsubs.push(this.events.on("WorldSaved", () => {
      this.hooks.playChime?.("save");
    }));
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** Called each frame when player is moving. Triggers footsteps on cadence. */
  tickFootsteps(isMoving: boolean, surface: AmbientHooks["playFootstep"] extends ((s: infer S) => void) ? S : "grass" = "grass"): void {
    if (!isMoving) { this.lastFootstep = null; return; }
    const t = this.now();
    if (this.lastFootstep === null || t - this.lastFootstep >= this.footstepIntervalMs) {
      this.lastFootstep = t;
      this.hooks.playFootstep?.(surface);
    }
  }

  /** Player just used voice — emit a pulse-ring particle at their position. */
  emitVoicePulse(pos: { x: number; y: number; z: number }): void {
    this.hooks.emitParticlePuff?.(pos, "voice");
  }
}
