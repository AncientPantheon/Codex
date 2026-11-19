/**
 * Typed error classes thrown by codex operations.
 *
 * All extend the base CodexError so consumers can do a catch-all
 * `if (e instanceof CodexError) ...` to distinguish package-thrown errors
 * from arbitrary runtime errors. Each subclass carries structured fields
 * relevant to its specific failure mode so consumers can render specific
 * UX (e.g. "X pure keypairs, Y derived accounts" in CodexKeyMissingError)
 * without parsing strings.
 */

import type { MasterKeyLockReason } from "@ancientpantheon/codex-core";
import {
  CODEX_MASTER_SEED,
  MASTER_ARWEAVE_SEED,
  MASTER_CHAINWEB_SEED,
  OURONET_CODEX_MASTER,
} from "@ancientpantheon/codex-core";
import type { RekeySkip } from "../rekey/index.js";

/** Base class for all codex-related errors. */
export class CodexError extends Error {
  public override readonly name: string = "CodexError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Maintain prototype chain across transpilation targets (Babel/SWC).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when an operation needs the codex unlocked but the password
 *  cache is empty / expired and the user hasn't re-authenticated. */
export class CodexLockedError extends CodexError {
  public override readonly name = "CodexLockedError";

  constructor(operation: string) {
    super(
      `Codex is locked; operation "${operation}" requires authentication. ` +
        `Call authenticate(password) first.`
    );
  }
}

/** Thrown when `getKeypair(publicKey)` cannot find a matching signing key
 *  in either the pure-keypairs store or any derived kadena account.
 *
 *  Structured fields make this the self-diagnosing error message that
 *  OuronetUI v1.0.9 added — the same wording is generated server-side
 *  here so every consumer gets the same UX. */
export class CodexKeyMissingError extends CodexError {
  public override readonly name = "CodexKeyMissingError";
  public readonly publicKey: string;
  public readonly pureKeypairCount: number;
  public readonly derivedAccountCount: number;

  constructor(
    publicKey: string,
    pureKeypairCount: number,
    derivedAccountCount: number
  ) {
    const shortKey = `${publicKey.slice(0, 8)}…${publicKey.slice(-4)}`;
    super(
      `Signing key ${shortKey} not found in this device's codex ` +
        `(${pureKeypairCount} pure keypair${pureKeypairCount === 1 ? "" : "s"}, ` +
        `${derivedAccountCount} derived account${derivedAccountCount === 1 ? "" : "s"}). ` +
        `If you imported a codex backup, pure keypairs are device-local and ` +
        `do not travel inside the v1.2 codex file — re-import via Google Drive ` +
        `cloud-backup, or re-add the pure keypair on this device.`
    );
    this.publicKey = publicKey;
    this.pureKeypairCount = pureKeypairCount;
    this.derivedAccountCount = derivedAccountCount;
  }
}

/** Thrown when a user attempts to delete the CodexPrime ouro account
 *  (spec §B2). CodexPrime is created automatically on every fresh codex
 *  and is permanent. */
export class CodexPrimeProtectedError extends CodexError {
  public override readonly name = "CodexPrimeProtectedError";
  public readonly ouroAccountId: string;

  constructor(ouroAccountId: string) {
    super(
      `Ouro account ${ouroAccountId} is the ${OURONET_CODEX_MASTER} account and cannot ` +
        `be deleted. Add another account first if you want it as primary.`
    );
    this.ouroAccountId = ouroAccountId;
  }
}

/** Thrown when a user attempts to delete an Ouronet account that has ever
 *  encrypted a confirmed Arweave upload (docs/work/arweave-non-removable-
 *  account/design.md). Deleting such an account would orphan permanent
 *  on-chain ciphertext forever — this is the LOCAL, synchronous,
 *  offline half of the invariant (`deleteOuroAccount` checks the
 *  account's own `hasEncryptedArweaveUpload` flag); the chain-query
 *  fallback for when that flag is absent lives separately in
 *  `codex-arweave`'s `checkAccountEncryptedArweaveUploads`. */
export class CodexArweaveEncryptionProtectedError extends CodexError {
  public override readonly name = "CodexArweaveEncryptionProtectedError";
  public readonly ouroAccountId: string;

