// Feature: slash commands.
//
// Players type "/cmd arg1 arg2" into a prompt input. The dispatcher parses
// the text and invokes the registered handler, which typically emits one
// or more Commands via the CommandBus. Commands are NOT directly executed
// here; handlers translate user intent into engine commands.
//
// Fixes the v7.2 audit's C5 bug (handlers receiving undefined for their
// text argument) by passing both the parsed tokens AND the raw remainder.

import { CommandBus } from "../../cmd/bus.js";

export interface SlashHandlerArgs {
  /** Parsed tokens after the command name. */
  tokens: string[];
  /** Raw text after the command name (preserves spaces and quotes). */
  rest: string;
  /** Convenience: the bus the handler can submit commands to. */
  bus: CommandBus;
  /** Optional HUD message sink for command output. */
  hud?: (msg: string) => void;
}

export interface SlashCommand {
  name: string;
  args: string[];          // arg labels for help display
  description: string;
  handler: (ctx: SlashHandlerArgs) => void | Promise<void>;
}

export class SlashDispatcher {
  private registry = new Map<string, SlashCommand>();
  private bus: CommandBus;
  private hud?: (msg: string) => void;

  constructor(bus: CommandBus, opts?: { hud?: (msg: string) => void }) {
    this.bus = bus;
    this.hud = opts?.hud;
  }

  register(cmd: SlashCommand): void {
    this.registry.set(cmd.name.toLowerCase(), cmd);
  }

  registerMany(cmds: SlashCommand[]): void {
    for (const c of cmds) this.register(c);
  }

  unregister(name: string): void {
    this.registry.delete(name.toLowerCase());
  }

  has(name: string): boolean { return this.registry.has(name.toLowerCase()); }
  list(): SlashCommand[] { return Array.from(this.registry.values()).sort((a, b) => a.name.localeCompare(b.name)); }

  /** Parse "/cmd a b c" into tokens + rest; route to handler. */
  async dispatch(text: string): Promise<{ ok: boolean; error?: string }> {
    const t = text.trim();
    if (!t.startsWith("/")) return { ok: false, error: "not a slash command" };
    const body = t.slice(1);
    const firstSpace = body.indexOf(" ");
    const name = (firstSpace < 0 ? body : body.slice(0, firstSpace)).toLowerCase();
    const rest = firstSpace < 0 ? "" : body.slice(firstSpace + 1).trim();
    const tokens = rest.length > 0 ? rest.split(/\s+/) : [];

    const cmd = this.registry.get(name);
    if (!cmd) {
      const msg = `unknown command: /${name}`;
      this.hud?.(msg);
      return { ok: false, error: msg };
    }

    try {
      await cmd.handler({ tokens, rest, bus: this.bus, hud: this.hud });
      return { ok: true };
    } catch (err) {
      const msg = `/${name} failed: ${(err as Error).message || err}`;
      this.hud?.(msg);
      return { ok: false, error: msg };
    }
  }

  /** Autocomplete: return matching commands by name prefix. */
  autocomplete(prefix: string): SlashCommand[] {
    const p = prefix.toLowerCase().replace(/^\//, "").split(/\s+/)[0] || "";
    return this.list().filter((c) => c.name.toLowerCase().startsWith(p));
  }
}

// ── Default built-in slash commands ──────────────────────────────────

export function defaultSlashCommands(opts: {
  saveSlot?: (name: string) => Promise<void>;
  loadSlot?: (name: string) => Promise<void>;
}): SlashCommand[] {
  return [
    {
      name: "help",
      args: ["command?"],
      description: "List commands or show one's signature",
      handler: ({ tokens, hud }) => {
        if (tokens.length > 0) {
          hud?.(`/${tokens[0]} — see help overlay for full signature`);
        } else {
          hud?.("press ? to open help overlay");
        }
      },
    },
    {
      name: "time",
      args: ["hours"],
      description: "Set time of day (0-24)",
      handler: ({ tokens, bus, hud }) => {
        const h = Number(tokens[0]);
        if (!Number.isFinite(h)) { hud?.("usage: /time <hours>"); return; }
        bus.submit({ kind: "SetTimeOfDay", hours: h });
      },
    },
    {
      name: "save",
      args: ["name?"],
      description: "Save the world to a slot",
      handler: async ({ tokens, bus, hud }) => {
        const slot = tokens[0] ?? "default";
        bus.submit({ kind: "SaveWorld", slot });
        if (opts.saveSlot) await opts.saveSlot(slot);
        hud?.(`saved to "${slot}"`);
      },
    },
    {
      name: "load",
      args: ["name?"],
      description: "Load a saved world",
      handler: async ({ tokens, hud }) => {
        const slot = tokens[0] ?? "default";
        if (opts.loadSlot) await opts.loadSlot(slot);
        hud?.(`loaded "${slot}"`);
      },
    },
  ];
}
