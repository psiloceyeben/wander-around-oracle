// Feature: Voice push-to-talk + speech synthesis.
//
// Wraps browser SpeechRecognition + SpeechSynthesis. Headless-safe (no-op
// outside DOM). Final transcripts get fed into the slash dispatcher OR
// the prompt resolver, producing commands the standard way.

export interface VoiceTranscriptHandler {
  (text: string, isFinal: boolean): void;
}

export interface VoiceOptions {
  /** Receives transcribed text. */
  onResult: VoiceTranscriptHandler;
  /** Optional locale, default "en-US". */
  lang?: string;
  /** Continuous mode (vs push-to-talk single utterance). Default false. */
  continuous?: boolean;
}

export class VoiceCapture {
  private recognition: any | null = null;
  private active = false;
  private opts: VoiceOptions;

  constructor(opts: VoiceOptions) { this.opts = opts; }

  isAvailable(): boolean {
    if (typeof window === "undefined") return false;
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start(): boolean {
    if (this.active) return true;
    if (!this.isAvailable()) return false;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = !!this.opts.continuous;
    rec.interimResults = true;
    rec.lang = this.opts.lang ?? "en-US";
    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        this.opts.onResult(transcript, result.isFinal);
      }
    };
    rec.onerror = (e: any) => console.warn("[voice] error", e);
    rec.onend = () => { this.active = false; };
    try {
      rec.start();
      this.recognition = rec;
      this.active = true;
      return true;
    } catch (e) {
      console.warn("[voice] start failed", e);
      return false;
    }
  }

  stop(): void {
    if (!this.active) return;
    try { this.recognition?.stop(); } catch {}
    this.active = false;
  }

  isActive(): boolean { return this.active; }
}

export interface SpeakOptions {
  rate?: number;     // 0.1 .. 10, default 1
  pitch?: number;    // 0 .. 2, default 1
  volume?: number;   // 0 .. 1, default 1
  voice?: string;    // voice name (browser-specific)
}

/** Speak text via the browser's SpeechSynthesis. No-op outside DOM. */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  if (typeof window === "undefined" || !(window as any).speechSynthesis) return false;
  try {
    const u = new (window as any).SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;
    if (opts.voice) {
      const voices = (window as any).speechSynthesis.getVoices();
      const v = voices.find((vv: any) => vv.name === opts.voice);
      if (v) u.voice = v;
    }
    (window as any).speechSynthesis.speak(u);
    return true;
  } catch (e) {
    console.warn("[voice] speak failed", e);
    return false;
  }
}

/** Cancel all pending utterances. */
export function cancelSpeech(): void {
  if (typeof window !== "undefined" && (window as any).speechSynthesis) {
    (window as any).speechSynthesis.cancel();
  }
}
