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
      // The account's live payment key, when the selector has reported one.
      const live =
        typeof account.chainPublicKey === "string" ? [account.chainPublicKey] : null;
      const alreadyInForce = live !== null && sameKeys(live, [chosen]);
      if (!alreadyInForce) {
        changes.push({ kind: "payment", from: live, to: [chosen] });
      }
    }
  }

  return { changes, none: changes.length === 0 };
}
