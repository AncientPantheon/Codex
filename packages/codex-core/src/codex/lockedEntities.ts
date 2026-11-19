/**
 * LOCKED ENTITIES — the one place that answers *"would the store refuse to
 * delete this?"*, once per entity type.
 *
 * ## Why this module exists
 *
 * Protection was enforced in four places and communicated in five different
 * ways: a disabled button here, a hidden menu item there, a badge on exactly
 * one surface, and nothing at all for the two rules the store actually
 * enforces hardest. Four of the five let the owner click a live Delete on
 * something the store then refused — twice silently, once with the store's
 * own explanation thrown away, once as an unhandled rejection.
 *
 * Owner: *"we have no way to see which entries are protected. Such Protected
 * Seeds or account should have a lock medalion ... and delete button should
 * not be available for them."*
 *
 * The badge is the remedy, but a badge driven by its own private copy of the
 * rule would just be a fifth way to say it, free to drift from the store in
 * six months. So each predicate here returns the REASON rather than a
 * boolean, the UI renders its medallion and withholds its delete control from
 * that answer, and the store keeps throwing — the two can then be pinned
 * against each other by a parity spec.
 *
 * ## The constraints these predicates are built to
 *
 *  - **Render-time cheap.** Every input is already in memory: booleans on the
 *    entity, the plain `masterKeyLocks` array, an id. No decrypt, no chain
 *    read, nothing async. Anything needing a probe is out of scope by design
 *    — see {@link ouronetAccountLock} on `hasEncryptedArweaveUpload`.
 *  - **Structural inputs**, in `MasterOuronetAccountCandidate`'s style:
 *    codex-core cannot see the concrete Ouronet entity types, and a unit test
 *    should not have to build a whole `IOuroAccount` (chain keys, guards,
 *    StoicTag included) to ask one question.
 *  - **The store stays the enforcer.** These answer what the store would do;
 *    they never become the only guard.
 *
 * The master-key lock rule is NOT re-implemented here. `seedIsLocked`,
 * `lockedPositionsOf` and `lockMatchesPosition` already state it, and a
 * second copy of a rule that must release precisely the reasons that lapsed
 * is exactly the drift this module exists to end.
 */

import { MASTER_CHAINWEB_SEED, OURONET_CODEX_MASTER } from "./masterNames.js";
import { lockMatchesPosition, seedIsLocked } from "./masterKeyLocks.js";
import type { MasterKeyLock, MasterKeyLockReason } from "./masterKeyLocks.js";

/**
 * Why an entity cannot be deleted. The store-enforced reasons are named after
 * the error each one produces, so the medallion's tooltip and the thrown
 * error can be traced to each other by eye.
 *
 * {@link MasterKeyLockReason} is re-used VERBATIM rather than re-declared:
 * `CodexMasterKeyLockedError.reason` carries those exact strings, and two
 * parallel spellings of one provenance is how the medallion would start
 * naming something the error does not.
 */
export type EntityLockReason =
  | "codex-prime-account"       // IOuroAccount.isPrime      → CodexPrimeProtectedError
  | "settled-master-account"    // codexMasterSeed.ouroAccountId
  | "codex-id-half"             // an APOLLO CodexID prime half
  | "arweave-encryption-upload" // hasEncryptedArweaveUpload === true
  | "prime-chainweb-seed"       // IStoaChainSeed.isPrime    → CodexPrimeSeedProtectedError
  | MasterKeyLockReason         // "master-payment-key" | "master-guard-key", VERBATIM
  | "codex-guard-key"           // isCodexGuard
  | "retired-codex-guard-key"   // wasCodexGuard
  | "duo-pure-prime-key"        // isDuoPurePrime
  | "master-arweave-seed";      // the settled Master ArWeave Seed

export interface EntityLock {
  readonly reason: EntityLockReason;
  /** One owner-facing sentence — the medallion's tooltip. */
  readonly label: string;
}

/** Every lock is built here, so no call site can produce a reason with no
 *  words to go with it. */
const lock = (reason: EntityLockReason, label: string): EntityLock => ({ reason, label });

