// Layer 0 — HRR substrate types.
//
// An HRR vector is a fixed-length complex-valued vector. We represent
// complex values as two interleaved Float64Arrays (real, imag) of length
// HRR_DIM. This is the most cache-friendly layout for the inner loops
// of bind/unbind/cleanup, and it avoids per-element allocation.
//
// The substrate paradigm runs entirely in this type. Entities, world
// state, commands, events, the Tree of Life routing primitives — all of
// it is HRRVec. The algebra is bind, unbind, superpose, cleanup.

export const HRR_DIM = 1024;

/** An HRR vector. real[i] + i * imag[i] for i in [0, HRR_DIM). */
export interface HRRVec {
  readonly real: Float64Array;
  readonly imag: Float64Array;
}

/** Allocate a zero HRR vector. */
export function zeroVec(): HRRVec {
  return {
    real: new Float64Array(HRR_DIM),
    imag: new Float64Array(HRR_DIM),
  };
}

/** Copy a vector into a fresh allocation. */
export function copyVec(v: HRRVec): HRRVec {
  return {
    real: new Float64Array(v.real),
    imag: new Float64Array(v.imag),
  };
}

/** In-place copy: dst <- src. */
export function copyInto(dst: HRRVec, src: HRRVec): void {
  dst.real.set(src.real);
  dst.imag.set(src.imag);
}
