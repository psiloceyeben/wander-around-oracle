// Wander Around frontend bootstrap.
//
// Wires up:
//   - Engine v2 (World, CommandBus, AgentSystem, Scheduler, all features)
//   - Three.js renderer + streamed vertex-colored terrain + day/night sky
//   - ThreeProjection bridging engine state → mesh tree
//   - PointerLockController + KeyboardController, gravity/jump/collision
//   - HUD: slash bar, help, quests, workshop, tutorial, minimap, dialogue,
//     crosshair + contextual interact prompt
//   - Oracle (HTTP) — drives NPC dialogue when online; seeded procedural
//     voices keep NPCs alive offline
//   - Visual render styles (/style standard|toon|ascii) — same world,
//     different projection, swapped live
//
// The engine is imported via the `@engine` alias (../src/). Substrate
// paradigm preserved: world is HRR state (including terrain height, which
// is a pure function of the world seed); Three is one projection of it.

import * as THREE from "three";

import { World } from "@engine/world/index.js";
import { CommandBus, defaultReducer } from "@engine/cmd/index.js";
import { Scheduler } from "@engine/time/index.js";
import { AgentSystem, InputRegistry } from "@engine/agent/index.js";
import { identityTransform } from "@engine/entity/index.js";
import { ThreeProjection, AsciiProjection } from "@engine/projection/index.js";
import {
  AxiomRegistry, axiomGuarded, axiomIdLength, axiomEntityCap, axiomSanctuary,
} from "@engine/axiom/index.js";

import { promptToSpawnCommand } from "@engine/features/recipes/index.js";
import { decomposePrompt } from "@engine/language/index.js";
import { spawnPortalCommand, PortalProximitySystem } from "@engine/features/portals/index.js";
import { QuestSystem, LAUNCH_QUESTS } from "@engine/features/quests/index.js";
import { SlashDispatcher, defaultSlashCommands } from "@engine/features/slashCommands/index.js";
import { exportSnapshot } from "@engine/features/saveBackup/index.js";
import { FirstLaunchTutorial } from "@engine/features/firstLaunchTutorial/index.js";
import { renderHelpText } from "@engine/features/helpOverlay/index.js";
import { WorkshopSession, InMemoryCreationLibrary, spawnCreation } from "@engine/features/workshop/index.js";
import { FPSGuardrail, QUALITY_HIGH, QUALITY_LOW, type QualityConfig } from "@engine/features/fpsGuardrail/index.js";
import { SimpleStyleRegistry, RenderStyleManager } from "@engine/features/renderStyles/index.js";
import { BiomeStreamingSystem, terrainHeightAt, biomeAtWorld } from "@engine/features/biomeWorldgen/index.js";
import { adaptivePolicy } from "@engine/features/npcBehavior/index.js";
import { AmbientPolish } from "@engine/features/ambientPolish/index.js";
import { substrateAgentCognitionOp } from "@engine/features/agentPlayer/index.js";

import { MeshBuilderRegistry } from "./meshes/index.js";
import { PointerLockController } from "./controls/pointerLock.js";
import { KeyboardController } from "./controls/keyboard.js";
import { SlashBar } from "./ui/slashBar.js";
import { HelpOverlay } from "./ui/helpOverlay.js";
import { QuestPanel } from "./ui/questPanel.js";
import { WorkshopPanel } from "./ui/workshopPanel.js";
import { TutorialOverlay } from "./ui/tutorialOverlay.js";
import { MissionBanner } from "./ui/missionBanner.js";
import { Crosshair, InteractPrompt, HoldingLine, entityLabel, setEntityLabel } from "./ui/prompts.js";
import { MintPanel } from "./ui/mint.js";
import { WorldsPanel } from "./ui/worlds.js";
import { DialogueBox } from "./ui/dialogue.js";
import { Minimap } from "./ui/minimap.js";
import { AmbientAudio } from "./audio/ambient.js";
import { FrontendOracle } from "./oracle.js";
import { TerrainStreamer, WATER_LEVEL } from "./world/terrain.js";
import { SkySystem, PHASE_PRESETS } from "./world/sky.js";
import { VisualStyles } from "./world/renderStyles.js";
import { SpawnFx } from "./world/spawnFx.js";
import { BUILDING_SPECS } from "./world/buildingSpecs.js";
import { PlacementMode } from "./world/placement.js";

// ── DOM refs ─────────────────────────────────────────────────────────
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const titleOverlay = document.getElementById("title-overlay") as HTMLDivElement;
const titleStart = document.getElementById("title-start") as HTMLButtonElement;
const hudEl = document.getElementById("hud") as HTMLDivElement;
const fpsEl = document.getElementById("fps-counter") as HTMLDivElement;
const styleEl = document.getElementById("style-indicator") as HTMLDivElement;
const oracleEl = document.getElementById("oracle-status") as HTMLDivElement;
const slashBarEl = document.getElementById("slash-bar") as HTMLDivElement;
const slashInputEl = document.getElementById("slash-input") as HTMLInputElement;
const slashOutputEl = document.getElementById("slash-output") as HTMLDivElement;
const hudRightEl = document.getElementById("hud-right") as HTMLDivElement;
const questPanelEl = document.getElementById("quest-panel") as HTMLDivElement;
const questListEl = document.getElementById("quest-list") as HTMLUListElement;
const workshopPanelEl = document.getElementById("workshop-panel") as HTMLDivElement;
const workshopBodyEl = document.getElementById("workshop-body") as HTMLDivElement;
const helpOverlayEl = document.getElementById("help-overlay") as HTMLDivElement;
const helpBodyEl = document.getElementById("help-body") as HTMLDivElement;
const helpCloseBtn = document.getElementById("help-close") as HTMLButtonElement;
const tutorialOverlayEl = document.getElementById("tutorial-overlay") as HTMLDivElement;
const tutorialTextEl = document.getElementById("tutorial-text") as HTMLDivElement;
const tutorialNextBtn = document.getElementById("tutorial-next") as HTMLButtonElement;
const objectiveBannerEl = document.getElementById("objective-banner") as HTMLDivElement;
const objectiveTitleEl = document.getElementById("objective-title") as HTMLDivElement;
const objectiveHintEl = document.getElementById("objective-hint") as HTMLDivElement;
const objectiveProgressEl = document.getElementById("objective-progress") as HTMLDivElement;
const toastEl = document.getElementById("toast") as HTMLDivElement;
const btnHelp = document.getElementById("btn-help") as HTMLButtonElement;
const btnQuests = document.getElementById("btn-quests") as HTMLButtonElement;
const btnWorkshop = document.getElementById("btn-workshop") as HTMLButtonElement;
const btnMap = document.getElementById("btn-map") as HTMLButtonElement;
const btnPerf = document.getElementById("btn-perf") as HTMLButtonElement;