// ---------------------------------------------------------------------------
// Ouronet accounts
// ---------------------------------------------------------------------------

/** The three fields the account rule reads. Structural on purpose — see the
 *  header. */
export interface OuronetAccountLockCandidate {
  readonly id: string;
  /** `IOuroAccount.isPrime`. Read off the ACCOUNT, never from the tab's
   *  "which row is the master" resolver, which answers `accounts[0]` until
   *  the seal — see {@link ouronetAccountLock}. */
  readonly isPrime?: boolean;
  /** `IOuroAccount.hasEncryptedArweaveUpload`. `true` is authoritative;
   *  `false`/absent is NOT — see {@link ouronetAccountLock}. */
  readonly hasEncryptedArweaveUpload?: boolean;
}

/** The facts about the codex that the account rule needs but the account does
 *  not carry. */
export interface OuronetAccountLockOpts {
  /** `codexMasterSeed.ouroAccountId` — the settled master's id, when the
   *  caller's own seal gate says it may be read. */
  readonly masterAccountId?: string | null;
  /** True when this account is one of the APOLLO CodexID prime halves. */
  readonly isCodexIdHalf?: boolean;
}

/**
 * Why `account` cannot be deleted, or `null` when nothing locks it.
 *
 * ## Reading `isPrime` off the account closes the finalize→seal window
 *
 * `promoteSeedAndAccountToPrime` moves the flag at FINALIZE, but the accounts
 * tab's master identity answers `accounts[0]` until the codex is SEALED. An
 * account promoted into a non-zero index therefore showed an enabled delete
 * that `deleteOuroAccount` refuses with `CodexPrimeProtectedError`. Asking
 * the account for its own flag removes that window entirely, without
 * disturbing the seal gate that (correctly) governs DESIGNATIONS.
 *
 * ## `hasEncryptedArweaveUpload` claims protection only, never un-protection
 *
 * `true` is authoritative: the store refuses unconditionally on it, because
 * deleting that account would orphan permanent on-chain ciphertext forever.
 * `false`/absent is NOT authoritative — the real answer needs the async
 * `checkAccountEncryptedArweaveUploads` chain query, which is out of scope
 * for a render-time predicate. So a `null` from this function means "no
 * LOCAL reason to refuse", never "safe to delete".
 *
 * ## Why the two store-enforced reasons are tested first
 *
 * `settled-master-account` and `codex-id-half` are UI-level widenings — the
 * store refuses on neither. The reason reported has to be the one the store
 * would actually throw, or the medallion sends the owner to the wrong remedy,
 * so the order below mirrors `deleteOuroAccount`'s own checks.
 */
