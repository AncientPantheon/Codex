/**
 * headlessKadenaDeps — the ONE real `@stoachain` binding of codex-core's
 * `HeadlessResolverDeps` seam, plus the shared bound `HEADLESS` resolver and the
 * core→ouronet key-missing remap.
 *
 * This module is the single place the real crypto is wired into codex-core's
 * canonical `createHeadlessCodexResolver` factory. It was extracted verbatim from
 * `InternalCodexResolver.ts` (which now imports from here) so BOTH the browser
 * resolver and the headless `createHeadlessKadenaResolver` share ONE derivation
 * path — the whole point of the Khronoton delegation handoff
 * (`HANDOFF-codex-headless-kadena-resolver.md`): no consumer, and no sibling
 * resolver, ever reimplements seed derivation.
 *
 * SERVER-SAFE: every runtime import here is `@stoachain/*` or codex-core — no
 * React, no DOM, no zustand. It is safe to pull into a headless Node automaton
 * through the `/ouronet` subpath (the browser-only store/auth wiring stays in
 * `InternalCodexResolver.ts`).
 */

import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";
import { toHexString } from "@stoachain/stoa-core/signing";
import { buildCodexPubSet } from "@stoachain/stoa-core/guard";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import { kadenaDecrypt, kadenaEncrypt } from "@stoachain/kadena-stoic-legacy/hd-wallet";
import { legacyKadenaChangePassword } from "@stoachain/kadena-stoic-legacy/hd-wallet/chainweaver";
import { hexToBin } from "@stoachain/kadena-stoic-legacy/cryptography-utils";

import {
  createHeadlessCodexResolver,
  type HeadlessResolverDeps,
  type HeadlessCodexResolver,
} from "@ancientpantheon/codex-core";

import { CodexKeyMissingError } from "../errors/types.js";

/** Non-empty transient password used to re-scramble a reconstructed extended
 *  key before handing it to the WASM signer. The value is arbitrary — it only
 *  has to be (a) non-empty, because `universalSignTransaction` gates the
 *  Chainweaver path on a truthy `password`, and (b) identical between the
 *  re-scramble and the eventual `kadenaSign` call (it is, because we return it
 *  as the keypair's `password`). It never persists and never affects the key. */
const EXTENDED_FOREIGN_SCRAMBLE_PW = "codex-extended-foreign";

/**
 * Repackage a bare 128-hex BIP32-Ed25519 extended private key (`kL‖kR`, the
 * Chainweaver / kadenakeys.io export format) into the encrypted-blob + password
 * shape the WASM extended-key signer consumes — WITHOUT rolling any custom
 * BIP32 math (the hd-wallet library owns the extended-key format).
 *
 * The library's signer takes a 128-byte buffer `[kL‖kR | pubKey | chainCode]`
 * whose first 64 bytes are XOR-scrambled against a wallet password, plus that
 * same password. So we:
 *   1. Lay out a plaintext buffer `[kL‖kR | pubKey | 0…0]`. The chainCode is
 *      unused for signing (it only matters for *child* derivation) → zero-fill.
 *   2. Re-scramble bytes 0‥64 from the empty password to a non-empty one via
 *      `kadenaChangePassword` (the library's own re-key primitive).
 *   3. AES-wrap the result with the same non-empty password.
 * `universalSignTransaction` then decrypts with that password and the WASM
 * un-scrambles the scalar back to plaintext before signing — producing a
 * signature byte-identical to the genuine seed-derived path.
 */
export async function buildExtendedForeignSigningKey(
  extendedPrivHex: string,
  publicKeyHex: string,
): Promise<{ encryptedSecretKey: unknown; password: string }> {
  const xprv = new Uint8Array(128);
  xprv.set(hexToBin(extendedPrivHex), 0); // kL‖kR (64 bytes, plaintext)
  xprv.set(hexToBin(publicKeyHex), 64); //    pubKey (32 bytes)
  // bytes 96‥128 (chainCode) intentionally left zero — unused for signing.
  const scrambled = new Uint8Array(
    await legacyKadenaChangePassword(xprv, "", EXTENDED_FOREIGN_SCRAMBLE_PW),
  );
  const encryptedSecretKey = await kadenaEncrypt(
    EXTENDED_FOREIGN_SCRAMBLE_PW,
    scrambled,
  );
  return { encryptedSecretKey, password: EXTENDED_FOREIGN_SCRAMBLE_PW };
}

/**
 * The real `@stoachain` binding of core's `HeadlessResolverDeps` seam. Module-
 * level (not per-instance) because the primitives are pure functions with no
 * per-store state — the snapshot flows in per call, not through the seam. This
 * is the SINGLE place the real crypto is wired into the canonical factory.
 */
export const REAL_STOA_DEPS: HeadlessResolverDeps = {
  decryptSecret: (ciphertext, password) => smartDecrypt(ciphertext, password),
  deriveStoaChainKeypair: (password, mnemonic, index, seedType) =>
    StoaChainWalletBuilder.createWalletPairFromMnemonic(
      password,
      mnemonic,
      index,
      seedType,
    ),
  decryptWalletSecret: (password, encryptedSecretKey) =>
    kadenaDecrypt(password, encryptedSecretKey as never),
  buildExtendedForeignKey: (extendedPrivHex, publicKeyHex) =>
    buildExtendedForeignSigningKey(extendedPrivHex, publicKeyHex),
  toHex: (bytes) => toHexString(bytes),
  collectCodexPubs: (kadenaSeeds, pureKeypairs) =>
    buildCodexPubSet(kadenaSeeds as never, [], pureKeypairs as never),
};

/**
 * The one shared headless resolver bound to the real crypto seam. Both the
 * browser `InternalCodexResolver` and the headless `createHeadlessKadenaResolver`
 * delegate to this — the plumbing is stateless and the snapshot is passed per
 * call, so a single shared instance is correct and cheapest.
 */
export const HEADLESS: HeadlessCodexResolver = createHeadlessCodexResolver(REAL_STOA_DEPS);

export { EXTENDED_FOREIGN_SCRAMBLE_PW };

/**
 * Structural type-guard for codex-core's `CodexKeyMissingError` (matched by the
 * structured field shape, not `instanceof` — the two packages have distinct error
 * classes and the factory throws core's).
 */
function isCoreKeyMissing(
  e: unknown,
): e is { publicKey: string; pureKeypairCount: number; derivedAccountCount: number } {
  return (
    e instanceof Error &&
    e.name === "CodexKeyMissingError" &&
    typeof (e as { publicKey?: unknown }).publicKey === "string" &&
    typeof (e as { pureKeypairCount?: unknown }).pureKeypairCount === "number" &&
    typeof (e as { derivedAccountCount?: unknown }).derivedAccountCount === "number"
  );
}

/**
 * Re-throw codex-core's `CodexKeyMissingError` as the ouronet-side class so a
 * consumer catching `@ancientpantheon/codex-ouronet/errors`'s `CodexKeyMissingError`
 * still `instanceof`-matches — preserving the structured counts verbatim. Any
 * other error passes through unchanged.
 */
export function remapCoreKeyMissing(e: unknown): never {
  if (isCoreKeyMissing(e)) {
    throw new CodexKeyMissingError(e.publicKey, e.pureKeypairCount, e.derivedAccountCount);
  }
  throw e;
}

/** Re-export the contract type so binding sites don't reach for a second import path. */
export type { IStoaChainKeypair };
