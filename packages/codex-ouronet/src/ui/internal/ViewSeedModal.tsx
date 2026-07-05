/**
 * ViewSeedModal — password-gated reveal of an Ouronet account's underlying
 * seed/secret. Mirrors My Codex's `handleViewOuro` (decrypt `account.secret`
 * with `smartDecrypt`). When the codex is locked it now PROMPTS for the password
 * inline (unlocking + caching via `authenticate` with the configured TTL) rather
 * than just erroring — so revealing from a locked codex Just Works.
 *
 * (The full origin-aware DALOS word-grid reveal — OuronetUI's 633-LOC
 * ViewSeedPhraseModal — is a later fidelity pass.)
 */

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Lock } from "lucide-react";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import { useCodexAuth } from "../../hooks/index.js";
import { useCodex } from "../../hooks/index.js";
import { CodexModalShell, PasswordField, ModalExecuteRow } from "./CodexModalShell.js";
import { DalosSecretReveal } from "./DalosSecretReveal.js";
import { detectOriginCurve } from "./originCurve.js";
import type { IOuroAccount } from "../../types/entities.js";

export interface ViewSeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  account?: IOuroAccount;
  name?: string;
}

export function ViewSeedModal({ isOpen, onClose, account, name }: ViewSeedModalProps): React.JSX.Element | null {
  const { getCurrentPassword, authenticate } = useCodexAuth();
  const { uiSettings } = useCodex();
  const ttl = typeof uiSettings.passwordCacheMinutes === "number" ? uiSettings.passwordCacheMinutes : undefined;

  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [pw, setPw] = useState("");

  const attempt = useCallback(async (explicitPw: string | null) => {
    if (!account) return;
    setError(null);
    let password: string;
    if (explicitPw !== null) {
      authenticate(explicitPw, ttl); // cache + unlock
      password = explicitPw;
    } else {
      try {
        password = getCurrentPassword();
      } catch {
        setNeedsPassword(true); // locked → prompt
        return;
      }
    }
    setLoading(true);
    try {
      const plain = await smartDecrypt(account.secret, password);
      setPhrase(plain);
      setNeedsPassword(false);
    } catch {
      setError(explicitPw !== null ? "Incorrect password — try again." : "Could not decrypt the secret.");
      if (explicitPw !== null) setNeedsPassword(true);
    } finally {
      setLoading(false);
    }
  }, [account, authenticate, getCurrentPassword, ttl]);

  useEffect(() => {
    if (!isOpen || !account) return;
    setPhrase(null);
    setError(null);
    setNeedsPassword(false);
    setPw("");
    void attempt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, account]);

  if (!isOpen || !account) return null;

  const originMode = account.originMode ?? "seedWords";
  const originSeedTab = account.originSeedTab;
  const originCurve = account.originCurve ?? detectOriginCurve(account);

  return (
    <CodexModalShell title={`${name ?? "Ouronet Account"} — Secret Reveal`} maxWidth={880} onClose={onClose}>
      {needsPassword ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Lock style={{ width: 14, height: 14, color: "#888" }} />
            <span style={{ fontSize: 12, color: "#888" }}>The codex is locked. Enter your password to reveal.</span>
          </div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888", marginBottom: 6 }}>
            Codex password
          </label>
          <PasswordField
            value={pw}
            onChange={setPw}
            onEnter={() => { if (pw) void attempt(pw); }}
            autoFocus
          />
          {error && <p style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{error}</p>}
          <ModalExecuteRow
            onCancel={onClose}
            onSubmit={() => { if (pw) void attempt(pw); }}
            submitting={loading}
            canSubmit={!!pw && !loading}
            label="Unlock & Reveal"
            accent="#22c55e"
          />
        </div>
      ) : loading ? (
        <p style={{ fontSize: 12, color: "#888", fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>Decrypting…</p>
      ) : error ? (
        <p role="alert" style={{ padding: "10px 12px", borderRadius: 8, fontSize: 12, backgroundColor: "#8b1a1a15", border: "1px solid #8b1a1a40", color: "#f87171" }}>
          {error}
        </p>
      ) : phrase ? (
        <DalosSecretReveal
          plaintext={phrase}
          originMode={originMode}
          originSeedTab={originSeedTab}
          originCurve={originCurve}
          isSmart={account.isSmart}
        />
      ) : null}
    </CodexModalShell>
  );
}
