/**
 * Store wiring tests for the v0.3 schema-migration path — SYNTHETIC-migration
 * half. A module-level vi.mock injects a single 1->2 migration into
 * SCHEMA_MIGRATIONS so the "migration actually advances state + persists the
 * upgraded snapshot" wiring is exercised in Phase 1 (rather than deferred to
 * Phase 10's real migration). `applyMigrations` itself stays real — we are
 * testing the store wiring, not the runner.
 */

import { describe, it, expect, vi } from "vitest";

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
        description: "synthetic test migration",
        migrate: (s: import("../src/adapters/types.js").CodexSnapshot) => ({
          ...s,
          schemaVersion: 2,
          watchList: [
            ...s.watchList,
            {
              id: "synthetic-marker",
              label: "synthetic-marker",
              address: "Ѻ.synthetic",
              type: "ouronet" as const,
              createdAt: "2026-05-24T10:00:00.000Z",
            },
          ],
        }),
      },
    ],
  };
});

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";

const snapshotAt = (schemaVersion: number): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  schemaVersion,
});

const hasSyntheticMarker = (snap: CodexSnapshot): boolean =>
  snap.watchList.some((w) => w.id === "synthetic-marker");

describe("with synthetic 1->2 migration (vi.mock)", () => {
  it("migrateToCurrent() advances schemaVersion to 2 and persists the migrated snapshot", async () => {
    // Wire a fresh empty (v0) adapter so init() does NOT itself migrate
    // (the synthetic 1->2 migration's `fromVersion === current` predicate
    // skips a v0 snapshot). Then drop the store + adapter to schemaVersion 1
    // so migrateToCurrent() has real work to do, isolating it as the SUT.
    const adapter = new MemoryCodexAdapter("dev");
    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
    await store.getState().actions.setSchemaVersion(1);

    const saveAll = vi.spyOn(adapter, "saveAll");
    await store.getState().actions.migrateToCurrent();

    expect(store.getState().schemaVersion).toBe(2);
    // The migrated entity slice (synthetic watchList marker) is applied to state.
    expect(
      store.getState().watchList.some((w) => w.id === "synthetic-marker")
    ).toBe(true);
    expect(saveAll).toHaveBeenCalledTimes(1);
    const persisted = saveAll.mock.calls[0][0];
    expect(persisted.schemaVersion).toBe(2);
    expect(hasSyntheticMarker(persisted)).toBe(true);
  });

  it("init() persists the migrated snapshot to the adapter when a migration runs", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll(snapshotAt(1));
    const store = createCodexStore();

    await store.getState().actions.init(adapter, "dev");

    const persisted = await adapter.loadAll();
    expect(persisted.schemaVersion).toBe(2);
    expect(store.getState().schemaVersion).toBe(2);
    // Migrated entity slices (not the raw loaded v1 slices) are reflected in state.
    expect(hasSyntheticMarker({ ...emptySnapshot("dev"), watchList: store.getState().watchList })).toBe(true);
  });

  it("init() sets state.schemaVersion to the post-migration value, not the raw loaded value", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll(snapshotAt(1));
    const store = createCodexStore();

    await store.getState().actions.init(adapter, "dev");

    // loaded was 1; migration.toVersion is 2 — state must reflect 2.
    expect(store.getState().schemaVersion).toBe(2);
    expect(store.getState().schemaVersion).not.toBe(1);
  });
});
