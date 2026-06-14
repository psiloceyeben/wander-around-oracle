// Double recursive attention head — navigator-level augment.
//
// PROBLEM IT SOLVES
//   Substrate cleanup respects the model's routing distribution. When the
//   model routes poorly for a scene (e.g. chesed/binah for "I see doorway"
//   instead of yesod/keter), substrate cleanup can't recover — the routing
//   never lifts ENTER_PORTAL above INSPECT. The substrate has the
//   information needed to recover (the portal IS in perception, and
//   ENTER_PORTAL IS uniquely affordable) — the attention head is what
//   uses that information to refine routing before cleanup.
//
// TWO HEADS, GENUINELY INDEPENDENT
//
//   HEAD 1 — scene-affordance attention (bottom-up, static)
//     For each Sephirah s, saliency_a(s) = sum of c.affinityWeight over
//     commands c that:
//       (a) have needsTarget: true  (so always-affordable commands like
//           SAVE/MOVE/SPAWN can't dominate every scene), AND
//       (b) are currently affordable in this scene (their affordance
//           predicate holds), AND
//       (c) have s ∈ c.sephirahAffinity.
//     This signal is purely bottom-up: it answers "what NEW capabilities
//     does this scene unlock, and which Sephirot own them?" — independent
//     of what the model thinks. Portal-in-scene → ENTER_PORTAL affordable
//     → yesod+keter boosted. Sword-in-scene → PICKUP affordable → malkuth
//     boosted. Empty scene → no needsTarget commands affordable →
//     saliency_a is zero and contributes nothing (routing untouched).
//
//   HEAD 2 — command-resonance attention (top-down, recursive)
//     For each Sephirah s, saliency_r(s) = sum over commands c of
//     (cos(intent_t, c.vec) × c.affinityWeight) where s ∈ c.sephirahAffinity
//     and intent_t = bind(role:intent, composeRoutingVector(r_t)) +
//                    bind(role:context, perception.vec).
//     This uses the same substrate cleanup machinery the final scorer uses
//     but as a feedback signal — high-resonance verbs vote for their
//     parent Sephirot, which lifts those Sephirot's routing weight, which
//     in turn changes intent_t, which changes resonances, etc. Recursive
//     by construction: the head's output depends on the head's input.
//
// THE RECURSION
//   r_{t+1} ∝ wSelf·r_t + α·saliency_a + β·saliency_r(r_t)
//   wSelf = max(0, 1 - α - β), so the model's vote is preserved as a
//   damping anchor (attention refines but can't fully overwrite). After
//   `iterations` passes (default 2), return r_iterations as the refined
//   routing for substrate cleanup.
//
// WHY "DOUBLE" "RECURSIVE"
//   • Double: two independent attention heads (scene-affordance + command-
//     resonance) combined into a single routing refiner.
//   • Recursive: head 2 recomputes each iteration based on the routing
//     produced by the previous iteration. Head 1 is static but compounds
//     across iterations via the renormalization.
//   • Attention head: query (current routing) attends against keys
//     (per-Sephirah affordance + per-verb resonance) to produce values
//     (refined routing).
//
// SCALE-INVARIANT
//   No learned weights. No model-specific code. 125M today, v3 250M
//   tomorrow — same augment, better routing in → better refinement out.

import { type Sephirah, SEPHIROTH } from "../../hrr/treeOfLife.js";
import { type HRRVec } from "../../hrr/types.js";
import { bind, cosine, magnitude, normalize as normVec } from "../../hrr/core.js";
import { roleVec } from "../../hrr/seed.js";
import { type PerceptionResult } from "../perceptionSubstrate/index.js";
import { COMMAND_DICTIONARY, composeRoutingVector } from "../commandSubstrate/index.js";

export interface AttentionOptions {
  /** Weight on scene-affordance attention (HEAD 1). Default 0.45. */
  alpha?: number;
  /** Weight on command-resonance attention (HEAD 2). Default 0.10. */
  beta?: number;
  /** Number of recursive refinement iterations. Default 2. */
  iterations?: number;
}

export interface AttentionDiagnostic {
  affordanceSaliency: Record<Sephirah, number>;
  /** Final iteration's resonance saliency (depends on the refined routing). */
  resonanceSaliency: Record<Sephirah, number>;
  /** Routing at each iteration; trace[0] = input, trace[N] = output. */
  routingTrace: Array<Record<Sephirah, number>>;
}

export interface AttentionResult {
  routing: Record<Sephirah, number>;
  diag: AttentionDiagnostic;
}

const _intentRole  = roleVec("command:intent");
const _contextRole = roleVec("command:context");

const _normalize = (d: Record<Sephirah, number>) => {
  let sum = 0;
  for (const s of SEPHIROTH) sum += d[s];
  if (sum > 0) {
    for (const s of SEPHIROTH) d[s] /= sum;
  }
  // If sum is 0, leave as zeros — caller can interpret as "no signal".
};

const _zeroDist = (): Record<Sephirah, number> => {
  const out: Record<Sephirah, number> = {} as any;
  for (const s of SEPHIROTH) out[s] = 0;
  return out;
};

