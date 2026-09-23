/**
 * ZbomModalFrame — chromeless replacement for OuronetUI's `ui/Modal/Modal.tsx`
 * (blueprint §7.4). The cloned ZBOM modals wrap their <ZbomLayout> in this
 * frame exactly where OuronetUI wraps them in <Modal isOpen onClose
 * shouldCloseOnOverlayClick={false} shouldCloseOnEsc={false} width={…}>.
 *
 * Why not clone Modal.tsx: it pulls react-modal + framer-motion + the global
 * `dialog-*` CSS (none of which the package ships) and CodexModalShell would
 * auto-render a header that duplicates ZbomLayout's. This frame reproduces the
 * SAME visual box from `_dialog.css` with inline styles only:
 *   overlay  → .dialog-overlay  (fixed inset-0 z-60 bg-black/80 backdrop-blur-md)
 *   content  → .dialog-content  (#0a0a0a / 1px #262626 / rounded-2xl / p-6 /
 *                                shadow-xl / margin-top 96px / margin-bottom 2rem)
 * Overlay-click and Esc never close (matches the modals' explicit props); the
 * close affordance is the top-right X wired to onClose (PiX→X, blueprint §7.2).
 *
 * MOBILE (owner correction, `OuronetAccountsTab`'s mobile full-screen account
 * expand round): "clicking the activate button, brings up the zbom. this
 * also itself needs be full screen instead of popin up like its on desktop,
 * because it appears somehow in the background... instead it has to be
 * opened on its own full screen with close button. closing brings the user
 * to the previous full screen." Two DISTINCT bugs were at play:
 *   1. Layering: this frame ALWAYS portals straight to `document.body` at a
 *      fixed z-index of 60 — `CodexModalShell`'s own mobile full-screen
 *      popup (e.g. `AccountRow`'s account-detail view) sits at z-index 9999,
 *      so a ZBOM modal opened FROM inside one of those always rendered
 *      BEHIND it (invisible until the account view closed). Bumped well
 *      above 9999 so this frame always wins the stack, on any platform,
 *      opened from anywhere.
 *   2. Layout: this frame was never actually responsive — even on a real
 *      mobile viewport it rendered the SAME narrow centered card (capped
 *      `width`, rounded corners, `marginTop: 96`) any desktop popup gets.
 *      MOBILE ONLY now goes full-bleed (no rounded corners, no margin, fills
 *      the viewport) — the same "modals go full-screen on mobile" treatment
 *      `CodexModalShell` already gives every OTHER popup in this app.
 * The close-button-only dismissal (no overlay/Esc close) is UNCHANGED — the
 * X reveals whatever was rendered behind this frame, which is now correctly
 * the account's own full-screen view instead of the tab underneath it.
 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";

export interface ZbomModalFrameProps {
  /** Box width in px (modals pass 600 or 720). Mirrors Modal's `width`. Mobile ignores this — it always goes full-bleed. */
  width?: number;
  /** Close handler — wired to the top-right X only (no overlay/esc close). */
  onClose: () => void;
  children: ReactNode;
}

export function ZbomModalFrame({ width = 600, onClose, children }: ZbomModalFrameProps) {
  const isMobile = useIsMobile();
  // Lock body scroll while open (mirrors `.dialog-open { overflow: hidden }`).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      data-testid="zbom-modal-frame"
      // .dialog-overlay — fixed inset-0 bg-black/80 backdrop-blur-md. z-index
      // bumped from the original 60 (see module doc comment, point 1).
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        backgroundColor: "rgba(0,0,0,0.8)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        overflowY: "auto",
        display: "flex",
        justifyContent: "center",
        alignItems: isMobile ? "stretch" : "flex-start",
      }}
    >
      <div
        // .dialog-content — #0a0a0a / 1px #262626 / rounded-2xl / p-6 /
        // shadow-xl / margin-top 96px / margin-bottom 2rem, desktop. MOBILE:
        // full-bleed, edge-to-edge (see module doc comment, point 2).
        style={{
          position: "relative",
          width: isMobile ? "100%" : width,
          maxWidth: isMobile ? "none" : "calc(100vw - 2rem)",
          minHeight: isMobile ? "100%" : undefined,
          boxSizing: "border-box",
          marginTop: isMobile ? 0 : 96,
          marginBottom: isMobile ? 0 : "2rem",
          padding: isMobile ? "20px 16px" : 24,
          borderRadius: isMobile ? 0 : 16,
          backgroundColor: "#0a0a0a",
          border: isMobile ? "none" : "1px solid #262626",
          boxShadow: isMobile ? "none" : "0 20px 25px -5px rgba(0,0,0,.5), 0 8px 10px -6px rgba(0,0,0,.5)",
        }}
      >
        {/* Close X — top-right, absolute (mirrors Modal's CloseButton). */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-testid="zbom-modal-frame-close"
          style={{
            position: "absolute",
            top: 18,
            right: 24,
            zIndex: 10,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            color: "#888",
          }}
        >
          <X style={{ width: 18, height: 18 }} />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}

export default ZbomModalFrame;
