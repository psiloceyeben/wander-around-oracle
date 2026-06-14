// Layer 9 — Social / network substrate.
//
// A Room is a shared world hosted by a server (or by a peer in P2P). Each
// connected client maintains a local World that is a deterministic replay
// of the room's command log. The server is the authoritative orderer:
// clients submit commands, the server assigns sequence numbers, and the
// ordered command stream is rebroadcast to all clients.
//
// Local-only commands (UI state, camera, projection style) never enter the
// room's command log. Only world-mutating commands are synced.
//
// Determinism guarantees that all clients observe the same world state
// without reconciliation, as long as:
//   - All clients share the same seed
//   - The command application order is identical
//   - The reducer is pure of the world state at the time of application

import { type Command } from "../cmd/types.js";
import { type EntityId } from "../entity/types.js";

export type RoomId = string;

/** A persona is a portable HRR-shaped identity that follows a player across
 *  rooms. We represent the persona externally as its id + display name; the
 *  HRR vector is derived from the id via seedVec for substrate-routing. */
export interface Persona {
  id: EntityId;
  displayName: string;
  /** Optional avatar prototype for rendering. */
  avatarPrototype?: string;
}

export interface RoomMessage {
  /** Sequence number assigned by the server. */
  seq: number;
  /** Tick at which the command was applied on the server. */
  appliedAtTick: number;
  command: Command;
  /** Originating persona. */
  from: EntityId;
}

/** Pluggable transport — abstracted so we can run rooms in-process for
 *  tests, over WebSocket for production, over WebRTC for P2P. */
export interface RoomTransport {
  /** Send a command to the room. Returns the message the server assigned. */
  send(cmd: Command, from: EntityId): Promise<RoomMessage>;
  /** Subscribe to incoming messages from the room. */
  onMessage(listener: (msg: RoomMessage) => void): () => void;
  /** Join the room. Returns the current state snapshot + the catch-up log. */
  join(persona: Persona): Promise<{ tick: number; backlog: RoomMessage[] }>;
  /** Leave the room. */
  leave(): Promise<void>;
}

/** In-process room transport for tests and single-process multi-agent demos. */
export class InProcessRoomTransport implements RoomTransport {
  private listeners = new Set<(msg: RoomMessage) => void>();
  private nextSeq = 1;
  private currentTick = 0;
  private log: RoomMessage[] = [];

  setTick(t: number): void { this.currentTick = t; }

  async send(cmd: Command, from: EntityId): Promise<RoomMessage> {
    const msg: RoomMessage = {
      seq: this.nextSeq++,
      appliedAtTick: this.currentTick,
      command: cmd,
      from,
    };
    this.log.push(msg);
    // Dispatch synchronously so tests can rely on order
    for (const l of this.listeners) l(msg);
    return msg;
  }

  onMessage(listener: (msg: RoomMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async join(_persona: Persona): Promise<{ tick: number; backlog: RoomMessage[] }> {
    return { tick: this.currentTick, backlog: this.log.slice() };
  }

  async leave(): Promise<void> {}
}
