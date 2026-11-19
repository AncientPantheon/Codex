/**
 * `secureMasterAccount` - the user-triggered rescan.
 *
 * Owner's words: *"when I know I changed said key, I would click that
 * option, the codex scans the Ouronet Master Account, and makes unremovable
 * the keys that are in its use, the payment key, and the keys that define
 * its guard."* Deliberately manual, because the chain can change without the
 * codex ever knowing.
 *
 * Driven through the STORE directly - never a button - for the same reason
 * the lock-enforcement suite is: the guarantee lives in the store, so that
 * is where it has to be proven.
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter, CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexMasterKeyLockedError } from "@ancientpantheon/codex-ouronet/errors";
import type { IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";
import type { MasterKeyLock } from "@ancientpantheon/codex-core";

const PAY = "a".repeat(64);
const GRD = "b".repeat(64);
const NEW = "c".repeat(64);

const seed = (id: string, keysByIndex: Record<number, string>): IStoaChainSeed => ({
  id, name: id, seedType: "stoic", version: "1.0.0", index: 0,
  secret: "ct", main: "", createdAt: "2026-10-27T10:00:00.000Z",
  accounts: Object.entries(keysByIndex).map(([i, publicKey]) => ({
    index: Number(i), publicKey, derivationPath: "m/44/626/" + i,
  })),
});

async function storeWith(locks: MasterKeyLock[] = []) {
  const snap: CodexSnapshot = {
    ...emptySnapshot("dev"),
    schemaVersion: 1,
    kadenaSeeds: [seed("seed-1", { 0: PAY, 1: GRD }), seed("seed-2", { 0: NEW })],
    masterKeyLocks: locks,
  };
  const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll(snap);
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  return { store, adapter };
}

describe("secureMasterAccount", () => {
  it("locks the payment key and the guard keys, and persists them", async () => {
    const { store, adapter } = await storeWith();

    const report = await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY,
      guardPublicKeys: [GRD],
    });

    expect(report.add).toHaveLength(2);
    expect(store.getState().masterKeyLocks).toEqual([
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ]);
    expect((await adapter.loadAll()).masterKeyLocks).toHaveLength(2);
  });

  it("makes those positions genuinely unremovable afterwards", async () => {
    // The whole point: the scan must produce a REAL guarantee, not a record.
    const { store } = await storeWith();
    await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [GRD],
    });

    const s = store.getState().kadenaSeeds[0]!;
    await expect(
      store.getState().actions.updateStoaChainSeed({
        ...s, accounts: s.accounts.filter((a) => a.index !== 0),
      })
    ).rejects.toBeInstanceOf(CodexMasterKeyLockedError);
  });

  it("a second identical run is a NO-OP and reports an empty delta", async () => {
    const { store } = await storeWith();
    await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [GRD],
    });

    const second = await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [GRD],
    });

    expect(second.add).toEqual([]);
    expect(second.release).toEqual([]);
    expect(store.getState().masterKeyLocks).toHaveLength(2);
  });

  it("RELEASES the stale lock and adds the new one in ONE call when the guard changed", async () => {
    // Exactly the owner's scenario: they changed the on-chain keyset, then
    // clicked Secure Master Account.
    const { store } = await storeWith();
    await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [GRD],
    });

    const report = await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [NEW],
    });

    expect(report.release).toEqual([
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ]);
    expect(report.add).toEqual([
      { seedId: "seed-2", position: 0, reason: "master-guard-key" },
    ]);
    expect(store.getState().masterKeyLocks).toEqual([
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
      { seedId: "seed-2", position: 0, reason: "master-guard-key" },
    ]);
  });

  it("the released position becomes removable again, and the new one does not", async () => {
    const { store } = await storeWith();
    await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [GRD],
    });
    await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [NEW],
    });

    // seed-1 position 1 was released -> removable
    const s1 = store.getState().kadenaSeeds.find((x) => x.id === "seed-1")!;
    await store.getState().actions.updateStoaChainSeed({
      ...s1, accounts: s1.accounts.filter((a) => a.index !== 1),
    });
    expect(
      store.getState().kadenaSeeds.find((x) => x.id === "seed-1")!.accounts.map((a) => a.index)
    ).toEqual([0]);

    // seed-2 position 0 is newly locked -> not removable
    const s2 = store.getState().kadenaSeeds.find((x) => x.id === "seed-2")!;
    await expect(
      store.getState().actions.updateStoaChainSeed({ ...s2, accounts: [] })
    ).rejects.toBeInstanceOf(CodexMasterKeyLockedError);
  });

  it("does NOT release guard locks when the guard could not be resolved", async () => {
    const { store } = await storeWith();
    await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [GRD],
    });

    const report = await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: null,
    });

    expect(report.guardUnresolved).toBe(true);
    expect(report.release).toEqual([]);
    expect(store.getState().masterKeyLocks).toHaveLength(2);
  });

  it("reports a guard key this codex does not hold instead of silently skipping it", async () => {
    const { store } = await storeWith();
    const foreign = "f".repeat(64);

    const report = await store.getState().actions.secureMasterAccount({
      paymentPublicKey: PAY, guardPublicKeys: [foreign],
    });

    expect(report.unmatchedKeys).toEqual([
      { publicKey: foreign, reason: "master-guard-key" },
    ]);
    expect(store.getState().masterKeyLocks).toEqual([
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
    ]);
  });
});
