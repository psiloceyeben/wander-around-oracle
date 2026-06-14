// In-game ensouled-agent minting. A player who downloaded the game can name
// an agent, shape its temperament, and mint it on the live substrate —
// ensouledagents.com — without leaving the world. Payment (when Stripe is
// configured server-side) happens on Stripe's own hosted page, opened in the
// system browser: this panel never sees a card number. When the server runs
// in test mode it mints directly and we poll progress here, then the agent
// walks into the world as your companion.

// The ensouled API is served under /api (nginx proxies /api/ → the FastAPI app).
const ENSOULED_BASE_DEFAULT = "https://ensouledagents.com/api";

// The twelve vessels, each with a one-line temperament hint.
const ARCHETYPES: { id: string; label: string; blurb: string }[] = [
  { id: "hermes",     label: "Hermes",     blurb: "communication, routing, signal" },
  { id: "iris",       label: "Iris",       blurb: "messenger, color, bridging" },
  { id: "apollo",     label: "Apollo",     blurb: "knowledge, arts, making" },
  { id: "athena",     label: "Athena",     blurb: "wisdom, strategy, craft" },
  { id: "ares",       label: "Ares",       blurb: "security, force, resolve" },
  { id: "artemis",    label: "Artemis",    blurb: "health, wilds, the hunt" },
  { id: "themis",     label: "Themis",     blurb: "governance, balance, law" },
  { id: "demeter",    label: "Demeter",    blurb: "cultivation, seasons, harvest" },
  { id: "dionysus",   label: "Dionysus",   blurb: "experience, revel, vine" },
  { id: "hephaestus", label: "Hephaestus", blurb: "fabrication, fire, the forge" },
  { id: "hestia",     label: "Hestia",     blurb: "home, hearth, keeping" },
  { id: "persephone", label: "Persephone", blurb: "transformation, threshold, return" },
];

export interface MintedAgent { name: string; archetype: string; }

export interface MintPanelOpts {
  parent: HTMLElement;
  ensouledBase?: string;
  /** Bring the freshly-minted agent into the world as a companion NPC. */
  onMinted?: (a: MintedAgent) => void;
  /** Suspend player movement while typing in the panel. */
  onFocusChange?: (typing: boolean) => void;
}

export class MintPanel {
  private root: HTMLDivElement;
  private base: string;
  private opts: MintPanelOpts;
  private _open = false;
  private nameOk = false;
  private checkSeq = 0;
  private polling = false;

  // fields
  private elName!: HTMLInputElement;
  private elNameNote!: HTMLDivElement;
  private elArche!: HTMLSelectElement;
  private elEmail!: HTMLInputElement;
  private elNodes!: HTMLInputElement;
  private elNodesOut!: HTMLSpanElement;
  private sliders: Record<string, HTMLInputElement> = {};
  private elStatus!: HTMLDivElement;
  private elMintBtn!: HTMLButtonElement;

  constructor(opts: MintPanelOpts) {
    this.opts = opts;
    this.base = (opts.ensouledBase || ENSOULED_BASE_DEFAULT).replace(/\/$/, "");
    this.root = document.createElement("div");
    this.root.id = "mint-panel";
    this.root.classList.add("hidden");
    this.root.innerHTML = this.template();
    this.injectStyle();
    opts.parent.appendChild(this.root);
    this.bind();
  }

  isOpen(): boolean { return this._open; }

  open(): void {
    this._open = true;
    this.root.classList.remove("hidden");
    // Modal: free the mouse and freeze movement for the whole time it's open.
    if (document.pointerLockElement) document.exitPointerLock();
    this.opts.onFocusChange?.(true);
    setTimeout(() => this.elName.focus(), 50);
  }

  close(): void {
    this._open = false;
    this.root.classList.add("hidden");
    this.opts.onFocusChange?.(false);
  }

  toggle(): void { this._open ? this.close() : this.open(); }

