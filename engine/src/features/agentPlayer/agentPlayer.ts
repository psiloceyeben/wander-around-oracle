// Feature: AgentPlayer — model autonomously plays the game.
//
// The trained 125M Tree-of-Life model is wrapped as an HttpOracle (Layer 7).
// AgentPlayer is a machine agent whose cognition op:
//   1. Composes a perception prompt from nearby entities + game state
//   2. Queries the Oracle (HTTP) — gets a routed Sephirah + text continuation
//   3. Maps (Sephirah, text) → Command via a small action grammar:
//        keter, chokmah, binah         → wander (contemplation)
//        chesed                         → talk-to / open / inspect
//        geburah                        → defend / block (hostile policy)
//        tiferet                        → BUILD via a prompt-driven /spawn
//        netzach, hod                   → explore / move
//        yesod                          → save the world
//        malkuth                        → pickup / drop the nearest interactable
//   4. Submits the resulting Command via the engine bus
//
// Substrate-paradigm fit: the model's substrate IS the engine's substrate.
// The same 32-primitive routing manifold drives both perception and action.

import { type CognitionOp } from "../../agent/agent.js";
import { type Command } from "../../cmd/types.js";
import { type Sephirah } from "../../hrr/treeOfLife.js";
import { World } from "../../world/world.js";
import { type EntityId } from "../../entity/types.js";
import { promptToSpawnCommand } from "../recipes/index.js";

export interface OracleResponse {
  routed_sephirah: Sephirah;
  routed_confidence: number;
  sephirah_probs: Record<Sephirah, number>;
  text: string;
  response_vec: number[];
}

export interface OracleClient {
  query(prompt: string, opts?: { maxTokens?: number; temperature?: number }): Promise<OracleResponse>;
  healthz(): Promise<{ ok: boolean; step?: number }>;
}

/** Real HTTP-backed client. Connects to oracle_http_server.py on Box C. */
export class HttpOracleClient implements OracleClient {
  private endpoint: string;
  private fetchImpl: typeof fetch;
  constructor(endpoint: string = "http://127.0.0.1:8765", fetchImpl?: typeof fetch) {
    this.endpoint = endpoint;
    // Wrap rather than store the bare reference: browsers require fetch to be
    // invoked with `this === globalThis` (calling this.fetchImpl(...) otherwise
    // throws "Illegal invocation"; Node doesn't care, so only the browser broke).
    this.fetchImpl = fetchImpl ?? ((...a: Parameters<typeof fetch>) => (globalThis as any).fetch(...a));
  }
  async healthz(): Promise<{ ok: boolean; step?: number }> {
    const r = await this.fetchImpl(`${this.endpoint}/healthz`);
    if (!r.ok) return { ok: false };
    const data = await r.json();
    return { ok: !!data.ok, step: data.step };
  }
  async query(prompt: string, opts?: { maxTokens?: number; temperature?: number }): Promise<OracleResponse> {
    const r = await this.fetchImpl(`${this.endpoint}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_tokens: opts?.maxTokens ?? 20,
        temperature: opts?.temperature ?? 0.85,
      }),
    });
    if (!r.ok) throw new Error(`oracle HTTP ${r.status}`);
    return await r.json();
  }
}

/** Deterministic fake client — for tests. Maps prompt keywords → Sephirah. */
export class FakeOracleClient implements OracleClient {
  private nextResponses: OracleResponse[] = [];
  private defaultRoute: Sephirah = "tiferet";

  async healthz(): Promise<{ ok: boolean; step?: number }> {
    return { ok: true, step: -1 };
  }

  /** Inject a canned response for the next query. */
  enqueue(resp: Partial<OracleResponse>): void {
    this.nextResponses.push({
      routed_sephirah: resp.routed_sephirah ?? this.defaultRoute,
      routed_confidence: resp.routed_confidence ?? 0.5,
      sephirah_probs: resp.sephirah_probs ?? this._uniformProbs(),
      text: resp.text ?? "",
      response_vec: resp.response_vec ?? [],
    });
  }

  async query(prompt: string, _opts?: { maxTokens?: number; temperature?: number }): Promise<OracleResponse> {
    if (this.nextResponses.length > 0) return this.nextResponses.shift()!;
    // Heuristic mapping for unscripted prompts — keyword to Sephirah
    let routed: Sephirah = this.defaultRoute;
    const p = prompt.toLowerCase();
    if (p.includes("temple") || p.includes("build") || p.includes("create")) routed = "tiferet";
    else if (p.includes("attack") || p.includes("fight") || p.includes("law")) routed = "geburah";
    else if (p.includes("walk") || p.includes("explore") || p.includes("move")) routed = "netzach";
    else if (p.includes("save") || p.includes("memory")) routed = "yesod";
    else if (p.includes("pick") || p.includes("drop") || p.includes("hold")) routed = "malkuth";
    else if (p.includes("understand") || p.includes("think")) routed = "binah";
    return {
      routed_sephirah: routed, routed_confidence: 0.5,
      sephirah_probs: this._uniformProbs(), text: "", response_vec: [],
    };
  }

  private _uniformProbs(): Record<Sephirah, number> {
    return {
      keter: 0.1, chokmah: 0.1, binah: 0.1, chesed: 0.1, geburah: 0.1,
      tiferet: 0.1, netzach: 0.1, hod: 0.1, yesod: 0.1, malkuth: 0.1,
    } as Record<Sephirah, number>;
  }
}

// ── Action grammar: (Sephirah, text) → Command ────────────────────────

/** Compose a perception prompt from the agent's local world view. */
export function composePerceptionPrompt(world: World, agentId: EntityId, visibleIds: EntityId[]): string {
  const me = world.getEntity(agentId);
  if (!me) return "I am nowhere. I will";
  const lines: string[] = [];
  lines.push(`I am at position (${me.transform.position.x.toFixed(1)}, ${me.transform.position.z.toFixed(1)}).`);
  if (visibleIds.length === 0) {
    lines.push("I see nothing nearby.");
  } else {
    const kinds = new Map<string, number>();
    for (const id of visibleIds) {
      const e = world.getEntity(id);
      if (!e) continue;
      kinds.set(e.prototypeId, (kinds.get(e.prototypeId) ?? 0) + 1);
    }
    const summary = Array.from(kinds.entries())
      .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`)
      .join(", ");
    lines.push(`I see ${summary}.`);
  }
  lines.push("I will");
  return lines.join(" ");
}