// ── Engine setup ─────────────────────────────────────────────────────
const axioms = new AxiomRegistry();
axioms.add(axiomIdLength);
axioms.add(axiomEntityCap(9000));
axioms.add(axiomSanctuary({ x: 0, y: 0, z: 0 }, 10));

const world = new World(7);
const bus = new CommandBus(world, axiomGuarded(defaultReducer, axioms));
const scheduler = new Scheduler(world);

const groundY = (x: number, z: number): number => terrainHeightAt(x, z, world.seed);

const agents = new AgentSystem();
const inputs = new InputRegistry();
inputs.register({
  code: "KeyE", contexts: ["play"], action: "Interact",
  description: "Interact with the nearest entity (or drop what you hold)",
  handler: () => {}, ownerModule: "interact",
});
inputs.register({
  code: "Space", contexts: ["play"], action: "Jump",
  description: "Jump",
  handler: () => {}, ownerModule: "movement",
});
inputs.register({
  code: "Slash", contexts: ["play"], action: "Slash command",
  description: "Open the slash command prompt",
  handler: () => {}, ownerModule: "slash",
});
inputs.register({
  code: "KeyH", contexts: ["play"], action: "Help",
  description: "Toggle help overlay",
  handler: () => {}, ownerModule: "help",
});
inputs.register({
  code: "KeyQ", contexts: ["play"], action: "Quests",
  description: "Toggle quest log",
  handler: () => {}, ownerModule: "quests",
});
inputs.register({
  code: "KeyM", contexts: ["play"], action: "Map",
  description: "Toggle minimap",
  handler: () => {}, ownerModule: "map",
});

// Quest system. NOTE: attach() is deferred until the boot handler (after the
// hub furniture AND the tutorial companion have spawned) so pre-placed
// entities don't auto-complete the "spawn / build five things" quests before
// the player acts. Quests track player-driven events only.
const quests = new QuestSystem();
quests.addMany(LAUNCH_QUESTS);

// Render-style manager — engine-side style state; VisualStyles (below) is
// the Three.js realization that actually changes the picture. The engine's
// StyleName vocabulary maps: toon → "paper-mario", ascii → "ascii".
const styleReg = new SimpleStyleRegistry();
styleReg.register("paper-mario", () => new AsciiProjection({ width: 30, height: 12 }));
styleReg.register("ascii", () => new AsciiProjection({ width: 56, height: 30 }));
const styleMgr = new RenderStyleManager({
  world, events: bus.events, registry: styleReg, initial: "paper-mario",
});

// Ambient polish — chime callbacks for engine events
const audio = new AmbientAudio();
const ambient = new AmbientPolish(bus.events, {
  emitParticlePuff: () => {},
  playFootstep: () => {},
  playChime: () => audio.chime("quest"),
});
ambient.attach();
bus.events.on("EntityPickedUp",  () => audio.chime("pickup"));
bus.events.on("EntityDropped",   () => audio.chime("drop"));
bus.events.on("EntitySpawned",   (e: any) => { if (e.entity?.prototypeId !== "player") audio.chime("spawn"); });
bus.events.on("WorldSaved",      () => audio.chime("save"));
bus.events.on("PortalEntered",   () => audio.chime("portal"));

// Workshop session + creation library
const creationLib = new InMemoryCreationLibrary();
const workshop = new WorkshopSession({ bus, world, origin: { x: 0, y: groundY(0, -8), z: -8 } });

// Biome streaming + portal proximity
const biome = new BiomeStreamingSystem({ radiusChunks: 2, unloadBeyond: 4 });
const portalProximity = new PortalProximitySystem();

// ── Initial scene (hub plaza on the meadow terrace) ──────────────────
const spawnAt = (id: string, prototypeId: string, x: number, z: number, components: any, extra?: any) => {
  bus.applyImmediate({
    kind: "SpawnEntity", id, prototypeId,
    transform: { ...identityTransform(), position: { x, y: groundY(x, z), z } },
    components,
    ...(extra ?? {}),
  });
};

bus.applyImmediate({
  kind: "SpawnEntity", id: "player", prototypeId: "player",
  transform: { ...identityTransform(), position: { x: 0, y: groundY(0, 0), z: 0 } },
  components: {
    collider: { shape: "capsule", size: { x: 0.5, y: 1.8, z: 0.5 }, solid: true },
    saveable: { persistent: true },
  },
});
agents.register({ id: "player", agency: "human", perceptionRadius: 12 });

spawnAt("sword-hub", "sword", 3, 1, { interactable: { verb: "pickup", range: 3 }, saveable: { persistent: true } });
spawnAt("rock-1", "rock", -2, 4, { interactable: { verb: "pickup", range: 3 } });
spawnAt("wizard", "wizard_npc", 6, 3, { interactable: { verb: "talk", range: 3.5 }, ai: { policy: "wander", perceptionRadius: 6, state: {} } });
spawnAt("villager", "guard_npc", -4, -2, { interactable: { verb: "talk", range: 3.5 } });
bus.applyImmediate(spawnPortalCommand(
  { label: "library", destination: { kind: "substrate", worldId: "library" } },
  { x: 8, y: groundY(8, -4), z: -4 },
));
spawnAt("tree-1", "tree", -6, 6, {});
spawnAt("tree-2", "tree", 8, 8, {});
spawnAt("workshop-station", "workshop", 0, -8, { interactable: { verb: "use", range: 3 } });
spawnAt("worlds-gate", "doorway", -8, 4, { interactable: { verb: "use", range: 3.5 } });
setEntityLabel("worlds-gate", "the worlds");
// Lanterns ring the plaza — landmarks by day, light by night
spawnAt("lantern-1", "lantern", 4.5, -2.5, {});
spawnAt("lantern-2", "lantern", -3.5, 2.5, {});
spawnAt("lantern-3", "lantern", 1.5, 5.5, {});

// Wire the wizard NPC as a machine agent with adaptive policy (substrate
// cognition takes over later if Oracle is online).
agents.register({
  id: "wizard", agency: "machine", perceptionRadius: 10,
  cognition: adaptivePolicy({ hostileRange: 3, followRange: 8 }),
});

// Tutorial — start once we have the player
const tutorial = new FirstLaunchTutorial(bus.events, bus, {
  schedule: (fn: () => void, ms: number) => { setTimeout(fn, ms); },
});

// ── Three.js scene ───────────────────────────────────────────────────
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 420);
camera.position.set(0, groundY(0, 0) + 1.62, 0);
scene.add(camera); // so held-item viewmodels (camera children) render

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: "high-performance",
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const sky = new SkySystem(scene);
const terrain = new TerrainStreamer({ scene, seed: world.seed, radius: 3 });
terrain.update(0, 0);

