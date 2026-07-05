/**
 * Schema-migration runner tests — pin the pure-function contract of
 * `applyMigrations` + `canConsumerWrite` (the foundation Phase 10's real
 * v0.2 -> v0.3 migration lands on). Drives every expectation from synthetic
 * SchemaMigration inputs so the assertions fail if the rolling-cursor
 * predicate, post-condition check, or registry validation drift.
 */

import { describe, it, expect } from "vitest";
import { emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  applyMigrations,
  canConsumerWrite,
  type SchemaMigration,
} from "@ancientpantheon/codex-ouronet/state";
import { CodexMigrationError } from "@ancientpantheon/codex-ouronet/errors";

const snapAt = (schemaVersion: number): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  schemaVersion,
});

// Synthetic migrations: each sets the output snapshot's schemaVersion to its
// own toVersion (the post-condition the runner enforces).
const mig = (
  fromVersion: number,
  toVersion: number,
  extra: Partial<CodexSnapshot> = {}
): SchemaMigration => ({
  fromVersion,
  toVersion,
  description: `synthetic ${fromVersion}->${toVersion}`,
  migrate: (s) => ({ ...s, ...extra, schemaVersion: toVersion }),
});

describe("CURRENT_SCHEMA_VERSION + SCHEMA_MIGRATIONS registry", () => {
  it("CURRENT_SCHEMA_VERSION is 3 (the version v0.5 writes)", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });

  it("SCHEMA_MIGRATIONS contains the 1->2 and 2->3 migrations", () => {
    expect(SCHEMA_MIGRATIONS.length).toBe(2);
    expect(SCHEMA_MIGRATIONS[0]).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect(SCHEMA_MIGRATIONS[1]).toMatchObject({ fromVersion: 2, toVersion: 3 });
  });
});

describe("canConsumerWrite", () => {
  it("returns true at or below CURRENT_SCHEMA_VERSION, false above", () => {
    // loaded <= 3 is writable; a future schema (>3) is not, because writing
    // could drop fields this package doesn't know about.
    expect(canConsumerWrite(0)).toBe(true);
    expect(canConsumerWrite(1)).toBe(true);
    expect(canConsumerWrite(2)).toBe(true);
    expect(canConsumerWrite(3)).toBe(true);
    expect(canConsumerWrite(4)).toBe(false);
    expect(canConsumerWrite(99)).toBe(false);
  });
});

describe("applyMigrations", () => {
  it("returns the snapshot unchanged when already at the target version", () => {
    const snap = snapAt(2);
    const out = applyMigrations(snap, [mig(1, 2)], 2);
    // Idempotent at current: no migration should run, same reference is fine.
    expect(out.schemaVersion).toBe(2);
    expect(out).toEqual(snap);
  });

  it("is a no-op when the migrations registry is empty", () => {
    const snap = snapAt(1);
    const out = applyMigrations(snap, [], 2);
    // No upgrade path exists, so the snapshot is returned unchanged at v1.
    expect(out).toEqual(snap);
    expect(out.schemaVersion).toBe(1);
  });

  it("throws unknown-schema-version when the snapshot is newer than the target", () => {
    const snap = snapAt(3);
    try {
      applyMigrations(snap, [], 2);
      throw new Error("expected applyMigrations to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CodexMigrationError);
      expect((e as CodexMigrationError).reason).toBe("unknown-schema-version");
    }
  });

  it("chains 1->2 then 2->3 to reach target 3", () => {
    const snap = snapAt(1);
    const out = applyMigrations(snap, [mig(2, 3), mig(1, 2)], 3);
    // Registry given out-of-order on purpose: the runner must sort and chain
    // 1->2 then 2->3, ending at schemaVersion 3.
    expect(out.schemaVersion).toBe(3);
  });

  it("wraps a thrown migration in migration-failed preserving the cause", () => {
    const original = new Error("boom");
    const exploding: SchemaMigration = {
      fromVersion: 1,
      toVersion: 2,
      description: "explodes",
      migrate: () => {
        throw original;
      },
    };
    try {
      applyMigrations(snapAt(1), [exploding], 2);
      throw new Error("expected applyMigrations to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CodexMigrationError);
      expect((e as CodexMigrationError).reason).toBe("migration-failed");
      expect((e as CodexMigrationError).cause).toBe(original);
    }
  });

  it("throws post-condition-failed when a migration doesn't set its toVersion", () => {
    const liar: SchemaMigration = {
      fromVersion: 1,
      toVersion: 2,
      description: "forgets to bump schemaVersion",
      migrate: (s) => ({ ...s, schemaVersion: 1 }), // declared 2, returns 1
    };
    try {
      applyMigrations(snapAt(1), [liar], 2);
      throw new Error("expected applyMigrations to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CodexMigrationError);
      expect((e as CodexMigrationError).reason).toBe("post-condition-failed");
    }
  });

  it("does NOT apply a 1->2 migration to a v0 snapshot (strict === current)", () => {
    // Rolling-cursor predicate is `fromVersion === current`. With current=0
    // there is no 0->1 step, so the 1->2 migration must be skipped and the
    // v0 snapshot returned unchanged — proving the predicate isn't `>=`.
    const snap = snapAt(0);
    const out = applyMigrations(snap, [mig(1, 2)], 2);
    expect(out.schemaVersion).toBe(0);
    expect(out).toEqual(snap);
  });

  it("rejects a registry with a reversed fromVersion >= toVersion entry", () => {
    const reversed = mig(2, 1); // fromVersion >= toVersion
    try {
      applyMigrations(snapAt(0), [reversed], 2);
      throw new Error("expected applyMigrations to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CodexMigrationError);
      expect((e as CodexMigrationError).reason).toBe("post-condition-failed");
    }
  });

  it("rejects a registry with duplicate fromVersion entries", () => {
    const dupA = mig(1, 2);
    const dupB = mig(1, 3);
    try {
      applyMigrations(snapAt(1), [dupA, dupB], 3);
      throw new Error("expected applyMigrations to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CodexMigrationError);
      expect((e as CodexMigrationError).reason).toBe("post-condition-failed");
    }
  });
});
