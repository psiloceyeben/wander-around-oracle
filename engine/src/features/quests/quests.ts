// Feature: Quests — event-driven completion.
//
// Each quest is a predicate over GameEvents. Subscribes to the EventBus
// (Layer 4) and fires completion when its predicate matches. Fixes the
// v7.2 audit's #1 bug (9 of 10 events never fired) by routing through
// the engine's typed event bus instead of string-keyed CustomEvents.
//
// Persistence: completion state is held in memory; serialize via SaveWorld
// at the application layer.

import { type GameEvent, type EventListener } from "../../cmd/types.js";
import { EventBus } from "../../cmd/bus.js";

export interface Quest {
  id: string;
  title: string;
  description: string;
  /** Predicate: returns true on the event that completes this quest. */
  predicate: (e: GameEvent, state: QuestRuntimeState) => boolean;
}

export interface QuestRuntimeState {
  /** Per-quest state map; quests can stash counters etc. */
  store: Record<string, unknown>;
}

export interface QuestProgress {
  total: number;
  completed: number;
  completedIds: string[];
}

export class QuestSystem {
  private quests = new Map<string, Quest>();
  private completed = new Map<string, number>();  // id -> tick
  private state: QuestRuntimeState = { store: {} };
  private unsubs: Array<() => void> = [];
  private onComplete?: (q: Quest, tick: number) => void;

  constructor(opts?: { onComplete?: (q: Quest, tick: number) => void }) {
    this.onComplete = opts?.onComplete;
  }

  add(q: Quest): void {
    this.quests.set(q.id, q);
  }

  addMany(qs: Quest[]): void {
    for (const q of qs) this.add(q);
  }

  /** Wire to an EventBus — every event runs through every uncompleted quest's predicate. */
  attach(events: EventBus): void {
    const listener: EventListener = (e) => {
      for (const [id, q] of this.quests) {
        if (this.completed.has(id)) continue;
        let matched = false;
        try { matched = q.predicate(e, this.state); }
        catch (err) { console.warn(`[quests] ${id} predicate error:`, err); }
        if (matched) this.complete(id, e.tick);
      }
    };
    this.unsubs.push(events.on("*", listener));
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private complete(id: string, tick: number): void {
    if (this.completed.has(id)) return;
    this.completed.set(id, tick);
    const q = this.quests.get(id);
    if (q && this.onComplete) {
      try { this.onComplete(q, tick); } catch (err) { console.warn(`[quests] onComplete error:`, err); }
    }
  }

  progress(): QuestProgress {
    return {
      total: this.quests.size,
      completed: this.completed.size,
      completedIds: Array.from(this.completed.keys()),
    };
  }

  /** Reset for testing / world reset. */
  reset(): void {
    this.completed.clear();
    this.state = { store: {} };
  }

  isCompleted(id: string): boolean { return this.completed.has(id); }
  list(): Quest[] { return Array.from(this.quests.values()); }
  internalState(): QuestRuntimeState { return this.state; }
}

// ── Default launch quests (10, matching v7.2 starterQuests but on real events) ────

export const LAUNCH_QUESTS: Quest[] = [
  {
    id: "q-first-build",
    title: "Speak something into being",
    description: "Open the prompt console and describe anything. See it appear.",
    predicate: (e) => e.kind === "EntitySpawned" && e.entity.prototypeId !== "player",
  },
  {
    id: "q-build-temple",
    title: "Raise a temple",
    description: "Type something with 'temple' in it.",
    predicate: (e) => e.kind === "EntitySpawned" && e.entity.prototypeId === "temple",
  },
  {
    id: "q-build-grove",
    title: "Plant a grove",
    description: "Type 'a grove of trees' or 'a small forest'.",
    predicate: (e) => e.kind === "EntitySpawned" && e.entity.prototypeId === "grove",
  },
  {
    id: "q-first-pickup",
    title: "Take it in your hand",
    description: "Aim at any built thing. Press E.",
    predicate: (e) => e.kind === "EntityPickedUp",
  },
  {
    id: "q-first-drop",
    title: "Place it carefully",
    description: "Drop something somewhere meaningful.",
    predicate: (e) => e.kind === "EntityDropped",
  },
  {
    id: "q-first-portal",
    title: "Step through a doorway",
    description: "Walk into a portal. No key needed — they are walk-through.",
    predicate: (e) => e.kind === "PortalEntered",
  },
  {
    id: "q-five-builds",
    title: "Speak five things into being",
    description: "Make five builds in one session.",
    predicate: (e, s) => {
      if (e.kind !== "EntitySpawned" || e.entity.prototypeId === "player") return false;
      const c = (s.store["build_count"] as number | undefined) ?? 0;
      s.store["build_count"] = c + 1;
      return c + 1 >= 5;
    },
  },
  {
    id: "q-creation-saved",
    title: "Save a creation",
    description: "Open the workshop. Build something. Save it.",
    predicate: (e) => e.kind === "WorldSaved",
  },
  {
    id: "q-time-shift",
    title: "Shift the time of day",
    description: "Use /time to change when it is.",
    predicate: (e) => e.kind === "TimeChanged",
  },
  {
    id: "q-edit-something",
    title: "Edit a creation's properties",
    description: "Use the modifier panel on any entity.",
    predicate: (e) => e.kind === "ComponentsEdited",
  },
];