/** Map a routed Sephirah + perception → a Command (or null for skip). */
export function sephirahToCommand(
  routed: Sephirah,
  text: string,
  world: World,
  agentId: EntityId,
  visibleIds: EntityId[],
): Command | null {
  const me = world.getEntity(agentId);
  if (!me) return null;

  // Find nearest visible interactable
  const nearestInteractable = () => {
    let best: { id: EntityId; d2: number } | null = null;
    for (const id of visibleIds) {
      const e = world.getEntity(id);
      if (!e || e.id === agentId) continue;
      if (!e.components.interactable) continue;
      if (e.components.interactable.immutable) continue;
      const dx = e.transform.position.x - me.transform.position.x;
      const dz = e.transform.position.z - me.transform.position.z;
      const d2 = dx * dx + dz * dz;
      if (!best || d2 < best.d2) best = { id, d2 };
    }
    return best?.id ?? null;
  };

  switch (routed) {
    case "keter":
    case "chokmah":
    case "binah":
      // Wander / contemplate — small move
      return wanderMove(world, agentId, 0.3);

    case "chesed":
      // Inspect / talk — emit an EditComponents that bumps an "inspected" flag
      // (purely a substrate-paradigm acknowledgment; no game effect needed)
      return null;

    case "geburah":
      // Defensive posture — back away from any visible NPC
      return wanderMove(world, agentId, 0.5);  // moves the agent; real combat would Attack

    case "tiferet": {
      // BUILD via prompt-driven /spawn. Choose what to build from the model's text continuation.
      // If the text starts with anything recognizable, prepend "a " and pipe to recipes.
      const buildText = inferBuildPrompt(text) ?? "a small marble column";
      const here = me.transform.position;
      return promptToSpawnCommand(buildText, { x: here.x + 2, y: here.y, z: here.z + 2 });
    }

    case "netzach":
    case "hod":
      // Explore — larger wander step
      return wanderMove(world, agentId, 0.6);

    case "yesod":
      // Save the world
      return { kind: "SaveWorld", slot: "agent-playtest" };

    case "malkuth": {
      // Manipulate — pick up the nearest interactable, or drop if holding
      const id = nearestInteractable();
      if (id) {
        const e = world.getEntity(id)!;
        if (e.components.holder?.heldBy === agentId) {
          // Drop here
          return {
            kind: "DropEntity", targetId: id, holderId: agentId,
            dropTransform: {
              position: { x: me.transform.position.x, y: me.transform.position.y, z: me.transform.position.z },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
          };
        }
        return { kind: "PickupEntity", targetId: id, holderId: agentId };
      }
      // Nothing interactable nearby — explore for one
      return wanderMove(world, agentId, 0.4);
    }
  }
}

function wanderMove(world: World, agentId: EntityId, step: number): Command | null {
  const me = world.getEntity(agentId);
  if (!me) return null;
  // Deterministic wander based on tick — use a hash of (id + position) for variety
  const tick = world.tick;
  const h = (((tick * 2654435761) ^ agentId.length) >>> 0);
  const dx = ((h & 0xff) / 255 - 0.5) * step;
  const dz = (((h >> 8) & 0xff) / 255 - 0.5) * step;
  return {
    kind: "MoveEntity", id: agentId,
    transform: { position: { x: me.transform.position.x + dx, y: me.transform.position.y, z: me.transform.position.z + dz } },
  };
}

/** Pluck a build-prompt from the model's text continuation if recognizable. */
function inferBuildPrompt(text: string): string | null {
  if (!text) return null;
  const cleaned = text.trim().split(/[.\n]/)[0].toLowerCase().trim();
  // If it looks like an object phrase, use it
  const keywords = ["temple", "tower", "tree", "rock", "sword", "shield", "door", "house", "lantern"];
  for (const k of keywords) {
    if (cleaned.includes(k)) {
      return `a ${k}`;
    }
  }
  return null;
}

// ── Cognition op factory ─────────────────────────────────────────────

export function agentPlayerCognitionOp(client: OracleClient): CognitionOp {
  // The cognition op is async-tolerant — we kick off the query and return
  // the previous tick's command on the next tick. For the demo we use a
  // synchronous fast-path that calls the FakeOracleClient (or pre-queries
  // the HttpOracleClient with a small timeout).
  //
  // Note: real CognitionOp signature returns Commands synchronously. We
  // maintain a per-agent "pending" state and flush commands when the
  // previous query resolves.
  const pending = new Map<EntityId, Promise<OracleResponse>>();
  const lastResp = new Map<EntityId, OracleResponse>();

  return (ctx) => {
    const cmds: Command[] = [];
    // Kick off a new query if none pending
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
    // Use the most recent resolved response to issue a command
    const resp = lastResp.get(ctx.agentId);
    if (resp) {
      const cmd = sephirahToCommand(
        resp.routed_sephirah, resp.text,
        ctx.world, ctx.agentId, ctx.perception.visibleIds,
      );
      if (cmd) cmds.push(cmd);
    }
    return cmds;
  };
}

/** Synchronous variant that uses a FakeOracleClient (fully deterministic, no HTTP). */
export function fakeAgentPlayerCognitionOp(fake: FakeOracleClient, sephirahSchedule?: Sephirah[]): CognitionOp {
  let scheduleIdx = 0;
  return (ctx) => {
    if (sephirahSchedule && sephirahSchedule.length > 0) {
      // Inject the next scheduled Sephirah
      fake.enqueue({ routed_sephirah: sephirahSchedule[scheduleIdx % sephirahSchedule.length] });
      scheduleIdx++;
    }
    const prompt = composePerceptionPrompt(ctx.world, ctx.agentId, ctx.perception.visibleIds);
    // FakeOracleClient is sync-resolving (no real network)
    let resp: OracleResponse | null = null;
    fake.query(prompt).then((r) => { resp = r; });
    // Hack: since fake resolves immediately on the microtask queue, we'd
    // normally need an await. For sync-cognition-op use, we use a stored
    // last-response pattern. Here we just check if we have a synthetic one:
    if (!resp) {
      // Fall back to direct call without storing
      const routed: Sephirah = sephirahSchedule ? sephirahSchedule[(scheduleIdx - 1) % sephirahSchedule.length] : "tiferet";
      resp = {
        routed_sephirah: routed, routed_confidence: 0.5,
        sephirah_probs: { keter:0.1,chokmah:0.1,binah:0.1,chesed:0.1,geburah:0.1,tiferet:0.1,netzach:0.1,hod:0.1,yesod:0.1,malkuth:0.1 } as Record<Sephirah, number>,
        text: "", response_vec: [],
      };
    }
    const cmd = sephirahToCommand(
      resp.routed_sephirah, resp.text,
      ctx.world, ctx.agentId, ctx.perception.visibleIds,
    );
    return cmd ? [cmd] : [];
  };
}
