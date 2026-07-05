/**
 * InternalCodexResolver — the BROWSER wrapper around codex-core's canonical
 * headless decrypt path (`createHeadlessCodexResolver`).
 *
 * This is the "one canonical decrypt path" landing site (D5/D6): the actual
 * state-to-keypair PLUMBING (which array to search, the `length === 128`
 * extended-key fork, the `> 64` hex truncation, the seedType tags, the
 * not-found assembly) lives ONCE in codex-core's `createHeadlessCodexResolver`.
 * This file is now a THIN binding that:
 *
 *   1. injects the real `@stoachain` crypto primitives into core's
 *      `HeadlessResolverDeps` seam (`smartDecrypt`, `KadenaWalletBuilder`,
 *      `kadenaDecrypt`, the extended-key repackage, `toHexString`,
 *      `buildCodexPubSet`), and
 *   2. RE-ADDS the browser auth gate core deliberately dropped:
 *      `getKeyPairByPublicKey(publicKey)` takes NO password arg — it reads the
 *      store's `passwordCache` and throws `CodexLockedError` BEFORE any decrypt,
 *      then feeds the cached password + the store snapshot to the factory.
 *
 * Cryptography is delegated entirely to @stoachain/stoa-core/{crypto,wallet,
 * signing,guard} + @stoachain/kadena-stoic-legacy/hd-wallet. This file owns ONLY
 * the store-snapshot assembly + the auth gate + the fail-fast foreign-key path —
 * no key derivation or branch logic of its own (that is core's).
 *
 * Three methods (per the KeyResolver interface):
 *   1. listCodexPubs() — every pubkey the store can produce a private key for.
 *      Cheap (no decryption). Delegated to the factory's `listCodexPubs`.
 *   2. getKeyPairByPublicKey(pub) — resolve one pubkey to a signing-ready
 *      IKadenaKeypair. Auth-gated (throws CodexLockedError if the password cache
 *      is empty/expired), then delegates decrypt plumbing to the factory.
 *   3. requestForeignKey(pub) — optional modal-driven foreign-key path; stays
 *      resolver-side (a UI concern). Default: throw CodexKeyMissingError.
 */

import type { UseBoundStore, StoreApi } from "zustand";
import type { KeyResolver, IKadenaKeypair } from "@stoachain/stoa-core/signing";
import { toHexString } from "@stoachain/stoa-core/signing";
import { buildCodexPubSet } from "@stoachain/stoa-core/guard";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder } from "@stoachain/stoa-core/wallet";
import { kadenaDecrypt, kadenaEncrypt } from "@stoachain/kadena-stoic-legacy/hd-wallet";
import { legacyKadenaChangePassword } from "@stoachain/kadena-stoic-legacy/hd-wallet/chainweaver";
import { hexToBin } from "@stoachain/kadena-stoic-legacy/cryptography-utils";

import {
  createHeadlessCodexResolver,
  type HeadlessResolverDeps,
  type ResolvedKadenaKeypair,
  type KadenaSeedLike,
  type PureKeypairLike,
  type KadenaSeedType,
} from "@ancientpantheon/codex-core";

import type { CodexStoreState } from "../state/store.js";
import { CodexKeyMissingError, CodexLockedError } from "../errors/types.js";

