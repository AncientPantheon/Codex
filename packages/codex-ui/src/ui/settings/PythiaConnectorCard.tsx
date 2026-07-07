/**
 * PythiaConnectorCard — the GLOBAL connector row for the Network settings tab.
 *
 * Pythia is the multi-chain read/relay gateway: one base URL that (per its
 * advertised `health().coveredChains`) can serve several chains at once. This
 * card surfaces that single global endpoint + a live status derived from the
 * resolved model's coverage — when Pythia is set AND covers ≥1 chain, those
 * chains' per-chain LOCAL fields auto-disable in the sibling <NetworkSettingsCard>
 * ("Live via Pythia"), exactly the two-tier global⊕local precedence.
 *
 * The card is chain-BLIND — it names no concrete chain; the covered set is passed
 * in (derived from the model's `live-global` rows). Editing the URL (when unlocked)
 * calls `onSetUrl(url)`. Styled with the codex-ui dark token palette, mirroring
 * the sibling <NetworkSettingsCard>.
 */

export interface PythiaConnectorCardProps {
  /** The current Pythia base URL (empty = no global connector set). */
  url: string;
  /** Called when the (unlocked) URL field is edited. */
  onSetUrl: (url: string) => void;
  /** The chains Pythia currently covers (the model's `live-global` chainIds). */
  coveredChains: string[];
  /** Optional read-only override. */
  locked?: boolean;
  className?: string;
}

export function PythiaConnectorCard({ url, onSetUrl, coveredChains, locked, className }: PythiaConnectorCardProps) {
  const hasUrl = url.trim().length > 0;
  const covering = coveredChains.length > 0;
  // Live green when Pythia is set AND advertising coverage; amber when set but no
  // coverage yet (unreachable / advertises nothing); grey when no URL at all.
  const dot = covering ? "#22c55e" : hasUrl ? "#f59e0b" : "#555";
  const status = covering
    ? `Live — covers ${coveredChains.join(", ")}`
    : hasUrl
      ? "Set — no coverage advertised"
      : "Not connected";

  return (
    <div
      className={className}
      data-testid="pythia-connector-card"
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#ceac5f", margin: 0 }}>
          Pythia Connector
        </h3>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "1px 8px",
            borderRadius: 999,
            color: "#8b5cf6",
            border: "1px solid #8b5cf640",
          }}
        >
          global
        </span>
      </div>

      <div
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
            style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: dot, flexShrink: 0 }}
          />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#d2d3d4" }}>Pythia</span>
          <span data-testid="pythia-status" style={{ fontSize: 11, fontWeight: 600, color: dot }}>
            {status}
          </span>
        </div>

        <input
          type="text"
          data-testid="pythia-url"
          aria-label="Pythia base URL"
          value={url}
          readOnly={Boolean(locked)}
          onChange={(e) => {
            if (!locked) onSetUrl(e.target.value);
          }}
          placeholder="https://pythia.example  (base URL)"
          style={{
            width: "100%",
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            backgroundColor: locked ? "#0d0d0d" : "#0a0a0a",
            border: "1px solid #262626",
            color: locked ? "#555" : "#d2d3d4",
            fontSize: 12,
            fontFamily: "var(--codex-font-mono, monospace)",
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}

export default PythiaConnectorCard;
