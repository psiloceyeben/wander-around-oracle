import { describe, it, expect } from "vitest";
import {
  SEPHIROTH, PATHS, MONAD_DISTANCE,
  sephirahVec, pathVec, sephirahDictionary, shortestPath,
  cosine, magnitude,
  cleanup,
} from "../src/hrr/index.js";

describe("Layer 0: Tree of Life routing manifold", () => {
  it("10 Sephirot, 22 paths", () => {
    expect(SEPHIROTH.length).toBe(10);
    expect(PATHS.length).toBe(22);
  });

  it("monad distance graph is complete", () => {
    for (const s of SEPHIROTH) {
      expect(typeof MONAD_DISTANCE[s]).toBe("number");
    }
    expect(MONAD_DISTANCE["keter"]).toBe(0);
    expect(MONAD_DISTANCE["malkuth"]).toBe(3);
  });

  it("Sephirah vectors are unit magnitude", () => {
    for (const s of SEPHIROTH) {
      expect(magnitude(sephirahVec(s))).toBeCloseTo(1.0, 6);
    }
  });

  it("Sephirah vectors are approximately mutually orthogonal", () => {
    let maxOffDiag = 0;
    for (let i = 0; i < SEPHIROTH.length; i++) {
      for (let j = i + 1; j < SEPHIROTH.length; j++) {
        const c = Math.abs(cosine(sephirahVec(SEPHIROTH[i]), sephirahVec(SEPHIROTH[j])));
        if (c > maxOffDiag) maxOffDiag = c;
      }
    }
    expect(maxOffDiag).toBeLessThan(0.15);
  });

  it("path vectors orthogonal to Sephirot and each other", () => {
    let maxOffDiag = 0;
    const allVecs: any[] = [];
    for (const s of SEPHIROTH) allVecs.push(sephirahVec(s));
    for (const [a, b] of PATHS) allVecs.push(pathVec(a, b));
    for (let i = 0; i < allVecs.length; i++) {
      for (let j = i + 1; j < allVecs.length; j++) {
        const c = Math.abs(cosine(allVecs[i], allVecs[j]));
        if (c > maxOffDiag) maxOffDiag = c;
      }
    }
    expect(maxOffDiag).toBeLessThan(0.20);
  });

  it("cleanup against Sephirah dictionary recovers the right Sephirah", () => {
    const dict = sephirahDictionary();
    for (const s of SEPHIROTH) {
      const result = cleanup(sephirahVec(s), dict);
      expect(result.label).toBe(s);
    }
  });

  it("shortest path: keter -> malkuth is 3 hops", () => {
    const path = shortestPath("keter", "malkuth");
    expect(path.length).toBe(4);
    expect(path[0]).toBe("keter");
    expect(path[path.length - 1]).toBe("malkuth");
  });

  it("shortest path: adjacent Sephirot is 1 hop", () => {
    const path = shortestPath("chesed", "geburah");
    expect(path.length).toBe(2);
  });

  it("shortest path: self is just self", () => {
    const path = shortestPath("tiferet", "tiferet");
    expect(path).toEqual(["tiferet"]);
  });
});
