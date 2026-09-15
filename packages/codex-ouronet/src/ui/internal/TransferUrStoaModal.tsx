/**
 * <TransferUrStoaModal> — self-contained vault-action modal for native UrStoa
 * transfer, calling `executeNativeUrStoaTransfer` (the
 * coin.C_UR|Transfer/TransferAnew family — this modal is dedicated to the
 * Transfer family; OuronetUI's separate Transmit family is out of scope).
 *
 * Per docs/work/stoa-urstoa-vault-actions/design.md's resolved decision #1,
 * the flow is patronless: the account IS its own payment key, so the SAME
 * decrypted keypair is passed as `paymentKeypair` AND as the sole
 * `senderGuardKeys` entry (the "owning key" for a patronless sender's own
 * guard). Per decision #2, the keypair is resolved via `useGetKeypair()`
 * ONLY at confirm-time.
 *
 * Receiver existence is probed via `checkCoinAccountExists` (the same
 * urStoaFunctions export CollectUrStoaModal uses for its own payment key) —
 * mirroring `executeCollectUrStoa`'s own accountExists branch, per design.md's
 * note on selecting the create-vs-plain Pact-code branch. An existing
 * receiver uses the plain Transfer; a non-existent `k:` receiver derives a
 * single-key keyset for TransferAnew; a non-existent non-`k:` receiver is
 * refused before ever building a transaction (only `k:` accounts can be
 * created automatically from a bare public key).
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { executeNativeUrStoaTransfer, checkCoinAccountExists } from "@ouronet/ouronet-core/interactions/urStoaFunctions";
import { formatDecimalForPact } from "@stoachain/stoa-core/pact";
import { useGetKeypair } from "../../hooks/index.js";
import { CodexLockedError } from "../../errors/index.js";
import { txPending } from "../../zbom/toast/toastManager.js";
import { CodexModalShell, ModalExecuteRow, ModalFeedback, modalLabel, modalInput } from "./CodexModalShell.js";

const URSTOA_PRECISION = 3;
const AMOUNT_RX = /^\d+(\.\d+)?$/;

function validateAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!AMOUNT_RX.test(trimmed)) return "Enter a valid positive amount (digits and an optional decimal point).";
  if (parseFloat(trimmed) <= 0) return "Amount must be greater than 0.";
  return null;
}

function validateReceiver(raw: string, ownAddress: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === ownAddress) return "Receiver cannot be the same as sender.";
  return null;
}

export interface TransferUrStoaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The account's public key — resolved to a decrypted signing keypair via
   *  `useGetKeypair()` ONLY at confirm-time. */
  publicKey: string;
  /** The account's payment-key address (e.g. `k:<publicKey>`) — this modal's
   *  sender, since the patronless flow makes the sender its own payment key. */
  address: string;
  onSuccess?: (requestKey: string) => void;
}

export function TransferUrStoaModal({
  isOpen,
  onClose,
  publicKey,
  address,
  onSuccess,
}: TransferUrStoaModalProps): React.JSX.Element | null {
  const getKeypair = useGetKeypair();

  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReceiver("");
      setAmount("");
      setSubmitting(false);
      setLastError(null);
    }
  }, [isOpen]);

  const amountMessage = validateAmount(amount);
  const receiverMessage = validateReceiver(receiver, address);
  const validationMessage = receiverMessage ?? amountMessage;
  const canSubmit =
    !submitting &&
    receiver.trim() !== "" &&
    amount.trim() !== "" &&
    amountMessage === null &&
    receiverMessage === null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setLastError(null);
    const _tx = txPending("Transfer UrStoa");
    try {
      const receiverAddress = receiver.trim();
      const validatedAmount = formatDecimalForPact(amount.trim(), URSTOA_PRECISION);
      // Resolved HERE, at confirm-time — never eagerly, never cached.
      const keypair = await getKeypair(publicKey);

      // null (uncertain) collapses to "does not exist" — never assume a
      // receiver exists when the probe is inconclusive.
      const receiverExists = (await checkCoinAccountExists(receiverAddress)) === true;
      let receiverKeyset: { keys: string[]; pred: string } | undefined;
      if (!receiverExists) {
        if (!receiverAddress.startsWith("k:")) {
          const message = "Receiver account not found. Only k: addresses can be created automatically.";
          setLastError(message);
          // The toast was already started (right before submitting) — resolve
          // it to an error state here too, or it hangs in "Confirming…" forever.
          _tx.fail(message);
          return;
        }
        receiverKeyset = { keys: [receiverAddress.slice(2)], pred: "keys-all" };
      }

      const { requestKey } = await executeNativeUrStoaTransfer({
        senderAddress: address,
        receiverAddress,
        amount: validatedAmount,
        paymentKeyAddress: address,
        paymentKeypair: keypair,
        // Patronless sender: the sender's own guard IS the payment key —
        // the SAME decrypted keypair carries both roles (design.md decision #1).
        senderGuardKeys: [keypair],
        isTransferFamily: true,
        receiverExists,
        receiverKeyset,
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
  }, [canSubmit, receiver, amount, publicKey, address, getKeypair, onSuccess, onClose]);

  if (!isOpen) return null;

  return (
    <CodexModalShell title="Transfer UrStoa" subtitle="coin.C_UR|Transfer" onClose={onClose}>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
        Transfers native UrStoa from <code>{address}</code>.
      </p>
      <label style={modalLabel} htmlFor="transfer-urstoa-receiver">Receiver</label>
      <input
        id="transfer-urstoa-receiver"
        type="text"
        value={receiver}
        onChange={(e) => setReceiver(e.target.value)}
        placeholder="k:, c:, u:, or w: account"
        autoComplete="off"
        aria-invalid={receiverMessage ? "true" : undefined}
        style={{ ...modalInput, marginBottom: 12 }}
      />
      <label style={modalLabel} htmlFor="transfer-urstoa-amount">Amount</label>
      <input
        id="transfer-urstoa-amount"
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000"
        autoComplete="off"
        aria-invalid={amountMessage ? "true" : undefined}
        style={modalInput}
      />
      {validationMessage && <p role="alert" style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{validationMessage}</p>}
      <ModalFeedback error={lastError} requestKey={null} />
      <ModalExecuteRow onCancel={onClose} onSubmit={handleSubmit} submitting={submitting} canSubmit={canSubmit} label="Transfer UrStoa" />
    </CodexModalShell>
  );
}

export default TransferUrStoaModal;