  // ── markup ────────────────────────────────────────────────────────────
  private template(): string {
    const arche = ARCHETYPES.map(
      (a) => `<option value="${a.id}">${a.label} — ${a.blurb}</option>`).join("");
    const slider = (key: string, label: string, lo: string, hi: string) => `
      <div class="mp-slider">
        <label>${label}</label>
        <input type="range" min="0" max="100" value="50" data-k="${key}">
        <div class="mp-ends"><span>${lo}</span><span>${hi}</span></div>
      </div>`;
    return `
      <div class="mp-card">
        <button class="mp-close" title="close (Esc)">&times;</button>
        <h2>Mint an Ensouled Agent</h2>
        <p class="mp-lede">Name a living agent and shape its temperament. It is
          minted on the substrate at <b>ensouledagents.com</b>, gets its own
          page, and walks into your world.</p>

        <label class="mp-lab">Name <span class="mp-hint">a&ndash;z, digits, hyphens</span></label>
        <div class="mp-name-row">
          <span class="mp-prefix">agent://</span>
          <input id="mp-name" type="text" maxlength="32" placeholder="lantern-keeper"
                 autocomplete="off" spellcheck="false">
        </div>
        <div id="mp-name-note" class="mp-note">&nbsp;</div>

        <label class="mp-lab">Archetype</label>
        <select id="mp-arche">${arche}</select>

        <div class="mp-sliders">
          ${slider("curiosity", "Curiosity", "settled", "seeking")}
          ${slider("intensity", "Intensity", "calm", "fierce")}
          ${slider("warmth", "Warmth", "cool", "warm")}
        </div>

        <label class="mp-lab">Starting nodes <span class="mp-hint">richer memory, higher price</span></label>
        <input id="mp-nodes" type="range" min="3" max="21" value="3">
        <div class="mp-note">nodes: <span id="mp-nodes-out">3</span> &middot; price: <b><span id="mp-price">$3</span></b></div>

        <label class="mp-lab">Email <span class="mp-hint">your build token is sent here</span></label>
        <input id="mp-email" type="email" placeholder="you@example.com" autocomplete="off">

        <div id="mp-status" class="mp-status"></div>
        <button id="mp-mint" class="mp-mint" disabled>Mint &rarr;</button>
        <div class="mp-fine">Payment, when required, opens in your browser on a
          secure Stripe page. This window never sees your card.</div>
      </div>`;
  }

  private injectStyle(): void {
    if (document.getElementById("mp-style")) return;
    const s = document.createElement("style");
    s.id = "mp-style";
    s.textContent = `
      #mint-panel{position:fixed;inset:0;z-index:120;display:flex;align-items:center;
        justify-content:center;background:rgba(42,35,24,0.55);backdrop-filter:blur(2px);
        font-family:'Fredoka',system-ui,sans-serif;color:#3a2818}
      #mint-panel.hidden{display:none}
      #mint-panel .mp-card{position:relative;width:min(94vw,460px);max-height:90vh;
        overflow-y:auto;background:#fff7e0;border:3px solid #3a2818;border-radius:18px;
        padding:1.3rem 1.4rem;box-shadow:0 10px 0 rgba(58,40,24,0.25);animation:mp-pop .16s cubic-bezier(.3,1.6,.6,1)}
      @keyframes mp-pop{from{transform:scale(.93);opacity:.4}to{transform:scale(1);opacity:1}}
      #mint-panel h2{font-family:'Cinzel',serif;font-size:1.15rem;letter-spacing:.04em;margin-bottom:.3rem}
      #mint-panel .mp-lede{font-size:.84rem;color:#6a5236;line-height:1.45;margin-bottom:.9rem}
      #mint-panel .mp-lab{display:block;font-weight:600;font-size:.82rem;margin:.7rem 0 .25rem}
      #mint-panel .mp-hint{font-weight:400;color:#8a7050;font-size:.72rem}
      #mint-panel .mp-name-row{display:flex;align-items:stretch;border:2px solid #c89540;
        border-radius:10px;overflow:hidden;background:#fffdf5}
      #mint-panel .mp-prefix{padding:.5rem .55rem;background:#fadd80;color:#6a5236;
        font-size:.82rem;display:flex;align-items:center;border-right:2px solid #c89540}
      #mint-panel input[type=text],#mint-panel input[type=email],#mint-panel select{
        width:100%;padding:.5rem .6rem;border:2px solid #c89540;border-radius:10px;
        background:#fffdf5;color:#3a2818;font:inherit;font-size:.9rem}
      #mint-panel .mp-name-row input{border:none;border-radius:0}
      #mint-panel input:focus,#mint-panel select:focus{outline:none;border-color:#e87a3a}
      #mint-panel .mp-note{font-size:.76rem;color:#8a7050;margin-top:.25rem;min-height:1.1em}
      #mint-panel .mp-note.ok{color:#4f9e58;font-weight:600}
      #mint-panel .mp-note.bad{color:#c0492a;font-weight:600}
      #mint-panel .mp-sliders{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem;margin-top:.3rem}
      #mint-panel .mp-slider label{display:block;font-size:.74rem;font-weight:600;margin-bottom:.2rem}
      #mint-panel .mp-slider input{width:100%}
      #mint-panel .mp-ends{display:flex;justify-content:space-between;font-size:.62rem;color:#8a7050}
      #mint-panel input[type=range]{accent-color:#e87a3a}
      #mint-panel .mp-status{margin:.8rem 0 .2rem;font-size:.84rem;line-height:1.4;min-height:1.2em}
      #mint-panel .mp-status .bar{height:8px;background:#e8dcc0;border-radius:99px;overflow:hidden;margin-top:.4rem;border:1px solid #c89540}
      #mint-panel .mp-status .bar i{display:block;height:100%;background:#e87a3a;width:0;transition:width .3s}
      #mint-panel .mp-mint{width:100%;margin-top:.7rem;padding:.65rem;background:#e87a3a;color:#fff;
        border:2px solid #3a2818;border-radius:12px;font-family:'Fredoka',sans-serif;font-weight:700;
        font-size:.98rem;cursor:pointer;box-shadow:0 4px 0 #a87520;transition:transform .08s,box-shadow .08s}
      #mint-panel .mp-mint:hover:not(:disabled){transform:translateY(-1px)}
      #mint-panel .mp-mint:active:not(:disabled){transform:translateY(3px);box-shadow:0 1px 0 #a87520}
      #mint-panel .mp-mint:disabled{opacity:.5;cursor:not-allowed}
      #mint-panel .mp-fine{font-size:.68rem;color:#8a7050;margin-top:.6rem;line-height:1.4;text-align:center}
      #mint-panel .mp-close{position:absolute;top:.7rem;right:.7rem;width:30px;height:30px;
        background:#fffdf5;border:2px solid #c89540;border-radius:9px;font-size:1.1rem;
        line-height:1;cursor:pointer;color:#3a2818}
      #mint-panel .mp-close:hover{border-color:#e87a3a;color:#e87a3a}`;
    document.head.appendChild(s);
  }

