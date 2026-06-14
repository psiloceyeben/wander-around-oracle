// HRR-native target selection.
//
// PROBLEM
//   The original commands.ts switch had hand-coded distance-min loops per
//   verb (find-nearest-pickup-affordant, find-nearest-doorway, etc.). The
//   agent's target choice was purely Euclidean — the substrate's rich HRR
//   perception encoding contributed nothing to the decision. This violates
//   the substrate-paradigm thesis ("the substrate IS the cognition") at
//   the target-selection level.
//
// HRR APPROACH
//   Each candidate entity gets an HRR encoding `bind(target_role, kindVec)`.
//   We score candidates by cos(intent, candidate_encoding) where intent is
//   the substrate's composed intent vector (already computed in cleanup —
//   it carries routing × context × perception bindings). The entity that
//   resonates most with current intent wins. Proximity is retained as a
//   small tiebreaker so co-located candidates of same resonance go to the
//   nearer one (embodied agent — body matters).
//
//   When all candidates are HRR-equivalent (uniform routing, identical
//   kinds), proximity decides. When routing favors a specific kind (e.g.
//   model routed strongly to chesed → wizard kind resonates more with the
//   intent's chesed component), HRR cleanup picks the kind-matching target
//   even if it's not the closest.
//
// WHY THIS MATTERS FOR FREEDOM
//   The model's 10-Sephirah routing now influences target selection, not
//   just verb selection. The same number of routing degrees of freedom
//   reaches more decision surfaces. The agent's expressive range expands
//   without retraining and without enlarging the routing head.

import { type HRRVec } from "../../hrr/types.js";
import { bind, cosine } from "../../hrr/core.js";
import { roleVec, kindVec } from "../../hrr/seed.js";
import { type EntityId, type EntityRecord } from "../../entity/types.js";
import { type PerceptionResult } from "../perceptionSubstrate/index.js";

const _targetRole = roleVec("command:target");

export interface TargetCandidate {
  id: EntityId;
  /** cos(intent, bind(target_role, kindVec(entity))) — HRR resonance. */
  hrrScore: number;
  /** 1/(1+d²) — geometric proximity. */
  proximityScore: number;
  /** Combined: hrrScore + proximityWeight * proximityScore. */
  totalScore: number;
}

export interface HrrTargetSelectOptions {
  /** Weight of proximity in the combined score. Default 0.10. Set 0 for
   *  pure HRR resonance; set 1 to recover near-original distance-min. */
  proximityWeight?: number;
}

/** HRR-native target selection over perception. Filters candidates with
 *  the supplied predicate, scores each by HRR resonance against the
 *  intent vector + a small proximity tiebreaker, returns the top match. */
export function hrrSelectTarget(
  intent: HRRVec,
  perception: PerceptionResult,
  predicate: (entity: EntityRecord) => boolean,
  agentPos: { x: number; y: number; z: number },
  opts: HrrTargetSelectOptions = {},
): TargetCandidate | null {
  const proximityWeight = opts.proximityWeight ?? 0.10;
  let best: TargetCandidate | null = null;

  for (const e of perception.visibleEntities) {
    if (!predicate(e)) continue;

    // Candidate HRR encoding: "this kind as a target"
    const candidateEnc = bind(_targetRole, kindVec(e.prototypeId));
    const hrrScore = Math.max(0, cosine(intent, candidateEnc));

    // Geometric proximity (tiebreaker)
    const dx = e.transform.position.x - agentPos.x;
    const dz = e.transform.position.z - agentPos.z;
    const d2 = dx * dx + dz * dz;
    const proximityScore = 1 / (1 + d2);

    const totalScore = hrrScore + proximityWeight * proximityScore;

    if (!best || totalScore > best.totalScore) {
      best = { id: e.id, hrrScore, proximityScore, totalScore };
    }
  }
  return best;
}

/** Convenience: pick a target by affordance verb (the most common case). */
export function hrrSelectByAffordance(
  intent: HRRVec,
  perception: PerceptionResult,
  affordance: string,
  agentPos: { x: number; y: number; z: number },
  opts: HrrTargetSelectOptions = {},
): TargetCandidate | null {
  return hrrSelectTarget(
    intent, perception,
    (e) => e.components.interactable?.verb === affordance,
    agentPos, opts,
  );
}

/** Convenience: pick any visible entity (no affordance filter). */
export function hrrSelectAnyVisible(
  intent: HRRVec,
  perception: PerceptionResult,
  agentPos: { x: number; y: number; z: number },
  opts: HrrTargetSelectOptions = {},
): TargetCandidate | null {
  return hrrSelectTarget(
    intent, perception,
    (_e) => true,
    agentPos, opts,
  );
}
