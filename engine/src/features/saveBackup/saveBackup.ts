// Feature: Save / Backup.
//
// Serialize a World + its CommandBus log to JSON. Two forms:
//   - "snapshot": world state at a tick (entities, chunks, tick counter)
//   - "log": full command history (deterministic replay reproduces snapshot)
//
// Restore options:
//   - From snapshot: re-spawn each entity with a SpawnEntity command on a
//     fresh CommandBus, achieving the same world state without replaying
//     history. Loses time-rewind capability but is fast.
//   - From log: replay every command on a fresh world. Slower but
//     reproduces full history including events.
//
// Browser download/upload helpers gated on `document` so we can run
// headless in tests. Fixes v7.2 audit's A7 (restore-from-arg unusable
// for real files) by providing exportToBlob / restoreFromText separately.

import { type Command, type SpawnEntityCommand } from "../../cmd/types.js";
import { CommandBus } from "../../cmd/bus.js";
import { World } from "../../world/world.js";
import { type EntityRecord } from "../../entity/types.js";

export const BACKUP_VERSION = 2;

export interface SnapshotBackup {
  version: number;
  format: "snapshot";
  exported_at: number;
  game_version?: string;
  world: {
    seed: number;
    tick: number;
    entities: EntityRecord[];
  };
}

export interface LogBackup {
  version: number;
  format: "log";
  exported_at: number;
  game_version?: string;
  seed: number;
  commands: Command[];
}

export type Backup = SnapshotBackup | LogBackup;

export function exportSnapshot(world: World, gameVersion?: string): SnapshotBackup {
  const entities: EntityRecord[] = [];
  for (const e of world.allEntities()) {
    // Skip ephemeral entities (no saveable component)
    if (e.components.saveable) entities.push(e);
  }
  return {
    version: BACKUP_VERSION,
    format: "snapshot",
    exported_at: Date.now(),
    game_version: gameVersion,
    world: {
      seed: world.seed,
      tick: world.tick,
      entities,
    },
  };
}

export function exportLog(bus: CommandBus, gameVersion?: string): LogBackup {
  return {
    version: BACKUP_VERSION,
    format: "log",
    exported_at: Date.now(),
    game_version: gameVersion,
    seed: bus.world.seed,
    commands: bus.log.slice(),
  };
}

/** Restore a snapshot into a fresh world via SpawnEntity commands. */
export function restoreSnapshot(snapshot: SnapshotBackup, bus: CommandBus): { restored: number; failed: number } {
  if (snapshot.version !== BACKUP_VERSION) {
    throw new Error(`unsupported snapshot version ${snapshot.version}`);
  }
  let restored = 0, failed = 0;
  for (const e of snapshot.world.entities) {
    const cmd: SpawnEntityCommand = {
      kind: "SpawnEntity",
      id: e.id,
      prototypeId: e.prototypeId,
      transform: e.transform,
      components: e.components,
      sephirah: e.sephirah,
    };
    const events = bus.applyImmediate(cmd);
    if (events[0]?.kind === "CommandRejected") failed++; else restored++;
  }
  return { restored, failed };
}

/** Restore a log by replaying every command in order. Caller is responsible
 *  for using a fresh world with matching seed. */
export function restoreLog(log: LogBackup, bus: CommandBus): { applied: number; rejected: number } {
  if (log.version !== BACKUP_VERSION) {
    throw new Error(`unsupported log version ${log.version}`);
  }
  if (bus.world.seed !== log.seed) {
    console.warn(`[saveBackup] seed mismatch: world.seed=${bus.world.seed} log.seed=${log.seed}`);
  }
  let applied = 0, rejected = 0;
  for (const cmd of log.commands) {
    const events = bus.applyImmediate(cmd);
    if (events[0]?.kind === "CommandRejected") rejected++; else applied++;
  }
  return { applied, rejected };
}

/** Serialize a backup to a JSON Blob suitable for browser download. */
export function backupToBlob(b: Backup): Blob {
  const text = JSON.stringify(b, null, 2);
  return new Blob([text], { type: "application/json" });
}

/** Trigger a browser download. No-op outside a DOM environment. */
export function downloadBackup(b: Backup, filename?: string): void {
  if (typeof document === "undefined") return;
  const blob = backupToBlob(b);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `wander-backup-${new Date(b.exported_at).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${b.format}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Parse a backup from JSON text. Throws on invalid format. */
export function backupFromText(text: string): Backup {
  const obj = JSON.parse(text);
  if (typeof obj !== "object" || obj === null) throw new Error("backup is not an object");
  if (!("version" in obj) || !("format" in obj)) throw new Error("missing version or format");
  if (obj.format !== "snapshot" && obj.format !== "log") throw new Error(`unknown format: ${obj.format}`);
  return obj as Backup;
}
