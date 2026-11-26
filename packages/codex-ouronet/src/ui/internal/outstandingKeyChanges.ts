/**
 * STAGE 3A — what the user CHOSE that is not yet in force on chain.
 *
 * Owner: *"migration is basically a tool for those that want to give up old
 * accounts and use new ones, or if they choose modification of payment key
 * and guard of ouronet account."* So this is OPTIONAL work, and the first
 * job of this module is to be honest about when there is none.
 *
 * Pure: the recorded run and the account in, a list of pending changes out.
 * No chain reads, no decryption — stage 2 already recorded the derived
 * PUBLIC keys precisely so this can answer without either.
 *
 * ## Why "keep" yields nothing
 *
 * A user who kept both their payment key and their guard has nothing to
 * apply: eligibility was structural and is already done. Showing them a call
 * to action that performs no transaction would be a lie about their codex.
 */

import type { MigrationProgress } from "@ancientpantheon/codex-core";
import type { IOuroAccount } from "../../types/entities.js";

export interface PendingKeyChange {
  kind: "payment" | "guard";
  /** What the chain carries now. `null` when the account has none. */
  from: readonly string[] | null;
  /** What the user chose. */
  to: readonly string[];
  /** The predicate for a guard change; absent for a payment key. */
  pred?: string;
}

export interface OutstandingKeyChanges {
  changes: PendingKeyChange[];
  /** True when there is nothing to apply — the common, finished case. */
  none: boolean;
}

const NONE: OutstandingKeyChanges = { changes: [], none: true };

/** Set equality, so key ORDER never makes an unchanged guard look pending. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((k) => set.has(k));
}

/**
 * The bare public key behind a StoaChain payment-key ADDRESS.
 *
 * Mirror of `state/store.ts:2680`, which is this repo's own encoding of the
 * two address forms a payment key is stored in:
 * `seedType === "stoic" ? paymentPublicKey : \`k:${paymentPublicKey}\`` — a
 * stoic seed's address IS the bare key, every other seed's carries the `k:`
 * sigil. `committed.paymentPublicKey` is always bare, so both forms have to
 * reduce to bare before they can be compared at all (the same
 * strip-then-compare convention `internal/seedDashboard.ts:97` and
 * `internal/keySource.ts:77` already use).
 *
 * Defensive on the input type, deliberately: `IOuroAccount` types
 * `stoaChainLedger` as `string | null`, but real persisted legacy accounts
 * carry it absent entirely — the hazard `seedDashboard.ts:146-155` documents
 * from live testing. Anything that is not a usable string is "none on
 * record", never a crash at render time.
 */
function bareKeyFromAddress(keyOrAddr: unknown): string | null {
  if (typeof keyOrAddr !== "string" || keyOrAddr.length === 0) return null;
  return keyOrAddr.startsWith("k:") ? keyOrAddr.slice(2) : keyOrAddr;
}

export function computeOutstandingKeyChanges(
  progress: MigrationProgress | undefined | null,
  account: IOuroAccount | null | undefined
): OutstandingKeyChanges {
  if (!progress || !account) return NONE;
  const selection = progress.selection;
  const committed = progress.committed;
  if (!selection) return NONE;

  const changes: PendingKeyChange[] = [];

  // ── the guard ──
  // "update-keyset-recommended"/"update-keyset-custom" (guard-step-variants,
  // docs/work/guard-step-variants/design.md) mean "update the REFERENCED
  // keyset's own on-chain definition" — a capability no code in this
  // codebase executes (confirmed during that topic's design: Stage 3A's
  // "Apply" button only ever opens `RotateGuardModal`, which repoints the
  // ACCOUNT's guard, never mutates what a reference resolves to). Treating
  // either as a pending "guard" change here would offer a button that
  // performs the wrong operation, so neither is ever reported — same
  // silent-skip discipline this function already applies to "keep".
  const isUpdateKeysetKind =
    selection.guard?.kind === "update-keyset-recommended"
    || selection.guard?.kind === "update-keyset-custom";
  if (selection.guard && selection.guard.kind !== "keep" && !isUpdateKeysetKind) {
    // "custom"/"update-keyset-custom"/"use-existing-keyset" all carry their
    // own real `keys`+`pred` — "use-existing-keyset"'s came from
    // `describeKeyset` at selection time, never a hardcoded guess. Only
    // "recommended-single-key" has no `pred` of its own (it is always
    // keys-all by definition) and falls back to the derived
    // `committed.guardPublicKeys`.
    const chosen =
      "keys" in selection.guard ? selection.guard.keys : committed?.guardPublicKeys ?? [];
    const pred = "pred" in selection.guard ? selection.guard.pred : "keys-all";
    const currentKeys = account.guard?.keys ?? null;
    const alreadyInForce =
      currentKeys !== null &&
      account.guard?.pred === pred &&
      sameKeys(currentKeys, chosen);
    if (chosen.length > 0 && !alreadyInForce) {
      changes.push({ kind: "guard", from: currentKeys, to: chosen, pred });
    }
  }

  // ── the payment key ──
  if (selection.payment && selection.payment.kind !== "keep") {
    const chosen = committed?.paymentPublicKey;
    if (chosen) {
      // The account's live PAYMENT key is `stoaChainLedger` — the selector
      // fills it from the chain's `payment-key`
      // (`ui/tabs/OuronetAccountsTab.tsx:115`). It is NOT `chainPublicKey`,
      // which `:117` fills from `public-key`: the account's own identity key,
      // whose mismatch with `publicKey` means "admin-level rotation or codex
      // corruption" (`types/entities.ts:272-275`) and has nothing to say about
      // which payment key is in force. Reading that field compared the chosen
      // payment key against the account key, so every account whose two keys
      // differ — all of them — reported a payment rotation as permanently
      // pending (`docs/work/migration-execute/design.md` §7 defect 2).
      //
      // The ledger is an ADDRESS and `chosen` is bare hex, so compare (and
      // report) NORMALISED. `null` stays `null`: "none on record" is a state
      // the card already renders (`settings/PendingKeyChangesCard.tsx:73`).
      const liveKey = bareKeyFromAddress(account.stoaChainLedger);
      const live = liveKey !== null ? [liveKey] : null;
      const alreadyInForce = live !== null && sameKeys(live, [chosen]);
      if (!alreadyInForce) {
        changes.push({ kind: "payment", from: live, to: [chosen] });
      }
    }
  }

  return { changes, none: changes.length === 0 };
}
