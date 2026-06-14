// Layer 10 — Constraint / axiom substrate.
//
// Axioms are predicates checked at command-application time. They live at
// platform / world / region scopes. A platform axiom is enforced everywhere
// (anti-grief, age-gating, real-world-harm filter). A world axiom is set
// per-world (PvP rules, building permissions). A region axiom is local to
// a spatial region within a world (sanctuary, no-fly zone).
//
// Architecture: an Axiom takes a command + world snapshot, returns either
// approve or reject-with-reason. The reducer wrapper passes commands through
// the axiom stack before applying them; rejected commands produce
// CommandRejected events with the axiom's reason.

import { type Command, type GameEvent } from "../cmd/types.js";
import { type Reducer } from "../cmd/bus.js";
import { World } from "../world/index.js";

export type Scope = "platform" | "world" | "region";

export interface AxiomDecision {
  approved: boolean;
  reason?: string;
}

export interface Axiom {
  name: string;
  scope: Scope;
  /** Optional spatial region — for "region" scope axioms.
   *  Center + radius defines the area in which the axiom applies. */
  region?: { center: { x: number; y: number; z: number }; radius: number };
  /** Pure function: examine the command and world, return decision. */
  check(cmd: Command, world: World): AxiomDecision;
}

export class AxiomRegistry {
  private axioms: Axiom[] = [];

  add(axiom: Axiom): void { this.axioms.push(axiom); }
  remove(name: string): void { this.axioms = this.axioms.filter((a) => a.name !== name); }
  count(): number { return this.axioms.length; }

  /** Run all axioms. Returns the first rejection, or approved if all pass. */
  check(cmd: Command, world: World): AxiomDecision {
    for (const a of this.axioms) {
      // Region axioms only apply if the command targets a position within the region
      if (a.scope === "region" && a.region) {
        const pos = commandTargetPosition(cmd, world);
        if (!pos) continue;
        const dx = pos.x - a.region.center.x;
        const dy = pos.y - a.region.center.y;
        const dz = pos.z - a.region.center.z;
        if (dx * dx + dy * dy + dz * dz > a.region.radius * a.region.radius) continue;
      }
      const d = a.check(cmd, world);
      if (!d.approved) return d;
    }
    return { approved: true };
  }
}

function commandTargetPosition(cmd: Command, world: World): { x: number; y: number; z: number } | null {
  switch (cmd.kind) {
    case "SpawnEntity": return cmd.transform.position;
    case "MoveEntity":  return cmd.transform.position ?? null;
    case "DropEntity":  return cmd.dropTransform.position;
    case "RemoveEntity":
    case "PickupEntity":
    case "EditComponents":
    case "EnterPortal": {
      const id = (cmd as any).id ?? (cmd as any).targetId ?? (cmd as any).portalId;
      if (!id) return null;
      return world.getEntity(id)?.transform.position ?? null;
    }
    default: return null;
  }
}

/** Wrap a base reducer with axiom enforcement. The wrapped reducer checks
 *  the axiom stack BEFORE invoking the base reducer; rejections short-circuit
 *  and produce a CommandRejected event. */
export function axiomGuarded(base: Reducer, registry: AxiomRegistry): Reducer {
  return (world: World, cmd: Command): GameEvent[] => {
    const decision = registry.check(cmd, world);
    if (!decision.approved) {
      return [{
        kind: "CommandRejected",
        tick: world.tick,
        command: cmd,
        reason: decision.reason ?? "rejected by axiom",
      }];
    }
    return base(world, cmd);
  };
}

// ── Some default axioms ──────────────────────────────────────────────────

/** Platform axiom: prevent entity ids longer than 256 chars. */
export const axiomIdLength: Axiom = {
  name: "platform:id-length",
  scope: "platform",
  check: (cmd) => {
    const id = (cmd as any).id ?? (cmd as any).targetId ?? (cmd as any).portalId;
    if (id && typeof id === "string" && id.length > 256) {
      return { approved: false, reason: "entity id exceeds 256 chars" };
    }
    return { approved: true };
  },
};

/** World axiom: limit total entities to N. */
export function axiomEntityCap(maxEntities: number): Axiom {
  return {
    name: `world:entity-cap-${maxEntities}`,
    scope: "world",
    check: (cmd, world) => {
      if (cmd.kind !== "SpawnEntity") return { approved: true };
      if (world.entityCount() >= maxEntities) {
        return { approved: false, reason: `entity cap reached (${maxEntities})` };
      }
      return { approved: true };
    },
  };
}

/** Region axiom: no PvP, no entity destruction in a sanctuary region. */
export function axiomSanctuary(center: { x: number; y: number; z: number }, radius: number): Axiom {
  return {
    name: `region:sanctuary-${center.x},${center.y},${center.z}`,
    scope: "region",
    region: { center, radius },
    check: (cmd) => {
      if (cmd.kind === "RemoveEntity") {
        return { approved: false, reason: "sanctuary: no entity destruction here" };
      }
      return { approved: true };
    },
  };
}
