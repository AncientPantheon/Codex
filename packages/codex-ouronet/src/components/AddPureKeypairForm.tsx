/**
 * <AddPureKeypairForm> — import a raw private key as a foreign keypair.
 *
 * Workflow:
 *   1. User pastes a 64-hex private key + an optional label.
 *   2. Form derives the matching public key via tryDerivePublicKey.
 *   3. On submit: requests password (via useRequestPassword), encrypts
 *      the private key with smartEncrypt, calls usePureKeypairs.addKeypair.
 *
 * The encryption happens here (in the form) rather than at the adapter
 * because the adapter contract says it stores encrypted blobs as-is —
 * encryption is the hook layer's job.
 *
 * Headless — accepts className + render-prop slots for full theming.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import { tryDerivePublicKey } from "@stoachain/stoa-core/guard";
import { smartEncrypt } from "@stoachain/stoa-core/crypto";
import { useCodexStore } from "../provider/index.js";
import { usePureKeypairs } from "../hooks/index.js";
import { useRequestPassword } from "../hooks/index.js";

export interface AddPureKeypairRenderArgs {
  privateKey: string;
  onPrivateKeyChange: (next: string) => void;
  label: string;
  onLabelChange: (next: string) => void;
  /** Derived public key if the input is a valid hex key, else null. */
  derivedPublicKey: string | null;
  /** Validation message, e.g. "Private key must be 64 hex chars". */
  validationMessage: string | null;
  /** Submit handler. */
  onSubmit: () => void;
  /** Whether submit is currently in flight. */
  submitting: boolean;
  /** Last submit error, if any. */
  lastError: string | null;
}

export interface AddPureKeypairFormProps {
  className?: string;
  render?: (args: AddPureKeypairRenderArgs) => React.ReactNode;
  /** Optional callback after a successful add. Receives the saved keypair. */
  onSuccess?: (saved: { id: string; publicKey: string }) => void;
}

export function AddPureKeypairForm({
  className,
  render,
  onSuccess,
}: AddPureKeypairFormProps): React.JSX.Element {
  const store = useCodexStore();
  const { addKeypair } = usePureKeypairs();
  const requestPassword = useRequestPassword();
  const [privateKey, setPrivateKey] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Derive pubkey for live preview. Two accepted formats:
  //   - 64 hex  → plain Ed25519 seed (Pact -g / Koala / raw foreign key).
  //   - 128 hex → BIP32-Ed25519 extended key [kL‖kR] in Chainweaver /
  //               kadenakeys.io export format. tryDerivePublicKey routes this
  //               through publicKeyFromExtendedKey (kL·B). Signing with such a
  //               key is handled by InternalCodexResolver, which repackages it
  //               for the WASM extended-key signer.
  const isAcceptedLen = privateKey.length === 64 || privateKey.length === 128;
  const derivedPublicKey = isAcceptedLen ? tryDerivePublicKey(privateKey) : null;

  const validationMessage = (() => {
    if (!privateKey) return null;
    if (!isAcceptedLen)
      return "Private key must be 64 hex characters (Ed25519) or 128 (Chainweaver extended key).";
    if (!/^[0-9a-fA-F]+$/.test(privateKey))
      return "Private key must be valid hex (0-9, a-f).";
    if (!derivedPublicKey)
      return "Could not derive a public key from this input.";
    return null;
  })();

  const isValid = !validationMessage && isAcceptedLen && !!derivedPublicKey;

  const handleSubmit = useCallback(async () => {
    if (!isValid || !derivedPublicKey) return;
    setSubmitting(true);
    setLastError(null);
    try {
      const password = await requestPassword();
      const encrypted = await smartEncrypt(privateKey, password, "1.0");
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `pure-${Date.now()}`;
      const saved = {
        id,
        label: label || undefined,
        publicKey: derivedPublicKey,
        encryptedPrivateKey: encrypted,
        createdAt: new Date().toISOString(),
      };
      await addKeypair(saved);
      setPrivateKey("");
      setLabel("");
      onSuccess?.({ id, publicKey: derivedPublicKey });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
    // store ref only used inside requestPassword; closure is sufficient
  }, [
    isValid,
    derivedPublicKey,
    privateKey,
    label,
    requestPassword,
    addKeypair,
    onSuccess,
    store,
  ]);

  const renderArgs: AddPureKeypairRenderArgs = {
    privateKey,
    onPrivateKeyChange: setPrivateKey,
    label,
    onLabelChange: setLabel,
    derivedPublicKey,
    validationMessage,
    onSubmit: handleSubmit,
    submitting,
    lastError,
  };

  if (render) {
    return <>{render(renderArgs)}</>;
  }

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <label>
        Private key (64 or 128 hex chars)
        <input
          type="text"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value.trim())}
          maxLength={128}
          autoComplete="off"
          aria-invalid={validationMessage ? "true" : undefined}
          aria-describedby={
            validationMessage ? "codex-pure-keypair-validation" : undefined
          }
        />
      </label>
      <label>
        Label (optional)
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      {derivedPublicKey && (
        <p>
          <small>Derived public key: {derivedPublicKey}</small>
        </p>
      )}
      {validationMessage && (
        <p id="codex-pure-keypair-validation" role="alert">
          {validationMessage}
        </p>
      )}
      {lastError && <p role="alert">{lastError}</p>}
      <button type="submit" disabled={!isValid || submitting}>
        {submitting ? "Adding…" : "Add foreign keypair"}
      </button>
    </form>
  );
}
