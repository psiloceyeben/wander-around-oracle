// The Worlds panel — doorways out of the player's world into the others:
// EnsouledWorld (the live autonomous souls) and the Wander Around site worlds.
// In the downloaded client these open in the system browser (Electron
// shell.openExternal, allow-listed); on the web they open a new tab.

interface WorldLink { label: string; sub: string; url: string; accent?: boolean; }

const WORLDS: WorldLink[] = [
  { label: "EnsouledWorld", sub: "watch the autonomous souls live, think & build", url: "https://wanderaround.io/EnsouledWorld", accent: true },
  { label: "The Rendered World", sub: "3D walkable, rendered long-tail web", url: "https://wanderaround.io/rendered" },
  { label: "The Full World", sub: "the whole long-tail web — ~7M cards", url: "https://wanderaround.io/world" },
  { label: "The Oracle", sub: "speak to the substrate model", url: "https://wanderaround.io/oracle" },
  { label: "The Hub", sub: "the 10-portal atrium", url: "https://wanderaround.io/hub" },
  { label: "The Institute", sub: "the operator's estate", url: "https://wanderaround.io/institute" },
  { label: "The Wiki", sub: "6.8M Wikipedia articles, walkable", url: "https://wanderaround.io/wiki" },
  { label: "The Library", sub: "books, papers, the archive", url: "https://wanderaround.io/library" },
  { label: "Ensouled Dashboard", sub: "walk among the agents (2D)", url: "https://ensouledagents.com/walkable" },
];

export class WorldsPanel {
  private root: HTMLDivElement;
  private _open = false;
  private onFocusChange?: (typing: boolean) => void;

  constructor(opts: { parent: HTMLElement; onFocusChange?: (typing: boolean) => void }) {
    this.onFocusChange = opts.onFocusChange;
    this.root = document.createElement("div");
    this.root.id = "worlds-panel";
    this.root.classList.add("hidden");
    this.root.innerHTML = this.template();
    this.injectStyle();
    opts.parent.appendChild(this.root);
    this.root.querySelector(".wp-close")!.addEventListener("click", () => this.close());
    this.root.addEventListener("mousedown", (e) => { if (e.target === this.root) this.close(); });
    this.root.addEventListener("keydown", (e) => { e.stopPropagation(); if ((e as KeyboardEvent).key === "Escape") this.close(); });
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>(".wp-row"))) {
      el.addEventListener("click", () => this.openExternal(el.dataset.url!));
    }
  }

  isOpen(): boolean { return this._open; }
  open(): void { this._open = true; this.root.classList.remove("hidden"); if (document.pointerLockElement) document.exitPointerLock(); this.onFocusChange?.(true); }
  close(): void { this._open = false; this.root.classList.add("hidden"); this.onFocusChange?.(false); }
  toggle(): void { this._open ? this.close() : this.open(); }

  private openExternal(url: string): void {
    const native = (window as any).wanderNative;
    if (native && typeof native.openExternal === "function") native.openExternal(url);
    else window.open(url, "_blank", "noopener");
  }

  private template(): string {
    const rows = WORLDS.map((w) => `
      <div class="wp-row${w.accent ? " accent" : ""}" data-url="${w.url}">
        <div class="wp-label">${w.label}</div>
        <div class="wp-sub">${w.sub}</div>
        <div class="wp-arrow">&rarr;</div>
      </div>`).join("");
    return `
      <div class="wp-card">
        <button class="wp-close" title="close (Esc)">&times;</button>
        <h2>Step into another world</h2>
        <p class="wp-lede">Doorways out of your world &mdash; the living EnsouledWorld and the
          other Wander surfaces. They open in your browser.</p>
        ${rows}
      </div>`;
  }

  private injectStyle(): void {
    if (document.getElementById("wp-style")) return;
    const s = document.createElement("style");
    s.id = "wp-style";
    s.textContent = `
      #worlds-panel{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;
        background:rgba(42,35,24,0.55);backdrop-filter:blur(2px);font-family:'Fredoka',system-ui,sans-serif;color:#3a2818}
      #worlds-panel.hidden{display:none}
      #worlds-panel .wp-card{position:relative;width:min(94vw,460px);max-height:90vh;overflow-y:auto;
        background:#fff7e0;border:3px solid #3a2818;border-radius:18px;padding:1.3rem 1.4rem;
        box-shadow:0 10px 0 rgba(58,40,24,0.25);animation:wp-pop .16s cubic-bezier(.3,1.6,.6,1)}
      @keyframes wp-pop{from{transform:scale(.93);opacity:.4}to{transform:scale(1);opacity:1}}
      #worlds-panel h2{font-family:'Cinzel',serif;font-size:1.15rem;letter-spacing:.04em;margin-bottom:.3rem}
      #worlds-panel .wp-lede{font-size:.84rem;color:#6a5236;line-height:1.45;margin-bottom:1rem}
      #worlds-panel .wp-row{position:relative;display:block;border:2px solid #c89540;border-radius:11px;
        background:#fffdf5;padding:.6rem .8rem;margin-bottom:.55rem;cursor:pointer;transition:transform .08s,border-color .15s,box-shadow .08s}
      #worlds-panel .wp-row:hover{transform:translateY(-1px);border-color:#e87a3a;box-shadow:0 3px 0 #e8b070}
      #worlds-panel .wp-row.accent{background:#faf0d4;border-color:#e87a3a}
      #worlds-panel .wp-label{font-weight:700;font-size:.98rem}
      #worlds-panel .wp-sub{font-size:.76rem;color:#8a7050;margin-top:.1rem}
      #worlds-panel .wp-arrow{position:absolute;right:.8rem;top:50%;transform:translateY(-50%);color:#e87a3a;font-size:1.1rem;font-weight:700}
      #worlds-panel .wp-close{position:absolute;top:.7rem;right:.7rem;width:30px;height:30px;background:#fffdf5;
        border:2px solid #c89540;border-radius:9px;font-size:1.1rem;line-height:1;cursor:pointer;color:#3a2818}
      #worlds-panel .wp-close:hover{border-color:#e87a3a;color:#e87a3a}`;
    document.head.appendChild(s);
  }
}
