// Visual render styles — restyle the LIVE 3D world from a description.
//
// `/style <words>` grades the world to match what you say: "noir", "watercolor",
// "neon", "autumn", "winter", "gloomy", "vivid", "toon"… Any description lands
// somewhere — unrecognized words derive a tint from their own letters, so the
// world always visibly changes. This is a color-grade of the actual Three.js
// render (canvas CSS filter + a translucent mood veil) plus an optional toon
// material pass — NOT the old ASCII text overlay (that's now only "/style ascii").
//
// Substrate-paradigm point: one world state, many projections, swapped live.

import * as THREE from "three";
import { AsciiProjection } from "@engine/projection/index.js";
import { World } from "@engine/world/index.js";

export type VisualStyleName = string;

interface StylePreset {
  label: string;
  match: RegExp;
  filter?: string;        // CSS filter applied to the WebGL canvas
  veil?: string | null;   // translucent full-screen mood wash (rgba) or null
  toon?: boolean;         // also convert materials to cel-shaded
  ascii?: boolean;        // explicit ASCII projection (niche)
}

// Ordered: first match wins. Keep "standard"/"ascii" explicit; the rest are
// descriptive moods. Anything unmatched falls through to a derived tint.
const PRESETS: StylePreset[] = [
  { label: "standard", match: /\b(standard|default|normal|reset|none|clear|plain|3d|realistic)\b/,
    filter: "", veil: null, toon: false },
  { label: "ascii", match: /\b(ascii|terminal|matrix|text|teletype)\b/, ascii: true },
  { label: "toon", match: /\b(toon|cel|cartoon|comic|paper.?mario|storybook|ink|hand.?drawn)\b/,
    filter: "saturate(1.2) contrast(1.1)", veil: null, toon: true },
  { label: "noir", match: /\b(noir|black.?and.?white|grayscale|greyscale|gray|grey|monochrome|b&w)\b/,
    filter: "grayscale(1) contrast(1.28) brightness(0.96)", veil: null },
  { label: "watercolor", match: /\b(water.?colou?r|painterly|soft|pastel|dream|dreamy|hazy|gentle)\b/,
    filter: "saturate(1.35) brightness(1.08) contrast(0.9) blur(0.4px)", veil: "rgba(255,248,230,0.10)" },
  { label: "neon", match: /\b(neon|cyber|cyberpunk|synthwave|vapor|vaporwave|electric)\b/,
    filter: "saturate(1.85) contrast(1.2) hue-rotate(-12deg) brightness(1.05)", veil: "rgba(120,0,180,0.16)" },
  { label: "sepia", match: /\b(sepia|vintage|old|antique|aged|faded|nostalgic)\b/,
    filter: "sepia(0.78) contrast(1.05) brightness(1.02)", veil: null },
  { label: "autumn", match: /\b(autumn|fall|amber|rust|harvest)\b/,
    filter: "sepia(0.35) saturate(1.45) hue-rotate(-18deg)", veil: "rgba(200,95,25,0.12)" },
  { label: "sunset", match: /\b(sunset|golden|warm|dusk|ember|fire|fiery)\b/,
    filter: "saturate(1.3) brightness(1.05)", veil: "rgba(255,140,40,0.15)" },
  { label: "winter", match: /\b(winter|ice|icy|frost|frosty|cold|cool|snow|arctic|frozen)\b/,
    filter: "saturate(0.85) brightness(1.12) contrast(1.02)", veil: "rgba(120,180,255,0.15)" },
  { label: "verdant", match: /\b(verdant|jungle|forest|emerald|lush|spring|green)\b/,
    filter: "saturate(1.4) brightness(1.04)", veil: "rgba(40,160,70,0.12)" },
  { label: "gloom", match: /\b(gloom|gloomy|night|nightfall|dark|darkness|shadow|horror|grim|haunted|ominous)\b/,
    filter: "brightness(0.7) contrast(1.2) saturate(0.82)", veil: "rgba(12,12,42,0.24)" },
  { label: "vivid", match: /\b(vivid|vibrant|saturated|bold|bright|technicolor|lurid)\b/,
    filter: "saturate(1.75) contrast(1.08) brightness(1.05)", veil: null },
];

export class VisualStyles {
  private scene: THREE.Scene;
  private world: World;
  private canvas: HTMLElement | null;
  private current = "standard";
  private gradientMap: THREE.DataTexture;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private veilEl: HTMLDivElement;
  private asciiEl: HTMLPreElement;
  private ascii: AsciiProjection;
  private asciiTimer: number | null = null;
  private toonActive = false;

