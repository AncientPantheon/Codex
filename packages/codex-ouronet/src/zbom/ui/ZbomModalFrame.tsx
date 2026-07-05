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
 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface ZbomModalFrameProps {
  /** Box width in px (modals pass 600 or 720). Mirrors Modal's `width`. */
  width?: number;
  /** Close handler — wired to the top-right X only (no overlay/esc close). */
  onClose: () => void;
  children: ReactNode;
}

export function ZbomModalFrame({ width = 600, onClose, children }: ZbomModalFrameProps) {
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
      // .dialog-overlay — fixed inset-0 z-60 bg-black/80 backdrop-blur-md.
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        backgroundColor: "rgba(0,0,0,0.8)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        overflowY: "auto",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      <div
        // .dialog-content — #0a0a0a / 1px #262626 / rounded-2xl / p-6 /
        // shadow-xl / margin-top 96px / margin-bottom 2rem. `width` honoured up
        // to viewport, then shrinks to 100%.
        style={{
          position: "relative",
          width,
          maxWidth: "calc(100vw - 2rem)",
          marginTop: 96,
          marginBottom: "2rem",
          padding: 24,
          borderRadius: 16,
          backgroundColor: "#0a0a0a",
          border: "1px solid #262626",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,.5), 0 8px 10px -6px rgba(0,0,0,.5)",
        }}
      >
        {/* Close X — top-right, absolute (mirrors Modal's CloseButton). */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
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
