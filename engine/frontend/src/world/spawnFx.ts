// Spawn FX — built things should LAND, not blink into being.
//
// When a player-built entity spawns, its mesh scale-pops from the ground
// with a soft overshoot, and an emissive ring expands and fades at its
// feet. Pure projection-side polish: world state is untouched; the pop is
// how the projection greets a new binding.

import * as THREE from "three";

interface PopAnim {
  mesh: THREE.Object3D;
  targetScale: THREE.Vector3;
  t: number;
  dur: number;
}

interface RingAnim {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
}

export class SpawnFx {
  private scene: THREE.Scene;
  private pops: PopAnim[] = [];
  private rings: RingAnim[] = [];
  private ringGeo: THREE.RingGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ringGeo = new THREE.RingGeometry(0.25, 0.4, 28);
  }

  /** Should this spawn get the ceremony? Streamed foliage and the player
   *  itself do not pop — only things someone (or the Oracle) built. */
  static eligible(id: string, prototypeId: string): boolean {
    if (!id || id.startsWith("chunk-")) return false;
    if (prototypeId === "player") return false;
    return true;
  }

  pop(mesh: THREE.Object3D, color: number = 0x58a6ff): void {
    const target = mesh.scale.clone();
    mesh.scale.copy(target).multiplyScalar(0.04);
    this.pops.push({ mesh, targetScale: target, t: 0, dur: 0.5 });

    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(mesh.position.x, mesh.position.y + 0.06, mesh.position.z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, dur: 0.8 });
  }

  /** Call every frame. */
  tick(dt: number): void {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const u = Math.min(1, p.t / p.dur);
      // Ease-out-back: a little overshoot so the build "settles".
      const c1 = 1.4, c3 = c1 + 1;
      const e = 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
      p.mesh.scale.set(
        p.targetScale.x * Math.max(0.04, e),
        p.targetScale.y * Math.max(0.04, e),
        p.targetScale.z * Math.max(0.04, e),
      );
      if (u >= 1) {
        p.mesh.scale.copy(p.targetScale);
        this.pops.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const u = Math.min(1, r.t / r.dur);
      const s = 1 + u * 9;
      r.mesh.scale.set(s, s, 1);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - u);
      if (u >= 1) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
