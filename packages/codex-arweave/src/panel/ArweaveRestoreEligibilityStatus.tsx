/**
 * ArweaveRestoreEligibilityStatus — `codex-seed-restore-activation` T2.
 *
 * Shows whether the codex's Prime Arweave seed currently shares origin words
 * with its Prime Ouronet account, which decides whether the NEXT codex backup
 * will carry a `Codex-Backup-Recovery-Key` recovery tag
 * (`codex-recovery-backup-tagging`). The actual re-derive-and-compare check
 * (T1's `checkArweaveRestoreEligibility`, `seeds/checkRestoreEligibility.ts`)
 * never runs here: this component only drives the HOST-SUPPLIED, zero-argument
 * `checkArweaveRestoreEligibility` seam on `ArweavePanelDeps` — the host
 * already holds everything it needs (the Prime Ouronet account's bitstring,
 * the Prime Arweave seed's stored address) to answer the question itself.
 * `codex-arweave`'s UI layer never touches an Ouronet account's bitstring
 * directly, matching this project's host-app-bridges-isolated-packages
 * pattern everywhere else in this panel.
 *
 * The underlying re-derivation is the same ~6.7s RSA-4096 keygen the Seeds
 * category's own generation already pays, so this renders a real, honest
 * "checking…" state while the call is in flight rather than a silent freeze
 * — mirrors `PureKeysArea.tsx`'s own "Generating a random RSA-4096 key… this
 * can take several seconds" progress copy.
 *
 * ABSENT SEAM → RENDERS NOTHING, the same "absent optional seam → graceful
 * no-op" discipline every other optional `ArweavePanelDeps` field in this
 * package already follows (`revealAccountSecret`, `revealSeedWords`,
 * `onDeleteSeed`, …) — an unwired host simply never shows this status rather
 * than throwing or rendering a broken placeholder.
 *
 * Styled with this package's own gold-pill convention (`ACCENT = "#ceac5f"`,
 * shared with `ArweaveAccountsArea.tsx`/`PureKeysArea.tsx`/`UploadWizard.tsx`)
 * rather than a bare default-styled div.
 */

import * as React from "react";
import { useEffect, useState } from "react";

const ACCENT = "#ceac5f";

export interface ArweaveRestoreEligibilityStatusProps {
  /** Host-supplied, zero-argument eligibility check — see `ArweavePanelDeps`'s
   *  own `checkArweaveRestoreEligibility` doc comment. Absent (the default)
   *  renders nothing. */
  checkArweaveRestoreEligibility?: () => Promise<boolean>;
}

/** Plain, factual copy — no urgency/scare language, this is informational
 *  (design.md). Exported so this file's own tests and any consumer wanting
 *  to assert on the exact wording never have to restate it. */
export const ARWEAVE_RESTORE_ELIGIBLE_MESSAGE =
  "Eligible — your next backup will include a seed-word recovery point.";
export const ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE = "Not yet eligible.";
export const ARWEAVE_RESTORE_CHECKING_MESSAGE =
  "Checking restore eligibility… this can take several seconds.";
/** Shown if the host's check rejects — the derivation failing is a real
 *  technical problem, never silently reinterpreted as "not eligible" (the
 *  same discipline T1's own `checkArweaveRestoreEligibility` pure function
 *  already holds: a rejection must never read as a `false`). */
export const ARWEAVE_RESTORE_CHECK_FAILED_MESSAGE = "Could not check restore eligibility.";

type EligibilityPhase = "checking" | "eligible" | "not-eligible" | "error";

const STATUS_BOX_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCENT}40`,
  backgroundColor: `${ACCENT}1a`,
  color: "#d2d3d4",
  fontSize: 13,
};

const DOT_STYLE = (color: string): React.CSSProperties => ({
  flexShrink: 0,
  width: 8,
  height: 8,
  borderRadius: 9999,
  backgroundColor: color,
});

export function ArweaveRestoreEligibilityStatus({
  checkArweaveRestoreEligibility,
}: ArweaveRestoreEligibilityStatusProps = {}): React.ReactElement | null {
  const [phase, setPhase] = useState<EligibilityPhase | null>(null);

  useEffect(() => {
    if (checkArweaveRestoreEligibility === undefined) {
      setPhase(null);
      return;
    }
    let cancelled = false;
    setPhase("checking");
    checkArweaveRestoreEligibility()
      .then((eligible) => {
        if (cancelled) return;
        setPhase(eligible ? "eligible" : "not-eligible");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [checkArweaveRestoreEligibility]);

  if (checkArweaveRestoreEligibility === undefined || phase === null) return null;

  const { message, dotColor } =
    phase === "checking"
      ? { message: ARWEAVE_RESTORE_CHECKING_MESSAGE, dotColor: ACCENT }
      : phase === "eligible"
        ? { message: ARWEAVE_RESTORE_ELIGIBLE_MESSAGE, dotColor: "#22c55e" }
        : phase === "not-eligible"
          ? { message: ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE, dotColor: "#888" }
          : { message: ARWEAVE_RESTORE_CHECK_FAILED_MESSAGE, dotColor: "#f87171" };

  return (
    <div data-testid="arweave-restore-eligibility-status" role="status" style={STATUS_BOX_STYLE}>
      <span aria-hidden style={DOT_STYLE(dotColor)} />
      <span data-testid={`arweave-restore-eligibility-${phase}`}>{message}</span>
    </div>
  );
}

export default ArweaveRestoreEligibilityStatus;
