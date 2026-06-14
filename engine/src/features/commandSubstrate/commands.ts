// CommandSubstrate — emit commands as substrate cleanup operations.
//
// The 125M (and any current-generation model) cannot emit structured
// commands as text continuations (T3 failed 0%). This module bypasses
// the text-emission requirement entirely by composing commands as HRR
// vectors and cleanup-classifying them against a fixed command dictionary.
//
// Architecture:
//   1. Build intent vector: bind(routing_vec, perception_vec)
//      The routing vector is composed from the model's Sephirah probability
//      distribution. The perception vector is the rich situational HRR
//      encoding from PerceptionSubstrate.
//   2. Cleanup against the command dictionary: each command prototype is a
//      fixed HRR vector with declared Sephirah affinities. The cleanup
//      returns the best-matching command verb.
//   3. Resolve target via substrate query on the perception result —
//      affordance-aware (PICKUP only fires if pickup-interactable visible,
//      ENTER_PORTAL only fires if portal visible, etc.).
//
// Scale-invariant: HRR ops + small fixed-size dictionary. The 125M and
// the v6 2B feed the same routing distribution into the same module and
// get back the same command shape. Cleaner v3 250M routing produces more
// situationally appropriate commands; the module doesn't need to change.

import { type HRRVec, zeroVec } from "../../hrr/types.js";
import { addInto, bind, cosine, normalize, magnitude } from "../../hrr/core.js";
import { seedVec, roleVec } from "../../hrr/seed.js";
import { sephirahVec, type Sephirah, SEPHIROTH } from "../../hrr/treeOfLife.js";
import { type Command } from "../../cmd/types.js";
import { type EntityId } from "../../entity/types.js";
import { World } from "../../world/world.js";
import { type PerceptionResult } from "../perceptionSubstrate/perception.js";
import { promptToSpawnCommand } from "../recipes/index.js";
import { hrrSelectByAffordance, hrrSelectAnyVisible } from "./hrrTargetSelect.js";

export type CommandVerb =
  | "PICKUP" | "DROP" | "MOVE" | "SPAWN" | "SAVE" | "ENTER_PORTAL" | "INSPECT"
  | "TALK" | "GIVE" | "USE" | "REST"
  | "NONE";

interface CommandPrototype {
  verb: CommandVerb;
  vec: HRRVec;
  /** Sephirot whose routing should boost this command's score. */
  sephirahAffinity: Sephirah[];
  /** Bonus weight per affinity Sephirah. */
  affinityWeight: number;
  /** Requires a targetable entity in perception. */
  needsTarget: boolean;
  /** Required affordance verb on the target, if any. */
  affordance?: "pickup" | "use" | "talk" | "open";
}

// Pre-computed command prototype HRR vectors — fixed, never trained
const _verbBase = (verb: CommandVerb): HRRVec => seedVec(`command_verb:${verb}`);

