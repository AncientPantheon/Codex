/**
 * PENDING KEY CHANGES — stage 3A, offered on the Codex ID page.
 *
 * Shown ONLY when the user chose a payment key or guard that is not yet in
 * force on chain. A user who kept both has nothing here, and the card is
 * absent entirely rather than present-and-empty.
 *
 * ## Why this is not in the wizard
 *
 * Applying these is OPTIONAL and can happen days later — the owner's point
 * that *"migration is basically a tool for those that want to give up old
 * accounts and use new ones"*. Eligibility was settled in stage 2 and does
 * not wait on any of this. Keeping it out of the wizard is also what lets
 * stages 1-2 ship without stage 3 at all.
 *
 * ## Why it says the old keys still work
 *
 * Because they do, and a card that merely says "ACTION REQUIRED" would push
 * users into transactions they do not need. Nothing is lost by never
 * pressing these buttons; the codex keeps the old keys either way.
 *
 * Presentational: it computes nothing and reads no store. The page hands it
 * the changes and the launchers.
 */

import * as React from "react";
import type { PendingKeyChange } from "../internal/outstandingKeyChanges.js";
import { MeasuredHexHighlight } from "../internal/StoaAddressHighlight.js";

export interface PendingKeyChangesCardProps {
  changes: readonly PendingKeyChange[];
  onApplyGuard?: () => void;
  onApplyPaymentKey?: () => void;
}

const boxStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  backgroundColor: "#18181B",
  border: "1px solid #262626",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const btnStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  borderRadius: 6,
  border: "none",
  backgroundColor: "#ceac5f",
  color: "#0a0a0a",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

function ChangeRow({
  change,
  onApply,
}: {
  change: PendingKeyChange;
  onApply?: () => void;
}): React.ReactElement {
  const isGuard = change.kind === "guard";
  return (
    <div data-testid={`pending-key-change-${change.kind}`} style={boxStyle}>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: "#d2d3d4" }}>
        {isGuard ? "Guard" : "Payment key"}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 10, color: "#8b8b96" }}>
          {change.from === null ? "FROM — none on record" : "FROM"}
        </span>
        {(change.from ?? []).map((k) => (
          <MeasuredHexHighlight key={k} value={k} edgeColor="#eab308" />
        ))}
        <span style={{ fontSize: 10, color: "#8b8b96", marginTop: 4 }}>
          TO{change.pred ? ` — under ${change.pred}` : ""}
        </span>
        {change.to.map((k) => (
          <MeasuredHexHighlight key={k} value={k} edgeColor="#eab308" />
        ))}
      </div>
      {onApply ? (
        <button
          type="button"
          data-testid={`pending-key-change-apply-${change.kind}`}
          onClick={onApply}
          style={btnStyle}
        >
          {isGuard ? "Rotate guard" : "Rotate payment key"}
        </button>
      ) : null}
    </div>
  );
}

export function PendingKeyChangesCard({
  changes,
  onApplyGuard,
  onApplyPaymentKey,
}: PendingKeyChangesCardProps): React.ReactElement | null {
  // Absent, not empty: a user with nothing pending must not be shown a card
  // implying there is work to do.
  if (changes.length === 0) return null;

  return (
    <div
      data-testid="pending-key-changes-card"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#d2d3d4" }}>
          Key changes you chose, not yet on chain
        </h3>
        <p
          data-testid="pending-key-changes-optional"
          style={{ margin: "6px 0 0", fontSize: 12, color: "#8b8b96" }}
        >
          This is optional. Your codex is already eligible, and your existing keys keep
          working &mdash; this codex still holds them. Applying these only matters if you
          want the keys you chose to be the ones in force on chain.
        </p>
      </div>
      {changes.map((c) => (
        <ChangeRow
          key={c.kind}
          change={c}
          onApply={c.kind === "guard" ? onApplyGuard : onApplyPaymentKey}
        />
      ))}
    </div>
  );
}

export default PendingKeyChangesCard;
