/**
 * <SendArweaveModal> — the per-row "Send AR" modal opened from
 * `ArweaveAccountsArea.tsx`'s icon-button cluster.
 *
 * Recipient + amount only — no manual fee-cap field. The live network fee is
 * fetched via `deps.estimateFee(0, recipient)` (byte size `0`, matching
 * `TRANSFER_BYTE_SIZE`'s meaning of a data-less transfer) on open and on every
 * recipient/amount edit, shown as "Network fee: ~X AR", and held internally as
 * the raw Winston bigint to derive `maxRewardWinston = quote * 12n / 10n` (a
 * 1.2x buffer) at submit time — the user never sees or edits that cap
 * directly (design.md's rejected-alternative: `SendArea.tsx`'s manual
 * required fee-cap field is correct but out of place in a flow that should
 * read as simply as `SendStoaModal`).
 *
 * TWO SEND MODES, because Arweave has no gas station and "what does the typed
 * number mean" is genuinely ambiguous once the fee has to come from somewhere:
 *   - "Fee Included" (default — the owner's stated primary use case): the
 *     typed amount is the TOTAL debited from the sender's balance; the
 *     recipient receives that minus the buffered fee. A live "Recipient
 *     receives: ~X AR" estimate renders below the amount field, mirroring a
 *     Binance-style withdrawal screen. `quantity = arToWinston(amount) -
 *     bufferedFee`.
 *   - "Fee On Top": the typed amount is EXACTLY what the recipient receives;
 *     the sender needs additional balance beyond that to cover the fee.
 *     `quantity = arToWinston(amount)` (the modal's only behavior before this
 *     mode existed).
 * The Max button's fill value depends on the active mode: "Fee Included"
 * fills the WHOLE balance (the mode's own math already carves out the fee);
 * "Fee On Top" fills balance-minus-buffered-fee (unchanged from before).
 *
 * Unlike `SendStoaModal` (which dispatches through `useSignTransaction()` /
 * `CodexSigningStrategy` and the Ouronet Gas Station), Arweave has no
 * signing-strategy or gas-station equivalent: the JWK is resolved directly by
 * `deps.sendFrom(entry, req)` at submit time only (never cached), the same
 * "resolve secret material only at submit" discipline the Chainweb
 * `useGetKeypair()` family follows.
 *
 * Toast feedback reuses the SAME generic `txPending` surface `SendStoaModal`
 * uses (`@ancientpantheon/codex-ouronet/zbom`, per T1) — `.submitted(id)` on
 * success, `.fail(message)` on any error, never left hanging.
 *
 * LOCKED CODEX: `handleSubmit` calls `useEnsureCodexUnlocked()`'s gate FIRST,
 * before touching `sendFrom` at all — the SAME gate every other signing modal
 * in this app already uses (`RotatePaymentKeyModal.tsx` and its five
 * siblings). It pops the REAL global password prompt if locked and resumes
 * automatically once unlocked; a user who cancels the prompt just gets the
 * submit button back, no error toast, no dead-end text. This replaces the
 * modal's previous behavior of calling `sendFrom` unconditionally and only
 * finding out it was locked from the thrown `CodexLockedError` — a real,
 * reported bug ("says codex is locked... it should pop me the password to
 * unlock it, not error me out"). The `CodexLockedError` catch branch below
 * stays as a defense-in-depth fallback for the rare race where the password
 * cache expires between this pre-flight check and the actual decrypt/sign.
 *
 * Lock detection is `codex-arweave`'s own established name-based duck-type
 * (`isCodexLockedError`, mirrored from `PureKeysArea.tsx`'s identical local
 * helper) rather than `instanceof CodexLockedError` — this package holds no
 * value import of codex-ouronet's error class, keeping that boundary intact.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { arToWinston, winstonToAr, getTransactionStatus, InvalidTransactionIdError } from "@ancientpantheon/arweave-core";
import { CodexModalShell } from "@ancientpantheon/codex-ouronet/ui";
import { txPending, useEnsureCodexUnlocked } from "@ancientpantheon/codex-ouronet/zbom";

import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";
import type { ArweavePanelDeps } from "./context.js";

const AMOUNT_RX = /^\d+(\.\d+)?$/;

/** Same validation shape as `SendStoaModal.tsx`'s own `validateAmount` — a
 *  non-negative decimal, rejected empty (no error shown until something is
 *  typed) or non-positive. */
function validateAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!AMOUNT_RX.test(trimmed)) {
    return "Enter a valid positive amount (digits and an optional decimal point).";
  }
  if (parseFloat(trimmed) <= 0) return "Amount must be greater than 0.";
  return null;
}