// Affinity weight tuning principles:
//   • Verbs with UNIQUE affordances (PICKUP/pickup, ENTER_PORTAL/use+doorway,
//     TALK/talk) get higher weights — they should dominate when their
//     affordance is uniquely present.
//   • Verbs with GENERIC affordances (INSPECT/any-visible, USE/use)
//     get lower weights — they should be fallbacks, not dominate when
//     a more specific verb is available.
//   • ENTER_PORTAL > USE so doorways route through portal-entry rather
//     than the generic USE handler when both compete.
export const COMMAND_DICTIONARY: ReadonlyArray<CommandPrototype> = [
  {
    verb: "PICKUP", vec: _verbBase("PICKUP"),
    sephirahAffinity: ["malkuth"], affinityWeight: 0.75,  // ↑ unique affordance
    needsTarget: true, affordance: "pickup",
  },
  {
    verb: "DROP", vec: _verbBase("DROP"),
    sephirahAffinity: ["malkuth"], affinityWeight: 0.5,
    needsTarget: false,
  },
  {
    verb: "MOVE", vec: _verbBase("MOVE"),
    sephirahAffinity: ["netzach", "hod"], affinityWeight: 0.3,
    needsTarget: false,
  },
  {
    verb: "SPAWN", vec: _verbBase("SPAWN"),
    sephirahAffinity: ["tiferet", "chokmah"], affinityWeight: 0.5,
    needsTarget: false,
  },
  {
    verb: "SAVE", vec: _verbBase("SAVE"),
    sephirahAffinity: ["yesod"], affinityWeight: 0.6,
    needsTarget: false,
  },
  {
    verb: "ENTER_PORTAL", vec: _verbBase("ENTER_PORTAL"),
    sephirahAffinity: ["yesod", "keter"], affinityWeight: 0.85,  // ↑↑ beats USE on doorways
    needsTarget: true, affordance: "use",
  },
  {
    verb: "INSPECT", vec: _verbBase("INSPECT"),
    sephirahAffinity: ["chesed", "binah"], affinityWeight: 0.25,  // ↓ fallback
    needsTarget: true,
  },
  {
    verb: "TALK", vec: _verbBase("TALK"),
    sephirahAffinity: ["chesed", "binah", "tiferet"], affinityWeight: 0.65,  // ↑ unique
    needsTarget: true, affordance: "talk",
  },
  {
    verb: "GIVE", vec: _verbBase("GIVE"),
    sephirahAffinity: ["chesed", "tiferet"], affinityWeight: 0.55,
    needsTarget: true, affordance: "talk",
  },
  {
    verb: "USE", vec: _verbBase("USE"),
    sephirahAffinity: ["geburah", "malkuth"], affinityWeight: 0.35,  // ↓ generic
    needsTarget: true, affordance: "use",
  },
  {
    verb: "REST", vec: _verbBase("REST"),
    sephirahAffinity: ["binah", "keter"], affinityWeight: 0.25,
    needsTarget: false,
  },
  {
    verb: "NONE", vec: _verbBase("NONE"),
    sephirahAffinity: ["keter"], affinityWeight: 0.1,
    needsTarget: false,
  },
];

const _roles = {
  intent:  roleVec("command:intent"),
  context: roleVec("command:context"),
};

/** Build an HRR vector representing the model's routing decision —
 *  weighted superposition of Sephirah vectors. */
export function composeRoutingVector(routing: Partial<Record<Sephirah, number>>): HRRVec {
  const out = zeroVec();
  for (const s of SEPHIROTH) {
    const p = routing[s] ?? 0;
    if (p <= 0) continue;
    const v = sephirahVec(s);
    const r = out.real;
    const i = out.imag;
    for (let k = 0; k < v.real.length; k++) {
      r[k] += p * v.real[k];
      i[k] += p * v.imag[k];
    }
  }
  if (magnitude(out) > 1e-9) normalize(out);
  return out;
}

export interface CommandSelection {
  verb: CommandVerb;
  /** Top-3 scored candidates, for inspection. */
  ranked: Array<{ verb: CommandVerb; score: number; cos: number; affordable: boolean; affinity: number }>;
  /** The actual engine Command record (or null if not constructible). */
  command: Command | null;
  /** Diagnostic: the intent vector that was cleanup-classified. */
  intentVec: HRRVec;
}

/** Substrate-paradigm command emission. Takes routing distribution +
 *  perception substrate + world + agent → engine Command.
 *
 *  This is the substrate-native answer to T3's "emit commands as text"
 *  failure mode. Commands emit via HRR cleanup, not via text continuation. */
