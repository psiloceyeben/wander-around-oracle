// SubstrateAgentPlayer — substrate-paradigm cognition op.
//
// This is the substrate-native replacement for the v7.2 sephirahToCommand
// hand-written grammar. The grammar required:
//   1. Text-perception ("I see 1 sword. I will") — the model classifies
//      tokens rather than the world. Cognition discrimination test T2 FAIL:
//      mean JSD across scenes was 0.147 (threshold 0.15) — the model routes
//      nearly identically regardless of what's visible.
//   2. Text-command emission ("I will now issue command: PICKUP") — the
//      125M can't emit structured commands as text continuation. T3 FAIL:
//      0/4 parses.
//
// The substrate-paradigm path:
//   1. Perception → HRR vector via PerceptionSubstrate. The vector is a
//      bound superposition of (role:kind ⊛ kind_vec) + (role:distance ⊛
//      bucket_vec) + (role:interactable ⊛ verb_vec), per visible entity.
//      Scenes with different entities produce mathematically distinct
//      vectors — orthogonal HRR seeds make this guaranteed, not statistical.
//   2. Routing decision: the model classifies the perception into the
//      10-Sephirah manifold. This is the model's actual contribution.
//      The model is a classifier here, not a text generator.
//   3. Command emission: HRR cleanup against COMMAND_DICTIONARY with
//      affordance gating. PICKUP only fires when a pickup-affordant is
//      visible; ENTER_PORTAL only when a use-affordant portal exists; etc.
//      Affordance gating means structurally-impossible commands are
//      pre-pruned at the substrate level, not after the model emits text.
//
// Scale-invariant: every component runs the same regardless of model size.
// 125M today, v3 250M tomorrow, v6 2B later — the only thing that changes
// is the quality of the routing distribution. Better routing → more
// situationally appropriate commands; the substrate machinery doesn't
// need to change.

import { type CognitionOp } from "../../agent/agent.js";
import { type Command } from "../../cmd/types.js";
import { type EntityId } from "../../entity/types.js";
import { type Sephirah } from "../../hrr/treeOfLife.js";
import { composePerceptionSubstrate, type PerceptionResult } from "../perceptionSubstrate/index.js";
import { composeCommandFromSubstrate, type CommandSelection } from "../commandSubstrate/index.js";
import { composePerceptionPrompt, type OracleClient, type OracleResponse } from "./agentPlayer.js";
import { doubleRecursiveAttention, type AttentionOptions, type AttentionDiagnostic } from "./recursiveAttention.js";

export interface SubstrateAgentOptions {
  /** Perception radius in meters. */
  perceptionRadius?: number;
  /** Include the agent's currently held entity in perception. */
  includeHolding?: boolean;
  /** Generation prompt for SPAWN routing (passes through model's text continuation). */
  spawnPromptHook?: (text: string) => string | undefined;
  /** Use the double recursive attention head to refine routing before
   *  substrate cleanup. Default true. */
  useAttention?: boolean;
  /** Attention head tuning parameters (alpha, beta, iterations). */
  attention?: AttentionOptions;
}

/** Diagnostic: full per-tick reasoning trace, for the discrimination test. */
export interface SubstrateAgentDiagnostic {
  tick: number;
  perception: PerceptionResult;
  /** Raw routing from the model. */
  routingRaw: Partial<Record<Sephirah, number>>;
  /** Routing after attention head refinement (== routingRaw if attention off). */
  routingRefined: Partial<Record<Sephirah, number>>;
  attention: AttentionDiagnostic | null;
  oracleText: string;
  selection: CommandSelection;
  commandEmitted: Command | null;
}

/** Build a substrate-aware cognition op. The op:
 *    a) builds a perception HRR vector (PerceptionSubstrate)
 *    b) queries the oracle (HTTP or fake) for the routing distribution
 *    c) cleanup-classifies (CommandSubstrate) → engine Command
 *
 *  Diagnostics for the most recent N ticks are kept on the returned object
 *  so the discrimination test can inspect what the substrate actually did
 *  rather than just sampling the model alone. */
