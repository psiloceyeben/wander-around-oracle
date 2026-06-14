// Cleanup attention: project a noisy HRR vector onto the nearest known
// attractor in a dictionary.
//
// This is the operation the field abandoned HRR for because it scaled badly
// when the dictionary was unbounded. With the Tree of Life routing manifold
// we keep cleanup bounded — the canonical dictionary is the 32 routing
// primitives plus a small per-role attractor set. Cleanup remains a
// constant-time operation regardless of vocabulary growth.

import { type HRRVec } from "./types.js";
import { cosine } from "./core.js";

export interface AttractorEntry<T> {
  /** Symbolic label this attractor decodes to. */
  label: T;
  /** The HRR vector itself. Typically unit-magnitude. */
  vec: HRRVec;
}

export interface CleanupResult<T> {
  /** The label of the winning attractor. */
  label: T;
  /** Cosine similarity to the winning attractor. */
  score: number;
  /** All scores in descending order — for inspection. */
  ranked: ReadonlyArray<{ label: T; score: number }>;
}

/** Find the nearest attractor in the dictionary by cosine similarity. */
export function cleanup<T>(
  noisy: HRRVec,
  dictionary: ReadonlyArray<AttractorEntry<T>>,
): CleanupResult<T> {
  if (dictionary.length === 0) {
    throw new Error("cleanup: empty dictionary");
  }
  const scored = dictionary.map((entry) => ({
    label: entry.label,
    score: cosine(noisy, entry.vec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return {
    label: scored[0].label,
    score: scored[0].score,
    ranked: scored,
  };
}

/** Cleanup with a confidence threshold. Returns null if best score < threshold. */
export function cleanupConfident<T>(
  noisy: HRRVec,
  dictionary: ReadonlyArray<AttractorEntry<T>>,
  threshold: number = 0.1,
): CleanupResult<T> | null {
  const r = cleanup(noisy, dictionary);
  if (r.score < threshold) return null;
  return r;
}
