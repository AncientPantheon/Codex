/**
 * LOCKED ENTITIES — one reason-returning predicate per entity type, each
 * answering exactly *"would the store refuse to delete this?"*.
 *
 * These exist because protection was enforced in four places and communicated
 * in five different ways, so four surfaces offered the owner a live Delete on
 * something the store refuses. The medallion's honesty rests on these
 * answers, and the REASON (not a bare boolean) is what lets the medallion's
 * tooltip and the store's thrown error name the same thing.
 */

import { describe, it, expect } from "vitest";
import {
  ouronetAccountLock,
  chainwebSeedLock,
  chainwebKeyPositionLock,
  pureKeypairLock,
  arweaveSeedLock,
} from "../src/codex/lockedEntities.js";
import type { EntityLock } from "../src/codex/lockedEntities.js";
import type { MasterKeyLock } from "../src/codex/masterKeyLocks.js";
import { OURONET_CODEX_MASTER } from "../src/codex/masterNames.js";

/** Every lock must name a reason AND carry owner-facing words for it — a
 *  medallion with an empty tooltip is the silent failure all over again. */
const reasonOf = (lock: EntityLock | null): string | null => {
  if (lock === null) return null;
  expect(lock.label.length).toBeGreaterThan(0);
  return lock.reason;
};

describe("ouronetAccountLock", () => {
  it("locks the account carrying isPrime — the flag the STORE reads", () => {
    // Bug 4, the finalize->seal window: `isPrime` moves at finalize, but the
    // tab's master identity answers `accounts[0]` until the seal. Reading the
    // flag off the account itself is what protects a promoted account sitting
    // at a non-zero index, the moment finalize moves it.
    expect(reasonOf(ouronetAccountLock({ id: "a1", isPrime: true }))).toBe(
      "codex-prime-account"
    );
  });

  it("locks an account that has encrypted a confirmed ArWeave upload", () => {
    // Bug 3: `deleteOuroAccount` throws
    // `CodexArweaveEncryptionProtectedError` on this flag and the tab never
    // read it, so the owner got an enabled button and a silent failure.
    expect(
      reasonOf(ouronetAccountLock({ id: "a2", hasEncryptedArweaveUpload: true }))
    ).toBe("arweave-encryption-upload");
  });

  it("does NOT claim un-protection from a false or absent upload flag", () => {
    // Design B6: `true` is authoritative, its absence is not — the real
    // answer needs an async chain query. The medallion may claim protection,
    // never un-protection, so a `false` here must read as "no local reason",
    // not as "safe to delete".
    expect(ouronetAccountLock({ id: "a2", hasEncryptedArweaveUpload: false })).toBeNull();
    expect(ouronetAccountLock({ id: "a2" })).toBeNull();
  });

  it("locks the settled master account by identity", () => {
    expect(
      reasonOf(ouronetAccountLock({ id: "a3" }, { masterAccountId: "a3" }))
    ).toBe("settled-master-account");
  });

  it("locks an APOLLO CodexID prime half", () => {
    expect(reasonOf(ouronetAccountLock({ id: "a4" }, { isCodexIdHalf: true }))).toBe(
      "codex-id-half"
    );
  });

  it("reports the reason the STORE would throw first when several apply", () => {
    // The medallion and the error banner must name the same thing. The store
    // checks `isPrime` before `hasEncryptedArweaveUpload`, and refuses on
    // neither of the two UI-widened reasons, so the enforced ones win.
    expect(
      reasonOf(
        ouronetAccountLock(
          { id: "a5", isPrime: true, hasEncryptedArweaveUpload: true },
          { masterAccountId: "a5", isCodexIdHalf: true }
        )
      )
    ).toBe("codex-prime-account");
    expect(
      reasonOf(
        ouronetAccountLock(
          { id: "a5", hasEncryptedArweaveUpload: true },
          { masterAccountId: "a5" }
        )
      )
    ).toBe("arweave-encryption-upload");
  });

  it("leaves an ordinary account unlocked", () => {
    expect(ouronetAccountLock({ id: "a6" }, { masterAccountId: "a3" })).toBeNull();
    expect(ouronetAccountLock({ id: "a6", isPrime: false })).toBeNull();
    expect(ouronetAccountLock(undefined)).toBeNull();
  });
});

// A guard keyset may draw keys from several seeds at several positions, so
// the registry is many-to-many. These fixtures are the shape the store holds.
const LOCKS: readonly MasterKeyLock[] = [
  { seedId: "seed-A", position: 3, reason: "master-guard-key" },
  { seedId: "seed-B", position: 0, reason: "master-payment-key" },
];

describe("chainwebSeedLock", () => {
  it("locks a NON-prime seed that holds a master-key lock — the owner's own case", () => {
    // Bug 1: `deleteStoaChainSeed` throws `CodexMasterKeyLockedError` on any
    // held lock, while the seeds menu gated Delete on `isPrime` alone. The
    // reason travels verbatim from the registry so the medallion says what
    // the error says.
    expect(reasonOf(chainwebSeedLock({ id: "seed-A" }, LOCKS))).toBe("master-guard-key");
    expect(reasonOf(chainwebSeedLock({ id: "seed-B" }, LOCKS))).toBe("master-payment-key");
  });

  it("locks the prime seed, which the store refuses by identity", () => {
    expect(reasonOf(chainwebSeedLock({ id: "seed-C", isPrime: true }, LOCKS))).toBe(
      "prime-chainweb-seed"
    );
  });

  it("leaves a seed holding NO lock deletable", () => {
    expect(chainwebSeedLock({ id: "seed-C" }, LOCKS)).toBeNull();
    expect(chainwebSeedLock({ id: "seed-A" }, [])).toBeNull();
    expect(chainwebSeedLock({ id: "seed-A" }, undefined)).toBeNull();
    expect(chainwebSeedLock(undefined, LOCKS)).toBeNull();
  });
});

