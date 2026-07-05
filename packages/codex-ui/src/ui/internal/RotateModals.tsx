/**
 * Styled rotate-modal wrappers — turn the package's headless Rotate*Modal
 * components (src/components, render-prop pattern) into real centered popups
 * via CodexModalShell. The signing engine is unchanged (useSignTransaction →
 * CodexSigningStrategy → InternalCodexResolver + PactClient); these only
 * supply the popup chrome + styled form so the CodexUI buttons present and
 * execute the same operations My Codex does, self-contained in the package.
 */

import * as React from "react";
import {
  CodexModalShell,
  ModalExecuteRow,
  ModalFeedback,
  modalLabel,
  modalInput,
} from "./CodexModalShell.js";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";
// Type-only: the render-arg shapes for the three concrete headless modals. These
// are erased at compile under verbatimModuleSyntax, so no value edge to the
// Ouronet `components` barrel results.
import type {
  RotatePaymentKeyRenderArgs,
  RotateGuardRenderArgs,
  RotateSovereignRenderArgs,
} from "@ancientpantheon/codex-ouronet/components";

const hint: React.CSSProperties = { fontSize: 12, color: "#888", marginTop: 0, marginBottom: 16, lineHeight: 1.5 };
const validationStyle: React.CSSProperties = { marginTop: 8, fontSize: 12, color: "#f87171" };

/**
 * The concrete headless `Rotate*Modal` (from the Ouronet `components` barrel)
 * carries a value `@stoachain` + zbom edge, so it is INJECTED rather than
 * statically imported. The generic shell only owns the styled chrome supplied
 * via each modal's `render` prop; the Ouronet host passes the real modal
 * component in as `ModalComponent`. Typed structurally over the render-arg bag
 * so codex-ui needs no value import of the concrete modal.
 */
export type InjectedRotateModal<A> = React.ComponentType<{
  isOpen: boolean;
  onClose: () => void;
  account?: IOuroAccount;
  render: (args: A) => React.ReactNode;
}>;

interface RotateModalProps<A> {
  isOpen: boolean;
  onClose: () => void;
  account?: IOuroAccount;
  /** The concrete headless modal, injected by the Ouronet host. */
  ModalComponent: InjectedRotateModal<A>;
}

export function StyledRotatePaymentKeyModal({ isOpen, onClose, account, ModalComponent }: RotateModalProps<RotatePaymentKeyRenderArgs>) {
  return (
    <ModalComponent
      isOpen={isOpen}
      onClose={onClose}
      account={account}
      render={(a) => (
        <CodexModalShell title="Rotate Payment Key" subtitle={<code>{a.account.address}</code>} onClose={a.onCancel}>
          <p style={hint}>
            Replace this account's Kadena-Ledger payment key. The patron guard signs to authorize
            the rotation. Enter the new payment key's public key (64-char hex).
          </p>
          <label style={modalLabel}>New Payment Key</label>
          <input
            style={modalInput}
            value={a.newPaymentKey}
            onChange={(e) => a.onNewPaymentKeyChange(e.target.value.trim())}
            maxLength={64}
            autoComplete="off"
            placeholder="64-char hex public key"
          />
          {a.validationMessage && <p style={validationStyle}>{a.validationMessage}</p>}
          <ModalFeedback error={a.lastError} requestKey={a.lastRequestKey} />
          <ModalExecuteRow onCancel={a.onCancel} onSubmit={a.onSubmit} submitting={a.submitting} canSubmit={a.canSubmit} label="Rotate Payment Key" />
        </CodexModalShell>
      )}
    />
  );
}

export function StyledRotateGuardModal({ isOpen, onClose, account, ModalComponent }: RotateModalProps<RotateGuardRenderArgs>) {
  return (
    <ModalComponent
      isOpen={isOpen}
      onClose={onClose}
      account={account}
      render={(a) => (
        <CodexModalShell title="Rotate Guard" subtitle={<code>{a.account.address}</code>} onClose={a.onCancel}>
          <p style={hint}>
            Rotate this account's ownership keyset. Define new keys (the new owner must also sign),
            or point at an existing on-chain keyset reference.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {(["define", "existing"] as const).map((m) => {
              const active = a.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => a.onModeChange(m)}
                  style={{
                    flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${active ? "#ceac5f" : "#262626"}`,
                    backgroundColor: active ? "#ceac5f15" : "#111",
                    color: active ? "#ceac5f" : "#888",
                  }}
                >
                  {m === "define" ? "Define new keys" : "Existing keyset-ref"}
                </button>
              );
            })}
          </div>

          {a.mode === "define" ? (
            <>
              <label style={modalLabel}>New Keys (comma-separated 64-hex pubkeys)</label>
              <input
                style={modalInput}
                value={a.newKeys.join(",")}
                onChange={(e) => a.onNewKeysChange(e.target.value.split(",").map((k) => k.trim()).filter(Boolean))}
                autoComplete="off"
                placeholder="pub1,pub2,…"
              />
              <label style={{ ...modalLabel, marginTop: 14 }}>Predicate</label>
              <select
                style={{ ...modalInput, fontFamily: "var(--codex-font, inherit)" }}
                value={a.newPred}
                onChange={(e) => a.onNewPredChange(e.target.value as typeof a.newPred)}
              >
                <option value="keys-all">keys-all (every key signs)</option>
                <option value="keys-any">keys-any (any key signs)</option>
                <option value="keys-2">keys-2 (any 2 keys sign)</option>
              </select>
            </>
          ) : (
            <>
              <label style={modalLabel}>Keyset Reference</label>
              <input
                style={modalInput}
                value={a.keysetRef}
                onChange={(e) => a.onKeysetRefChange(e.target.value)}
                autoComplete="off"
                placeholder="ouronet-ns.dh_sc_dpdc-keyset"
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 12, color: "#d2d3d4", cursor: "pointer" }}>
                <input type="checkbox" checked={a.safe} onChange={(e) => a.onSafeChange(e.target.checked)} />
                Safe mode (enforce extra invariants)
              </label>
            </>
          )}
          <ModalFeedback error={a.lastError} requestKey={a.lastRequestKey} />
          <ModalExecuteRow onCancel={a.onCancel} onSubmit={a.onSubmit} submitting={a.submitting} canSubmit={a.canSubmit} label="Rotate Guard" />
        </CodexModalShell>
      )}
    />
  );
}

export function StyledRotateSovereignModal({ isOpen, onClose, account, ModalComponent }: RotateModalProps<RotateSovereignRenderArgs>) {
  return (
    <ModalComponent
      isOpen={isOpen}
      onClose={onClose}
      account={account}
      render={(a) => (
        <CodexModalShell title="Rotate Sovereign" subtitle={<code>{a.account.address}</code>} accent="#a78bfa" onClose={a.onCancel}>
          <p style={hint}>
            Transfer sovereignty of this Smart account to a different Ѻ. Standard Ouronet Account.
            Enter the new sovereign's Ouronet address.
          </p>
          <label style={modalLabel}>New Sovereign (Ѻ. address)</label>
          <input
            style={modalInput}
            value={a.newSovereign}
            onChange={(e) => a.onNewSovereignChange(e.target.value.trim())}
            autoComplete="off"
            placeholder="Ѻ.…"
          />
          <ModalFeedback error={a.lastError} requestKey={a.lastRequestKey} />
          <ModalExecuteRow onCancel={a.onCancel} onSubmit={a.onSubmit} submitting={a.submitting} canSubmit={a.canSubmit} label="Rotate Sovereign" accent="#a78bfa" />
        </CodexModalShell>
      )}
    />
  );
}
