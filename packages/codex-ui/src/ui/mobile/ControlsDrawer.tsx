/**
 * ControlsDrawer — the full-screen list of every registered `ControlItem`,
 * grouped by source. Opened from a host chrome's own "Controls [N]" riser
 * button (the riser itself is host-specific chrome, e.g. a bottom tab bar —
 * not part of this component, mirroring the OuronetUI split between
 * `MobileTabBar` (owns the riser) and `ControlsDrawer` (owns the list) — see
 * `docs/work/codex-ui-mobile/design.md` §5).
 *
 * Renders `position: absolute; inset: 0` — it fills the nearest
 * `position: relative` ancestor (`CodexUiRoot` already is one; a host mock
 * shell embedding CodexUI can equally well own that positioning context
 * itself), never `position: fixed` against the viewport (§1 of the design
 * doc: an embedded package must never escape its own container's rectangle).
 */
import * as React from "react";
import { X } from "lucide-react";
import { useControls, type ControlItem } from "./controls-context.js";

function itemStyle(it: ControlItem): React.CSSProperties {
  if (it.kind === "notimpl") {
    return { background: "#1a0000", color: "#7f5555", border: "1px solid #3a1a1a", pointerEvents: "none" };
  }
  if (it.kind === "outline") {
    return { background: "transparent", color: it.color ?? "#9ca3af", border: it.border ?? "1px solid #3a3a3a", opacity: it.opacity ?? 1 };
  }
  return {
    background: it.gradient ?? "#161616",
    color: it.color ?? "#e5e7eb",
    border: it.border ?? "1px solid #2a2a2a",
    opacity: it.opacity ?? 1,
  };
}

export function ControlsDrawer() {
  const { groups, count, open, setOpen } = useControls();
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Controls"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0a0a0af5",
        backdropFilter: "blur(6px)",
        fontFamily: "var(--codex-font, inherit)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flex: "none",
          borderBottom: "1px solid #262626",
          padding: "12px 16px",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#d2d3d4" }}>
          Controls <span style={{ color: "#ceac5f" }}>[{count}]</span>
        </div>
        <button
          type="button"
          aria-label="Close controls"
          onClick={() => setOpen(false)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: "9999px",
            border: "1px solid #333", color: "#d2d3d4", backgroundColor: "#18181b", cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>
        {groups.length === 0 ? (
          <p style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "#555" }}>No actions available.</p>
        ) : (
          groups.map((g) => (
            <div key={g.source}>
              <div style={{ marginBottom: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#888" }}>
                {g.title}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    disabled={it.disabled || it.kind === "notimpl"}
                    onClick={() => {
                      if (it.disabled || it.kind === "notimpl") return;
                      setOpen(false);
                      it.onClick();
                    }}
                    style={{
                      width: "100%", borderRadius: 8, padding: "12px 16px",
                      textAlign: "center", fontSize: 13, fontWeight: 700,
                      cursor: it.disabled || it.kind === "notimpl" ? "not-allowed" : "pointer",
                      ...itemStyle(it),
                    }}
                  >
                    {it.disabled && it.disabledText ? it.disabledText : it.label}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ControlsDrawer;
