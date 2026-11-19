/**
 * LOCKED-ENTITY PARITY — the predicates and the store, pinned to each other.
 *
 * `codex-core`'s `lockedEntities` predicates exist to answer one question for
 * the UI: *would the store refuse to delete this?* The medallion is rendered
 * from that answer and the delete control is withheld from it
 * (locked-entities-and-former-prime/design.md §B4). So the predicates are only
 * worth anything while they agree with the store — and nothing in either file
 * forces that. Protection used to be enforced in four places and communicated
 * in five different ways precisely because no test held the two together.
 *
 * This file is that test. For every entity type it drives BOTH sides off the
 * SAME live store:
 *
 *   - the predicate is called with the entity read out of `store.getState()`,
 *     never with a hand-built literal that could drift from what was stored;
 *   - the refusal is the REAL store action, awaited and caught.
 *
 * The invariant asserted is stronger than "both say no": when the predicate
 * reports a store-enforced reason, the store must refuse with the error class
 * that reason NAMES ({@link STORE_ERROR_FOR_REASON}). A medallion reporting
 * `master-payment-key` while the store throws `CodexPrimeSeedProtectedError`
 * would send the owner to the wrong remedy, and that is as much a drift as a
 * missing refusal.
 *
 * ## The two deliberate one-way widenings
 *
 * The predicates are a SUPERSET of the store, never a subset — design.md §B6:
 * *"The medallion may claim protection, never un-protection."* Three locks
 * have no store counterpart and are mapped to `null` in the table below:
 * `settled-master-account`, `codex-id-half` (both UI-level: the store's
 * `deleteOuroAccount` reads only `isPrime` and `hasEncryptedArweaveUpload`)
 * and `prime-chainweb-seed` at key POSITION 0, today's cosmetic seeds-UI rule
 * that `updateStoaChainSeed` does not enforce. They are asserted here as
 * widenings rather than left untested, so that closing one of them later is a
 * deliberate edit to this table and not a silent surprise.
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type {
  CodexAdapter,
  CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexError,
  CodexMasterKeyLockedError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  IOuroAccount,
  IPureKeypair,
  IStoaChainSeed,
} from "@ancientpantheon/codex-ouronet/types";
import {
  arweaveSeedLock,
  chainwebKeyPositionLock,
  chainwebSeedLock,
  ouronetAccountLock,
  pureKeypairLock,
} from "@ancientpantheon/codex-core";
import type {
  EntityLock,
  EntityLockReason,
  MasterKeyLock,
} from "@ancientpantheon/codex-core";

// ---------------------------------------------------------------------------
// The table: every lock reason, and the store error it must produce
// ---------------------------------------------------------------------------

/**
 * `null` = a UI-level widening, i.e. the predicate locks and the store
 * accepts. `satisfies` makes the exhaustiveness a COMPILE error: a new
 * `EntityLockReason` added to codex-core without a decision recorded here
 * fails `npm run typecheck`, which is the earliest moment the question
 * "does the store enforce this one?" can be forced.
 */
const STORE_ERROR_FOR_REASON = {
  "codex-prime-account": "CodexPrimeProtectedError",
  "arweave-encryption-upload": "CodexArweaveEncryptionProtectedError",
  "settled-master-account": null,
  "codex-id-half": null,
  "prime-chainweb-seed": "CodexPrimeSeedProtectedError",
  "master-payment-key": "CodexMasterKeyLockedError",
  "master-guard-key": "CodexMasterKeyLockedError",
  "codex-guard-key": "CodexGuardError",
  "retired-codex-guard-key": "CodexGuardError",
  "duo-pure-prime-key": "CodexGuardError",
  "master-arweave-seed": "CodexMasterArweaveSeedProtectedError",
} satisfies Record<EntityLockReason, string | null>;

/** What the store did when asked. */
interface Verdict {
  readonly refused: boolean;
  readonly error?: Error;
}

async function verdictOf(attempt: () => Promise<unknown>): Promise<Verdict> {
  try {
    await attempt();
    return { refused: false };
  } catch (e) {
    return { refused: true, error: e as Error };
  }
}

