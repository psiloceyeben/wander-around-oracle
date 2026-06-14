// PerceptionSubstrate — compose a rich HRR encoding of what the agent sees.
//
// The v7.2 / playtest perception was a text prompt ("I am at (0,0). I see
// 1 sword. I will"). Text perception means the model classifies TOKENS
// not the WORLD — which is why T2 failed: "I see 1 temple" and "I see 1
// doorway" produce statistically similar prompts despite being completely
// different situations.
//
// This module produces a real HRR encoding of the perceptual field by
// binding visible entities with role keys (kind, distance, interactable,
// component bag). The encoding is mathematically distinct across scenes
// because the bound kind/role vectors are orthogonal HRR primitives, not
// statistically-similar text tokens.
//
// Scale-invariant: 1024-dim complex vectors regardless of model size.
// Same module attaches to 125M today, 250M tomorrow, 2B later. The model's
// contribution is the routing classifier; the substrate's contribution is
// rich situational encoding the engine + downstream substrate modules can
// use to make context-sensitive decisions.

import { type HRRVec, zeroVec } from "../../hrr/types.js";
import { addInto, bind, normalize, magnitude } from "../../hrr/core.js";
import { roleVec, kindVec, seedVec } from "../../hrr/seed.js";
import { type EntityId, type EntityRecord } from "../../entity/types.js";
import { World } from "../../world/world.js";

// Cached role vectors — seeded once, reused forever
const _roles = {
  visible:       roleVec("perception:visible"),
  kind:          roleVec("perception:kind"),
  distance:      roleVec("perception:distance_bucket"),
  interactable:  roleVec("perception:interactable_verb"),
  components:    roleVec("perception:components"),
  agent_self:    roleVec("perception:self"),
  agent_holds:   roleVec("perception:holds"),
};

/** Distance-bucket vectors are pre-computed for {0..16} meters. Beyond
 *  16m we use the "far" bucket. Buckets give the substrate a discrete
 *  way to encode "how close" without continuous noise. */
const _distBuckets: HRRVec[] = [];
for (let i = 0; i <= 16; i++) _distBuckets.push(seedVec(`dist:${i}m`));
const _distFar = seedVec("dist:far");
function distanceBucketVec(d: number): HRRVec {
  if (d >= 16) return _distFar;
  return _distBuckets[Math.max(0, Math.round(d))];
}

/** Verb vectors for interactable affordances. */
const _verbVecs: Record<string, HRRVec> = {
  pickup: seedVec("verb:pickup"),
  open:   seedVec("verb:open"),
  talk:   seedVec("verb:talk"),
  use:    seedVec("verb:use"),
};

export interface PerceptionResult {
  /** The composed perception HRR vector — unit-magnitude superposition of
   *  bound (role, value) pairs encoding what the agent SEES. Excludes
   *  agent self-identity so scene cosines reflect scene differences only. */
  vec: HRRVec;
  /** Plain-TypeScript summary for engine systems that want named access. */
  visibleEntities: EntityRecord[];
  visibleByKind: Map<string, number>;
  interactablesById: Map<EntityId, { verb: string; range: number }>;
  selfPosition: { x: number; y: number; z: number };
  /** Agent's own kindVec, available for downstream that needs subject identity. */
  selfKindVec: HRRVec;
  holdingEntityId: EntityId | null;
}

export interface PerceptionOptions {
  radius?: number;
  /** Optional: include the agent's currently-held entity (if any) in the
   *  perception, bound under role:perception:holds. */
  includeHolding?: boolean;
}

/** Compose the agent's perception as a rich HRR vector + a TS summary.
 *  The HRR vector goes to downstream substrate modules (CommandSubstrate,
 *  Oracle auxiliary input). The TS summary lets engine systems do named-
 *  field access without re-decoding the substrate. */