export function ouronetAccountLock(
  account: OuronetAccountLockCandidate | undefined | null,
  opts?: OuronetAccountLockOpts
): EntityLock | null {
  if (!account) return null;
  if (account.isPrime === true) {
    return lock(
      "codex-prime-account",
      `This account is your codex's CodexPrime and cannot be deleted.`
    );
  }
  if (account.hasEncryptedArweaveUpload === true) {
    return lock(
      "arweave-encryption-upload",
      `This account has encrypted a confirmed ArWeave upload. Deleting it ` +
        `would orphan permanent on-chain ciphertext forever.`
    );
  }
  if (opts?.masterAccountId && opts.masterAccountId === account.id) {
    return lock(
      "settled-master-account",
      `This account is your ${OURONET_CODEX_MASTER} and cannot be deleted.`
    );
  }
  if (opts?.isCodexIdHalf === true) {
    return lock(
      "codex-id-half",
      `This account is one half of your Codex Stoic Identity and cannot be deleted.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chainweb seeds and their key positions
// ---------------------------------------------------------------------------

/** The two fields the seed rule reads. */
export interface ChainwebSeedLockCandidate {
  readonly id: string;
  /** `IStoaChainSeed.isPrime` — the seed that kickstarted the codex. */
  readonly isPrime?: boolean;
}

/**
 * Why `seed` cannot be deleted, or `null` when nothing locks it.
 *
 * The owner's own case: a NON-prime seed holding a master-key lock. The
 * seeds menu gated Rename/Delete on `isPrime` alone, so such a seed showed a
 * live Delete that `deleteStoaChainSeed` refuses with
 * `CodexMasterKeyLockedError` — the blast radius being wider than the locked
 * position itself, since deleting a seed cascades to its derived accounts.
 *
 * `seedIsLocked` is the authority for "is it held"; the reason is taken from
 * the first lock naming the seed, which is the one `deleteStoaChainSeed`'s
 * own `find` would report. Order follows the store: identity first, registry
 * second.
 */
export function chainwebSeedLock(
  seed: ChainwebSeedLockCandidate | undefined | null,
  locks: readonly MasterKeyLock[] | undefined
): EntityLock | null {
  if (!seed) return null;
  if (seed.isPrime === true) return primeChainwebSeedLock();
  if (!seedIsLocked(locks, seed.id)) return null;
  const held = locks?.find((l) => l.seedId === seed.id);
  return held ? masterKeyLock(held.reason, "seed") : null;
}

/** The facts about the seed that a POSITION does not carry. */
export interface ChainwebKeyPositionLockOpts {
  /** `IStoaChainSeed.isPrime` of the seed this position belongs to. */
  readonly seedIsPrime?: boolean;
}

/**
 * Why the key at `position` of `seedId` cannot be removed, or `null`.
 *
 * The worse of the two lock bugs. `updateStoaChainSeed` is a whole-object
 * replace and the ONLY route by which a position disappears, so it is where
 * the invariant is actually enforced — the store's own comment calls the
 * seeds UI's disabled button *"cosmetic"* and itself *"the real thing"*. The
 * UI disabled delete for prime+index 0 only, and its delete handler had no
 * `catch` at all, so a locked position failed as an unhandled rejection and
 * silence.
 *
 * Both rules live here now:
 *
 *  1. the REGISTRY — exactly the set `updateStoaChainSeed` guards — matched
 *     through `lockMatchesPosition`, so the `(seedId, position)` comparison
 *     is never spelled out a second time;
 *  2. position 0 of a prime seed, today's cosmetic rule, stated ONCE instead
 *     of being re-derived at each key row.
 *
 * `lockedPositionsOf` is deliberately NOT used here even though it answers a
 * neighbouring question: it returns the position SET and discards which lock
 * matched, i.e. precisely the reason this function exists to report. Gating
 * on it before the `find` was tried and removed — it could not change any
 * answer, so no test could hold it honest, and an unfalsifiable line is worse
 * than no line. Callers wanting the set (a key list rendering every lock at
 * once) should call it directly.
 *
 * The registry wins when both apply: it is the one the store will actually
 * throw on, and its reason tells the owner the remedy (re-run Secure Master
 * Account) that the cosmetic rule has no answer for.
 */
export function chainwebKeyPositionLock(
  seedId: string | undefined | null,
  position: number,
  locks: readonly MasterKeyLock[] | undefined,
  opts?: ChainwebKeyPositionLockOpts
): EntityLock | null {
  if (!seedId) return null;
  const held = locks?.find((l) => lockMatchesPosition(l, seedId, position));
  if (held) return masterKeyLock(held.reason, "position");
  if (opts?.seedIsPrime === true && position === 0) return primeChainwebSeedLock(0);
  return null;
}

/** The prime-seed refusal, in its two scopes. One function so the whole-seed
 *  and first-key faces of the same identity cannot drift apart. */
function primeChainwebSeedLock(position?: number): EntityLock {
  return lock(
    "prime-chainweb-seed",
    position === undefined
      ? `This seed is your codex's ${MASTER_CHAINWEB_SEED} and cannot be deleted.`
      : `Key #${String(position)} of your codex's ${MASTER_CHAINWEB_SEED} cannot be removed.`
  );
}

/**
 * The owner-facing words for a master-key lock, in the vocabulary
 * `CodexMasterKeyLockedError` already uses — including the remedy, because a
 * refusal that did not say how to release it would be indistinguishable from
 * a bug. `scope` only decides whether the sentence talks about the seed that
 * HOLDS the key or the key itself; the reason is identical either way.
 */
function masterKeyLock(
  reason: MasterKeyLockReason,
  scope: "seed" | "position"
): EntityLock {
  const what =
    reason === "master-payment-key"
      ? `your ${OURONET_CODEX_MASTER}'s payment key`
      : `a key inside your ${OURONET_CODEX_MASTER}'s guard`;
  const subject = scope === "seed" ? `This seed holds ${what}` : `This key is ${what}`;
  return lock(
    reason,
    `${subject}. Release it by re-running Secure Master Account once the key ` +
      `is genuinely no longer in use.`
  );
}

// ---------------------------------------------------------------------------
// Pure keypairs
// ---------------------------------------------------------------------------

/** The three flags the pure-keypair rule reads. */
export interface PureKeypairLockCandidate {
  readonly isCodexGuard?: boolean;
  readonly wasCodexGuard?: boolean;
  readonly isDuoPurePrime?: boolean;
}

/**
 * Why `keypair` cannot be deleted, or `null`.
 *
 * The one surface that already showed a badge, so this predicate exists to
 * make it consistent rather than to fix a lie. The flag precedence — serving
 * guard, then retired guard, then duo pure prime — is `PureKeypairsTab`'s
 * own, carried over deliberately: a key that is serving TODAY must read as
 * serving, not as retired. The labels embed that surface's existing wording
 * (`"CodexGuard"`, `"retired guard"`, the master's name) verbatim, so
 * swapping its hand-rolled pill for the shared medallion changes no
 * vocabulary beyond the word "Locked" itself.
 */
export function pureKeypairLock(
  keypair: PureKeypairLockCandidate | undefined | null
): EntityLock | null {
  if (!keypair) return null;
  if (keypair.isCodexGuard === true) {
    return lock(
      "codex-guard-key",
      `This key is your CodexGuard and cannot be removed.`
    );
  }
  if (keypair.wasCodexGuard === true) {
    return lock(
      "retired-codex-guard-key",
      `This key is a retired guard. The codex keeps every key that ever held ` +
        `the role, so it cannot be removed.`
    );
  }
  if (keypair.isDuoPurePrime === true) {
    return lock(
      "duo-pure-prime-key",
      `This key belongs to your ${OURONET_CODEX_MASTER} and cannot be removed.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// ArWeave seeds
// ---------------------------------------------------------------------------

/** The two fields the ArWeave seed rule reads. */
export interface ArweaveSeedLockCandidate {
  readonly id: string;
  /** `IArweaveSeed.isPrime` — the first seed ever added. */
  readonly isPrime?: boolean;
}

/**
 * Why `seed` cannot be deleted, or `null`.
 *
 * The face that had no protection at ANY layer: `deleteArweaveSeed` was an
 * unguarded filter, so the master ArWeave seed could be deleted outright,
 * leaving `codexMasterSeed.arweaveSeedId` dangling while the codex still
 * reported that face established.
 *
 * TWO rules, deliberately:
 *
 *  - `settledArweaveSeedId === seed.id` — the codex's settled IDENTITY of its
 *    Master ArWeave Seed;
 *  - `seed.isPrime === true` — the pre-settlement rule, the one every codex
 *    that has not re-run the wizard still needs. It is the same rule
 *    `deleteStoaChainSeed` already applies to its own face.
 *
 * NOT included: `resolveMasterArweaveSeed`'s third branch, position 0. That
 * one is a DISPLAY fallback for a codex with no flag and no settled id, and
 * the store cannot defend an insertion-ordered index — whichever seed
 * happened to be first would become undeletable, and adding a seed could
 * move the protection onto a different row. A display may guess; a refusal
 * may not.
 */
export function arweaveSeedLock(
  seed: ArweaveSeedLockCandidate | undefined | null,
  settledArweaveSeedId: string | undefined | null
): EntityLock | null {
  if (!seed) return null;
  const settled = !!settledArweaveSeedId && settledArweaveSeedId === seed.id;
  if (!settled && seed.isPrime !== true) return null;
  return lock(
    "master-arweave-seed",
    `This seed is your Master ArWeave Seed. Deleting it would leave the ` +
      `codex's ArWeave face pointing at nothing.`
  );
}
