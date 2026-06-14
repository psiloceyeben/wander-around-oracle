// Ambient audio — Web Audio synth pings on engine events.

export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  init(): void {
    if (this.ctx) return;
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx!;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.15;
    this.masterGain.connect(ctx.destination);
  }

  ping(freq: number = 660, durMs: number = 200, type: OscillatorType = "sine"): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    const dur = durMs / 1000;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(1, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  chime(kind: "pickup" | "drop" | "spawn" | "quest" | "save" | "portal"): void {
    switch (kind) {
      case "pickup": this.ping(880, 120); break;
      case "drop":   this.ping(440, 150); break;
      case "spawn":  this.ping(660, 250, "triangle"); break;
      case "quest":
        this.ping(660, 180);
        setTimeout(() => this.ping(990, 220, "triangle"), 90);
        break;
      case "save":   this.ping(523, 300, "sine"); break;
      case "portal": this.ping(330, 400, "sine"); break;
    }
  }

  setVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }
}
