/**
 * CodexModalShell — the popup chrome the packaged CodexUI modals render into:
 * a centered, scrollable card with a title bar and close button. The
 * package's signing modals (Rotate*, etc.) are headless (render-prop) by
 * design; this shell is the UI-layer skin that turns them into real centered
 * popups matching My Codex's modal look (dark card, gold title, dashed-free
 * border), without coupling the headless components to any styling.
 *
 * MOBILE: on a narrow `CodexUiRoot` (`useIsMobile()`, container-relative —
 * see `docs/work/codex-ui-mobile/design.md` §7, the Pantheonic mobile doc's
 * "modals go full-screen on mobile" rule), this is the ONE shared component
 * change that flips EVERY modal built on this shell at once — every zbom/
 * UrStoa/Send modal in the app, since they all render into this exact shell.
 * The backdrop becomes `position: absolute` (anchored to `CodexUiRoot`,
 * `position: relative` — see `codex-ui`'s `CodexUiRoot.tsx` — so a modal
 * never escapes an embedded CodexUI's own rectangle the way `position:
 * fixed` against the viewport would), and the card becomes a full-bleed,
 * content-height sheet (no max-width cap, no rounded corners) instead of a
 * centered, capped-width card. Kept byte-identical to `codex-ui`'s own copy
 * of this component plus the two `data-testid` props (this file's own STAY
 * reason — see the barrel's doc comment).
 */

import * as React from "react";
import { useState } from "react";
import { X, Eye, EyeOff } from "lucide-react";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";

export interface CodexModalShellProps {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Accent for the title + top rule. Defaults to the codex gold. */
  accent?: string;
  maxWidth?: number;
  /** `data-testid` on the dialog root. Optional — omitted callers get no
   *  attribute, exactly as before this was added. */
  dialogTestId?: string;
  /** `data-testid` on the close (×) button. Optional, same reasoning. */
  closeTestId?: string;
  /**
   * Optional footer (typically a `ModalExecuteRow`), split out from
   * `children` — owner correction (the "further optimize round 2"): "there
   * is a horizontal line, because text isn't fitted properly. buttons need
   * to stay on the bottom of the page. and be shown even if the rest of
   * what is shown there has scroll. only vertical not horizontal scroll
   * allowed." On MOBILE, supplying this splits the card into a fixed
   * header, an independently vertically-scrolling body (`children`), and a
   * footer pinned to the card's own bottom edge — never carried away by the
   * body's scroll. On DESKTOP (or when omitted), rendering is BYTE-IDENTICAL
   * to before this prop existed: `footer` is simply appended right after
   * `children` inside the same padded body div, in the exact DOM position
   * every existing caller's inline `<ModalExecuteRow />` already occupied.
   */
  footer?: React.ReactNode;
  /**
   * MOBILE ONLY, and only while `footer` is also supplied (the scrolling-body
   * split) — owner correction (design.md §8, the "further optimize round
   * 5", strengthened in round 8: "i dont want to see cut entries, this must
   * be done everywhere"). Enables `scroll-snap-type: y mandatory` on the
   * body — MANDATORY, not `proximity`: every scroll gesture is forced to
   * end exactly ON a row boundary, never resting mid-row. Inert unless the
   * caller's own rows opt in via their own `scrollSnapAlign` — omitted (the
   * default), the body scrolls exactly as before this prop existed.
   */
  bodySnap?: boolean;
  /**
   * Optional bar pinned ABOVE the scrolling body, right beneath the header
   * — owner correction (design.md §8, the "further optimize round 6"):
   * "the button must stay fixed at the top, only the entries scroll." Same
   * split mechanism `footer` already uses, mirrored to the top edge instead
   * of the bottom — on MOBILE this (or `footer`) triggers the fixed-header/
   * scrolling-body/pinned-edges split; on DESKTOP (or when omitted),
   * rendering is BYTE-IDENTICAL to before this prop existed: `topBar` is
   * simply prepended before `children` inside the same padded body div.
   */
  topBar?: React.ReactNode;
  /**
   * MOBILE ONLY — round 22 owner correction: "the bit string display isnt
   * using the available space, and is shwoing scroll, when clearly you can
   * see it has extension place. it is only after the available space is
   * consumed should the scroll be used." Triggers the SAME fixed-header/
   * scrolling-body split `footer`/`topBar` already use, WITHOUT requiring
   * either — for a caller with no header/footer bar of its own (like
   * `DalosSecretReveal`'s reveal modals) that still wants its body to
   * establish a definite, `flex: 1, minHeight: 0` height so ITS OWN
   * descendants can flex-fill the remaining card height and only scroll
   * once truly full, instead of the whole card silently sizing to a
   * content height far shorter than the screen (leaving dead space below
   * a separately-capped inner scrollbox). Omitted (the default) leaves
   * every existing caller BYTE-IDENTICAL — `footer`/`topBar` still work
   * exactly as before, standalone or combined with this prop.
   */
  fillBody?: boolean;
  /**
   * Stacking-order override. Defaults to 9999 — every EXISTING caller is
   * byte-identical either way. Mirrors `codex-ui`'s own copy of this
   * component (see that file's doc comment for the bug this exists to
   * fix — a `CodexModalShell`-based popup, e.g. the global password
   * prompt, opened FROM INSIDE an already-open `ZbomModalFrame`
   * (z-index 10050) must be able to render ABOVE it, not invisibly behind
   * it).
   */
  zIndex?: number;
}