const builderReg = new MeshBuilderRegistry();
const engineRegAdapter: any = {
  has: (tag: string) => builderReg.has(tag),
  build: (tag: string) => builderReg.build(tag),
  register: (tag: string, factory: () => any) => builderReg.register(tag, factory),
};

const projection = new ThreeProjection({
  scene: scene as any,
  builders: engineRegAdapter,
  fallback: () => builderReg.build("__fallback") as any,
});
projection.init(world);
bus.events.on("*", (e: any) => projection.onEvent(e));

// First-person: never render your own body shell from inside.
const playerMesh = projection.meshFor("player") as unknown as THREE.Object3D | undefined;
if (playerMesh) playerMesh.visible = false;

// Blueprint placement — /spawn puts the build in your hand; click sets it down.
const placement = new PlacementMode({ scene, camera, builders: builderReg as any });

// Visual render styles (the projection-swap demo)
const visualStyles = new VisualStyles({
  scene, world, hud: hudEl, canvas,
  focus: () => world.getEntity("player")?.transform.position ?? { x: 0, y: 0, z: 0 },
});
// Newly spawned meshes pick up the active style, and player-built things
// arrive with a scale-pop + ground ring. Registered on "*" AFTER the
// projection's "*" handler so the mesh exists by the time this runs (the bus
// fires exact-kind listeners first, then "*" listeners in insertion order).
const spawnFx = new SpawnFx(scene);
let fxArmed = false;   // armed at boot — hub furniture doesn't pop
bus.events.on("*", (e: any) => {
  if (e.kind !== "EntitySpawned") return;
  const m = projection.meshFor(e.entity?.id) as unknown as THREE.Object3D | undefined;
  if (!m) return;
  visualStyles.applyToNew(m);
  if (fxArmed && SpawnFx.eligible(e.entity?.id ?? "", e.entity?.prototypeId ?? "")) {
    spawnFx.pop(m);
  }
});

// ── Player controls ──────────────────────────────────────────────────
const pointer = new PointerLockController({
  domElement: canvas, camera,
  onLock: () => crosshair.setActive(true),
  onUnlock: () => crosshair.setActive(false),
});
const keyboard = new KeyboardController();

const PLAYER_SPEED = 4.4;
const PLAYER_SPRINT_MULT = 1.85;
const EYE_HEIGHT = 1.62;
const GRAVITY = 16;
const JUMP_SPEED = 5.6;
const PLAYER_RADIUS = 0.42;

const fwdV = new THREE.Vector3();
const rgtV = new THREE.Vector3();
const moveV = new THREE.Vector3();

const STEP_UP = 0.5;       // ledges this low become floor (platforms, decks)

/** Circle-vs-box push-out; supports walls rotated around Y. Mutates via return. */
function pushOutOfBox(px: number, pz: number, cx: number, cz: number,
                      hw: number, hd: number, rot: number): [number, number] {
  let lx = px - cx, lz = pz - cz;
  let c = 1, s = 0;
  if (rot) {
    c = Math.cos(-rot); s = Math.sin(-rot);
    const tx = lx * c - lz * s, tz = lx * s + lz * c;
    lx = tx; lz = tz;
  }
  const qx = Math.max(-hw, Math.min(hw, lx));
  const qz = Math.max(-hd, Math.min(hd, lz));
  let dx = lx - qx, dz = lz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= PLAYER_RADIUS * PLAYER_RADIUS) return [px, pz];
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    lx = qx + (dx / d) * PLAYER_RADIUS;
    lz = qz + (dz / d) * PLAYER_RADIUS;
  } else {
    // center inside the box — exit along the cheapest axis
    const exX = (hw + PLAYER_RADIUS) * Math.sign(lx || 1) - lx;
    const exZ = (hd + PLAYER_RADIUS) * Math.sign(lz || 1) - lz;
    if (Math.abs(exX) < Math.abs(exZ)) lx += exX; else lz += exZ;
  }
  if (rot) {
    const c2 = Math.cos(rot), s2 = Math.sin(rot);
    const tx = lx * c2 - lz * s2, tz = lx * s2 + lz * c2;
    lx = tx; lz = tz;
  }
  return [cx + lx, cz + lz];
}

/** The walkable-world resolver: wall plans (door gaps included), generic
 *  solids, and standable low surfaces. Exposed on __wander for tests. */
function collideMove(nx: number, nz: number, feetY: number):
    { x: number; z: number; standY: number } {
  let standY = groundY(nx, nz);
  for (const e of world.allEntities()) {
    if (e.id === "player" || e.components.holder) continue;
    const ex = e.transform.position.x;
    const ez = e.transform.position.z;
    const ey = e.transform.position.y;
    const spec = BUILDING_SPECS[e.prototypeId];
    if (spec) {
      for (const pad of spec.stands ?? []) {
        const top = ey + pad.top;
        const inX = Math.abs(nx - (ex + pad.x)) <= pad.hw;
        const inZ = Math.abs(nz - (ez + pad.z)) <= pad.hd;
        if (inX && inZ && feetY + STEP_UP >= top) standY = Math.max(standY, top);
      }
      for (const w of spec.walls) {
        const wy = ey + (w.yBase ?? 0);
        if (feetY + 1.6 <= wy || feetY >= wy + w.h - 0.05) continue;
        [nx, nz] = pushOutOfBox(nx, nz, ex + w.x, ez + w.z, w.hw, w.hd, w.rot ?? 0);
      }
      continue;
    }
    const col = e.components.collider;
    if (!col?.solid) continue;
    const sy = col.size?.y ?? 2;
    const top = ey + sy;
    const hw = (col.size?.x ?? 1) / 2;
    const hd = (col.size?.z ?? 1) / 2;
    if (top - feetY <= STEP_UP && top > feetY - 0.6) {
      // low enough to step onto — it's floor, not a wall
      if (Math.abs(nx - ex) <= hw + 0.2 && Math.abs(nz - ez) <= hd + 0.2) {
        standY = Math.max(standY, top);
      }
      continue;
    }
    if (feetY + 1.6 <= ey || feetY >= top - 0.05) continue;
    [nx, nz] = pushOutOfBox(nx, nz, ex, ez, hw, hd, 0);
  }
  return { x: nx, z: nz, standY };
}

let vy = 0;
let grounded = true;
let prevJumpHeld = false;
let bobTime = 0;
let bobAmp = 0;
let footstepTimer = 0;
let baseFov = 75;

