/**
 * <RotateSovereignModal> — headless modal for Smart Ouronet Account
 * (Σ.-prefix) sovereign-guard rotation.
 *
 * Builds the C_RotateSovereign Pact tx via buildRotateSovereignPactCode +
 * dispatches through useSignTransaction's CodexSigningStrategy.execute().
 *
 * Smart-account only — opens but no-ops if `account.isSmart === false`.
 * The consumer should normally gate the modal's `isOpen` on
 * account.isSmart; the no-op guard is defense-in-depth.
 *
 * Default markup is unstyled semantic HTML. Consumers theme via
 * `className` + render-prop slots, or take full control with `render`.
 *
 * Patron defaults to `account` (resident pays its own gas). Override
 * via the `patron` prop if you want a different gas-payer.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import {
  KADENA_CHAIN_ID,
  KADENA_NETWORK,
} from "@stoachain/stoa-core/constants";
import { safeCreationTime } from "@stoachain/stoa-core/pact";
import {
  KADENA_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@stoachain/ouronet-core/constants";
import { buildRotateSovereignPactCode } from "@stoachain/ouronet-core/pact";

import { useSignTransaction } from "../hooks/index.js";
import { useEnsureCodexUnlocked } from "../zbom/hooks/useEnsureCodexUnlocked.js";
import { useActiveWallet } from "../hooks/index.js";
import { useOuroAccounts } from "../hooks/index.js";
import type { IOuroAccount } from "../types/entities.js";

export interface RotateSovereignRenderArgs {
  /** The smart account being rotated. */
  account: IOuroAccount;
  /** The patron paying gas (defaults to `account` when same). */
  patron: IOuroAccount;
  /** Current input value. */
  newSovereign: string;
  /** Input change handler. */
  onNewSovereignChange: (next: string) => void;
  /** Submit handler. */
  onSubmit: () => void;
  /** Cancel/close handler. */
  onCancel: () => void;
  /** Whether submit is in flight. */
  submitting: boolean;
  /** Last error from submit attempt. */
  lastError: string | null;
  /** Last successful requestKey, if any. */
  lastRequestKey: string | null;
  /** Whether form has all required values + account is smart. */
  canSubmit: boolean;
}

export interface RotateSovereignModalProps {
  /** Whether the modal is mounted. */
  isOpen: boolean;
  /** Called when user dismisses. */
  onClose: () => void;
  /** Account to rotate. Defaults to active ouro account. */
  account?: IOuroAccount;
  /** Gas-payer. Defaults to `account` (resident pays own gas). */
  patron?: IOuroAccount;
  /** Optional success callback with the tx requestKey. */
  onSuccess?: (requestKey: string) => void;
  className?: string;
  render?: (args: RotateSovereignRenderArgs) => React.ReactNode;
  /** Override the submit button. */
  renderSubmitButton?: (
    onClick: () => void,
    submitting: boolean,
    canSubmit: boolean
  ) => React.ReactNode;
}

export function RotateSovereignModal({
  isOpen,
  onClose,
  account: accountProp,
  patron: patronProp,
  onSuccess,
  className,
  render,
  renderSubmitButton,
}: RotateSovereignModalProps): React.JSX.Element | null {
  const { activeOuroAccount } = useActiveWallet();
  const { updateAccount } = useOuroAccounts();
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  const account = accountProp ?? activeOuroAccount;
  const patron = patronProp ?? account;

  const [newSovereign, setNewSovereign] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastRequestKey, setLastRequestKey] = useState<string | null>(null);

  // Reset form whenever the modal re-opens.
  React.useEffect(() => {
    if (isOpen) {
      setNewSovereign("");
      setLastError(null);
      setLastRequestKey(null);
    }
  }, [isOpen]);

  const canSubmit =
    !!account &&
    !!patron &&
    account.isSmart === true &&
    newSovereign.trim().length > 0 &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !account || !patron) return;
    setSubmitting(true);
    setLastError(null);
    try {
      // Prompt for the codex password if locked; abort on cancel.
      if (!(await ensureCodexUnlocked())) { setLastError("Authentication required"); return; }

      const pactCode = buildRotateSovereignPactCode({
        patron: patron.address,
        account: account.address,
        newSovereign: newSovereign.trim(),
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
              chainId: KADENA_CHAIN_ID,
              gasLimit,
            })
            .setNetworkId(KADENA_NETWORK)
            .addSigner(capsKeyPub, (w: any) => [
              w(
                `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
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
      // Optimistically update the codex's local mirror of the account's
      // sovereign — the on-chain change is committed when the tx mines,
      // but our local read is stale until the next refresh otherwise.
      await updateAccount({
        ...account,
        sovereign: newSovereign.trim(),
      });
      onSuccess?.(requestKey);
      onClose();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    ensureCodexUnlocked,
    account,
    patron,
    newSovereign,
    execute,
    updateAccount,
    onSuccess,
    onClose,
  ]);

  if (!isOpen || !account || !patron) return null;

  const renderArgs: RotateSovereignRenderArgs = {
    account,
    patron,
    newSovereign,
    onNewSovereignChange: setNewSovereign,
    onSubmit: handleSubmit,
    onCancel: onClose,
    submitting,
    lastError,
    lastRequestKey,
    canSubmit,
  };

  if (render) {
    return <>{render(renderArgs)}</>;
  }

  // Default unstyled markup.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotate-sovereign-title"
      className={className}
    >
      <h2 id="rotate-sovereign-title">Rotate Sovereign</h2>
      <p>
        Account: <code>{account.address}</code>
      </p>
      {!account.isSmart && (
        <p role="alert">
          This account is not a Smart Ouronet Account (Σ.). Sovereign
          rotation is smart-account-only.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <label>
          New sovereign account address
          <input
            type="text"
            value={newSovereign}
            onChange={(e) => setNewSovereign(e.target.value)}
            placeholder="Ѻ.NEW-SOVEREIGN-ADDRESS"
            autoComplete="off"
          />
        </label>
        {lastError && <p role="alert">{lastError}</p>}
        {lastRequestKey && <p>Submitted! Request key: {lastRequestKey}</p>}
        <div>
          {renderSubmitButton ? (
            renderSubmitButton(handleSubmit, submitting, canSubmit)
          ) : (
            <button type="submit" disabled={!canSubmit}>
              {submitting ? "Submitting…" : "Rotate Sovereign"}
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
