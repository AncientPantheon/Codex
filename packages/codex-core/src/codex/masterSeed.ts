/**
 * THE CODEX MASTER SEED ROW — the codex's record of which three entities are
 * the three faces of its one seed.
 *
 * Owner: *"Since the Seed is the same but used for multiple accounts (Ouronet
 * Account - singular, chainweb keys - multiple and deterministic, arweave
 * accounts - multiple and deterministic), we would add it as a section in the
 * Codex ID, as the Codex Master Seed, which should also have a row in the thus
 * new codex format."*
 *
 * ## What this row deliberately does NOT carry
 *
 * No words, no bitstring, no secret of any kind. The three entities it names
 * already hold their own encrypted material; a copy here would be a SECOND
 * at-rest copy that can drift from the first and has to be re-keyed in
 * lockstep on every password change. This row answers *which three*, never
 * *what are they* — the same discipline `masterKeyLocks` follows, which names
 * `(seedId, position)` pairs and never key material.
 *
 * ## Why the ArWeave face is optional
 *
 * The three faces are not established at the same moment. A codex can have a
 * settled Codex Ouronet Master and Master Chainweb Seed while its Master
 * ArWeave Seed has not been derived yet (that derivation is RSA-4096 and
 * takes seconds, so it is a separate step). Modelling it as optional is the
 * honest shape; the alternative would be a placeholder id pointing at nothing.
 *
 * ## Why the row also remembers who the master WAS
 *
 * The master can move. Before the former-holder ids below existed, the prior
 * holder's identity was destroyed the moment it did — the id was overwritten
 * in place here, `promoteSeedAndAccountToPrime` cleared the old `isPrime`, and
 * the displaced ArWeave seed's stored name was rewritten. So the owner's
 * *"the one that isn't anymore would be designated Former Master Arweave
 * Seed"* could not be derived from anything that existed.
 *
 * The history is APPEND-ONLY and never pruned, following the discipline of
 * the codex's one other former-role marker, `IPureKeypair.wasCodexGuard`:
 * a retired CodexGuard is kept "stored forever" in retirement order, so
 * anyone inspecting the codex can see every key that ever held the role.
 * Note the consequence: an id that regains the role STAYS in the history, so
 * the "former" question is never "is it listed" alone — see
 * {@link isFormerMasterAccount}.
 */

import { isMigrationSealed } from "./migrationProgress.js";
import type { MigrationProgress } from "./migrationProgress.js";

/** The three faces of one seed, by id. No secret material — see the header. */
export interface CodexMasterSeed {
  /** `IOuroAccount.id` of the Codex Ouronet Master. */
  readonly ouroAccountId: string;
  /** `IStoaChainSeed.id` of the Master Chainweb Seed. */
  readonly chainwebSeedId: string;
  /** `IArweaveSeed.id` of the Master ArWeave Seed, when one exists yet. */
  readonly arweaveSeedId?: string;
  /** ISO timestamp of when the codex settled on this seed. */
  readonly establishedAt: string;
  /**
   * Every `IOuroAccount.id` that has held {@link ouroAccountId} and been
   * displaced from it, oldest FIRST, most recently displaced LAST. Absent
   * (never `[]`) on a codex whose master has never moved — see the header for
   * the append-only discipline, and {@link recordFormerMasterIds} for the one
   * writer.
   */
  readonly formerOuroAccountIds?: readonly string[];
  /** Every `IArweaveSeed.id` displaced from {@link arweaveSeedId}, in the
   *  same order and under the same rules as {@link formerOuroAccountIds}. */
  readonly formerArweaveSeedIds?: readonly string[];
  /**
   * `IOuroAccount.id` of the account that was this codex's CodexPrime before
   * it ever settled a master. Written ONCE — by the first finalize that
   * promotes a DIFFERENT account — and never overwritten afterwards; see
   * {@link recordFormerMasterIds}, which enforces that for every writer.
   *
   * ## Why this is not {@link formerOuroAccountIds}
   *
   * The eligibility wizard is re-runnable by design, and EVERY run executes
   * its Write 2. So the append-only history accumulates every *candidate*
   * that briefly held the row — accounts that were never applied and never
   * displaced anything. Designations only become visible at the seal, so at
   * seal time that list can hold several ids with equal claim to a "Former"
   * title while only one of them is a real displacement.
   *
   * Compounding it: on a retry, "the account carrying `isPrime` before this
   * run's promotion" is the PREVIOUS CANDIDATE, not the owner's original
   * account. A capture that re-ran each finalize would record the wrong one —
   * and because the promotion destroys the evidence (it clears `isPrime` on
   * every other account), nothing could ever reconstruct the right one. That
   * is why write-once is the load-bearing property here, not an optimisation.
   *
   * `formerOuroAccountIds` stays exactly as it is — an honest audit trail of
   * ids that have held the row — and is simply no longer consulted for the
   * Ouronet designation. Read this field through
   * {@link isLegacyPrimeAccount}, which applies the seal gate.
   */
  readonly legacyPrimeOuroAccountId?: string;
}

