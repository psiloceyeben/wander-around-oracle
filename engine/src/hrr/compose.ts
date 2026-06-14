// Higher-level composition operations over HRR vectors.
//
// superpose(...vecs) — sum many vectors (then optionally normalize)
// bindRole(role, value) — bind a value to a role key (the canonical "field" of an entity)
// composeEntity({role: value, ...}) — compose many role-value bindings into one entity vector
// queryRole(entity, role) — unbind a role from an entity (approximate value vector before cleanup)

import { type HRRVec, zeroVec } from "./types.js";
import { bind, unbind, addInto, normalize } from "./core.js";

/** Sum many vectors. If `normalizeOut` is true, return a unit-magnitude result. */
export function superpose(vecs: HRRVec[], normalizeOut: boolean = false): HRRVec {
  const out = zeroVec();
  for (const v of vecs) addInto(out, v);
  if (normalizeOut) normalize(out);
  return out;
}

/** Bind a value vector to a role key vector. Convention: bind(role, value). */
export function bindRole(roleKey: HRRVec, value: HRRVec): HRRVec {
  return bind(roleKey, value);
}

/** Compose an entity from a map of role-name vectors to value vectors.
 *  Caller is responsible for providing the role-key vectors (typically via
 *  roleVec("kind") etc. from seed.ts). The returned vector is the
 *  superposition of all role-bound values, optionally normalized. */
export function composeBindings(
  pairs: ReadonlyArray<[HRRVec, HRRVec]>,
  normalizeOut: boolean = true,
): HRRVec {
  const out = zeroVec();
  for (const [roleKey, value] of pairs) {
    addInto(out, bind(roleKey, value));
  }
  if (normalizeOut) normalize(out);
  return out;
}

/** Query a role from a composite vector. Returns the noisy approximation of
 *  the bound value vector. Pass result through cleanup() to snap to nearest
 *  known attractor. */
export function queryRole(entity: HRRVec, roleKey: HRRVec): HRRVec {
  return unbind(entity, roleKey);
}