/**
 * THE parity assertion.
 *
 * `storeErrorOverride` exists for the ONE lock reason that is store-enforced
 * in one scope and cosmetic in another: `prime-chainweb-seed` refuses a whole
 * SEED delete but not a key-POSITION removal.
 */
function expectParity(
  lock: EntityLock | null,
  verdict: Verdict,
  storeErrorOverride?: string | null,
): void {
  if (!lock) {
    expect(verdict.refused).toBe(false);
    return;
  }
  const expectedError =
    storeErrorOverride === undefined
      ? STORE_ERROR_FOR_REASON[lock.reason]
      : storeErrorOverride;

  expect(verdict.refused).toBe(expectedError !== null);
  if (expectedError === null) return;

  expect(verdict.error).toBeInstanceOf(CodexError);
  expect(verdict.error?.name).toBe(expectedError);
  // Every lock carries words for the owner — an unexplained medallion is the
  // same defect as an unexplained refusal.
  expect(lock.label.length).toBeGreaterThan(0);
  if (verdict.error instanceof CodexMasterKeyLockedError) {
    // `EntityLockReason` re-uses `MasterKeyLockReason` VERBATIM; this is what
    // holds the two spellings identical.
    expect(verdict.error.reason).toBe(lock.reason);
  }
}

// ---------------------------------------------------------------------------
// Fixtures + store construction (hydrated from a snapshot so no auto-prime
// rule in `addX` can quietly decide what the test is about)
// ---------------------------------------------------------------------------

const ouro = (id: string, overrides: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id,
  name: "Ouro " + id,
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ." + id,
  guard: null,
  stoaChainLedger: null,
  publicKey: "pk-" + id,
  secret: "secret-" + id,
  backup: "backup-" + id,
  ...overrides,
});

const keyAt = (index: number) => ({
  index,
  publicKey: `${index}`.repeat(64).slice(0, 64),
  derivationPath: `m'/44'/626'/${index}'`,
});

const chainwebSeed = (
  id: string,
  indices: number[],
  overrides: Partial<IStoaChainSeed> = {},
): IStoaChainSeed => ({
  id,
  name: "Seed " + id,
  seedType: "stoic",
  version: "1.0.0",
  index: 0,
  secret: "ciphertext",
  main: "",
  createdAt: "2026-11-01T10:00:00.000Z",
  accounts: indices.map(keyAt),
  ...overrides,
});

