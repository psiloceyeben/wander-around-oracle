// Layer 1 — Entity substrate types.
//
// An entity in this engine has two representations:
//
//   1. A canonical TypeScript record (EntityRecord) used for system operations
//      that need named field access — physics, rendering, scripting.
//
//   2. An HRR vector representation (entityToVec) used for substrate
//      operations — superposition into world chunks, query-by-role,
//      cleanup-classification of properties.
//
// The HRR form IS the canonical state per the substrate-paradigm thesis;
// the TS record is a working-memory projection of the HRR form for systems
// that benefit from named field access. Systems write through commands,
// which always route through the substrate.

import { type HRRVec } from "../hrr/types.js";
import { type Sephirah } from "../hrr/treeOfLife.js";

export type EntityId = string;
export type PrototypeId = string;

/** Continuous 3D transform. Position uses meters. */
export interface Transform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number }; // quaternion
  scale:    { x: number; y: number; z: number };
}

export function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale:    { x: 1, y: 1, z: 1 },
  };
}

/** Component types available to entities. Open set — new component types
 *  can be added without modifying the entity system core. */
export interface RenderableComponent {
  meshTag: string;          // looked up in the projection layer's mesh registry
  color?: string;
  opacity?: number;
}

export interface ColliderComponent {
  shape: "box" | "sphere" | "capsule";
  size: { x: number; y: number; z: number };
  solid: boolean;
}

export interface InteractableComponent {
  verb: "pickup" | "open" | "talk" | "use";
  range: number;
  immutable?: boolean;
}

export interface InventoryComponent {
  slots: number;
  contents: EntityId[];
}

export interface PartTreeComponent {
  parts: Array<{ id: string; transform: Transform; renderableTag: string }>;
}

export interface AIComponent {
  policy: "idle" | "wander" | "follow" | "hostile";
  perceptionRadius: number;
  state: Record<string, unknown>;
}

export interface PowerComponent {
  produces?: number;  // kW
  consumes?: number;
  connections?: EntityId[];
}

export interface PhysicsComponent {
  mass: number;
  velocity: { x: number; y: number; z: number };
  gravity: boolean;
}

export interface SaveableComponent {
  // Marker — entity persists to save files. Without this, entity is ephemeral.
  persistent: true;
}

export interface HolderComponent {
  // The entity is being held by another entity (typically a player).
  heldBy: EntityId;
}

export interface ComponentBag {
  renderable?: RenderableComponent;
  collider?: ColliderComponent;
  interactable?: InteractableComponent;
  inventory?: InventoryComponent;
  partTree?: PartTreeComponent;
  ai?: AIComponent;
  power?: PowerComponent;
  physics?: PhysicsComponent;
  saveable?: SaveableComponent;
  holder?: HolderComponent;
}

/** The canonical TS record for an entity. */
export interface EntityRecord {
  id: EntityId;
  prototypeId: PrototypeId;
  transform: Transform;
  components: ComponentBag;
  /** Optional Sephirah hint for routing. Set by the language layer when an
   *  entity is composed from a prompt; refined by the cognition layer. */
  sephirah?: Sephirah;
}

/** A snapshot of one entity's HRR-vector form alongside its TS record.
 *  In the engine's working memory, both forms coexist; serialization to
 *  saves and network messages uses only the HRR vector + a small header. */
export interface EntityState {
  record: EntityRecord;
  vec: HRRVec;
}