/** Which faces of the master seed are established. `"arweave"` is the one
 *  that can legitimately be missing on an otherwise-complete codex. */
export interface CodexMasterSeedFaces {
  readonly ouronet: boolean;
  readonly chainweb: boolean;
  readonly arweave: boolean;
  /** True when all three are established. */
  readonly complete: boolean;
}

/**
 * Report which faces are established, so a UI can state what is missing
 * instead of rendering a blank. An absent row reports every face as absent
 * rather than throwing — a codex that has never been migrated is a normal
 * state, not an error.
 */
export function describeCodexMasterSeed(
  row: CodexMasterSeed | undefined
): CodexMasterSeedFaces {
  const ouronet = !!row?.ouroAccountId;
  const chainweb = !!row?.chainwebSeedId;
  const arweave = !!row?.arweaveSeedId;
  return { ouronet, chainweb, arweave, complete: ouronet && chainweb && arweave };
}

/**
 * Carry the former-holder history of `previous` onto `next`, appending any id
 * this transition displaces.
 *
 * The ONE writer of {@link CodexMasterSeed.formerOuroAccountIds} and
 * {@link CodexMasterSeed.formerArweaveSeedIds}. It lives here, beside the
 * shape it maintains, rather than inside `setCodexMasterSeed`, so the
 * append-only rule is a pure function with its own unit tests instead of a
 * fragment of a persisting store action.
 *
 * Rules, all three load-bearing:
 *
 *   - only the OUTGOING id is recorded. The incoming one is the current
 *     holder, not a former one;
 *   - an id already in the history is not appended twice, so handing the role
 *     back and forth cannot grow the list without bound;
 *   - {@link CodexMasterSeed.legacyPrimeOuroAccountId} is WRITE-ONCE: once
 *     `previous` carries one, it wins over whatever `next` names. See that
 *     field for why a later reading would be the wrong account;
 *   - a list that would be empty stays ABSENT rather than becoming `[]`. A
 *     first-ever settlement therefore produces a row byte-identical to the
 *     one it would have produced before this history existed, which is what
 *     keeps `setCodexMasterSeed`'s no-change short-circuit intact.
 *
 * Returns `next` itself when there is nothing to record.
 */
export function recordFormerMasterIds(
  previous: CodexMasterSeed | undefined | null,
  next: CodexMasterSeed
): CodexMasterSeed {
  const formerOuroAccountIds = appendDisplaced(
    next.formerOuroAccountIds,
    previous?.ouroAccountId,
    next.ouroAccountId
  );
  const formerArweaveSeedIds = appendDisplaced(
    next.formerArweaveSeedIds,
    previous?.arweaveSeedId,
    next.arweaveSeedId
  );
  // WRITE-ONCE: an id already recorded wins over anything `next` carries,
  // forever. `setCodexMasterSeed` routes every row write through here, so the
  // rule holds at the store with no store logic — and the wizard's finalize
  // can stay an unconditional write. Falsy counts as NOT SET (a half-written
  // id is not an identity), so an empty string cannot block the real one.
  const legacyPrimeOuroAccountId =
    previous?.legacyPrimeOuroAccountId || next.legacyPrimeOuroAccountId;
  if (
    formerOuroAccountIds === next.formerOuroAccountIds &&
    formerArweaveSeedIds === next.formerArweaveSeedIds &&
    legacyPrimeOuroAccountId === next.legacyPrimeOuroAccountId
  ) {
    return next;
  }
  return {
    ...next,
    ...(formerOuroAccountIds ? { formerOuroAccountIds } : {}),
    ...(formerArweaveSeedIds ? { formerArweaveSeedIds } : {}),
    ...(legacyPrimeOuroAccountId ? { legacyPrimeOuroAccountId } : {}),
  };
}

/** The append-and-dedupe rule of {@link recordFormerMasterIds}, for one face.
 *  Returns `history` unchanged (by identity) when nothing is displaced. */
function appendDisplaced(
  history: readonly string[] | undefined,
  outgoingId: string | undefined,
  incomingId: string | undefined
): readonly string[] | undefined {
  if (!outgoingId || outgoingId === incomingId) return history;
  if (history?.includes(outgoingId)) return history;
  return history ? [...history, outgoingId] : [outgoingId];
}

