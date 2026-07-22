/**
 * <RotatePaymentKeyModal> — headless modal for StoaChain Ledger payment-key
 * rotation on an Ouronet account.
 *
 * Builds the C_RotateStoaChain Pact tx via buildRotateStoaChainPactCode +
 * dispatches through useSignTransaction's CodexSigningStrategy.execute().
 *
 * The patron's guard + (when patron ≠ account) the account's guard need
 * to be attached as `ks` and `ks-account` data slots on the transaction
 * — this modal handles that automatically.
 *
 * Form input is a single string — the new payment-key public key (64-char
 * hex). Validation: hex-only, exact length. No password prompt directly —
 * useSignTransaction handles signing-key resolution via the resolver,
 * which prompts via <PasswordModal> if needed.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import {
  KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID,
  KADENA_NETWORK as STOACHAIN_NETWORK,
} from "@stoachain/stoa-core/constants";
import { safeCreationTime } from "@stoachain/stoa-core/pact";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";
import { buildRotateKadenaPactCode as buildRotateStoaChainPactCode } from "@ouronet/ouronet-core/pact";

import { useSignTransaction } from "../hooks/index.js";
import { useEnsureCodexUnlocked } from "../zbom/hooks/useEnsureCodexUnlocked.js";
import { useActiveWallet } from "../hooks/index.js";
import type { IOuroAccount } from "../types/entities.js";

const HEX_64_RX = /^[0-9a-fA-F]{64}$/;

export interface RotatePaymentKeyRenderArgs {
  account: IOuroAccount;
  patron: IOuroAccount;
  newPaymentKey: string;
  onNewPaymentKeyChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  lastError: string | null;
  lastRequestKey: string | null;
  canSubmit: boolean;
  validationMessage: string | null;
}

export interface RotatePaymentKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: IOuroAccount;
  patron?: IOuroAccount;
  onSuccess?: (requestKey: string) => void;
  className?: string;
  render?: (args: RotatePaymentKeyRenderArgs) => React.ReactNode;
  renderSubmitButton?: (
    onClick: () => void,
    submitting: boolean,
    canSubmit: boolean
  ) => React.ReactNode;
}

export function RotatePaymentKeyModal({
  isOpen,
  onClose,
  account: accountProp,
  patron: patronProp,
  onSuccess,
  className,
  render,
  renderSubmitButton,
}: RotatePaymentKeyModalProps): React.JSX.Element | null {
  const { activeOuroAccount } = useActiveWallet();
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  const account = accountProp ?? activeOuroAccount;
  const patron = patronProp ?? account;

  const [newPaymentKey, setNewPaymentKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastRequestKey, setLastRequestKey] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setNewPaymentKey("");
      setLastError(null);
      setLastRequestKey(null);
    }
  }, [isOpen]);

  const validationMessage = (() => {
    if (!newPaymentKey) return null;
    if (!HEX_64_RX.test(newPaymentKey))
      return "Payment key must be exactly 64 hex characters (0-9, a-f).";
    return null;
  })();

  const canSubmit =
    !!account &&
    !!patron &&
    !!HEX_64_RX.test(newPaymentKey) &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !account || !patron) return;
    setSubmitting(true);
    setLastError(null);
    try {
      // Prompt for the codex password if locked; abort on cancel.
      if (!(await ensureCodexUnlocked())) { setLastError("Authentication required"); return; }

      const pactCode = buildRotateStoaChainPactCode({
        patron: patron.address,
        account: account.address,
        newPaymentKey: newPaymentKey.trim(),
      });

      const guards = [];
      if (patron.guard) guards.push(patron.guard);
      if (account.guard && account.address !== patron.address) {
        guards.push(account.guard);
      }

      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs }) => {
          let builder = Pact.builder
            .execution(pactCode)
            .setMeta({
              senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
              creationTime: safeCreationTime(),
              chainId: STOACHAIN_CHAIN_ID,
              gasLimit,
            })
            .setNetworkId(STOACHAIN_NETWORK);

          // Required data slots for the chain's keyset reads:
          if (patron.guard) {
            builder = (builder as any).addData("ks", {
              keys: patron.guard.keys,
              pred: patron.guard.pred,
            });
          }
          if (account.guard && account.address !== patron.address) {
            builder = (builder as any).addData("ks-account", {
              keys: account.guard.keys,
              pred: account.guard.pred,
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
        guards,
        paymentKey: null,
      });

      setLastRequestKey(requestKey);
      onSuccess?.(requestKey);
      onClose();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, account, patron, newPaymentKey, execute, ensureCodexUnlocked, onSuccess, onClose]);

  if (!isOpen || !account || !patron) return null;

  const renderArgs: RotatePaymentKeyRenderArgs = {
    account,
    patron,
    newPaymentKey,
    onNewPaymentKeyChange: setNewPaymentKey,
    onSubmit: handleSubmit,
    onCancel: onClose,
    submitting,
    lastError,
    lastRequestKey,
    canSubmit,
    validationMessage,
  };

  if (render) {
    return <>{render(renderArgs)}</>;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotate-payment-key-title"
      className={className}
    >
      <h2 id="rotate-payment-key-title">Rotate Payment Key</h2>
      <p>
        Account: <code>{account.address}</code>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <label>
          New payment key (64 hex chars)
          <input
            type="text"
            value={newPaymentKey}
            onChange={(e) => setNewPaymentKey(e.target.value.trim())}
            maxLength={64}
            autoComplete="off"
            aria-invalid={validationMessage ? "true" : undefined}
          />
        </label>
        {validationMessage && <p role="alert">{validationMessage}</p>}
        {lastError && <p role="alert">{lastError}</p>}
        {lastRequestKey && <p>Submitted! Request key: {lastRequestKey}</p>}
        <div>
          {renderSubmitButton ? (
            renderSubmitButton(handleSubmit, submitting, canSubmit)
          ) : (
            <button type="submit" disabled={!canSubmit}>
              {submitting ? "Submitting…" : "Rotate Payment Key"}
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
