import { describe, it, expect } from "vitest";
import { World } from "../../src/world/index.js";
import { CommandBus, defaultReducer } from "../../src/cmd/index.js";
import { exportSnapshot, exportLog, restoreSnapshot, restoreLog, backupFromText, BACKUP_VERSION } from "../../src/features/saveBackup/index.js";
import { identityTransform } from "../../src/entity/index.js";

describe("Feature: saveBackup", () => {
  it("exportSnapshot captures only saveable entities", () => {
    const w = new World(42);
    const b = new CommandBus(w, defaultReducer);
    b.applyImmediate({
      kind: "SpawnEntity", id: "save_me", prototypeId: "tree",
      transform: identityTransform(),
      components: { saveable: { persistent: true } },
    });
    b.applyImmediate({
      kind: "SpawnEntity", id: "ephemeral", prototypeId: "rock",
      transform: identityTransform(), components: {},
    });
    const snap = exportSnapshot(w);
    expect(snap.world.entities.length).toBe(1);
    expect(snap.world.entities[0].id).toBe("save_me");
    expect(snap.world.seed).toBe(42);
  });

  it("exportLog captures applied commands", () => {
    const w = new World();
    const b = new CommandBus(w, defaultReducer);
    b.applyImmediate({
      kind: "SpawnEntity", id: "a", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    b.applyImmediate({
      kind: "MoveEntity", id: "a",
      transform: { position: { x: 5, y: 0, z: 0 } },
    });
    const log = exportLog(b);
    expect(log.commands.length).toBe(2);
    expect(log.format).toBe("log");
  });

  it("snapshot round-trip via fresh world", () => {
    const wa = new World(7);
    const ba = new CommandBus(wa, defaultReducer);
    ba.applyImmediate({
      kind: "SpawnEntity", id: "x", prototypeId: "tower",
      transform: { ...identityTransform(), position: { x: 3, y: 0, z: 0 } },
      components: { saveable: { persistent: true } },
    });
    const snap = exportSnapshot(wa);

    const wb = new World(7);
    const bb = new CommandBus(wb, defaultReducer);
    const { restored, failed } = restoreSnapshot(snap, bb);
    expect(restored).toBe(1);
    expect(failed).toBe(0);
    expect(wb.getEntity("x")?.prototypeId).toBe("tower");
    expect(wb.getEntity("x")?.transform.position.x).toBe(3);
  });

  it("log replay reproduces world state deterministically", () => {
    const wa = new World(99);
    const ba = new CommandBus(wa, defaultReducer);
    ba.applyImmediate({
      kind: "SpawnEntity", id: "a", prototypeId: "tree",
      transform: identityTransform(), components: {},
    });
    ba.applyImmediate({
      kind: "MoveEntity", id: "a",
      transform: { position: { x: 8, y: 0, z: 0 } },
    });
    const log = exportLog(ba);

    const wb = new World(99);
    const bb = new CommandBus(wb, defaultReducer);
    const { applied } = restoreLog(log, bb);
    expect(applied).toBe(2);
    expect(wb.getEntity("a")?.transform.position.x).toBe(8);
  });

  it("backupFromText parses snapshot JSON", () => {
    const snap = exportSnapshot(new World(1));
    const text = JSON.stringify(snap);
    const parsed = backupFromText(text);
    expect(parsed.format).toBe("snapshot");
    expect(parsed.version).toBe(BACKUP_VERSION);
  });
});