type CodexStore = UseBoundStore<StoreApi<CodexStoreState>>;

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
async function buildExtendedForeignSigningKey(
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
 * per-store state — the store snapshot flows in per call, not through the seam.
 * This is the SINGLE place the real crypto is wired into the canonical factory.
 */
const REAL_STOA_DEPS: HeadlessResolverDeps = {
  decryptSecret: (ciphertext, password) => smartDecrypt(ciphertext, password),
  deriveKadenaKeypair: (password, mnemonic, index, seedType) =>
    KadenaWalletBuilder.createWalletPairFromMnemonic(
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

/** The one shared headless resolver bound to the real crypto seam. Every
 *  InternalCodexResolver instance delegates to this — the plumbing is stateless
 *  and the store snapshot is passed per call. */
const HEADLESS = createHeadlessCodexResolver(REAL_STOA_DEPS);

export interface InternalCodexResolverOptions {
  /**
   * Optional callback invoked when a transaction needs a key whose
   * pubkey isn't in the codex. The default (when omitted) is to throw
   * `CodexKeyMissingError` immediately — the fail-fast path documented
   * in `KeyResolver.requestForeignKey`'s contract.
   *
   * <CodexProvider> wires this to a modal-driven foreign-key callback.
   */
  requestForeignKey?: (publicKey: string) => Promise<string>;
}

export class InternalCodexResolver implements KeyResolver {
  constructor(
    private readonly store: CodexStore,
    private readonly options: InternalCodexResolverOptions = {}
  ) {}

  listCodexPubs(): Set<string> {
    const s = this.store.getState();
    return HEADLESS.listCodexPubs({
      kadenaSeeds: s.kadenaSeeds as unknown as KadenaSeedLike[],
      pureKeypairs: s.pureKeypairs as unknown as PureKeypairLike[],
    });
  }

  async getKeyPairByPublicKey(publicKey: string): Promise<IKadenaKeypair> {
    const state = this.store.getState();

    // Auth gate — the browser wrapper re-adds the unlock ceremony core drops.
    // Every key resolution needs the cached password; a locked/expired codex
    // throws BEFORE any decrypt reaches the factory.
    const cache = state.passwordCache;
    if (!cache || cache.expiresAt <= Date.now()) {
      throw new CodexLockedError("getKeyPairByPublicKey");
    }
    const password = cache.value;

    // Delegate the decrypt PLUMBING to the canonical headless factory, feeding
    // it the store snapshot slice + the cached password. The `> 64` truncation,
    // the `length === 128` extended-key fork, and the seedType tags all live in
    // core now — this file no longer duplicates them.
    const snapshot = {
      kadenaSeeds: state.kadenaSeeds as unknown as KadenaSeedLike[],
      pureKeypairs: state.pureKeypairs as unknown as PureKeypairLike[],
    };

    let resolved: ResolvedKadenaKeypair;
    try {
      resolved = await HEADLESS.getKeyPairByPublicKey(
        snapshot,
        publicKey,
        password,
      );
    } catch (e) {
      // The factory throws codex-core's own CodexKeyMissingError. Re-throw as the
      // Ouronet-side class so consumers catching `@ancientpantheon/codex-ouronet/
      // errors`'s CodexKeyMissingError (the browser diagnostic surface) still
      // `instanceof`-match — preserving the structured counts verbatim.
      if (isCoreKeyMissing(e)) {
        throw new CodexKeyMissingError(
          e.publicKey,
          e.pureKeypairCount,
          e.derivedAccountCount,
        );
      }
      throw e;
    }

    // Compile-time assignability proof (D4 note item 3 / D5 obligation): the
    // factory's local structural `ResolvedKadenaKeypair` must be assignable to
    // the real `@stoachain` `IKadenaKeypair` with no cast. If either shape drifts
    // (a truncated seedType union, a string-coerced encryptedSecretKey) this line
    // fails `tsc` — catching a byte-stability break before it reaches the signer.
    const asContract: IKadenaKeypair = resolved;
    return asContract;
  }

  async requestForeignKey(publicKey: string): Promise<string> {
    if (!this.options.requestForeignKey) {
      // Fail-fast path (per the KeyResolver JSDoc): with no callback wired, a
      // foreign-key need throws a precise pre-flight error before any I/O rather
      // than silently hanging. The class shape forces us to implement the method,
      // so we keep it but throw — same observable outcome as an absent method.
      const s = this.store.getState();
      const derivedCount = s.kadenaSeeds.reduce(
        (sum, x) => sum + x.accounts.length,
        0
      );
      throw new CodexKeyMissingError(
        publicKey,
        s.pureKeypairs.length,
        derivedCount
      );
    }
    return this.options.requestForeignKey(publicKey);
  }
}

/** Structural type-guard for codex-core's CodexKeyMissingError (matched by the
 *  structured field shape, not `instanceof` — the two packages have distinct
 *  error classes and the factory throws core's). */
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

// Retain the exported binding-site type so downstream tooling / tests can
// reference the seed-type union the factory consumes without re-declaring it.
export type { KadenaSeedType };
