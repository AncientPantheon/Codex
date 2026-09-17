/**
 * MultiStepToastContainer — cloned faithfully from OuronetUI
 * `src/components/ui/MultiStepToast.tsx`.
 *
 * Mount <MultiStepToastContainer /> once. Subscribes to the package's
 * toastStore and renders the bottom-right stack via createPortal.
 *
 * Icon swap (T1, per blueprint §7.2): react-icons/pi → lucide-react —
 *   PiCheck→Check, PiWarning→AlertTriangle, PiSpinnerGap→Loader2,
 *   PiCopy→Copy, PiX→X, PiArrowSquareOut→ExternalLink.
 * All inline styles / structure / CSS keyframes kept verbatim.
 */

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, AlertTriangle, Loader2, Copy, X, ExternalLink } from "lucide-react";
import { toastStore, DISMISS_MS, type ToastEntry, type StepStatus, type StepData, type ToastChain } from "./toastManager.js";

/**
 * Per-chain display theme: the explorer a "View on Explorer"/copy-link
 * button points at, and the accent color used while a toast of that chain
 * is active (pending/in-flight step border, spinner, status dot). Keyed by
 * `ToastEntry.chain` (defaults to `'stoachain'`) so a toast never has to
 * guess which explorer format its `requestKey` is in.
 *
 * Bug this fixes: a single hardcoded `EXPLORER_TX` pointed EVERY toast —
 * including Arweave sends — at `explorer.stoachain.com/transactions/<id>`,
 * a dead link for an Arweave tx id. Arweave gets its own entry, matching the
 * ViewBlock convention `ArweaveAccountsArea.tsx` already uses for address
 * pages (`viewblock.io/arweave/address/<addr>`), plus a distinct accent
 * (violet, not StoaChain gold) so a stack of toasts reads "different chain"
 * at a glance.
 */
const CHAIN_THEME: Record<ToastChain, { accent: string; explorerTx: (id: string) => string }> = {
  stoachain: {
    accent: "#ceac5f",
    explorerTx: (id) => `https://explorer.stoachain.com/transactions/${id}`,
  },
  arweave: {
    accent: "#a78bfa",
    explorerTx: (id) => `https://viewblock.io/arweave/tx/${id}`,
  },
};

function themeFor(chain: ToastChain | undefined): { accent: string; explorerTx: (id: string) => string } {
  return CHAIN_THEME[chain ?? "stoachain"];
}

// ── Hook: subscribe to store ────────────────────────────────────────────────

function useToasts(): ToastEntry[] {
  const [toasts, setToasts] = useState<ToastEntry[]>(() => toastStore.getAll());

  useEffect(() => {
    // Re-read on every notify
    const unsub = toastStore.subscribe(() => {
      setToasts([...toastStore.getAll()]);
    });
    return unsub;
  }, []);

  return toasts;
}

// ── Colors ──────────────────────────────────────────────────────────────────

// `done`/`error`/`pending` are universal status semantics (green/red/gray),
// unrelated to which chain the toast belongs to. Only `active` — "this toast
// is doing something right now" — reflects the chain's theme accent, which is
// where the "different chain" visual cue actually needs to land.
function stepColor(status: StepStatus, accent: string): string {
  switch (status) {
    case "pending": return "#555";
    case "active": return accent;
    case "done": return "#4ade80";
    case "error": return "#c0392b";
  }
}

// ── Inline styles (no external CSS needed except keyframes) ─────────────────

const CARD_STYLE: React.CSSProperties = {
  width: 340,
  borderRadius: 10,
  border: "1px solid #262630",
  backgroundColor: "#111116",
  overflow: "hidden",
  fontFamily: "system-ui, -apple-system, sans-serif",
  boxShadow: "0 4px 24px rgba(0,0,0,.5)",
  marginBottom: 6,
};

// ── Result section (collapsible) ────────────────────────────────────────────