  constructor(ouroAccountId: string) {
    super(
      `Ouro account ${ouroAccountId} has encrypted a confirmed Arweave ` +
        `upload and cannot be deleted. Deleting it would orphan permanent ` +
        `on-chain ciphertext forever.`
    );
    this.ouroAccountId = ouroAccountId;
  }
}

/** Thrown when a user attempts to delete the Prime Codex Seed — the
 *  IStoaChainSeed that kickstarted the codex (spec §B1, v0.2.0+). The
 *  prime seed is structurally tied to the codex's identity; removing it
 *  is equivalent to deleting the codex itself, which is a separate flow
 *  (codex-reset, not seed-delete). See docs/v0.2.0-design.md §5.1. */
export class CodexPrimeSeedProtectedError extends CodexError {
  public override readonly name = "CodexPrimeSeedProtectedError";
  public readonly seedId: string;

  constructor(seedId: string) {
    super(
      `StoaChain seed ${seedId} is the ${MASTER_CHAINWEB_SEED} and cannot be ` +
        `deleted. Removing the prime seed is equivalent to deleting the ` +
        `codex itself — use the codex-reset flow instead.`
    );
    this.seedId = seedId;
  }
}

/**
 * Thrown when something tries to remove a derived key POSITION, or delete a
 * seed, that the Codex Ouronet Master is actually relying on — its payment
 * key, or a key inside its guard.
 *
 * Distinct from {@link CodexPrimeSeedProtectedError}, which protects ONE
 * seed by identity. This protects an arbitrary set of `(seedId, position)`
 * pairs across any number of seeds, because a custom guard keyset may draw
 * keys from several seeds at once.
 *
 * `position` is `null` for a whole-seed refusal: deleting a seed is blocked
 * by the same invariant, but no single position is the offender — the seed
 * is simply held by at least one lock.
 *
 * The `reason` is deliberately part of the message. A refusal that did not
 * say WHY would be indistinguishable from a bug; the reason is what tells
 * the user the lock is a consequence of their own Master Account setup, and
 * that re-running Secure Master Account is how it gets released.
 */
export class CodexMasterKeyLockedError extends CodexError {
  public override readonly name = "CodexMasterKeyLockedError";
  public readonly seedId: string;
  /** The offending key index, or `null` when a whole seed was refused. */
  public readonly position: number | null;
  public readonly reason: MasterKeyLockReason;

  constructor(seedId: string, position: number | null, reason: MasterKeyLockReason) {
    super(
      position === null
        ? `StoaChain seed ${seedId} holds at least one key your ` +
            `${OURONET_CODEX_MASTER} depends on (${reason}) and cannot be deleted. ` +
            `Release it by re-running Secure Master Account once the key ` +
            `is genuinely no longer in use.`
        : `Key #${position} of StoaChain seed ${seedId} is in use as ` +
            `${reason} by your ${OURONET_CODEX_MASTER} and cannot be removed. ` +
            `Release it by re-running Secure Master Account once the key ` +
            `is genuinely no longer in use.`
    );
    this.seedId = seedId;
    this.position = position;
    this.reason = reason;
  }
}

/**
 * Thrown when something tries to delete the Master ArWeave Seed — the seed
 * the codex's ArWeave face is built from (locked-entities-and-former-prime
 * design.md §B3, owner decision 3).
 *
 * Until this existed, `deleteArweaveSeed` was an unguarded filter and the
 * master ArWeave seed was deletable at every layer. Deleting it left
 * `codexMasterSeed.arweaveSeedId` pointing at nothing while
 * `describeCodexMasterSeed` still reported that face established — a codex
 * claiming an identity it no longer held.
 *
 * Which seeds qualify is NOT decided here: `arweaveSeedLock` is the single
 * rule (the settled `codexMasterSeed.arweaveSeedId`, or the seed's own
 * `isPrime`), shared verbatim with the medallion that hides the delete
 * control. This class only carries the refusal.
 *
 * The message NAMES the reason, for the same cause
 * {@link CodexMasterKeyLockedError} gives: a refusal that did not say WHY
 * would be indistinguishable from a bug.
 */
export class CodexMasterArweaveSeedProtectedError extends CodexError {
  public override readonly name = "CodexMasterArweaveSeedProtectedError";
  public readonly seedId: string;

