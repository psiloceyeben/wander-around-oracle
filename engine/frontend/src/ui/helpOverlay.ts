// Help overlay — toggleable via H key or bottom-right button.
// Pulls help content from the engine's helpOverlay feature when available,
// falls back to hard-coded text otherwise.

export interface HelpOverlayOpts {
  containerEl: HTMLElement;
  bodyEl: HTMLElement;
  closeBtnEl: HTMLElement;
}

const FALLBACK_HELP = `WANDER AROUND — controls

Movement
  W A S D / arrows     walk
  Shift                sprint
  Mouse                look (click canvas to lock)
  Space                jump
  E                    interact with nearest entity
  Esc                  release pointer / close panel

Commands
  /                    open slash command bar
  H                    toggle this help
  Q                    toggle quest log
  K                    toggle workshop
  P                    toggle perf preset

Slash commands
  /spawn DESCRIPTION   build something via the language layer
                       e.g. /spawn a tall iron sword
  /save SLOT           save world to slot
  /load SLOT           load world
  /style NAME          swap render style (ascii | paper-mario | 3d)
  /time HOUR           set time of day 0-23
  /backup              export world snapshot
  /restore             import world snapshot

Substrate paradigm
  the world is HRR state; Three.js is one projection. Render styles swap
  the projection without touching state. NPCs are entities whose
  cognition routes perception through the Oracle (when online).
`;

export class HelpOverlay {
  private container: HTMLElement;
  private body: HTMLElement;
  private closeBtn: HTMLElement;
  private _open = false;

  constructor(opts: HelpOverlayOpts) {
    this.container = opts.containerEl;
    this.body = opts.bodyEl;
    this.closeBtn = opts.closeBtnEl;
    this.body.textContent = FALLBACK_HELP;
    this.closeBtn.addEventListener("click", () => this.close());
  }

  setContent(text: string): void { this.body.textContent = text; }

  open(): void { this.container.classList.remove("hidden"); this._open = true; }
  close(): void { this.container.classList.add("hidden"); this._open = false; }
  toggle(): void { if (this._open) this.close(); else this.open(); }
  isOpen(): boolean { return this._open; }
}
