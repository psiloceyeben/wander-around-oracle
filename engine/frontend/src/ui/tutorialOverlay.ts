// Tutorial overlay — bottom-anchored panel that shows the first-launch
// companion's current line. Reads the FirstLaunchTutorial state machine
// (currentLine() / isActive()) and refreshes as the engine advances steps.
//
// Steps advance on real engine events (EntitySpawned, EntityPickedUp, …) or
// on internal delays — both handled inside FirstLaunchTutorial. This overlay
// only mirrors the companion's current line; the "skip" button aborts the
// tutorial cleanly (despawns the companion).

import type { FirstLaunchTutorial } from "@engine/features/firstLaunchTutorial/index.js";

export interface TutorialOverlayOpts {
  containerEl: HTMLElement;
  textEl: HTMLElement;
  /** The button in the overlay — relabelled to "skip" (aborts the tutorial). */
  nextBtnEl: HTMLElement;
  tutorial: FirstLaunchTutorial;
}

export class TutorialOverlay {
  private container: HTMLElement;
  private text: HTMLElement;
  private skipBtn: HTMLElement;
  private tutorial: FirstLaunchTutorial;
  private polling: number | null = null;
  private lastLine: string | null = null;

  constructor(opts: TutorialOverlayOpts) {
    this.container = opts.containerEl;
    this.text = opts.textEl;
    this.skipBtn = opts.nextBtnEl;
    this.tutorial = opts.tutorial;
    this.skipBtn.textContent = "skip";
    this.skipBtn.addEventListener("click", () => {
      this.tutorial.abort();
      this.stop();
    });
  }

  /** Begin mirroring the tutorial. The engine tutorial is started by main.ts;
   *  this only drives the visible line + polling refresh. */
  start(): void {
    this.lastLine = null;
    this.refresh();
    if (this.polling === null) {
      this.polling = window.setInterval(() => this.refresh(), 400);
    }
  }

  stop(): void {
    if (this.polling !== null) {
      clearInterval(this.polling);
      this.polling = null;
    }
    this.container.classList.add("hidden");
    this.lastLine = null;
  }

  refresh(): void {
    // Once the tutorial is no longer active (finished or aborted), hide.
    if (!this.tutorial.isActive()) {
      this.stop();
      return;
    }
    const line = this.tutorial.currentLine();
    if (!line) {
      this.container.classList.add("hidden");
      return;
    }
    this.container.classList.remove("hidden");
    if (line !== this.lastLine) {
      this.lastLine = line;
      this.text.textContent = line;
    }
  }
}
