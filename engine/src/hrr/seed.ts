// Deterministic HRR vector seeding. Vectors are constructed unitary in the
// FREQUENCY domain — each FFT bin has unit magnitude. This is the canonical
// HRR seed form that makes bind/unbind exactly invertible.

import { HRR_DIM, type HRRVec } from "./types.js";
import { ifftInPlace } from "./fft.js";
import { normalize } from "./core.js";

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed a unitary HRR vector. Random unit-modulus phases per frequency bin,
 *  IFFT'd to time domain. The result is real-valued only at DC and Nyquist;
 *  everywhere else complex. We pin DC to 0 and let Nyquist be ±1 randomly to
 *  preserve the unitary property under IFFT. */
export function seedVec(key: string): HRRVec {
  const rng = mulberry32(fnv1a32(key));
  // Generate the frequency-domain representation directly.
  const fr = new Float64Array(HRR_DIM);
  const fi = new Float64Array(HRR_DIM);
  // For real-valued time-domain output we'd need Hermitian symmetry; for
  // pure complex HRR (what we use) every bin is independent.
  // DC bin (k=0): random phase, unit modulus
  {
    const theta = rng() * 2 * Math.PI;
    fr[0] = Math.cos(theta);
    fi[0] = Math.sin(theta);
  }
  for (let k = 1; k < HRR_DIM; k++) {
    const theta = rng() * 2 * Math.PI;
    fr[k] = Math.cos(theta);
    fi[k] = Math.sin(theta);
  }
  // IFFT to time domain
  ifftInPlace(fr, fi);
  const v: HRRVec = { real: fr, imag: fi };
  normalize(v);
  return v;
}

export function idVec(id: string): HRRVec {
  return seedVec(`id:${id}`);
}

export function roleVec(name: string): HRRVec {
  return seedVec(`role:${name}`);
}

export function kindVec(name: string): HRRVec {
  return seedVec(`kind:${name}`);
}
