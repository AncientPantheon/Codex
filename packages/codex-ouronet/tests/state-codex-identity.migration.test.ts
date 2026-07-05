/**
 * Codex-identity migration-cascade specs (CI-001/CI-002).
 *
 * These verify the three store.ts cascade sites Phase 3 amends:
 *   - init() Step 5 set block reads codexIdentity from the MIGRATED snapshot,
 *     not the raw loaded one — so a future migration that synthesizes a
 *     codexIdentity is NOT silently discarded.
 *   - init() Step 3 snapshot-builder passes the LOADED codexIdentity into
 *     applyMigrations — so a migration sees the on-disk identity, not undefined.
 *   - migrateToCurrent()'s snapshot-builder passes the current store's
 *     codexIdentity into applyMigrations — so the migration sees live state.
 *
 * A module-level vi.mock injects a synthetic 1->2 migration, isolating the
 * wiring. `applyMigrations` stays real.
 */

import { describe, it, expect, vi } from "vitest";
import type { ICodexIdentity } from "@ancientpantheon/codex-ouronet/types";

const SYNTH_IDENTITY: ICodexIdentity = {
  formatted: "₱.SYNTH:Π.SYNTH",
  standardPublicKey: "S".repeat(160),
  smartPublicKey: "Z".repeat(160),
  encryptedSeedWords: "synth-seed",
  encryptedStandardBitstring: "synth-std-bits",
  encryptedSmartBitstring: "synth-smart-bits",
  encryptedStandardBase10: "synth-std-b10",
  encryptedSmartBase10: "synth-smart-b10",
  encryptedStandardBase49: "synth-std-b49",
  encryptedSmartBase49: "synth-smart-b49",
  totalWordCount: 12,
  splitIndex: 6,
  createdAt: "2026-05-29T00:00:00.000Z",
};

vi.mock("../src/state/migrations.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../src/state/migrations.js")>();
  return {
    ...actual,
    CURRENT_SCHEMA_VERSION: 2,
    SCHEMA_MIGRATIONS: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "synthetic 1->2 codexIdentity migration",
        migrate: (s: import("../src/adapters/types.js").CodexSnapshot) => ({
          ...s,
          schemaVersion: 2,
          // Synthesize an identity ONLY if the input didn't carry one — this
          // lets the Step-3-builder spec echo the loaded identity through while
          // the Step-5 spec still sees a freshly-synthesized one.
          codexIdentity: s.codexIdentity ?? {
            formatted: "₱.SYNTH:Π.SYNTH",
            standardPublicKey: "S".repeat(160),
            smartPublicKey: "Z".repeat(160),
            encryptedSeedWords: "synth-seed",
            encryptedStandardBitstring: "synth-std-bits",
            encryptedSmartBitstring: "synth-smart-bits",
            encryptedStandardBase10: "synth-std-b10",
            encryptedSmartBase10: "synth-smart-b10",
            encryptedStandardBase49: "synth-std-b49",
            encryptedSmartBase49: "synth-smart-b49",
            totalWordCount: 12,
            splitIndex: 6,
            createdAt: "2026-05-29T00:00:00.000Z",
          },
        }),
      },
    ],
  };
});

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";

const snapshotAt = (
  schemaVersion: number,
  codexIdentity?: ICodexIdentity
): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  schemaVersion,
  codexIdentity,
});

describe("codexIdentity migration cascade (vi.mock 1->2)", () => {
  it("init() reads codexIdentity from the migrated snapshot, not raw loaded (site b)", async () => {
    // v0.2-shaped codex at schemaVersion 1 with NO codexIdentity of its own.
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll(snapshotAt(1));

    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");

    // The synthetic migration synthesized an identity; if init's set block read
    // `loaded.codexIdentity` this would be null. Reading `migrated.codexIdentity`
    // surfaces the synthesized one.
    const got = store.getState().actions.getCodexIdentity();
    expect(got).not.toBeNull();
    expect(got?.formatted).toBe("₱.SYNTH:Π.SYNTH");
    expect(store.getState().schemaVersion).toBe(2);
  });

  it("init() Step 3 builder passes loaded codexIdentity into the migration runner (site a)", async () => {
    // Codex at schemaVersion 1 WITH a populated identity on disk.
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll(snapshotAt(1, SYNTH_IDENTITY));

    const migrations = await import("../src/state/migrations.js");
    const migrateSpy = vi.spyOn(migrations.SCHEMA_MIGRATIONS[0], "migrate");

    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");

    expect(migrateSpy).toHaveBeenCalledTimes(1);
    const inputSnap = migrateSpy.mock.calls[0][0];
    // The Step-3 builder must have sourced codexIdentity from the loaded
    // snapshot — proving `codexIdentity: loaded.codexIdentity` is in the builder.
    expect(inputSnap.codexIdentity).toEqual(SYNTH_IDENTITY);
    migrateSpy.mockRestore();
  });

  it("migrateToCurrent() feeds the current store's codexIdentity into the migration runner (site c)", async () => {
    // Start at v0 (init does NOT migrate — synthetic fromVersion is 1), seed a
    // live codexIdentity into state via init-from-snapshot, drop to v1 so
    // migrateToCurrent has work, then assert the migration's input carried it.
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll(snapshotAt(0, SYNTH_IDENTITY));
    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
    // Sanity: identity threaded into state, no migration ran (still v0).
    expect(store.getState().actions.getCodexIdentity()).toEqual(SYNTH_IDENTITY);
    await store.getState().actions.setSchemaVersion(1);

    const migrations = await import("../src/state/migrations.js");
    const migrateSpy = vi.spyOn(migrations.SCHEMA_MIGRATIONS[0], "migrate");

    await store.getState().actions.migrateToCurrent();

    expect(migrateSpy).toHaveBeenCalledTimes(1);
    const inputSnap = migrateSpy.mock.calls[0][0];
    // The migrateToCurrent builder must have sourced codexIdentity from live
    // store state — proving `codexIdentity: state.codexIdentity` is in it.
    expect(inputSnap.codexIdentity).toEqual(SYNTH_IDENTITY);
    migrateSpy.mockRestore();
  });
});
