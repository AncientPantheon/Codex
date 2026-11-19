/**
 * Master-key lock enforcement — the STORE half of the invariant.
 *
 * Why this file exists at all: before it, a derived key position had NO
 * protection of any kind. `WalletAccount` carries no flag, and positions are
 * not removed through a delete action — they vanish through
 * `updateStoaChainSeed`, a whole-object replace with zero guards. The seeds
 * UI's "Cannot delete first key of Prime seed" affordance only DISABLES A
 * BUTTON; anything not going through that exact button dropped the position
 * silently.
 *
 * So every test here calls the STORE DIRECTLY and never touches the UI. A
 * test that drove the button would have passed against the old, cosmetic
 * guarantee and proved nothing.
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

const pos = (index: number) => ({
  index,
  publicKey: `${index}`.repeat(64).slice(0, 64),
  derivationPath: `m'/44'/626'/${index}'`,
});

const seed = (id: string, indices: number[]): IStoaChainSeed => ({
  id,
  name: `Seed ${id}`,
  seedType: "stoic",
  version: "1.0.0",
  index: 0,
  secret: "ciphertext",
  main: "",
  createdAt: "2026-10-27T10:00:00.000Z",
  accounts: indices.map(pos),
});

const PAYMENT: MasterKeyLock = { seedId: "seed-1", position: 0, reason: "master-payment-key" };
const GUARD: MasterKeyLock = { seedId: "seed-1", position: 1, reason: "master-guard-key" };

async function storeWith(locks: MasterKeyLock[], seeds: IStoaChainSeed[] = [seed("seed-1", [0, 1, 2])]) {
  const snap: CodexSnapshot = {
    ...emptySnapshot("dev"),
    schemaVersion: 1,
    kadenaSeeds: seeds,
    masterKeyLocks: locks,
  };
  const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll(snap);
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  return { store, adapter };
}

describe("updateStoaChainSeed — locked positions cannot be dropped", () => {
  it("REJECTS an update whose accounts no longer contain a locked position", async () => {
    const { store } = await storeWith([PAYMENT]);
    const s = store.getState().kadenaSeeds[0]!;

    await expect(
      store.getState().actions.updateStoaChainSeed({
        ...s,
        accounts: s.accounts.filter((a) => a.index !== 0), // drop the payment key
      })
    ).rejects.toBeInstanceOf(CodexMasterKeyLockedError);
  });

  it("leaves the stored seed BYTE-IDENTICAL after a rejected update (no partial write)", async () => {
    const { store, adapter } = await storeWith([PAYMENT]);
    const before = JSON.stringify((await adapter.loadAll()).kadenaSeeds);
    const s = store.getState().kadenaSeeds[0]!;

    await expect(
      store.getState().actions.updateStoaChainSeed({
        ...s,
        accounts: s.accounts.filter((a) => a.index !== 0),
      })
    ).rejects.toBeInstanceOf(CodexMasterKeyLockedError);

    expect(JSON.stringify((await adapter.loadAll()).kadenaSeeds)).toBe(before);
    expect(store.getState().kadenaSeeds[0]!.accounts.map((a) => a.index)).toEqual([0, 1, 2]);
  });

  it("names the offending seed and position on the error", async () => {
    const { store } = await storeWith([GUARD]);
    const s = store.getState().kadenaSeeds[0]!;
    try {
      await store.getState().actions.updateStoaChainSeed({
        ...s,
        accounts: s.accounts.filter((a) => a.index !== 1),
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CodexMasterKeyLockedError);
      expect((e as CodexMasterKeyLockedError).seedId).toBe("seed-1");
      expect((e as CodexMasterKeyLockedError).position).toBe(1);
      expect((e as CodexMasterKeyLockedError).reason).toBe("master-guard-key");
    }
  });

  it("ALLOWS removing an UNLOCKED position on the same seed", async () => {
    const { store } = await storeWith([PAYMENT]);
    const s = store.getState().kadenaSeeds[0]!;

    await store.getState().actions.updateStoaChainSeed({
      ...s,
      accounts: s.accounts.filter((a) => a.index !== 2), // 2 is not locked
    });

    expect(store.getState().kadenaSeeds[0]!.accounts.map((a) => a.index)).toEqual([0, 1]);
  });

  it("ALLOWS an unrelated edit (a rename) that keeps every locked position", async () => {
    const { store } = await storeWith([PAYMENT, GUARD]);
    const s = store.getState().kadenaSeeds[0]!;

    await store.getState().actions.updateStoaChainSeed({ ...s, name: "Master Chainweb Seed" });

    expect(store.getState().kadenaSeeds[0]!.name).toBe("Master Chainweb Seed");
  });

  it("does not block updates to a DIFFERENT seed that holds no locks", async () => {
    const { store } = await storeWith([PAYMENT], [seed("seed-1", [0, 1]), seed("seed-2", [0, 1])]);
    const other = store.getState().kadenaSeeds.find((x) => x.id === "seed-2")!;

    await store.getState().actions.updateStoaChainSeed({
      ...other,
      accounts: other.accounts.filter((a) => a.index !== 0),
    });

    expect(
      store.getState().kadenaSeeds.find((x) => x.id === "seed-2")!.accounts.map((a) => a.index)
    ).toEqual([1]);
  });
});

describe("deleteStoaChainSeed — a seed holding any lock cannot be deleted", () => {
  // NOTE: these target seed-2, NOT seed-1. The schema migrations stamp
  // `isPrime` on the FIRST kadena seed, so seed-1 is already covered by the
  // older `CodexPrimeSeedProtectedError`. A lock on seed-2 is precisely the
  // case the pre-existing protection does NOT reach — a custom guard keyset
  // drawing a key from a non-prime seed — which is the whole point of this
  // invariant.
  const LOCK_ON_SEED_2: MasterKeyLock = {
    seedId: "seed-2",
    position: 0,
    reason: "master-guard-key",
  };
  const twoSeeds = () => [seed("seed-1", [0, 1]), seed("seed-2", [0, 1])];

  it("REJECTS deleting a NON-PRIME seed that holds a lock, and deletes nothing", async () => {
    const { store, adapter } = await storeWith([LOCK_ON_SEED_2], twoSeeds());

    await expect(
      store.getState().actions.deleteStoaChainSeed("seed-2")
    ).rejects.toBeInstanceOf(CodexMasterKeyLockedError);

    expect(store.getState().kadenaSeeds).toHaveLength(2);
    expect((await adapter.loadAll()).kadenaSeeds).toHaveLength(2);
  });

  it("reports position null for a whole-seed refusal", async () => {
    const { store } = await storeWith([LOCK_ON_SEED_2], twoSeeds());
    try {
      await store.getState().actions.deleteStoaChainSeed("seed-2");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CodexMasterKeyLockedError);
      expect((e as CodexMasterKeyLockedError).position).toBeNull();
      expect((e as CodexMasterKeyLockedError).seedId).toBe("seed-2");
    }
  });

  it("still defers to the PRE-EXISTING prime-seed protection for the prime seed", async () => {
    // The lock must not shadow or weaken the older guarantee.
    const { store } = await storeWith([], twoSeeds());
    await expect(
      store.getState().actions.deleteStoaChainSeed("seed-1")
    ).rejects.toMatchObject({ name: "CodexPrimeSeedProtectedError" });
  });

  it("ALLOWS deleting a seed that holds no locks", async () => {
    const { store } = await storeWith([PAYMENT], [seed("seed-1", [0, 1]), seed("seed-2", [0])]);
    await store.getState().actions.deleteStoaChainSeed("seed-2");
    expect(store.getState().kadenaSeeds.map((s) => s.id)).toEqual(["seed-1"]);
  });
});

describe("lock primitives — what Secure Master Account will call", () => {
  it("addMasterKeyLocks adds and persists", async () => {
    const { store, adapter } = await storeWith([]);
    await store.getState().actions.addMasterKeyLocks([PAYMENT]);
    expect(store.getState().masterKeyLocks).toEqual([PAYMENT]);
    expect((await adapter.loadAll()).masterKeyLocks).toEqual([PAYMENT]);
  });

  it("addMasterKeyLocks is idempotent — re-adding the same entry does not duplicate it", async () => {
    const { store } = await storeWith([PAYMENT]);
    await store.getState().actions.addMasterKeyLocks([PAYMENT]);
    expect(store.getState().masterKeyLocks).toEqual([PAYMENT]);
  });

  it("releasing a lock then permits what it blocked", async () => {
    const { store } = await storeWith([PAYMENT]);
    await store.getState().actions.releaseMasterKeyLocks((l) => l.reason === "master-payment-key");

    const s = store.getState().kadenaSeeds[0]!;
    await store.getState().actions.updateStoaChainSeed({
      ...s,
      accounts: s.accounts.filter((a) => a.index !== 0),
    });
    expect(store.getState().kadenaSeeds[0]!.accounts.map((a) => a.index)).toEqual([1, 2]);
  });

  it("a position locked under TWO reasons stays locked when only one is released", async () => {
    // The precise reason this is a reason-tagged registry and not a boolean:
    // releasing one rule must never unlock a position another rule still needs.
    const bothOnPos1: MasterKeyLock[] = [
      { seedId: "seed-1", position: 1, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ];
    const { store } = await storeWith(bothOnPos1);

    await store.getState().actions.releaseMasterKeyLocks((l) => l.reason === "master-guard-key");

    const s = store.getState().kadenaSeeds[0]!;
    await expect(
      store.getState().actions.updateStoaChainSeed({
        ...s,
        accounts: s.accounts.filter((a) => a.index !== 1),
      })
    ).rejects.toBeInstanceOf(CodexMasterKeyLockedError);
  });

  it("getMasterKeyLocks reflects the live registry", async () => {
    const { store } = await storeWith([PAYMENT, GUARD]);
    expect(store.getState().actions.getMasterKeyLocks()).toEqual([PAYMENT, GUARD]);
  });
});
