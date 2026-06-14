// Feature: Walk-through portals.
//
// World-intent prompts spawn doorway entities. Per-frame proximity check
// triggers EnterPortal command when player walks within radius (no keypress,
// per v7.2 audit's #1 user-flagged bug — portals are walk-through).
//
// Two portal types via components.interactable.verb:
//   - "use" + immutable=true + portal_world spec → substrate world transit
//   - "use" + immutable=true + portal_url → external page transit (HTML overlay)

import { type SpawnEntityCommand, type EnterPortalCommand } from "../../cmd/types.js";
import { type EntityRecord, type EntityId, identityTransform } from "../../entity/types.js";
import { CommandBus } from "../../cmd/bus.js";
import { World } from "../../world/world.js";

const PORTAL_PROTOTYPE = "doorway";
const PORTAL_ENTER_RADIUS = 2.2;
const PORTAL_COOLDOWN_MS = 1500;

let _portalIdCounter = 1;
function nextPortalId(): string { return `doorway-${(_portalIdCounter++).toString(36)}`; }

export interface PortalSpec {
  label: string;
  /** Either a world-spec object for substrate transit, or a URL for external. */
  destination: { kind: "substrate"; worldId: string } | { kind: "external"; url: string };
  palette?: string;
}

export function spawnPortalCommand(spec: PortalSpec, position: { x: number; y: number; z: number }): SpawnEntityCommand {
  return {
    kind: "SpawnEntity",
    id: nextPortalId(),
    prototypeId: PORTAL_PROTOTYPE,
    transform: { ...identityTransform(), position: { ...position } },
    components: {
      renderable: { meshTag: spec.destination.kind === "external" ? "doorway_external" : "doorway_substrate" },
      interactable: { verb: "use", range: PORTAL_ENTER_RADIUS, immutable: true },
      saveable: { persistent: true },
    },
    sephirah: "yesod",
  };
}

interface PortalCooldown {
  [portalId: string]: number;  // performance.now() timestamp
}

export class PortalProximitySystem {
  private cooldowns: PortalCooldown = {};
  private now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (typeof performance !== "undefined" ? () => performance.now() : () => Date.now());
  }

  /** Call each frame. Detects player within ENTER_RADIUS of a portal and
   *  submits EnterPortal commands (subject to cooldown). Returns the number
   *  of commands submitted this frame. */
  tick(world: World, playerId: EntityId, bus: CommandBus): number {
    const player = world.getEntity(playerId);
    if (!player) return 0;
    const pp = player.transform.position;
    let submitted = 0;
    for (const entity of world.entitiesInRadius(pp, PORTAL_ENTER_RADIUS)) {
      if (entity.prototypeId !== PORTAL_PROTOTYPE) continue;
      if (entity.id === playerId) continue;
      const t = this.now();
      const last = this.cooldowns[entity.id];
      if (last !== undefined && t - last < PORTAL_COOLDOWN_MS) continue;
      this.cooldowns[entity.id] = t;
      const cmd: EnterPortalCommand = {
        kind: "EnterPortal",
        portalId: entity.id,
        playerId,
      };
      bus.submit(cmd);
      submitted++;
    }
    return submitted;
  }

  /** Diagnostics: how many portals does the player currently have on cooldown? */
  cooldownCount(): number {
    return Object.keys(this.cooldowns).length;
  }

  /** Clear cooldowns — useful after world transit. */
  reset(): void {
    this.cooldowns = {};
  }
}

/** Helper: find the nearest portal to a position (without consuming it). */
export function findNearestPortal(
  world: World,
  pos: { x: number; y: number; z: number },
  maxRadius: number = 6.0,
): EntityRecord | null {
  let best: EntityRecord | null = null;
  let bestD = Infinity;
  for (const e of world.entitiesInRadius(pos, maxRadius)) {
    if (e.prototypeId !== PORTAL_PROTOTYPE) continue;
    const dx = e.transform.position.x - pos.x;
    const dy = e.transform.position.y - pos.y;
    const dz = e.transform.position.z - pos.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

export { PORTAL_ENTER_RADIUS, PORTAL_COOLDOWN_MS, PORTAL_PROTOTYPE };
