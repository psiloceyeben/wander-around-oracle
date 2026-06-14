// Feature: First-launch tutorial with companion NPC.
//
// Spawns a wizard companion 2.5m to the player's right on first launch.
// Walks the player through 9 steps via real engine events (not the broken
// v7.2 CustomEvent-name-string approach). Each step advances when the
// expected event arrives. Companion despawns on farewell.

import { type GameEvent } from "../../cmd/types.js";
import { EventBus } from "../../cmd/bus.js";
import { CommandBus } from "../../cmd/bus.js";
import { identityTransform } from "../../entity/types.js";

export type TutorialStep =
  | "greet" | "suggest_prompt" | "applaud_spawn"
  | "suggest_pickup" | "suggest_drop"
  | "suggest_portal" | "applaud_portal"
  | "suggest_save" | "farewell";

interface StepDef {
  id: TutorialStep;
  line: string;       // what the companion says
  advance: "delay" | GameEvent["kind"];
  delayMs?: number;
}

const STEPS: StepDef[] = [
  { id: "greet",          line: "Hello, traveler. I'm here to show you around.",                 advance: "delay", delayMs: 4500 },
  { id: "suggest_prompt", line: "Press Enter and describe something. Try 'a wooden cottage'.",   advance: "EntitySpawned" },
  { id: "applaud_spawn",  line: "There it is. The world receives what you describe.",            advance: "delay", delayMs: 4000 },
  { id: "suggest_pickup", line: "Aim at your creation and press E to pick it up.",               advance: "EntityPickedUp" },
  { id: "suggest_drop",   line: "Now move and press E again to place it somewhere else.",        advance: "EntityDropped" },
  { id: "suggest_portal", line: "Around the spawn are doorways. Walk into any of them.",         advance: "PortalEntered" },
  { id: "applaud_portal", line: "Worlds within worlds. Type /hub to return.",                    advance: "delay", delayMs: 5000 },
  { id: "suggest_save",   line: "Press slash and type save to keep your work.",                  advance: "WorldSaved" },
  { id: "farewell",       line: "You're set. Build whatever you want. I'll be in the chat.",     advance: "delay", delayMs: 5000 },
];

const COMPANION_ID = "tutorial-companion";
const COMPANION_PROTO = "wizard_npc";

export interface TutorialOptions {
  /** Speak handler — wired to SpeechSynthesis or text-only HUD. */
  speak?: (text: string) => void;
  /** HUD message handler — text shown to the player. */
  hud?: (text: string) => void;
  /** Persistence: store/load whether the tutorial completed before. */
  storage?: {
    isCompleted(): boolean;
    setCompleted(): void;
    reset(): void;
  };
  /** Optional delay-driver — defaults to setTimeout. Pass a fake for tests. */
  schedule?: (fn: () => void, ms: number) => void;
}

export class FirstLaunchTutorial {
  private events: EventBus;
  private bus: CommandBus;
  private opts: TutorialOptions;
  private currentStep = -1;
  private active = false;
  private unsub?: () => void;

  constructor(events: EventBus, bus: CommandBus, opts: TutorialOptions = {}) {
    this.events = events;
    this.bus = bus;
    this.opts = opts;
  }

  /** Begin the tutorial. No-op if already-completed unless `force` is true. */
  start(opts?: { force?: boolean; playerPosition?: { x: number; y: number; z: number } }): boolean {
    if (this.active) return false;
    if (!opts?.force && this.opts.storage?.isCompleted()) return false;

    // Spawn the companion as a NPC entity
    const pp = opts?.playerPosition ?? { x: 0, y: 0, z: 0 };
    this.bus.applyImmediate({
      kind: "SpawnEntity",
      id: COMPANION_ID,
      prototypeId: COMPANION_PROTO,
      transform: { ...identityTransform(), position: { x: pp.x + 2.5, y: pp.y, z: pp.z - 2.0 } },
      components: {
        renderable: { meshTag: "tutorial_wizard" },
        ai: { policy: "idle", perceptionRadius: 5, state: { tutorialCompanion: true } },
      },
    });

    this.active = true;
    this.currentStep = -1;
    this.unsub = this.events.on("*", this._onEvent);
    this._enterStep(0);
    return true;
  }

  /** Abort the tutorial mid-way. Despawn companion. */
  abort(): void {
    if (!this.active) return;
    this.active = false;
    this.unsub?.();
    this.unsub = undefined;
    this.bus.applyImmediate({ kind: "RemoveEntity", id: COMPANION_ID });
  }

  isActive(): boolean { return this.active; }
  currentStepId(): TutorialStep | null {
    if (this.currentStep < 0 || this.currentStep >= STEPS.length) return null;
    return STEPS[this.currentStep].id;
  }

  /** The companion's current line (the STEPS entry's message for the active
   *  step), or null when the tutorial is not on a step. Used by the HUD
   *  overlay to display guidance text. */
  currentLine(): string | null {
    if (this.currentStep < 0 || this.currentStep >= STEPS.length) return null;
    return STEPS[this.currentStep].line;
  }

  private _onEvent = (e: GameEvent): void => {
    if (!this.active) return;
    const step = STEPS[this.currentStep];
    if (!step) return;
    if (step.advance !== "delay" && step.advance === e.kind) {
      this._enterStep(this.currentStep + 1);
    }
  };

  private _enterStep(idx: number): void {
    if (idx >= STEPS.length) {
      this._finish();
      return;
    }
    this.currentStep = idx;
    const step = STEPS[idx];
    this.opts.speak?.(step.line);
    this.opts.hud?.(step.line);
    if (step.advance === "delay" && step.delayMs) {
      const sched = this.opts.schedule ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
      const captured = idx;
      sched(() => {
        if (this.active && this.currentStep === captured) {
          this._enterStep(captured + 1);
        }
      }, step.delayMs);
    }
  }

  private _finish(): void {
    if (!this.active) return;
    this.active = false;
    this.unsub?.();
    this.unsub = undefined;
    // Despawn companion after a brief delay
    const sched = this.opts.schedule ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
    sched(() => {
      try { this.bus.applyImmediate({ kind: "RemoveEntity", id: COMPANION_ID }); } catch {}
    }, 2000);
    this.opts.storage?.setCompleted();
  }
}

export { COMPANION_ID, COMPANION_PROTO };
