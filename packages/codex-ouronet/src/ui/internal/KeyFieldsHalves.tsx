/**
 * KeyFieldsHalves — the shared two-column key geometry used by both the Seed
 * Words key rows and the Pure Key Pairs entries:
 *
 *   [ Public Key … (copy) ] | [ Private Key (blurred) (show) (copy) ]
 *
 * Each half is half the available width. The key text is shown in FULL when it
 * fits and ellipsis-truncated only when the column is too narrow (overflow +
 * text-overflow). The private half is masked + blurred until "Show" is clicked,
 * which decrypts on demand (so we never run the CPU-heavy seed-key derivation
 * for keys the user never reveals). Copy on the private side works whether
 * masked or revealed (it decrypts silently to the clipboard).
 */

import { useState } from "react";
import { Eye, EyeOff, Copy, Check, Loader2 } from "lucide-react";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

/** Self-inject the compositor spin keyframe (idempotent). */
const SPIN_ID = "codex-seed-spin-keyframes";
if (typeof document !== "undefined" && !document.getElementById(SPIN_ID)) {
  const el = document.createElement("style");
  el.id = SPIN_ID;
  el.textContent = "@keyframes codex-seed-spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(el);
}

const MASK = "•".repeat(64);

const codeStyle = (color: string, blurred: boolean): React.CSSProperties => ({
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: MONO,
  fontSize: 12,
  color,
  filter: blurred ? "blur(3.5px)" : "none",
  userSelect: blurred ? "none" : "auto",
});

function MiniBtn({
  onClick, title, copied, children,
}: {
  onClick: () => void;
  title: string;
  copied?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
        borderRadius: 6, flexShrink: 0, cursor: "pointer",
        backgroundColor: copied ? "#0a2a14" : "#141414",
        color: copied ? "#4ade80" : "#777",
        border: copied ? "2px solid rgba(74,222,128,0.4)" : "2px solid #252525",
      }}
    >
      {children}
    </button>
  );
}

export interface KeyFieldsHalvesProps {
  publicKey: string;
  /** Returns the plaintext private key (must own the unlock gate). */
  decryptPrivate: () => Promise<string>;
}

export function KeyFieldsHalves({ publicKey, decryptPrivate }: KeyFieldsHalvesProps) {
  const [priv, setPriv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedPub, setCopiedPub] = useState(false);
  const [copiedPriv, setCopiedPriv] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const copyTo = (text: string, set: (v: boolean) => void) => {
    void navigator.clipboard.writeText(text).catch(() => {});
    set(true);
    setTimeout(() => set(false), 1200);
  };

  const toggleShow = async () => {
    if (priv) { setPriv(null); return; }
    setErr(null); setBusy(true);
    try { setPriv(await decryptPrivate()); }
    catch { setErr("Unlock the codex to view the private key."); }
    finally { setBusy(false); }
  };

  const copyPriv = async () => {
    setErr(null);
    try { copyTo(priv ?? (await decryptPrivate()), setCopiedPriv); }
    catch { setErr("Unlock the codex to copy the private key."); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, minWidth: 0, alignItems: "center" }}>
        {/* Public half */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, backgroundColor: "#0a0a0a", border: "1px solid #1f1f23", borderRadius: 8, padding: "5px 6px 5px 10px" }}>
          <code style={codeStyle("#c0c0c0", false)}>{publicKey}</code>
          <MiniBtn onClick={() => copyTo(publicKey, setCopiedPub)} title="Copy public key" copied={copiedPub}>
            {copiedPub ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
          </MiniBtn>
        </div>

        {/* Private half */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, backgroundColor: "#0a0a0a", border: "1px solid #8b1a1a30", borderRadius: 8, padding: "5px 6px 5px 10px" }}>
          <code style={codeStyle(priv ? "#f59e0b" : "#8a6a30", !priv)}>{priv ?? MASK}</code>
          <MiniBtn onClick={() => void toggleShow()} title={priv ? "Hide private key" : "Show private key"}>
            {busy ? <Loader2 size={12} style={{ animation: "codex-seed-spin 0.9s linear infinite" }} /> : priv ? <EyeOff size={12} /> : <Eye size={12} />}
          </MiniBtn>
          <MiniBtn onClick={() => void copyPriv()} title="Copy private key" copied={copiedPriv}>
            {copiedPriv ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
          </MiniBtn>
        </div>
      </div>
      {err && <span style={{ fontSize: 10, color: "#c0392b" }}>{err}</span>}
    </div>
  );
}

export default KeyFieldsHalves;
