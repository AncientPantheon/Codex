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
 * Lock detection is `codex-arweave`'s own established name-based duck-type
 * (`isCodexLockedError`, mirrored from `PureKeysArea.tsx`'s identical local
 * helper) rather than `instanceof CodexLockedError` — this package holds no
 * value import of codex-ouronet's error class, keeping that boundary intact.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { arToWinston, winstonToAr } from "@ancientpantheon/arweave-core";
import { CodexModalShell } from "@ancientpantheon/codex-ouronet/ui";
import { txPending } from "@ancientpantheon/codex-ouronet/zbom";

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
}

export function SendArweaveModal({
  entry,
  isOpen,
  onClose,
  deps,
  onSuccess,
}: SendArweaveModalProps): React.ReactElement | null {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
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
  const canSubmit =
    !submitting &&
    recipient.trim().length > 0 &&
    amount.trim() !== "" &&
    validationMessage === null &&
    feeQuote !== null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || feeQuote === null) return;
    setSubmitting(true);
    setLastError(null);
    const _tx = txPending("Send Arweave");
    try {
      // 1.2x buffer over the last live quote — never shown to the user as an
      // editable field (module JSDoc / design.md). A rare drift beyond this
      // buffer between estimate and submit surfaces as `sendFrom`'s own
      // fee-cap-exceeded error below, never swallowed.
      const maxRewardWinston = (feeQuote * 12n) / 10n;
      const result = await deps.sendFrom(entry, {
        target: recipient.trim(),
        quantity: arToWinston(amount.trim()),
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
  }, [canSubmit, feeQuote, deps, entry, recipient, amount, onSuccess, onClose]);

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

      <label style={{ ...fieldLabelStyle, marginTop: 12 }} htmlFor="send-arweave-amount">
        Amount (AR)
      </label>
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

      <p data-testid="arweave-send-fee" style={feeTextStyle}>
        Network fee: ~{feeQuote !== null ? winstonToAr(feeQuote) : "…"} AR
      </p>

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
