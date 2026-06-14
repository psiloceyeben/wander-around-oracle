// Layer 4 — Command and Event substrate.
//
// Commands are the ONLY way to mutate the world. The reducer takes a command
// plus the current world and produces events plus mutated world state.
// Events are the symmetric output — subscribers consume them.
//
// Determinism: the reducer is a pure function of (world, command, tick).
// Same seed + same command sequence = identical world states across runs.
// This is what makes save/load, multiplayer, replay, and undo possible.
//
// Commands also have an HRR-vector form (for substrate-native routing in
// the network and cognition layers), but the canonical form during reduction
// is the typed TS record below.

import { type EntityId, type EntityRecord, type Transform, type ComponentBag, type PrototypeId } from "../entity/types.js";
import { type Sephirah } from "../hrr/treeOfLife.js";

export type CommandKind =
  | "SpawnEntity"
  | "RemoveEntity"
  | "MoveEntity"
  | "PickupEntity"
  | "DropEntity"
  | "EditComponents"
  | "EnterPortal"
  | "SaveWorld"
  | "LoadWorld"
  | "SetTimeOfDay";

export interface BaseCommand {
  /** Monotonically increasing per-issuer; used for deduplication and ordering. */
  seq?: number;
  /** Player or system id that issued this command. */
  initiator?: string;
  /** Tick at which the command was issued. Reducer uses this for validation. */
  issuedAt?: number;
}

export interface SpawnEntityCommand extends BaseCommand {
  kind: "SpawnEntity";
  id: EntityId;
  prototypeId: PrototypeId;
  transform: Transform;
  components: ComponentBag;
  sephirah?: Sephirah;
}

export interface RemoveEntityCommand extends BaseCommand {
  kind: "RemoveEntity";
  id: EntityId;
}

export interface MoveEntityCommand extends BaseCommand {
  kind: "MoveEntity";
  id: EntityId;
  transform: Partial<Transform>;
}

export interface PickupEntityCommand extends BaseCommand {
  kind: "PickupEntity";
  targetId: EntityId;
  holderId: EntityId;
}

export interface DropEntityCommand extends BaseCommand {
  kind: "DropEntity";
  targetId: EntityId;
  holderId: EntityId;
  dropTransform: Transform;
}

export interface EditComponentsCommand extends BaseCommand {
  kind: "EditComponents";
  id: EntityId;
  /** Partial component bag merged into the entity's components. */
  patch: Partial<ComponentBag>;
}

export interface EnterPortalCommand extends BaseCommand {
  kind: "EnterPortal";
  portalId: EntityId;
  playerId: EntityId;
}

export interface SaveWorldCommand extends BaseCommand {
  kind: "SaveWorld";
  slot: string;
}

export interface LoadWorldCommand extends BaseCommand {
  kind: "LoadWorld";
  slot: string;
  data: unknown; // serialized payload
}

export interface SetTimeOfDayCommand extends BaseCommand {
  kind: "SetTimeOfDay";
  hours: number;
}

export type Command =
  | SpawnEntityCommand
  | RemoveEntityCommand
  | MoveEntityCommand
  | PickupEntityCommand
  | DropEntityCommand
  | EditComponentsCommand
  | EnterPortalCommand
  | SaveWorldCommand
  | LoadWorldCommand
  | SetTimeOfDayCommand;

// ── Events ───────────────────────────────────────────────────────────────

export type EventKind =
  | "EntitySpawned"
  | "EntityRemoved"
  | "EntityMoved"
  | "EntityPickedUp"
  | "EntityDropped"
  | "ComponentsEdited"
  | "PortalEntered"
  | "WorldSaved"
  | "WorldLoaded"
  | "TimeChanged"
  | "CommandRejected";

export interface BaseEvent {
  tick: number;
}

export interface EntitySpawnedEvent extends BaseEvent {
  kind: "EntitySpawned";
  entity: EntityRecord;
}

export interface EntityRemovedEvent extends BaseEvent {
  kind: "EntityRemoved";
  id: EntityId;
  prototypeId: PrototypeId;
}

export interface EntityMovedEvent extends BaseEvent {
  kind: "EntityMoved";
  id: EntityId;
  from: Transform;
  to: Transform;
}

export interface EntityPickedUpEvent extends BaseEvent {
  kind: "EntityPickedUp";
  targetId: EntityId;
  holderId: EntityId;
}

export interface EntityDroppedEvent extends BaseEvent {
  kind: "EntityDropped";
  targetId: EntityId;
  holderId: EntityId;
  transform: Transform;
}

export interface ComponentsEditedEvent extends BaseEvent {
  kind: "ComponentsEdited";
  id: EntityId;
  patch: Partial<ComponentBag>;
}

export interface PortalEnteredEvent extends BaseEvent {
  kind: "PortalEntered";
  portalId: EntityId;
  playerId: EntityId;
}

export interface WorldSavedEvent extends BaseEvent {
  kind: "WorldSaved";
  slot: string;
}

export interface WorldLoadedEvent extends BaseEvent {
  kind: "WorldLoaded";
  slot: string;
}

export interface TimeChangedEvent extends BaseEvent {
  kind: "TimeChanged";
  hours: number;
}

export interface CommandRejectedEvent extends BaseEvent {
  kind: "CommandRejected";
  command: Command;
  reason: string;
}

export type GameEvent =
  | EntitySpawnedEvent
  | EntityRemovedEvent
  | EntityMovedEvent
  | EntityPickedUpEvent
  | EntityDroppedEvent
  | ComponentsEditedEvent
  | PortalEnteredEvent
  | WorldSavedEvent
  | WorldLoadedEvent
  | TimeChangedEvent
  | CommandRejectedEvent;

/** Subscribe a listener to events of a specific kind (or "*" for all). */
export type EventListener = (e: GameEvent) => void;
