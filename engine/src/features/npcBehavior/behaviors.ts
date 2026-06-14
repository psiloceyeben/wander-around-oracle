// Feature: NPC behavior state machines (cognition op variants).
//
// Each policy is a CognitionOp factory that produces commands based on
// NPC state + perception. Policies compose: wandering NPC can switch to
// hostile when player enters range, back to wandering when player leaves.
//
// Substrate-paradigm fit: all behaviors emit commands; world mutation is
// reducer-driven; no manager pile.

import { type CognitionOp } from "../../agent/agent.js";
import { type Command } from "../../cmd/types.js";

function _hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Idle: no commands. NPC stands still. */
export function idlePolicy(): CognitionOp {
  return () => [];
}

/** Wander: small deterministic step each tick. */
export function wanderPolicy(opts?: { step?: number }): CognitionOp {
  const step = opts?.step ?? 0.2;
  return (ctx) => {
    const me = ctx.world.getEntity(ctx.agentId);
    if (!me) return [];
    const h = _hash(ctx.agentId + ctx.tick);
    const dx = ((h & 0xff) / 255 - 0.5) * step;
    const dz = (((h >> 8) & 0xff) / 255 - 0.5) * step;
    return [{
      kind: "MoveEntity", id: ctx.agentId,
      transform: {
        position: { x: me.transform.position.x + dx, y: me.transform.position.y, z: me.transform.position.z + dz },
      },
    }];
  };
}

/** Follow: move toward the nearest player in perception range. */
export function followPolicy(opts?: { targetPrototype?: string; step?: number }): CognitionOp {
  const target = opts?.targetPrototype ?? "player";
  const step = opts?.step ?? 0.3;
  return (ctx) => {
    const me = ctx.world.getEntity(ctx.agentId);
    if (!me) return [];
    let nearest: { dx: number; dy: number; dz: number; d2: number } | null = null;
    for (const id of ctx.perception.visibleIds) {
      const e = ctx.world.getEntity(id);
      if (!e || e.prototypeId !== target) continue;
      const dx = e.transform.position.x - me.transform.position.x;
      const dy = e.transform.position.y - me.transform.position.y;
      const dz = e.transform.position.z - me.transform.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!nearest || d2 < nearest.d2) nearest = { dx, dy, dz, d2 };
    }
    if (!nearest) return [];
    const d = Math.sqrt(nearest.d2) || 1;
    if (d < 1) return [];  // close enough
    const nx = nearest.dx / d;
    const nz = nearest.dz / d;
    return [{
      kind: "MoveEntity", id: ctx.agentId,
      transform: {
        position: {
          x: me.transform.position.x + nx * step,
          y: me.transform.position.y,
          z: me.transform.position.z + nz * step,
        },
      },
    }];
  };
}

/** Hostile: like follow but attacks (emits EditComponents to damage target) when in range. */
export function hostilePolicy(opts?: { targetPrototype?: string; step?: number; attackRange?: number }): CognitionOp {
  const target = opts?.targetPrototype ?? "player";
  const step = opts?.step ?? 0.35;
  const attackRange = opts?.attackRange ?? 1.5;
  return (ctx) => {
    const cmds: Command[] = [];
    const me = ctx.world.getEntity(ctx.agentId);
    if (!me) return cmds;
    let nearest: { id: string; dx: number; dy: number; dz: number; d2: number } | null = null;
    for (const id of ctx.perception.visibleIds) {
      const e = ctx.world.getEntity(id);
      if (!e || e.prototypeId !== target) continue;
      const dx = e.transform.position.x - me.transform.position.x;
      const dy = e.transform.position.y - me.transform.position.y;
      const dz = e.transform.position.z - me.transform.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!nearest || d2 < nearest.d2) nearest = { id, dx, dy, dz, d2 };
    }
    if (!nearest) return cmds;
    const d = Math.sqrt(nearest.d2) || 1;
    if (d > attackRange) {
      cmds.push({
        kind: "MoveEntity", id: ctx.agentId,
        transform: { position: {
          x: me.transform.position.x + (nearest.dx / d) * step,
          y: me.transform.position.y,
          z: me.transform.position.z + (nearest.dz / d) * step,
        } },
      });
    }
    // In-range: would emit an Attack command if we had one. For now no-op
    // (the command catalog is extensible; the engine doesn't ship with
    // combat primitives).
    return cmds;
  };
}

/** Switching policy: thresholded mode change. Hostile if player within X,
 *  follow if within Y, wander otherwise. */
export function adaptivePolicy(opts?: {
  hostileRange?: number;
  followRange?: number;
  targetPrototype?: string;
}): CognitionOp {
  const hostileR = opts?.hostileRange ?? 4;
  const followR  = opts?.followRange ?? 10;
  const target = opts?.targetPrototype ?? "player";
  const wander  = wanderPolicy();
  const follow  = followPolicy({ targetPrototype: target });
  const hostile = hostilePolicy({ targetPrototype: target });
  return (ctx) => {
    const me = ctx.world.getEntity(ctx.agentId);
    if (!me) return [];
    let nearestD = Infinity;
    for (const id of ctx.perception.visibleIds) {
      const e = ctx.world.getEntity(id);
      if (!e || e.prototypeId !== target) continue;
      const dx = e.transform.position.x - me.transform.position.x;
      const dz = e.transform.position.z - me.transform.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nearestD) nearestD = d;
    }
    if (nearestD < hostileR) return hostile(ctx);
    if (nearestD < followR)  return follow(ctx);
    return wander(ctx);
  };
}
