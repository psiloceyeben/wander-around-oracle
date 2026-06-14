// Encode an EntityRecord into an HRR vector.
//
// The encoding is:
//   entity_vec = bind(role:kind,     kindVec(prototypeId))
//              + bind(role:position, encode_position(transform.position))
//              + bind(role:sephirah, sephirahVec(record.sephirah))
//              + bind(role:components, component_vector)   [Σ of bound components]
//
// Position encoding: scalar coordinates → HRR vector via fractional binding
// (a la Komer's "fractional power encoding") so nearby positions have
// similar HRR vectors. For now we use a simpler hash-based encoding; the
// FPE upgrade is a Layer 2 optimization once spatial queries are wired up.

import { type HRRVec } from "../hrr/types.js";
import { bind, addInto } from "../hrr/core.js";
import { roleVec, kindVec, seedVec } from "../hrr/seed.js";
import { sephirahVec } from "../hrr/treeOfLife.js";
import { composeBindings } from "../hrr/compose.js";
import { type EntityRecord } from "./types.js";

// Cache role vectors so we only seed them once
const _roles = {
  kind:        roleVec("kind"),
  position:    roleVec("position"),
  rotation:    roleVec("rotation"),
  sephirah:    roleVec("sephirah"),
  components:  roleVec("components"),
  comp_renderable:   roleVec("c:renderable"),
  comp_collider:     roleVec("c:collider"),
  comp_interactable: roleVec("c:interactable"),
  comp_inventory:    roleVec("c:inventory"),
  comp_partTree:     roleVec("c:partTree"),
  comp_ai:           roleVec("c:ai"),
  comp_power:        roleVec("c:power"),
  comp_physics:      roleVec("c:physics"),
  comp_saveable:     roleVec("c:saveable"),
  comp_holder:       roleVec("c:holder"),
};

export function roleVecOf(name: "kind" | "position" | "rotation" | "sephirah" | "components"): HRRVec {
  return _roles[name];
}

/** Quantize a continuous coordinate to a small integer bucket and seed a
 *  vector from the bucket. Quantization step is 1m by default — sufficient
 *  for HRR-spatial-routing at world scale. Sub-meter precision lives in the
 *  TS record, not the HRR encoding. */
function quantizePos(x: number, y: number, z: number, step: number = 1): string {
  const qx = Math.round(x / step);
  const qy = Math.round(y / step);
  const qz = Math.round(z / step);
  return `pos:${qx}|${qy}|${qz}`;
}

export function encodePosition(p: { x: number; y: number; z: number }): HRRVec {
  return seedVec(quantizePos(p.x, p.y, p.z));
}

/** Encode a component bag as a superposition of role:value bindings. */
export function encodeComponents(record: EntityRecord): HRRVec {
  const pairs: Array<[HRRVec, HRRVec]> = [];
  const c = record.components;
  if (c.renderable)
    pairs.push([_roles.comp_renderable, kindVec(c.renderable.meshTag)]);
  if (c.collider)
    pairs.push([_roles.comp_collider, seedVec(`collider:${c.collider.shape}:${c.collider.solid ? "solid" : "hollow"}`)]);
  if (c.interactable)
    pairs.push([_roles.comp_interactable, seedVec(`interact:${c.interactable.verb}`)]);
  if (c.inventory)
    pairs.push([_roles.comp_inventory, seedVec(`inv:${c.inventory.slots}`)]);
  if (c.partTree)
    pairs.push([_roles.comp_partTree, seedVec(`parts:${c.partTree.parts.length}`)]);
  if (c.ai)
    pairs.push([_roles.comp_ai, seedVec(`ai:${c.ai.policy}`)]);
  if (c.power)
    pairs.push([_roles.comp_power, seedVec(`power:${c.power.produces ?? 0}:${c.power.consumes ?? 0}`)]);
  if (c.physics)
    pairs.push([_roles.comp_physics, seedVec(`physics:${c.physics.gravity ? "g" : "ng"}`)]);
  if (c.saveable)
    pairs.push([_roles.comp_saveable, seedVec("saveable:true")]);
  if (c.holder)
    pairs.push([_roles.comp_holder, seedVec(`held_by:${c.holder.heldBy}`)]);
  return composeBindings(pairs, true);
}

/** Full entity encoding. Result is a unit HRR vector. */
export function entityToVec(record: EntityRecord): HRRVec {
  const pairs: Array<[HRRVec, HRRVec]> = [
    [_roles.kind,     kindVec(record.prototypeId)],
    [_roles.position, encodePosition(record.transform.position)],
  ];
  if (record.sephirah) {
    pairs.push([_roles.sephirah, sephirahVec(record.sephirah)]);
  }
  // Components are themselves a superposed bind, then bound under role:components
  const compVec = encodeComponents(record);
  pairs.push([_roles.components, compVec]);
  return composeBindings(pairs, true);
}

/** Dictionary of all known prototype vectors for cleanup against kind queries. */
const _knownPrototypes: Array<{ label: string; vec: HRRVec }> = [];
const _knownPrototypeSet = new Set<string>();

export function registerPrototype(id: string): void {
  if (_knownPrototypeSet.has(id)) return;
  _knownPrototypeSet.add(id);
  _knownPrototypes.push({ label: id, vec: kindVec(id) });
}

export function knownPrototypes(): ReadonlyArray<{ label: string; vec: HRRVec }> {
  return _knownPrototypes;
}

/** Construct a fresh "registry" vector — the superposition of bound entity
 *  vectors keyed by their id. Used by the world substrate to hold all
 *  entities of a chunk in a single HRR vector. */
export function emptyRegistryVec(): HRRVec {
  // Just a zero vector; entities get bound-and-added as the world fills.
  // Importing zeroVec from types lazily to avoid circular deps:
  const N = 1024;
  return { real: new Float64Array(N), imag: new Float64Array(N) };
}

export function registryAdd(registry: HRRVec, idVec: HRRVec, entityVec: HRRVec): void {
  addInto(registry, bind(idVec, entityVec));
}

export function registryRemove(registry: HRRVec, idVec: HRRVec, entityVec: HRRVec): void {
  // Subtract the bound pair
  const r = registry.real;
  const i = registry.imag;
  const bound = bind(idVec, entityVec);
  for (let k = 0; k < r.length; k++) {
    r[k] -= bound.real[k];
    i[k] -= bound.imag[k];
  }
}