export function substrateAgentCognitionOp(
  client: OracleClient,
  opts: SubstrateAgentOptions = {},
): CognitionOp & { recent: SubstrateAgentDiagnostic[]; clearDiagnostics: () => void } {
  const recent: SubstrateAgentDiagnostic[] = [];
  const pending = new Map<EntityId, Promise<OracleResponse>>();
  const lastResp = new Map<EntityId, OracleResponse>();

  const op = ((ctx) => {
    const cmds: Command[] = [];

    // 1. Compose perception substrate
    const perception = composePerceptionSubstrate(ctx.world, ctx.agentId, {
      radius: opts.perceptionRadius ?? 12,
      includeHolding: opts.includeHolding ?? true,
    });

    // 2. Kick off an oracle query if none in flight. We still use a text
    //    prompt for the routing classifier — the model's Sephirah head is
    //    what we consume; its text continuation is incidental (used only
    //    as an optional SPAWN hint).
    if (!pending.has(ctx.agentId)) {
      const prompt = composePerceptionPrompt(ctx.world, ctx.agentId, ctx.perception.visibleIds);
      const q = client.query(prompt, { maxTokens: 12, temperature: 0.85 });
      pending.set(ctx.agentId, q);
      q.then((resp) => {
        lastResp.set(ctx.agentId, resp);
        pending.delete(ctx.agentId);
      }).catch(() => {
        pending.delete(ctx.agentId);
      });
    }

    // 3. If a routing distribution is available from the previous tick,
    //    do the substrate cleanup. Otherwise we wait — no command this
    //    tick rather than fabricating one.
    const resp = lastResp.get(ctx.agentId);
    if (!resp) {
      return cmds;
    }

    // 4. Augment: double recursive attention head (perception attention +
    //    affordance attention). Refines routing using substrate-native
    //    saliency signals before cleanup. Set useAttention:false to skip.
    let routingRefined: Partial<Record<Sephirah, number>> = resp.sephirah_probs;
    let attentionDiag: AttentionDiagnostic | null = null;
    if (opts.useAttention ?? true) {
      const att = doubleRecursiveAttention(resp.sephirah_probs, perception, opts.attention);
      routingRefined = att.routing;
      attentionDiag = att.diag;
    }

    // 5. Substrate cleanup → engine Command
    const generationPrompt = opts.spawnPromptHook?.(resp.text);
    const selection = composeCommandFromSubstrate(
      routingRefined,
      perception,
      ctx.world,
      ctx.agentId,
      { generationPrompt },
    );

    if (selection.command) cmds.push(selection.command);

    // 6. Diagnostics ring buffer (keep last 32)
    recent.push({
      tick: ctx.tick,
      perception,
      routingRaw: resp.sephirah_probs,
      routingRefined,
      attention: attentionDiag,
      oracleText: resp.text,
      selection,
      commandEmitted: selection.command,
    });
    if (recent.length > 32) recent.shift();

    return cmds;
  }) as CognitionOp & { recent: SubstrateAgentDiagnostic[]; clearDiagnostics: () => void };

  op.recent = recent;
  op.clearDiagnostics = () => { recent.length = 0; };
  return op;
}

/** Synchronous substrate cognition — for tests that need deterministic
 *  ticks without awaiting HTTP. Caller must pre-seed the lastResp via the
 *  injected provider closure. */
export function syncSubstrateAgentCognitionOp(
  provideRouting: (perception: PerceptionResult) => { probs: Partial<Record<Sephirah, number>>; text?: string },
  opts: SubstrateAgentOptions = {},
): CognitionOp & { recent: SubstrateAgentDiagnostic[]; clearDiagnostics: () => void } {
  const recent: SubstrateAgentDiagnostic[] = [];

  const op = ((ctx) => {
    const perception = composePerceptionSubstrate(ctx.world, ctx.agentId, {
      radius: opts.perceptionRadius ?? 12,
      includeHolding: opts.includeHolding ?? true,
    });
    const { probs, text } = provideRouting(perception);

    let routingRefined: Partial<Record<Sephirah, number>> = probs;
    let attentionDiag: AttentionDiagnostic | null = null;
    if (opts.useAttention ?? true) {
      const att = doubleRecursiveAttention(probs, perception, opts.attention);
      routingRefined = att.routing;
      attentionDiag = att.diag;
    }

    const generationPrompt = opts.spawnPromptHook?.(text ?? "");
    const selection = composeCommandFromSubstrate(
      routingRefined, perception, ctx.world, ctx.agentId, { generationPrompt },
    );
    const cmds: Command[] = selection.command ? [selection.command] : [];
    recent.push({
      tick: ctx.tick,
      perception,
      routingRaw: probs,
      routingRefined,
      attention: attentionDiag,
      oracleText: text ?? "",
      selection,
      commandEmitted: selection.command,
    });
    if (recent.length > 32) recent.shift();
    return cmds;
  }) as CognitionOp & { recent: SubstrateAgentDiagnostic[]; clearDiagnostics: () => void };

  op.recent = recent;
  op.clearDiagnostics = () => { recent.length = 0; };
  return op;
}
