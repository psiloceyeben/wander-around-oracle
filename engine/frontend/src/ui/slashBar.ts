// Slash command input bar. Pressing `/` opens it; Enter executes; Escape closes.
// Dispatches via engine SlashDispatcher.

export interface SlashBarOpts {
  inputEl: HTMLInputElement;
  containerEl: HTMLElement;
  outputEl: HTMLElement;
  onExecute: (cmd: string) => Promise<string>;
  onOpen?: () => void;
  onClose?: () => void;
}

export class SlashBar {
  private input: HTMLInputElement;
  private container: HTMLElement;
  private output: HTMLElement;
  private onExecute: (cmd: string) => Promise<string>;
  private onOpen?: () => void;
  private onClose?: () => void;
  private history: string[] = [];
  private historyIdx = -1;
  private outputTimer: number | null = null;

  constructor(opts: SlashBarOpts) {
    this.input = opts.inputEl;
    this.container = opts.containerEl;
    this.output = opts.outputEl;
    this.onExecute = opts.onExecute;
    this.onOpen = opts.onOpen;
    this.onClose = opts.onClose;

    this.input.addEventListener("keydown", this.handleKey);
  }

  open(prefill: string = "/"): void {
    this.container.classList.remove("hidden");
    this.input.value = prefill;
    this.input.focus();
    this.input.setSelectionRange(prefill.length, prefill.length);
    this.onOpen?.();
  }

  close(): void {
    this.container.classList.add("hidden");
    this.input.value = "";
    this.input.blur();
    this.onClose?.();
  }

  isOpen(): boolean { return !this.container.classList.contains("hidden"); }

  showOutput(text: string, ms: number = 3500): void {
    this.output.classList.remove("hidden");
    this.output.textContent = text;
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = window.setTimeout(() => {
      this.output.classList.add("hidden");
      this.output.textContent = "";
    }, ms);
  }

  private handleKey = async (e: KeyboardEvent): Promise<void> => {
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = this.input.value.trim();
      if (!cmd) { this.close(); return; }
      this.history.push(cmd);
      this.historyIdx = -1;
      this.input.disabled = true;
      try {
        const result = await this.onExecute(cmd);
        this.showOutput(result);
      } catch (err) {
        this.showOutput(`error: ${(err as Error).message}`);
      }
      this.input.disabled = false;
      this.close();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.history.length === 0) return;
      this.historyIdx = Math.min(this.history.length - 1, this.historyIdx + 1);
      this.input.value = this.history[this.history.length - 1 - this.historyIdx];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.historyIdx = Math.max(-1, this.historyIdx - 1);
      this.input.value = this.historyIdx >= 0
        ? this.history[this.history.length - 1 - this.historyIdx]
        : "/";
    }
  };
}
