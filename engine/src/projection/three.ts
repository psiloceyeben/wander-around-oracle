// Three.js projection — incremental mesh-sync against the world state.
//
// Maintains a Map<EntityId, THREE.Object3D>. On EntitySpawned, builds a mesh
// from the entity's meshTag using the configured mesh-tag registry. On
// EntityMoved / EntityDropped, updates the mesh transform. On EntityRemoved,
// disposes geometry and material and removes from the scene.
//
// The three.ts module imports Three.js lazily so the core engine doesn't
// require it at compile time. Game code constructs ThreeProjection passing
// THREE + a scene + a registry of meshTag builders.

import { type Projection, SimpleMeshTagRegistry, entityMeshTag } from "./types.js";
import { World } from "../world/index.js";
import { type EntityRecord, type EntityId, type Transform } from "../entity/types.js";
import { type GameEvent } from "../cmd/types.js";

/** Three.js types we depend on — declared structurally so we don't import
 *  the package in this file (game code wires in the actual THREE namespace). */
export interface ThreeLikeVector3 { set(x: number, y: number, z: number): unknown; copy(other: any): unknown; x: number; y: number; z: number; }
export interface ThreeLikeQuaternion { set(x: number, y: number, z: number, w: number): unknown; }
export interface ThreeLikeObject3D {
  position: ThreeLikeVector3;
  quaternion: ThreeLikeQuaternion;
  scale: ThreeLikeVector3;
  parent?: { remove(child: ThreeLikeObject3D): unknown } | null;
  add(child: ThreeLikeObject3D): unknown;
  traverse(fn: (o: any) => void): void;
}
export interface ThreeLikeScene extends ThreeLikeObject3D {}

export interface ThreeProjectionOpts {
  scene: ThreeLikeScene;
  /** Mesh-tag builder: produces a Three.Object3D for each meshTag. */
  builders: SimpleMeshTagRegistry<ThreeLikeObject3D>;
  /** Optional fallback for unknown tags. */
  fallback?: () => ThreeLikeObject3D;
}

export class ThreeProjection implements Projection {
  readonly name = "three";
  private scene: ThreeLikeScene;
  private builders: SimpleMeshTagRegistry<ThreeLikeObject3D>;
  private byId = new Map<EntityId, ThreeLikeObject3D>();

  constructor(opts: ThreeProjectionOpts) {
    this.scene = opts.scene;
    this.builders = opts.builders;
    if (opts.fallback && !this.builders.has("__fallback")) {
      this.builders.register("__fallback", opts.fallback);
    }
  }

  init(world: World): void {
    // Render initial state
    for (const e of world.allEntities()) this.spawnMesh(e);
  }

  onEvent(event: GameEvent): void {
    switch (event.kind) {
      case "EntitySpawned":
        this.spawnMesh(event.entity);
        break;
      case "EntityRemoved":
        this.removeMesh(event.id);
        break;
      case "EntityMoved":
        this.updateTransform(event.id, event.to);
        break;
      case "EntityDropped":
        this.updateTransform(event.targetId, event.transform);
        break;
      // Other events don't require visual updates in the projection layer
      default:
        break;
    }
  }

  render(_alpha: number): void {
    // Three.js rendering proper happens in the game's main loop via
    // renderer.render(scene, camera). The projection just keeps scene
    // contents in sync with world state; calling render() here is a no-op
    // (game's animation loop handles the actual frame).
  }

  destroy(): void {
    for (const [, mesh] of this.byId) {
      mesh.parent?.remove(mesh);
      this.disposeRecursive(mesh);
    }
    this.byId.clear();
  }

  meshFor(id: EntityId): ThreeLikeObject3D | undefined {
    return this.byId.get(id);
  }

  private spawnMesh(e: EntityRecord): void {
    if (this.byId.has(e.id)) return;
    const tag = entityMeshTag(e);
    let mesh: ThreeLikeObject3D;
    if (this.builders.has(tag)) mesh = this.builders.build(tag);
    else mesh = this.builders.build("__fallback");
    this.applyTransform(mesh, e.transform);
    this.scene.add(mesh);
    this.byId.set(e.id, mesh);
  }

  private removeMesh(id: EntityId): void {
    const mesh = this.byId.get(id);
    if (!mesh) return;
    mesh.parent?.remove(mesh);
    this.disposeRecursive(mesh);
    this.byId.delete(id);
  }

  private updateTransform(id: EntityId, t: Transform): void {
    const mesh = this.byId.get(id);
    if (!mesh) return;
    this.applyTransform(mesh, t);
  }

  private applyTransform(mesh: ThreeLikeObject3D, t: Transform): void {
    mesh.position.set(t.position.x, t.position.y, t.position.z);
    mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
    mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
  }

  private disposeRecursive(mesh: ThreeLikeObject3D): void {
    mesh.traverse((o: any) => {
      if (o.geometry?.dispose) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) for (const mm of m) mm.dispose?.();
      else m?.dispose?.();
    });
  }
}
