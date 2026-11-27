/**
 * StructuralUpgradeWizard — the Codex ID page's "Codex Upgrade" entry point
 * (docs/work/upgrade-prompt-ui/design.md, Topic 3, T4). Runs the already-
 * built Structural Migration Engine (`runStructuralMigration`,
 * `../../structural-migration/index.ts`) against the live, already-unlocked
 * codex via the store's own `runStructuralUpgrade` action — this component
 * never calls the engine directly and never prompts for a password itself
 * (that action's own `getPassword()` throws `CodexLockedError` untouched if
 * the codex is actually locked; this wizard is only ever opened on an
 * already-unlocked codex).
 *
 * Unlike `LegacyPrimeMigrationWizard` (a completely separate migration, no
 * relation), this wizard needs no external seed/account data — it reads
 * `Codex_Shape_Version` via `useCodex()` and the `runStructuralUpgrade`
 * action via `useCodexStore()`, the same seam
 * `CodexSettingsSection.tsx`'s `useCodexStore()((s) => s.actions)` already
 * uses.
 *
 * `step` is a string union, `"confirm" | "running" | "needs-input" |
 * "result"`:
 *   - "confirm": shows the current shape label + an explanation. "Start
 *     Upgrade" calls `actions.runStructuralUpgrade({ onProgress,
 *     requestMissingData })` and moves to "running". If that Promise
 *     rejects (e.g. a `CodexLockedError` edge case), the error message is
 *     shown HERE instead of advancing, so the user can retry.
 *   - "running": shows the LATEST string `onProgress` has reported, live —
 *     component state updated on every call, not just a single static
 *     "please wait" line.
 *   - "needs-input": rendered when the engine's `requestMissingData`
 *     callback fires for a seed it cannot resolve automatically. That
 *     callback is a closure that stashes the returned Promise's `resolve`
 *     in `pendingResolveRef` — NOT global store state, since this is a
 *     single in-flight request scoped entirely to this one wizard
 *     instance, unlike the store's own global `PendingPasswordRequest`
 *     (which is deliberately global because ANY write action anywhere
 *     might need a password — this upgrade flow has exactly one caller).
 *     A text input + "Submit" resolves with the typed value and returns to
 *     "running"; "Skip this seed" resolves with `undefined`, same return.
 *   - "result": once the action's Promise resolves, shows WHICH of the
 *     possible outcomes occurred (`describeStructuralUpgradeOutcome`, below),
 *     then the fixed ids and every `skipped` entry's `slice`/`id`/`reason`.
 *     "Close" calls `onClose`.
 *
 * The outcome sentence exists because of honest-failure-reporting/design.md
 * §2: the engine's "examined nothing", "every seed was already fine" and
 * "nothing had a secret to migrate" are three completely different
 * statements that this step used to collapse into the single line
 * `Fixed 0 seeds.` It now reads the engine's `examined`/`alreadyCurrent`/
 * `emptySecret`/`notEligible` counters and says which one happened — and,
 * after a partial run, says the codex is still marked as needing an upgrade
 * so the user knows the retry is real rather than wondering why the Codex ID
 * page still offers it.
 */

import * as React from "react";
import { useRef, useState } from "react";
import { formatCodexShapeVersionLabel } from "@ancientpantheon/codex-core";
import { useCodexStore } from "../../provider/index.js";
import type { CodexStoreState } from "../../state/store.js";
import { useCodex } from "../../hooks/index.js";
import type {
  StructuralMigrationNeedsInput,
  StructuralMigrationResult,
} from "../../structural-migration/index.js";
import { CodexModalShell } from "./CodexModalShell.js";

export interface StructuralUpgradeWizardProps {
  open: boolean;
  onClose: () => void;
}

type StructuralUpgradeWizardStep = "confirm" | "running" | "needs-input" | "result";

const ACCENT = "#ceac5f";

const stepParagraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: "#d2d3d4",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 8,
  border: "none",
  fontWeight: 700,
  fontSize: 13,
  backgroundColor: ACCENT,
  color: "#0a0a0a",
  cursor: "pointer",
  alignSelf: "flex-start",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 8,
  fontWeight: 700,
  fontSize: 13,
  border: "1px solid #262626",
  background: "transparent",
  color: "#d2d3d4",
  cursor: "pointer",
};

const errorBoxStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 12,
  backgroundColor: "#8b1a1a15",
  border: "1px solid #8b1a1a40",
  color: "#f87171",
};

function ConfirmStep({
  shapeLabel,
  error,
  onStart,
}: {
  shapeLabel: string;
  error: string | null;
  onStart: () => void;
}): React.ReactElement {
  return (
    <div data-testid="structural-upgrade-confirm" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={stepParagraphStyle}>
        Current codex shape: <strong>{shapeLabel}</strong>
      </p>
      <p style={stepParagraphStyle}>
        This fixes seeds whose stored secret still holds raw seed words instead of the
        pre-converted bitstring every current derivation call expects. Nothing is dropped —
        anything the engine can&apos;t resolve automatically is left exactly as-is and you&apos;ll
        be asked for its words instead.
      </p>
      {error ? (
        <p role="alert" data-testid="structural-upgrade-error" style={errorBoxStyle}>
          {error}
        </p>
      ) : null}
      <button type="button" data-testid="structural-upgrade-start" style={primaryButtonStyle} onClick={onStart}>
        Start Upgrade
      </button>
    </div>
  );
}