export function composePerceptionSubstrate(
  world: World,
  agentId: EntityId,
  opts: PerceptionOptions = {},
): PerceptionResult {
  const radius = opts.radius ?? 12;
  const me = world.getEntity(agentId);
  if (!me) {
    return {
      vec: zeroVec(),
      visibleEntities: [],
      visibleByKind: new Map(),
      interactablesById: new Map(),
      selfPosition: { x: 0, y: 0, z: 0 },
      selfKindVec: zeroVec(),
      holdingEntityId: null,
    };
  }

  const mp = me.transform.position;
  const visibleEntities: EntityRecord[] = [];
  const visibleByKind = new Map<string, number>();
  const interactablesById = new Map<EntityId, { verb: string; range: number }>();
  let holdingEntityId: EntityId | null = null;

  // Accumulate the perception vector as a superposition of (role:visible ⊛ entity_encoding)
  const accumulator = zeroVec();

  for (const e of world.entitiesInRadius(mp, radius)) {
    if (e.id === agentId) continue;
    visibleEntities.push(e);
    visibleByKind.set(e.prototypeId, (visibleByKind.get(e.prototypeId) ?? 0) + 1);
    if (e.components.interactable) {
      interactablesById.set(e.id, {
        verb: e.components.interactable.verb,
        range: e.components.interactable.range,
      });
    }
    if (e.components.holder?.heldBy === agentId) {
      holdingEntityId = e.id;
    }

    // Compose this entity's encoding: kind + distance bucket + interactable verb
    const dx = e.transform.position.x - mp.x;
    const dz = e.transform.position.z - mp.z;
    const d = Math.sqrt(dx * dx + dz * dz);

    const kindV = kindVec(e.prototypeId);
    const distV = distanceBucketVec(d);
    const entityEncoding = bind(_roles.kind, kindV);
    addInto(entityEncoding, bind(_roles.distance, distV));
    if (e.components.interactable) {
      const verbV = _verbVecs[e.components.interactable.verb] ?? seedVec(`verb:${e.components.interactable.verb}`);
      addInto(entityEncoding, bind(_roles.interactable, verbV));
    }
    if (magnitude(entityEncoding) > 1e-9) normalize(entityEncoding);

    // Bind under role:visible into the perception accumulator
    addInto(accumulator, bind(_roles.visible, entityEncoding));
  }

  // Optionally include holding — note: holding is genuine perception state
  // (the agent's grasp is part of the scene), so it stays in the vector.
  if (opts.includeHolding && holdingEntityId) {
    const held = world.getEntity(holdingEntityId);
    if (held) {
      const holdEnc = bind(_roles.kind, kindVec(held.prototypeId));
      if (magnitude(holdEnc) > 1e-9) normalize(holdEnc);
      addInto(accumulator, bind(_roles.agent_holds, holdEnc));
    }
  }

  // Note: agent_self is NOT bound into the accumulator. The agent's
  // identity is constant across the scenes the agent encounters, so
  // including it dominates the vector with non-scene-discriminating
  // signal (T2' regression: scene cosines ≈ 0.7 when self was included).
  // Downstream consumers that need self-identity should read selfKindVec
  // directly from the PerceptionResult.

  if (magnitude(accumulator) > 1e-9) normalize(accumulator);
  return {
    vec: accumulator,
    visibleEntities,
    visibleByKind,
    interactablesById,
    selfPosition: { x: mp.x, y: mp.y, z: mp.z },
    selfKindVec: kindVec(me.prototypeId),
    holdingEntityId,
  };
}

/** Serialize a perception vector as interleaved [real0, imag0, real1, imag1, ...]
 *  for transmission over the Oracle HTTP API as auxiliary input. */
export function perceptionVecToFloats(vec: HRRVec): number[] {
  const out = new Array(vec.real.length * 2);
  for (let i = 0; i < vec.real.length; i++) {
    out[i * 2] = vec.real[i];
    out[i * 2 + 1] = vec.imag[i];
  }
  return out;
}

/** Re-export role vectors so downstream modules can unbind by role. */
export const PERCEPTION_ROLES = _roles;
