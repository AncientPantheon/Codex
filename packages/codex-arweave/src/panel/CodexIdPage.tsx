/**
 * CodexIdPage — the "Codex ID" page's content, extracted out of
 * `ArweavePanel.tsx`'s own `active === "codex-id"` branch so the SAME page
 * can be mounted BOTH from its original deep-link location (inside
 * `ArweavePanel`'s own category tab strip, unchanged) AND directly from a
 * top-level nav entry (`apps/codex-playground`'s desktop `.cxpg-viewtabs`
 * row / mobile `CodexTierTwoMenu`'s "Codex ID" item), without duplicating
 * any of the page's own markup/logic.
 *
 * Takes the SAME `ArweavePanelDeps | null` shape `ArweavePanel` itself
 * already reads out of `ArweavePanelContext` (via `useContext`) — no new,
 * narrower prop surface was invented. A host mounting this page directly
 * (outside `ArweavePanel`'s own provider tree) supplies the identical
 * `ArweavePanelDeps` bundle it would otherwise feed `ArweavePanelProvider`;
 * `ArweavePanel`'s own `active === "codex-id"` branch now simply forwards
 * its own `deps` straight through, unchanged in behaviour (same testids,
 * same content, same eligibility semantics).
 *
 * Owns its OWN `codexIdEligibility` lookup (lifted unmodified out of
 * `ArweavePanel`'s former in-branch `useEffect` — it used to additionally
 * gate on `active === "codex-id"`, which this component no longer needs:
 * it only ever renders while the page itself is showing, so every mount IS
 * "codex-id active").
 */

import * as React from "react";
import { useEffect, useState } from "react";

import type { ArweavePanelDeps } from "./context.js";
import { CodexBackupArea } from "./CodexBackupArea.js";
import { ArweaveRestoreEligibilityStatus } from "./ArweaveRestoreEligibilityStatus.js";
import { CodexBackupInformatics } from "./CodexBackupInformatics.js";
import { CodexMigrationInformatics } from "./CodexMigrationInformatics.js";

/** The "Codex ID" page shell — eligibility status up top, then the two
 *  action buttons, then the two static informatics explainers. */
const CODEX_ID_PAGE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
  maxWidth: 820,
};

/** The Codex ID page's two action buttons, stacked. */
const CODEX_ID_ACTIONS_WRAP_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

/** Each action's own honest "what/why" copy, directly under its disabled
 *  button — the `title` tooltip mirrors the existing Upload category
 *  convention, and this paragraph makes the same explanation visible
 *  without hovering. */
const CODEX_ID_ACTION_EXPLANATION_STYLE: React.CSSProperties = {
  margin: "6px 0 0 0",
  fontSize: 12,
  lineHeight: 1.5,
  color: "#888",
};

/** The "already eligible" confirmation note that REPLACES the disabled
 *  "Make this codex eligible" button once eligibility resolves true — a
 *  disabled no-op button would be a confusing dead affordance for a codex
 *  that needs no migration at all. Green-accented (matches
 *  `ArweaveRestoreEligibilityStatus`'s own `eligible` dot colour). */
const CODEX_ID_ALREADY_ELIGIBLE_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #22c55e40",
  backgroundColor: "#22c55e1a",
  color: "#d2d3d4",
  fontSize: 13,
};

/** "Make This Codex Eligible" has no destination yet (the `legacy-prime-
 *  migration` wizard does not exist yet), so it renders as a visibly-
 *  disabled "coming soon" affordance — mirrors `ArweavePanel.tsx`'s own
 *  `UPLOAD_ENTRY_BUTTON_DISABLED_STYLE` (duplicated here rather than
 *  imported: that constant lives in `ArweavePanel.tsx`, which imports THIS
 *  module, so importing back would be circular). */
const DISABLED_BUTTON_STYLE: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 600,
  cursor: "not-allowed",
  textAlign: "left",
  opacity: 0.4,
  border: "1px solid #444",
  backgroundColor: "transparent",
  color: "#888",
};

/** Placeholder styling for an unwired seam — visible, never blank. Mirrors
 *  `ArweavePanel.tsx`'s own `EMPTY_STYLE` (duplicated for the same
 *  circular-import reason as {@link DISABLED_BUTTON_STYLE}). */
const EMPTY_STYLE: React.CSSProperties = {
  padding: "24px",
  borderRadius: 12,
  border: "1px dashed #262626",
  color: "#666",
  fontSize: 13,
};