  constructor(seedId: string) {
    super(
      `ArWeave seed ${seedId} is your ${MASTER_ARWEAVE_SEED} and cannot be ` +
        `deleted. Deleting it would leave your ${CODEX_MASTER_SEED}'s ArWeave ` +
        `face pointing at nothing.`
    );
    this.seedId = seedId;
  }
}

/** Thrown by `kickstartCodex` and `recoverCodexFromMnemonic` when the
 *  pre-flight invariants fail (v0.2.0+). The `reason` field discriminates:
 *
 *   - `already-kickstarted`: kickstartCodex called on a codex that
 *     already has a prime seed. Caller should use addStoaChainSeed for
 *     additional seeds, or reset the codex first.
 *   - `smart-account-not-allowed`: caller passed an ouro with
 *     `isSmart: true` as the CodexPrime. CodexPrime must be a Standard
 *     Ouronet Account (Ѻ. prefix), never a Smart account (Σ. prefix).
 *   - `id-conflict`: caller tried to install a prime entity whose id
 *     doesn't match the existing prime, or tried to add a seed/ouro with
 *     `isPrime: true` set when a prime already exists.
 *   - `invalid-args`: the v0.3 `kickstartCodex` KickstartArgs failed shape or
 *     cross-field validation (bad discriminated-union value, missing required
 *     field, out-of-range word count, splitIndex on a non-words mode, or a
 *     mixed v0.2/v0.3 args object). `detail` names the offending field.
 *
 *  See docs/v0.2.0-design.md §5.4. */
export class CodexKickstartError extends CodexError {
  public override readonly name = "CodexKickstartError";
  public readonly reason:
    | "already-kickstarted"
    | "smart-account-not-allowed"
    | "id-conflict"
    // "invalid-args" added in Phase 7 for kickstartCodex v0.3 validation —
    // additive extension of the existing class (no new class, count unchanged).
    | "invalid-args";

  constructor(
    reason: CodexKickstartError["reason"],
    detail?: string
  ) {
    const messages: Record<CodexKickstartError["reason"], string> = {
      "already-kickstarted":
        `Codex has already been kickstarted (a ${MASTER_CHAINWEB_SEED} exists). ` +
        "Use addStoaChainSeed() to add additional seeds, or reset the codex first.",
      "smart-account-not-allowed":
        `${OURONET_CODEX_MASTER} must be a Standard Ouronet Account (isSmart: false). ` +
        `Smart accounts (Σ. prefix) cannot be the ${OURONET_CODEX_MASTER}.`,
      "id-conflict":
        "Cannot install a second prime entity. Exactly one prime kadena seed " +
        "and one prime ouro account are allowed per codex.",
      "invalid-args":
        "Invalid KickstartArgs shape. Verify the discriminated unions for " +
        "codexPrimeSeed.source and duoPrime.mode are well-formed.",
    };
    super(detail ? `${messages[reason]} ${detail}` : messages[reason]);
    this.reason = reason;
  }
}

/** Thrown when the storage backend (localStorage, IndexedDB, file system, ...)
 *  fails — quota exceeded, disk full, permission denied, etc. Wraps the
 *  original underlying error in `.cause`. */
export class CodexAdapterError extends CodexError {
  public override readonly name = "CodexAdapterError";
  public readonly operation: string;
  public readonly adapter: string;

