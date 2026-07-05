/**
 * GasSettingsCard — verbatim clone of OuronetUI's app-settings "Gas Settings"
 * subtab. Display-only: documents the adaptive gas-limit algorithm the signing
 * strategy applies (simulate → calibrated buffer → ceiling → fixed gas price).
 * No state, no data layer — pure informational card.
 */

export interface GasSettingsCardProps {
  className?: string;
}

export function GasSettingsCard({ className }: GasSettingsCardProps) {
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
      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#f59e0b" }}>Gas Settings</h3>

      <div className="p-3 rounded-lg border space-y-2" style={{ borderColor: "#262626", backgroundColor: "#111" }}>
        <p className="text-sm font-medium" style={{ color: "#d2d3d4" }}>Adaptive Gas Limit Algorithm</p>
        <p className="text-xs" style={{ color: "#555" }}>
          OuronetUI uses an adaptive gas limit algorithm for all transactions:
        </p>
        <div className="text-[10px] space-y-1 p-2 rounded" style={{ backgroundColor: "#0a0a0a", color: "#888" }}>
          <p>1. <span style={{ color: "#ceac5f" }}>Simulation (Dirty Read)</span> — transaction is simulated first to measure actual gas consumption</p>
          <p>2. <span style={{ color: "#ceac5f" }}>Auto Gas Limit</span> — calibrated buffer based on simulated gas:</p>
        </div>
        <div className="text-[9px] font-mono p-2 rounded space-y-0.5" style={{ backgroundColor: "#060606", border: "1px solid #1a1a1a", color: "#888" }}>
          <p><span style={{ color: "#ceac5f" }}>{'<'} 1,000 gas</span> → <span style={{ color: "#d2d3d4" }}>× 2.0</span></p>
          <p><span style={{ color: "#ceac5f" }}>1,000 – 20,000</span> → <span style={{ color: "#d2d3d4" }}>× 1.15</span></p>
          <p><span style={{ color: "#ceac5f" }}>20,000 – 100,000</span> → <span style={{ color: "#d2d3d4" }}>× 1.10 + 5,000 flat</span></p>
          <p><span style={{ color: "#ceac5f" }}>100,000 – 500,000</span> → <span style={{ color: "#d2d3d4" }}>× 1.10 + 10,000 flat</span></p>
          <p><span style={{ color: "#ceac5f" }}>{'>'} 500,000</span> → <span style={{ color: "#d2d3d4" }}>× 1.05 + 20,000 flat</span></p>
        </div>
        <div className="text-[10px] space-y-1 p-2 rounded" style={{ backgroundColor: "#0a0a0a", color: "#888" }}>
          <p>3. <span style={{ color: "#ceac5f" }}>Ceiling</span> — capped at block gas limit: <span className="font-mono" style={{ color: "#d2d3d4" }}>2,000,000</span></p>
          <p>4. <span style={{ color: "#ceac5f" }}>Gas Price</span> — always <span className="font-mono" style={{ color: "#d2d3d4" }}>10,000 ANU</span> (Stoa Chain minimum)</p>
        </div>
        <p className="text-[10px]" style={{ color: "#444" }}>
          Lower gas values get a larger proportional buffer (small txs are unpredictable). Higher gas values get a smaller % but a flat buffer for safety margin. Ceiling prevents exceeding block limits.
        </p>
      </div>
    </div>
  );
}

export default GasSettingsCard;
