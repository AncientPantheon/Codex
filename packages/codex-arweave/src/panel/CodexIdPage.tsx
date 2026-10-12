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
 *
 * REVISED (owner correction, 2026-10-12), two changes:
 *
 * 1. The informatics explainers were a single, ever-growing page of static
 *    text — a real usability complaint even after a visual-only re-style
 *    (cards/headings fixed the STYLING, not the "too much at once"
 *    problem). Split into three TABS — "How Backup Works" / "Encryption" /
 *    "Migration" — mirroring `ArweavePanel.tsx`'s own established pill-tab
 *    pattern (`role="tablist"`, `aria-selected`) rather than inventing a
 *    new tab convention. Only the active tab's content renders at once.
 *
 * 2. The "Back up codex to Arweave" button was unconditionally enabled
 *    regardless of eligibility, even though the REAL backend
 *    (`buildRealPanelDeps`'s `backupCodex` closure, `apps/codex-playground/
 *    src/realArweaveAdapter.ts`) already unconditionally REQUIRES
 *    `eligible` as one of its hard preconditions — clicking it on an
 *    ineligible codex was always going to throw. Now gated the same way
 *    "Make This Codex Eligible" already is: a visibly-disabled button with
 *    explanatory copy until the codex resolves eligible. The action also
 *    now opens as a real popup (`CodexModalShell`, the SAME modal chrome
 *    every other write-action in this app uses — `UploadWizard.tsx`,
 *    `RotatePaymentKeyModal.tsx`, etc.) instead of rendering its confirm/
 *    progress/result states inline on the page. `CodexBackupArea`'s own
 *    internal state machine is UNCHANGED and REUSED verbatim — only how
 *    it's framed (inline vs. modal) and when it's reachable (gated) moved.
 */

import * as React from "react";
import { useEffect, useState } from "react";

import { CodexModalShell } from "@ancientpantheon/codex-ouronet/ui";

import type { ArweavePanelDeps } from "./context.js";
import { CodexBackupArea } from "./CodexBackupArea.js";
import { ArweaveRestoreEligibilityStatus } from "./ArweaveRestoreEligibilityStatus.js";
import { CodexBackupInformatics } from "./CodexBackupInformatics.js";
import { CodexEncryptionInformatics } from "./CodexEncryptionInformatics.js";
import { CodexMigrationInformatics } from "./CodexMigrationInformatics.js";
import { INFORMATICS_ACCENT } from "./informaticsStyles.js";

/** The "Codex ID" page shell — eligibility status up top, then the two
 *  action buttons, then the informatics tab group. */
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
 *  module, so importing back would be circular). The real (eligible-only)
 *  "Back up codex to Arweave" button shares this SAME disabled chrome when
 *  it is gated off, below. */
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

/** The real, enabled "Back up codex to Arweave" trigger — mirrors
 *  `CodexBackupArea.tsx`'s own `primaryButtonStyle` (solid gold fill), but
 *  sized/aligned like the disabled button above it so eligible vs.
 *  not-yet-eligible reads as the SAME control, not two different ones. */
const ENABLED_BACKUP_BUTTON_STYLE: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  textAlign: "left",
  cursor: "pointer",
  border: "none",
  backgroundColor: INFORMATICS_ACCENT,
  color: "#0a0a0a",
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

/** The informatics tab row — mirrors `ArweavePanel.tsx`'s own
 *  `desktopStrip` category-tab pattern (`role="tablist"`, pill buttons,
 *  `aria-selected`) rather than inventing a new tab convention. */
const INFORMATICS_TABLIST_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};

const INFORMATICS_TAB_HEIGHT = 36;

function informaticsTabStyle(selected: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: INFORMATICS_TAB_HEIGHT,
    padding: "0 16px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${selected ? INFORMATICS_ACCENT : "#262626"}`,
    backgroundColor: selected ? INFORMATICS_ACCENT + "1a" : "transparent",
    color: selected ? INFORMATICS_ACCENT : "#888",
  };
}

export interface CodexIdPageProps {
  /** The SAME injected-seam bundle `ArweavePanel` reads out of
   *  `ArweavePanelContext` — `null` when no provider is wired (the page
   *  then degrades to a visible "not available" state, never a throw,
   *  mirroring `ArweavePanel`'s own no-provider tolerance). */
  deps: ArweavePanelDeps | null;
}

type CodexIdEligibilityPhase = "unknown" | "checking" | "eligible" | "not-eligible" | "error";

type InformaticsTab = "backup" | "encryption" | "migration";

