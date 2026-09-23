/**
 * DebouncerInfoModal — the "What is this?" full-screen explainer for the
 * header debouncer (`CodexDebouncerPanel`'s own `onInfo` trigger).
 *
 * Owner correction: "in the OuronetUI implementation this also has an i
 * infomatic, that brings up an infomatic page. we need the same here, and
 * that infomatic page must be a full screen page with a x (from which you
 * opt out via the x)." OuronetUI's own version `navigate("/app/debouncer")`s
 * to a dedicated ROUTE — a real full page. This package is embedded (no
 * router of its own — that's WHY `CodexDebouncerPanel.onInfo` is left as an
 * injected callback rather than baked-in navigation), so a full-screen modal
 * is the closest equivalent. Deliberately ALWAYS full-bleed on EVERY
 * platform (not just mobile, unlike `CodexModalShell`'s own responsive
 * split) — it's meant to read as a dedicated page, not a floating popup
 * card, on desktop too.
 *
 * Reuses `DebouncerSettingsCard` verbatim — the SAME tier table/explainer
 * content already shown on the Settings → Debouncer subpage — instead of
 * duplicating it. Close-button-only dismissal (no overlay/Esc close),
 * matching every other explicit-dismiss surface in this package (e.g.
 * `ZbomModalFrame`).
 *
 * z-index (10060) sits above `ZbomModalFrame`'s 10050 and
 * `CodexModalShell`'s 9999 — the debouncer's own info trigger is reachable
 * from the always-visible header, so if a host ever manages to open it
 * while another full-screen surface is already up, this must still win.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { DebouncerSettingsCard } from "../../ui/settings/DebouncerSettingsCard.js";

export interface DebouncerInfoModalProps {
  onClose: () => void;
}

export function DebouncerInfoModal({ onClose }: DebouncerInfoModalProps) {
  // Lock body scroll while open (mirrors `ZbomModalFrame`'s own behavior).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="What is this? — Debouncer explainer"
      data-testid="debouncer-info-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10060,
        backgroundColor: "#0a0a0a",
        overflowY: "auto",
        fontFamily: "var(--codex-font, inherit)",
        color: "#d2d3d4",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid #262626",
          backgroundColor: "#0a0a0a",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#ceac5f" }}>What is this?</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-testid="debouncer-info-modal-close"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: "#141414", border: "1px solid #262626", color: "#888", cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div style={{ padding: 20 }}>
        <DebouncerSettingsCard />
      </div>
    </div>,
    document.body,
  );
}

export default DebouncerInfoModal;
