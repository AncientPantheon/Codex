/**
 * ExperimentalCurvesCard — token-styled port of OuronetUI's
 * ExperimentalCurvesCardContent.
 *
 * Toggle-based gate for the APOLLO experimental primitive. Reads the current
 * flag from `useCodex().uiSettings.experimentalCurvesEnabled` and writes it
 * via the store's `updateUiSettings` action (reached through useCodexStore —
 * the same internal-store seam the per-entity hooks use). No Redux. Styled
 * via `--codex-*` tokens.
 */

import { useCallback } from "react";
import { useCodex } from "../../hooks/useCodex.js";
import { useCodexStore } from "../../provider/index.js";

export interface ExperimentalCurvesCardProps {
  className?: string;
}

export function ExperimentalCurvesCard({
  className,
}: ExperimentalCurvesCardProps) {
  const { uiSettings } = useCodex();
  const store = useCodexStore();
  const enabled = uiSettings.experimentalCurvesEnabled === true;

  const toggle = useCallback(() => {
    void store
      .getState()
      .actions.updateUiSettings({ experimentalCurvesEnabled: !enabled });
  }, [store, enabled]);

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            fontWeight: 500,
            padding: "2px 10px",
            borderRadius: "999px",
            color: enabled ? "var(--codex-warning)" : "var(--codex-text-dim)",
            border: `1px solid ${
              enabled ? "var(--codex-warning)" : "var(--codex-border)"
            }`,
          }}
        >
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      <p
        style={{
          fontSize: "10px",
          lineHeight: 1.6,
          color: "var(--codex-text-dim)",
          backgroundColor: "var(--codex-surface)",
          borderRadius: "var(--codex-radius)",
          padding: "8px",
        }}
      >
        Exposes the{" "}
        <strong style={{ color: "var(--codex-warning)" }}>
          APOLLO 1024-bit
        </strong>{" "}
        curve in the Create Account modal. APOLLO accounts are{" "}
        <strong style={{ color: "var(--codex-warning)" }}>
          observational only
        </strong>{" "}
        — StoaChain™ Pact contracts do not recognise ₱./Π. prefixes, so
        activation and on-chain signing are blocked in the UI.
      </p>

      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%",
          padding: "8px 16px",
          borderRadius: "var(--codex-radius)",
          fontWeight: 600,
          cursor: "pointer",
          backgroundColor: enabled
            ? "var(--codex-surface)"
            : "var(--codex-warning)",
          color: enabled ? "var(--codex-text)" : "var(--codex-bg)",
          border: enabled ? "1px solid var(--codex-warning)" : "none",
        }}
      >
        {enabled
          ? "Disable Experimental Curves"
          : "Enable Experimental Curves"}
      </button>
    </div>
  );
}

export default ExperimentalCurvesCard;
