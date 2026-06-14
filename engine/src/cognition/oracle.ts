// Layer 7 — Cognition substrate.
//
// The Oracle is the trained substrate-paradigm model (eventually 2B by end
// of lineage; today the 125M Tree-of-Life-routed checkpoint that's running
// in /opt/wander/var/oracle/checkpoint_125m_tree_of_life_step11113.pt).
//
// At this layer we define the abstract interface — what the engine needs
// from an Oracle for NPC cognition, resolver dispatch, narrative emergence,
// dialogue. We provide a deterministic stub implementation that game logic
// can use offline (no inference cost) and a network-backed implementation
// (Layer 9 will wire this to an HTTP endpoint hitting Box C's Oracle).

import { type HRRVec } from "../hrr/types.js";
import { type Sephirah, sephirahDictionary } from "../hrr/treeOfLife.js";
import { cleanup } from "../hrr/cleanup.js";
import { seedVec } from "../hrr/seed.js";

export interface OracleRequest {
  /** Perceptual HRR vector — superposition of locally-visible entity vectors. */
  perception: HRRVec;
  /** Optional prompt text for prompt-driven generation. */
  prompt?: string;
  /** Sephirah hint — bias generation toward this routing class. */
  sephirah?: Sephirah;
  /** Max number of tokens to generate (for prompt-driven). */
  maxTokens?: number;
}

export interface OracleResponse {
  /** The routed Sephirah (cleanup-classification of perception). */
  routedSephirah: Sephirah;
  /** Cleanup confidence (cosine to the winning Sephirah). */
  routedConfidence: number;
  /** Text continuation, if generating. Empty string if not. */
  text: string;
  /** A response HRR vector — substrate-native output for downstream binding. */
  responseVec: HRRVec;
}

/** Abstract Oracle interface. Implementations: stub (deterministic), http
 *  (Box C's trained model), local-onnx (future browser inference). */
export interface Oracle {
  query(req: OracleRequest): Promise<OracleResponse>;
}

/** Deterministic stub. Useful for tests, CI, offline play, demos. Classifies
 *  perception against the Tree of Life dictionary and produces a canned
 *  response vector. Does NOT generate text; returns empty string. */
export class StubOracle implements Oracle {
  async query(req: OracleRequest): Promise<OracleResponse> {
    const dict = sephirahDictionary();
    const cleaned = cleanup(req.perception, dict);
    const responseVec = seedVec(`oracle:response:${cleaned.label}:${req.prompt ?? "_"}`);
    return {
      routedSephirah: cleaned.label,
      routedConfidence: cleaned.score,
      text: "",
      responseVec,
    };
  }
}

/** HTTP-backed Oracle. Connects to a server-side endpoint that runs the
 *  trained model. Used when the engine is online and we want full
 *  generation quality. Endpoint contract:
 *     POST { perception: number[], prompt?: string, sephirah?: string }
 *     -> { routedSephirah: string, routedConfidence: number, text: string,
 *          responseVec: number[] }
 *  perception/responseVec are serialized as [real0, imag0, real1, imag1, ...].
 */
export class HttpOracle implements Oracle {
  private endpoint: string;
  private fetchImpl: typeof fetch;

  constructor(endpoint: string, fetchImpl?: typeof fetch) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl ?? (globalThis as any).fetch;
  }

  async query(req: OracleRequest): Promise<OracleResponse> {
    const body = {
      perception: serializeVec(req.perception),
      prompt: req.prompt,
      sephirah: req.sephirah,
      maxTokens: req.maxTokens,
    };
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Oracle HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
      routedSephirah: data.routedSephirah,
      routedConfidence: data.routedConfidence,
      text: data.text ?? "",
      responseVec: deserializeVec(data.responseVec),
    };
  }
}

function serializeVec(v: HRRVec): number[] {
  const out = new Array(v.real.length * 2);
  for (let i = 0; i < v.real.length; i++) {
    out[i * 2] = v.real[i];
    out[i * 2 + 1] = v.imag[i];
  }
  return out;
}

function deserializeVec(arr: number[]): HRRVec {
  const n = arr.length / 2;
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    real[i] = arr[i * 2];
    imag[i] = arr[i * 2 + 1];
  }
  return { real, imag };
}
