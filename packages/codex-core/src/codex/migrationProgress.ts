/**
 * MIGRATION PROGRESS — the codex's record of an eligibility migration that
 * has been started and not finished.
 *
 * Owner: *"if stage one was already done and the wizard wasnt finalised, we
 * need to be able to resume from where we were, showing the user what he
 * chose … which means saving choices within the codex itself before it is
 * migrated to eligible status, which means the user would have to export
 * it."* So this travels in the export, exactly like `Codex_Shape_Version`,
 * `masterKeyLocks` and `codexMasterSeed`.
 *
 * ## THE GUARANTEE: no seed words, ever
 *
 * The live wizard's account choice carries a `{ kind: "new-words"; words }`
 * variant holding RAW PLAINTEXT SEED WORDS. Persisting that verbatim would
 * write seed words in cleartext into the codex and into every export file on
 * disk — the one thing this project encrypts everything else to avoid.
 *
 * {@link MigrationAccountSelection}'s `"new-words"` variant therefore has NO
 * `words` field at all: the type makes the unsafe value unrepresentable, so
 * the guarantee is enforced by the compiler rather than by remembering.
 * {@link toPersistableAccountSelection} is the one conversion from the live
 * shape, and it drops the words.
 *
 * Consequence, accepted deliberately: a `"new-words"` run is NOT resumable —
 * resuming asks the user to retype. It costs almost nothing, because that
 * path is already unsupported by finalize, and the alternative (encrypting
 * the words as a new secret field) would add a re-key obligation on every
 * password change for a path that cannot complete anyway.
 */

/** Which stage a started migration is in. */
export type MigrationStage = "selection" | "committing" | "executing" | "done";

/**
 * The account decision, in its PERSISTABLE form.
 *
 * Note `"new-words"` carries nothing. That is the point — see the header.
 */
export type MigrationAccountSelection =
  | { readonly kind: "keep-current" }
  | { readonly kind: "existing"; readonly accountId: string }
  | { readonly kind: "new-words" };

export type MigrationPaymentSelection =
  | { readonly kind: "keep" }
  | { readonly kind: "stoic-dalos-position-0" };

/**
 * `"update-keyset-*"` and `"use-existing-keyset"` — added for the
 * variant-aware guard step (`docs/work/guard-step-variants/design.md`).
 * The account's CURRENT guard is either a keyset REFERENCE
 * (`{keysetref:{ns,ksn}}`, pointing at a keyset defined once on a
 * namespace) or a direct keyset (or none) — two situations the wizard now
 * detects and offers different options for:
 *
 *  - `"update-keyset-recommended"` / `"update-keyset-custom"`: keep the
 *    SAME reference, but intend to update what it resolves to (position 1
 *    / keys-all, or custom keys+pred respectively). Recorded so a future
 *    Stage 3 can read exactly what was asked for — NO code anywhere
 *    executes this on chain yet (confirmed during design: updating an
 *    existing namespace keyset's own definition is a capability that does
 *    not exist in this codebase at all, distinct from rotating an
 *    ACCOUNT's guard, which `RotateGuardModal`/Stage 3A already does).
 *  - `"use-existing-keyset"`: point the guard at a DIFFERENT keyset
 *    already defined on some namespace. Unlike the two above, this IS a
 *    real account-guard rotation `RotateGuardModal`'s existing "keyset-ref"
 *    mode already supports — `keys`/`pred` are resolved through
 *    `describeKeyset` at selection time, never user-typed, so a locked
 *    key list is never built from an unverified assertion.
 */
export type MigrationGuardSelection =
  | { readonly kind: "keep" }
  | { readonly kind: "recommended-single-key" }
  | { readonly kind: "custom"; readonly keys: readonly string[]; readonly pred: string }
  | { readonly kind: "update-keyset-recommended" }
  | { readonly kind: "update-keyset-custom"; readonly keys: readonly string[]; readonly pred: string }
  | {
      readonly kind: "use-existing-keyset";
      readonly ns: string;
      readonly ksn: string;
      readonly keys: readonly string[];
      readonly pred: string;
    };

/** Everything stage 1 settles. Public keys and ids only. */
export interface MigrationSelection {
  readonly account: MigrationAccountSelection;
  readonly payment?: MigrationPaymentSelection;
  readonly guard?: MigrationGuardSelection;
  readonly derivationMethod?: "stoic-dalos" | "advanced-native";
}

/**
 * What stage 2 has actually written so far, so a resumed commit skips what
 * already landed rather than redoing it. `alignmentStamped` goes LAST: a
 * codex must never read as eligible on a partial commit.
 */
export interface MigrationCommitRecord {
  readonly seedId?: string;
  readonly accountId?: string;
  readonly arweaveSeedId?: string;
  /**
   * The payment key stage 2 derived, if the user chose to derive one.
   *
   * PUBLIC keys only — nothing secret is added by recording these. They are
   * here so stage 3A can show what SHOULD be in force without decrypting
   * the seed merely to display it.
   */
  readonly paymentPublicKey?: string;
  /** The guard keys stage 2 resolved, for the same reason. */
  readonly guardPublicKeys?: readonly string[];
  readonly locksWritten?: boolean;
  readonly rowWritten?: boolean;
  readonly alignmentStamped?: boolean;
}

/**
 * One step of the stage-3 chain, as a RECORD OF WHAT HAPPENED.
 *
 * AUTHORITATIVE FOR NOTHING. `docs/work/migration-execute/design.md` §4
 * decided stage 3 resumes by RE-READING ON-CHAIN STATE: every step is a
 * predicate over chain state, not a position in a script. So this list is
 * for display and support only, and **no code may read it to decide what to
 * do next** — the engine asks the chain.
 *
 * A durable step cursor was considered and rejected there, for the reason
 * that matters: a transaction lands and the tab dies before the write, and
 * replaying from the cursor re-sends a transfer that already happened. Chain
 * state cannot lie that way.
 *
 * Written only by `recordMigrationExecutionStep` (codex-ouronet's store),
 * which merges by `id`.
 */
