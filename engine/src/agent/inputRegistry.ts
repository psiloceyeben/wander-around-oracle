// Input registry — single source of truth for keybindings.
//
// Every keybind in the game registers here. The dispatcher reads from the
// registry, finds matching bindings by (code + modifiers + context), and
// fires them in priority order. Conflict detection is automatic; the help
// overlay reads from this registry to produce an always-current keybind list.
//
// This is the v7.2 audit's #2 critical bug fixed: the registry now actually
// gets populated. Engine v2 requires all keybinds to flow through this API.

export type InputContext = "play" | "holding" | "typing" | "modal" | "building" | "workshop" | "any";

export interface InputBinding {
  /** Key code, e.g. "KeyE", "Slash", "Tab". */
  code: string;
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean };
  /** Contexts this binding fires in. */
  contexts: InputContext[];
  /** Short display name (shown in help overlay). */
  action: string;
  /** Human-readable description. */
  description: string;
  /** Handler. Return true to consume (preventDefault + stopPropagation). */
  handler: (e: KeyboardEvent) => boolean | void;
  /** Higher priority fires first within the same context. */
  priority?: number;
  /** Should repeat fire while held? Default false for most actions. */
  allowRepeat?: boolean;
  /** Module that owns this binding — for help grouping + debugging. */
  ownerModule: string;
}

export interface BindingConflict {
  key: string;
  context: InputContext;
  bindings: InputBinding[];
}

export class InputRegistry {
  private bindings: InputBinding[] = [];
  private activeContext: InputContext = "play";
  private contextStack: InputContext[] = ["play"];
  private installed = false;
  private dispatcherFn?: (e: KeyboardEvent) => void;

  /** Add a binding. Returns an unregister function. */
  register(b: InputBinding): () => void {
    this.bindings.push(b);
    return () => {
      const idx = this.bindings.indexOf(b);
      if (idx >= 0) this.bindings.splice(idx, 1);
    };
  }

  registerMany(...bs: InputBinding[]): () => void {
    const unsubs = bs.map((b) => this.register(b));
    return () => { for (const u of unsubs) u(); };
  }

  pushContext(ctx: InputContext): void {
    this.contextStack.push(ctx);
    this.activeContext = ctx;
  }

  popContext(): void {
    if (this.contextStack.length > 1) {
      this.contextStack.pop();
      this.activeContext = this.contextStack[this.contextStack.length - 1];
    }
  }

  setContext(ctx: InputContext): void {
    this.contextStack = [ctx];
    this.activeContext = ctx;
  }

  getContext(): InputContext { return this.activeContext; }

  /** Find matches for a key event in the given context. */
  findMatches(e: KeyboardEvent, ctx: InputContext): InputBinding[] {
    const out: InputBinding[] = [];
    for (const b of this.bindings) {
      if (b.code !== e.code) continue;
      const m = b.modifiers || {};
      if (!!m.shift !== e.shiftKey) continue;
      if (!!m.ctrl  !== e.ctrlKey)  continue;
      if (!!m.alt   !== e.altKey)   continue;
      if (!!m.meta  !== e.metaKey)  continue;
      if (e.repeat && !b.allowRepeat) continue;
      if (!b.contexts.includes(ctx) && !b.contexts.includes("any")) continue;
      out.push(b);
    }
    return out.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /** Install the dispatcher on document. Idempotent. */
  install(doc?: { addEventListener(t: string, fn: any, opts?: any): void; activeElement: any | null }): void {
    if (this.installed) return;
    const target = doc ?? (typeof document !== "undefined" ? document : null);
    if (!target) return;  // no DOM (e.g. tests) — registry still usable
    this.dispatcherFn = (e: KeyboardEvent) => {
      const typing = isTypingFocused(target);
      const ctx = typing ? "typing" : this.activeContext;
      const matches = this.findMatches(e, ctx);
      for (const b of matches) {
        try {
          if (b.handler(e) === true) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        } catch (err) {
          console.warn(`[input] error in ${b.ownerModule}.${b.action}:`, err);
        }
      }
    };
    target.addEventListener("keydown", this.dispatcherFn as any, { capture: true });
    this.installed = true;
  }

  /** Inspection: bindings grouped by owner module. Used by the help overlay. */
  bindingsByOwner(): Record<string, InputBinding[]> {
    const out: Record<string, InputBinding[]> = {};
    for (const b of this.bindings) (out[b.ownerModule] ||= []).push(b);
    return out;
  }

  /** Detect overlapping bindings (same key+modifiers+context). */
  findConflicts(): BindingConflict[] {
    const buckets = new Map<string, InputBinding[]>();
    for (const b of this.bindings) {
      const m = b.modifiers || {};
      const modStr = `${m.shift?1:0}${m.ctrl?1:0}${m.alt?1:0}${m.meta?1:0}`;
      for (const ctx of b.contexts) {
        const k = `${b.code}|${modStr}|${ctx}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push(b);
      }
    }
    const out: BindingConflict[] = [];
    for (const [k, arr] of buckets) {
      if (arr.length > 1) {
        const [code, , ctxStr] = k.split("|");
        out.push({ key: code, context: ctxStr as InputContext, bindings: arr });
      }
    }
    return out;
  }

  all(): ReadonlyArray<InputBinding> { return this.bindings.slice(); }
  count(): number { return this.bindings.length; }
}

function isTypingFocused(doc: { activeElement: any | null }): boolean {
  const el = doc.activeElement as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || !!el.isContentEditable;
}
