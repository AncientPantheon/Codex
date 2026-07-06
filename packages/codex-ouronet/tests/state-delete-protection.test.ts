/**
 * Phase 6 (REQ-06) — delete protection for protected pure keypairs.
 *
 * `deletePureKeypair(id)` must reject deletion of any pure key carrying ANY
 * of the three structural-integrity flags introduced in Phase 5
 * (`isCodexGuard`, `wasCodexGuard`, `isDuoPurePrime`), throwing
 * `CodexGuardError("delete-rejected", ...)`. Regular keys still delete; a
 * missing id is still a silent no-op. The pre-existing Prime ouro / Prime
 * seed protections (`CodexPrimeProtectedError`) must remain unchanged.
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter, CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexGuardError,
  CodexPrimeProtectedError,
  CodexPrimeSeedProtectedError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  IPureKeypair,
  IStoaChainSeed,
  IOuroAccount,
} from "@ancientpantheon/codex-ouronet/types";

const pure = (
  id: string,
  overrides: Partial<IPureKeypair> = {}
): IPureKeypair => ({
  id,
  label: "Pure",
  publicKey: "f".repeat(64),
  encryptedPrivateKey: "enc-pk",
  createdAt: "2026-05-24T10:01:00.000Z",
  ...overrides,
});

const baseSnapshot = (overrides: Partial<CodexSnapshot> = {}): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  schemaVersion: 1,
  ...overrides,
});

async function storeWith(snap: CodexSnapshot) {
  const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll(snap);
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  return store;
}

describe("deletePureKeypair — Phase 6 protection", () => {
  describe("rejects protected keys", () => {
    it("REJECTS deletion when target has isCodexGuard: true", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("kg", { label: "CodexGuard", isCodexGuard: true })],
        })
      );
      await expect(
        store.getState().actions.deletePureKeypair("kg")
      ).rejects.toMatchObject({
        name: "CodexGuardError",
        reason: "delete-rejected",
      });
      // Entry must survive the rejected deletion.
      expect(store.getState().pureKeypairs.map((k) => k.id)).toContain("kg");
    });

    it("detail string identifies id, label, and the isCodexGuard flag", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("kg", { label: "CodexGuard", isCodexGuard: true })],
        })
      );
      await expect(
        store.getState().actions.deletePureKeypair("kg")
      ).rejects.toThrow(/id=kg.*label=CodexGuard.*flag=isCodexGuard/);
    });

    it("REJECTS deletion when target has wasCodexGuard: true (clean retired)", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [
            pure("retired", {
              label: "Old Guard",
              isCodexGuard: false,
              wasCodexGuard: true,
            }),
          ],
        })
      );
      await expect(
        store.getState().actions.deletePureKeypair("retired")
      ).rejects.toThrow(/flag=wasCodexGuard/);
    });

    it("REJECTS deletion when target has isDuoPurePrime: true, role=payment", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [
            pure("dpp", { isDuoPurePrime: true, duoPurePrimeRole: "payment" }),
          ],
        })
      );
      await expect(
        store.getState().actions.deletePureKeypair("dpp")
      ).rejects.toThrow(/flag=isDuoPurePrime/);
    });

    it("REJECTS deletion when target has isDuoPurePrime: true, role=guard", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [
            pure("dpp", { isDuoPurePrime: true, duoPurePrimeRole: "guard" }),
          ],
        })
      );
      await expect(
        store.getState().actions.deletePureKeypair("dpp")
      ).rejects.toThrow(/flag=isDuoPurePrime/);
    });

    it("reports the highest-priority flag (isCodexGuard) on a hybrid entry", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [
            pure("hybrid", {
              isCodexGuard: true,
              wasCodexGuard: true,
              isDuoPurePrime: true,
            }),
          ],
        })
      );
      // Priority cascade isCodexGuard > wasCodexGuard > isDuoPurePrime: the
      // detail must name the winning flag so a reorder trips this test.
      await expect(
        store.getState().actions.deletePureKeypair("hybrid")
      ).rejects.toThrow(/flag=isCodexGuard/);
    });
  });

  describe("allows regular keys", () => {
    it("ALLOWS deletion of a key with isCodexGuard: false (explicit)", async () => {
      const store = await storeWith(
        baseSnapshot({ pureKeypairs: [pure("reg", { isCodexGuard: false })] })
      );
      await store.getState().actions.deletePureKeypair("reg");
      expect(store.getState().pureKeypairs.map((k) => k.id)).not.toContain("reg");
    });

    it("ALLOWS deletion of a key with all flags undefined", async () => {
      const store = await storeWith(
        baseSnapshot({ pureKeypairs: [pure("plain")] })
      );
      await store.getState().actions.deletePureKeypair("plain");
      expect(store.getState().pureKeypairs).toHaveLength(0);
    });

    it("ALLOWS deletion of a key with role set but no isDuoPurePrime flag", async () => {
      // F-003 invalid hybrid: role without the flag is NOT protection-significant.
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("rolly", { duoPurePrimeRole: "guard" })],
        })
      );
      await store.getState().actions.deletePureKeypair("rolly");
      expect(store.getState().pureKeypairs.map((k) => k.id)).not.toContain("rolly");
    });
  });

  describe("missing-id behavior preserved", () => {
    it("does NOT throw and is a no-op for a non-existent id", async () => {
      const store = await storeWith(
        baseSnapshot({ pureKeypairs: [pure("keep")] })
      );
      await expect(
        store.getState().actions.deletePureKeypair("non-existent-id")
      ).resolves.toBeUndefined();
      expect(store.getState().pureKeypairs.map((k) => k.id)).toEqual(["keep"]);
    });
  });

  describe("regression — existing Prime protections unchanged", () => {
    it("deleteOuroAccount still throws CodexPrimeProtectedError on a prime ouro", async () => {
      const primeOuro = {
        id: "po",
        name: "Prime",
        version: "1.0.0",
        isSmart: false,
        address: "Ѻ.po",
        guard: null,
        stoaChainLedger: null,
        publicKey: "pk-po",
        secret: "s-po",
        backup: "b-po",
        isPrime: true,
      } as IOuroAccount;
      const store = await storeWith(
        baseSnapshot({ ouroAccounts: [primeOuro] })
      );
      await expect(
        store.getState().actions.deleteOuroAccount("po")
      ).rejects.toBeInstanceOf(CodexPrimeProtectedError);
    });

    it("deleteStoaChainSeed still throws CodexPrimeSeedProtectedError on a prime seed", async () => {
      const primeSeed = {
        id: "ps",
        name: "PrimeSeed",
        seedType: "koala",
        version: "1.0.0",
        index: 0,
        secret: "enc",
        main: "k:" + "0".repeat(64),
        createdAt: "2026-05-24T10:00:00.000Z",
        accounts: [],
        isPrime: true,
      } as IStoaChainSeed;
      const store = await storeWith(
        baseSnapshot({ kadenaSeeds: [primeSeed] })
      );
      await expect(
        store.getState().actions.deleteStoaChainSeed("ps")
      ).rejects.toBeInstanceOf(CodexPrimeSeedProtectedError);
    });
  });

  it("CodexGuardError thrown for delete-rejected is an instanceof CodexGuardError", async () => {
    const store = await storeWith(
      baseSnapshot({ pureKeypairs: [pure("kg", { isCodexGuard: true })] })
    );
    await expect(
      store.getState().actions.deletePureKeypair("kg")
    ).rejects.toBeInstanceOf(CodexGuardError);
  });
});