/** A locked codex surfaces this so the send flow shows a specific message
 *  rather than the generic caught-error text. Detected by NAME, not
 *  `instanceof` — see module JSDoc. Exact mirror of `PureKeysArea.tsx`'s own
 *  identical local helper. */
function isCodexLockedError(err: unknown): boolean {
  return err instanceof Error && err.name === "CodexLockedError";
}

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#888",
  marginBottom: 6,
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 40,
  padding: "0 12px",
  borderRadius: 8,
  backgroundColor: "#111",
  border: "1px solid #262626",
  color: "#d2d3d4",
  fontFamily: "var(--codex-font-mono, ui-monospace, monospace)",
  fontSize: 13,
};

const feeTextStyle: React.CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  color: "#888",
};

const alertStyle: React.CSSProperties = {
  marginTop: 12,
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 12,
  backgroundColor: "#8b1a1a15",
  border: "1px solid #8b1a1a40",
  color: "#f87171",
};

export interface SendArweaveModalProps {
  /** The row's ciphertext entry — the JWK is resolved from it only at submit
   *  time, via `deps.sendFrom`, never cached here. */
  entry: ForeignKeyEntry;
  isOpen: boolean;
  onClose: () => void;
  deps: ArweavePanelDeps;
  /** Fired with the submitted tx id, together with `onClose()`, on success —
   *  the row uses this to refresh its own balance (T4's per-row trigger). */
  onSuccess?: (id: string) => void;
  /** The sender's OWN current balance, in Winston — the same value the row's
   *  value cell already shows (T4's `balances` map), threaded straight
   *  through rather than re-fetched. Arweave has no gas station: the fee is
   *  paid out of this SAME balance as the amount sent, unlike a Kadena send
   *  through the Ouronet Gas Station where the full balance is always
   *  sendable. Undefined (balance not yet known) never blocks submit — it
   *  only means the amount+fee-fits check and the Max button are unavailable
   *  until it resolves. */
  senderBalanceWinston?: bigint;
}