function ResultSection({ steps }: { steps: StepData[] }) {
  const withResult = steps.filter(s => s.result);
  const [expanded, setExpanded] = useState(false);
  if (!withResult.length) return null;

  const single = steps.length === 1;
  const text = withResult.map(s => single ? s.result! : `Step ${steps.indexOf(s)}: ${s.result}`).join("\n");
  const lineCount = text.split("\n").length;
  const canExpand = lineCount > 7;
  const LINE_H = 16;
  const maxLines = expanded ? lineCount : 7;

  return (
    <div style={{ padding: "0 14px 10px" }}>
      {/* Single unified result field */}
      <div style={{
        backgroundColor: "#0a0a0f",
        borderRadius: 6,
        border: "1px solid #1a1a1a",
        overflow: "hidden",
      }}>
        {/* Text area */}
        <div style={{
          maxHeight: maxLines * LINE_H + 12,
          overflowY: expanded && lineCount > 7 ? "auto" : "hidden",
          padding: "6px 8px",
          fontSize: 10,
          lineHeight: `${LINE_H}px`,
          color: "#999",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
          transition: "max-height .2s",
        }}>
          {text}
        </div>
        {/* Internal separator + controls */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 8px",
          borderTop: "1px solid #1a1a1a",
        }}>
          <span
            onClick={() => canExpand && setExpanded(!expanded)}
            style={{
              fontSize: 9, cursor: canExpand ? "pointer" : "default",
              color: canExpand ? "#ceac5f" : "#444",
              userSelect: "none",
            }}
          >
            {expanded ? "Show less" : "Show more"}
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(text).catch(() => {})}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
            title="Copy result"
          >
            <Copy style={{ width: 10, height: 10, color: "#555" }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast card ──────────────────────────────────────────────────────────────

function ToastCard({ toast, onDismiss }: { toast: ToastEntry; onDismiss: () => void }) {
  const allDone = toast.steps.every(s => s.status === "done");
  const hasError = toast.steps.some(s => s.status === "error");
  const single = toast.steps.length === 1;
  const theme = themeFor(toast.chain);
  const dotColor = hasError ? "#c0392b" : allDone ? "#4ade80" : theme.accent;

  // Depletion: use CSS animation. Key = settledAt so animation restarts if settledAt changes.
  const showDepletion = allDone && !hasError && toast.settledAt != null;

  return (
    <div style={CARD_STYLE}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid #1a1a24" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
          {/* Status dot */}
          <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#d2d3d4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {toast.title}
          </span>
          {/* Single-step: show label inline */}
          {single && (
            <span style={{ fontSize: 10, color: stepColor(toast.steps[0].status, theme.accent), fontWeight: 500, whiteSpace: "nowrap" }}>
              — {toast.steps[0].label}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", padding: 3 }}>
            <X style={{ width: 12, height: 12, color: "#555" }} />
          </button>
        </div>
      </div>

      {/* Single-step spinner */}
      {single && toast.steps[0].status === "active" && (
        <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 className="toast-spin" style={{ width: 16, height: 16, color: theme.accent }} />
          <span style={{ fontSize: 10, color: "#888" }}>Processing...</span>
        </div>
      )}

      {/* Multi-step: step circles */}
      {!single && (
        <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 0 }}>
          {toast.steps.map((step, i) => (
            <React.Fragment key={i}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 50 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: `2px solid ${stepColor(step.status, theme.accent)}`, color: stepColor(step.status, theme.accent), backgroundColor: "#0a0a0f",
                }}>
                  {step.status === "active" && <Loader2 className="toast-spin" style={{ width: 12, height: 12 }} />}
                  {step.status === "done" && <Check style={{ width: 12, height: 12, color: "#4ade80" }} />}
                  {step.status === "error" && <AlertTriangle style={{ width: 12, height: 12, color: "#c0392b" }} />}
                  {step.status === "pending" && <div style={{ width: 8, height: 8, borderRadius: "50%", border: "2px solid #555" }} />}
                </div>
                <span style={{ fontSize: 9, color: "#888", marginTop: 3, textAlign: "center", maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {step.label}
                </span>
              </div>
              {i < toast.steps.length - 1 && (
                <div style={{ flex: 1, height: 2, backgroundColor: step.status === "done" ? "#4ade80" : "#262630", marginBottom: 14 }} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Request keys */}
      {toast.steps.some(s => s.requestKey) && (
        <div style={{ padding: "6px 14px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          {toast.steps.map((step, i) => step.requestKey ? (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 8px",
              backgroundColor: "#0a0a0f", borderRadius: 6, border: "1px solid #1a1a1a",
            }}>
              {/* Key text — full width, truncate with ellipsis */}
              <span style={{
                flex: 1, fontSize: 10, color: "#888",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                minWidth: 0,
              }}>
                {!single ? `Step ${i}: ` : ""}{step.requestKey}
              </span>
              {/* Copy explorer link */}
              <button
                onClick={() => navigator.clipboard.writeText(theme.explorerTx(step.requestKey!)).catch(() => {})}
                title="Copy Explorer link"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, flexShrink: 0, display: "flex" }}
              >
                <Copy style={{ width: 10, height: 10, color: "#555" }} />
              </button>
              {/* Explorer link — active only when confirmed */}
              {step.status === "done" ? (
                <a href={theme.explorerTx(step.requestKey!)} target="_blank" rel="noopener noreferrer" title="View on Explorer" style={{ flexShrink: 0, display: "flex", padding: 2 }}>
                  <ExternalLink style={{ width: 10, height: 10, color: theme.accent }} />
                </a>
              ) : (
                <span style={{ flexShrink: 0, display: "flex", padding: 2, opacity: 0.25 }} title="Available after confirmation">
                  <ExternalLink style={{ width: 10, height: 10, color: "#555" }} />
                </span>
              )}
            </div>
          ) : null)}
        </div>
      )}

      {/* Arweave-only caption: WE confirm against the canonical gateway
          (`/tx/{id}/status`), but a third-party explorer like ViewBlock runs
          its OWN separate indexer, which can lag behind that confirmation by
          several minutes — clicking "View on Explorer" the instant this
          toast settles can still 404 for a bit. This sets that expectation
          honestly instead of implying the link is guaranteed live the moment
          it becomes clickable. Distinct copy for the two settled labels:
          "Confirmed" means WE verified it mined; "Submitted" means only the
          broadcast succeeded — our own poll budget ran out (or gave up)
          before verifying mining, so the explorer wait may be longer still. */}
      {toast.chain === "arweave" && allDone && !hasError && (
        <div style={{ padding: "0 14px 10px", fontSize: 9, color: "#555" }}>
          {toast.steps[0]?.label === "Confirmed"
            ? "Confirmed on-chain — third-party explorers can take a few minutes to index it."
            : "Broadcast succeeded — mining + explorer indexing can take several minutes on Arweave."}
        </div>
      )}

      {/* Results */}
      <ResultSection steps={toast.steps} />

      {/* Depletion bar — CSS animation, starts when settledAt is set. Duration
          is per-toast (`toast.dismissMs`, e.g. arweave's 10x-longer window),
          NOT the shared `.toast-deplete` class's own duration — the inline
          `animationDuration` here overrides just that one sub-property. */}
      {showDepletion && (
        <div style={{ height: 3, backgroundColor: "#1a1a1a", overflow: "hidden" }}>
          <div
            key={toast.settledAt}
            className="toast-deplete"
            style={{ height: "100%", backgroundColor: "#4ade80", width: "100%", animationDuration: `${toast.dismissMs ?? DISMISS_MS}ms` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Container ───────────────────────────────────────────────────────────────

export function MultiStepToastContainer() {
  const toasts = useToasts();

  const dismiss = useCallback((id: string) => {
    toastStore.remove(id);
  }, []);

  // Listen for CSS animation end to auto-dismiss
  const handleAnimEnd = useCallback((e: React.AnimationEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.animationName === "toast-shrink" && target.classList.contains("toast-deplete")) {
      // Find the toast card ancestor and dismiss
      const card = target.closest("[data-toast-id]");
      if (card) {
        const id = card.getAttribute("data-toast-id");
        if (id) toastStore.remove(id);
      }
    }
  }, []);

  if (!toasts.length) return null;

  return createPortal(
    <div
      onAnimationEnd={handleAnimEnd}
      style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 10000,
        display: "flex", flexDirection: "column-reverse",
        maxHeight: "80vh", overflowY: "auto",
      }}
    >
      {toasts.map(t => (
        <div key={t.id} data-toast-id={t.id}>
          <ToastCard toast={t} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}

      <style>{`
        @keyframes toast-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .toast-spin {
          animation: toast-spin 1s linear infinite;
        }
        @keyframes toast-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
        .toast-deplete {
          animation: toast-shrink ${DISMISS_MS}ms linear forwards;
        }
      `}</style>
    </div>,
    document.body
  );
}
