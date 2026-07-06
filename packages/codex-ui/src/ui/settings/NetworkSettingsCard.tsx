/**
 * NetworkSettingsCard (CL-11) — the chain-generic Network settings card.
 *
 * Renders a resolved `NetworkSettingsModel` as ONE ROW PER CHAIN: the chain id,
 * a human status label + health dot (Live via Pythia / Live (local) / Missing /
 * Not connected), and a manual node/gateway URL field. The field is DISABLED
 * when the chain is globally covered (`manualFieldEnabled === false`, i.e. the
 * site already provides it) and editable otherwise. When `model.locked` (or the
 * `locked` prop) every field is read-only. Editing an enabled, unlocked field
 * calls `onSetChainUrl(chainId, url)`.
 *
 * The card is chain-BLIND: it names no concrete chain and carries no per-chain
 * branch — every row is derived purely from the injected model. Styled with the
 * codex-ui dark token palette (mirrors the sibling settings cards), NOT the
 * playground's cxpg-* classes.
 */

import type { NetworkSettingsModel, ChainConnectionStatus } from "@ancientpantheon/codex-core";

export interface NetworkSettingsCardProps {
  /** The resolved per-chain network-settings model to render. */
  model: NetworkSettingsModel;
  /** Called when an enabled, unlocked URL field is edited. */
  onSetChainUrl: (chainId: string, url: string) => void;
  /**
   * The current per-chain node/gateway URL to seed each field with, keyed by
   * chainId. The `ChainConnection` seam is keyless AND URL-opaque (the endpoint
   * is closed over, never a public prop), so the surfaced URL is injected here
   * rather than read off the connection — keeping the card chain-blind.
   */
  urls?: Record<string, string>;
  /** Optional read-only override; ORed with `model.locked`. */
  locked?: boolean;
  className?: string;
}

interface StatusDisplay {
  label: string;
  dot: string;
}

const STATUS_DISPLAY: Record<ChainConnectionStatus, StatusDisplay> = {
  "live-global": { label: "Live via Pythia", dot: "#22c55e" },
  "live-local": { label: "Live (local)", dot: "#22c55e" },
  missing: { label: "Missing", dot: "#f59e0b" },
  "not-connected": { label: "Not connected", dot: "#555" },
};

export function NetworkSettingsCard({ model, onSetChainUrl, urls, locked, className }: NetworkSettingsCardProps) {
  const readOnly = Boolean(locked) || model.locked;

  return (
    <div
      className={className}
      style={{
        backgroundColor: "#0a0a0a",
        border: "1px solid #262626",
        borderRadius: 12,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "var(--codex-font, inherit)",
      }}
    >
      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#ceac5f" }}>
        Network
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {model.chains.map((chain) => {
          const display = STATUS_DISPLAY[chain.status];
          const fieldEnabled = chain.manualFieldEnabled && !readOnly;
          const url = urls?.[chain.chainId] ?? "";

          return (
            <div
              key={chain.chainId}
              data-testid={`network-row-${chain.chainId}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                border: "1px solid #1a1a1a",
                backgroundColor: "#111",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: display.dot,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#d2d3d4" }}>{chain.chainId}</span>
                <span
                  data-testid={`network-status-${chain.chainId}`}
                  style={{ fontSize: 11, fontWeight: 600, color: display.dot }}
                >
                  {display.label}
                </span>
              </div>

              <input
                type="text"
                data-testid={`network-url-${chain.chainId}`}
                aria-label={`${chain.chainId} node or gateway URL`}
                value={url}
                disabled={!chain.manualFieldEnabled}
                readOnly={readOnly}
                onChange={(e) => {
                  if (fieldEnabled) onSetChainUrl(chain.chainId, e.target.value);
                }}
                placeholder="node / gateway URL"
                style={{
                  width: "100%",
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 8,
                  backgroundColor: fieldEnabled ? "#0a0a0a" : "#0d0d0d",
                  border: "1px solid #262626",
                  color: fieldEnabled ? "#d2d3d4" : "#555",
                  fontSize: 12,
                  fontFamily: "var(--codex-font-mono, monospace)",
                  boxSizing: "border-box",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default NetworkSettingsCard;
