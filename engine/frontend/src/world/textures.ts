// Procedural cartoon textures — hand-painted feel, zero asset files.
//
// Small canvases (64-128px), chunky shapes, gentle per-cell tint jitter:
// one notch more cartoonish than flat color, well short of busy realism.
// All textures repeat; materials keep their color tint (textures are drawn
// near-white where the palette should shine through, or in their own hue
// where the material stays white).

import * as THREE from "three";

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** Deterministic per-texture rng so rebuilds look identical. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function jitter(hex: string, r: () => number, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (r() * 2 - 1) * amt)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function finish(canvas: HTMLCanvasElement, rx: number, ry: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wooden boards: vertical planks, seams, the occasional knot. */
export function planksTex(repeat: number = 1.5): THREE.CanvasTexture {
  const key = `planks:${repeat}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, g] = makeCanvas(96, 96);
  const r = rng(7001);
  const board = 16;
  for (let x = 0; x < 96; x += board) {
    g.fillStyle = jitter("#b58a5f", r, 16);
    g.fillRect(x, 0, board, 96);
    g.fillStyle = "rgba(90, 58, 34, 0.55)";
    g.fillRect(x, 0, 2, 96);
    // grain strokes
    g.strokeStyle = "rgba(110, 74, 44, 0.35)";
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const gx = x + 4 + r() * (board - 8);
      g.beginPath();
      g.moveTo(gx, 0);
      g.bezierCurveTo(gx + 3, 24 + r() * 16, gx - 3, 56 + r() * 16, gx + 2, 96);
      g.stroke();
    }
    if (r() < 0.5) {
      const kx = x + board / 2, ky = 12 + r() * 72;
      g.fillStyle = "rgba(96, 62, 36, 0.8)";
      g.beginPath();
      g.ellipse(kx, ky, 2.6, 3.6, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = finish(c, repeat, repeat);
  cache.set(key, tex);
  return tex;
}

/** Running-bond stonework: chunky blocks, pale mortar, per-block tint. */
export function stoneTex(base: string = "#9aa3ab", repeat: number = 2): THREE.CanvasTexture {
  const key = `stone:${base}:${repeat}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, g] = makeCanvas(128, 128);
  const r = rng(7777 + base.length);
  g.fillStyle = "#cfc9ba";          // mortar
  g.fillRect(0, 0, 128, 128);
  const bw = 32, bh = 16;
  for (let row = 0; row < 128 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 128 + bw; x += bw) {
      g.fillStyle = jitter(base, r, 14);
      g.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      // a face highlight for that hand-painted look
      g.fillStyle = "rgba(255,255,255,0.10)";
      g.fillRect(x + off + 3, row * bh + 3, bw - 6, 3);
    }
  }
  const tex = finish(c, repeat, repeat);
  cache.set(key, tex);
  return tex;
}

/** Roof shingles: scalloped rows, darker undersides. */
export function shingleTex(base: string = "#a04a3a", repeat: number = 2): THREE.CanvasTexture {
  const key = `shingle:${base}:${repeat}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, g] = makeCanvas(96, 96);
  const r = rng(9091 + base.length);
  g.fillStyle = jitter(base, r, 0);
  g.fillRect(0, 0, 96, 96);
  const sw = 16, sh = 12;
  for (let row = 0; row < 96 / sh + 1; row++) {
    const off = row % 2 ? sw / 2 : 0;
    for (let x = -sw; x < 96 + sw; x += sw) {
      g.fillStyle = jitter(base, r, 18);
      g.beginPath();
      g.moveTo(x + off, row * sh);
      g.lineTo(x + off + sw, row * sh);
      g.lineTo(x + off + sw, row * sh + sh - 3);
      g.quadraticCurveTo(x + off + sw / 2, row * sh + sh + 3, x + off, row * sh + sh - 3);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(60, 26, 20, 0.45)";
      g.lineWidth = 1.5;
      g.stroke();
    }
  }
  const tex = finish(c, repeat, repeat);
  cache.set(key, tex);
  return tex;
}

/** Soft plaster: warm cream with low-contrast mottling. */
export function plasterTex(repeat: number = 1.5): THREE.CanvasTexture {
  const key = `plaster:${repeat}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, g] = makeCanvas(64, 64);
  const r = rng(3331);
  g.fillStyle = "#efe6d4";
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(190, 174, 146, ${0.05 + r() * 0.08})`;
    g.beginPath();
    g.arc(r() * 64, r() * 64, 3 + r() * 7, 0, Math.PI * 2);
    g.fill();
  }
  const tex = finish(c, repeat, repeat);
  cache.set(key, tex);
  return tex;
}

/** Marble: near-white with a few faint wandering veins. */
export function marbleTex(repeat: number = 1): THREE.CanvasTexture {
  const key = `marble:${repeat}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, g] = makeCanvas(96, 96);
  const r = rng(5151);
  g.fillStyle = "#f3f2ee";
  g.fillRect(0, 0, 96, 96);
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = `rgba(150, 156, 168, ${0.18 + r() * 0.12})`;
    g.lineWidth = 1 + r();
    g.beginPath();
    let x = r() * 96, y = 0;
    g.moveTo(x, y);
    while (y < 96) {
      x += (r() * 2 - 1) * 14;
      y += 10 + r() * 12;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = finish(c, repeat, repeat);
  cache.set(key, tex);
  return tex;
}
