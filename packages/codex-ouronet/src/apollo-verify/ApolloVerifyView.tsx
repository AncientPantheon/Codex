/**
 * ApolloVerifyView — the generic `/apollo-verify` page
 * (docs/HANDOFF-apollo-ownership-verifier.md).
 *
 * A relying party (RP) deep-links here with a set of Apollo accounts to prove, a
 * challenge nonce, its `rp` id, and a return URL. Running inside a Codex that
 * holds the user's Apollo keys, we sign the canonical message with WHICHEVER of
 * those accounts this Codex holds, then redirect back to the RP with the
 * signature(s). The private key never leaves the browser — only signatures.
 *
 * Mirrors OuronetUI's `verify.tsx` but on the Apollo curve, generalized to N
 * accounts + an `rp`. Lives in codex-ouronet (the value `@stoachain` edge) and
 * is mounted by each consumer app at `/apollo-verify`.
 */

import { useMemo, useState } from "react";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KeyRound, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useOuroAccounts, useCodexAuth, useRequestPassword } from "../hooks/index.js";
import { signApolloOwnership, type ApolloProof } from "./signApolloOwnership.js";

type Phase = "idle" | "signing" | "redirecting" | "done" | "error";

function parseAccountsParam(raw: string | null): string[] {
  if (!raw) return [];
  // URLSearchParams has already %-decoded the value; the RP joined the (each
  // encodeURIComponent'd) accounts with commas, and Apollo strings contain no
  // commas — so a plain split yields the account strings.
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export interface ApolloVerifyViewProps {
  /** Override the query source (defaults to window.location.search). */
  search?: string;
}

export function ApolloVerifyView({ search }: ApolloVerifyViewProps = {}): React.JSX.Element {
  const params = useMemo(
    () => new URLSearchParams(search ?? (typeof window !== "undefined" ? window.location.search : "")),
    [search],
  );
  const requested = useMemo(() => parseAccountsParam(params.get("accounts")), [params]);
  const nonce = params.get("challenge") ?? "";
  const rp = params.get("rp") ?? "";
  const callback = params.get("callback") ?? "";

  const { accounts } = useOuroAccounts();
  const { isLocked } = useCodexAuth();
  const requestPassword = useRequestPassword();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Which requested accounts this Codex actually holds (match by address).
  const held = useMemo(
    () => requested.filter((addr) => accounts.some((a) => a.address === addr)),
    [requested, accounts],
  );
  const missing = requested.filter((addr) => !held.includes(addr));

  const redirectBack = (proofs: ApolloProof[]) => {
    if (!callback) { setPhase("done"); return; }
    const sep = callback.includes("?") ? "&" : "?";
    setPhase("redirecting");
    window.location.href =
      `${callback}${sep}challenge=${encodeURIComponent(nonce)}` +
      `&proofs=${encodeURIComponent(JSON.stringify(proofs))}`;
  };

  async function handleSign() {
    setPhase("signing");
    setError(null);
    try {
      const proofs: ApolloProof[] = [];
      if (held.length > 0) {
        const password = await requestPassword(); // prompts if locked; rejects on cancel
        for (const addr of held) {
          const acct = accounts.find((a) => a.address === addr);
          if (!acct) continue;
          const secret = await smartDecrypt(acct.secret, password);
          proofs.push(signApolloOwnership(acct, secret, nonce, rp));
        }
      }
      // Redirect back even if nothing was signed (proofs=[]), so the RP can show
      // "none verified" and the user can retry through the right Codex.
      redirectBack(proofs);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const invalid = requested.length === 0 || !nonce || !rp;
  const box: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#b3b4b6" };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e7ecf5", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "var(--codex-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)" }}>
      <div style={{ width: "100%", maxWidth: 460, borderRadius: 16, border: "1px solid #f9731640", background: "#0d1117", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <KeyRound style={{ width: 18, height: 18, color: "#f97316" }} />
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#f97316" }}>Apollo ownership</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>Prove Apollo key ownership</h1>

        {invalid ? (
          <p style={{ fontSize: 13, color: "#9aa6c2", margin: 0 }}>
            Invalid verification link — open it from the relying party (missing accounts / challenge / rp).
          </p>
        ) : (
          <>
            <div style={box}>
              <span style={{ color: "#9aa6c2" }}>
                Relying party: <span style={{ color: "#d2d3d4", fontFamily: "var(--codex-font-mono, monospace)" }}>{rp}</span>
              </span>
              <span style={{ color: "#9aa6c2" }}>
                Requested {requested.length} account{requested.length === 1 ? "" : "s"} — this Codex holds{" "}
                <strong style={{ color: held.length ? "#4ade80" : "#f0a978" }}>{held.length}</strong>.
              </span>
            </div>

            {missing.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: "1px solid #f9731630", background: "#f9731608", display: "flex", gap: 8 }}>
                <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: "#f0a978" }} />
                <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "#f0a978" }}>
                  {missing.length} account{missing.length === 1 ? " isn't" : "s aren't"} in this Codex. You can still verify the {held.length} held here now, then re-open this link in the Codex that holds the other{missing.length === 1 ? "" : "s"}.
                </p>
              </div>
            )}

            <p style={{ fontSize: 11, lineHeight: 1.6, color: "#9aa6c2", margin: "12px 0" }}>
              You'll sign a one-time challenge with each held Apollo key. Your private key never leaves this browser — only the signatures return to the relying party.
            </p>

            {isLocked && (
              <p style={{ fontSize: 11, color: "#f0a978", margin: "0 0 10px" }}>
                Your Codex is locked — you'll be prompted for your password when you sign.
              </p>
            )}

            {phase === "done" ? (
              <div style={{ borderRadius: 8, border: "1px solid #14532d", background: "#052e16", padding: 12, display: "flex", gap: 8 }}>
                <CheckCircle2 style={{ width: 16, height: 16, flexShrink: 0, color: "#4ade80" }} />
                <p style={{ margin: 0, fontSize: 12, color: "#7ef0a3" }}>Signed. No callback in the link — nothing to redirect to.</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSign}
                disabled={phase === "signing" || phase === "redirecting"}
                style={{ width: "100%", padding: "10px 16px", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 700, cursor: phase === "signing" || phase === "redirecting" ? "default" : "pointer", backgroundColor: "#f97316", color: "#0a0a0a", opacity: phase === "signing" || phase === "redirecting" ? 0.6 : 1 }}
              >
                {phase === "signing" ? (<><Loader2 style={{ display: "inline", width: 15, height: 15, marginRight: 6, verticalAlign: "text-bottom" }} className="animate-spin" />Signing…</>)
                  : phase === "redirecting" ? "Returning to relying party…"
                  : held.length > 0 ? `Sign & verify (${held.length})` : "Return (none in this Codex)"}
              </button>
            )}

            {error && <p style={{ marginTop: 12, fontSize: 12, color: "#c0392b" }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default ApolloVerifyView;