export interface CodexIdPageProps {
  /** The SAME injected-seam bundle `ArweavePanel` reads out of
   *  `ArweavePanelContext` — `null` when no provider is wired (the page
   *  then degrades to a visible "not available" state, never a throw,
   *  mirroring `ArweavePanel`'s own no-provider tolerance). */
  deps: ArweavePanelDeps | null;
}

type CodexIdEligibilityPhase = "unknown" | "checking" | "eligible" | "not-eligible" | "error";

export function CodexIdPage({ deps }: CodexIdPageProps): React.ReactElement {
  /**
   * Gates the "Make this codex eligible" button's PRESENCE: hidden once the
   * codex resolves truly eligible (a disabled no-op button at that point
   * would be a confusing dead affordance), shown otherwise (not-eligible,
   * still checking, errored, or no seam wired at all — "unknown" defaults
   * to showing it, since the honest default is "you may still need this",
   * never a silent hide).
   *
   * Calls the exact SAME host-injected `checkArweaveRestoreEligibility`
   * seam `ArweaveRestoreEligibilityStatus` below already calls — NOT a
   * second implementation of the underlying derivation (that still lives
   * entirely on the host side).
   */
  const [codexIdEligibility, setCodexIdEligibility] = useState<CodexIdEligibilityPhase>("unknown");
  useEffect(() => {
    if (deps?.checkArweaveRestoreEligibility === undefined) return;
    let cancelled = false;
    setCodexIdEligibility("checking");
    deps
      .checkArweaveRestoreEligibility()
      .then((eligible) => {
        if (!cancelled) setCodexIdEligibility(eligible ? "eligible" : "not-eligible");
      })
      .catch(() => {
        if (!cancelled) setCodexIdEligibility("error");
      });
    return () => {
      cancelled = true;
    };
  }, [deps?.checkArweaveRestoreEligibility]);

  return (
    <div data-testid="arweave-codex-id-page" style={CODEX_ID_PAGE_STYLE}>
      <ArweaveRestoreEligibilityStatus
        checkArweaveRestoreEligibility={deps?.checkArweaveRestoreEligibility}
      />
      <div style={CODEX_ID_ACTIONS_WRAP_STYLE}>
        {codexIdEligibility === "eligible" ? (
          <div
            data-testid="arweave-codex-id-already-eligible"
            role="status"
            style={CODEX_ID_ALREADY_ELIGIBLE_STYLE}
          >
            Already eligible — this codex does not need migration.
          </div>
        ) : (
          <div>
            <button
              type="button"
              disabled
              data-testid="arweave-codex-id-make-eligible"
              title="Make This Codex Eligible (coming soon) — opens the migration wizard, once it exists"
              style={DISABLED_BUTTON_STYLE}
            >
              Make This Codex Eligible (coming soon)
            </button>
            <p style={CODEX_ID_ACTION_EXPLANATION_STYLE}>
              Opens a guided wizard that re-aligns your codex&apos;s Arweave recovery
              words with your Ouronet identity, so seed-words-only restore becomes
              possible. Coming soon — the migration wizard (legacy-prime-migration)
              has not been built yet.
            </p>
          </div>
        )}
        <div>
          {/* The backup action is real for the default (no-PIN) path —
              `backupCodexToLibrary` (codex-backup-envelope-encryption) is
              fully built. `CodexBackupArea` is REUSED directly, unmodified
              — same `deps.getExportJson`/`deps.backupCodex`/`deps.openUrl`
              seams `ArweavePanel`'s own Library-tab mount of it already
              uses. PIN-protecting a backup still needs its own PIN-entry
              UI (not built — out of scope here; this only makes the
              plain, default-protected path real). */}
          {deps === null ? (
            <div data-testid="arweave-codex-id-backup-unavailable" style={EMPTY_STYLE}>
              Codex backup is not available until the Arweave upload seam is wired.
            </div>
          ) : (
            <CodexBackupArea
              getExportJson={deps.getExportJson}
              backupCodex={deps.backupCodex}
              openUrl={(id) => deps.openUrl(id, { pool: deps.pool })}
            />
          )}
          <p style={CODEX_ID_ACTION_EXPLANATION_STYLE}>
            Uploads your whole encrypted codex to Arweave for safekeeping, protected
            under your Master Seed and/or Codex Identity. PIN protection is not yet
            available here — this backs up with the default (no-PIN) protection only.
          </p>
        </div>
      </div>
      <CodexBackupInformatics />
      <CodexMigrationInformatics />
    </div>
  );
}

export default CodexIdPage;
