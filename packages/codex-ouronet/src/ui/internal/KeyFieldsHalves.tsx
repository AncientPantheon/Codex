/**
 * KeyFieldsHalves — the shared key geometry used by both the Seed Words key
 * rows and the Pure Key Pairs entries:
 *
 *   Desktop:  [ Public Key … (copy) ] | [ Private Key (blurred) (show) (copy) ]
 *             — side by side, each half the available width. The private
 *             half is masked + blurred until "Show" is clicked.
 *
 *   MOBILE (docs/work/codex-ui-mobile/design.md §8, the "further optimize
 *   round 4" — owner correction: "instead of using 2 rows on each entry…
 *   we instead use one row, and switch between with a switcher square…
 *   this way we can show many more entries per seed"): ONE row, showing
 *   EITHER the public OR the private key at a time, toggled by a switcher
 *   button. Tapping the switcher to reveal the private key decrypts AND
 *   shows it immediately — "tapping the switcher key shows it directly…
 *   truly shown, not blurred — we don't have any blurred variant now, since
 *   we are revealing it with the switcher tap" — so there's no separate
 *   eye/blur step on mobile the way desktop still has. The single copy
 *   button copies whichever key is CURRENTLY on screen. Both keys render
 *   through `MeasuredHexHighlight` (first 3 / last 3 characters
 *   highlighted, measured middle-ellipsis when the row is too narrow) —
 *   the public key in the standard silver/yellow pair, the private key
 *   entirely in orange ("the private key we show in in the same orange
 *   colour").
 *
 * The key text is shown in FULL when it fits and ellipsis-truncated only
 * when the row is too narrow. Copy on the private side works whether cached
 * or not (it decrypts silently to the clipboard on demand).
 */

import { useState } from "react";
import { Eye, EyeOff, Copy, Check, Loader2, ArrowLeftRight } from "lucide-react";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";
import { MeasuredHexHighlight } from "./StoaAddressHighlight.js";

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
  const isMobile = useIsMobile();
  const [priv, setPriv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedPub, setCopiedPub] = useState(false);
  const [copiedPriv, setCopiedPriv] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // MOBILE ONLY — which key the single row currently displays.
  const [showPrivate, setShowPrivate] = useState(false);

  const copyTo = (text: string, set: (v: boolean) => void) => {
    void navigator.clipboard.writeText(text).catch(() => {});
    set(true);
    setTimeout(() => set(false), 1200);
  };

  // Desktop's own Eye/EyeOff "Show"/"Hide" toggle — blurred-then-revealed.
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

  // MOBILE's own switcher — tapping it to reveal the private key decrypts
  // AND shows it in the SAME motion (no separate blurred step): "tapping
  // the switcher key shows it directly… truly shown, not blurred."
  const toggleSwitch = async () => {
    if (!showPrivate && !priv) {
      setErr(null); setBusy(true);
      try { setPriv(await decryptPrivate()); }
      catch { setErr("Unlock the codex to view the private key."); return; }
      finally { setBusy(false); }
    }
    setShowPrivate((v) => !v);
  };

  const copyCurrentMobile = async () => {
    setErr(null);
    if (showPrivate) {
      try { copyTo(priv ?? (await decryptPrivate()), setCopiedPriv); }
      catch { setErr("Unlock the codex to copy the private key."); }
    } else {
      copyTo(publicKey, setCopiedPub);
    }
  };

  if (isMobile) {
    const displayValue = showPrivate ? priv : publicKey;
    // Public key: the standard silver body + yellow first-3/last-3 pair,
    // same visual language as `StoaAddressHighlight`. Private key: entirely
    // orange (owner correction: "the private key we show in in the same
    // orange colour") — a deliberately DIFFERENT read from everything else,
    // signalling "sensitive" at a glance.
    const color = showPrivate ? "#f59e0b" : "#c0c0c0";
    const copied = showPrivate ? copiedPriv : copiedPub;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, backgroundColor: "#0a0a0a", border: `1px solid ${showPrivate ? "#8b1a1a30" : "#1f1f23"}`, borderRadius: 8, padding: "5px 6px 5px 10px" }}>
          <MiniBtn onClick={() => void toggleSwitch()} title={showPrivate ? "Switch to public key" : "Switch to private key"}>
            {busy ? <Loader2 size={12} style={{ animation: "codex-seed-spin 0.9s linear infinite" }} /> : <ArrowLeftRight size={12} />}
          </MiniBtn>
          {displayValue && (
            <MeasuredHexHighlight
              value={displayValue}
              baseColor={color}
              edgeColor={showPrivate ? color : "#eab308"}
              style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12 }}
            />
          )}
          <MiniBtn onClick={() => void copyCurrentMobile()} title={showPrivate ? "Copy private key" : "Copy public key"} copied={copied}>
            {copied ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
          </MiniBtn>
        </div>
        {err && <span style={{ fontSize: 10, color: "#c0392b" }}>{err}</span>}
      </div>
    );
  }

  const publicHalf = (
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, backgroundColor: "#0a0a0a", border: "1px solid #1f1f23", borderRadius: 8, padding: "5px 6px 5px 10px" }}>
      <code style={codeStyle("#c0c0c0", false)}>{publicKey}</code>
      <MiniBtn onClick={() => copyTo(publicKey, setCopiedPub)} title="Copy public key" copied={copiedPub}>
        {copiedPub ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
      </MiniBtn>
    </div>
  );

  const privateHalf = (
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, backgroundColor: "#0a0a0a", border: "1px solid #8b1a1a30", borderRadius: 8, padding: "5px 6px 5px 10px" }}>
      <code style={codeStyle(priv ? "#f59e0b" : "#8a6a30", !priv)}>{priv ?? MASK}</code>
      <MiniBtn onClick={() => void toggleShow()} title={priv ? "Hide private key" : "Show private key"}>
        {busy ? <Loader2 size={12} style={{ animation: "codex-seed-spin 0.9s linear infinite" }} /> : priv ? <EyeOff size={12} /> : <Eye size={12} />}
      </MiniBtn>
      <MiniBtn onClick={() => void copyPriv()} title="Copy private key" copied={copiedPriv}>
        {copiedPriv ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
      </MiniBtn>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, minWidth: 0, alignItems: "center" }}>
        {publicHalf}
        {privateHalf}
      </div>
      {err && <span style={{ fontSize: 10, color: "#c0392b" }}>{err}</span>}
    </div>
  );
}

export default KeyFieldsHalves;