function RunningStep({ progress }: { progress: string | null }): React.ReactElement {
  return (
    <div data-testid="structural-upgrade-running" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p data-testid="structural-upgrade-progress-text" style={stepParagraphStyle}>
        {progress ?? "Starting upgrade…"}
      </p>
    </div>
  );
}

function NeedsInputStep({
  need,
  inputValue,
  onInputChange,
  onSubmit,
  onSkip,
}: {
  need: StructuralMigrationNeedsInput;
  inputValue: string;
  onInputChange: (next: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}): React.ReactElement {
  return (
    <div data-testid="structural-upgrade-needs-input" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={stepParagraphStyle}>
        Seed <strong>{need.id}</strong> ({need.slice}) could not be resolved automatically:{" "}
        {need.reason}
      </p>
      <input
        type="text"
        data-testid="structural-upgrade-needs-input-field"
        placeholder="Type this seed's words, separated by spaces…"
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          height: 40,
          padding: "0 12px",
          borderRadius: 8,
          backgroundColor: "#111",
          border: "1px solid #262626",
          color: "#d2d3d4",
          fontFamily: "var(--codex-font-mono, ui-monospace, monospace)",
          fontSize: 13,
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" data-testid="structural-upgrade-submit-input" style={primaryButtonStyle} onClick={onSubmit}>
          Submit
        </button>
        <button type="button" data-testid="structural-upgrade-skip" style={secondaryButtonStyle} onClick={onSkip}>
          Skip this seed
        </button>
      </div>
    </div>
  );
}

/** Which of the engine's mutually-exclusive outcomes a finished run
 *  represents. Named after the four the design's acceptance criterion 4
 *  requires the UI to distinguish, plus the ordinary success. */
export type StructuralUpgradeOutcomeKind =
  | "examined-none"
  | "not-eligible"
  | "already-current"
  | "fixed"
  | "skipped";

export interface StructuralUpgradeOutcome {
  kind: StructuralUpgradeOutcomeKind;
  /** The one sentence that says what happened. */
  headline: string;
  /** A second sentence for entries the engine never examined, or `null`. */
  note: string | null;
  /** True when the codex is NOT structurally current afterwards — i.e. the
   *  engine declined to stamp `Codex_Shape_Version`, so
   *  `useNeedsStructuralUpgrade` still returns true and the Codex ID page
   *  still offers "Upgrade Codex Now". */
  stillNeedsUpgrade: boolean;
}

/** `n` with a correctly-pluralised "seed". */
function seeds(n: number): string {
  return `${n} seed${n === 1 ? "" : "s"}`;
}

/**
 * Pure: a finished `StructuralMigrationResult` -> the text the result step
 * renders. Exported (and unit-tested) separately from the component because
 * the whole outcome matrix is a statement about the engine's counters, not
 * about React.
 */
export function describeStructuralUpgradeOutcome(
  result: StructuralMigrationResult,
): StructuralUpgradeOutcome {
  const fixed = result.fixedSeedIds.length;
  const skipped = result.skipped.length;
  const { examined, alreadyCurrent, emptySecret, notEligible } = result;
  const note =
    notEligible > 0
      ? `${notEligible} other seed${notEligible === 1 ? " in this codex is" : "s in this codex are"} of a ` +
        `type this upgrade never touches; ${notEligible === 1 ? "it was" : "they were"} not examined.`
      : null;

  if (skipped > 0) {
    return {
      kind: "skipped",
      headline:
        `Fixed ${fixed} of the ${seeds(examined)} examined. ${seeds(skipped)} could not be upgraded ` +
        `and ${skipped === 1 ? "was" : "were"} left exactly as ${skipped === 1 ? "it" : "they"} ` +
        `${skipped === 1 ? "was" : "were"} — nothing was dropped or overwritten. This codex is ` +
        `still marked as needing an upgrade, so you can run this again.`,
      note,
      stillNeedsUpgrade: true,
    };
  }

  if (fixed > 0) {
    return {
      kind: "fixed",
      headline:
        `Fixed ${fixed} of the ${seeds(examined)} examined. Nothing was skipped, so this codex is ` +
        `now marked structurally current.`,
      note,
      stillNeedsUpgrade: false,
    };
  }

  if (examined > 0) {
    // Nothing fixed, nothing skipped: every examined entry was already fine.
    // WHICH kind of fine is the part that used to be invisible.
    // Reported as a breakdown in every case, including the single-bucket
    // ones: "already the current shape" and "no stored secret at all" are
    // two of the three silent `continue`s design.md §2 names, and the user
    // is entitled to know which one their codex hit.
    const parts: string[] = [];
    if (alreadyCurrent > 0) parts.push(`${alreadyCurrent} already in the current shape`);
    if (emptySecret > 0) parts.push(`${emptySecret} with no stored secret to migrate`);
    const detail = parts.length > 0 ? parts.join(", ") : `${seeds(examined)} needing no change`;
    return {
      kind: "already-current",
      headline: `Examined ${seeds(examined)}: ${detail}. Nothing needed fixing, and nothing was changed.`,
      note,
      stillNeedsUpgrade: false,
    };
  }

  if (notEligible > 0) {
    return {
      kind: "not-eligible",
      headline:
        `Examined no seeds: all ${seeds(notEligible)} in this codex are of a type this upgrade never ` +
        `touches. Nothing was changed.`,
      note: null,
      stillNeedsUpgrade: false,
    };
  }

  return {
    kind: "examined-none",
    headline: "This codex has no seeds this upgrade applies to. Nothing was examined, and nothing was changed.",
    note: null,
    stillNeedsUpgrade: false,
  };
}

function ResultStep({
  result,
  onClose,
}: {
  result: StructuralMigrationResult;
  onClose: () => void;
}): React.ReactElement {
  const outcome = describeStructuralUpgradeOutcome(result);
  return (
    <div data-testid="structural-upgrade-result" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p data-testid="structural-upgrade-outcome" style={stepParagraphStyle}>
        {outcome.headline}
      </p>
      {outcome.note ? (
        <p data-testid="structural-upgrade-outcome-note" style={stepParagraphStyle}>
          {outcome.note}
        </p>
      ) : null}
      {result.fixedSeedIds.length > 0 ? (
        <ul data-testid="structural-upgrade-fixed-list" style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#d2d3d4" }}>
          {result.fixedSeedIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      ) : null}
      {result.skipped.length > 0 ? (
        <ul data-testid="structural-upgrade-skipped-list" style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#f87171" }}>
          {result.skipped.map((s) => (
            <li key={`${s.slice}-${s.id}`}>
              {s.slice} / {s.id}: {s.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" data-testid="structural-upgrade-close" style={primaryButtonStyle} onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export function StructuralUpgradeWizard({ open, onClose }: StructuralUpgradeWizardProps): React.ReactElement | null {
  const actions = useCodexStore()((s: CodexStoreState) => s.actions);
  const { Codex_Shape_Version } = useCodex();

  const [step, setStep] = useState<StructuralUpgradeWizardStep>("confirm");
  const [progress, setProgress] = useState<string | null>(null);
  const [need, setNeed] = useState<StructuralMigrationNeedsInput | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState<StructuralMigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Scoped entirely to this one wizard instance — see the module doc for
  // why this is a ref, not global store state, unlike the store's own
  // PendingPasswordRequest.
  const pendingResolveRef = useRef<((value: string | undefined) => void) | null>(null);

  if (!open) return null;

  function requestMissingData(nextNeed: StructuralMigrationNeedsInput): Promise<string | undefined> {
    setNeed(nextNeed);
    setInputValue("");
    setStep("needs-input");
    return new Promise<string | undefined>((resolve) => {
      pendingResolveRef.current = resolve;
    });
  }

  function handleStart(): void {
    setError(null);
    setProgress(null);
    setStep("running");
    actions
      .runStructuralUpgrade({
        // Annotated explicitly rather than relying on contextual inference:
        // the dev tsconfig aliases codex-ui/codex-core to their SOURCES, where
        // inference succeeds, but the BUILD resolves them from `dist`, where it
        // does not — so an un-annotated param compiles under `tsc --noEmit` and
        // then fails `npm run build` with an implicit-any. Annotating makes the
        // file correct under both resolutions.
        onProgress: (nextStep: string) => setProgress(nextStep),
        requestMissingData,
      })
      .then((nextResult: StructuralMigrationResult) => {
        setResult(nextResult);
        setStep("result");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStep("confirm");
      });
  }

  function settleNeed(value: string | undefined): void {
    pendingResolveRef.current?.(value);
    pendingResolveRef.current = null;
    setNeed(null);
    setInputValue("");
    setStep("running");
  }

  return (
    <CodexModalShell
      title="Codex Upgrade"
      onClose={onClose}
      accent={ACCENT}
      maxWidth={520}
      dialogTestId="structural-upgrade-wizard-modal"
      closeTestId="structural-upgrade-wizard-close"
    >
      {step === "confirm" ? (
        <ConfirmStep
          shapeLabel={formatCodexShapeVersionLabel(Codex_Shape_Version)}
          error={error}
          onStart={handleStart}
        />
      ) : null}
      {step === "running" ? <RunningStep progress={progress} /> : null}
      {step === "needs-input" && need ? (
        <NeedsInputStep
          need={need}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSubmit={() => settleNeed(inputValue)}
          onSkip={() => settleNeed(undefined)}
        />
      ) : null}
      {step === "result" && result ? <ResultStep result={result} onClose={onClose} /> : null}
    </CodexModalShell>
  );
}

export default StructuralUpgradeWizard;
