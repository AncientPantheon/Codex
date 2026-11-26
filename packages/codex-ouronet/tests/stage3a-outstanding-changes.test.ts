/**
 * Stage 3A — what is still outstanding after an eligible migration.
 *
 * The case that matters most is the NEGATIVE one: a user who kept both their
 * payment key and their guard has nothing to apply, and offering them a
 * button that performs no transaction would misrepresent their codex.
 */

import { describe, it, expect } from "vitest";
import { computeOutstandingKeyChanges } from "../src/ui/internal/outstandingKeyChanges.js";
import type { MigrationProgress } from "@ancientpantheon/codex-core";
import type { IOuroAccount } from "../src/types/entities.js";

const K0 = "a".repeat(64);
const K1 = "b".repeat(64);
const OLD = "9".repeat(64);

const acct = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: "ouro-1", version: "1.0", isSmart: false, address: "Ѻ.x",
  guard: null, stoaChainLedger: null, publicKey: "pub",
  secret: "ct", backup: "ct", ...over,
});

const run = (over: Partial<MigrationProgress> = {}): MigrationProgress => ({
  stage: "committing",
  startedAt: "2026-10-31T09:00:00.000Z",
  updatedAt: "2026-10-31T09:05:00.000Z",
  selection: {
    account: { kind: "keep-current" },
    payment: { kind: "stoic-dalos-position-0" },
    guard: { kind: "recommended-single-key" },
  },
  committed: { paymentPublicKey: K0, guardPublicKeys: [K1] },
  ...over,
});

describe("nothing outstanding", () => {
  it("reports NONE when the user kept both the payment key and the guard", () => {
    // Eligibility was structural and is already done; there is no
    // transaction to offer, and offering one would be a lie.
    const r = computeOutstandingKeyChanges(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "keep" }, guard: { kind: "keep" } } }),
      acct(),
    );
    expect(r.none).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it("reports NONE when the chosen guard is ALREADY in force on chain", () => {
    const r = computeOutstandingKeyChanges(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "keep" }, guard: { kind: "recommended-single-key" } } }),
      acct({ guard: { pred: "keys-all", keys: [K1] } }),
    );
    expect(r.none).toBe(true);
  });

  it("ignores key ORDER — a reordered keyset is not a pending change", () => {
    const r = computeOutstandingKeyChanges(
      run({
        selection: { account: { kind: "keep-current" }, payment: { kind: "keep" },
                     guard: { kind: "custom", keys: [K0, K1], pred: "keys-2" } },
      }),
      acct({ guard: { pred: "keys-2", keys: [K1, K0] } }),
    );
    expect(r.none).toBe(true);
  });

  it("reports NONE with no recorded run, and with no account", () => {
    expect(computeOutstandingKeyChanges(undefined, acct()).none).toBe(true);
    expect(computeOutstandingKeyChanges(run(), null).none).toBe(true);
  });
});

describe("a pending guard change", () => {
  it("reports FROM the current keys TO the chosen one", () => {
    const r = computeOutstandingKeyChanges(run(), acct({ guard: { pred: "keys-any", keys: [OLD] } }));
    const guard = r.changes.find((c) => c.kind === "guard");
    expect(guard).toBeTruthy();
    expect(guard!.from).toEqual([OLD]);
    expect(guard!.to).toEqual([K1]);
    expect(guard!.pred).toBe("keys-all");
  });

  it("reports FROM null when the account has no guard at all", () => {
    const r = computeOutstandingKeyChanges(run(), acct({ guard: null }));
    expect(r.changes.find((c) => c.kind === "guard")!.from).toBeNull();
  });

  it("treats a DIFFERENT predicate over the same keys as pending", () => {
    // keys-any over one key is not keys-all over one key.
    const r = computeOutstandingKeyChanges(run(), acct({ guard: { pred: "keys-any", keys: [K1] } }));
    expect(r.changes.some((c) => c.kind === "guard")).toBe(true);
  });

  it("uses the CUSTOM keyset's own keys and predicate", () => {
    const r = computeOutstandingKeyChanges(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "keep" },
                         guard: { kind: "custom", keys: [K0, K1], pred: "keys-2" } } }),
      acct({ guard: null }),
    );
    const guard = r.changes.find((c) => c.kind === "guard")!;
    expect(guard.to).toEqual([K0, K1]);
    expect(guard.pred).toBe("keys-2");
  });
});

