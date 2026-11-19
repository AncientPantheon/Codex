/**
 * Stoa Dalos keygen — direct binding of `@ouronet/dalos-crypto`'s "Stoic path"
 * (internal `SeedType` literal `"stoic"`, user-facing label "Stoa Dalos").
 *
 * A Stoa Dalos seed reuses the SAME 1600-bit DALOS bitstring pipeline that
 * produces a codex's Ѻ./Σ. Ouronet address, but derives a completely
 * independent, real, spendable Chainweb `k:` account from it via
 * `@ouronet/dalos-crypto/chainweb`'s `generateFromBitStringAtIndex` — a
 * deterministic Ed25519 keygen, NOT a BIP39/Chainweaver mnemonic.
 *
 * `@stoachain/stoa-core`'s `KadenaWalletBuilder` does not (yet) have an
 * equivalent method published — but unlike that gap, THIS package already
 * depends on `@ouronet/dalos-crypto` directly (bumped to ^4.5.1, the first
 * version shipping the `./chainweb` subpath), so there is nothing "temporary"
 * or bridged about this module: `generateFromBitStringAtIndex` is a real,
 * already-published function this package calls directly. Never route the
 * "stoic" seed type through `StoaChainWalletBuilder` — only koala/chainweaver/
 * eckowallet use that.
 *
 * Both the browser resolver (`InternalCodexResolver.ts` via
 * `headlessKadenaDeps.ts`) and the UI (`CreateStoaChainSeedModal.tsx`,
 * `SeedWordsTab.tsx`) share this ONE derivation entry point so a stoic key's
 * public/private hex never drifts between preview, persistence, and signing.
 */

import { generateFromBitStringAtIndex } from "@ouronet/dalos-crypto/chainweb";
import { binToHex } from "@stoachain/kadena-stoic-legacy/cryptography-utils";
import {
  validateSeedWords,
  seedWordsToBitString,
  InvalidSeedWordsError,
  MIN_SEED_WORDS,
  MAX_SEED_WORDS,
  MIN_SEED_WORD_GLYPHS,
  MAX_SEED_WORD_GLYPHS,
} from "@ouronet/dalos-crypto/gen1";

/** Re-exported so UI callers show the real limits without a second import
 *  path — see `validateTypedSeedWords` below for the gate itself. */
export { MIN_SEED_WORDS, MAX_SEED_WORDS, MIN_SEED_WORD_GLYPHS, MAX_SEED_WORD_GLYPHS };

/** A Stoa Dalos ("stoic") Chainweb keypair — a plain 32-byte Ed25519 seed,
 *  nacl-signable directly (structurally like koala's decrypted key), NOT the
 *  `@kadena/hd-wallet`-encrypted extended-key blob the mnemonic-based seed
 *  types (koala/chainweaver/eckowallet) produce. `publicKey`/`privateKey` are
 *  lowercase hex, matching this package's existing keypair convention. */
export interface StoaDalosKeypair {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly address: string;
}

/** A DALOS bitstring is binary digits and nothing else — mirrors
 *  codex-arweave's own `resolveSeedBitString.ts` shape test, the
 *  established convention in this codebase for telling a pre-converted
 *  bitstring apart from raw seed words. */
const DALOS_BIT_STRING_RE = /^[01]+$/;

/**
 * Normalize a `"stoic"` seed's decrypted `secret` to the 1600-bit DALOS
 * bitstring `generateFromBitStringAtIndex` requires.
 *
 * It SHOULD always already be that bitstring — `CreateStoaChainSeedModal.tsx`
 * always runs typed/reused words through `seedWordsToBitString` BEFORE
 * encrypting, per this module's own `secret: await encryptStringV2(bitString,
 * password)` convention. But real legacy data exists where `secret` decrypts
 * straight to the space-separated words instead, predating that
 * pre-conversion convention or imported through a path that skipped it
 * (confirmed live against a real codex — `docs/work/debug/
 * two-real-codex-bugs.md`, bug 2a: `deriveStoaDalosKeypairAtIndex` fed raw
 * words crashed, both in `SeedWordsTab.tsx`'s key reveal and in
 * `resolveStoicKeypair`'s signing path — the exact seam `RotatePaymentKeyModal`/
 * `RotateGuardModal` resolve a stoic seed's signing key through). Detecting
 * the shape and converting defensively — rather than assuming every stoic
 * seed was created after the convention existed — fixes both call paths at
 * their one shared entry point instead of patching each site separately.
 */
function toDalosBitString(decryptedSecret: string): string {
  const trimmed = decryptedSecret.trim();
  if (DALOS_BIT_STRING_RE.test(trimmed)) return trimmed;
  // Not bitstring-shaped — treat as space-separated DALOS seed words, the
  // only other shape a stoic seed's `secret` is ever created from
  // (`CreateStoaChainSeedModal.tsx`'s own "new"/"existing" sub-modes, and
  // this legacy case). `validateSeedWords` first so a malformed value
  // surfaces the library's own word-naming message rather than whatever
  // `seedWordsToBitString` throws internally.
  const words = trimmed.split(/\s+/).filter(Boolean);
  validateSeedWords(words);
  return seedWordsToBitString(words);
}

/**
 * Derive Chainweb account `#index` from a DALOS 1600-bit seed bitstring —
 * the "Stoic path" / "Stoa Dalos" seed type. Pure + synchronous, no
 * password/encryption at this layer (the caller encrypts/decrypts the
 * bitstring itself via `encryptStringV2`/`smartDecrypt`, same as every other
 * seed type's mnemonic).
 *
 * Accepts the decrypted secret in EITHER shape it may legitimately be found
 * in (bitstring, or raw legacy words) — see `toDalosBitString` above.
 */
export function deriveStoaDalosKeypairAtIndex(bitString: string, index: number): StoaDalosKeypair {
  const normalized = toDalosBitString(bitString);
  const { publicKey, privateKey, address } = generateFromBitStringAtIndex(normalized, index);
  return {
    publicKey: binToHex(publicKey),
    privateKey: binToHex(privateKey),
    address,
  };
}

/**
 * Returns `null` when `words` is a valid DALOS seed-word list (1-256 words,
 * each 1-256 glyphs from the 256-glyph DALOS character set), or a human-
 * readable reason string otherwise. Thin adapter over `@ouronet/dalos-crypto/
 * gen1`'s own canonical `validateSeedWords` (which the installed 4.5.1
 * already exports publicly, together with the four limit constants) — no
 * local reimplementation of the validation rules.
 */
export function validateTypedSeedWords(words: readonly string[]): string | null {
  try {
    validateSeedWords(words);
    return null;
  } catch (e) {
    if (e instanceof InvalidSeedWordsError) return e.message;
    return e instanceof Error ? e.message : "Invalid seed words.";
  }
}
