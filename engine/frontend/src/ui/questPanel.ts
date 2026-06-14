// Quest panel — toggleable via Q. Reads QuestSystem.progress() and renders.

import type { QuestSystem } from "@engine/features/quests/index.js";

export interface QuestPanelOpts {
  containerEl: HTMLElement;
  listEl: HTMLElement;
  parentEl: HTMLElement;
  quests: QuestSystem;
}

export class QuestPanel {
  private container: HTMLElement;
  private list: HTMLElement;
  private parent: HTMLElement;
  private quests: QuestSystem;
  private _open = false;

  constructor(opts: QuestPanelOpts) {
    this.container = opts.containerEl;
    this.list = opts.listEl;
    this.parent = opts.parentEl;
    this.quests = opts.quests;
    this.refresh();
  }

  refresh(): void {
    const prog = this.quests.progress();
    const completedSet = new Set(prog.completedIds);
    // QuestSystem exposes list(): Quest[]; each Quest has { id, title, description }.
    const all = this.quests.list();
    const items = all.map((q) => ({
      id: q.id,
      title: q.title ?? q.description ?? q.id,
      done: completedSet.has(q.id),
    }));
    // Active/incomplete first, completed (dimmed) last.
    this.list.innerHTML = items
      .sort((a, b) => Number(a.done) - Number(b.done))
      .map((q) => {
        const cls = q.done ? "done" : "active";
        return `<li class="${cls}">${escapeHtml(q.title || q.id)}</li>`;
      }).join("");
  }

  open(): void {
    this.parent.classList.remove("hidden");
    this.container.classList.remove("hidden");
    this._open = true;
    this.refresh();
  }
  close(): void {
    this.container.classList.add("hidden");
    if (this._open) this.hideParentIfEmpty();
    this._open = false;
  }
  toggle(): void { if (this._open) this.close(); else this.open(); }
  isOpen(): boolean { return this._open; }

  private hideParentIfEmpty(): void {
    // If no panels visible, hide the container
    const anyVisible = !!this.parent.querySelector(".panel:not(.hidden)");
    if (!anyVisible) this.parent.classList.add("hidden");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  } as Record<string, string>)[c]);
}