function tickPlayer(dt: number): void {
  const me = world.getEntity("player");
  if (!me) return;

  // Horizontal intent
  moveV.set(0, 0, 0);
  if (pointer.locked) {
    if (keyboard.forward()) { pointer.getForwardXZ(fwdV); moveV.add(fwdV); }
    if (keyboard.back())    { pointer.getForwardXZ(fwdV); moveV.sub(fwdV); }
    if (keyboard.right())   { pointer.getRightXZ(rgtV); moveV.add(rgtV); }
    if (keyboard.left())    { pointer.getRightXZ(rgtV); moveV.sub(rgtV); }
  }
  const sprinting = keyboard.sprint() && moveV.lengthSq() > 0;
  if (moveV.lengthSq() > 0) {
    moveV.normalize().multiplyScalar(PLAYER_SPEED * (sprinting ? PLAYER_SPRINT_MULT : 1) * dt);
  }

  // Jump + gravity
  const jumpHeld = pointer.locked && keyboard.isDown("Space");
  if (jumpHeld && !prevJumpHeld && grounded) {
    vy = JUMP_SPEED;
    grounded = false;
  }
  prevJumpHeld = jumpHeld;
  vy -= GRAVITY * dt;

  let nx = me.transform.position.x + moveV.x;
  let nz = me.transform.position.z + moveV.z;
  let ny = me.transform.position.y + vy * dt;

  // Collision + standing surfaces: walls (with their door gaps) push the
  // player out; low solids — temple platforms, bridge decks — become floor.
  const resolved = collideMove(nx, nz, me.transform.position.y);
  nx = resolved.x;
  nz = resolved.z;

  // Ground clamp (terrain or whatever we're standing on; water floats you)
  const gy = Math.max(resolved.standY, WATER_LEVEL - 0.35);
  if (ny <= gy) {
    ny = gy;
    vy = 0;
    grounded = true;
  }

  if (nx !== me.transform.position.x || ny !== me.transform.position.y || nz !== me.transform.position.z) {
    bus.applyImmediate({ kind: "MoveEntity", id: "player", transform: { position: { x: nx, y: ny, z: nz } } });
  }

  // Footsteps + head bob while moving on the ground
  const moving = moveV.lengthSq() > 0 && grounded;
  if (moving) {
    bobTime += dt * (sprinting ? 11 : 7.5);
    bobAmp = Math.min(1, bobAmp + dt * 6);
    footstepTimer -= dt;
    if (footstepTimer <= 0) {
      footstepTimer = sprinting ? 0.27 : 0.42;
      audio.ping(140 + Math.random() * 40, 55, "triangle");
    }
  } else {
    bobAmp = Math.max(0, bobAmp - dt * 8);
  }

  // Sprint FOV ease
  const targetFov = sprinting ? baseFov + 7 : baseFov;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }
}

function tickCamera(): void {
  const me = world.getEntity("player");
  if (!me) return;
  const bob = Math.sin(bobTime) * 0.045 * bobAmp;
  camera.position.set(
    me.transform.position.x,
    me.transform.position.y + EYE_HEIGHT + bob,
    me.transform.position.z,
  );
}

function findNearestInteractable(): { id: string; verb: string; d2: number; prototypeId: string } | null {
  const me = world.getEntity("player");
  if (!me) return null;
  let best: { id: string; verb: string; d2: number; prototypeId: string } | null = null;
  for (const e of world.allEntities()) {
    if (e.id === "player") continue;
    if (!e.components.interactable) continue;
    // Skip entities already in hand — those are dropped via the drop path.
    if (e.components.holder?.heldBy === "player") continue;
    const range = e.components.interactable.range ?? 3;
    const dx = e.transform.position.x - me.transform.position.x;
    const dz = e.transform.position.z - me.transform.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > range * range) continue;
    if (!best || d2 < best.d2) best = { id: e.id, verb: e.components.interactable.verb, d2, prototypeId: e.prototypeId };
  }
  return best;
}

/** The entity currently held by the player, if any. */
function findHeldByPlayer(): { id: string } | null {
  for (const e of world.allEntities()) {
    if (e.components.holder?.heldBy === "player") return { id: e.id };
  }
  return null;
}

