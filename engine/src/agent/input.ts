// Input mapping for human agents.
//
// The input layer translates raw input events (key down/up, gamepad,
// VR controller, voice transcription) into Commands submitted to the
// CommandBus. The mapping is configurable so the same engine handles
// desktop, VR, and voice control through different input adapters.

import { type EntityId } from "../entity/types.js";
import { type Command } from "../cmd/index.js";

/** Movement intent in agent-local coordinates. */
export interface MoveIntent {
  forward: number;  // -1..1
  right:   number;
  up:      number;
}

/** Translate a movement intent into a MoveEntity command relative to the
 *  agent's current position. Velocity is meters per tick. */
export function intentToMoveCommand(
  agentId: EntityId,
  intent: MoveIntent,
  currentPos: { x: number; y: number; z: number },
  facing: { yaw: number },  // radians around Y
  velocityPerTick: number = 0.2,
): Command | null {
  if (intent.forward === 0 && intent.right === 0 && intent.up === 0) return null;
  // Project agent-local intent into world axes using facing yaw
  const cos = Math.cos(facing.yaw);
  const sin = Math.sin(facing.yaw);
  const fwdX = -sin * intent.forward;
  const fwdZ = -cos * intent.forward;
  const rgtX =  cos * intent.right;
  const rgtZ = -sin * intent.right;
  const dx = (fwdX + rgtX) * velocityPerTick;
  const dz = (fwdZ + rgtZ) * velocityPerTick;
  const dy = intent.up * velocityPerTick;
  return {
    kind: "MoveEntity",
    id: agentId,
    transform: {
      position: { x: currentPos.x + dx, y: currentPos.y + dy, z: currentPos.z + dz },
    },
  };
}

/** Interaction intent: the player aimed at something and triggered a verb. */
export function interactCommand(
  agentId: EntityId,
  targetId: EntityId,
  verb: "pickup" | "drop" | "use" | "open" | "talk",
  dropTransform?: { x: number; y: number; z: number },
): Command | null {
  switch (verb) {
    case "pickup":
      return { kind: "PickupEntity", targetId, holderId: agentId };
    case "drop":
      if (!dropTransform) return null;
      return {
        kind: "DropEntity",
        targetId,
        holderId: agentId,
        dropTransform: {
          position: { x: dropTransform.x, y: dropTransform.y, z: dropTransform.z },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale:    { x: 1, y: 1, z: 1 },
        },
      };
    case "use":
    case "open":
    case "talk":
      // These are observation events — could spawn dialog UI etc. For Layer 6
      // we route them as EnterPortal-shaped probes; specific reducers can
      // distinguish later. Here we no-op to keep the layer clean.
      return null;
  }
}
