/**
 * Store wiring tests for the v0.3 schema-migration path — EMPTY-registry half
 * (Phase 1 default). Covers the boundary check (`canConsumerWrite`) running
 * BEFORE the legacy v0.2 prime-seed migration, and the no-op behavior when no
 * migration applies. Uses the REAL empty SCHEMA_MIGRATIONS (no vi.mock).
 *
 * The synthetic-migration half (advances + persists) lives in
 * `state-migrate-to-current.with-synthetic.test.ts` so its module-level
 * vi.mock stays scoped to that file (N-001).
 */

import { describe, it, expect, vi } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { CURRENT_SCHEMA_VERSION } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexMigrationError } from "@ancientpantheon/codex-ouronet/errors";

const snapshotAt = (
  schemaVersion: number,
  extra: Partial<CodexSnapshot> = {}
): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  schemaVersion,
  ...extra,
});

describe("with empty SCHEMA_MIGRATIONS (Phase 1 default)", () => {
  describe("migrateToCurrent()", () => {
    it("is a no-op when already at CURRENT_SCHEMA_VERSION", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      await adapter.saveAll(snapshotAt(CURRENT_SCHEMA_VERSION));
      const store = createCodexStore();
      await store.getState().actions.init(adapter, "dev");

      const saveAll = vi.spyOn(adapter, "saveAll");
      await store.getState().actions.migrateToCurrent();

      // No migration path exists from current, so neither state nor adapter
      // should be touched.
      expect(saveAll).not.toHaveBeenCalled();
      expect(store.getState().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });
  });

  describe("init()", () => {
    it("throws unknown-schema-version BEFORE mutating the adapter when loaded schema is newer", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      // schemaVersion 99 AND an unflagged seed: if the boundary check did NOT
      // run first, the legacy migration would call saveKadenaSeeds and mutate
      // a future-version codex.
      await adapter.saveAll(
        snapshotAt(99, {
          kadenaSeeds: [
            {
              id: "s1",
              name: "Seed",
              seedType: "koala",
              version: "1.0.0",
              index: 0,
              secret: "enc",
              main: "k:" + "0".repeat(64),
              createdAt: "2026-05-24T10:00:00.000Z",
              accounts: [],
            },
          ],
        })
      );
      const store = createCodexStore();

      const saveAll = vi.spyOn(adapter, "saveAll");
      const saveKadenaSeeds = vi.spyOn(adapter, "saveKadenaSeeds");

      let thrown: unknown;
      try {
        await store.getState().actions.init(adapter, "dev");
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(CodexMigrationError);
      expect((thrown as CodexMigrationError).reason).toBe(
        "unknown-schema-version"
      );
      // No adapter mutation occurred — boundary check ran before legacy migration.
      expect(saveAll).not.toHaveBeenCalled();
      expect(saveKadenaSeeds).not.toHaveBeenCalled();
    });

    it("does NOT call saveAll when no migration runs (empty registry, current codex)", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      await adapter.saveAll(snapshotAt(CURRENT_SCHEMA_VERSION));
      const store = createCodexStore();

      const saveAll = vi.spyOn(adapter, "saveAll");
      await store.getState().actions.init(adapter, "dev");

      expect(saveAll).not.toHaveBeenCalled();
    });

    it("sets initError and re-throws when the boundary check rejects", async () => {
      const adapter = new MemoryCodexAdapter("dev");
      await adapter.saveAll(snapshotAt(99));
      const store = createCodexStore();

      await expect(
        store.getState().actions.init(adapter, "dev")
      ).rejects.toBeInstanceOf(CodexMigrationError);

      // The thrown error propagated through init's outer catch.
      expect(store.getState().initError).toBeInstanceOf(CodexMigrationError);
      expect(store.getState().ready).toBe(false);
    });
  });
});
