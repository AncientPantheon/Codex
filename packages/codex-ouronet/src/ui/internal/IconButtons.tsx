/**
 * IconButtons — ported 1:1 from OuronetUI's `src/components/IconButtons.tsx`.
 * Canonical icon buttons (copy / delete / rename / explorer) used across the
 * account + seed + key rows. Already fully inline-styled in the original, so
 * this is a near-verbatim port (clipboard copy, hex palette, sizes unchanged).
 */

import { Copy, Check, ExternalLink, Trash2, Pencil, EyeOff } from "lucide-react";
import { useState } from "react";

const ICON_SIZE = 13;
const BTN_SIZE = 28;

const BASE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: BTN_SIZE,
  height: BTN_SIZE,
  borderRadius: "6px",
  flexShrink: 0,
  cursor: "pointer",
  transition: "opacity 0.15s",
};

interface IconCopyBtnProps {
  text: string;
  size?: number;
  id?: string;
}

export function IconCopyBtn({ text, size = BTN_SIZE }: IconCopyBtnProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Copy"
      style={{
        ...BASE_STYLE,
        width: size,
        height: size,
        backgroundColor: copied ? "#0a2a14" : "#141414",
        color: copied ? "#4ade80" : "#777",
        border: copied ? "2px solid rgba(74,222,128,0.4)" : "2px solid #252525",
      }}
    >
      {copied ? (
        <Check size={ICON_SIZE} strokeWidth={2.5} />
      ) : (
        <Copy size={ICON_SIZE} strokeWidth={2} />
      )}
    </button>
  );
}

interface IconHideBtnProps {
  onClick: (e: React.MouseEvent) => void;
  size?: number;
}

/** Neutral icon button that hides a revealed secret (EyeOff). Same resting
 *  palette as IconCopyBtn so the two sit together cleanly in a reveal row. */
export function IconHideBtn({ onClick, size = BTN_SIZE }: IconHideBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Hide"
      aria-label="Hide seed phrase"
      style={{
        ...BASE_STYLE,
        width: size,
        height: size,
        backgroundColor: "#141414",
        color: "#777",
        border: "2px solid #252525",
      }}
    >
      <EyeOff size={ICON_SIZE} strokeWidth={2} />
    </button>
  );
}

interface IconStoaExplorerBtnProps {
  href: string;
  size?: number;
}

export function IconStoaExplorerBtn({ href, size = BTN_SIZE }: IconStoaExplorerBtnProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Stoa Chain Explorer"
      style={{
        ...BASE_STYLE,
        width: size,
        height: size,
        backgroundColor: "#1a1400",
        color: "#ceac5f",
        border: "2px solid rgba(120, 70, 10, 0.8)",
        textDecoration: "none",
      }}
    >
      <ExternalLink size={ICON_SIZE} strokeWidth={2} />
    </a>
  );
}

interface IconOuronetExplorerBtnProps {
  size?: number;
}

export function IconOuronetExplorerBtn({ size = BTN_SIZE }: IconOuronetExplorerBtnProps) {
  return (
    <button
      type="button"
      disabled
      title="Ouronet Explorer (coming soon)"
      style={{
        ...BASE_STYLE,
        width: size,
        height: size,
        backgroundColor: "#0d1f3a",
        color: "#5a9adf",
        border: "2px solid rgba(20, 45, 100, 0.9)",
        opacity: 0.35,
        cursor: "not-allowed",
      }}
    >
      <ExternalLink size={ICON_SIZE} strokeWidth={2} />
    </button>
  );
}

interface IconDeleteBtnDisabledProps {
  size?: number;
  title?: string;
}

export function IconDeleteBtnDisabled({ size = BTN_SIZE, title = "Cannot delete" }: IconDeleteBtnDisabledProps) {
  return (
    <button
      type="button"
      disabled
      title={title}
      style={{
        ...BASE_STYLE,
        width: size,
        height: size,
        backgroundColor: "#2d0e0e",
        color: "#c0392b",
        border: "2px solid rgba(80, 20, 20, 0.9)",
        opacity: 0.4,
        cursor: "not-allowed",
      }}
    >
      <Trash2 size={ICON_SIZE} strokeWidth={2} />
    </button>
  );
}

interface IconRenameBtnRectProps {
  onClick: (e: React.MouseEvent) => void;
  size?: number;
}

export function IconRenameBtnRect({ onClick, size = BTN_SIZE }: IconRenameBtnRectProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Rename"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        height: size,
        paddingLeft: "8px",
        paddingRight: "10px",
        borderRadius: "6px",
        flexShrink: 0,
        cursor: "pointer",
        transition: "opacity 0.15s",
        backgroundColor: "#0a2010",
        color: "#4ade80",
        border: "2px solid rgba(20, 80, 40, 0.9)",
        fontSize: "11px",
        fontWeight: 600,
      }}
    >
      <Pencil size={11} strokeWidth={2} />
      Rename
    </button>
  );
}

interface IconDeleteBtnProps {
  onClick: (e: React.MouseEvent) => void;
  size?: number;
}

export function IconDeleteBtn({ onClick, size = BTN_SIZE }: IconDeleteBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Delete"
      style={{
        ...BASE_STYLE,
        width: size,
        height: size,
        backgroundColor: "#2d0e0e",
        color: "#c0392b",
        border: "2px solid rgba(80, 20, 20, 0.9)",
      }}
    >
      <Trash2 size={ICON_SIZE} strokeWidth={2} />
    </button>
  );
}