  constructor(opts: {
    scene: THREE.Scene;
    world: World;
    hud: HTMLElement;
    focus: () => { x: number; y: number; z: number };
    canvas?: HTMLElement;
  }) {
    this.scene = opts.scene;
    this.world = opts.world;
    this.canvas = opts.canvas ?? document.querySelector("canvas");
    this.focus = opts.focus;

    const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
    this.gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    this.gradientMap.minFilter = THREE.NearestFilter;
    this.gradientMap.magFilter = THREE.NearestFilter;
    this.gradientMap.needsUpdate = true;

    // Mood veil — a translucent full-screen wash over the canvas, under the HUD.
    this.veilEl = document.createElement("div");
    this.veilEl.id = "style-veil";
    this.veilEl.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity .5s,background-color .5s;background:transparent;";
    opts.hud.appendChild(this.veilEl);

    this.asciiEl = document.createElement("pre");
    this.asciiEl.id = "ascii-overlay";
    this.asciiEl.classList.add("hidden");
    opts.hud.appendChild(this.asciiEl);
    this.ascii = new AsciiProjection({ width: 56, height: 30 });
    const glyphs: Record<string, string> = {
      grass: "'", flower: "+", bush: "o", pine: "Y", mushroom: "m",
      cactus: "i", ice_block: "#", palm: "P", dune: "~", lantern: "!",
      tower: "I", castle: "M", house: "n", temple: "Π", column: "|",
      bridge: "=", grove: "t", merchant_npc: "m", scholar_npc: "s",
      wolf: "v", deer: "d", staff: "/", book: "b",
    };
    for (const [k, g] of Object.entries(glyphs)) this.ascii.glyphs.register(k, () => g);
    this.ascii.init(this.world);
  }

  private focus: () => { x: number; y: number; z: number };

  currentStyle(): string { return this.current; }

  /** Re-apply the active style to a newly spawned mesh subtree. */
  applyToNew(obj: THREE.Object3D): void {
    if (this.toonActive) this.toonify(obj);
  }

  /** Resolve any description → a preset (or a derived tint) and apply it live. */
  swap(descriptor: string): string {
    const desc = (descriptor || "standard").toLowerCase().trim();
    const found = PRESETS.find((p) => p.match.test(desc));
    // Unrecognized description → derive a distinct hue tint from its own letters,
    // so the world still visibly restyles "as described" (dummy match never fires).
    const preset: StylePreset = found ?? { label: desc, match: /$^/, ...this.deriveTint(desc) };
    const label = preset.label;

    // Reset everything, then enter the new style.
    if (this.toonActive) { this.restoreMaterials(); this.toonActive = false; }
    this.stopAscii();
    this.setFilter("");
    this.setVeil(null);

    if (preset.ascii) {
      this.startAscii();
    } else {
      this.setFilter(preset.filter ?? "");
      this.setVeil(preset.veil ?? null);
      if (preset.toon) { this.toonify(this.scene); this.toonActive = true; }
    }
    this.current = label;
    return label;
  }

  /** The descriptive moods available, for help text. */
  static presetLabels(): string[] {
    return PRESETS.map((p) => p.label);
  }

  private deriveTint(desc: string): { filter: string; veil: string } {
    let h = 0;
    for (let i = 0; i < desc.length; i++) h = (h * 31 + desc.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    const rot = (hue - 180);                       // -180..180 deg
    const r = Math.round(120 + 120 * Math.cos((hue * Math.PI) / 180));
    const g = Math.round(120 + 120 * Math.cos(((hue + 120) * Math.PI) / 180));
    const b = Math.round(120 + 120 * Math.cos(((hue + 240) * Math.PI) / 180));
    return {
      filter: `saturate(1.4) contrast(1.06) hue-rotate(${rot}deg)`,
      veil: `rgba(${r},${g},${b},0.13)`,
    };
  }

  private setFilter(f: string): void {
    if (this.canvas) (this.canvas as HTMLElement).style.filter = f;
  }

  private setVeil(color: string | null): void {
    if (!color) {
      this.veilEl.style.opacity = "0";
      this.veilEl.style.backgroundColor = "transparent";
    } else {
      this.veilEl.style.backgroundColor = color;
      this.veilEl.style.opacity = "1";
    }
  }

  private toonify(root: THREE.Object3D): void {
    root.traverse((o: any) => {
      if (!o.isMesh) return;
      const m = o.material;
      const convert = (mat: any): THREE.Material => {
        if (!mat || mat.isMeshBasicMaterial || mat.isShaderMaterial || mat.isPointsMaterial) return mat;
        if (mat.isMeshToonMaterial) return mat;
        if (!mat.color) return mat;
        const toon = new THREE.MeshToonMaterial({
          color: mat.color.clone(),
          gradientMap: this.gradientMap,
          transparent: mat.transparent ?? false,
          opacity: mat.opacity ?? 1,
          side: mat.side ?? THREE.FrontSide,
        });
        if (mat.vertexColors) toon.vertexColors = true;
        return toon;
      };
      if (!this.originals.has(o)) {
        this.originals.set(o, m);
        o.material = Array.isArray(m) ? m.map(convert) : convert(m);
      }
    });
  }

  private restoreMaterials(): void {
    for (const [mesh, mat] of this.originals) {
      const cur = mesh.material;
      mesh.material = mat;
      const disposeIfToon = (mm: any) => { if (mm?.isMeshToonMaterial) mm.dispose(); };
      if (Array.isArray(cur)) cur.forEach(disposeIfToon); else disposeIfToon(cur);
    }
    this.originals.clear();
  }

  private startAscii(): void {
    this.asciiEl.classList.remove("hidden");
    const renderOnce = () => {
      const f = this.focus();
      this.ascii.setFocus(f);
      this.asciiEl.textContent = this.ascii.renderToString();
    };
    renderOnce();
    this.asciiTimer = window.setInterval(renderOnce, 180);
  }

  private stopAscii(): void {
    if (this.asciiTimer !== null) { clearInterval(this.asciiTimer); this.asciiTimer = null; }
    this.asciiEl.classList.add("hidden");
  }
}