const INFORMATICS_TABS: ReadonlyArray<{ id: InformaticsTab; label: string }> = [
  { id: "backup", label: "How Backup Works" },
  { id: "encryption", label: "Encryption" },
  { id: "migration", label: "Migration" },
];

export function CodexIdPage({ deps }: CodexIdPageProps): React.ReactElement {
  /**
   * Gates the "Make this codex eligible" button's PRESENCE, AND (new) the
   * "Back up codex to Arweave" button's ENABLED state: hidden/disabled
   * until the codex resolves truly eligible (a disabled no-op button at
   * that point would be a confusing dead affordance), shown/enabled
   * otherwise is the WRONG default here — "unknown"/"checking"/"error"
   * must all keep backup disabled too, since the real backend throws for
   * anything short of a confirmed `eligible === true`.
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

  const isEligible = codexIdEligibility === "eligible";

  const [backupWizardOpen, setBackupWizardOpen] = useState(false);
  const [informaticsTab, setInformaticsTab] = useState<InformaticsTab>("backup");

  return (
    <div data-testid="arweave-codex-id-page" style={CODEX_ID_PAGE_STYLE}>
      <ArweaveRestoreEligibilityStatus
        checkArweaveRestoreEligibility={deps?.checkArweaveRestoreEligibility}
      />
      <div style={CODEX_ID_ACTIONS_WRAP_STYLE}>
        {isEligible ? (
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
              fully built. Opens as a real popup (`CodexModalShell`)
              wrapping `CodexBackupArea`, REUSED unmodified — same
              `deps.getExportJson`/`deps.backupCodex`/`deps.openUrl` seams
              `ArweavePanel`'s own Library-tab mount of it already uses.
              GATED on eligibility: the real backend unconditionally
              requires it, so a disabled, not-yet-eligible button here
              matches reality instead of letting a click reach a guaranteed
              thrown error. PIN-protecting a backup still needs its own
              PIN-entry UI (not built — out of scope here; this only makes
              the plain, default-protected path real). */}
          {deps === null ? (
            <div data-testid="arweave-codex-id-backup-unavailable" style={EMPTY_STYLE}>
              Codex backup is not available until the Arweave upload seam is wired.
            </div>
          ) : isEligible ? (
            <button
              type="button"
              data-testid="codex-backup-wizard-open"
              onClick={() => setBackupWizardOpen(true)}
              style={ENABLED_BACKUP_BUTTON_STYLE}
            >
              Back up codex to Arweave
            </button>
          ) : (
            <button
              type="button"
              disabled
              data-testid="codex-backup-wizard-open"
              title="Back up codex to Arweave — only available once this codex is eligible (see status above)"
              style={DISABLED_BUTTON_STYLE}
            >
              Back up codex to Arweave (not yet eligible)
            </button>
          )}
          <p style={CODEX_ID_ACTION_EXPLANATION_STYLE}>
            {isEligible
              ? "Uploads your whole encrypted codex to Arweave for safekeeping, " +
                "protected under your Master Seed and/or Codex Identity. PIN " +
                "protection is not yet available here — this backs up with the " +
                "default (no-PIN) protection only."
              : "Codex backup requires this codex to be eligible first (see the " +
                "status above) — the encryption this uses depends on your " +
                "Ouronet identity and Prime Arweave Seed sharing origin words. " +
                "It becomes available the moment your codex is eligible."}
          </p>
        </div>
      </div>

      {deps !== null && backupWizardOpen ? (
        <CodexModalShell
          title="Back Up Codex to Arweave"
          onClose={() => setBackupWizardOpen(false)}
          accent={INFORMATICS_ACCENT}
          maxWidth={560}
          dialogTestId="codex-backup-wizard-modal"
          closeTestId="codex-backup-wizard-close"
        >
          <CodexBackupArea
            getExportJson={deps.getExportJson}
            backupCodex={deps.backupCodex}
            openUrl={(id) => deps.openUrl(id, { pool: deps.pool })}
          />
        </CodexModalShell>
      ) : null}

      <div>
        <div role="tablist" aria-label="Codex ID informatics" style={INFORMATICS_TABLIST_STYLE}>
          {INFORMATICS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={informaticsTab === tab.id}
              data-testid={`codex-id-informatics-tab-${tab.id}`}
              onClick={() => setInformaticsTab(tab.id)}
              style={informaticsTabStyle(informaticsTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          {informaticsTab === "backup" ? <CodexBackupInformatics /> : null}
          {informaticsTab === "encryption" ? <CodexEncryptionInformatics /> : null}
          {informaticsTab === "migration" ? <CodexMigrationInformatics /> : null}
        </div>
      </div>
    </div>
  );
}

export default CodexIdPage;