/**
 * The account's live PAYMENT key is `stoaChainLedger` — NOT `chainPublicKey`.
 *
 * Three cases in this block (the "differs from the chosen one" case, the
 * "once the chosen key is live" case, and "both pending" below) originally
 * asserted against `chainPublicKey`. The design overruled that field —
 * `docs/work/migration-execute/design.md` §7 defect 2, executed as plan T2 —
 * so they are DELIBERATELY rewritten here, not casualties of the fix. The
 * evidence is the selector mapping itself: `ui/tabs/OuronetAccountsTab.tsx:115`
 * fills `stoaChainLedger` from the chain's `payment-key`, while `:117` fills
 * `chainPublicKey` from `public-key` — the account's OWN identity key, whose
 * doc comment (`types/entities.ts:272-275`) says a mismatch with `publicKey`
 * "indicates an admin-level rotation or codex corruption". Comparing the
 * chosen PAYMENT key against the account key made every account whose two
 * keys differ — i.e. all of them — report a permanently pending rotation.
 *
 * The comparison also has to NORMALISE, which is why this was not a field
 * swap: `stoaChainLedger` is an ADDRESS (`types/entities.ts:260`) and
 * `committed.paymentPublicKey` is bare 64-hex. The repo's own encoding of the
 * two address forms is `state/store.ts:2680`
 * (`seedType === "stoic" ? paymentPublicKey : `k:${paymentPublicKey}``), so
 * BOTH a bare (stoic-form) ledger and a `k:`-prefixed one must compare equal
 * to the bare chosen key.
 */
describe("a pending payment-key change", () => {
  it("reports it when the live payment key on chain differs from the chosen one", () => {
    const r = computeOutstandingKeyChanges(run(), acct({ stoaChainLedger: `k:${OLD}` }));
    const pay = r.changes.find((c) => c.kind === "payment")!;
    // Reported BARE although the ledger carried `k:` — the card renders
    // `from` through `MeasuredHexHighlight` (`PendingKeyChangesCard.tsx:75`),
    // so the normalisation has to reach the OUTPUT, not just the equality
    // test, for the card to keep rendering what it renders today.
    expect(pay.from).toEqual([OLD]);
    expect(pay.to).toEqual([K0]);
  });

  it("reports pending when a BARE (stoic-form) ledger carries a different key", () => {
    const r = computeOutstandingKeyChanges(run(), acct({ stoaChainLedger: OLD }));
    const pay = r.changes.find((c) => c.kind === "payment")!;
    expect(pay.from).toEqual([OLD]);
    expect(pay.to).toEqual([K0]);
  });

  it("reports NONE for payment once the chosen key is live — `k:` address form", () => {
    const r = computeOutstandingKeyChanges(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "stoic-dalos-position-0" }, guard: { kind: "keep" } } }),
      acct({ stoaChainLedger: `k:${K0}` }),
    );
    expect(r.none).toBe(true);
  });

  it("reports NONE for payment once the chosen key is live — BARE stoic form", () => {
    // `store.ts:2680`'s stoic branch stores the bare key as the address.
    const r = computeOutstandingKeyChanges(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "stoic-dalos-position-0" }, guard: { kind: "keep" } } }),
      acct({ stoaChainLedger: K0 }),
    );
    expect(r.none).toBe(true);
  });

  it("reports pending with from: null when no payment key is on record", () => {
    // "none on record" is already a rendered state
    // (`PendingKeyChangesCard.tsx:73`), so a null ledger must stay null
    // rather than becoming an empty list or a fabricated key.
    const r = computeOutstandingKeyChanges(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "stoic-dalos-position-0" }, guard: { kind: "keep" } } }),
      acct({ stoaChainLedger: null }),
    );
    const pay = r.changes.find((c) => c.kind === "payment")!;
    expect(pay.from).toBeNull();
    expect(pay.to).toEqual([K0]);
  });

  it("reports NONE when chainPublicKey differs from the chosen key but the LEDGER matches it", () => {
    // THE REGRESSION THAT PINS THE DEFECT SHUT. This is the ordinary shape of
    // a real account — identity key and payment key are different keys — and
    // the old `chainPublicKey` read reported a pending payment rotation for
    // it forever, offering a button for a rotation that had already happened.
    const r = computeOutstandingKeyChanges(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "stoic-dalos-position-0" }, guard: { kind: "keep" } } }),
      acct({ chainPublicKey: OLD, stoaChainLedger: `k:${K0}` }),
    );
    expect(r.none).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it("does not invent a payment change when stage 2 recorded no derived key", () => {
    const r = computeOutstandingKeyChanges(
      run({ committed: { guardPublicKeys: [K1] } }),
      acct({ guard: { pred: "keys-all", keys: [K1] } }),
    );
    expect(r.changes.some((c) => c.kind === "payment")).toBe(false);
  });
});

