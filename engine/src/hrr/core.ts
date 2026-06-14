// HRR core algebra implemented via FFT for O(n log n) bind/unbind.
//
//   bind(a, b)   = IFFT(FFT(a) .* FFT(b))         — circular convolution
//   unbind(c, a) = IFFT(FFT(c) .* conj(FFT(a)))   — inverse w.r.t. unitary-in-freq a
//
// When a is unitary in frequency (each |FFT(a)[k]| = 1), unbind recovers
// the bound value exactly (within numerical precision). Seeding produces
// such vectors via seed.ts.

import { HRR_DIM, type HRRVec, zeroVec } from "./types.js";
import { fftInPlace, ifftInPlace } from "./fft.js";

/** Circular convolution: bind(a, b) = IFFT(FFT(a) .* FFT(b)). */
export function bind(a: HRRVec, b: HRRVec): HRRVec {
  const ar = new Float64Array(a.real);
  const ai = new Float64Array(a.imag);
  const br = new Float64Array(b.real);
  const bi = new Float64Array(b.imag);
  fftInPlace(ar, ai);
  fftInPlace(br, bi);
  // Elementwise complex multiply: (ar+ai*i)(br+bi*i) = (ar*br-ai*bi) + (ar*bi+ai*br)*i
  for (let k = 0; k < HRR_DIM; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k];
    const im = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = r;
    ai[k] = im;
  }
  ifftInPlace(ar, ai);
  return { real: ar, imag: ai };
}

/** Unbind via conjugate-multiply in frequency: unbind(c, a) = IFFT(FFT(c) * conj(FFT(a))). */
export function unbind(c: HRRVec, a: HRRVec): HRRVec {
  const cr = new Float64Array(c.real);
  const ci = new Float64Array(c.imag);
  const ar = new Float64Array(a.real);
  const ai = new Float64Array(a.imag);
  fftInPlace(cr, ci);
  fftInPlace(ar, ai);
  // (cr+ci*i) * conj(ar+ai*i) = (cr+ci*i)(ar-ai*i) = (cr*ar+ci*ai) + (ci*ar-cr*ai)*i
  for (let k = 0; k < HRR_DIM; k++) {
    const r = cr[k] * ar[k] + ci[k] * ai[k];
    const im = ci[k] * ar[k] - cr[k] * ai[k];
    cr[k] = r;
    ci[k] = im;
  }
  ifftInPlace(cr, ci);
  return { real: cr, imag: ci };
}

/** Involution: a*[k] = conj(a[(-k) mod n]). Time-domain dual of frequency conjugation.
 *  Provided for explicit operations; bind/unbind now use FFT directly. */
export function involution(a: HRRVec): HRRVec {
  const out = zeroVec();
  out.real[0] = a.real[0];
  out.imag[0] = -a.imag[0];
  for (let k = 1; k < HRR_DIM; k++) {
    out.real[k] = a.real[HRR_DIM - k];
    out.imag[k] = -a.imag[HRR_DIM - k];
  }
  return out;
}

export function magnitude(v: HRRVec): number {
  let s = 0;
  const r = v.real, i = v.imag;
  for (let k = 0; k < HRR_DIM; k++) s += r[k] * r[k] + i[k] * i[k];
  return Math.sqrt(s);
}

/** Real-valued inner product over complex vectors: Re(<a, conj(b)>). */
export function dot(a: HRRVec, b: HRRVec): number {
  let s = 0;
  const ar = a.real, ai = a.imag, br = b.real, bi = b.imag;
  for (let k = 0; k < HRR_DIM; k++) s += ar[k] * br[k] + ai[k] * bi[k];
  return s;
}

export function cosine(a: HRRVec, b: HRRVec): number {
  const ma = magnitude(a), mb = magnitude(b);
  if (ma < 1e-12 || mb < 1e-12) return 0;
  return dot(a, b) / (ma * mb);
}

export function normalize(v: HRRVec): void {
  const m = magnitude(v);
  if (m < 1e-12) return;
  const inv = 1 / m;
  const r = v.real, i = v.imag;
  for (let k = 0; k < HRR_DIM; k++) {
    r[k] *= inv;
    i[k] *= inv;
  }
}

export function add(a: HRRVec, b: HRRVec): HRRVec {
  const out = zeroVec();
  const ar = a.real, ai = a.imag, br = b.real, bi = b.imag;
  for (let k = 0; k < HRR_DIM; k++) {
    out.real[k] = ar[k] + br[k];
    out.imag[k] = ai[k] + bi[k];
  }
  return out;
}

export function addInto(a: HRRVec, b: HRRVec): void {
  const ar = a.real, ai = a.imag, br = b.real, bi = b.imag;
  for (let k = 0; k < HRR_DIM; k++) {
    ar[k] += br[k];
    ai[k] += bi[k];
  }
}

export function subInto(a: HRRVec, b: HRRVec): void {
  const ar = a.real, ai = a.imag, br = b.real, bi = b.imag;
  for (let k = 0; k < HRR_DIM; k++) {
    ar[k] -= br[k];
    ai[k] -= bi[k];
  }
}

export function scale(a: HRRVec, s: number): HRRVec {
  const out = zeroVec();
  for (let k = 0; k < HRR_DIM; k++) {
    out.real[k] = a.real[k] * s;
    out.imag[k] = a.imag[k] * s;
  }
  return out;
}
