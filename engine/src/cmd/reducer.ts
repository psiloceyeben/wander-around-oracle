// The reducer. Takes a command + world, mutates the world, returns events.
// Pure-but-mutating: same input world state + same command produces the
// same output world state and event list. This is the determinism guarantee
// that makes save/load and multiplayer reconciliation correct.

import { type Command, type GameEvent } from "./types.js";
import { World } from "../world/index.js";
import { type EntityRecord, identityTransform } from "../entity/types.js";

function rejection(world: World, cmd: Command, reason: string): GameEvent[] {
  return [{ kind: "CommandRejected", tick: world.tick, command: cmd, reason }];
}

export function defaultReducer(world: World, cmd: Command): GameEvent[] {
  const tick = world.tick;
  switch (cmd.kind) {
    case "SpawnEntity": {
      if (world.getEntity(cmd.id)) {
        return rejection(world, cmd, `entity ${cmd.id} already exists`);
      }
      const record: EntityRecord = {
        id: cmd.id,
        prototypeId: cmd.prototypeId,
        transform: cmd.transform,
        components: cmd.components,
        sephirah: cmd.sephirah,
      };
      world.addEntity(record);
      return [{ kind: "EntitySpawned", tick, entity: record }];
    }

    case "RemoveEntity": {
      const removed = world.removeEntity(cmd.id);
      if (!removed) return rejection(world, cmd, `no entity ${cmd.id}`);
      return [{ kind: "EntityRemoved", tick, id: cmd.id, prototypeId: removed.prototypeId }];
    }

    case "MoveEntity": {
      const before = world.getEntity(cmd.id);
      if (!before) return rejection(world, cmd, `no entity ${cmd.id}`);
      const fromTransform = JSON.parse(JSON.stringify(before.transform));
      const updated = world.updateEntity(cmd.id, (r) => {
        if (cmd.transform.position) r.transform.position = { ...r.transform.position, ...cmd.transform.position };
        if (cmd.transform.rotation) r.transform.rotation = { ...r.transform.rotation, ...cmd.transform.rotation };
        if (cmd.transform.scale)    r.transform.scale    = { ...r.transform.scale,    ...cmd.transform.scale };
      });
      if (!updated) return rejection(world, cmd, `update failed for ${cmd.id}`);
      return [{ kind: "EntityMoved", tick, id: cmd.id, from: fromTransform, to: updated.transform }];
    }

    case "PickupEntity": {
      const target = world.getEntity(cmd.targetId);
      const holder = world.getEntity(cmd.holderId);
      if (!target) return rejection(world, cmd, `no target ${cmd.targetId}`);
      if (!holder) return rejection(world, cmd, `no holder ${cmd.holderId}`);
      if (target.components.interactable?.immutable) {
        return rejection(world, cmd, `${cmd.targetId} is immutable`);
      }
      if (target.components.holder) {
        return rejection(world, cmd, `${cmd.targetId} already held by ${target.components.holder.heldBy}`);
      }
      world.updateEntity(cmd.targetId, (r) => {
        r.components.holder = { heldBy: cmd.holderId };
      });
      return [{ kind: "EntityPickedUp", tick, targetId: cmd.targetId, holderId: cmd.holderId }];
    }

    case "DropEntity": {
      const target = world.getEntity(cmd.targetId);
      if (!target) return rejection(world, cmd, `no target ${cmd.targetId}`);
      if (target.components.holder?.heldBy !== cmd.holderId) {
        return rejection(world, cmd, `${cmd.targetId} not held by ${cmd.holderId}`);
      }
      world.updateEntity(cmd.targetId, (r) => {
        delete r.components.holder;
        r.transform = cmd.dropTransform;
      });
      return [{
        kind: "EntityDropped", tick,
        targetId: cmd.targetId, holderId: cmd.holderId,
        transform: cmd.dropTransform,
      }];
    }

    case "EditComponents": {
      const target = world.getEntity(cmd.id);
      if (!target) return rejection(world, cmd, `no entity ${cmd.id}`);
      world.updateEntity(cmd.id, (r) => {
        for (const [key, val] of Object.entries(cmd.patch)) {
          if (val === undefined) delete (r.components as any)[key];
          else (r.components as any)[key] = val;
        }
      });
      return [{ kind: "ComponentsEdited", tick, id: cmd.id, patch: cmd.patch }];
    }

    case "EnterPortal": {
      const portal = world.getEntity(cmd.portalId);
      const player = world.getEntity(cmd.playerId);
      if (!portal) return rejection(world, cmd, `no portal ${cmd.portalId}`);
      if (!player) return rejection(world, cmd, `no player ${cmd.playerId}`);
      // Portal-entry is observed; the actual world-transit happens in Layer 9
      // (multi-world) and is dispatched on this event.
      return [{ kind: "PortalEntered", tick, portalId: cmd.portalId, playerId: cmd.playerId }];
    }

    case "SaveWorld":
      // Persistence is handled by a system that listens for this event;
      // the reducer just announces.
      return [{ kind: "WorldSaved", tick, slot: cmd.slot }];

    case "LoadWorld":
      // Load is handled outside the reducer (it constructs a fresh world).
      return [{ kind: "WorldLoaded", tick, slot: cmd.slot }];

    case "SetTimeOfDay":
      return [{ kind: "TimeChanged", tick, hours: cmd.hours }];
  }
}

// Re-export for callers
export { identityTransform };