describe("both pending", () => {
  it("reports the guard and the payment key together", () => {
    // `chainPublicKey: OLD` → `stoaChainLedger` for the reason documented
    // above this block (design §7 defect 2 / plan T2).
    const r = computeOutstandingKeyChanges(
      run(),
      acct({ guard: { pred: "keys-any", keys: [OLD] }, stoaChainLedger: `k:${OLD}` }),
    );
    expect(r.none).toBe(false);
    expect(r.changes.map((c) => c.kind).sort()).toEqual(["guard", "payment"]);
  });
});

/**
 * guard-step-variants (docs/work/guard-step-variants/design.md):
 * "update-keyset-recommended"/"update-keyset-custom" mean "update the
 * REFERENCED keyset's own on-chain definition" — a capability no code in
 * this codebase executes. Stage 3A's "Apply" button only ever opens
 * `RotateGuardModal`, which repoints the ACCOUNT's guard, never mutates
 * what a reference resolves to. So these two must NEVER appear as a
 * pending "guard" change here — doing so would offer a button that
 * performs the wrong operation. "use-existing-keyset" IS a real account
 * rotation (`RotateGuardModal`'s own "existing keyset-ref" mode), so it
 * behaves like "custom" — except its predicate must come from the
 * CHOICE's own `.pred` (resolved via `describeKeyset` at selection time),
 * never the hardcoded "keys-all" fallback the other non-custom kinds use.
 */
describe("the three guard-step-variants kinds", () => {
  it.each([
    { kind: "update-keyset-recommended" as const },
    { kind: "update-keyset-custom" as const, keys: [K0, K1], pred: "keys-2" },
  ])("reports NONE for %o — no code executes this on chain, so Stage 3A must never offer it", (guard) => {
    const r = computeOutstandingKeyChanges(
      run({
        selection: { account: { kind: "keep-current" }, payment: { kind: "keep" }, guard },
        // Even with committed public keys on record AND a mismatched live
        // guard — the two conditions that make every OTHER guard kind
        // report pending — this must still report none.
        committed: { guardPublicKeys: [K0, K1] },
      }),
      acct({ guard: { pred: "keys-any", keys: [OLD] } }),
    );
    expect(r.none).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it("reports a pending change for use-existing-keyset, using the CHOICE's own predicate, not the keys-all fallback", () => {
    const r = computeOutstandingKeyChanges(
      run({
        selection: {
          account: { kind: "keep-current" }, payment: { kind: "keep" },
          guard: {
            kind: "use-existing-keyset",
            ns: "ouronet-ns", ksn: "owner-made-keyset",
            keys: [K0, K1], pred: "keys-2",
          },
        },
      }),
      acct({ guard: { pred: "keys-any", keys: [OLD] } }),
    );
    const guard = r.changes.find((c) => c.kind === "guard");
    expect(guard).toBeTruthy();
    expect(guard!.to).toEqual([K0, K1]);
    // The load-bearing assertion: NOT "keys-all" (the hardcoded fallback
    // every other non-custom kind used before this fix) — the keyset's
    // OWN resolved predicate.
    expect(guard!.pred).toBe("keys-2");
  });

  it("reports NONE for use-existing-keyset once its keys/predicate are already live", () => {
    const r = computeOutstandingKeyChanges(
      run({
        selection: {
          account: { kind: "keep-current" }, payment: { kind: "keep" },
          guard: {
            kind: "use-existing-keyset",
            ns: "ouronet-ns", ksn: "owner-made-keyset",
            keys: [K1], pred: "keys-2",
          },
        },
      }),
      acct({ guard: { pred: "keys-2", keys: [K1] } }),
    );
    expect(r.changes.some((c) => c.kind === "guard")).toBe(false);
  });
});