/**
 * True when `accountId` is a FORMER Codex Ouronet Master — i.e. it is in the
 * row's account history and is not the current holder.
 *
 * ## Why the seal is a required argument
 *
 * Design: *"the designation follows the SEAL, not the finalize"*. The master
 * row is written at finalize (Write 2), is non-fatal on failure and is
 * re-writable by a later finalize while the migration is unsealed, whereas
 * `migrationProgress.appliedAt` is monotone and permanent. A
 * finalized-but-unapplied codex must therefore show no former designation.
 *
 * The gate lives INSIDE this predicate, as a required parameter, rather than
 * at the call sites: every surface that renders the designation (accounts
 * tab, seeds area, the Codex ID page, the ZBOM pickers) would otherwise have
 * to remember to `&&` it, and the one that forgot would move a golden
 * designation on a codex whose Apply never happened. Required means TypeScript
 * refuses the call that omits it; `undefined`/`null` are accepted — matching
 * {@link isMigrationSealed}'s own signature — and fail CLOSED (no
 * designation), so the only way to get a `true` out of this is a genuinely
 * sealed codex.
 *
 * @param accountId `IOuroAccount.id` of the account being asked about. An
 *   absent or empty id is never former — an unidentifiable account must not
 *   inherit someone else's history.
 * @param row the codex's `codexMasterSeed`, absent on a never-migrated codex.
 * @param progress the codex's `migrationProgress`, i.e. the seal.
 *
 * ## Nothing renders this for accounts any more
 *
 * Stated so the next reader does not take its existence as evidence of a live
 * surface. A displacement can only happen ONCE, and it is always
 * kickstart-prime -> settled master, so the accounts tab now asks
 * {@link isLegacyPrimeAccount} instead. This predicate is KEPT because it is
 * correct for what it says and is the right answer should a second
 * displacement ever become possible; its ArWeave twin below is still live.
 */
export function isFormerMasterAccount(
  accountId: string | undefined | null,
  row: CodexMasterSeed | undefined | null,
  progress: MigrationProgress | undefined | null
): boolean {
  return isDisplacedHolder(accountId, row?.formerOuroAccountIds, row?.ouroAccountId, progress);
}

/**
 * True when `accountId` is the codex's LEGACY CodexPrime — the account that
 * held the role before this codex ever settled a master, recorded once in
 * {@link CodexMasterSeed.legacyPrimeOuroAccountId}. The account that renders
 * the retired designation "Former Codex Prime".
 *
 * Seal-gated, exactly like {@link isFormerMasterAccount} and for the owner's
 * own reason — *"Only when sealing we get to see the new designations."* The
 * gate is not re-implemented here: this delegates to the same
 * `isDisplacedHolder` rule both "Former ..." predicates share, handing it a
 * one-id history, so there is still ONE copy of the "sealed, identified, and
 * not the current holder" discipline rather than a fourth.
 *
 * It deliberately does NOT read `formerOuroAccountIds`: that append-only list
 * accumulates every wizard CANDIDATE, and only the write-once field names the
 * one real displacement. See that field for why.
 *
 * @param accountId `IOuroAccount.id` of the account being asked about.
 * @param row the codex's `codexMasterSeed`, absent on a never-migrated codex.
 * @param progress the codex's `migrationProgress`, i.e. the seal.
 */
export function isLegacyPrimeAccount(
  accountId: string | undefined | null,
  row: CodexMasterSeed | undefined | null,
  progress: MigrationProgress | undefined | null
): boolean {
  const legacy = row?.legacyPrimeOuroAccountId;
  return isDisplacedHolder(
    accountId,
    legacy ? [legacy] : undefined,
    row?.ouroAccountId,
    progress
  );
}

/**
 * True when `seedId` is a FORMER Master ArWeave Seed — the ArWeave-face twin
 * of {@link isFormerMasterAccount}, including its seal gate. See that
 * function for why `progress` is required.
 *
 * @param seedId `IArweaveSeed.id` of the seed being asked about.
 */
export function isFormerMasterArweaveSeed(
  seedId: string | undefined | null,
  row: CodexMasterSeed | undefined | null,
  progress: MigrationProgress | undefined | null
): boolean {
  return isDisplacedHolder(seedId, row?.formerArweaveSeedIds, row?.arweaveSeedId, progress);
}

/** The one copy of the former-holder rule the two predicates share, so the
 *  account and ArWeave faces can never answer by different logic. */
function isDisplacedHolder(
  id: string | undefined | null,
  history: readonly string[] | undefined,
  currentHolderId: string | undefined,
  progress: MigrationProgress | undefined | null
): boolean {
  if (!isMigrationSealed(progress)) return false;
  if (!id) return false;
  // The history is append-only, so an id that REGAINED the role is still
  // listed. The current holder is never a former one.
  if (id === currentHolderId) return false;
  return history?.includes(id) === true;
}
