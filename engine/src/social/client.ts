// RoomClient: connects a local World+CommandBus to a RoomTransport so
// commands route through the room and incoming room messages get applied
// to the local world's reducer.

import { type RoomTransport, type RoomMessage, type Persona } from "./room.js";
import { CommandBus } from "../cmd/bus.js";
import { type Command } from "../cmd/types.js";

export class RoomClient {
  private transport: RoomTransport;
  private bus: CommandBus;
  private persona: Persona;
  private unsub?: () => void;
  /** Track our own sequence numbers so we don't re-apply our own commands. */
  private sentSeqs = new Set<number>();

  constructor(transport: RoomTransport, bus: CommandBus, persona: Persona) {
    this.transport = transport;
    this.bus = bus;
    this.persona = persona;
  }

  async connect(): Promise<void> {
    const { backlog } = await this.transport.join(this.persona);
    // Apply backlog deterministically
    for (const msg of backlog) {
      this.applyRemote(msg);
    }
    // Subscribe to live messages
    this.unsub = this.transport.onMessage((msg) => this.applyRemote(msg));
  }

  async disconnect(): Promise<void> {
    this.unsub?.();
    this.unsub = undefined;
    await this.transport.leave();
  }

  /** Submit a command — sent to the server which assigns ordering, then
   *  broadcast back via onMessage. We don't apply locally here; we wait for
   *  the server's echo to ensure ordering matches other clients. */
  async submit(cmd: Command): Promise<void> {
    const msg = await this.transport.send(cmd, this.persona.id);
    this.sentSeqs.add(msg.seq);
    // Optimistic local apply for low-latency feel — could be added later.
    // For now: wait for echo. The InProcessRoomTransport dispatches sync,
    // so the echo arrives before this promise resolves to the next tick.
  }

  private applyRemote(msg: RoomMessage): void {
    this.bus.applyImmediate(msg.command);
  }
}