  constructor(adapter: string, operation: string, cause: unknown) {
    super(
      `Codex adapter "${adapter}" failed during "${operation}": ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
    this.adapter = adapter;
    this.operation = operation;
  }
}

/** Thrown when codex import fails — JSON parse failure, decryption failure
 *  with the provided password, malformed entity shapes, etc. */
export class CodexImportError extends CodexError {
  public override readonly name = "CodexImportError";
  public readonly stage: "parse" | "decrypt" | "shape" | "migrate";

  constructor(
    stage: "parse" | "decrypt" | "shape" | "migrate",
    detail: string,
    cause?: unknown
  ) {
    super(`Codex import failed at "${stage}" stage: ${detail}`, { cause });
    this.stage = stage;
  }
}

/** Thrown when `authenticate(password)` is called with a password that
 *  doesn't decrypt the codex's encrypted secrets. */
export class CodexPasswordError extends CodexError {
  public override readonly name = "CodexPasswordError";

  constructor() {
    super(
      `Incorrect password. The provided password did not decrypt any of ` +
        `the codex's stored secrets. Check the password and try again.`
    );
  }
}

// ---------------------------------------------------------------------------
// v0.3.0 errors — appended in phase order after the v0.2 errors above.
// ---------------------------------------------------------------------------

/** Thrown by the schema-migration runner (`applyMigrations`) and the store's
 *  `init()` / `migrateToCurrent()` wiring (v0.3.0+). The `reason` field
 *  discriminates:
 *
 *   - `unknown-schema-version`: the loaded codex's schemaVersion is NEWER than
 *     this package's CURRENT_SCHEMA_VERSION, so this consumer is too old to
 *     safely read/write it. `detail` carries "loaded={N}, max={CURRENT}".
 *   - `migration-failed`: a migration's `migrate(...)` threw. The original
 *     error is forwarded in `.cause`; `detail` carries the migration's
 *     description.
 *   - `post-condition-failed`: a migration ran but its output snapshot's
 *     schemaVersion did not equal the migration's declared `toVersion`, OR
 *     the supplied migration registry is malformed (reversed/duplicate
 *     fromVersion). `detail` describes the violated invariant. */
export class CodexMigrationError extends CodexError {
  public override readonly name = "CodexMigrationError";
  public readonly reason:
    | "unknown-schema-version"
    | "migration-failed"
    | "post-condition-failed";

  constructor(
    reason: CodexMigrationError["reason"],
    detail?: string,
    cause?: unknown
  ) {
    const messages: Record<CodexMigrationError["reason"], string> = {
      "unknown-schema-version":
        "Loaded codex schema version is newer than this package can read. " +
        "Upgrade the consumer to a version that understands the newer schema.",
      "migration-failed":
        "A schema migration failed while upgrading the codex to the current " +
        "version.",
      "post-condition-failed":
        "A schema migration produced an invalid result, or the migration " +
        "registry is malformed.",
    };
    super(detail ? `${messages[reason]} ${detail}` : messages[reason], {
      cause,
    });
    this.reason = reason;
  }
}

/** Thrown by the structural-migration engine (`runStructuralMigration`,
 *  `structural-migration-engine` topic) — the async, password-aware,
 *  skip-not-drop sibling of the pure `CodexMigrationError` schema-version
 *  runner above. The `reason` field discriminates:
 *
 *   - `post-condition-failed`: the engine completed its walk but the
 *     resulting snapshot's `Codex_Shape_Version` did not equal the
 *     declared `STRUCTURAL_SHAPE_TARGET_VERSION`. This should be
 *     unreachable by construction — the check exists so a future refactor
 *     that breaks the stamp fails loudly, matching `CodexMigrationError`'s
 *     own `post-condition-failed` enforcement discipline. */
export class CodexStructuralMigrationError extends CodexError {
  public override readonly name = "CodexStructuralMigrationError";
  public readonly reason: "post-condition-failed";

  constructor(
    reason: CodexStructuralMigrationError["reason"],
    detail?: string,
    cause?: unknown
  ) {
    const messages: Record<CodexStructuralMigrationError["reason"], string> = {
      "post-condition-failed":
        "The structural migration engine produced an invalid result: its " +
        "output snapshot's Codex_Shape_Version did not reach the declared " +
        "target version.",
    };
    super(detail ? `${messages[reason]} ${detail}` : messages[reason], {
      cause,
    });
    this.reason = reason;
  }
}

/** Thrown by the consumer-settings registry actions (`updateConsumerSettings`)
 *  on the store (v0.3.0+). The `reason` field discriminates:
 *
 *   - `invalid-consumer-name`: the supplied `consumerName` failed the tight
 *     ASCII identifier validation (must start with a letter; ASCII
 *     alphanumeric + `_`/`-`; 1-64 chars). Rejects empty/whitespace,
 *     control/zero-width chars, path-injection (`/`, `\`, `..`), and
 *     length-DoS names. `detail` carries the rejected name.
 *   - `schema-downgrade`: a write was attempted whose `schemaVersion` is
 *     STRICTLY LESS than the stored entry's. Rejected ONLY when attempted <
 *     existing; EQUAL is allowed (same consumer version re-saving updated
 *     settings is the common case). `detail` carries "existing={N},
 *     attempted={M}".
 *   - `missing-entry`: reserved for a future caller that wants to assert an
 *     entry exists. `getConsumerSettings` itself does NOT throw this — it
 *     returns `null` for an unknown consumer per the REQ-02 contract. */
export class CodexConsumerSettingsError extends CodexError {
  public override readonly name = "CodexConsumerSettingsError";
  public readonly reason:
    | "invalid-consumer-name"
    | "schema-downgrade"
    | "missing-entry";

