/**
 * <RotateGuardModal> — headless modal for an Ouronet account's guard
 * (ownership keyset) rotation.
 *
 * Builds the C_RotateGuard Pact tx via buildRotateGuardPactCode +
 * dispatches through useSignTransaction's CodexSigningStrategy.execute().
 *
 * Two modes:
 *   - "define"   user supplies new keys + predicate. Builder emits
 *                (read-keyset "ks"); modal attaches the keys+pred as
 *                the `ks` data slot.
 *   - "existing" user supplies an on-chain keyset-ref (e.g.
 *                "ouronet-ns.dh_sc_dpdc-keyset"). No data slot needed.
 *
 * `safe` boolean defaults to `true` in define mode (enforces extra
 * invariants on the new keyset) and `false` in existing mode (consumer
 * opts in).
 *
 * The new guard's keys must also sign in define mode (chain proves the
 * new owner consents) — passed as additional guards to execute().
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
} from "@stoachain/ouronet-core/constants";
import { buildRotateGuardPactCode } from "@stoachain/ouronet-core/pact";

import { useSignTransaction } from "../hooks/index.js";
import { useEnsureCodexUnlocked } from "../zbom/hooks/useEnsureCodexUnlocked.js";
import { useActiveWallet } from "../hooks/index.js";
import { useOuroAccounts } from "../hooks/index.js";
import type { IOuroAccount, IKeyset } from "../types/entities.js";

export type RotateGuardMode = "define" | "existing";
export type RotateGuardPred = "keys-all" | "keys-any" | "keys-2";

export interface RotateGuardRenderArgs {
  account: IOuroAccount;
  patron: IOuroAccount;
  mode: RotateGuardMode;
  onModeChange: (next: RotateGuardMode) => void;
  // define mode
  newKeys: string[];
  onNewKeysChange: (next: string[]) => void;
  newPred: RotateGuardPred;
  onNewPredChange: (next: RotateGuardPred) => void;
  // existing mode
  keysetRef: string;
  onKeysetRefChange: (next: string) => void;
  safe: boolean;
  onSafeChange: (next: boolean) => void;
  // submit
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  lastError: string | null;
  lastRequestKey: string | null;
  canSubmit: boolean;
}

export interface RotateGuardModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: IOuroAccount;
  patron?: IOuroAccount;
  onSuccess?: (requestKey: string) => void;
  className?: string;
  render?: (args: RotateGuardRenderArgs) => React.ReactNode;
  renderSubmitButton?: (
    onClick: () => void,
    submitting: boolean,
    canSubmit: boolean
  ) => React.ReactNode;
}

export function RotateGuardModal({
  isOpen,
  onClose,
  account: accountProp,
  patron: patronProp,
  onSuccess,
  className,
  render,
  renderSubmitButton,
}: RotateGuardModalProps): React.JSX.Element | null {
  const { activeOuroAccount } = useActiveWallet();
  const { updateAccount } = useOuroAccounts();
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  const account = accountProp ?? activeOuroAccount;
  const patron = patronProp ?? account;

  const [mode, setMode] = useState<RotateGuardMode>("define");
  const [newKeys, setNewKeys] = useState<string[]>([]);
  const [newPred, setNewPred] = useState<RotateGuardPred>("keys-all");
  const [keysetRef, setKeysetRef] = useState("");
  // safe defaults true in define mode (always), false in existing (opt-in).
  const [safe, setSafe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastRequestKey, setLastRequestKey] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setMode("define");
      setNewKeys([]);
      setNewPred("keys-all");
      setKeysetRef("");
      setSafe(true);
      setLastError(null);
      setLastRequestKey(null);
    }
  }, [isOpen]);

  // Define mode always emits safe=true (per OuronetUI's pattern); existing
  // mode honours the toggle.
  React.useEffect(() => {
    if (mode === "define") setSafe(true);
  }, [mode]);

  const canSubmit =
    !!account &&
    !!patron &&
    !submitting &&
    (mode === "define"
      ? newKeys.length > 0 && newKeys.every((k) => k.length > 0)
      : keysetRef.trim().length > 0);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !account || !patron) return;
    setSubmitting(true);
    setLastError(null);
    try {
      // Prompt for the codex password if locked; abort on cancel.
      if (!(await ensureCodexUnlocked())) { setLastError("Authentication required"); return; }

      const pactCode = buildRotateGuardPactCode({
        patron: patron.address,
        account: account.address,
        mode,
        keysetRef: mode === "existing" ? keysetRef.trim() : undefined,
        safe,
      });

      const guards: IKeyset[] = [];
      if (patron.guard) guards.push(patron.guard);
      if (account.guard && account.address !== patron.address) {
        guards.push(account.guard);
      }
      // In define mode, the new guard must also sign (chain proves new
      // owner consents). In existing mode, the keyset-ref's keys are
      // resolved on-chain; consumer doesn't need to sign in advance.
      if (mode === "define") {
        guards.push({ pred: newPred, keys: newKeys });
      }

      const newGuardForUpdate: IKeyset | null =
        mode === "define" ? { pred: newPred, keys: newKeys } : null;

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

          // Required data slot for define mode — the chain reads the
          // new keyset from `ks`.
          if (mode === "define") {
            builder = (builder as any).addData("ks", {
              keys: newKeys,
              pred: newPred,
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
      // Optimistic local mirror — guard rotates on the chain when the
      // tx mines; our stored guard updates immediately so UI reflects
      // intent. Real on-chain state syncs on next refresh.
      if (newGuardForUpdate) {
        await updateAccount({
          ...account,
          guard: newGuardForUpdate,
        });
      }
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
    mode,
    newKeys,
    newPred,
    keysetRef,
    safe,
    execute,
    updateAccount,
    onSuccess,
    onClose,
  ]);

  if (!isOpen || !account || !patron) return null;

  const renderArgs: RotateGuardRenderArgs = {
    account,
    patron,
    mode,
    onModeChange: setMode,
    newKeys,
    onNewKeysChange: setNewKeys,
    newPred,
    onNewPredChange: setNewPred,
    keysetRef,
    onKeysetRefChange: setKeysetRef,
    safe,
    onSafeChange: setSafe,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotate-guard-title"
      className={className}
    >
      <h2 id="rotate-guard-title">Rotate Guard</h2>
      <p>
        Account: <code>{account.address}</code>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <fieldset>
          <legend>Mode</legend>
          <label>
            <input
              type="radio"
              name="rotate-guard-mode"
              value="define"
              checked={mode === "define"}
              onChange={() => setMode("define")}
            />
            Define new keys
          </label>
          <label>
            <input
              type="radio"
              name="rotate-guard-mode"
              value="existing"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
            />
            Use existing keyset-ref
          </label>
        </fieldset>

        {mode === "define" ? (
          <>
            <label>
              New keys (comma-separated 64-hex pubkeys)
              <input
                type="text"
                value={newKeys.join(",")}
                onChange={(e) =>
                  setNewKeys(
                    e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean)
                  )
                }
                autoComplete="off"
              />
            </label>
            <label>
              Predicate
              <select
                value={newPred}
                onChange={(e) =>
                  setNewPred(e.target.value as RotateGuardPred)
                }
              >
                <option value="keys-all">keys-all (every key signs)</option>
                <option value="keys-any">keys-any (any key signs)</option>
                <option value="keys-2">keys-2 (any 2 keys sign)</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Keyset reference (e.g. ouronet-ns.dh_sc_dpdc-keyset)
              <input
                type="text"
                value={keysetRef}
                onChange={(e) => setKeysetRef(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={safe}
                onChange={(e) => setSafe(e.target.checked)}
              />
              Safe mode (enforce extra invariants)
            </label>
          </>
        )}

        {lastError && <p role="alert">{lastError}</p>}
        {lastRequestKey && <p>Submitted! Request key: {lastRequestKey}</p>}
        <div>
          {renderSubmitButton ? (
            renderSubmitButton(handleSubmit, submitting, canSubmit)
          ) : (
            <button type="submit" disabled={!canSubmit}>
              {submitting ? "Submitting…" : "Rotate Guard"}
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