/** HEAD 1 — Scene-affordance attention (UNIQUE-AFFORDANCE FILTER).
 *
 *  Computes, for each Sephirah, the sum of affinity weights from commands
 *  whose affordance predicate is satisfied UNIQUELY by this scene. We
 *  filter to commands that:
 *    (1) have needsTarget: true        — exclude always-affordable
 *        (SAVE / MOVE / SPAWN / NONE),
 *    (2) declare a specific affordance verb (proto.affordance !== undefined)
 *        — exclude pseudo-specific commands like INSPECT that match any
 *        visible entity (those leak scene-agnostic signal into every
 *        non-empty scene),
 *    (3) and find a matching affordance in this scene's interactables.
 *
 *  Result: ENTER_PORTAL (use-affordant) lights up yesod+keter only when a
 *  use-affordant entity is visible. PICKUP (pickup-affordant) lights up
 *  malkuth only when a pickup-affordant entity is visible. Empty or
 *  generic scenes return zero — model routing passes through unchanged.
 *
 *  This is the head's actual job: tell the navigator "this scene unlocks
 *  capability X owned by Sephirah Y — route there." */
export function sceneAffordanceSaliency(perception: PerceptionResult): Record<Sephirah, number> {
  const out = _zeroDist();
  for (const proto of COMMAND_DICTIONARY) {
    if (!proto.needsTarget) continue;
    if (!proto.affordance) continue;  // unique-affordance filter
    const affordable = Array.from(perception.interactablesById.values())
      .some((i) => i.verb === proto.affordance);
    if (!affordable) continue;
    if (proto.verb === "PICKUP" && perception.holdingEntityId) continue;
    if (proto.verb === "DROP" && !perception.holdingEntityId) continue;
    for (const s of proto.sephirahAffinity) {
      out[s] += proto.affinityWeight;
    }
  }
  _normalize(out);
  return out;
}

/** HEAD 2 — Command-resonance attention (recursive).
 *
 *  Builds an intent vector from the current routing + perception (the
 *  same intent computation the substrate cleanup uses). For each verb,
 *  computes cos(intent, verb_vec) × affinity. Aggregates the per-verb
 *  scores back to Sephirot via each verb's sephirahAffinity. Returns a
 *  distribution that lifts Sephirot owning the highest-resonating verbs.
 *
 *  Recursive because routing → intent → resonance → routing-boost. Each
 *  iteration's resonance depends on the prior iteration's routing. */
export function commandResonanceSaliency(
  routing: Partial<Record<Sephirah, number>>,
  perception: PerceptionResult,
): Record<Sephirah, number> {
  const routingVec: HRRVec = composeRoutingVector(routing);
  const intent: HRRVec = bind(_intentRole, routingVec);
  const ctx = bind(_contextRole, perception.vec);
  for (let k = 0; k < intent.real.length; k++) {
    intent.real[k] += ctx.real[k];
    intent.imag[k] += ctx.imag[k];
  }
  if (magnitude(intent) > 1e-9) normVec(intent);

  const out = _zeroDist();
  for (const proto of COMMAND_DICTIONARY) {
    const r = Math.max(0, cosine(intent, proto.vec));
    const contribution = r * proto.affinityWeight;
    for (const s of proto.sephirahAffinity) {
      out[s] += contribution;
    }
  }
  _normalize(out);
  return out;
}

/** Double recursive attention head for the navigator.
 *
 *  Refines the model's routing distribution by recursive combination
 *  with two substrate-native attention signals:
 *    HEAD 1 — sceneAffordanceSaliency (bottom-up, static across iterations)
 *    HEAD 2 — commandResonanceSaliency (top-down, recomputed each iteration)
 *
 *  See file-level comment for full design rationale.
 */
export function doubleRecursiveAttention(
  routing: Partial<Record<Sephirah, number>>,
  perception: PerceptionResult,
  opts: AttentionOptions = {},
): AttentionResult {
  const alpha = opts.alpha ?? 0.30;
  const beta = opts.beta ?? 0.30;
  const iterations = Math.max(1, opts.iterations ?? 2);
  const wSelf = Math.max(0, 1 - alpha - beta);

  const sA = sceneAffordanceSaliency(perception);

  const trace: Array<Record<Sephirah, number>> = [];
  let r: Record<Sephirah, number> = _zeroDist();
  for (const s of SEPHIROTH) r[s] = routing[s] ?? 0;
  _normalize(r);
  trace.push({ ...r });

  let sR: Record<Sephirah, number> = _zeroDist();
  for (let i = 0; i < iterations; i++) {
    sR = commandResonanceSaliency(r, perception);
    const next: Record<Sephirah, number> = {} as any;
    for (const s of SEPHIROTH) {
      next[s] = wSelf * r[s] + alpha * sA[s] + beta * sR[s];
    }
    _normalize(next);
    r = next;
    trace.push({ ...r });
  }

  return {
    routing: r,
    diag: { affordanceSaliency: sA, resonanceSaliency: sR, routingTrace: trace },
  };
}
