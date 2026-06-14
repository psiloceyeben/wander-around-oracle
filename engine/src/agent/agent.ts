// Layer 6 — Player and agent substrate.
//
// Players and NPCs are entities with extra binding patterns: a perception
// op and a cognition op. The engine doesn't have special-case code for
// either — both are entities that emit commands via the standard
// CommandBus. The distinction is the binding of agency_type and which
// op produces the command stream.
//
// Player agency_type: human — commands come from input devices, mapped
// onto the same Command type via input handlers.
//
// NPC agency_type: machine — commands come from the cognition op (Layer 7)
// applied to the agent's perceptual unbind of the local world.

import { type EntityId } from "../entity/types.js";
import { World } from "../world/index.js";
import { CommandBus, type Command } from "../cmd/index.js";

export type AgencyType = "human" | "machine";

/** Per-agent perceptual state — what the agent can currently observe. */
export interface Perception {
  /** Entity ids the agent can currently perceive (within radius). */
  visibleIds: EntityId[];
  /** Refresh-tick when this perception was computed. */
  refreshedAtTick: number;
}

/** A cognition op takes perception + agent state, returns 0+ commands. */
export type CognitionOp = (ctx: {
  agentId: EntityId;
  world: World;
  perception: Perception;
  tick: number;
}) => Command[];

export interface AgentRegistration {
  id: EntityId;
  agency: AgencyType;
  perceptionRadius: number;
  /** Required for machine agents; ignored for humans. */
  cognition?: CognitionOp;
}

export class AgentSystem {
  private agents = new Map<EntityId, AgentRegistration>();
  private perceptions = new Map<EntityId, Perception>();

  register(reg: AgentRegistration): void {
    if (reg.agency === "machine" && !reg.cognition) {
      throw new Error(`Agent ${reg.id} is machine but has no cognition op`);
    }
    this.agents.set(reg.id, reg);
  }

  unregister(id: EntityId): void {
    this.agents.delete(id);
    this.perceptions.delete(id);
  }

  has(id: EntityId): boolean { return this.agents.has(id); }
  agency(id: EntityId): AgencyType | undefined { return this.agents.get(id)?.agency; }

  /** Refresh perception for an agent — entities within radius. */
  refreshPerception(world: World, id: EntityId, tick: number): Perception {
    const reg = this.agents.get(id);
    if (!reg) {
      return { visibleIds: [], refreshedAtTick: tick };
    }
    const agentRecord = world.getEntity(id);
    if (!agentRecord) {
      return { visibleIds: [], refreshedAtTick: tick };
    }
    const visibleIds: EntityId[] = [];
    for (const e of world.entitiesInRadius(agentRecord.transform.position, reg.perceptionRadius)) {
      if (e.id !== id) visibleIds.push(e.id);
    }
    const p: Perception = { visibleIds, refreshedAtTick: tick };
    this.perceptions.set(id, p);
    return p;
  }

  perceptionOf(id: EntityId): Perception | undefined {
    return this.perceptions.get(id);
  }

  /** Tick all machine agents — refresh perception, run cognition, submit commands.
   *  Humans are NOT ticked here; their commands enter via input handlers. */
  tickMachineAgents(world: World, bus: CommandBus, tick: number): void {
    for (const reg of this.agents.values()) {
      if (reg.agency !== "machine") continue;
      const perception = this.refreshPerception(world, reg.id, tick);
      const commands = reg.cognition!({ agentId: reg.id, world, perception, tick });
      for (const cmd of commands) bus.submit(cmd);
    }
  }

  agentCount(): number { return this.agents.size; }
  machineCount(): number {
    let c = 0;
    for (const r of this.agents.values()) if (r.agency === "machine") c++;
    return c;
  }
}