describe("chainwebKeyPositionLock", () => {
  it("locks exactly the locked position, and no other position on that seed", () => {
    // Bug 2, the worse one: `updateStoaChainSeed` is the only route by which
    // a position disappears and it enforces this set, while `KeyRow` disabled
    // delete only for prime+index 0 and `handleDeleteKey` had no catch at all.
    expect(reasonOf(chainwebKeyPositionLock("seed-A", 3, LOCKS))).toBe("master-guard-key");
    expect(chainwebKeyPositionLock("seed-A", 2, LOCKS)).toBeNull();
  });

  it("does not leak a lock across seeds at the same position", () => {
    expect(chainwebKeyPositionLock("seed-A", 0, LOCKS)).toBeNull();
  });

  it("locks position 0 of a PRIME seed with no registry entry at all", () => {
    // Today's cosmetic UI rule, stated once here instead of being re-derived
    // at each key row. No lock names seed-C.
    expect(reasonOf(chainwebKeyPositionLock("seed-C", 0, LOCKS, { seedIsPrime: true }))).toBe(
      "prime-chainweb-seed"
    );
    expect(chainwebKeyPositionLock("seed-C", 1, LOCKS, { seedIsPrime: true })).toBeNull();
  });

  it("prefers the registry's reason over the cosmetic prime rule", () => {
    // The registry entry is the one the store will actually throw on; naming
    // the cosmetic rule instead would send the owner to the wrong remedy.
    expect(
      reasonOf(chainwebKeyPositionLock("seed-B", 0, LOCKS, { seedIsPrime: true }))
    ).toBe("master-payment-key");
  });

  it("leaves every position unlocked on a plain seed with no locks", () => {
    expect(chainwebKeyPositionLock("seed-C", 0, undefined)).toBeNull();
    expect(chainwebKeyPositionLock("seed-C", 0, [])).toBeNull();
    expect(chainwebKeyPositionLock(undefined, 0, LOCKS)).toBeNull();
  });
});

describe("pureKeypairLock", () => {
  it("locks a serving CodexGuard, and says so in the surface's own words", () => {
    const lock = pureKeypairLock({ isCodexGuard: true });
    expect(reasonOf(lock)).toBe("codex-guard-key");
    expect(lock?.label).toContain("CodexGuard");
  });

  it("locks a RETIRED guard, which the codex keeps forever", () => {
    const lock = pureKeypairLock({ wasCodexGuard: true });
    expect(reasonOf(lock)).toBe("retired-codex-guard-key");
    expect(lock?.label).toContain("retired guard");
  });

  it("locks the duo pure prime under the master's own name", () => {
    const lock = pureKeypairLock({ isDuoPurePrime: true });
    expect(reasonOf(lock)).toBe("duo-pure-prime-key");
    expect(lock?.label).toContain(OURONET_CODEX_MASTER);
  });

  it("keeps the existing label precedence when a key carries several flags", () => {
    // `PureKeypairsTab`'s ladder is CodexGuard -> retired guard -> master, and
    // a faithful swap must not re-order it: a key that is serving today reads
    // as serving, not as retired.
    expect(
      reasonOf(pureKeypairLock({ isCodexGuard: true, wasCodexGuard: true, isDuoPurePrime: true }))
    ).toBe("codex-guard-key");
    expect(reasonOf(pureKeypairLock({ wasCodexGuard: true, isDuoPurePrime: true }))).toBe(
      "retired-codex-guard-key"
    );
  });

  it("leaves an unflagged key deletable", () => {
    expect(pureKeypairLock({})).toBeNull();
    expect(
      pureKeypairLock({ isCodexGuard: false, wasCodexGuard: false, isDuoPurePrime: false })
    ).toBeNull();
    expect(pureKeypairLock(undefined)).toBeNull();
  });
});

describe("arweaveSeedLock", () => {
  it("locks the SETTLED Master ArWeave Seed by identity", () => {
    expect(reasonOf(arweaveSeedLock({ id: "aws-2" }, "aws-2"))).toBe("master-arweave-seed");
  });

  it("also locks an isPrime seed, the pre-settlement rule", () => {
    // `deleteStoaChainSeed` already protects its own face this way, and
    // `resolveMasterArweaveSeed` falls back to it. A codex that has not
    // re-run the wizard has no settled id at all.
    expect(reasonOf(arweaveSeedLock({ id: "aws-1", isPrime: true }, undefined))).toBe(
      "master-arweave-seed"
    );
    expect(reasonOf(arweaveSeedLock({ id: "aws-1", isPrime: true }, "aws-2"))).toBe(
      "master-arweave-seed"
    );
  });

  it("leaves an ordinary seed deletable, even when it sits first in the list", () => {
    // Deliberately NOT `resolveMasterArweaveSeed`'s position-0 branch: that
    // is a DISPLAY fallback, and the store cannot defend an
    // insertion-ordered index.
    expect(arweaveSeedLock({ id: "aws-1" }, "aws-2")).toBeNull();
    expect(arweaveSeedLock({ id: "aws-1" }, undefined)).toBeNull();
    expect(arweaveSeedLock({ id: "aws-1" }, null)).toBeNull();
    expect(arweaveSeedLock({ id: "aws-1", isPrime: false }, "")).toBeNull();
    expect(arweaveSeedLock(undefined, "aws-1")).toBeNull();
  });
});