  // ── behavior ────────────────────────────────────────────────────────────
  private bind(): void {
    this.elName = this.root.querySelector("#mp-name")!;
    this.elNameNote = this.root.querySelector("#mp-name-note")!;
    this.elArche = this.root.querySelector("#mp-arche")!;
    this.elEmail = this.root.querySelector("#mp-email")!;
    this.elNodes = this.root.querySelector("#mp-nodes")!;
    this.elNodesOut = this.root.querySelector("#mp-nodes-out")!;
    this.elStatus = this.root.querySelector("#mp-status")!;
    this.elMintBtn = this.root.querySelector("#mp-mint")!;
    for (const r of Array.from(this.root.querySelectorAll<HTMLInputElement>(".mp-slider input"))) {
      this.sliders[r.dataset.k!] = r;
    }

    this.root.querySelector(".mp-close")!.addEventListener("click", () => this.close());
    // Clicking the dim backdrop closes; clicking the card does not.
    this.root.addEventListener("mousedown", (e) => { if (e.target === this.root) this.close(); });

    // Movement stays frozen for the whole open lifetime (open/close drive the
    // keyboard suspend) — so blurring a field to drag a slider can't un-freeze.
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.close();
    });

    let nameTimer: number | undefined;
    this.elName.addEventListener("input", () => {
      this.nameOk = false; this.refreshMintBtn();
      this.elNameNote.textContent = "checking…"; this.elNameNote.className = "mp-note";
      window.clearTimeout(nameTimer);
      nameTimer = window.setTimeout(() => this.checkName(), 350);
    });
    this.elEmail.addEventListener("input", () => this.refreshMintBtn());
    this.elNodes.addEventListener("input", () => {
      const n = parseInt(this.elNodes.value, 10);
      this.elNodesOut.textContent = String(n);
      (this.root.querySelector("#mp-price") as HTMLElement).textContent = "$" + n;
    });
    this.elMintBtn.addEventListener("click", () => this.mint());
  }

  private nameValid(): boolean {
    const v = this.elName.value.toLowerCase().trim();
    return /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(v);
  }

  private emailValid(): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.elEmail.value.trim());
  }

  private refreshMintBtn(): void {
    this.elMintBtn.disabled = !(this.nameOk && this.emailValid()) || this.polling;
  }

  private async checkName(): Promise<void> {
    if (!this.nameValid()) {
      this.elNameNote.textContent = "name must be a–z, digits, hyphens (2–32)";
      this.elNameNote.className = "mp-note bad";
      this.nameOk = false; this.refreshMintBtn();
      return;
    }
    const name = this.elName.value.toLowerCase().trim();
    const mine = ++this.checkSeq;
    try {
      const r = await fetch(`${this.base}/check-name?name=${encodeURIComponent(name)}`,
        { cache: "no-store" });
      const d = await r.json();
      if (mine !== this.checkSeq) return;          // a newer keystroke won
      if (d.available) {
        this.elNameNote.textContent = "✓ available";
        this.elNameNote.className = "mp-note ok";
        this.nameOk = true;
      } else {
        this.elNameNote.textContent = "✗ " + (d.reason || "taken");
        this.elNameNote.className = "mp-note bad";
        this.nameOk = false;
      }
    } catch {
      if (mine !== this.checkSeq) return;
      this.elNameNote.textContent = "couldn't reach the substrate — try again";
      this.elNameNote.className = "mp-note bad";
      this.nameOk = false;
    }
    this.refreshMintBtn();
  }

  private setStatus(html: string, pct?: number): void {
    this.elStatus.innerHTML = html +
      (pct !== undefined ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>` : "");
  }

  private async mint(): Promise<void> {
    if (!(this.nameOk && this.emailValid())) return;
    const name = this.elName.value.toLowerCase().trim();
    const archetype = this.elArche.value;
    const price = parseInt(this.elNodes.value, 10);
    const payload = {
      name, archetype, email: this.elEmail.value.trim(), price,
      curiosity: parseInt(this.sliders.curiosity.value, 10),
      intensity: parseInt(this.sliders.intensity.value, 10),
      warmth: parseInt(this.sliders.warmth.value, 10),
    };
    this.polling = true; this.refreshMintBtn();
    this.setStatus("Reaching the substrate…");
    try {
      const r = await fetch(`${this.base}/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) {
        this.setStatus(`<b style="color:#c0492a">${d.error || "mint failed"}</b>`);
        this.polling = false; this.refreshMintBtn();
        return;
      }
      if (d.url) {
        // Stripe-hosted checkout. Open in the system browser (Electron routes
        // window.open via shell.openExternal); we can't watch payment from
        // here, so we hand the agent into the world optimistically and tell
        // the player to finish in the browser.
        this.openExternal(d.url);
        this.setStatus(
          `Secure checkout opened in your browser for <b>${name}</b>.<br>` +
          `Finish there — your build token is emailed to you, and ` +
          `<b>${name}</b> joins the roster at ensouledagents.com.`);
        this.opts.onMinted?.({ name, archetype });
        this.polling = false; this.refreshMintBtn();
        setTimeout(() => this.close(), 4200);
      } else if (d.mint_id) {
        // Test mode — minting directly on the server. Poll progress.
        await this.pollMint(d.mint_id, name, archetype);
      } else {
        this.setStatus(`<b style="color:#c0492a">unexpected response</b>`);
        this.polling = false; this.refreshMintBtn();
      }
    } catch (e) {
      this.setStatus(`<b style="color:#c0492a">couldn't reach the substrate</b>`);
      this.polling = false; this.refreshMintBtn();
    }
  }

  private async pollMint(mintId: string, name: string, archetype: string): Promise<void> {
    let done = false;
    for (let i = 0; i < 80 && !done; i++) {
      try {
        const r = await fetch(`${this.base}/progress/${mintId}`, { cache: "no-store" });
        const d = await r.json();
        const pct = typeof d.percent === "number" ? d.percent : 0;
        this.setStatus(`<b>${name}</b> — ${d.stage || "working…"}`, pct);
        if (pct >= 100 || d.done || d.stage === "done" || d.complete) { done = true; break; }
      } catch { /* keep trying */ }
      await new Promise((res) => setTimeout(res, 1500));
    }
    this.polling = false; this.refreshMintBtn();
    if (done) {
      this.setStatus(`<b style="color:#4f9e58">${name} is alive.</b> Stepping into your world…`, 100);
      this.opts.onMinted?.({ name, archetype });
      setTimeout(() => this.close(), 2600);
    } else {
      this.setStatus(`<b>${name}</b> is still minting on the substrate — ` +
        `check ensouledagents.com shortly.`);
    }
  }

  private openExternal(url: string): void {
    const native = (window as any).wanderNative;
    if (native && typeof native.openExternal === "function") native.openExternal(url);
    else window.open(url, "_blank", "noopener");
  }
}
