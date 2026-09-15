/**
 * <UnstakeUrStoaModal> — self-contained vault-action modal for
 * `(coin.C_URV|Unstake <account> <urstoa-amount>)`.
 *
 * Same patronless / confirm-time-keypair contract as StakeUrStoaModal (see
 * that file's header comment for the full rationale from
 * docs/work/stoa-urstoa-vault-actions/design.md's two resolved decisions) —
 * only the on-chain function differs.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { executeUnstakeUrStoa } from "@ouronet/ouronet-core/interactions/urStoaFunctions";
import { formatDecimalForPact } from "@stoachain/stoa-core/pact";
import { useGetKeypair } from "../../hooks/index.js";
import { CodexLockedError } from "../../errors/index.js";
import { txPending } from "../../zbom/toast/toastManager.js";
import { CodexModalShell, ModalExecuteRow, ModalFeedback, modalLabel, modalInput } from "./CodexModalShell.js";

/** UrStoa amounts are validated to 3 decimal places, matching OuronetUI's
 *  UnstakeUrStoaModal (URSTOA_PRECISION). */
const URSTOA_PRECISION = 3;
const AMOUNT_RX = /^\d+(\.\d+)?$/;

function validateAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!AMOUNT_RX.test(trimmed)) return "Enter a valid positive amount (digits and an optional decimal point).";
  if (parseFloat(trimmed) <= 0) return "Amount must be greater than 0.";
  return null;
}

export interface UnstakeUrStoaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The account's public key — resolved to a decrypted signing keypair via
   *  `useGetKeypair()` ONLY at confirm-time. */
  publicKey: string;
  /** The account's payment-key address (e.g. `k:<publicKey>`) — passed as
   *  `paymentKeyAddress`, the on-chain identity performing the unstake. */
  address: string;
  onSuccess?: (requestKey: string) => void;
}

export function UnstakeUrStoaModal({
  isOpen,
  onClose,
  publicKey,
  address,
  onSuccess,
}: UnstakeUrStoaModalProps): React.JSX.Element | null {
  const getKeypair = useGetKeypair();

  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setSubmitting(false);
      setLastError(null);
    }
  }, [isOpen]);

  const validationMessage = validateAmount(amount);
  const canSubmit = !submitting && amount.trim() !== "" && validationMessage === null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setLastError(null);
    const _tx = txPending("Unstake UrStoa");
    try {
      const validatedAmount = formatDecimalForPact(amount.trim(), URSTOA_PRECISION);
      // Resolved HERE, at confirm-time — never eagerly, never cached.
      const keypair = await getKeypair(publicKey);
      const { requestKey } = await executeUnstakeUrStoa({
        paymentKeyAddress: address,
        amount: validatedAmount,
        gasStationKey: keypair,
      });
      _tx.submitted(requestKey);
      onSuccess?.(requestKey);
      onClose();
    } catch (e) {
      if (e instanceof CodexLockedError) {
        const message = "Codex is locked. Unlock your codex to sign this transaction.";
        setLastError(message);
        _tx.fail(message);
      } else {
        const message = e instanceof Error ? e.message : String(e);
        setLastError(message);
        _tx.fail(message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, amount, publicKey, address, getKeypair, onSuccess, onClose]);

  if (!isOpen) return null;

  return (
    <CodexModalShell title="Unstake UrStoa" subtitle="coin.C_URV|Unstake" onClose={onClose}>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
        Unstakes native UrStoa from the UrStoa Vault back to <code>{address}</code>.
      </p>
      <label style={modalLabel} htmlFor="unstake-urstoa-amount">Amount</label>
      <input
        id="unstake-urstoa-amount"
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000"
        autoComplete="off"
        aria-invalid={validationMessage ? "true" : undefined}
        style={modalInput}
      />
      {validationMessage && <p role="alert" style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{validationMessage}</p>}
      <ModalFeedback error={lastError} requestKey={null} />
      <ModalExecuteRow onCancel={onClose} onSubmit={handleSubmit} submitting={submitting} canSubmit={canSubmit} label="Unstake UrStoa" />
    </CodexModalShell>
  );
}

export default UnstakeUrStoaModal;
