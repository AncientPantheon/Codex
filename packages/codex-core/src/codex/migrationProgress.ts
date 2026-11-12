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

export interface MigrationExecutionStep {
  readonly id: string;
  readonly state: "pending" | "running" | "confirmed" | "failed";
  /** Whether this is AUTHORITATIVE or merely a hint depends on the
   *  stage-3 resumability decision, which is still open. */
  readonly txHash?: string;
  readonly error?: string;
}

export interface MigrationProgress {
  readonly stage: MigrationStage;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly selection?: MigrationSelection;
  readonly committed?: MigrationCommitRecord;
  readonly execution?: { readonly steps: readonly MigrationExecutionStep[] };
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
