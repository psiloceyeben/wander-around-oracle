// Keyboard input tracker. Holds a Set of currently-pressed key codes and
// fires onAction for keyup events that match action bindings.

export type KeyAction =
  | "interact"      // E
  | "jump"          // Space
  | "open_slash"    // /
  | "toggle_help"   // H
  | "toggle_quests" // Q
  | "toggle_workshop" // K (W is taken by movement)
  | "toggle_map"    // M
  | "toggle_perf"   // P
  | "exit";         // Escape

const ACTION_KEYS: Record<string, KeyAction> = {
  "KeyE":     "interact",
  "Space":    "jump",
  "Slash":    "open_slash",
  "KeyH":     "toggle_help",
  "KeyQ":     "toggle_quests",
  "KeyK":     "toggle_workshop",
  "KeyM":     "toggle_map",
  "KeyP":     "toggle_perf",
  "Escape":   "exit",
};

export class KeyboardController {
  private down = new Set<string>();
  private actionHandlers = new Map<KeyAction, Set<() => void>>();
  private suspended = false;

  constructor() {
    document.addEventListener("keydown", this.handleDown);
    document.addEventListener("keyup", this.handleUp);
  }

  /** Suspend movement reads (e.g., while typing in slash bar). */
  suspend(s: boolean): void { this.suspended = s; if (s) this.down.clear(); }
  isSuspended(): boolean { return this.suspended; }

  isDown(code: string): boolean { return !this.suspended && this.down.has(code); }
  forward(): boolean { return this.isDown("KeyW") || this.isDown("ArrowUp"); }
  back():    boolean { return this.isDown("KeyS") || this.isDown("ArrowDown"); }
  left():    boolean { return this.isDown("KeyA") || this.isDown("ArrowLeft"); }
  right():   boolean { return this.isDown("KeyD") || this.isDown("ArrowRight"); }
  sprint():  boolean { return this.isDown("ShiftLeft") || this.isDown("ShiftRight"); }

  on(action: KeyAction, fn: () => void): void {
    if (!this.actionHandlers.has(action)) this.actionHandlers.set(action, new Set());
    this.actionHandlers.get(action)!.add(fn);
  }
  off(action: KeyAction, fn: () => void): void {
    this.actionHandlers.get(action)?.delete(fn);
  }

  private handleDown = (e: KeyboardEvent): void => {
    if (this.suspended) return;
    this.down.add(e.code);
    // Some actions trigger on keydown for snappy feel
    if (e.code === "Slash") { e.preventDefault(); }
    if (e.code === "Escape") {
      const fns = this.actionHandlers.get("exit");
      fns?.forEach((fn) => fn());
    }
  };

  private handleUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    if (this.suspended) return;  // typing in a field must not fire actions
    const action = ACTION_KEYS[e.code];
    if (action && action !== "exit") {
      const fns = this.actionHandlers.get(action);
      fns?.forEach((fn) => fn());
    }
  };

  destroy(): void {
    document.removeEventListener("keydown", this.handleDown);
    document.removeEventListener("keyup", this.handleUp);
  }
}
