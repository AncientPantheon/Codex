/**
 * Consumer-settings migration-cascade specs (CI-001/CI-002).
 *
 * These verify the three store.ts cascade sites Phase 2 amends:
 *   - init()'s Step 5 set block reads consumerSettings from the MIGRATED
 *     snapshot, not the raw loaded one — so a Phase-10 migration that
 *     synthesizes consumerSettings is NOT silently discarded.
 *   - migrateToCurrent()'s snapshot-builder passes the current store's
 *     consumerSettings into applyMigrations — so the migration sees live
 *     registry state, not undefined.
 *
 * A module-level vi.mock injects a synthetic 1->2 migration that writes
 * consumerSettings, isolating the wiring. `applyMigrations` stays real.
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
        description: "synthetic 1->2 consumerSettings migration",
        migrate: (s: import("../src/adapters/types.js").CodexSnapshot) => ({
          ...s,
          schemaVersion: 2,
          consumerSettings: {
            OuronetUI: {
              consumerName: "OuronetUI",
              consumerVersion: "1.0.0",
              schemaVersion: 1,
              settings: { migrated: true },
              lastUpdatedAt: "2026-05-29T00:00:00.000Z",
            },
          },
        }),
      },
    ],
  };
});

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";

const snapshotAt = (schemaVersion: number): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  schemaVersion,
});

describe("consumerSettings migration cascade (vi.mock 1->2)", () => {
  it("init() reads consumerSettings from the migrated snapshot, not raw loaded", async () => {
    // v0.2-shaped codex at schemaVersion 1 with no consumerSettings of its own.
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.saveAll(snapshotAt(1));

    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");

    // The synthetic migration synthesized an OuronetUI entry; if init's set
    // block read `loaded.consumerSettings` this would be null.
    const got = store.getState().actions.getConsumerSettings("OuronetUI");
    expect(got?.settings).toEqual({ migrated: true });
    expect(store.getState().schemaVersion).toBe(2);
  });

  it("migrateToCurrent() feeds the current store's consumerSettings into the migration runner", async () => {
    // Start at v0 (init does NOT migrate — synthetic fromVersion is 1), write a
    // live consumerSettings entry, drop to v1 so migrateToCurrent has work, then
    // assert the migration's input snapshot carried the live registry.
    const adapter = new MemoryCodexAdapter("dev");
    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
    await store
      .getState()
      .actions.updateConsumerSettings({
        consumerName: "AncientHoldings",
        consumerVersion: "2.0.0",
        schemaVersion: 1,
        settings: { live: true },
        lastUpdatedAt: "2026-05-29T00:00:00.000Z",
      });
    await store.getState().actions.setSchemaVersion(1);

    // Spy on the migrate fn to capture the input snapshot it receives.
    const migrations = await import("../src/state/migrations.js");
    const migrateSpy = vi.spyOn(migrations.SCHEMA_MIGRATIONS[0], "migrate");

    await store.getState().actions.migrateToCurrent();

    expect(migrateSpy).toHaveBeenCalledTimes(1);
    const inputSnap = migrateSpy.mock.calls[0][0];
    // The builder must have sourced consumerSettings from live store state —
    // proving migrateToCurrent's snapshot-builder includes the field.
    expect(inputSnap.consumerSettings).toHaveProperty("AncientHoldings");
    expect(
      inputSnap.consumerSettings?.AncientHoldings.settings
    ).toEqual({ live: true });
  });
});
