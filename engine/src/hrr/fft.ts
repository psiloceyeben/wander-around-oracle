// In-place iterative Cooley-Tukey FFT for power-of-2 lengths.
// Used by core.ts for bind/unbind via the frequency-domain formulation:
//   bind(a, b) = IFFT(FFT(a) .* FFT(b))
//   unbind(c, a) = IFFT(FFT(c) .* conj(FFT(a)))
// This is the canonical efficient HRR form. Time complexity O(n log n).

import { HRR_DIM, type HRRVec } from "./types.js";

const N = HRR_DIM;
const LOG2_N = Math.log2(N);
if (LOG2_N !== Math.floor(LOG2_N)) {
  throw new Error(`HRR_DIM (${N}) must be a power of 2 for FFT`);
}

// Precomputed bit-reversal permutation
const _bitrev = new Uint32Array(N);
(function precomputeBitrev() {
  const log2n = LOG2_N | 0;
  for (let i = 0; i < N; i++) {
    let r = 0;
    let x = i;
    for (let b = 0; b < log2n; b++) {
      r = (r << 1) | (x & 1);
      x >>>= 1;
    }
    _bitrev[i] = r >>> 0;
  }
})();

// Precomputed twiddle factors for forward FFT: w[k] = exp(-2*pi*i*k/N)
const _wReal = new Float64Array(N / 2);
const _wImag = new Float64Array(N / 2);
(function precomputeTwiddles() {
  for (let k = 0; k < N / 2; k++) {
    const ang = (-2 * Math.PI * k) / N;
    _wReal[k] = Math.cos(ang);
    _wImag[k] = Math.sin(ang);
  }
})();

/** In-place forward FFT on (real, imag) buffers of length N. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  // Bit-reverse permutation
  for (let i = 0; i < N; i++) {
    const j = _bitrev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Cooley-Tukey butterflies
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >>> 1;
    const tStep = N / size;
    for (let i = 0; i < N; i += size) {
      for (let k = 0; k < half; k++) {
        const tIdx = k * tStep;
        const wr = _wReal[tIdx];
        const wi = _wImag[tIdx];
        const ar = re[i + k + half];
        const ai = im[i + k + half];
        // t = w * a[i + k + half]
        const tr = wr * ar - wi * ai;
        const ti = wr * ai + wi * ar;
        // a[i + k + half] = a[i + k] - t
        re[i + k + half] = re[i + k] - tr;
        im[i + k + half] = im[i + k] - ti;
        // a[i + k] = a[i + k] + t
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }
}

/** In-place inverse FFT. Note: divides by N at the end. */
export function ifftInPlace(re: Float64Array, im: Float64Array): void {
  // IFFT = conjugate-FFT-conjugate / N
  for (let i = 0; i < N; i++) im[i] = -im[i];
  fftInPlace(re, im);
  const inv = 1 / N;
  for (let i = 0; i < N; i++) {
    re[i] *= inv;
    im[i] = -im[i] * inv;
  }
}

/** Forward FFT producing a fresh vector. */
export function fft(v: HRRVec): HRRVec {
  const re = new Float64Array(v.real);
  const im = new Float64Array(v.imag);
  fftInPlace(re, im);
  return { real: re, imag: im };
}

/** Inverse FFT producing a fresh vector. */
export function ifft(v: HRRVec): HRRVec {
  const re = new Float64Array(v.real);
  const im = new Float64Array(v.imag);
  ifftInPlace(re, im);
  return { real: re, imag: im };
}