export function CodexModalShell({
  title,
  subtitle,
  onClose,
  children,
  accent = "#ceac5f",
  maxWidth = 520,
  dialogTestId,
  closeTestId,
  footer,
  bodySnap,
  topBar,
  fillBody,
  zIndex = 9999,
}: CodexModalShellProps) {
  const isMobile = useIsMobile();
  // Mobile WITH a footer AND/OR a topBar AND/OR `fillBody` gets the
  // fixed-header/scrolling-body/pinned-edges split — every other
  // combination (desktop, or none of the three supplied) renders exactly
  // as before.
  const footerSplit = isMobile && (footer !== undefined || topBar !== undefined || fillBody === true);
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={dialogTestId}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: isMobile ? "absolute" : "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 16,
        backgroundColor: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(2px)",
        // Explicit (not just the implicit default) — a caller MAY portal this
        // shell into a `pointer-events: none` overlay wrapper (e.g. a
        // full-screen modal-portal target spanning a mobile shell's whole
        // body — docs/work/codex-ui-mobile/design.md §8), and `pointer-events`
        // is inherited; without this override the whole dialog would
        // silently become unclickable in that case.
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: isMobile ? "none" : maxWidth,
          height: isMobile ? "100%" : undefined,
          maxHeight: isMobile ? "100%" : "90vh",
          overflowY: footerSplit ? "hidden" : "auto",
          overflowX: footerSplit ? "hidden" : undefined,
          display: footerSplit ? "flex" : undefined,
          flexDirection: footerSplit ? "column" : undefined,
          backgroundColor: "#0a0a0a",
          border: isMobile ? "none" : "1px solid #262626",
          borderRadius: isMobile ? 0 : 16,
          boxShadow: isMobile ? "none" : "0 20px 60px rgba(0,0,0,0.6)",
          fontFamily: "var(--codex-font, inherit)",
          color: "#d2d3d4",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: `1px solid ${accent}30`,
            flexShrink: footerSplit ? 0 : undefined,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: accent }}>{title}</h2>
            {subtitle && <div style={{ marginTop: 2, fontSize: 11, color: "#888" }}>{subtitle}</div>}
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid={closeTestId}
            onClick={onClose}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: "#141414", border: "1px solid #262626", color: "#888", cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>
        {footerSplit && topBar !== undefined && (
          <div style={{ flexShrink: 0, padding: "12px 20px", borderBottom: "1px solid #262626", backgroundColor: "#0a0a0a" }}>
            {topBar}
          </div>
        )}
        <div
          data-testid={dialogTestId ? `${dialogTestId}-body` : undefined}
          style={{
            padding: 20,
            overflowY: footerSplit ? "auto" : undefined,
            overflowX: footerSplit ? "hidden" : undefined,
            scrollSnapType: footerSplit && bodySnap ? "y mandatory" : undefined,
            flex: footerSplit ? 1 : undefined,
            minHeight: footerSplit ? 0 : undefined,
            // Round 23 owner correction: "i want the [field] itself to be
            // scrollable, not the whole full scren to be scrollable." This
            // div was never actually `display: flex` — round 22's `fillBody`
            // gave IT a real bounded height (via `flex: 1` above, which DOES
            // work here since THIS div's own parent, the card, is the flex
            // column), but any CHILD's own `flex: 1` (e.g.
            // `DalosSecretReveal`'s root, meant to fill this exact body and
            // hand the remainder to its own inner scroll box) is a total
            // no-op unless ITS immediate parent is ALSO a flex container —
            // it silently wasn't, so every child rendered at natural content
            // height instead, and THIS div's own `overflowY: auto` ended up
            // doing all the scrolling — dragging the header-adjacent content
            // (chip/warning/tabs) along with it instead of leaving them
            // fixed and confining scroll to the one field meant to grow.
            display: footerSplit ? "flex" : undefined,
            flexDirection: footerSplit ? "column" : undefined,
          }}
        >
          {!footerSplit && topBar}
          {children}
          {!footerSplit && footer}
        </div>
        {footerSplit && footer !== undefined && (
          <div style={{ flexShrink: 0, padding: "12px 20px", borderTop: "1px solid #262626", backgroundColor: "#0a0a0a" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* Shared form primitives for the modal bodies. */

export const modalLabel: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#888", marginBottom: 6,
};

export const modalInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", height: 40, padding: "0 12px", borderRadius: 8,
  backgroundColor: "#111", border: "1px solid #262626", color: "#d2d3d4",
  fontFamily: "var(--codex-font-mono, ui-monospace, monospace)", fontSize: 13,
};

export function ModalExecuteRow({
  onCancel, onSubmit, submitting, canSubmit, label, accent = "#ceac5f",
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  label: string;
  accent?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
      <button
        type="button"
        onClick={onCancel}
        style={{ padding: "10px 16px", borderRadius: 8, background: "transparent", border: "1px solid #262626", color: "#d2d3d4", cursor: "pointer", fontSize: 13 }}
      >
        Cancel
      </button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          padding: "10px 20px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13,
          backgroundColor: accent, color: "#0a0a0a",
          cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.5,
        }}
      >
        {submitting ? "Submitting…" : label}
      </button>
    </div>
  );
}

/** Password input with a show/hide reveal toggle (eye icon). */
export function PasswordField({
  value, onChange, onEnter, autoFocus, placeholder = "••••••••",
}: {
  value: string;
  onChange: (next: string) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        placeholder={placeholder}
        style={{ ...modalInput, paddingRight: 40, fontFamily: "var(--codex-font, inherit)" }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        title={show ? "Hide" : "Show"}
        aria-label={show ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#888", cursor: "pointer", display: "inline-flex", padding: 2 }}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function ModalFeedback({ error, requestKey }: { error: string | null; requestKey: string | null }) {
  return (
    <>
      {error && (
        <p role="alert" style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, fontSize: 12, backgroundColor: "#8b1a1a15", border: "1px solid #8b1a1a40", color: "#f87171" }}>
          {error}
        </p>
      )}
      {requestKey && (
        <p style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, fontSize: 12, backgroundColor: "#22c55e15", border: "1px solid #22c55e40", color: "#4ade80", wordBreak: "break-all" }}>
          Submitted — request key: {requestKey}
        </p>
      )}
    </>
  );
}
