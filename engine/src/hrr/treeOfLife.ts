// Tree of Life routing manifold.
//
// 10 Sephirot + 22 paths = 32 fixed routing primitives. All HRR operations
// in the engine flow through this manifold. Cleanup against this dictionary
// is constant-time regardless of vocabulary growth, which is the property
// that makes HRR scale.
//
// See memory/tree_of_life_routing_2026_05_16.md for the architectural
// rationale.

import { type HRRVec } from "./types.js";
import { seedVec } from "./seed.js";
import { bind, normalize } from "./core.js";
import { type AttractorEntry } from "./cleanup.js";

export type Sephirah =
  | "keter" | "chokmah" | "binah"
  | "chesed" | "geburah" | "tiferet"
  | "netzach" | "hod" | "yesod"
  | "malkuth";

export const SEPHIROTH: ReadonlyArray<Sephirah> = [
  "keter", "chokmah", "binah",
  "chesed", "geburah", "tiferet",
  "netzach", "hod", "yesod",
  "malkuth",
] as const;

export const PATHS: ReadonlyArray<readonly [Sephirah, Sephirah]> = [
  ["keter",   "chokmah"],
  ["keter",   "binah"],
  ["keter",   "tiferet"],
  ["chokmah", "binah"],
  ["chokmah", "tiferet"],
  ["chokmah", "chesed"],
  ["binah",   "tiferet"],
  ["binah",   "geburah"],
  ["chesed",  "geburah"],
  ["chesed",  "tiferet"],
  ["chesed",  "netzach"],
  ["geburah", "tiferet"],
  ["geburah", "hod"],
  ["tiferet", "netzach"],
  ["tiferet", "hod"],
  ["tiferet", "yesod"],
  ["netzach", "hod"],
  ["netzach", "yesod"],
  ["netzach", "malkuth"],
  ["hod",     "yesod"],
  ["hod",     "malkuth"],
  ["yesod",   "malkuth"],
] as const;

/** Graph distance from Keter (the monad). Used for emanation-aware operations. */
export const MONAD_DISTANCE: Record<Sephirah, number> = {
  keter: 0,
  chokmah: 1, binah: 1, tiferet: 1,
  chesed: 2, geburah: 2, netzach: 2, hod: 2, yesod: 2,
  malkuth: 3,
};

// Pre-computed Sephirah HRR vectors (deterministic, never trained)
const _sephirahCache = new Map<Sephirah, HRRVec>();

export function sephirahVec(name: Sephirah): HRRVec {
  let v = _sephirahCache.get(name);
  if (!v) {
    v = seedVec(`sephirah:${name}`);
    _sephirahCache.set(name, v);
  }
  return v;
}

// Pre-computed path vectors: pathVec(a, b) = normalize(bind(seph(a), seph(b)))
const _pathCache = new Map<string, HRRVec>();

function pathKey(a: Sephirah, b: Sephirah): string {
  // Undirected: a-b is the same path as b-a
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function pathVec(a: Sephirah, b: Sephirah): HRRVec {
  const k = pathKey(a, b);
  let v = _pathCache.get(k);
  if (!v) {
    v = bind(sephirahVec(a), sephirahVec(b));
    normalize(v);
    _pathCache.set(k, v);
  }
  return v;
}

/** The cleanup dictionary for routing: 10 Sephirot. */
export function sephirahDictionary(): ReadonlyArray<AttractorEntry<Sephirah>> {
  return SEPHIROTH.map((name) => ({
    label: name,
    vec: sephirahVec(name),
  }));
}

/** BFS shortest path through the graph. Cached. */
const _shortestPathCache = new Map<string, Sephirah[]>();

export function shortestPath(src: Sephirah, dst: Sephirah): ReadonlyArray<Sephirah> {
  if (src === dst) return [src];
  const k = `${src}->${dst}`;
  const cached = _shortestPathCache.get(k);
  if (cached) return cached;

  const adj = new Map<Sephirah, Sephirah[]>();
  for (const s of SEPHIROTH) adj.set(s, []);
  for (const [a, b] of PATHS) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  const queue: Array<{ node: Sephirah; path: Sephirah[] }> = [
    { node: src, path: [src] },
  ];
  const visited = new Set<Sephirah>([src]);
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    for (const nbr of adj.get(node)!) {
      if (visited.has(nbr)) continue;
      const newPath = [...path, nbr];
      if (nbr === dst) {
        _shortestPathCache.set(k, newPath);
        return newPath;
      }
      visited.add(nbr);
      queue.push({ node: nbr, path: newPath });
    }
  }
  return [];
}
