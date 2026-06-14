// First-person affordances: crosshair, contextual interact prompt, and the
// "holding" line. The prompt tells the player what E will do BEFORE they
// press it — the single biggest discoverability fix from the review.

export class Crosshair {
  private el: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "crosshair";
    parent.appendChild(this.el);
    this.setActive(false);
  }
  setActive(on: boolean): void {
    this.el.style.opacity = on ? "1" : "0.25";
  }
  setHot(hot: boolean): void {
    this.el.classList.toggle("hot", hot);
  }
}

export class InteractPrompt {
  private el: HTMLDivElement;
  private current: string | null = null;
  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "interact-prompt";
    this.el.classList.add("hidden");
    parent.appendChild(this.el);
  }
  /** Show "E — pick up iron sword" (or hide when null). */
  set(text: string | null): void {
    if (text === this.current) return;
    this.current = text;
    if (!text) {
      this.el.classList.add("hidden");
      return;
    }
    this.el.innerHTML = "";
    const key = document.createElement("span");
    key.className = "prompt-key";
    key.textContent = "E";
    this.el.appendChild(key);
    this.el.appendChild(document.createTextNode(" " + text));
    this.el.classList.remove("hidden");
  }
}

export class HoldingLine {
  private el: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "holding-line";
    this.el.classList.add("hidden");
    parent.appendChild(this.el);
  }
  set(name: string | null): void {
    if (!name) {
      this.el.classList.add("hidden");
      return;
    }
    this.el.textContent = `holding: ${name} · E to drop`;
    this.el.classList.remove("hidden");
  }
}

// Per-entity display-name overrides (e.g. a minted ensouled agent keeps its
// chosen name instead of showing its archetype prototype).
const LABEL_OVERRIDES: Record<string, string> = {};
export function setEntityLabel(id: string, label: string): void { LABEL_OVERRIDES[id] = label; }

/** Human-readable entity label from id/prototype ("sword-hub" → "sword"). */
export function entityLabel(prototypeId: string, id: string): string {
  if (LABEL_OVERRIDES[id]) return LABEL_OVERRIDES[id];
  const base = (prototypeId || id).replace(/_npc$/, "").replace(/[_-]+/g, " ").trim();
  return base || id;
}
