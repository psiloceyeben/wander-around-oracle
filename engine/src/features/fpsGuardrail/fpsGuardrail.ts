// Feature: FPS guardrail.
//
// Measures FPS during the first N seconds of play. If median falls below
// threshold, offers a one-click "use low-quality preset" option that
// actually does what it claims (vs v7.2's A12b bug where the preset was
// mostly a no-op).
//
// Quality settings flow through a config object the projection layer
// reads — the guardrail doesn't poke private state directly.

export interface QualityConfig {
  pixelRatio: number;       // 0.5 .. 2.0
  outlineEnabled: boolean;
  biomeRadiusChunks: number;
  shadowsEnabled: boolean;
}

export const QUALITY_HIGH: QualityConfig = {
  pixelRatio: 1.0,
  outlineEnabled: true,
  biomeRadiusChunks: 6,
  shadowsEnabled: true,
};

export const QUALITY_LOW: QualityConfig = {
  pixelRatio: 0.5,
  outlineEnabled: false,
  biomeRadiusChunks: 3,
  shadowsEnabled: false,
};

export interface FPSGuardrailOptions {
  /** Threshold below which low-quality is offered. Default 28. */
  thresholdFps?: number;
  /** Measurement window in seconds. Default 6. */
  measurementSeconds?: number;
  /** Persistence — read/write the player's choice. */
  storage?: {
    getChoice(): "high" | "low" | "auto" | null;
    setChoice(c: "high" | "low"): void;
  };
  /** Called when the guardrail wants to change quality. The application
   *  applies the config (resize renderer, toggle outline, change biome radius). */
  applyQuality: (q: QualityConfig) => void;
  /** Called when the guardrail wants to ASK the player. Implementation shows a UI prompt; resolves to the user's choice. */
  promptUser?: (measuredFps: number) => Promise<"high" | "low">;
  /** Inject a time source (for tests). Defaults to performance.now or Date.now. */
  now?: () => number;
}

export class FPSGuardrail {
  private opts: FPSGuardrailOptions;
  private frameTimes: number[] = [];
  private lastFrameMs = 0;
  private measuring = false;
  private decided = false;

  constructor(opts: FPSGuardrailOptions) {
    this.opts = opts;
  }

  /** Apply persisted choice if any, otherwise start measuring. */
  init(): void {
    const stored = this.opts.storage?.getChoice();
    if (stored === "low") {
      this.opts.applyQuality(QUALITY_LOW);
      return;
    }
    if (stored === "high") return;  // committed to high already
    this.measuring = true;
    this.lastFrameMs = this._now();
  }

  /** Call each frame from the main loop. */
  tick(): void {
    if (!this.measuring || this.decided) return;
    const now = this._now();
    const dt = now - this.lastFrameMs;
    this.lastFrameMs = now;
    if (dt > 0 && dt < 200) {  // ignore tab-switch frame drops
      this.frameTimes.push(dt);
    }
    const targetFrames = (this.opts.measurementSeconds ?? 6) * 60;
    if (this.frameTimes.length >= targetFrames) {
      void this._decide();
    }
  }

  isComplete(): boolean { return this.decided; }
  sampleCount(): number { return this.frameTimes.length; }

  medianFps(): number {
    if (this.frameTimes.length === 0) return 0;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return 1000 / median;
  }

  private async _decide(): Promise<void> {
    if (this.decided) return;
    this.decided = true;
    this.measuring = false;
    const fps = this.medianFps();
    const threshold = this.opts.thresholdFps ?? 28;
    if (fps >= threshold) {
      this.opts.storage?.setChoice("high");
      return;
    }
    // Ask the user — or auto-apply low if no prompt
    let choice: "high" | "low" = "low";
    if (this.opts.promptUser) {
      try { choice = await this.opts.promptUser(fps); } catch {}
    }
    this.opts.storage?.setChoice(choice);
    if (choice === "low") this.opts.applyQuality(QUALITY_LOW);
  }

  private _now(): number {
    if (this.opts.now) return this.opts.now();
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }
}
