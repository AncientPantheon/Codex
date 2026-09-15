/**
 * <SendStoaModal> — self-contained modal for native Stoa (Kadena coin)
 * transfers: `(coin.C_Transfer <sender> <receiver> <amount>)` when the
 * receiver account already exists on-chain, or
 * `(coin.C_TransferAnew <sender> <receiver> (read-keyset "ks") <amount>)`
 * (create + transfer, k: receivers only) when it doesn't — ported from
 * OuronetUI's `transfer-token.tsx` Send flow (receiver-exists branch +
 * derived-keyset construction).
 *
 * Receiver existence is probed via `checkCoinAccountExists` — the NATIVE
 * `coin.get-balance` probe exported from `ouroPriceFunctions.ts` (NOT the
 * UrStoa-scoped function of the same name in `urStoaFunctions.ts`, which
 * probes `coin.UR_Balance` instead — see that file's own doc comment on the
 * two identically-named siblings).
 *
 * Unlike the vault-action modals (Stake/Unstake/Collect/TransferUrStoa),
 * native Stoa has no ready-made `@ouronet/ouronet-core` executor, so this
 * dispatches through the generic `useSignTransaction()` seam
 * (`CodexSigningStrategy.execute`) instead of resolving a keypair directly
 * via `useGetKeypair()` — mirroring
 * `packages/codex-ouronet/src/components/RotatePaymentKeyModal.tsx`'s exact
 * build/guards/paymentKey dispatch shape. Gas is paid by the Ouronet Gas
 * Station; the sender's own key is added as an unscoped guard signer
 * (`guardPubs`), which — per Pact's signing model — authorizes ANY
 * capability requested for that key during execution, including the
 * `coin.TRANSFER` capability `coin.transfer`/`C_Transfer` requires (same
 * unscoped-guardPub pattern every other CodexSigningStrategy-based modal in
 * this package already uses).
 *
 * In-flight/success/error state machine mirrors StakeUrStoaModal /
 * RotatePaymentKeyModal: a `submitting` flag, a `lastError` string cleared
 * per-attempt, and `onSuccess`+`onClose` fired together on success (no
 * lingering open-modal success banner).
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import {
  KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID,
  KADENA_NETWORK as STOACHAIN_NETWORK,
} from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";
import { formatDecimalForPact } from "@stoachain/stoa-core/pact";
import { checkCoinAccountExists } from "@ouronet/ouronet-core/interactions/ouroPriceFunctions";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import { useSignTransaction } from "../../hooks/index.js";
import { CodexLockedError } from "../../errors/index.js";
import { txPending } from "../../zbom/toast/toastManager.js";
import { CodexModalShell, ModalExecuteRow, ModalFeedback, modalLabel, modalInput } from "./CodexModalShell.js";

const AMOUNT_RX = /^\d+(\.\d+)?$/;
const K_ACCOUNT_RX = /^k:[0-9a-fA-F]{64}$/;

function validateAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!AMOUNT_RX.test(trimmed)) return "Enter a valid positive amount (digits and an optional decimal point).";
  if (parseFloat(trimmed) <= 0) return "Amount must be greater than 0.";
  return null;
}

export interface SendStoaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Sender's public key — added as an unscoped guard signer so it can
   *  authorize both its own keyset AND the coin.TRANSFER capability. */
  publicKey: string;
  /** Sender's native Stoa (Kadena) address, e.g. `k:<publicKey>`. */
  address: string;
  onSuccess?: (requestKey: string) => void;
}

export function SendStoaModal({
  isOpen,
  onClose,
  publicKey,
  address,
  onSuccess,
}: SendStoaModalProps): React.JSX.Element | null {
  const { execute } = useSignTransaction();

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

  const validationMessage = validateAmount(amount);
  const canSubmit =
    !submitting &&
    receiver.trim().length > 5 &&
    amount.trim() !== "" &&
    validationMessage === null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setLastError(null);
    const _tx = txPending("Send Stoa");
    try {
      const receiverAddr = receiver.trim();
      const isKAccount = K_ACCOUNT_RX.test(receiverAddr);

      const exists = await checkCoinAccountExists(receiverAddr);
      if (exists === null) {
        const message = "Could not verify the receiver account — try again.";
        setLastError(message);
        // The toast was already started (right before submitting) — resolve
        // it to an error state here too, or it hangs in "Confirming…" forever.
        _tx.fail(message);
        return;
      }
      if (!exists && !isKAccount) {
        const message = "Receiver account not found — only k: accounts can be auto-created.";
        setLastError(message);
        _tx.fail(message);
        return;
      }

      const isNew = !exists;
      const decimalStr = formatDecimalForPact(amount.trim());
      const pactCode = isNew
        ? `(coin.C_TransferAnew "${address}" "${receiverAddr}" (read-keyset "ks") ${decimalStr})`
        : `(coin.C_Transfer "${address}" "${receiverAddr}" ${decimalStr})`;

      const guard: IKeyset = { keys: [publicKey], pred: "keys-all" };

      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs, gasPrice, creationTime }) => {
          let builder = Pact.builder
            .execution(pactCode)
            .setMeta({
              senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
              creationTime,
              chainId: STOACHAIN_CHAIN_ID,
              gasLimit,
              gasPrice,
            })
            .setNetworkId(STOACHAIN_NETWORK);

          // Receiver's keyset is derived from its own k: address pubkey —
          // required for the on-chain (read-keyset "ks") in C_TransferAnew.
          if (isNew) {
            builder = (builder as any).addData("ks", {
              keys: [receiverAddr.slice(2)],
              pred: "keys-all",
            });
          }

          builder = builder.addSigner(capsKeyPub, (w: any) => [
            w(
              `${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`,
              "",
              { int: 0 },
              { decimal: "0.0" }
            ),
          ]);
          for (const pub of guardPubs) {
            builder = (builder as any).addSigner(pub);
          }
          return (builder as any).createTransaction();
        },
        guards: [guard],
        paymentKey: null,
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
  }, [canSubmit, receiver, amount, address, publicKey, execute, onSuccess, onClose]);

  if (!isOpen) return null;

  return (
    <CodexModalShell title="Send STOA" subtitle="coin.C_Transfer / coin.C_TransferAnew" onClose={onClose}>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
        Sends native STOA from <code>{address}</code>. Gas is paid by the Ouronet Gas Station.
      </p>
      <label style={modalLabel} htmlFor="send-stoa-receiver">Receiver address</label>
      <input
        id="send-stoa-receiver"
        type="text"
        value={receiver}
        onChange={(e) => setReceiver(e.target.value)}
        placeholder="k:, c:, u:, w:, or custom account"
        autoComplete="off"
        style={modalInput}
      />
      <label style={{ ...modalLabel, marginTop: 12 }} htmlFor="send-stoa-amount">Amount</label>
      <input
        id="send-stoa-amount"
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000000000000"
        autoComplete="off"
        aria-invalid={validationMessage ? "true" : undefined}
        style={modalInput}
      />
      {validationMessage && <p role="alert" style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{validationMessage}</p>}
      <ModalFeedback error={lastError} requestKey={null} />
      <ModalExecuteRow onCancel={onClose} onSubmit={handleSubmit} submitting={submitting} canSubmit={canSubmit} label="Send STOA" />
    </CodexModalShell>
  );
}

export default SendStoaModal;
