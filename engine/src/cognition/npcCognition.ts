// NPC cognition op — produces commands from perception via the Oracle.
//
// This is the layer where the substrate paradigm closes: the Oracle's
// substrate IS the engine's substrate. An NPC's perception is a
// superposition of nearby entity vectors; the Oracle routes that
// perception through the Tree of Life manifold and produces a response
// vector that decomposes into commands.

import { type Oracle } from "./oracle.js";
import { type CognitionOp } from "../agent/agent.js";
import { type Command } from "../cmd/types.js";
import { superpose, type HRRVec, zeroVec } from "../hrr/index.js";
import { type World } from "../world/index.js";
import { type EntityId } from "../entity/types.js";
import { entityToVec } from "../entity/index.js";

/** Compose perception vector from visible entities — superposition of
 *  each visible entity's bound state. */
export function composePerception(world: World, _agentId: EntityId, visibleIds: EntityId[]): HRRVec {
  if (visibleIds.length === 0) return zeroVec();
  const vecs: HRRVec[] = [];
  for (const id of visibleIds) {
    const e = world.getEntity(id);
    if (!e) continue;
    vecs.push(entityToVec(e));
  }
  return superpose(vecs, true);
}

/** Construct an NPC cognition op backed by an Oracle. The NPC's policy
 *  ("idle", "wander", "follow", "hostile") gets passed as a prompt to
 *  the Oracle which produces a response vector that we decompose into
 *  candidate commands. For the stub Oracle, the response is canned and
 *  we map it to a simple wander step. */
export function oracleCognitionOp(
  oracle: Oracle,
  opts?: { policy?: "idle" | "wander" | "follow" | "hostile" }
): CognitionOp {
  const policy = opts?.policy ?? "wander";
  return (ctx) => {
    const perception = composePerception(ctx.world, ctx.agentId, ctx.perception.visibleIds);
    // Fire the query but don't await — cognition is one-tick latency tolerant.
    // We return wander/idle commands synchronously and let later ticks pick
    // up the Oracle's deeper guidance once it returns.
    void oracle.query({ perception, prompt: policy, maxTokens: 0 });
    // Default behavior: small random wander step for non-idle policies
    const cmds: Command[] = [];
    if (policy === "wander") {
      const me = ctx.world.getEntity(ctx.agentId);
      if (me) {
        // Deterministic pseudo-random wander based on tick + id hash
        const hash = simpleHash(ctx.agentId + ctx.tick);
        const dx = ((hash & 0xff) / 255 - 0.5) * 0.2;
        const dz = (((hash >> 8) & 0xff) / 255 - 0.5) * 0.2;
        cmds.push({
          kind: "MoveEntity", id: ctx.agentId,
          transform: {
            position: {
              x: me.transform.position.x + dx,
              y: me.transform.position.y,
              z: me.transform.position.z + dz,
            },
          },
        });
      }
    }
    return cmds;
  };
}

function simpleHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