export function composeCommandFromSubstrate(
  routing: Partial<Record<Sephirah, number>>,
  perception: PerceptionResult,
  world: World,
  agentId: EntityId,
  opts?: { generationPrompt?: string },
): CommandSelection {
  // 1. Intent vector — routing decision composed with situational context
  const routingVec = composeRoutingVector(routing);
  const intentVec = bind(_roles.intent, routingVec);
  addInto(intentVec, bind(_roles.context, perception.vec));
  if (magnitude(intentVec) > 1e-9) normalize(intentVec);

  // 2. Cleanup against command dictionary — score each prototype
  const me = world.getEntity(agentId);
  const ranked = COMMAND_DICTIONARY.map((proto) => {
    const cos = cosine(intentVec, proto.vec);
    const affinity = proto.sephirahAffinity.reduce(
      (acc, s) => acc + (routing[s] ?? 0), 0,
    ) * proto.affinityWeight;
    // Affordance gate: PICKUP needs a pickup-interactable visible, etc.
    let affordable = true;
    if (proto.needsTarget) {
      if (proto.affordance) {
        affordable = Array.from(perception.interactablesById.values())
          .some((i) => i.verb === proto.affordance);
      } else {
        affordable = perception.visibleEntities.length > 0;
      }
    }
    // PICKUP only if not already holding; DROP only if holding
    if (proto.verb === "PICKUP" && perception.holdingEntityId) affordable = false;
    if (proto.verb === "DROP" && !perception.holdingEntityId) affordable = false;
    const score = (cos + affinity) * (affordable ? 1 : 0.1);
    return { verb: proto.verb, score, cos, affordable, affinity };
  }).sort((a, b) => b.score - a.score);

  const top = ranked[0];

  // 3. Construct the engine Command from the selected verb + perception
  let command: Command | null = null;
  if (!me) return { verb: top.verb, ranked, command: null, intentVec };

  switch (top.verb) {
    case "PICKUP": {
      // HRR-native target selection: cleanup intent vector against
      // pickup-affordant candidate encodings. Replaces the original
      // distance-min loop. Proximity remains a small tiebreaker.
      const target = hrrSelectByAffordance(
        intentVec, perception, "pickup", me.transform.position,
      );
      if (target) {
        command = { kind: "PickupEntity", targetId: target.id, holderId: agentId };
      }
      break;
    }
    case "DROP": {
      if (perception.holdingEntityId) {
        command = {
          kind: "DropEntity",
          targetId: perception.holdingEntityId,
          holderId: agentId,
          dropTransform: {
            position: { x: me.transform.position.x, y: me.transform.position.y, z: me.transform.position.z },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
        };
      }
      break;
    }
    case "MOVE": {
      // Move in a direction conditioned on the dominant routing Sephirah.
      // Compass mapping: each Sephirah has an associated direction so
      // movement is substrate-consistent rather than random.
      const direction = sephirahDirection(routing);
      command = {
        kind: "MoveEntity", id: agentId,
        transform: {
          position: {
            x: me.transform.position.x + direction.x * 0.5,
            y: me.transform.position.y,
            z: me.transform.position.z + direction.z * 0.5,
          },
        },
      };
      break;
    }
    case "SPAWN": {
      // Use the optional generation prompt (model's text continuation, if any).
      // Fall back to a substrate-default ("a small tree" — netzach-aligned).
      const prompt = opts?.generationPrompt ?? "a small tree";
      const here = me.transform.position;
      const cmd = promptToSpawnCommand(prompt, { x: here.x + 2, y: here.y, z: here.z + 2 });
      if (cmd) command = cmd;
      break;
    }
    case "SAVE": {
      command = { kind: "SaveWorld", slot: "substrate-agent" };
      break;
    }
    case "ENTER_PORTAL": {
      // HRR-native target selection over use-affordant doorways. Same
      // pattern as PICKUP but filtered to portal kind.
      const target = hrrSelectByAffordance(
        intentVec, perception, "use", me.transform.position,
      );
      // Confirm it's a doorway (not some other use-affordant kind)
      const targetEntity = target ? world.getEntity(target.id) : null;
      if (target && targetEntity?.prototypeId === "doorway") {
        command = { kind: "EnterPortal", portalId: target.id, playerId: agentId };
      }
      break;
    }
    case "INSPECT": {
      // INSPECT = "attend to" = small approach motion toward an
      // intent-selected visible entity. HRR cleanup picks WHICH entity
      // to attend to based on routing-conditioned resonance.
      const target = hrrSelectAnyVisible(
        intentVec, perception, me.transform.position,
      );
      const targetEntity = target ? world.getEntity(target.id) : null;
      if (targetEntity) {
        const dx = targetEntity.transform.position.x - me.transform.position.x;
        const dz = targetEntity.transform.position.z - me.transform.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const step = Math.min(0.15, d * 0.25);
        const nx = me.transform.position.x + (d > 1e-6 ? dx / d : 0) * step;
        const nz = me.transform.position.z + (d > 1e-6 ? dz / d : 0) * step;
        command = {
          kind: "MoveEntity", id: agentId,
          transform: { position: { x: nx, y: me.transform.position.y, z: nz } },
        };
      }
      break;
    }
    case "TALK": {
      // HRR-native target selection over talk-affordant entities. The
      // addressee is chosen by intent-resonance — if the model routed to
      // a Sephirah whose kind-affinity matches a particular NPC kind,
      // that NPC wins over equally-close NPCs of other kinds.
      const target = hrrSelectByAffordance(
        intentVec, perception, "talk", me.transform.position,
      );
      const targetEntity = target ? world.getEntity(target.id) : null;
      if (target && targetEntity) {
        const existingAi = targetEntity.components.ai ?? {
          policy: "idle" as const, perceptionRadius: 0, state: {},
        };
        command = {
          kind: "EditComponents", id: target.id,
          patch: {
            ai: {
              ...existingAi,
              state: {
                ...existingAi.state,
                lastSpokenBy: agentId,
                lastSpokenTick: world.tick,
              },
            },
          },
        };
      }
      break;
    }
    case "GIVE": {
      // Drop the held item near a talk-affordant counterpart. Requires
      // holding AND a talk-affordant target. Falls back to nothing if
      // either is missing.
      if (!perception.holdingEntityId) break;
      const target = hrrSelectByAffordance(
        intentVec, perception, "talk", me.transform.position,
      );
      const targetEntity = target ? world.getEntity(target.id) : null;
      if (target && targetEntity) {
        // Drop at the counterpart's position (slight offset so it's
        // visually "given to" them)
        command = {
          kind: "DropEntity",
          targetId: perception.holdingEntityId,
          holderId: agentId,
          dropTransform: {
            position: {
              x: targetEntity.transform.position.x + 0.3,
              y: targetEntity.transform.position.y,
              z: targetEntity.transform.position.z,
            },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
        };
      }
      break;
    }
    case "USE": {
      // HRR-native USE over use-affordant entities that aren't doorways
      // (those go through ENTER_PORTAL). For now, emits EditComponents to
      // tag the used entity. Future: dispatch on entity kind to type-
      // specific use commands (lever, chest, button, etc.).
      const target = hrrSelectByAffordance(
        intentVec, perception, "use", me.transform.position,
      );
      const targetEntity = target ? world.getEntity(target.id) : null;
      if (target && targetEntity && targetEntity.prototypeId !== "doorway") {
        const existingAi = targetEntity.components.ai ?? {
          policy: "idle" as const, perceptionRadius: 0, state: {},
        };
        command = {
          kind: "EditComponents", id: target.id,
          patch: {
            ai: {
              ...existingAi,
              state: {
                ...existingAi.state,
                lastUsedBy: agentId,
                lastUsedTick: world.tick,
              },
            },
          },
        };
      }
      break;
    }
    case "REST": {
      // Voluntary inaction — emit a no-op MoveEntity (stay in place).
      // This is a real engine event (EntityMoved fires), but no state
      // changes. The agent has chosen to rest; downstream systems can
      // observe the "I am resting" tick via the event stream.
      command = {
        kind: "MoveEntity", id: agentId,
        transform: { position: { ...me.transform.position } },
      };
      break;
    }
    case "NONE":
      command = null;
      break;
  }

  return { verb: top.verb, ranked, command, intentVec };
}

/** Map Sephirah routing distribution to a movement direction.
 *  Compass: 8 Sephirot get cardinal/intercardinal directions; keter is up,
 *  malkuth is down. The dominant Sephirah determines the dominant axis. */
function sephirahDirection(routing: Partial<Record<Sephirah, number>>): { x: number; y: number; z: number } {
  // Compass assignments — orthogonal sets of Sephirot
  const compass: Record<Sephirah, { x: number; y: number; z: number }> = {
    keter:   { x:  0, y:  1, z:  0 },
    chokmah: { x:  1, y:  0, z: -1 },
    binah:   { x: -1, y:  0, z: -1 },
    chesed:  { x:  1, y:  0, z:  0 },
    geburah: { x: -1, y:  0, z:  0 },
    tiferet: { x:  0, y:  0, z:  0 },
    netzach: { x:  1, y:  0, z:  1 },
    hod:     { x: -1, y:  0, z:  1 },
    yesod:   { x:  0, y:  0, z:  1 },
    malkuth: { x:  0, y: -1, z:  0 },
  };
  let x = 0, y = 0, z = 0;
  for (const s of SEPHIROTH) {
    const p = routing[s] ?? 0;
    if (p <= 0) continue;
    const c = compass[s];
    x += p * c.x;
    y += p * c.y;
    z += p * c.z;
  }
  const m = Math.sqrt(x * x + y * y + z * z);
  if (m > 1e-6) { x /= m; y /= m; z /= m; }
  return { x, y, z };
}
