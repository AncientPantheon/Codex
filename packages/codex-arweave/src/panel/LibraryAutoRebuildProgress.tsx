/**
 * LibraryAutoRebuildProgress — the visible, non-blocking status pill shown
 * while the multi-address auto-rebuild-on-unlock (`arweave-auto-rebuild-on-
 * unlock`) runs: unlocking a codex with one or more configured Arweave
 * addresses auto-triggers a rebuild-from-chain across EVERY one of them (see
 * `library/rebuild.ts`'s `rebuildLibraryForAllOwners`), and a codex with many
 * uploads across many addresses can genuinely take a noticeable while to
 * fully index — this is the honest "it's working" signal for that wait.
 *
 * A pure, stateless presentation component: the host (the app-level wiring
 * that actually drives `rebuildLibraryForAllOwners`) owns the progress STATE
 * and hands it down as a single `progress` prop. `progress === null` renders
 * NOTHING — no separate "hide" prop, no leftover empty wrapper — which is
 * what makes the status disappear/go quiet the instant the rebuild
 * completes (the host simply stops updating it, settling it back to `null`).
 *
 * Deliberately NOT a modal/overlay: this is a background indexing pass, not
 * a blocking operation — it renders inline, alongside the rest of the
 * Library category content, so the rest of the panel stays fully usable
 * while it runs.
 */

import * as React from "react";

import type { MultiOwnerRebuildProgress } from "../library/rebuild.js";

/** The gold accent this package's own established visual language uses
 *  (`ArweaveAccountsArea.tsx`/`LibraryArea.tsx`'s own per-file `ACCENT`
 *  copy) — this module's own local copy, following the same per-file
 *  convention every other panel area/component in this package already
 *  uses (no shared/exported style helper exists across these components
 *  yet). */
const ACCENT = "#ceac5f";

/** A gold "pill" status — same rounded/bordered/tinted chrome
 *  `LibraryArea.tsx`'s own `secondaryButtonStyle` establishes for this
 *  package's non-bare-button surfaces, adapted here for a non-interactive
 *  status rather than a button (no cursor/hover affordance). */
const PILL_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 16px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  border: `1px solid ${ACCENT}40`,
  backgroundColor: `${ACCENT}1a`,
  color: ACCENT,
  marginBottom: 12,
};

export interface LibraryAutoRebuildProgressProps {
  /**
   * The in-flight multi-address auto-rebuild's current progress, or `null`
   * when none is running (nothing has started yet, or it already finished).
   * `null` is the ONLY signal this component reads to disappear — there is
   * no separate visibility prop.
   */
  progress: MultiOwnerRebuildProgress | null;
}

/**
 * Renders the honest "Indexing uploads… address N of M, P pages checked, R
 * found so far" status for the CURRENT progress event, or nothing at all
 * when `progress` is `null`. `ownerIndex` is 0-based internally (see
 * `MultiOwnerRebuildProgress`'s own doc comment) — shown here as a 1-based
 * "address N of M" count, the natural way to read it.
 */
export function LibraryAutoRebuildProgress({
  progress,
}: LibraryAutoRebuildProgressProps): React.ReactElement | null {
  if (progress === null) return null;

  const { ownerIndex, totalOwners, currentOwnerProgress } = progress;
  const { pagesFetched, recordsFound } = currentOwnerProgress;
  const pageWord = pagesFetched === 1 ? "page" : "pages";

  return (
    <div data-testid="library-auto-rebuild-progress" role="status" style={PILL_STYLE}>
      {`Indexing uploads… address ${ownerIndex + 1} of ${totalOwners}, ` +
        `${pagesFetched} ${pageWord} checked, ${recordsFound} found so far`}
    </div>
  );
}

export default LibraryAutoRebuildProgress;
