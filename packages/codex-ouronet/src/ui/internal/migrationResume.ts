/**
 * Resolving a RECORDED migration back into a wizard the user can continue.
 *
 * Owner: *"if stage one was already done and the wizard wasnt finalised, we
 * need to be able to resume from where we were, showing the user what he
 * chose."*
 *
 * Kept PURE — the recorded row plus the codex's current entities in, a plan
 * out — because the staleness rules below are the part that can be quietly
 * wrong, and they deserve to be testable without mounting a wizard.
 *
 * ## Demote versus warn, and why they are not the same
 *
 * A recorded id can point at something since deleted or renamed:
 *
 *  - **DEMOTE** when the recorded choice has become MEANINGLESS. An
 *    `"existing"` account that no longer exists cannot be promoted to
 *    master, so that decision returns to unchosen with a notice. Resuming
 *    onto it would carry a dangling reference into a commit.
 *  - **WARN ONLY** when the choice is still valid but less useful. A custom
 *    guard key the codex no longer holds is still a perfectly good public
 *    key to guard with — it simply cannot be LOCKED, which
 *    `secureMasterAccount` already reports as `unmatchedKeys`. Demoting it
 *    would discard a real decision over a non-problem.
 *
 * A renamed entity is NOT stale: ids are what is recorded, and a rename does
 * not change one.
 */

import type {
  MigrationProgress,
  MigrationPaymentSelection,
  MigrationGuardSelection,
} from "@ancientpantheon/codex-core";
import { isResumableSelection } from "@ancientpantheon/codex-core";
import type {
  LegacyPrimeMigrationAccountChoice,
  LegacyPrimeMigrationWizardStep,
} from "./LegacyPrimeMigrationWizard.js";

export interface MigrationResumePlan {
  /** False when there is nothing to resume, or nothing resumable. */
  resumable: boolean;
  /** Where to re-open. */
  step: LegacyPrimeMigrationWizardStep;
  accountChoice: LegacyPrimeMigrationAccountChoice | null;
  paymentChoice: MigrationPaymentSelection | null;
  guardChoice: MigrationGuardSelection | null;
  /** When the run began, for the "resumed" banner. */
  startedAt: string | null;
  /** What was demoted or flagged, in plain language. Never silent. */
  notices: string[];
}

const NOTHING: MigrationResumePlan = {
  resumable: false,
  step: "intro",
  accountChoice: null,
  paymentChoice: null,
  guardChoice: null,
  startedAt: null,
  notices: [],
};

export interface ResumeEntities {
  accounts: readonly { id: string }[];
  seeds: readonly { id: string; accounts?: readonly { publicKey: string }[] }[];
}

export function resolveMigrationResume(
  progress: MigrationProgress | undefined | null,
  entities: ResumeEntities
): MigrationResumePlan {
  if (!progress || progress.stage === "done") return NOTHING;

  const selection = progress.selection;
  if (!selection) return { ...NOTHING, startedAt: progress.startedAt };

  const notices: string[] = [];

  if (!isResumableSelection(selection)) {
    // A "new-words" run: the words were deliberately never stored, so there
    // is no substance to restore. Say so rather than resuming an empty shell.
    return {
      ...NOTHING,
      startedAt: progress.startedAt,
      notices: [
        "This run was started by typing new seed words. Those words are never "
        + "saved to your codex, so they have to be entered again.",
      ],
    };
  }

  // ── the account decision: DEMOTE when it no longer resolves ──
  let accountChoice: LegacyPrimeMigrationAccountChoice | null = null;
  if (selection.account.kind === "keep-current") {
    accountChoice = { kind: "keep-current" };
  } else if (selection.account.kind === "existing") {
    const id = selection.account.accountId;
    if (entities.accounts.some((a) => a.id === id)) {
      accountChoice = { kind: "existing", accountId: id };
    } else {
      notices.push(
        `The account this run chose is no longer in this codex, so that choice `
        + `has to be made again.`
      );
    }
  }

  // ── the guard decision: WARN ONLY for keys the codex no longer holds ──
  // "update-keyset-custom" and "use-existing-keyset" carry the SAME
  // explicit `keys` array "custom" does, and can go stale the same way
  // (docs/work/guard-step-variants/design.md). "update-keyset-recommended"
  // gets no check here, same as "recommended-single-key" already gets
  // none — it names no codex-specific key list.
  const guardChoice: MigrationGuardSelection | null = selection.guard ?? null;
  if (
    guardChoice?.kind === "custom"
    || guardChoice?.kind === "update-keyset-custom"
    || guardChoice?.kind === "use-existing-keyset"
  ) {
    const held = new Set(
      entities.seeds.flatMap((s) => (s.accounts ?? []).map((a) => a.publicKey))
    );
    const missing = guardChoice.keys.filter((k) => !held.has(k));
    if (missing.length > 0) {
      notices.push(
        `${missing.length} key(s) in your custom keyset are no longer held in `
        + `this codex. They still work as guard keys, but this codex cannot `
        + `protect them from deletion.`
      );
    }
  }

  const paymentChoice: MigrationPaymentSelection | null = selection.payment ?? null;

  // Re-open where the decisions are, so a demoted one is visible and
  // re-makeable. Returning to "intro" would hide what survived.
  //
  // "payment" rather than "guard": once `selection` exists at all, payment
  // and guard are BOTH already complete (the row is only ever recorded once
  // all three decisions are made — see `recordSelectionIfComplete` in the
  // wizard), so either page would show fully pre-filled choices. "payment"
  // is the earlier of the two — same "resume at the earliest presentable
  // step" rule the demoted-account branch above already follows.
  const step: LegacyPrimeMigrationWizardStep =
    accountChoice === null ? "account" : "payment";

  return {
    resumable: true,
    step,
    accountChoice,
    paymentChoice,
    guardChoice,
    startedAt: progress.startedAt,
    notices,
  };
}
