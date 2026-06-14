// Mission chain + Current Objective banner.
//
// Wraps the engine QuestSystem with an ordered starter arc ("Wanderer's First
// World"). The arc reuses existing LAUNCH_QUESTS by id; this layer adds the
// ordering, the on-screen objective banner, and the completion reward. It is
// driven entirely by real engine events (subscribes to the EventBus), so there
// is no dead scaffolding — every step advances when its underlying quest's
// predicate fires.

import type { QuestSystem } from "@engine/features/quests/index.js";
import type { EventBus } from "@engine/cmd/index.js";

export interface MissionStep {
  /** Quest id in LAUNCH_QUESTS this step gates on. */
  questId: string;
  /** Player-facing objective title (overrides the quest title for the arc). */
  title: string;
  /** One-line "how to" hint shown under the title. */
  hint: string;
}

/** The ordered starter arc. Each step maps to a real LAUNCH_QUESTS entry. */
export const FIRST_WORLD_ARC: MissionStep[] = [
  { questId: "q-first-build",    title: "Speak your first thing into being", hint: "Press / then type: spawn a wooden cottage" },
  { questId: "q-first-pickup",   title: "Take something in your hand",       hint: "Walk up to a pickup-able object and press E" },
  { questId: "q-build-temple",   title: "Raise a temple",                    hint: "Press / then type: spawn a marble temple" },
  { questId: "q-first-portal",   title: "Step through a doorway",            hint: "Walk into one of the glowing doorways — they are walk-through" },
  { questId: "q-creation-saved", title: "Save your world",                   hint: "Press / then type: save" },
];

export interface MissionBannerOpts {
  quests: QuestSystem;
  events: EventBus;
  bannerEl: HTMLElement;
  titleEl: HTMLElement;
  hintEl: HTMLElement;
  progressEl: HTMLElement;
  /** Show a transient toast (mission rewards / completion). */
  toast: (msg: string, ms?: number) => void;
  /** Fired exactly once when the whole arc completes — grants the reward. */
  onArcComplete: () => void;
  arc?: MissionStep[];
}

export class MissionBanner {
  private quests: QuestSystem;
  private banner: HTMLElement;
  private titleEl: HTMLElement;
  private hintEl: HTMLElement;
  private progressEl: HTMLElement;
  private toast: (msg: string, ms?: number) => void;
  private onArcComplete: () => void;
  private arc: MissionStep[];
  private unsub?: () => void;
  private lastStepId: string | null = null;
  private arcDone = false;

  constructor(opts: MissionBannerOpts) {
    this.quests = opts.quests;
    this.banner = opts.bannerEl;
    this.titleEl = opts.titleEl;
    this.hintEl = opts.hintEl;
    this.progressEl = opts.progressEl;
    this.toast = opts.toast;
    this.onArcComplete = opts.onArcComplete;
    this.arc = opts.arc ?? FIRST_WORLD_ARC;
    // Re-evaluate the objective after every engine event (quests complete
    // inside the same event dispatch, so by the time this fires the relevant
    // quest's isCompleted() is already true).
    this.unsub = opts.events.on("*", () => this.refresh());
  }

  /** Show the banner and render the current objective. */
  start(): void {
    this.banner.classList.remove("hidden");
    this.refresh();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
    this.banner.classList.add("hidden");
  }

  /** Index of the first arc step whose quest is not yet completed. */
  private currentIndex(): number {
    for (let i = 0; i < this.arc.length; i++) {
      if (!this.quests.isCompleted(this.arc[i].questId)) return i;
    }
    return this.arc.length; // all done
  }

  private refresh(): void {
    const idx = this.currentIndex();
    const completed = this.arc.filter((s) => this.quests.isCompleted(s.questId)).length;

    if (idx >= this.arc.length) {
      // Arc complete.
      if (!this.arcDone) {
        this.arcDone = true;
        this.titleEl.textContent = "Wanderer's First World — complete";
        this.hintEl.textContent = "You've learned the loop. The world is yours to shape.";
        this.progressEl.textContent = `${this.arc.length} / ${this.arc.length} done`;
        try { this.onArcComplete(); } catch { /* reward best-effort */ }
        // Fade the banner out after a beat.
        window.setTimeout(() => this.banner.classList.add("hidden"), 6000);
      }
      return;
    }

    const step = this.arc[idx];
    this.progressEl.textContent = `step ${idx + 1} of ${this.arc.length}  ·  ${completed} done`;
    if (step.questId !== this.lastStepId) {
      this.lastStepId = step.questId;
      this.titleEl.textContent = step.title;
      this.hintEl.textContent = step.hint;
      // Announce advancement (skip the very first render).
      if (completed > 0) this.toast(`Objective complete — next: ${step.title}`, 2600);
    }
  }
}
