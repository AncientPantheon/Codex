/**
 * The Arweave restore eligibility detector (T1 of
 * `docs/work/codex-seed-restore-activation/plan.md`).
 *
 * A codex's seed-word recovery mechanism (`codex-recovery-backup-tagging`)
 * depends on the Prime Arweave seed genuinely sharing origin words with the
 * Prime Ouronet account — true automatically for a codex kickstarted after
 * that mechanism existed, not necessarily true for an older codex, or one
 * where the Prime Arweave seed was manually defined from unrelated words.
 * `isPrime: true` alone is not proof of shared origin; re-deriving what the
 * Prime Arweave seed's address WOULD be from the Prime Ouronet account's
 * bitstring (via {@link deriveArweaveSeedAtPositionZero}) and comparing it to
 * the actual stored address is the only reliable check.
 *
 * This module is DELIBERATELY thin, mirroring `derivePrimeSeed.ts`: it does
 * not know about `ArweaveSeedEntry`, the codex store, or the Ouronet account
 * — just the comparison. A derivation failure (the underlying promise
 * rejecting) propagates verbatim — it must never be swallowed into `false`,
 * which would misreport a technical failure as "not eligible".
 */

import {
  deriveArweaveSeedAtPositionZero,
  type KeygenProgress,
} from "./derivePrimeSeed.js";

/** Config for {@link checkArweaveRestoreEligibility}. */
export interface CheckArweaveRestoreEligibilityOptions {
  /** The Prime Ouronet account's bitstring — what eligibility is re-derived from. */
  ouronetBitstring: string;
  /** The Prime Arweave seed's actual stored address — what the re-derived address is compared against. */
  primeArweaveAddress: string;
  /** INJECTED worker factory — never `new Worker(new URL(...))` here. */
  workerFactory: () => Worker;
  /** Coarse phase updates, forwarded from the worker's `progress` messages. */
  onProgress?: (p: KeygenProgress) => void;
}

/**
 * Resolves `true` iff re-deriving the Prime Arweave seed's index-0 key from
 * `ouronetBitstring` yields an address EXACTLY equal (case-sensitive —
 * Arweave addresses are base64url, not case-insensitive) to
 * `primeArweaveAddress`; `false` otherwise.
 *
 * Rejects (never resolves `false`) if the underlying derivation rejects —
 * a technical failure is not the same as "not eligible".
 */
export async function checkArweaveRestoreEligibility(
  options: CheckArweaveRestoreEligibilityOptions,
): Promise<boolean> {
  const { ouronetBitstring, primeArweaveAddress, workerFactory, onProgress } = options;

  const derived = await deriveArweaveSeedAtPositionZero({
    bitstring: ouronetBitstring,
    workerFactory,
    onProgress,
  });

  return derived.address === primeArweaveAddress;
}
