/**
 * master-ouronet-account.test.ts — the precedence chain behind WHICH Ouronet
 * account row is the codex's master (pinned first, gold, 🔒 Prime badge).
 *
 * The account-side twin of `codex-arweave`'s
 * `tests/resolve-master-arweave-seed.test.ts`, and it exists because the
 * accounts tab answered this question three incompatible ways at once: the
 * pinned row was `hydratedAccounts[0]`, the gold row was `index === 0`, and the
 * row NAMED "Codex Ouronet Master" followed `codexMasterSeed.ouroAccountId`.
 * On a settled codex the gold row and the master-named row were therefore
 * DIFFERENT ROWS — the owner photographed "Initial Seed" wearing the badge and
 * the gold while his settled master sat under "Other standard accounts".
 *
 * Each case guards a distinct regression:
 *   (settled beats isPrime) the defect itself — a settled
 *       `codexMasterSeed.ouroAccountId` must outrank an `isPrime` stamp sitting
 *       on some other account, because `isPrime` is documented as the
 *       provenance of the auto-created primary account, not "is the master".
 *   (dangling id) an id naming no present account (account deleted, codex
 *       half-restored) must still yield SOME master, or the surface renders no
 *       gold row at all.
 *   (unsettled -> isPrime) BACKWARDS COMPATIBILITY: a codex that never ran the
 *       eligibility wizard has no settled id and must resolve as it always has.
 *   (falsy ids) `undefined`/`null`/`""` are all "not settled" — a half-written
 *       row is not an identity, and the `""` case is the one a caller reaching
 *       through an optional field actually produces.
 *   (no isPrime anywhere) the pre-existing positional fallback — a codex whose
 *       accounts were never flagged still has a first row.
 *   (empty) no accounts means no master, not a crash.
 *   (identity) callers compare the result by reference (`acct === masterAcct`
 *       drives pinning, gold and the badge), so returning a copy would make
 *       every one of those comparisons silently false.
 */

import { describe, it, expect } from "vitest";

import { resolveMasterOuronetAccount } from "../src/codex/masterOuronetAccount.js";

/** The owner's reported shape: the auto-created first account still carries
 *  `isPrime` ("Initial Seed"), the settled master carries only the identity. */
const INITIAL_SEED = { id: "initial-seed", isPrime: true };
const SETTLED_MASTER = { id: "settled-master" };
const ACCOUNTS = [INITIAL_SEED, SETTLED_MASTER];

describe("resolveMasterOuronetAccount — the master-account precedence chain", () => {
  it("returns the account `codexMasterSeed.ouroAccountId` names, even when ANOTHER account carries isPrime", () => {
    expect(resolveMasterOuronetAccount(ACCOUNTS, "settled-master")).toBe(SETTLED_MASTER);
  });

  it("falls back to the isPrime account when no master account id is settled (undefined)", () => {
    expect(resolveMasterOuronetAccount(ACCOUNTS, undefined)).toBe(INITIAL_SEED);
  });

  it("falls back to the isPrime account when the settled id is empty or null — a half-written row is not an identity", () => {
    expect(resolveMasterOuronetAccount(ACCOUNTS, "")).toBe(INITIAL_SEED);
    expect(resolveMasterOuronetAccount(ACCOUNTS, null)).toBe(INITIAL_SEED);
  });

  it("falls back to the isPrime account when the settled id names an account that is not in the list", () => {
    expect(resolveMasterOuronetAccount(ACCOUNTS, "deleted-account")).toBe(INITIAL_SEED);
  });

  it("falls back to the FIRST account when nothing carries isPrime — the pre-existing positional rule", () => {
    const unflagged = [{ id: "a" }, { id: "b" }];
    expect(resolveMasterOuronetAccount(unflagged, undefined)).toBe(unflagged[0]);
    expect(resolveMasterOuronetAccount(unflagged, "nope")).toBe(unflagged[0]);
  });

  it("returns undefined for an empty list, with or without a settled id", () => {
    expect(resolveMasterOuronetAccount([], "settled-master")).toBeUndefined();
    expect(resolveMasterOuronetAccount([], undefined)).toBeUndefined();
  });

  it("prefers an isPrime account over list position, wherever in the list it sits", () => {
    // `promoteSeedAndAccountToPrime` relocates the flag once, pre-alignment,
    // so the flagged account is not necessarily the host snapshot's first
    // element. The flag still wins over position.
    const accounts = [{ id: "a", isPrime: false }, { id: "b", isPrime: true }];
    expect(resolveMasterOuronetAccount(accounts, undefined)).toBe(accounts[1]);
  });

  it("returns the SAME OBJECT from the input list, never a copy, on every branch", () => {
    // The accounts tab decides pinning, gold and the badge by comparing each
    // row against this one value by identity. A structurally-equal copy would
    // make all three comparisons false and leave the surface with no master
    // row — the exact failure mode this resolver exists to end.
    const settled = resolveMasterOuronetAccount(ACCOUNTS, "settled-master");
    expect(settled === ACCOUNTS[1]).toBe(true);
    const flagged = resolveMasterOuronetAccount(ACCOUNTS, undefined);
    expect(flagged === ACCOUNTS[0]).toBe(true);
    const positional = resolveMasterOuronetAccount([SETTLED_MASTER], undefined);
    expect(positional === SETTLED_MASTER).toBe(true);
  });
});
