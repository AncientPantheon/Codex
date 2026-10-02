// ============================================================================
// T4 of docs/work/codex-recovery-backup-tagging/plan.md — the HOST-LAYER
// composition that installs a Prime Arweave seed automatically right after a
// codex is kickstarted.
//
// `docs/work/arweave-seed-restore/design.md`'s whole restore-by-seed-words
// mechanism depends on one precondition: the Prime Ouronet account and the
// Prime Arweave seed share origin words. That is only automatically true if
// the Prime Arweave seed is derived and installed the moment the codex is
// kickstarted — this module is that wiring.
//
// WHY THIS LIVES HERE (not inside any `codex-*` package): `codex-ui` does NOT
// depend on `codex-arweave` — it is deliberately chain-agnostic (the generic
// `ForeignChainsTab` architecture, docs/work/codex-class-ia-arweave/design.md).
// Adding a codex-arweave edge to codex-ui would break that genericity, so the
// orchestration belongs at the HOST APP layer instead — exactly where
// `ForeignChainsWiring.tsx` already composes codex-ui's chain-agnostic seams
// with codex-arweave's concrete Arweave deps for the codex-backup feature
// (docs/work/arweave-upload-categories/design.md's addendum). This module is
// that same pattern applied to kickstart.
//
// WHY `fresh-dalos` ONLY: an Arweave seed is ALWAYS a 1600-bit DALOS bitstring
// (`packages/codex-arweave/src/panel/ArweaveSeedsArea.tsx`'s own "design.md's
// one rule"). Of `KickstartArgsV3["codexPrimeSeed"]`'s four sources, only
// `"fresh-dalos"` produces a DALOS-curve CodexPrime account
// (`originCurve: "dalos"`) — the other three re-derive from the Codex
// Identity's own APOLLO (1024-bit) half-seeds, which `ArweaveSeedsArea.tsx`'s
// own Option 2 already refuses as an Arweave seed source. Calling this helper
// with any other `codexPrimeSeed.source` is refused loudly up front, rather
// than failing deep inside `bitStringOf` with a confusing null.
//
// THE PERSISTENCE SHAPE mirrors `ArweaveSeedsArea.tsx`'s "Option 2" (an
// Ouronet account's key IS already a DALOS bitstring) define-seed persistence
// exactly, as wired by this app's own `createArweaveSeedPersistence` in
// `ForeignChainsWiring.tsx`: `secret = encryptStringV2(bits, password)`,
// `wordsSecret = encryptStringV2(words, password)` (only when real words are
// in hand — they always are here, since this module's own caller supplies
// them), `isPrime: true`. `StoredArweaveSeed` (this file imports it from
// `ForeignChainsWiring.tsx` rather than redefining it) is the exact shape
// `addArweaveSeed` persists.
// ============================================================================