  constructor(
    reason: CodexConsumerSettingsError["reason"],
    detail?: string,
    cause?: unknown
  ) {
    const messages: Record<CodexConsumerSettingsError["reason"], string> = {
      "invalid-consumer-name":
        "Consumer name is invalid. It must start with a letter and contain " +
        "only ASCII letters, digits, '_' or '-' (1-64 characters).",
      "schema-downgrade":
        "Refusing to overwrite consumer settings with an older schema " +
        "version. The attempted write's schemaVersion is lower than the " +
        "stored entry's (equal versions are allowed).",
      "missing-entry":
        "No consumer settings entry exists for the requested consumer name.",
    };
    super(detail ? `${messages[reason]} ${detail}` : messages[reason], {
      cause,
    });
    this.reason = reason;
  }
}

/**
 * Errors related to the ICodexIdentity lifecycle (v0.3.0+).
 *
 * Consumer-phase map:
 * - `already-exists`: thrown by Phase 7 `kickstartCodex` when codex already has an identity
 * - `seed-invalid`, `seed-word-count`, `split-invalid`: thrown by Phase 4 `deriveDoubleApollo`
 * - `immutable-field`: thrown by Phase 7+ atomic setter guards (no public setter in Phase 3)
 * - `missing-codex-identity`: thrown by Phase 9 `buildRegisterCodexIdentityTx` when codex lacks identity
 */
export class CodexIdentityError extends CodexError {
  public override readonly name = "CodexIdentityError";
  public readonly reason:
    | "already-exists"
    | "seed-invalid"
    | "seed-word-count"
    | "split-invalid"
    | "immutable-field"
    | "missing-codex-identity";

  constructor(
    reason: CodexIdentityError["reason"],
    detail?: string,
    cause?: unknown
  ) {
    const messages: Record<CodexIdentityError["reason"], string> = {
      "already-exists":
        "Codex already has an ICodexIdentity. Identity is immutable " +
        "post-creation; use a fresh codex if a new identity is required.",
      "seed-invalid":
        "Seed material does not conform to the Dalos-charset constraints " +
        "(1-512 words, 1-256 glyphs per word).",
      "seed-word-count":
        "Seed word count is out of range. Allowed: 1..512.",
      "split-invalid":
        "splitIndex must satisfy 0 <= splitIndex <= totalWordCount.",
      "immutable-field":
        "ICodexIdentity fields are immutable post-creation. The on-chain " +
        "registration depends on this; create a fresh codex for a new identity.",
      "missing-codex-identity":
        "Operation requires the codex to have an ICodexIdentity, but none is " +
        "present. v0.2 codices must run the interactive Phase 8 migration to " +
        "create one.",
    };
    super(detail ? `${messages[reason]} ${detail}` : messages[reason], {
      cause,
    });
    this.reason = reason;
  }
}

/**
 * Errors related to the CodexGuard lifecycle and DuoPurePrime protections.
 *
 * Consumer-phase map:
 * - `already-exists`: thrown by Phase 7 `kickstartCodex` and Phase 8 `generateCodexGuardForLegacy` when codex already has an active CodexGuard
 * - `missing-codex-guard`: thrown by Phase 7+ flows requiring an active CodexGuard when none is present (Phase 5's getters return null instead — this reason is for assertion contexts)
 * - `rename-rejected`: thrown by Phase 6 rename guards when target pure key has `isCodexGuard`, `wasCodexGuard`, or `isDuoPurePrime` set
 * - `delete-rejected`: thrown by Phase 6 `deletePureKeypair` guards when target has `isCodexGuard`, `wasCodexGuard`, or `isDuoPurePrime` set
 * - `rotation-invalid`: thrown by Phase 8 `rotateCodexGuard` when the rotation target is invalid (e.g., already `isCodexGuard: true`, or doesn't exist)
 * - `integrity-violated`: thrown by Phase 5's read getters when more than one ACTIVE CodexGuard is detected — a corrupted codex that breaks the exactly-one invariant (loud failure beats silent first-match-wins)
 */
export class CodexGuardError extends CodexError {
  public override readonly name = "CodexGuardError";
  public readonly reason:
    | "already-exists"
    | "missing-codex-guard"
    | "rename-rejected"
    | "delete-rejected"
    | "rotation-invalid"
    | "integrity-violated";

