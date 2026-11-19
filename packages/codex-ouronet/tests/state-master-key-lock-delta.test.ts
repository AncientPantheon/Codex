/**
 * `computeMasterKeyLockDelta` — the reconcile at the heart of Secure Master
 * Account, kept pure so every branch is testable without a chain.
 *
 * The owner's requirement in one line: *"when that namespace keyset would
 * change, so too should the not-remove tags of seeds and keys."* So this
 * both ADDS and RELEASES, and the releasing half is where the danger is.
 */

import { describe, it, expect } from "vitest";
import { computeMasterKeyLockDelta } from "../src/state/masterKeyLockDelta.js";
import type { IStoaChainSeed } from "../src/types/entities.js";
import type { MasterKeyLock } from "@ancientpantheon/codex-core";

const PAY = "a".repeat(64);
const GRD = "b".repeat(64);
const OTHER = "c".repeat(64);

const seed = (id: string, keysByIndex: Record<number, string>): IStoaChainSeed => ({
  id, name: id, seedType: "stoic", version: "1.0.0", index: 0,
  secret: "ct", main: "", createdAt: "2026-10-27T10:00:00.000Z",
  accounts: Object.entries(keysByIndex).map(([i, publicKey]) => ({
    index: Number(i), publicKey, derivationPath: `m'/44'/626'/${i}'`,
  })),
});

const SEEDS = [seed("seed-1", { 0: PAY, 1: GRD }), seed("seed-2", { 0: OTHER })];

describe("computeMasterKeyLockDelta", () => {
  it("locks the payment key and the guard keys at the positions that hold them", () => {
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: PAY, guardPublicKeys: [GRD], seeds: SEEDS, currentLocks: [],
    });

    expect(d.add).toEqual([
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ]);
    expect(d.release).toEqual([]);
    expect(d.unmatchedKeys).toEqual([]);
  });

  it("is a NO-OP on an identical re-run (the common case: nothing changed)", () => {
    const current: MasterKeyLock[] = [
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ];
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: PAY, guardPublicKeys: [GRD], seeds: SEEDS, currentLocks: current,
    });

    expect(d.add).toEqual([]);
    expect(d.release).toEqual([]);
  });

  it("RELEASES a lock whose key is no longer in the guard, and adds the replacement, in one pass", () => {
    const current: MasterKeyLock[] = [
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ];
    // The owner changed the on-chain keyset: it now names OTHER, not GRD.
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: PAY, guardPublicKeys: [OTHER], seeds: SEEDS, currentLocks: current,
    });

    expect(d.release).toEqual([{ seedId: "seed-1", position: 1, reason: "master-guard-key" }]);
    expect(d.add).toEqual([{ seedId: "seed-2", position: 0, reason: "master-guard-key" }]);
  });

  it("changes only the REASON when a key moves from guard to payment", () => {
    const current: MasterKeyLock[] = [
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ];
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: GRD, guardPublicKeys: [], seeds: SEEDS, currentLocks: current,
    });

    expect(d.add).toEqual([{ seedId: "seed-1", position: 1, reason: "master-payment-key" }]);
    expect(d.release).toEqual([{ seedId: "seed-1", position: 1, reason: "master-guard-key" }]);
  });

  it("locks EVERY position holding the key when the same key sits in two seeds", () => {
    // Over-locking is safe; under-locking loses access to the master account.
    const dupes = [seed("seed-1", { 0: PAY }), seed("seed-2", { 5: PAY })];
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: PAY, guardPublicKeys: [], seeds: dupes, currentLocks: [],
    });

    expect(d.add).toEqual([
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
      { seedId: "seed-2", position: 5, reason: "master-payment-key" },
    ]);
  });

  it("REPORTS a key that is in use but not held in this codex, rather than ignoring it", () => {
    const foreign = "f".repeat(64);
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: PAY, guardPublicKeys: [foreign], seeds: SEEDS, currentLocks: [],
    });

    expect(d.unmatchedKeys).toEqual([{ publicKey: foreign, reason: "master-guard-key" }]);
    // ...and it does not block locking the keys that ARE present.
    expect(d.add).toEqual([{ seedId: "seed-1", position: 0, reason: "master-payment-key" }]);
  });

  it("NEVER releases guard locks when the guard could not be resolved (guardPublicKeys === null)", () => {
    // THE safety property. `resolveGuardKeys` returns null keys for an
    // unresolved keyset reference; treating that as "no guard keys in use"
    // would release every guard lock on a flaky chain read and silently
    // re-permit deleting the keys guarding the master account.
    const current: MasterKeyLock[] = [
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ];
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: PAY, guardPublicKeys: null, seeds: SEEDS, currentLocks: current,
    });

    expect(d.release).toEqual([]);
    expect(d.add).toEqual([]);
    expect(d.guardUnresolved).toBe(true);
  });

  it("does not release the payment lock when the payment key is unknown (null)", () => {
    const current: MasterKeyLock[] = [
      { seedId: "seed-1", position: 0, reason: "master-payment-key" },
    ];
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: null, guardPublicKeys: [GRD], seeds: SEEDS, currentLocks: current,
    });

    expect(d.release).toEqual([]);
    expect(d.add).toEqual([{ seedId: "seed-1", position: 1, reason: "master-guard-key" }]);
  });

  it("keeps a position locked under its OTHER reason when only one reason lapses", () => {
    const current: MasterKeyLock[] = [
      { seedId: "seed-1", position: 1, reason: "master-payment-key" },
      { seedId: "seed-1", position: 1, reason: "master-guard-key" },
    ];
    // Position 1's key is still the guard, but no longer the payment key.
    const d = computeMasterKeyLockDelta({
      paymentPublicKey: PAY, guardPublicKeys: [GRD], seeds: SEEDS, currentLocks: current,
    });

    expect(d.release).toEqual([{ seedId: "seed-1", position: 1, reason: "master-payment-key" }]);
    expect(d.add).toEqual([{ seedId: "seed-1", position: 0, reason: "master-payment-key" }]);
    // The guard reason on position 1 is untouched, so it stays locked.
    expect(d.release).not.toContainEqual({
      seedId: "seed-1", position: 1, reason: "master-guard-key",
    });
  });
});