import { bitStringOf } from "@ancientpantheon/codex-ouronet/codex-identity";
import type {
  KickstartArgsV3,
  KickstartResultV3,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";
import { deriveArweaveSeedAtPositionZero as realDeriveArweaveSeedAtPositionZero } from "@ancientpantheon/codex-arweave/seeds";
import type { KeygenProgress } from "@ancientpantheon/codex-arweave/seeds";

import type { StoredArweaveSeed } from "./ForeignChainsWiring.js";

/** The name every Prime Arweave Seed is given — mirrors
 *  `ArweaveSeedsArea.tsx`'s own `PRIME_SEED_LABEL`. Duplicated rather than
 *  imported: that constant lives on the HEAVY `./panel` subpath, and this
 *  module deliberately stays off it (it needs no React runtime). */
export const PRIME_ARWEAVE_SEED_LABEL = "Prime Arweave Seed";

/** The injected seams — every heavy/side-effecting dependency this module
 *  touches, so the composition itself (call order + argument wiring) is unit-
 *  testable with zero real worker, zero real PBKDF2/RSA-4096, and zero real
 *  store. Production callers supply the real `kickstart`/`addArweaveSeed`
 *  (reached from the host layer per `useCodexLifecycle.ts`'s own
 *  `useCodexStore() -> store((s) => s.actions) -> the action` pattern), the
 *  real worker factory (`realArweaveAdapter.ts`'s `createKeygenWorker`), and
 *  a password-bound `encryptSecret` (`(plaintext) => encryptStringV2(plaintext, password)`,
 *  mirroring `createArweaveSeedPersistence`'s own `getPassword()` seam). */
export interface KickstartAndInstallPrimeArweaveSeedDeps {
  /** The store's `kickstartCodex` action (v0.3 shape), reached exactly like
   *  `useCodexLifecycle().kickstart`. */
  kickstart: (args: KickstartArgsV3) => Promise<KickstartResultV3>;
  /** T3's pure Prime-Arweave-seed-at-index-0 derivation primitive. Defaults to
   *  the real `@ancientpantheon/codex-arweave/seeds` export; overridden in
   *  tests with a fast fake so this suite never spawns a real Worker. */
  deriveArweaveSeedAtPositionZero?: typeof realDeriveArweaveSeedAtPositionZero;
  /** Re-derives the freshly-kickstarted CodexPrime account's 1600-bit DALOS
   *  bitstring from its origin words — the SAME re-derivation
   *  `ArweaveSeedsArea.tsx`'s own Option 2 uses
   *  (`@ancientpantheon/codex-ouronet/codex-identity`'s `bitStringOf`).
   *  Defaults to the real `bitStringOf`; overridden in tests. */
  deriveBitstring?: (account: IOuroAccount, words: string) => string | null;
  /** INJECTED worker factory for the #0 derivation — never constructed here. */
  workerFactory: () => Worker;
  /** Encrypts ONE plaintext string at the codex password — opaque to this
   *  module (never the key-derivation scheme's business). Production callers
   *  close over the password via `useCodexAuth().getCurrentPassword()` and
   *  `@stoachain/stoa-core/crypto`'s `encryptStringV2`. */
  encryptSecret: (plaintext: string) => Promise<string>;
  /** Persists the finished seed — the store's `addArweaveSeed` action, reached
   *  the same way `kickstart` is. */
  addArweaveSeed: (seed: StoredArweaveSeed) => Promise<void>;
}

export interface KickstartAndInstallPrimeArweaveSeedResult {
  kickstartResult: KickstartResultV3;
  /** The Prime Arweave seed's plaintext bitstring — returned ONLY so a caller
   *  that needs it this one time (e.g. to also pre-seal the first RSA-4096
   *  key) does not have to re-derive it; never logged, never persisted beyond
   *  `addArweaveSeed`'s own ciphertext. */
  bitstring: string;
}

/**
 * Kickstart a codex, then install its Prime Arweave seed — derived from the
 * SAME words that just seeded the Prime Ouronet (CodexPrime) account.
 *
 * Call order is deliberate and funds-relevant: `kickstart` first (nothing to
 * derive from before it resolves), then the #0 derivation (T3's primitive —
 * the real ~6.7s cost, surfaced via `onProgress`), and ONLY once that
 * succeeds is the seed actually persisted via `addArweaveSeed`. A seed
 * installed before its #0 key is confirmed derivable would look restorable
 * and not be — worse than no seed at all.
 *
 * Throws (never swallows) if `kickstartArgs.codexPrimeSeed.source` is not
 * `"fresh-dalos"` — see this module's own doc comment for why only that
 * source produces a DALOS-curve CodexPrime account an Arweave seed (always
 * 1600-bit DALOS) can be derived from.
 */
export async function kickstartAndInstallPrimeArweaveSeed(
  kickstartArgs: KickstartArgsV3,
  deps: KickstartAndInstallPrimeArweaveSeedDeps,
  onProgress?: (p: KeygenProgress) => void,
): Promise<KickstartAndInstallPrimeArweaveSeedResult> {
  if (kickstartArgs.codexPrimeSeed.source !== "fresh-dalos") {
    throw new Error(
      `kickstartAndInstallPrimeArweaveSeed requires codexPrimeSeed.source === "fresh-dalos" ` +
        `(the only kickstart source that produces a DALOS-curve CodexPrime account an Arweave ` +
        `seed can be derived from); got "${kickstartArgs.codexPrimeSeed.source}".`,
    );
  }
  const words = kickstartArgs.codexPrimeSeed.words;

  const kickstartResult = await deps.kickstart(kickstartArgs);

  const deriveBitstring = deps.deriveBitstring ?? bitStringOf;
  const bitstring = deriveBitstring(kickstartResult.codexPrime, words);
  if (bitstring === null) {
    throw new Error(
      "kickstartAndInstallPrimeArweaveSeed: could not re-derive the Prime Arweave seed's " +
        "bitstring from the freshly-kickstarted CodexPrime account.",
    );
  }

  const derive = deps.deriveArweaveSeedAtPositionZero ?? realDeriveArweaveSeedAtPositionZero;
  await derive({ bitstring, workerFactory: deps.workerFactory, onProgress });

  const secret = await deps.encryptSecret(bitstring);
  const wordsSecret = await deps.encryptSecret(words);

  await deps.addArweaveSeed({
    id: `arweave-seed-prime-${crypto.randomUUID()}`,
    name: PRIME_ARWEAVE_SEED_LABEL,
    secret,
    wordsSecret,
    createdAt: new Date().toISOString(),
    isPrime: true,
  });

  return { kickstartResult, bitstring };
}
