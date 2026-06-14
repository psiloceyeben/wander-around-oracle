// Minimap — canvas radar of the nearby world. North-up; the player arrow
// rotates with view yaw. Portals and the workshop clamp to the rim when out
// of range so the player can always find their way back to the hub.

import { World } from "@engine/world/index.js";

const DOT_COLORS: Record<string, string> = {
  tree: "#2e6b34", pine: "#1f5e3a", palm: "#3f9c4d", bush: "#35803b",
  grass: "#3d6e36", flower: "#d56a86", mushroom: "#c94f43",
  rock: "#7d7f82", ice_block: "#9fd3ee", cactus: "#4a8a3c", dune: "#cdb178",
  sword: "#e6edf3", shield: "#e6edf3", book: "#d29922", lantern: "#ffd166",
  wizard_npc: "#a371f7", guard_npc: "#ff9248", merchant_npc: "#e3b341", scholar_npc: "#6cb6ff",
  wolf: "#aab2bb", deer: "#c08552",
};
const LANDMARKS: Record<string, string> = {
  doorway: "#f0883e", portal: "#ff7b72", workshop: "#79c0ff", temple: "#e6edf3",
  tower: "#bcc7d1", castle: "#8b98a5", house: "#b08968",
};

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private range = 56;            // world meters shown edge-to-edge/2
  private _visible = true;

  constructor(parent: HTMLElement, sizePx: number = 152) {
    this.size = sizePx;
    this.canvas = document.createElement("canvas");
    this.canvas.id = "minimap";
    this.canvas.width = sizePx * 2;   // retina-ish
    this.canvas.height = sizePx * 2;
    this.canvas.style.width = `${sizePx}px`;
    this.canvas.style.height = `${sizePx}px`;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  toggle(): void {
    this._visible = !this._visible;
    this.canvas.classList.toggle("hidden", !this._visible);
  }
  isVisible(): boolean { return this._visible; }

  draw(world: World, px: number, pz: number, yaw: number): void {
    if (!this._visible) return;
    const c = this.ctx;
    const S = this.size * 2;
    const half = S / 2;
    const scale = half / this.range;

    c.clearRect(0, 0, S, S);
    // Round mask + background
    c.save();
    c.beginPath();
    c.arc(half, half, half - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "rgba(13, 17, 23, 0.72)";
    c.fillRect(0, 0, S, S);

    const toMap = (wx: number, wz: number): [number, number] => [
      half + (wx - px) * scale,
      half + (wz - pz) * scale,
    ];

    for (const e of world.allEntities()) {
      if (e.id === "player") continue;
      const proto = e.prototypeId;
      const landmark = LANDMARKS[proto];
      const color = landmark ?? DOT_COLORS[proto];
      if (!color) continue;
      const dx = e.transform.position.x - px;
      const dz = e.transform.position.z - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (landmark) {
        // Landmarks clamp to the rim when out of range
        let [mx, mz] = toMap(e.transform.position.x, e.transform.position.z);
        if (d > this.range - 4) {
          const f = (this.range - 7) / d;
          mx = half + dx * f * scale;
          mz = half + dz * f * scale;
        }
        c.fillStyle = color;
        c.beginPath();
        c.arc(mx, mz, 7, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "rgba(13,17,23,0.9)";
        c.lineWidth = 2;
        c.stroke();
      } else {
        if (d > this.range) continue;
        const [mx, mz] = toMap(e.transform.position.x, e.transform.position.z);
        c.fillStyle = color;
        c.fillRect(mx - 2, mz - 2, 4, 4);
      }
    }

    // Player arrow (rotates with yaw; forward = -z at yaw 0)
    c.save();
    c.translate(half, half);
    c.rotate(-yaw);
    c.fillStyle = "#58a6ff";
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(7, 9);
    c.lineTo(0, 4);
    c.lineTo(-7, 9);
    c.closePath();
    c.fill();
    c.restore();

    // North tick
    c.fillStyle = "rgba(201,209,217,0.8)";
    c.font = `${Math.round(S * 0.07)}px ui-monospace, monospace`;
    c.textAlign = "center";
    c.fillText("N", half, S * 0.085);

    c.restore();
    // Rim
    c.strokeStyle = "rgba(88,166,255,0.45)";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(half, half, half - 2, 0, Math.PI * 2);
    c.stroke();
  }
}
