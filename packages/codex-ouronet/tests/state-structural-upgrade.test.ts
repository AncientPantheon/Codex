/**
 * `actions.runStructuralUpgrade()` — the store-level action wrapping
 * `runStructuralMigration` (docs/work/upgrade-prompt-ui/design.md, Topic 3).
 *
 * Mirrors `changeCodexPassword`'s own test conventions in
 * tests/state-store.test.ts / tests/state-kickstart-codex-v3.test.ts: a
 * fresh `MemoryCodexAdapter` per test, seeded directly via `saveAll()` when
 * the test needs to control the exact on-disk shape (a "stoic" kadenaSeeds
 * entry whose `secret` is legacy-words-shaped ciphertext), rather than going
 * through kickstart.
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";
import { STRUCTURAL_SHAPE_TARGET_VERSION } from "@ancientpantheon/codex-ouronet/structural-migration";
import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";

const T = { timeout: 120_000 };

/** A real, valid DALOS word list — same known-good fixture
 *  `tests/structural-migration.test.ts` already uses for the identical
 *  purpose (a legacy-shape stoic seed's `secret` holding raw words instead
 *  of the pre-converted bitstring). */
const VALID_DALOS_WORDS =
  "bid day just attack address climb actual void method cave " +
  "fuel soldier bright fancy donkey exist gown silly mimic " +
  "canal fiber pulse exercise fit";

const PASSWORD = "structural-upgrade-test-pw";

/** Builds a MemoryCodexAdapter pre-seeded (via `saveAll`, bypassing any
 *  store action) with one "stoic" kadenaSeeds entry whose `secret` is
 *  `encryptStringV2(VALID_DALOS_WORDS, PASSWORD)` — the exact legacy-shape
 *  bug the engine fixes. */
async function seededAdapter(): Promise<CodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  const secret = await encryptStringV2(VALID_DALOS_WORDS, PASSWORD);
  await adapter.saveAll({
    kadenaSeeds: [
      {
        id: "stoic-legacy-seed",
        seedType: "stoic",
        version: "1.0",
        index: 0,
        secret,
        main: "deadbeef",
        createdAt: "2026-01-01T00:00:00.000Z",
        accounts: [],
        isPrime: true,
      },
    ],
    ouroAccounts: [],
    pureKeypairs: [],
    addressBook: [],
    watchList: [],
    uiSettings: {} as never,
    schemaVersion: 1,
    lastUpdatedAt: null,
    lastUpdatedDevice: "dev",
  } as never);
  return adapter;
}

describe("actions.runStructuralUpgrade()", () => {
  it(
    "fixes a stoic seed's words-shaped secret, stamps Codex_Shape_Version, and persists so a fresh store remount sees the fix",
    T,
    async () => {
      const adapter = await seededAdapter();
      const store = createCodexStore();
      await store.getState().actions.init(adapter, "dev");
      store.getState().actions.authenticate(PASSWORD, 60);

      const result = await store.getState().actions.runStructuralUpgrade();

      expect(result.fixedSeedIds).toContain("stoic-legacy-seed");
      expect(store.getState().Codex_Shape_Version).toBe(
        STRUCTURAL_SHAPE_TARGET_VERSION
      );
      const liveSecret = store.getState().kadenaSeeds[0].secret;
      const livePlain = await smartDecrypt(liveSecret, PASSWORD);
      expect(livePlain).toMatch(/^[01]{1024}$|^[01]{1600}$/);

      // Persistence round-trip: a FRESH store mounted against the SAME
      // adapter must see the fixed secret too, not just in-memory state.
      const remounted = createCodexStore();
      await remounted.getState().actions.init(adapter, "dev");
      const remountedSecret = remounted.getState().kadenaSeeds[0].secret;
      const remountedPlain = await smartDecrypt(remountedSecret, PASSWORD);
      expect(remountedPlain).toBe(livePlain);
      expect(remounted.getState().Codex_Shape_Version).toBe(
        STRUCTURAL_SHAPE_TARGET_VERSION
      );
    }
  );

  it(
    "rejects with CodexLockedError on a never-authenticated store, leaving the adapter's persisted data completely unchanged",
    T,
    async () => {
      const adapter = await seededAdapter();
      const store = createCodexStore();
      await store.getState().actions.init(adapter, "dev");
      // Captured AFTER init() — init() itself may run a legitimate schema
      // migration + persist (schemaVersion bump, etc.); what this test
      // asserts is that the REJECTED runStructuralUpgrade() call makes no
      // further change beyond that.
      const before = await adapter.loadAll();
      // Deliberately never authenticated — the codex stays locked.

      await expect(store.getState().actions.runStructuralUpgrade()).rejects.toThrow(
        CodexLockedError
      );

      const after = await adapter.loadAll();
      expect(after).toEqual(before);
    }
  );

  it(
    "requestMissingData's resolved value flows through to fix an otherwise-unresolvable seed",
    T,
    async () => {
      const adapter = new MemoryCodexAdapter("dev");
      const garbageSecret = await encryptStringV2(
        "not-words-or-bits!@#$%^&*()",
        PASSWORD
      );
      await adapter.saveAll({
        kadenaSeeds: [
          {
            id: "garbage-seed",
            seedType: "stoic",
            version: "1.0",
            index: 0,
            secret: garbageSecret,
            main: "deadbeef",
            createdAt: "2026-01-01T00:00:00.000Z",
            accounts: [],
            isPrime: true,
          },
        ],
        ouroAccounts: [],
        pureKeypairs: [],
        addressBook: [],
        watchList: [],
        uiSettings: {} as never,
        schemaVersion: 1,
        lastUpdatedAt: null,
        lastUpdatedDevice: "dev",
      } as never);

      const store = createCodexStore();
      await store.getState().actions.init(adapter, "dev");
      store.getState().actions.authenticate(PASSWORD, 60);

      const requestMissingData = async () => VALID_DALOS_WORDS;
      const result = await store
        .getState()
        .actions.runStructuralUpgrade({ requestMissingData });

      expect(result.skipped).toEqual([]);
      expect(result.fixedSeedIds).toContain("garbage-seed");
      const fixedPlain = await smartDecrypt(
        store.getState().kadenaSeeds[0].secret,
        PASSWORD
      );
      expect(fixedPlain).toMatch(/^[01]{1024}$|^[01]{1600}$/);
    }
  );
});