const pure = (id: string, overrides: Partial<IPureKeypair> = {}): IPureKeypair => ({
  id,
  label: "Pure " + id,
  publicKey: "f".repeat(64),
  encryptedPrivateKey: "enc-pk",
  createdAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

type ArweaveSeed = NonNullable<CodexSnapshot["arweaveSeeds"]>[number];

const arweaveSeed = (id: string, overrides: Partial<ArweaveSeed> = {}): ArweaveSeed => ({
  id,
  name: "ArWeave " + id,
  secret: "ENC(v2:bitstring-ciphertext)",
  createdAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

async function storeWith(overrides: Partial<CodexSnapshot>) {
  const snap: CodexSnapshot = {
    ...emptySnapshot("dev"),
    schemaVersion: 1,
    ...overrides,
  };
  const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll(snap);
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  return store;
}

const MASTER_SEED_ROW = {
  ouroAccountId: "settled-master",
  chainwebSeedId: "kseed-1",
  establishedAt: "2026-11-01T09:00:00.000Z",
} as const;

// ---------------------------------------------------------------------------
// Ouronet accounts — deleteOuroAccount
// ---------------------------------------------------------------------------

describe("parity: ouronetAccountLock ⇔ deleteOuroAccount", () => {
  async function run(accounts: IOuroAccount[], id: string, masterRow?: CodexSnapshot["codexMasterSeed"]) {
    const store = await storeWith({ ouroAccounts: accounts, codexMasterSeed: masterRow });
    const live = store.getState().ouroAccounts.find((a) => a.id === id);
    const lock = ouronetAccountLock(live, {
      masterAccountId: store.getState().codexMasterSeed?.ouroAccountId,
    });
    const verdict = await verdictOf(() => store.getState().actions.deleteOuroAccount(id));
    const survived = store.getState().ouroAccounts.some((a) => a.id === id);
    return { lock, verdict, survived };
  }

  it("CodexPrime: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run([ouro("prime", { isPrime: true })], "prime");
    expect(lock?.reason).toBe("codex-prime-account");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("hasEncryptedArweaveUpload: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run(
      [ouro("enc", { hasEncryptedArweaveUpload: true })],
      "enc",
    );
    expect(lock?.reason).toBe("arweave-encryption-upload");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("a plain account: not locked, and the store deletes it", async () => {
    const { lock, verdict, survived } = await run([ouro("plain")], "plain");
    expect(lock).toBeNull();
    expectParity(lock, verdict);
    expect(survived).toBe(false);
  });

  // The REASON, not just the refusal. The predicate's check order mirrors
  // `deleteOuroAccount`'s own, so an account tripping two rules is reported
  // under the one the store will actually throw.
  it("prime AND encryption-protected: reports the reason the store throws (prime first)", async () => {
    const { lock, verdict } = await run(
      [ouro("both", { isPrime: true, hasEncryptedArweaveUpload: true })],
      "both",
    );
    expect(lock?.reason).toBe("codex-prime-account");
    expect(verdict.error?.name).toBe("CodexPrimeProtectedError");
    expectParity(lock, verdict);
  });

  it("encryption-protected AND the settled master: reports the store-enforced reason", async () => {
    const { lock, verdict } = await run(
      [ouro("settled-master", { hasEncryptedArweaveUpload: true })],
      "settled-master",
      MASTER_SEED_ROW,
    );
    // NOT "settled-master-account" — that one the store does not enforce, so
    // reporting it would name a remedy the refusal is not about.
    expect(lock?.reason).toBe("arweave-encryption-upload");
    expectParity(lock, verdict);
  });

  // WIDENING (design.md §B6). Recorded, not accidental.
  it("the settled master with no store-enforced flag: locked for the UI, accepted by the store", async () => {
    const { lock, verdict, survived } = await run(
      [ouro("settled-master")],
      "settled-master",
      MASTER_SEED_ROW,
    );
    expect(lock?.reason).toBe("settled-master-account");
    expect(STORE_ERROR_FOR_REASON["settled-master-account"]).toBeNull();
    expectParity(lock, verdict);
    expect(survived).toBe(false);
  });

  it("a CodexID half: locked for the UI, accepted by the store", async () => {
    const store = await storeWith({ ouroAccounts: [ouro("half")] });
    const live = store.getState().ouroAccounts.find((a) => a.id === "half");
    const lock = ouronetAccountLock(live, { isCodexIdHalf: true });
    const verdict = await verdictOf(() => store.getState().actions.deleteOuroAccount("half"));

    expect(lock?.reason).toBe("codex-id-half");
    expect(STORE_ERROR_FOR_REASON["codex-id-half"]).toBeNull();
    expectParity(lock, verdict);
  });
});

// ---------------------------------------------------------------------------
// Chainweb seeds — deleteStoaChainSeed
// ---------------------------------------------------------------------------

describe("parity: chainwebSeedLock ⇔ deleteStoaChainSeed", () => {
  // A codex whose seeds carry NO prime flag is a pre-v0.2 codex, and `init`
  // back-fills `kadenaSeeds[0].isPrime` on hydrate. So every non-prime case
  // ships this sentinel first — otherwise the seed under test silently
  // becomes the prime and the case stops being about what it says.
  const PRIME_SENTINEL = chainwebSeed("kseed-prime", [0], { isPrime: true });

  async function run(seeds: IStoaChainSeed[], locks: MasterKeyLock[], id: string) {
    const store = await storeWith({ kadenaSeeds: seeds, masterKeyLocks: locks });
    const live = store.getState().kadenaSeeds.find((s) => s.id === id);
    const lock = chainwebSeedLock(live, store.getState().masterKeyLocks);
    const verdict = await verdictOf(() => store.getState().actions.deleteStoaChainSeed(id));
    const survived = store.getState().kadenaSeeds.some((s) => s.id === id);
    return { lock, verdict, survived };
  }

  it("the Prime Codex Seed: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run(
      [chainwebSeed("kseed-1", [0], { isPrime: true })],
      [],
      "kseed-1",
    );
    expect(lock?.reason).toBe("prime-chainweb-seed");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  // The owner's own case: a NON-prime seed holding a master-key lock. The
  // seeds menu gated delete on `isPrime` alone, so this one showed a live
  // Delete the store refuses.
  it("a non-prime seed holding a master-key lock: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run(
      [PRIME_SENTINEL, chainwebSeed("kseed-2", [0, 1])],
      [{ seedId: "kseed-2", position: 1, reason: "master-guard-key" }],
      "kseed-2",
    );
    expect(lock?.reason).toBe("master-guard-key");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("an unheld non-prime seed: not locked, and the store deletes it", async () => {
    const { lock, verdict, survived } = await run(
      [PRIME_SENTINEL, chainwebSeed("kseed-3", [0])],
      [{ seedId: "kseed-2", position: 1, reason: "master-guard-key" }],
      "kseed-3",
    );
    expect(lock).toBeNull();
    expectParity(lock, verdict);
    expect(survived).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chainweb key positions — updateStoaChainSeed (the only route a position
// can disappear by)
// ---------------------------------------------------------------------------

describe("parity: chainwebKeyPositionLock ⇔ updateStoaChainSeed", () => {
  async function run(seed: IStoaChainSeed, locks: MasterKeyLock[], dropped: number) {
    // Same pre-v0.2 back-fill guard as the describe above.
    const seeds = seed.isPrime === true
      ? [seed]
      : [chainwebSeed("kseed-prime", [0], { isPrime: true }), seed];
    const store = await storeWith({ kadenaSeeds: seeds, masterKeyLocks: locks });
    const live = store.getState().kadenaSeeds.find((s) => s.id === seed.id)!;
    const lock = chainwebKeyPositionLock(live.id, dropped, store.getState().masterKeyLocks, {
      seedIsPrime: live.isPrime,
    });
    const verdict = await verdictOf(() =>
      store
        .getState()
        .actions.updateStoaChainSeed({
          ...live,
          accounts: live.accounts.filter((a) => a.index !== dropped),
        }),
    );
    const survived = store
      .getState()
      .kadenaSeeds.find((s) => s.id === seed.id)!
      .accounts.some((a) => a.index === dropped);
    return { lock, verdict, survived };
  }

  it("dropping a LOCKED position: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run(
      chainwebSeed("kseed-1", [0, 1, 2]),
      [{ seedId: "kseed-1", position: 1, reason: "master-payment-key" }],
      1,
    );
    expect(lock?.reason).toBe("master-payment-key");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("dropping an UNLOCKED position of the same seed: not locked, and the store accepts", async () => {
    const { lock, verdict, survived } = await run(
      chainwebSeed("kseed-1", [0, 1, 2]),
      [{ seedId: "kseed-1", position: 1, reason: "master-payment-key" }],
      2,
    );
    expect(lock).toBeNull();
    expectParity(lock, verdict);
    expect(survived).toBe(false);
  });

  // WIDENING: the seeds UI's cosmetic "first key of the Prime seed" rule,
  // which `updateStoaChainSeed` has never enforced. Stated once here instead
  // of being re-derived per key row.
  it("dropping key 0 of the Prime seed with no registry lock: locked for the UI, accepted by the store", async () => {
    const { lock, verdict, survived } = await run(
      chainwebSeed("kseed-1", [0, 1], { isPrime: true }),
      [],
      0,
    );
    expect(lock?.reason).toBe("prime-chainweb-seed");
    expectParity(lock, verdict, null);
    expect(survived).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pure keypairs — deletePureKeypair
// ---------------------------------------------------------------------------

describe("parity: pureKeypairLock ⇔ deletePureKeypair", () => {
  async function run(keypairs: IPureKeypair[], id: string) {
    const store = await storeWith({ pureKeypairs: keypairs });
    const live = store.getState().pureKeypairs.find((k) => k.id === id);
    const lock = pureKeypairLock(live);
    const verdict = await verdictOf(() => store.getState().actions.deletePureKeypair(id));
    const survived = store.getState().pureKeypairs.some((k) => k.id === id);
    return { lock, verdict, survived };
  }

  it("the serving CodexGuard: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run([pure("kg", { isCodexGuard: true })], "kg");
    expect(lock?.reason).toBe("codex-guard-key");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("a retired guard: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run([pure("old", { wasCodexGuard: true })], "old");
    expect(lock?.reason).toBe("retired-codex-guard-key");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("a DuoPurePrime key: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run(
      [pure("dpp", { isDuoPurePrime: true, duoPurePrimeRole: "payment" })],
      "dpp",
    );
    expect(lock?.reason).toBe("duo-pure-prime-key");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("a plain pure keypair: not locked, and the store deletes it", async () => {
    const { lock, verdict, survived } = await run([pure("plain")], "plain");
    expect(lock).toBeNull();
    expectParity(lock, verdict);
    expect(survived).toBe(false);
  });

  // The store puts the offending FLAG in its detail string, in its own
  // priority order. A key serving today must read as serving, not as retired,
  // on both sides.
  it("serving AND retired: both sides name the serving role", async () => {
    const { lock, verdict } = await run(
      [pure("both", { isCodexGuard: true, wasCodexGuard: true })],
      "both",
    );
    expect(lock?.reason).toBe("codex-guard-key");
    expect(verdict.error?.message).toContain("flag=isCodexGuard");
    expectParity(lock, verdict);
  });
});

// ---------------------------------------------------------------------------
// ArWeave seeds — deleteArweaveSeed (the face that had no guard at any layer)
// ---------------------------------------------------------------------------

describe("parity: arweaveSeedLock ⇔ deleteArweaveSeed", () => {
  async function run(
    seeds: ArweaveSeed[],
    id: string,
    masterRow?: CodexSnapshot["codexMasterSeed"],
  ) {
    const store = await storeWith({ arweaveSeeds: seeds, codexMasterSeed: masterRow });
    const live = store.getState().arweaveSeeds.find((s) => s.id === id);
    const lock = arweaveSeedLock(live, store.getState().codexMasterSeed?.arweaveSeedId);
    const verdict = await verdictOf(() => store.getState().actions.deleteArweaveSeed(id));
    const survived = store.getState().arweaveSeeds.some((s) => s.id === id);
    return { lock, verdict, survived };
  }

  it("the SETTLED Master ArWeave Seed: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run(
      [arweaveSeed("aws-settled", { isPrime: false })],
      "aws-settled",
      { ...MASTER_SEED_ROW, arweaveSeedId: "aws-settled" },
    );
    expect(lock?.reason).toBe("master-arweave-seed");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("the prime seed on a codex with no settled row: locked, and the store refuses", async () => {
    const { lock, verdict, survived } = await run(
      [arweaveSeed("aws-prime", { isPrime: true })],
      "aws-prime",
    );
    expect(lock?.reason).toBe("master-arweave-seed");
    expectParity(lock, verdict);
    expect(survived).toBe(true);
  });

  it("a non-prime seed the row does not name: not locked, and the store deletes it", async () => {
    const { lock, verdict, survived } = await run(
      [arweaveSeed("aws-prime", { isPrime: true }), arweaveSeed("aws-2", { isPrime: false })],
      "aws-2",
      { ...MASTER_SEED_ROW, arweaveSeedId: "aws-prime" },
    );
    expect(lock).toBeNull();
    expectParity(lock, verdict);
    expect(survived).toBe(false);
  });
});
