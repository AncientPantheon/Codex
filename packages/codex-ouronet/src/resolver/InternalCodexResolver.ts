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
 *      `HeadlessResolverDeps` seam (`smartDecrypt`, `StoaChainWalletBuilder`,
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
 *      IStoaChainKeypair. Auth-gated (throws CodexLockedError if the password cache
 *      is empty/expired), then delegates decrypt plumbing to the factory.
 *   3. requestForeignKey(pub) — optional modal-driven foreign-key path; stays
 *      resolver-side (a UI concern). Default: throw CodexKeyMissingError.
 */

import type { UseBoundStore, StoreApi } from "zustand";
import type { KeyResolver, IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";

import {
  type ResolvedStoaChainKeypair,
  type StoaChainSeedLike,
  type PureKeypairLike,
  type StoaChainSeedType,
} from "@ancientpantheon/codex-core";

import type { CodexStoreState } from "../state/store.js";
import { CodexKeyMissingError, CodexLockedError } from "../errors/types.js";
import { HEADLESS, remapCoreKeyMissing } from "./headlessKadenaDeps.js";

type CodexStore = UseBoundStore<StoreApi<CodexStoreState>>;

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
      kadenaSeeds: s.kadenaSeeds as unknown as StoaChainSeedLike[],
      pureKeypairs: s.pureKeypairs as unknown as PureKeypairLike[],
    });
  }

  async getKeyPairByPublicKey(publicKey: string): Promise<IStoaChainKeypair> {
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
      kadenaSeeds: state.kadenaSeeds as unknown as StoaChainSeedLike[],
      pureKeypairs: state.pureKeypairs as unknown as PureKeypairLike[],
    };

    let resolved: ResolvedStoaChainKeypair;
    try {
      resolved = await HEADLESS.getKeyPairByPublicKey(
        snapshot,
        publicKey,
        password,
      );
    } catch (e) {
      // The factory throws codex-core's own CodexKeyMissingError. `remapCoreKeyMissing`
      // re-throws it as the Ouronet-side class so consumers catching
      // `@ancientpantheon/codex-ouronet/errors`'s CodexKeyMissingError (the browser
      // diagnostic surface) still `instanceof`-match — structured counts verbatim.
      // Any other error passes through unchanged.
      remapCoreKeyMissing(e);
    }

    // Compile-time assignability proof (D4 note item 3 / D5 obligation): the
    // factory's local structural `ResolvedStoaChainKeypair` must be assignable to
    // the real `@stoachain` `IStoaChainKeypair` with no cast. If either shape drifts
    // (a truncated seedType union, a string-coerced encryptedSecretKey) this line
    // fails `tsc` — catching a byte-stability break before it reaches the signer.
    const asContract: IStoaChainKeypair = resolved;
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

// Retain the exported binding-site type so downstream tooling / tests can
// reference the seed-type union the factory consumes without re-declaring it.
export type { StoaChainSeedType };
