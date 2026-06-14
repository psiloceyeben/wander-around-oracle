import { describe, it, expect } from "vitest";
import { World } from "../src/world/index.js";
import { CommandBus, defaultReducer } from "../src/cmd/index.js";
import { AsciiProjection, ThreeProjection, SimpleMeshTagRegistry, type ThreeLikeObject3D } from "../src/projection/index.js";
import { identityTransform } from "../src/entity/index.js";

describe("Layer 5: Projection substrate", () => {
  it("ASCII projection renders entities at their positions", () => {
    const w = new World();
    const proj = new AsciiProjection({ width: 11, height: 5 });
    proj.init(w);

    const b = new CommandBus(w, defaultReducer);
    b.applyImmediate({
      kind: "SpawnEntity", id: "player", prototypeId: "player",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({
      kind: "SpawnEntity", id: "tree1", prototypeId: "tree",
      transform: { ...identityTransform(), position: { x: 3, y: 0, z: 0 } },
      components: {},
    });

    const grid = proj.renderToString();
    expect(grid).toContain("@");
    expect(grid).toContain("T");
  });

  it("ASCII projection moves with focus", () => {
    const w = new World();
    const proj = new AsciiProjection({ width: 5, height: 5 });
    proj.init(w);
    const b = new CommandBus(w, defaultReducer);
    b.applyImmediate({
      kind: "SpawnEntity", id: "far", prototypeId: "tree",
      transform: { ...identityTransform(), position: { x: 100, y: 0, z: 0 } },
      components: {},
    });
    // Default focus 0,0,0 — far tree not visible
    expect(proj.renderToString()).not.toContain("T");
    proj.setFocus({ x: 100, y: 0, z: 0 });
    expect(proj.renderToString()).toContain("T");
  });

  it("Three projection spawns meshes on EntitySpawned events", () => {
    const w = new World();
    let addedCount = 0;
    const fakeScene: ThreeLikeObject3D = {
      position: { x: 0, y: 0, z: 0, set: () => {}, copy: () => {} },
      quaternion: { set: () => {} },
      scale: { x: 1, y: 1, z: 1, set: () => {}, copy: () => {} },
      add: () => { addedCount++; },
      traverse: () => {},
    } as ThreeLikeObject3D;

    const builders = new SimpleMeshTagRegistry<ThreeLikeObject3D>(() => makeFakeMesh());
    const proj = new ThreeProjection({
      scene: fakeScene,
      builders,
      fallback: () => makeFakeMesh(),
    });

    proj.init(w);
    const b = new CommandBus(w, defaultReducer);
    b.events.on("*", (e) => proj.onEvent(e));
    b.applyImmediate({
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    });
    expect(addedCount).toBe(1);
    expect(proj.meshFor("e1")).toBeDefined();
  });

  it("Three projection removes meshes on EntityRemoved events", () => {
    const w = new World();
    let removed = 0;
    const fakeScene: any = {
      position: { x: 0, y: 0, z: 0, set: () => {}, copy: () => {} },
      quaternion: { set: () => {} },
      scale: { x: 1, y: 1, z: 1, set: () => {}, copy: () => {} },
      add: () => {},
      traverse: () => {},
      remove: () => { removed++; },
    };
    const builders = new SimpleMeshTagRegistry<ThreeLikeObject3D>(() => makeFakeMesh(fakeScene));
    const proj = new ThreeProjection({ scene: fakeScene, builders, fallback: () => makeFakeMesh(fakeScene) });
    proj.init(w);
    const b = new CommandBus(w, defaultReducer);
    b.events.on("*", (e) => proj.onEvent(e));
    b.applyImmediate({
      kind: "SpawnEntity", id: "e1", prototypeId: "door",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({ kind: "RemoveEntity", id: "e1" });
    expect(removed).toBe(1);
    expect(proj.meshFor("e1")).toBeUndefined();
  });
});

function makeFakeMesh(parent: any = null): ThreeLikeObject3D {
  const mesh: any = {
    position: {
      x: 0, y: 0, z: 0,
      set(x: number, y: number, z: number) { mesh.position.x = x; mesh.position.y = y; mesh.position.z = z; },
      copy(o: any) { mesh.position.x = o.x; mesh.position.y = o.y; mesh.position.z = o.z; },
    },
    quaternion: {
      set(_x: number, _y: number, _z: number, _w: number) {},
    },
    scale: {
      x: 1, y: 1, z: 1,
      set(x: number, y: number, z: number) { mesh.scale.x = x; mesh.scale.y = y; mesh.scale.z = z; },
      copy(o: any) { mesh.scale.x = o.x; mesh.scale.y = o.y; mesh.scale.z = o.z; },
    },
    parent,
    add: () => {},
    traverse: (fn: any) => { fn(mesh); },
  };
  return mesh;
}
