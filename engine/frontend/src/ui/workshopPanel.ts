// Workshop panel — Wander Around's "compose your world" tool.
//
// Operates against the engine's Workshop feature. The panel lets the
// player save parts of the current creation and respawn it later.
// Substrate-paradigm: parts are HRR-bound composition fragments; spawn
// is op-tree → command via the recipes/language layer.

import type { WorkshopSession, InMemoryCreationLibrary } from "@engine/features/workshop/index.js";

export interface WorkshopPanelOpts {
  containerEl: HTMLElement;
  bodyEl: HTMLElement;
  parentEl: HTMLElement;
  workshop: WorkshopSession;
  library: InMemoryCreationLibrary;
  onSpawn: (creationId: string) => void;
  onSaveCreation: (creationId: string) => void;
  /** Apply a simple modifier (issues an EditComponents command) to the most
   *  recently added bench part. Completes the q-edit-something quest. */
  onModify: () => void;
}

export class WorkshopPanel {
  private container: HTMLElement;
  private body: HTMLElement;
  private parent: HTMLElement;
  private workshop: WorkshopSession;
  private library: InMemoryCreationLibrary;
  private onSpawn: (creationId: string) => void;
  private onSaveCreation: (creationId: string) => void;
  private onModify: () => void;
  private _open = false;

  constructor(opts: WorkshopPanelOpts) {
    this.container = opts.containerEl;
    this.body = opts.bodyEl;
    this.parent = opts.parentEl;
    this.workshop = opts.workshop;
    this.library = opts.library;
    this.onSpawn = opts.onSpawn;
    this.onSaveCreation = opts.onSaveCreation;
    this.onModify = opts.onModify;
    this.render();
  }

  render(): void {
    const parts = this.workshop.listParts();
    const creations = this.library.list();
    const partItems = parts.map((p) => `<li>${escapeHtml(p.meshTag)} <span class="ws-id">${escapeHtml(p.id)}</span></li>`).join("");
    const creationItems = creations.map((c) =>
      `<li>
        <span>${escapeHtml(c.name ?? c.id)}</span>
        <button data-spawn="${escapeHtml(c.id)}">spawn</button>
      </li>`
    ).join("");

    this.body.innerHTML = `
      <div class="ws-section">
        <div class="ws-section-title">add a part by prompt</div>
        <input type="text" id="ws-add-input" placeholder="a brass lantern · a tall iron sword">
        <button id="ws-add-btn">add</button>
      </div>
      <div class="ws-section">
        <div class="ws-section-title">current parts (${parts.length})</div>
        <ul class="ws-list">${partItems || '<li><em>none yet</em></li>'}</ul>
        <button id="ws-modify-btn">tweak last part</button>
        <button id="ws-save-btn">save as creation</button>
      </div>
      <div class="ws-section">
        <div class="ws-section-title">saved creations (${creations.length})</div>
        <ul class="ws-list">${creationItems || '<li><em>none yet</em></li>'}</ul>
      </div>
      <style>
        .ws-section { margin-bottom: 12px; }
        .ws-section-title { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
        #ws-add-input { width: 70%; background: #0d1117; border: 1px solid var(--border); border-radius: 3px;
          color: var(--fg); padding: 4px 8px; font: inherit; font-size: 12px; }
        #ws-add-btn, #ws-save-btn, #ws-modify-btn { background: var(--accent); border: none; color: #0d1117;
          padding: 4px 10px; border-radius: 3px; font: inherit; font-size: 11px; cursor: pointer;
          margin-left: 6px; margin-top: 4px; font-weight: 600; }
        #ws-modify-btn { background: #21262d; color: var(--accent); border: 1px solid var(--border); }
        .ws-list { margin: 4px 0; padding-left: 18px; font-size: 12px; max-height: 120px; overflow: auto; }
        .ws-list li { margin: 2px 0; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .ws-list .ws-id { color: var(--dim); font-size: 10px; }
        .ws-list button { background: transparent; border: 1px solid var(--border); color: var(--accent);
          padding: 1px 6px; border-radius: 2px; font: inherit; font-size: 10px; cursor: pointer; }
        .ws-list button:hover { background: #21262d; }
      </style>
    `;

    // Wire interactions
    const addInput = this.body.querySelector<HTMLInputElement>("#ws-add-input")!;
    const addBtn = this.body.querySelector<HTMLButtonElement>("#ws-add-btn")!;
    const saveBtn = this.body.querySelector<HTMLButtonElement>("#ws-save-btn")!;
    const modifyBtn = this.body.querySelector<HTMLButtonElement>("#ws-modify-btn")!;

    const doAdd = () => {
      const prompt = addInput.value.trim();
      if (!prompt) return;
      try { this.workshop.addPartByPrompt(prompt); } catch { /* ignore bad prompt */ }
      addInput.value = "";
      this.render();
    };
    addBtn.addEventListener("click", doAdd);
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });

    modifyBtn.addEventListener("click", () => {
      this.onModify();
      this.render();
    });

    saveBtn.addEventListener("click", () => {
      const creation = this.workshop.saveToLibrary(this.library);
      this.onSaveCreation(creation.id);
      this.render();
    });

    this.body.querySelectorAll<HTMLButtonElement>("[data-spawn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.spawn!;
        this.onSpawn(id);
      });
    });
  }

  open(): void {
    this.parent.classList.remove("hidden");
    this.container.classList.remove("hidden");
    this._open = true;
    this.render();
  }
  close(): void {
    this.container.classList.add("hidden");
    this._open = false;
    if (!this.parent.querySelector(".panel:not(.hidden)")) {
      this.parent.classList.add("hidden");
    }
  }
  toggle(): void { if (this._open) this.close(); else this.open(); }
  isOpen(): boolean { return this._open; }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  } as Record<string, string>)[c]);
}
