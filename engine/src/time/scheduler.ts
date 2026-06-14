// Layer 3 — Time substrate.
//
// Fixed-step simulation tick separated from variable-rate rendering.
// Systems register with the scheduler at a tick rate; the scheduler runs
// them at fixed integer multiples of the base tick. This enables the
// multi-rate substrate metabolism described in the engine plan:
//   - Physics:        every  1 tick   (60 Hz)
//   - AI policy:      every  6 ticks  (10 Hz)
//   - Animation:      every  2 ticks  (30 Hz)
//   - Ecology:        every 60 ticks  (1 Hz)
//   - Geopolitics:    every 6000 ticks (0.01 Hz)
//
// All on the same world vector, same algebra, same authoritative state.
// The cost of background simulation does NOT scale with NPC count — adding
// NPCs adds to the same chunk vector that the substrate metabolism already
// operates on.

import { World } from "../world/index.js";

export type Tick = number;

export interface SystemContext {
  world: World;
  tick: Tick;
  /** Real-time delta (seconds) since the last invocation of THIS system.
   *  For multi-rate systems this is larger than the base dt. */
  dt: number;
}

export type TickSystem = (ctx: SystemContext) => void;

export interface SystemRegistration {
  name: string;
  /** Every Nth base tick this system runs. 1 = every tick. */
  every: number;
  system: TickSystem;
  /** Optional execution priority within the same tick (higher runs first). */
  priority?: number;
}

export const BASE_TICK_HZ = 60;
export const BASE_DT = 1 / BASE_TICK_HZ;

export class Scheduler {
  private systems: SystemRegistration[] = [];
  private lastRunAt = new Map<string, Tick>();
  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  register(reg: SystemRegistration): void {
    this.systems.push(reg);
    // Re-sort by priority descending (higher first); insertion order is preserved among equal priorities.
    this.systems.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  unregister(name: string): void {
    this.systems = this.systems.filter((s) => s.name !== name);
    this.lastRunAt.delete(name);
  }

  /** Advance one base tick. Runs every system whose `every` matches. */
  step(): void {
    this.world.tick++;
    const tick = this.world.tick;
    for (const reg of this.systems) {
      if (tick % reg.every !== 0) continue;
      const prev = this.lastRunAt.get(reg.name) ?? (tick - reg.every);
      const dt = (tick - prev) * BASE_DT;
      reg.system({ world: this.world, tick, dt });
      this.lastRunAt.set(reg.name, tick);
    }
  }

  /** Advance N ticks. Useful for catching up after frame drops. */
  stepN(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** Run the scheduler in real time for `seconds`, ticking at BASE_TICK_HZ.
   *  Caller is responsible for the render loop; this just advances simulation. */
  runFor(seconds: number): void {
    const totalTicks = Math.round(seconds * BASE_TICK_HZ);
    this.stepN(totalTicks);
  }
}