  constructor(
    reason: CodexGuardError["reason"],
    detail?: string,
    cause?: unknown
  ) {
    const messages: Record<CodexGuardError["reason"], string> = {
      "already-exists":
        "Codex already has an active CodexGuard. Use rotateCodexGuard() to " +
        "replace it, or reset the codex first.",
      "missing-codex-guard":
        "Operation requires the codex to have an active CodexGuard, but none " +
        "is present. v0.2 codices must run the interactive Phase 8 " +
        "generateCodexGuardForLegacy() flow to create one.",
      "rename-rejected":
        "Pure keypair with CodexGuard or DuoPurePrime markers cannot be " +
        "renamed. The label is locked by codex policy.",
      "delete-rejected":
        "Pure keypair with CodexGuard, wasCodexGuard, or DuoPurePrime markers " +
        "cannot be deleted. These keys are structurally tied to the codex's " +
        "identity.",
      "rotation-invalid":
        "CodexGuard rotation target is invalid. The target pure keypair must " +
        "exist in the codex and must not already be the active CodexGuard.",
      "integrity-violated":
        "Codex integrity violated — multiple active CodexGuards detected; " +
        "rotate or hand-edit codex to restore the exactly-one invariant.",
    };
    super(detail ? `${messages[reason]} ${detail}` : messages[reason], {
      cause,
    });
    this.reason = reason;
  }
}

/**
 * Thrown when `changeCodexPassword` finishes with one or more secrets left
 * un-re-keyed (`rekeyCodex`'s skip-not-drop result, `RekeySkip[]`).
 *
 * `rekeyCodex` itself already does the safe thing — it never drops a secret
 * it can't decrypt under the old password, it just keeps the ORIGINAL
 * ciphertext and reports the skip. But a skip left silently unreported is
 * its own hazard: the password cache moves to the new password for
 * everything else, so the next time that one secret is needed for signing
 * (e.g. a stoic seed's `secret`, read by `resolveStoicKeypair` for Rotate
 * Payment Key / Rotate Guard), decrypting it with the now-current password
 * genuinely fails — a real AES-GCM auth-tag mismatch, confirmed live
 * (`docs/work/debug/two-real-codex-bugs.md`, bug 1) on a codex that had been
 * through exactly this silent-skip path before. The user sees a cryptic
 * crypto failure on an already-unlocked, already-correctly-authenticated
 * codex, with no link back to the password change that caused it.
 *
 * Throwing here — instead of discarding `skipped` — surfaces the problem at
 * the ONE moment it can still be fixed cheaply: right after the change,
 * while the user still remembers (or can re-derive) the field's actual
 * password, rather than months later as an unexplained signing failure.
 */
export class CodexPasswordChangeIncompleteError extends CodexError {
  public override readonly name = "CodexPasswordChangeIncompleteError";
  public readonly skipped: readonly RekeySkip[];

  constructor(skipped: readonly RekeySkip[]) {
    const fields = skipped
      .map((s) => (s.id ? `${s.slice}.${s.field} (${s.id})` : `${s.slice}.${s.field}`))
      .join(", ");
    super(
      `Password changed, but ${skipped.length} secret${skipped.length === 1 ? "" : "s"} ` +
        `could not be moved to the new password and remain protected by the ` +
        `OLD password: ${fields}. Everything else now uses the new password. ` +
        `Those fields will keep working with their old password, but any ` +
        `operation that needs them (e.g. signing) will fail until this is ` +
        `resolved — contact support with this message rather than changing ` +
        `the password again, which will not fix it.`
    );
    this.skipped = skipped;
  }
}