export function SendArweaveModal({
  entry,
  isOpen,
  onClose,
  deps,
  onSuccess,
  senderBalanceWinston,
}: SendArweaveModalProps): React.ReactElement | null {
  const ensureCodexUnlocked = useEnsureCodexUnlocked();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  /** "included" (default): typed amount is the TOTAL debited from the
   *  sender's balance. "onTop": typed amount is EXACTLY what the recipient
   *  receives. See module JSDoc. */
  const [feeMode, setFeeMode] = useState<"included" | "onTop">("included");
  /** The raw live Winston quote — held internally only, to derive the
   *  buffered `maxRewardWinston` cap at submit time. Never rendered as an
   *  editable field (module JSDoc). */
  const [feeQuote, setFeeQuote] = useState<bigint | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRecipient("");
      setAmount("");
      setSubmitting(false);
      setLastError(null);
      setFeeQuote(null);
      setFeeMode("included");
    }
  }, [isOpen]);

  // Live fee quote: byte size 0 (a data-less transfer — TRANSFER_BYTE_SIZE's
  // own meaning), re-fired on open and on every recipient/amount edit. A
  // rejected quote just clears the display (`feeQuote` back to null, which
  // also keeps submit disabled below) — never surfaced as its own error; the
  // real, submit-blocking failure surface is `handleSubmit`'s own try/catch.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    deps
      .estimateFee(0, recipient)
      .then((quote) => {
        if (!cancelled) setFeeQuote(quote);
      })
      .catch(() => {
        if (!cancelled) setFeeQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, recipient, amount, deps]);

  const validationMessage = validateAmount(amount);

  // The SAME 1.2x buffer handleSubmit derives at submit time — computed here
  // too so the "does this fit in my balance" check uses the actual cap that
  // will be enforced, not the bare unbuffered quote (which would let a
  // borderline amount through this check only to fail on the real submit).
  const bufferedFee = feeQuote !== null ? (feeQuote * 12n) / 10n : null;

  const typedWinston =
    validationMessage === null && amount.trim() !== "" ? arToWinston(amount.trim()) : null;

  // The ACTUAL on-chain quantity for the active mode — computed once here so
  // the render, the balance check, and handleSubmit all agree on the exact
  // same number instead of three independent re-derivations drifting apart.
  //   "included": the typed amount is the TOTAL debited; quantity is what's
  //     left after the buffered fee comes out of it (never negative — an
  //     amount too small to cover the fee is its own blocking error below).
  //   "onTop": the typed amount goes to the recipient unchanged.
  const quantityWinston =
    typedWinston !== null && bufferedFee !== null
      ? feeMode === "included"
        ? typedWinston > bufferedFee
          ? typedWinston - bufferedFee
          : null
        : typedWinston
      : null;

  const tooSmallForFeeMessage =
    feeMode === "included" && typedWinston !== null && bufferedFee !== null && typedWinston <= bufferedFee
      ? `Amount is too small to cover the network fee (~${winstonToAr(bufferedFee)} AR).`
      : null;

  // Arweave has no gas station — fee comes out of the SAME balance as the
  // amount. Only evaluated once both the balance and a live fee quote are
  // known; an unknown balance never blocks submit (see prop doc). "included"
  // mode's check is simpler — the typed amount IS the total, no separate fee
  // headroom to add — while "onTop" needs amount + fee to both fit.
  const insufficientBalanceMessage =
    senderBalanceWinston !== undefined && bufferedFee !== null && typedWinston !== null
      ? (feeMode === "included" ? typedWinston : typedWinston + bufferedFee) > senderBalanceWinston
        ? feeMode === "included"
          ? `Amount exceeds your balance (${winstonToAr(senderBalanceWinston)} AR).`
          : `Amount + fee (~${winstonToAr(bufferedFee)} AR) exceeds your balance (${winstonToAr(senderBalanceWinston)} AR).`
        : null
      : null;

  const canSubmit =
    !submitting &&
    recipient.trim().length > 0 &&
    amount.trim() !== "" &&
    validationMessage === null &&
    tooSmallForFeeMessage === null &&
    quantityWinston !== null &&
    feeQuote !== null &&
    insufficientBalanceMessage === null;

  // "included": the mode's own math already carves the fee out of the typed
  // total, so Max is simply the whole balance. "onTop": unchanged — the
  // recipient gets exactly what's typed, so Max reserves the fee separately.
  const maxAmount =
    senderBalanceWinston === undefined || bufferedFee === null
      ? null
      : feeMode === "included"
        ? winstonToAr(senderBalanceWinston)
        : senderBalanceWinston > bufferedFee
          ? winstonToAr(senderBalanceWinston - bufferedFee)
          : null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || feeQuote === null || quantityWinston === null) return;
    setSubmitting(true);
    setLastError(null);
    // Pop the REAL password prompt here, BEFORE touching sendFrom at all, if
    // the codex is locked — the same gate every other signing modal in this
    // app already uses. A cancelled prompt just stops quietly (no toast, no
    // error): declining to unlock isn't a failure, it's the user's choice.
    const unlocked = await ensureCodexUnlocked();
    if (!unlocked) {
      setSubmitting(false);
      return;
    }
    // chain: ARWEAVE_CHAIN_ID (never a re-spelled string literal — FIX-8:
    // every consumer value-imports the single chainId.ts const) so the toast
    // points its explorer link at ViewBlock's Arweave tx page instead of
    // StoaChain's explorer, and skips the Pact request-key poll
    // `.submitted()` otherwise kicks off, which a StoaChain node could never
    // resolve for an Arweave id. See toastManager.ts's ToastChain doc for
    // the full rationale.
    //
    // pollFn: real on-chain confirmation, via the SAME `getTransactionStatus`
    // primitive the Library's own upload-confirmation flow already polls
    // (arweave-core/reads/status.ts, GET {gateway}/tx/{id}/status) — so the
    // toast's "Confirming…" actually means something instead of guessing.
    // `InvalidTransactionIdError` (a structurally invalid id — e.g. mock
    // mode's fixed placeholder tx id, which can never become valid no matter
    // how many times it's polled) tells the toast to give up immediately
    // rather than burn its ~10-minute budget finding that out 40 times; any
    // OTHER failure (a transient gateway hiccup) is reported as still
    // "pending" so the toast's own retry loop just tries again next interval.
    const _tx = txPending("Send Arweave", {
      chain: ARWEAVE_CHAIN_ID,
      pollFn: async (id) => {
        try {
          const status = await getTransactionStatus(deps.pool, id);
          return status.status === "confirmed" ? "confirmed" : "pending";
        } catch (e) {
          return e instanceof InvalidTransactionIdError ? "give-up" : "pending";
        }
      },
    });
    try {
      // 1.2x buffer over the last live quote — never shown to the user as an
      // editable field (module JSDoc / design.md). A rare drift beyond this
      // buffer between estimate and submit surfaces as `sendFrom`'s own
      // fee-cap-exceeded error below, never swallowed.
      const maxRewardWinston = (feeQuote * 12n) / 10n;
      const result = await deps.sendFrom(entry, {
        target: recipient.trim(),
        // The mode-aware quantity computed above — "included" already has the
        // buffered fee carved out, "onTop" is the typed amount unchanged.
        quantity: quantityWinston,
        maxRewardWinston,
      });
      _tx.submitted(result.id);
      onSuccess?.(result.id);
      onClose();
    } catch (e) {
      const message = isCodexLockedError(e)
        ? "Codex is locked. Unlock your codex to send."
        : e instanceof Error
          ? e.message
          : String(e);
      setLastError(message);
      _tx.fail(message);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, feeQuote, quantityWinston, ensureCodexUnlocked, deps, entry, recipient, onSuccess, onClose]);

  if (!isOpen) return null;

  return (
    <CodexModalShell
      title="Send AR"
      subtitle="Arweave transfer"
      onClose={onClose}
      dialogTestId="arweave-send-modal"
    >
      <label style={fieldLabelStyle} htmlFor="send-arweave-recipient">
        Recipient address
      </label>
      <input
        id="send-arweave-recipient"
        data-testid="arweave-send-recipient"
        type="text"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="Arweave address"
        autoComplete="off"
        style={fieldInputStyle}
      />

      <div
        role="group"
        aria-label="Fee mode"
        style={{ display: "flex", gap: 6, marginTop: 12 }}
      >
        <button
          type="button"
          data-testid="arweave-send-mode-included"
          aria-pressed={feeMode === "included"}
          onClick={() => setFeeMode("included")}
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            border: feeMode === "included" ? "1px solid #ceac5f" : "1px solid #262626",
            backgroundColor: feeMode === "included" ? "#ceac5f22" : "transparent",
            color: feeMode === "included" ? "#ceac5f" : "#888",
            cursor: "pointer",
          }}
        >
          Fee Included
        </button>
        <button
          type="button"
          data-testid="arweave-send-mode-onTop"
          aria-pressed={feeMode === "onTop"}
          onClick={() => setFeeMode("onTop")}
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            border: feeMode === "onTop" ? "1px solid #ceac5f" : "1px solid #262626",
            backgroundColor: feeMode === "onTop" ? "#ceac5f22" : "transparent",
            color: feeMode === "onTop" ? "#ceac5f" : "#888",
            cursor: "pointer",
          }}
        >
          Fee On Top
        </button>
      </div>
      <p style={{ ...feeTextStyle, marginTop: 6 }}>
        {feeMode === "included"
          ? "The amount you type is the TOTAL taken from your balance — the recipient gets that minus the fee."
          : "The amount you type is EXACTLY what the recipient gets — you need extra balance to cover the fee."}
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
        <label style={{ ...fieldLabelStyle, marginTop: 0 }} htmlFor="send-arweave-amount">
          Amount (AR)
        </label>
        <button
          type="button"
          data-testid="arweave-send-max"
          onClick={() => {
            if (maxAmount !== null) setAmount(maxAmount);
          }}
          disabled={maxAmount === null}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 6,
            background: "transparent",
            border: "1px solid #262626",
            color: maxAmount === null ? "#555" : "#ceac5f",
            cursor: maxAmount === null ? "not-allowed" : "pointer",
          }}
        >
          Max
        </button>
      </div>
      <input
        id="send-arweave-amount"
        data-testid="arweave-send-amount"
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000000000000"
        autoComplete="off"
        aria-invalid={validationMessage ? "true" : undefined}
        style={fieldInputStyle}
      />
      {validationMessage && (
        <p role="alert" style={alertStyle}>
          {validationMessage}
        </p>
      )}
      {tooSmallForFeeMessage && (
        <p role="alert" style={alertStyle}>
          {tooSmallForFeeMessage}
        </p>
      )}
      {insufficientBalanceMessage && (
        <p role="alert" style={alertStyle}>
          {insufficientBalanceMessage}
        </p>
      )}

      {senderBalanceWinston !== undefined && (
        <p data-testid="arweave-send-balance" style={feeTextStyle}>
          Balance: {winstonToAr(senderBalanceWinston)} AR
        </p>
      )}
      <p data-testid="arweave-send-fee" style={feeTextStyle}>
        Network fee: ~{feeQuote !== null ? winstonToAr(feeQuote) : "…"} AR
      </p>
      {feeMode === "included" && quantityWinston !== null && (
        <p data-testid="arweave-send-receive-estimate" style={feeTextStyle}>
          Recipient receives: ~{winstonToAr(quantityWinston)} AR
        </p>
      )}

      {lastError && (
        <p role="alert" style={alertStyle}>
          {lastError}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid #262626",
            color: "#d2d3d4",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Cancel
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="arweave-send-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            backgroundColor: canSubmit ? "#ceac5f" : "#333",
            color: canSubmit ? "#0a0a0a" : "#777",
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {submitting ? "Sending…" : "Send AR"}
        </button>
      </div>
    </CodexModalShell>
  );
}

export default SendArweaveModal;
