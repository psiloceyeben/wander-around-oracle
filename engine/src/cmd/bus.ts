// Event bus + command queue + reducer wiring.
//
// CommandBus: collects commands, applies them via the reducer in submission
// order, dispatches resulting events to subscribers.
//
// EventBus: typed subscription to game events. Replaces the v7.2 string-keyed
// CustomEvent system, eliminating the entire class of "event name mismatch"
// bugs that broke 9 of 10 v7.2 starter quests.

import { type Command, type GameEvent, type EventKind, type EventListener } from "./types.js";
import { World } from "../world/index.js";

export class EventBus {
  private byKind = new Map<EventKind | "*", Set<EventListener>>();

  on(kind: EventKind | "*", listener: EventListener): () => void {
    let set = this.byKind.get(kind);
    if (!set) {
      set = new Set();
      this.byKind.set(kind, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit(event: GameEvent): void {
    const exact = this.byKind.get(event.kind);
    if (exact) for (const fn of exact) fn(event);
    const all = this.byKind.get("*");
    if (all) for (const fn of all) fn(event);
  }
}

export type Reducer = (world: World, cmd: Command) => GameEvent[];

export class CommandBus {
  readonly world: World;
  readonly events = new EventBus();
  private reducer: Reducer;
  private queue: Command[] = [];
  /** Append-only log of every applied command. The canonical history. */
  readonly log: Command[] = [];

  constructor(world: World, reducer: Reducer) {
    this.world = world;
    this.reducer = reducer;
  }

  /** Submit a command for later application. Returns the queue position. */
  submit(cmd: Command): number {
    this.queue.push(cmd);
    return this.queue.length;
  }

  /** Apply all queued commands now, in order. Emits resulting events. */
  flush(): void {
    while (this.queue.length > 0) {
      const cmd = this.queue.shift()!;
      this.applyOne(cmd);
    }
  }

  /** Apply a single command immediately, bypassing the queue.
   *  Useful for system-internal mutations during a tick. */
  applyImmediate(cmd: Command): GameEvent[] {
    return this.applyOne(cmd);
  }

  private applyOne(cmd: Command): GameEvent[] {
    const events = this.reducer(this.world, cmd);
    // Only log commands that produced something other than rejection
    const rejected = events.length === 1 && events[0].kind === "CommandRejected";
    if (!rejected) this.log.push(cmd);
    for (const e of events) this.events.emit(e);
    return events;
  }

  pendingCount(): number { return this.queue.length; }
  logCount(): number { return this.log.length; }
}
