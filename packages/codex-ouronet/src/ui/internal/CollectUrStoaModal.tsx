/**
 * <CollectUrStoaModal> — self-contained vault-action modal for
 * `(coin.URV|COLLECT <account>)` (STOA earnings collection from the UrStoa
 * Vault). No amount input — a straight confirm.
 *
 * Same patronless / confirm-time-keypair contract as StakeUrStoaModal (see
 * that file's header comment for the full design.md rationale). Additionally
 * probes the payment key's own on-chain existence via `checkCoinAccountExists`
 * — mirroring OuronetUI's CollectUrStoaModal — so `executeCollectUrStoa`'s own
 * `accountExists` branch (create-account-then-collect vs. plain collect) is
 * fed the right value instead of defaulting to `true` for a virgin key.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { executeCollectUrStoa, checkCoinAccountExists } from "@ouronet/ouronet-core/interactions/urStoaFunctions";
import { useGetKeypair } from "../../hooks/index.js";
import { CodexLockedError } from "../../errors/index.js";
import { txPending } from "../../zbom/toast/toastManager.js";
import { useEnsureCodexUnlocked } from "../../zbom/hooks/useEnsureCodexUnlocked.js";
import { CodexModalShell, ModalExecuteRow, ModalFeedback } from "./CodexModalShell.js";

export interface CollectUrStoaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The account's public key — resolved to a decrypted signing keypair via
   *  `useGetKeypair()` ONLY at confirm-time. */
  publicKey: string;
  /** The account's payment-key address (e.g. `k:<publicKey>`) — passed as
   *  `paymentKeyAddress`, the on-chain identity collecting earnings. */
  address: string;
  onSuccess?: (requestKey: string) => void;
}

export function CollectUrStoaModal({
  isOpen,
  onClose,
  publicKey,
  address,
  onSuccess,
}: CollectUrStoaModalProps): React.JSX.Element | null {
  const getKeypair = useGetKeypair();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSubmitting(false);
      setLastError(null);
    }
  }, [isOpen]);

  const canSubmit = !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setLastError(null);
    // Pop the REAL password prompt here, BEFORE touching the keypair at all,
    // if the codex is locked — a cancelled prompt just stops quietly (no
    // toast, no error): declining to unlock isn't a failure.
    const unlocked = await ensureCodexUnlocked();
    if (!unlocked) {
      setSubmitting(false);
      return;
    }
    const _tx = txPending("Collect UrStoa Earnings");
    try {
      // Resolved HERE, at confirm-time — never eagerly, never cached.
      const keypair = await getKeypair(publicKey);
      // null (uncertain/non-existent) collapses to "does not exist" — never
      // assume an account exists when the probe is inconclusive.
      const accountExists = (await checkCoinAccountExists(address)) === true;
      const { requestKey } = await executeCollectUrStoa({
        paymentKeyAddress: address,
        gasStationKey: keypair,
        accountExists,
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
  }, [canSubmit, publicKey, address, getKeypair, ensureCodexUnlocked, onSuccess, onClose]);

  if (!isOpen) return null;

  return (
    <CodexModalShell title="Collect UrStoa Earnings" subtitle="coin.C_URV|Collect" onClose={onClose}>
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
        Collects accrued STOA earnings from the UrStoa Vault to <code>{address}</code>.
      </p>
      <ModalFeedback error={lastError} requestKey={null} />
      <ModalExecuteRow onCancel={onClose} onSubmit={handleSubmit} submitting={submitting} canSubmit={canSubmit} label="Collect Earnings" />
    </CodexModalShell>
  );
}

export default CollectUrStoaModal;
