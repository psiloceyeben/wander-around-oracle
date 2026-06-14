// Feature: Help overlay generated from the input registry.
//
// Reads bindingsByOwner() — never drifts from the actual bindings.
// Produces HTML in the browser; produces a string fallback in headless.
//
// Pair this with slash dispatcher's `list()` to also document slash commands.

import { InputRegistry, type InputBinding } from "../../agent/inputRegistry.js";
import { type SlashCommand } from "../slashCommands/slashCommands.js";

export interface HelpRenderOptions {
  inputs: InputRegistry;
  slashCommands?: SlashCommand[];
  /** Title displayed at the top. */
  title?: string;
}

function formatKey(b: InputBinding): string {
  const parts: string[] = [];
  const m = b.modifiers || {};
  if (m.ctrl)  parts.push("Ctrl");
  if (m.shift) parts.push("Shift");
  if (m.alt)   parts.push("Alt");
  if (m.meta)  parts.push("Cmd");
  const code = b.code.startsWith("Key") ? b.code.slice(3) : b.code;
  parts.push(code);
  return parts.join("+");
}

/** Generate plain-text help suitable for terminal output or HUD display. */
export function renderHelpText(opts: HelpRenderOptions): string {
  const title = opts.title ?? "Wander Around — Help";
  const lines: string[] = [];
  lines.push(`=== ${title} ===`);
  lines.push("");

  const groups = opts.inputs.bindingsByOwner();
  const owners = Object.keys(groups).sort();
  if (owners.length === 0) {
    lines.push("(no input bindings registered)");
  }
  for (const owner of owners) {
    lines.push(`--- ${owner} ---`);
    const bs = groups[owner].slice().sort((a, b) => a.code.localeCompare(b.code));
    for (const b of bs) {
      const key = formatKey(b);
      const ctxs = b.contexts.join(",");
      lines.push(`  ${key.padEnd(14)} ${b.action.padEnd(22)} ${b.description}   (${ctxs})`);
    }
    lines.push("");
  }

  if (opts.slashCommands && opts.slashCommands.length > 0) {
    lines.push("--- slash commands ---");
    for (const c of opts.slashCommands) {
      const sig = `/${c.name}` + (c.args.length ? " " + c.args.map((a) => `<${a}>`).join(" ") : "");
      lines.push(`  ${sig.padEnd(28)} ${c.description}`);
    }
    lines.push("");
  }

  const conflicts = opts.inputs.findConflicts();
  if (conflicts.length > 0) {
    lines.push("⚠ Binding conflicts:");
    for (const c of conflicts) {
      lines.push(`  ${c.key} in '${c.context}': ${c.bindings.map((b) => `${b.ownerModule}.${b.action}`).join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** Render an HTML overlay element. No-op outside a DOM environment. */
export function renderHelpOverlay(opts: HelpRenderOptions): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const overlay = document.createElement("div");
  overlay.id = "wander-help-overlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(20,14,8,0.88); z-index: 200;
    overflow-y: auto; padding: 2rem; color: #fdf3d8;
    font-family: 'EB Garamond', Georgia, serif;
  `;
  const inner = document.createElement("div");
  inner.style.cssText = `
    max-width: 920px; margin: 0 auto;
    background: #fff7e0; color: #3a2818;
    border: 3px solid #3a2818; border-radius: 14px; padding: 1.4rem 1.8rem;
  `;
  const close = document.createElement("button");
  close.textContent = "× close";
  close.style.cssText = "float:right; background:#ffd980; color:#3a2818; border:2px solid #3a2818; border-radius:8px; padding:0.4rem 0.8rem; cursor:pointer;";
  close.addEventListener("click", () => overlay.remove());
  inner.appendChild(close);

  const h2 = document.createElement("h2");
  h2.textContent = opts.title ?? "Help — Keybinds";
  inner.appendChild(h2);

  const pre = document.createElement("pre");
  pre.style.cssText = "white-space:pre-wrap; font-family:'Fira Code',monospace; font-size:0.86rem; line-height:1.5;";
  pre.textContent = renderHelpText(opts);
  inner.appendChild(pre);

  overlay.appendChild(inner);
  document.body.appendChild(overlay);

  // ESC closes
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      overlay.remove();
      window.removeEventListener("keydown", escHandler);
    }
  };
  window.addEventListener("keydown", escHandler);
  return overlay;
}
