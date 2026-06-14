// Blueprint placement — speaking no longer drops a build where the grammar
// guesses; it puts the THING IN YOUR HAND. A miniature rides the viewmodel,
// a translucent full-size ghost stands where you're looking, a grid snaps
// it to honest meters, and a footprint ring shows its scope — green when
// the ground is clear and dry, red when it isn't. Click to set it down.

import * as THREE from "three";
import type { BuilderRegistry } from "../meshes/index.js";

const GREEN = 0x2ea043;
const RED = 0xf85149;

export class PlacementMode {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private builders: BuilderRegistry;

  active = false;
  prompt = "";
  footprint = 0.7;
  valid = false;
  private snapStep = 1;
  private ghost: THREE.Object3D | null = null;
  private mini: THREE.Object3D | null = null;
  private grid: THREE.GridHelper | null = null;
  private ring: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private candidate = { x: 0, y: 0, z: 0 };

  constructor(opts: { scene: THREE.Scene; camera: THREE.Camera; builders: BuilderRegistry }) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.builders = opts.builders;
  }

  enter(prompt: string, meshTag: string, footprint: number): void {
    this.exit();
    this.active = true;
    this.prompt = prompt;
    this.footprint = footprint;
    this.snapStep = footprint >= 1.5 ? 1 : 0.5;

    // full-size ghost — the building as a proposal
    this.ghost = this.builders.build(meshTag);
    this.ghost.traverse((o: any) => {
      if (!o.isMesh || !o.material) return;
      const ghostify = (m: any) => {
        const gm = m.clone();
        gm.transparent = true;
        gm.opacity = 0.42;
        gm.depthWrite = false;
        return gm;
      };
      o.material = Array.isArray(o.material) ? o.material.map(ghostify) : ghostify(o.material);
      o.castShadow = false;
    });
    this.scene.add(this.ghost);

    // the blueprint in your hand
    this.mini = this.builders.build(meshTag);
    const box = new THREE.Box3().setFromObject(this.mini);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = 0.34 / Math.max(size.x, size.y, size.z, 0.001);
    this.mini.scale.setScalar(s);
    this.mini.position.set(0.42, -0.34, -0.85);
    this.mini.rotation.set(0.1, -0.5, 0.04);
    this.camera.add(this.mini);

    // snapping grid + footprint scope ring
    const span = Math.max(8, Math.ceil(footprint * 4));
    this.grid = new THREE.GridHelper(span, span / this.snapStep, GREEN, 0x4a5568);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.45;
    this.scene.add(this.grid);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: GREEN, transparent: true, opacity: 0.65,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.2, footprint - 0.09), footprint, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);
  }

  /** Per-frame: move the proposal to the snapped candidate + validity tint. */
  update(x: number, y: number, z: number, valid: boolean): void {
    if (!this.active) return;
    this.candidate = { x, y, z };
    this.valid = valid;
    if (this.ghost) this.ghost.position.set(x, y, z);
    if (this.grid) this.grid.position.set(x, y + 0.03, z);
    if (this.ring) this.ring.position.set(x, y + 0.05, z);
    if (this.ringMat) this.ringMat.color.setHex(valid ? GREEN : RED);
    if (this.ghost) {
      this.ghost.traverse((o: any) => {
        if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.color
            && o.material.transparent && !o.material.map) {
          // tint untextured ghost parts toward the verdict color, gently
        }
      });
    }
  }

  snap(v: number): number {
    return Math.round(v / this.snapStep) * this.snapStep;
  }

  /** The snapped candidate under consideration right now. */
  current(): { x: number; y: number; z: number; valid: boolean } {
    return { ...this.candidate, valid: this.valid };
  }

  /** The chosen spot, if the proposal is valid. */
  confirm(): { x: number; y: number; z: number } | null {
    if (!this.active || !this.valid) return null;
    const spot = { ...this.candidate };
    this.exit();
    return spot;
  }

  exit(): void {
    this.active = false;
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
    if (this.mini) {
      this.camera.remove(this.mini);
      this.mini = null;
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      (this.grid.material as THREE.Material).dispose();
      this.grid = null;
    }
    if (this.ring) {
      this.scene.remove(this.ring);
      this.ring.geometry.dispose();
      this.ringMat?.dispose();
      this.ring = null;
      this.ringMat = null;
    }
  }
}