/** A drop transform ~1.5m in front of the player, on the ground. */
function dropTransformInFront() {
  const me = world.getEntity("player");
  const pos = me?.transform.position ?? { x: 0, y: 0, z: 0 };
  pointer.getForwardXZ(fwdV);
  if (fwdV.lengthSq() === 0) fwdV.set(0, 0, -1);
  fwdV.normalize();
  const dx = pos.x + fwdV.x * 1.5;
  const dz = pos.z + fwdV.z * 1.5;
  return {
    position: { x: dx, y: groundY(dx, dz), z: dz },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

// ── Held item viewmodel ──────────────────────────────────────────────
let heldMesh: THREE.Object3D | null = null;
bus.events.on("EntityPickedUp", (e: any) => {
  if (e.holderId !== "player") return;
  const mesh = projection.meshFor(e.targetId) as unknown as THREE.Object3D | undefined;
  const ent = world.getEntity(e.targetId);
  if (mesh) {
    heldMesh = mesh;
    camera.add(mesh);
    mesh.position.set(0.42, -0.42, -0.8);
    mesh.rotation.set(0.15, -0.4, 0);
    mesh.scale.setScalar(0.6);
  }
  holdingLine.set(ent ? entityLabel(ent.prototypeId, ent.id) : e.targetId);
});
bus.events.on("EntityDropped", (e: any) => {
  if (e.holderId !== "player") return;
  const mesh = projection.meshFor(e.targetId) as unknown as THREE.Object3D | undefined;
  if (mesh) {
    scene.add(mesh);
    const t = e.transform;
    mesh.position.set(t.position.x, t.position.y, t.position.z);
    mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
    mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
  }
  heldMesh = null;
  holdingLine.set(null);
});

keyboard.on("interact", () => {
  // Dialogue open? E advances it.
  if (dialogue.isOpen()) {
    dialogue.say(dialogueContext());
    return;
  }

  // Holding something? Press E to drop it in front of you.
  const held = findHeldByPlayer();
  if (held) {
    bus.applyImmediate({
      kind: "DropEntity",
      targetId: held.id,
      holderId: "player",
      dropTransform: dropTransformInFront(),
    });
    return;
  }

  const target = findNearestInteractable();
  if (!target) {
    slashBar.showOutput("nothing in reach", 1500);
    return;
  }
  if (target.verb === "pickup") {
    bus.applyImmediate({ kind: "PickupEntity", targetId: target.id, holderId: "player" });
  } else if (target.verb === "use") {
    const e = world.getEntity(target.id)!;
    if (e.id === "worlds-gate") {
      worldsPanel.open();
    } else if (e.prototypeId === "doorway") {
      bus.applyImmediate({ kind: "EnterPortal", portalId: target.id, playerId: "player" });
    } else if (e.prototypeId === "workshop") {
      workshopPanel.open();
    } else {
      slashBar.showOutput(`used ${target.id}`, 1500);
    }
  } else if (target.verb === "talk") {
    const e = world.getEntity(target.id)!;
    dialogue.open({ id: e.id, prototypeId: e.prototypeId }, dialogueContext());
  }
});

// ── UI ────────────────────────────────────────────────────────────────
const slashBar = new SlashBar({
  inputEl: slashInputEl,
  containerEl: slashBarEl,
  outputEl: slashOutputEl,
  onExecute: async (cmd: string) => {
    try {
      const r = await slash.dispatch(cmd);
      return r.ok ? "ok" : (r.error || "command failed");
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
  onOpen: () => { keyboard.suspend(true); if (document.pointerLockElement) document.exitPointerLock(); },
  onClose: () => { keyboard.suspend(false); },
});

const helpOverlay = new HelpOverlay({
  containerEl: helpOverlayEl,
  bodyEl: helpBodyEl,
  closeBtnEl: helpCloseBtn,
});
try {
  const helpText = renderHelpText({ inputs, title: "Wander Around — Help" });
  if (helpText) helpOverlay.setContent(helpText);
} catch { /* fallback content stays */ }

const questPanel = new QuestPanel({
  containerEl: questPanelEl,
  listEl: questListEl,
  parentEl: hudRightEl,
  quests,
});
const workshopPanel = new WorkshopPanel({
  containerEl: workshopPanelEl,
  bodyEl: workshopBodyEl,
  parentEl: hudRightEl,
  workshop,
  library: creationLib,
  onSpawn: (creationId: string) => {
    const creation = creationLib.load(creationId);
    if (!creation) {
      slashBar.showOutput(`creation '${creationId}' not found`, 1800);
      return;
    }
    const me = world.getEntity("player");
    const here = me?.transform.position ?? { x: 0, y: 0, z: 0 };
    try {
      const id = spawnCreation(creation, bus, { x: here.x, y: groundY(here.x, here.z - 2), z: here.z - 2 });
      slashBar.showOutput(`spawned ${creation.name} as ${id}`, 1800);
    } catch (e) {
      slashBar.showOutput(`spawn failed: ${(e as Error).message}`, 2000);
    }
  },
  onSaveCreation: (id: string) => {
    slashBar.showOutput(`creation saved: ${id}`, 1800);
  },
  onModify: () => {
    // Simple modifier action: recolor the most recent bench part (or, if the
    // bench is empty, any non-player entity). Issues EditComponents → fires
    // ComponentsEdited, completing the q-edit-something quest.
    const parts = workshop.listParts();
    let targetId: string | undefined = parts.length ? parts[parts.length - 1].id : undefined;
    let meshTag = parts.length ? parts[parts.length - 1].meshTag : undefined;
    if (!targetId) {
      for (const e of world.allEntities()) {
        if (e.id === "player") continue;
        if (e.components.interactable?.immutable) continue;
        targetId = e.id;
        meshTag = e.components.renderable?.meshTag ?? e.prototypeId;
        break;
      }
    }
    if (!targetId) {
      slashBar.showOutput("nothing to modify yet — add a part first", 2000);
      return;
    }
    const tints = ["#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#9d7bd8"];
    const color = tints[Math.floor(Math.random() * tints.length)];
    bus.applyImmediate({
      kind: "EditComponents",
      id: targetId,
      patch: { renderable: { meshTag: meshTag ?? "rock", color } },
    });
    slashBar.showOutput(`tweaked ${targetId} → ${color}`, 1600);
  },
});

const tutorialOverlay = new TutorialOverlay({
  containerEl: tutorialOverlayEl,
  textEl: tutorialTextEl,
  nextBtnEl: tutorialNextBtn,
  tutorial,
});

// First-person affordances + dialogue + minimap
const crosshair = new Crosshair(hudEl);
const interactPrompt = new InteractPrompt(hudEl);
const holdingLine = new HoldingLine(hudEl);
const minimap = new Minimap(hudEl);

function dialogueContext() {
  const me = world.getEntity("player");
  const p = me?.transform.position ?? { x: 0, y: 0, z: 0 };
  return {
    biome: biomeAtWorld(p.x, p.z, world.seed),
    phase: sky.phaseName(),
    questHint: objectiveTitleEl.textContent || undefined,
    structures: nearbyStructures(p, 8) || undefined,
  };
}

/** What's been built around here — NPCs ground their talk in it. */
function nearbyStructures(p: { x: number; z: number }, max: number): string {
  const ARCH = new Set(["bridge", "column", "doorway", "workshop", "temple"]);
  const rows: { label: string; d: number }[] = [];
  for (const e of world.allEntities()) {
    if (!BUILDING_SPECS[e.prototypeId] && !ARCH.has(e.prototypeId)) continue;
    const dx = e.transform.position.x - p.x;
    const dz = e.transform.position.z - p.z;
    rows.push({ label: e.prototypeId, d: Math.sqrt(dx * dx + dz * dz) });
  }
  rows.sort((a, b) => a.d - b.d);
  const counts: Record<string, number> = {};
  const out: string[] = [];
  for (const r of rows.slice(0, max)) {
    counts[r.label] = (counts[r.label] ?? 0) + 1;
    out.push(counts[r.label] > 1 ? `another ${r.label}` : `a ${r.label} ${Math.round(r.d)}m away`);
  }
  return out.join(", ");
}

// Transient toast helper (mission rewards / objective advancement).
let _toastTimer: number | null = null;
function showToast(msg: string, ms: number = 2600): void {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden", "fade");
  if (_toastTimer !== null) clearTimeout(_toastTimer);
  _toastTimer = window.setTimeout(() => {
    toastEl.classList.add("fade");
    window.setTimeout(() => toastEl.classList.add("hidden"), 400);
  }, ms);
}

// ── Slash commands ───────────────────────────────────────────────────
const slash = new SlashDispatcher(bus);
slash.registerMany(defaultSlashCommands({
  saveSlot: async (name: string) => {
    bus.applyImmediate({ kind: "SaveWorld", slot: name });
  },
  loadSlot: async (_name: string) => {
    slashBar.showOutput("use /restore to load a snapshot (in-engine slot loads are server-side)", 2500);
  },
}));
// /style — restyle the live 3D world from a free description ("noir",
// "watercolor", "neon autumn", anything). Any words land somewhere visible.
slash.register({
  name: "style", args: ["description"],
  description: "Restyle the world — describe a look (noir, watercolor, neon, winter, toon, standard…)",
  handler: ({ rest }: any) => {
    const desc = (rest ?? "").trim();
    if (!desc) {
      slashBar.showOutput("describe a style — e.g. noir · watercolor · neon · autumn · winter · gloomy · vivid · toon · standard", 3000);
      return;
    }
    const label = visualStyles.swap(desc);
    slashBar.showOutput(`world restyled → ${label}`, 1800);
  },
});
// /sky — time of day
slash.register({
  name: "sky", args: ["phase"],
  description: "Set time of day (dawn|noon|sunset|night|cycle|pause)",
  handler: ({ tokens }: any) => {
    const t = (tokens[0] ?? "").toLowerCase();
    if (t === "pause") { sky.paused = true; slashBar.showOutput("sky: paused", 1400); return; }
    if (t === "cycle") { sky.paused = false; slashBar.showOutput("sky: cycling", 1400); return; }
    if (sky.setPreset(t)) {
      sky.paused = false;
      slashBar.showOutput(`sky → ${t}`, 1400);
    } else {
      slashBar.showOutput(`sky phases: ${Object.keys(PHASE_PRESETS).join(" · ")} · cycle · pause`, 2600);
    }
  },
});
// ── Placement: spoken builds find CLEAR, properly-seated ground ──────
// Footprint radius by what's being built — a castle needs more room (and
// more distance from the speaker) than a lantern.
const FOOTPRINT: Record<string, number> = {
  castle: 2.8, temple: 2.4, bridge: 2.2, grove: 2.4, house: 1.6,
  tower: 1.3, workshop: 1.2, column: 0.6, doorway: 1.0,
};

/** Seat a build on its whole footprint: the max terrain height across the
 *  pad keeps downhill edges from hanging in the air on slopes. */
function footprintY(x: number, z: number, r: number): number {
  let y = groundY(x, z);
  for (let a = 0; a < 4; a++) {
    y = Math.max(y, groundY(x + r * Math.cos(a * Math.PI / 2 + Math.PI / 4),
                            z + r * Math.sin(a * Math.PI / 2 + Math.PI / 4)));
  }
  return y;
}

/** Would a pad at (x,z) overlap anything that claims ground? Enterable
 *  buildings are solid:false but still claim their spec footprint. */
function spotBlocked(x: number, z: number, footprint: number): boolean {
  for (const e of world.allEntities()) {
    if (e.id === "player") continue;
    const spec = BUILDING_SPECS[e.prototypeId];
    const col = e.components.collider;
    let theirHalf: number;
    if (spec) theirHalf = spec.footprint;
    else if (col?.solid) theirHalf = Math.max(col.size?.x ?? 0.5, col.size?.z ?? 0.5) * 0.6;
    else continue;
    const ex = e.transform.position.x - x;
    const ez = e.transform.position.z - z;
    const need = footprint + theirHalf;
    if (ex * ex + ez * ez < need * need) return true;
  }
  return false;
}

/** Find a clear spot for a footprint along the look direction: fan out in
 *  distance and angle until nothing solid overlaps the pad and the ground
 *  is dry. Falls back to the far end of the fan if everything is busy. */
function findBuildSpot(footprint: number): { x: number; y: number; z: number } {
  const me = world.getEntity("player");
  const here = me?.transform.position ?? { x: 0, y: 0, z: 0 };
  pointer.getForwardXZ(fwdV);
  if (fwdV.lengthSq() === 0) fwdV.set(0, 0, -1);
  const baseYaw = Math.atan2(fwdV.x, fwdV.z);
  const baseDist = 4 + footprint * 2;
  let fallback: { x: number; z: number } | null = null;
  for (const dd of [0, 2.5, 5, 7.5]) {
    for (const da of [0, 0.3, -0.3, 0.6, -0.6]) {
      const yaw = baseYaw + da;
      const d = baseDist + dd;
      const x = here.x + Math.sin(yaw) * d;
      const z = here.z + Math.cos(yaw) * d;
      if (groundY(x, z) <= -0.25) continue;            // not in the lake
      fallback = fallback ?? { x, z };
      if (!spotBlocked(x, z, footprint)) return { x, y: footprintY(x, z, footprint), z };
    }
  }
  const f = fallback ?? { x: here.x + fwdV.x * baseDist, z: here.z + fwdV.z * baseDist };
  return { x: f.x, y: footprintY(f.x, f.z, footprint), z: f.z };
}

// /spawn from prompt — lands in front of where you're looking, on clear
// ground, seated on its whole footprint.
slash.register({
  name: "spawn", args: ["prompt"],
  description: "Spawn an entity via prompt",
  handler: ({ rest }: any) => {
    const d = decomposePrompt(rest);
    const footprint = BUILDING_SPECS[d.primary]?.footprint ?? FOOTPRINT[d.primary] ?? 0.7;
    const meshTag = d.materials[0] ? `${d.primary}_${d.materials[0]}` : d.primary;
    placement.enter(rest, builderReg.has(meshTag) ? meshTag : d.primary, footprint);
    showToast("blueprint in hand — click to place, right-click to cancel", 3200);
  },
});
// /mint → open the in-game ensouled-agent minting panel.
slash.register({
  name: "mint", args: [],
  description: "Mint your own ensouled agent into the world",
  handler: () => { mintPanel.open(); },
});
// /worlds → step into EnsouledWorld or the other Wander worlds
slash.register({
  name: "worlds", args: [],
  description: "Step into EnsouledWorld or the other Wander worlds",
  handler: () => { worldsPanel.open(); },
});
// /backup → exports world snapshot to console (Electron will hook file save later)
slash.register({
  name: "backup", args: [],
  description: "Export world snapshot",
  handler: () => {
    const snap = exportSnapshot(world);
    console.log("[backup]", snap);
    const count = (snap as any).entities ? Object.keys((snap as any).entities).length
                : (snap as any).entityCount ?? "?";
    slashBar.showOutput(`backup ready (${count} entities) — logged to console`, 2500);
  },
});

// Mission chain — "Wanderer's First World" ordered arc + on-screen objective.
let _rewardGranted = false;
const missionBanner = new MissionBanner({
  quests,
  events: bus.events,
  bannerEl: objectiveBannerEl,
  titleEl: objectiveTitleEl,
  hintEl: objectiveHintEl,
  progressEl: objectiveProgressEl,
  toast: showToast,
  onArcComplete: () => {
    if (_rewardGranted) return;
    _rewardGranted = true;
    // Reward: unlock a new spawnable — the "/conjure" command spawns a golden
    // crystal tower the player couldn't make before, plus a completion toast.
    slash.register({
      name: "conjure", args: [],
      description: "Conjure a golden tower (reward — unlocked by finishing your first world)",
      handler: ({ bus }: any) => {
        const spot = findBuildSpot(FOOTPRINT.tower);
        bus.applyImmediate({
          kind: "SpawnEntity",
          id: `conjured-${Date.now().toString(36)}`,
          prototypeId: "tower",
          transform: { ...identityTransform(), position: spot },
          components: {
            renderable: { meshTag: "tower_gold" },
            collider: { shape: "box", size: { x: 2, y: 9, z: 2 }, solid: true },
            saveable: { persistent: true },
          },
          sephirah: "tiferet",
        });
      },
    });
    showToast("Reward unlocked: /conjure — summon a golden tower", 5000);
  },
});

keyboard.on("open_slash", () => slashBar.open("/"));
keyboard.on("toggle_help", () => helpOverlay.toggle());
keyboard.on("toggle_quests", () => questPanel.toggle());
keyboard.on("toggle_workshop", () => workshopPanel.toggle());
keyboard.on("toggle_map", () => minimap.toggle());
keyboard.on("toggle_perf", () => {
  applyQuality(currentQuality === "high" ? QUALITY_LOW : QUALITY_HIGH);
  slashBar.showOutput(`quality → ${currentQuality}`, 1500);
});
keyboard.on("exit", () => {
  if (mintPanel.isOpen()) mintPanel.close();
  else if (worldsPanel.isOpen()) worldsPanel.close();
  else if (placement.active) { placement.exit(); slashBar.showOutput("placement cancelled", 1400); }
  else if (dialogue.isOpen()) dialogue.close();
  else if (slashBar.isOpen()) slashBar.close();
  else if (helpOverlay.isOpen()) helpOverlay.close();
});

// Click to set the blueprint down. The first canvas click only re-acquires
// pointer lock (no lock element yet at mousedown), so it can't misfire.
function confirmPlacement(force: boolean = false): boolean {
  if (!placement.active) return false;
  const cur = placement.current();
  if (!cur.valid && !force) { slashBar.showOutput("blocked — aim at clear, dry ground", 1600); return false; }
  const prompt = placement.prompt;
  placement.exit();
  const cmd = promptToSpawnCommand(prompt, { x: cur.x, y: cur.y, z: cur.z });
  if (cmd) { bus.submit(cmd); bus.flush(); }
  return !!cmd;
}
canvas.addEventListener("mousedown", (ev) => {
  if (!placement.active || !document.pointerLockElement) return;
  if (ev.button === 0) confirmPlacement();
  else if (ev.button === 2) { placement.exit(); slashBar.showOutput("placement cancelled", 1400); }
});
canvas.addEventListener("contextmenu", (ev) => { if (placement.active) ev.preventDefault(); });
btnHelp.addEventListener("click", () => helpOverlay.toggle());
btnQuests.addEventListener("click", () => questPanel.toggle());
btnWorkshop.addEventListener("click", () => workshopPanel.toggle());
btnMap.addEventListener("click", () => minimap.toggle());

// ── FPS guardrail — quality presets that actually apply ──────────────
let currentQuality: "high" | "low" = "high";
function applyQuality(q: QualityConfig): void {
  renderer.setPixelRatio(window.devicePixelRatio * q.pixelRatio);
  renderer.shadowMap.enabled = q.shadowsEnabled;
  sky.sun.castShadow = q.shadowsEnabled;
  biome.setRadius(Math.min(q.biomeRadiusChunks, 3));
  terrain.setRadius(Math.min(q.biomeRadiusChunks + 1, 4));
  currentQuality = q.pixelRatio < 1 ? "low" : "high";
  // Force material refresh for the shadow toggle
  scene.traverse((o: any) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
}
const fpsGuardrail = new FPSGuardrail({
  applyQuality,
  promptUser: async (fps: number) => {
    showToast(`fps ${fps.toFixed(0)} — switching to performance mode`, 3200);
    return "low";
  },
  now: () => performance.now(),
});
btnPerf.addEventListener("click", () => {
  applyQuality(currentQuality === "high" ? QUALITY_LOW : QUALITY_HIGH);
  slashBar.showOutput(`quality → ${currentQuality}`, 1500);
});

// ── Oracle (optional) ────────────────────────────────────────────────
const hash = window.location.hash || "";
const oracleEndpoint = hash.includes("oracle=")
  ? "http://" + decodeURIComponent(hash.split("oracle=")[1])
  : "http://127.0.0.1:8765";
const oracle = new FrontendOracle({ endpoint: oracleEndpoint });
const dialogue = new DialogueBox(hudEl, oracle);
// Typing to an NPC must not walk the player around.
dialogue.onFocusChange = (typing: boolean) => keyboard.suspend(typing);
// Downloaded clients have no local holon; fall back to the public substrate
// route so NPCs still speak from the live model (override via #agentbase=).
dialogue.agentChatBase = hash.includes("agentbase=")
  ? "https://" + decodeURIComponent(hash.split("agentbase=")[1].split("&")[0])
  : "https://wanderaround.io";

// ── In-game ensouled-agent minting ───────────────────────────────────
// Each archetype gets the closest existing NPC body so the minted agent has
// a face the moment it walks in.
const ARCHETYPE_MESH: Record<string, string> = {
  apollo: "wizard_npc", athena: "scholar_npc", hermes: "merchant_npc",
  iris: "merchant_npc", themis: "scholar_npc", persephone: "wizard_npc",
  ares: "guard_npc", artemis: "guard_npc", hephaestus: "merchant_npc",
  demeter: "scholar_npc", dionysus: "merchant_npc", hestia: "guard_npc",
};
let _mintedCount = 0;
const mintBase = hash.includes("mint=")
  ? "https://" + decodeURIComponent(hash.split("mint=")[1].split("&")[0])
  : "https://ensouledagents.com/api";
const mintPanel = new MintPanel({
  parent: hudEl,
  ensouledBase: mintBase,
  onFocusChange: (typing: boolean) => keyboard.suspend(typing),
  onMinted: ({ name, archetype }) => {
    const proto = ARCHETYPE_MESH[archetype] ?? "scholar_npc";
    const spot = findBuildSpot(0.8);
    const id = `ensouled-${name}-${(_mintedCount++).toString(36)}`;
    bus.applyImmediate({
      kind: "SpawnEntity", id, prototypeId: proto,
      transform: { ...identityTransform(), position: spot },
      components: {
        renderable: { meshTag: proto },
        ai: { policy: "wander", perceptionRadius: 8, state: {} },
        collider: { shape: "capsule", size: { x: 0.5, y: 1.8, z: 0.5 }, solid: true },
        interactable: { verb: "talk", range: 3.5 },
        saveable: { persistent: true },
      },
      sephirah: "malkuth",
    });
    setEntityLabel(id, name);
    // The bus's spawn handler auto-pops eligible new entities (this NPC qualifies).
    showToast(`${name} has joined your world — and is being born into EnsouledWorld. press /worlds to watch.`, 6000);
  },
});

// The Worlds panel — doorways into EnsouledWorld + the other Wander surfaces.
const worldsPanel = new WorldsPanel({ parent: hudEl, onFocusChange: (typing: boolean) => keyboard.suspend(typing) });

// Probe with retries — the game often boots before the Oracle (or its
// tunnel) is reachable, and a single missed probe used to stick the session
// in offline mode until reload.
function probeOracle(attempt: number = 0): void {
  oracle.probe().then((res) => {
    if (res.ok) {
      oracleEl.textContent = `oracle: online (step ${res.step ?? "?"})`;
      // Swap the wizard's policy from adaptive to substrate-aware
      agents.unregister?.("wizard");
      agents.register({
        id: "wizard", agency: "machine", perceptionRadius: 12,
        cognition: substrateAgentCognitionOp(oracle.client),
      });
    } else {
      oracleEl.textContent = "oracle: offline (substrate-only)";
      if (attempt < 5) setTimeout(() => probeOracle(attempt + 1), 3000 * (attempt + 1));
    }
  });
}
probeOracle();

// ── Scheduler — multi-rate ticks for engine systems ──────────────────
scheduler.register({
  name: "agents-cognition",
  every: 6,  // 10 Hz at 60Hz tick
  system: () => {
    agents.tickMachineAgents(world, bus, world.tick);
    bus.flush();
  },
});
scheduler.register({
  name: "portal-proximity",
  every: 2,
  system: () => { portalProximity.tick(world, "player", bus); bus.flush(); },
});
scheduler.register({
  name: "biome-streaming",
  every: 20,
  system: () => {
    const p = world.getEntity("player");
    if (p) biome.tick(world, bus, p.transform.position);
  },
});
scheduler.register({
  name: "npc-terrain-snap",
  every: 10,
  system: () => {
    // Wandering NPCs keep their feet on the terrain field.
    for (const e of world.allEntities()) {
      if (!e.components.ai && !e.prototypeId.endsWith("_npc")) continue;
      if (e.components.holder) continue;
      const gy = groundY(e.transform.position.x, e.transform.position.z);
      if (Math.abs(e.transform.position.y - gy) > 0.05) {
        bus.applyImmediate({
          kind: "MoveEntity", id: e.id,
          transform: { position: { x: e.transform.position.x, y: gy, z: e.transform.position.z } },
        });
      }
    }
  },
});
scheduler.register({
  name: "quest-panel-refresh",
  every: 30,
  system: () => { if (questPanel.isOpen()) questPanel.refresh(); },
});

// ── Animation loop ───────────────────────────────────────────────────
let last = performance.now();
let frames = 0; let acc = 0;
let frameCount = 0;

function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frameCount++;

  tickPlayer(dt);
  scheduler.stepN(1);
  tickCamera();

  const me = world.getEntity("player");
  const p = me?.transform.position ?? { x: 0, y: 0, z: 0 };

  // Blueprint ghost follows the look ray, snapped to the grid, every frame.
  if (placement.active) {
    pointer.getForwardXZ(fwdV);
    if (fwdV.lengthSq() === 0) fwdV.set(0, 0, -1);
    const dist = 4 + placement.footprint * 1.6;
    const cx = placement.snap(p.x + fwdV.x * dist);
    const cz = placement.snap(p.z + fwdV.z * dist);
    const dry = groundY(cx, cz) > -0.25;
    const cy = footprintY(cx, cz, placement.footprint);
    placement.update(cx, cy, cz, dry && !spotBlocked(cx, cz, placement.footprint));
  }

  sky.tick(dt, p.x, p.y, p.z);
  spawnFx.tick(dt);
  terrain.tickWater(now / 1000);
  if (frameCount % 12 === 0) terrain.update(p.x, p.z);

  // Interact prompt + crosshair heat
  if (frameCount % 6 === 0) {
    if (placement.active) {
      interactPrompt.set(placement.valid ? "click to place" : "blocked — aim at clear ground");
      crosshair.setHot(placement.valid);
    } else if (dialogue.isOpen()) {
      // Close the dialogue if the player walked away from the NPC
      const npcId = dialogue.npcId();
      const npc = npcId ? world.getEntity(npcId) : null;
      if (!npc) dialogue.close();
      else {
        const dx = npc.transform.position.x - p.x;
        const dz = npc.transform.position.z - p.z;
        if (dx * dx + dz * dz > 30) dialogue.close();
      }
      interactPrompt.set(null);
      crosshair.setHot(false);
    } else {
      const held = findHeldByPlayer();
      if (held) {
        interactPrompt.set(null);
        crosshair.setHot(false);
      } else {
        const target = findNearestInteractable();
        if (target) {
          const label = entityLabel(target.prototypeId, target.id);
          const verbText = target.verb === "pickup" ? `pick up ${label}`
                        : target.verb === "talk" ? `talk to ${label}`
                        : target.verb === "use" && target.prototypeId === "doorway" ? `enter ${label}`
                        : target.verb === "use" ? `use ${label}`
                        : `${target.verb} ${label}`;
          interactPrompt.set(verbText);
          crosshair.setHot(true);
        } else {
          interactPrompt.set(null);
          crosshair.setHot(false);
        }
      }
    }
  }

  if (frameCount % 9 === 0) {
    minimap.draw(world, p.x, p.z, pointer.getYaw());
  }

  fpsGuardrail.tick();
  renderer.render(scene, camera);

  frames++; acc += dt;
  if (acc >= 0.5) {
    fpsEl.textContent = `fps ${(frames / acc).toFixed(0)}  ·  tick ${world.tick}  ·  entities ${world.entityCount()}`;
    frames = 0; acc = 0;
    const b = biomeAtWorld(p.x, p.z, world.seed);
    styleEl.textContent = `${b} · ${sky.phaseName()} · style ${visualStyles.currentStyle()}`;
  }

  requestAnimationFrame(loop);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Boot ─────────────────────────────────────────────────────────────
titleStart.addEventListener("click", () => {
  titleOverlay.classList.add("hidden");
  audio.init();
  // Face the player toward the hub vista (sword + wizard + portal beacon)
  pointer.setYaw(-1.05);
  try {
    tutorial.start({ force: false, playerPosition: { x: 0, y: groundY(0, 0), z: 0 } });
    tutorialOverlay.start();
  } catch {}
  // Attach quests AFTER the hub furniture and the tutorial companion have
  // spawned, so only the player's own actions complete quests. Then show the
  // mission objective (all steps start incomplete).
  quests.attach(bus.events);
  try { missionBanner.start(); } catch {}
  fxArmed = true;   // from here on, new builds arrive with the pop + ring
  fpsGuardrail.init();
  canvas.click();
  requestAnimationFrame(loop);
});

(window as any).__wander = {
  world, bus, scheduler, agents, quests, workshop, slash, audio, oracle,
  renderer, scene, camera, projection, fpsGuardrail, styleMgr, visualStyles,
  missionBanner, tutorial, tutorialOverlay, sky, terrain, minimap, dialogue,
  pointer, slashBar, collideMove, placement, confirmPlacement,
};

console.log("Wander Around frontend ready. Click 'enter' on the title screen to start.");