export interface MigrationExecutionStep {
  readonly id: string;
  readonly state: "pending" | "running" | "confirmed" | "failed";
  /**
   * A HINT, never authority — design §4 settled the question this comment
   * used to leave open. Show it, link to it, quote it in a support report;
   * never branch on its presence. "This step has a txHash" does not mean the
   * transaction landed, and its absence does not mean it did not.
   */
  readonly txHash?: string;
  readonly error?: string;
}

/**
 * What the last COMPLETED finalize decided — the "pending state", in the
 * owner's partition-manager sense: *"you can reset them as much as you want,
 * but they get written once you click apply"*.
 *
 * Written ONLY at the end of a successful finalize, and REPLACED wholesale
 * each time (a new finalize is a new plan). Deliberately separate from
 * {@link MigrationSelection}, which is written at radio-click time to power
 * resume: cancelling a wizard must never change what Apply would execute.
 *
 * SECRET-FREE by construction, same guarantee as the rest of this row —
 * public keys, ids and timestamps only, and
 * {@link containsSuspectedSecret} is the test-enforced scan over it. No
 * field here may ever carry key material.
 */
export interface MigrationPendingPlan {
  /** When the finalize that produced this plan completed. */
  readonly finalizedAt: string;
  /** The Ouronet account the migration settled on. */
  readonly accountId: string;
  readonly seedId?: string;
  readonly arweaveSeedId?: string;
  /** PUBLIC payment key the finalize derived, if any. */
  readonly paymentPublicKey?: string;
  /** PUBLIC guard keys the finalize resolved, if any. */
  readonly guardPublicKeys?: readonly string[];
  /** The guard predicate those keys are to be held under (`keys-all`, …). */
  readonly guardPred?: string;
}

export interface MigrationProgress {
  readonly stage: MigrationStage;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly selection?: MigrationSelection;
  readonly committed?: MigrationCommitRecord;
  /**
   * What the stage-3 engine DID — see {@link MigrationExecutionStep}. A
   * record for display and support, authoritative for nothing: resume
   * re-reads the chain (design §4). Produced by the store's
   * `recordMigrationExecutionStep`, consumed by renderers only.
   */
  readonly execution?: { readonly steps: readonly MigrationExecutionStep[] };
  /** What Apply would execute and seal. See {@link MigrationPendingPlan}. */
  readonly pending?: MigrationPendingPlan;
  /**
   * When Apply SEALED this migration. Its presence is the seal: once set,
   * further modification is impossible and the plan above becomes the record
   * of what was applied rather than something still to apply.
   */
  readonly appliedAt?: string;
}

/** The live wizard's account choice, which MAY carry plaintext words. */
export type LiveAccountChoice =
  | { kind: "keep-current" }
  | { kind: "existing"; accountId: string }
  | { kind: "new-words"; words: string };

/**
 * The ONE conversion from the live choice to the persistable one. Drops the
 * words. Every write path must go through this rather than assigning the
 * live object, which is what keeps the guarantee mechanical.
 */
export function toPersistableAccountSelection(
  live: LiveAccountChoice
): MigrationAccountSelection {
  switch (live.kind) {
    case "existing":
      return { kind: "existing", accountId: live.accountId };
    case "new-words":
      // The words are deliberately dropped, not encrypted — see the header.
      return { kind: "new-words" };
    default:
      return { kind: "keep-current" };
  }
}

/**
 * True when a recorded run can be resumed at all.
 *
 * `"new-words"` cannot: its words were never stored, so there is nothing to
 * resume ONTO. Callers must send the user back to re-enter them rather than
 * restoring a selection whose substance is missing.
 */
export function isResumableSelection(
  selection: MigrationSelection | undefined
): boolean {
  if (!selection) return false;
  return selection.account.kind !== "new-words";
}

/**
 * True once Apply has SEALED the migration — i.e. `appliedAt` is set.
 *
 * This is permanent by design: there is no un-seal anywhere, because a
 * sealed codex's Prime trio is locked (`primeAlignment: "aligned"`).
 */
export function isMigrationSealed(
  progress: MigrationProgress | undefined | null
): boolean {
  return Boolean(progress?.appliedAt);
}

/**
 * True when a finalized plan is waiting to be applied — a plan exists and
 * the migration is NOT yet sealed.
 *
 * A sealed row KEEPS its plan as the record of what was applied, so "has a
 * plan" alone would keep offering Apply forever; the seal is checked here so
 * every caller gets the same answer.
 */
export function hasMigrationPending(
  progress: MigrationProgress | undefined | null
): boolean {
  return Boolean(progress?.pending) && !isMigrationSealed(progress);
}

/** Deep scan for anything that looks like stored secret material. Used by
 *  the suite to prove the guarantee over a real recorded run, rather than
 *  trusting that no future field introduces one. */
export function containsSuspectedSecret(value: unknown): boolean {
  const SUSPECT = /words|mnemonic|secret|private|bitstring|seedphrase/i;
  const walk = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.some(walk);
    if (typeof v === "object") {
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        // A KEY named like a secret, carrying a value, is the thing to catch.
        if (SUSPECT.test(k) && inner !== undefined && typeof inner !== "boolean") {
          return true;
        }
        if (walk(inner)) return true;
      }
    }
    return false;
  };
  return walk(value);
}
