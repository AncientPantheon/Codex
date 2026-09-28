/**
 * Headless, snapshot-fed codex resolver factory (D4).
 *
 * This is the ONE canonical headless decrypt path for the codex substrate. It
 * reproduces the browser resolver's `InternalCodexResolver.getKeyPairByPublicKey`
 * algorithm (L124-212) — the pure-keypair path (incl. the 128-hex extended
 * branch), the derived-account path (incl. the `> 64` hex truncation), and the
 * secret-free not-found error — WITHOUT the browser coupling:
 *
 *   - It reads a plain data SNAPSHOT (`{ kadenaSeeds, pureKeypairs }`), never a
 *     live Zustand store.
 *   - It takes the password as a DIRECT argument, never a `passwordCache` gate.
 *     Dropping the `CodexLockedError` unlock ceremony is the point of D4 — the
 *     absolute-window unlock (D3's `isUnlocked`/`makePasswordCache`) is a CALLER
 *     concern, not the factory's.
 *
 * codex-core owns ONLY this state-to-keypair PLUMBING (which array to search,
 * the `length === 128` fork, the `> 64` truncation, the seedType tags, the
 * not-found error assembly). Every StoaChain crypto primitive is INJECTED through
 * `HeadlessResolverDeps` (the D3 injectable-seam discipline), so codex-core
 * imports no `@stoachain/*`, stays React-free and DOM-free. The consumer (D5)
 * binds the real `smartDecrypt` / `StoaChainWalletBuilder` / `kadenaDecrypt` /
 * `buildExtendedForeignSigningKey` / `toHexString` / `buildCodexPubSet` impls.
 */

import { CodexKeyMissingError } from "../codex/errors.js";

/**
 * Every seed label a codex can honestly carry on a StoaChain seed — the DATA
 * type. Kept in parity with codex-ouronet's `SeedType`
 * (`packages/codex-ouronet/src/types/entities.ts`) by a compile-time test
 * (`packages/codex-ouronet/tests/type-seedtype-parity.test.ts`), NOT by this
 * comment — a comment claiming "verbatim mirror" is not enforcement, and this
 * type drifted out of parity with `SeedType` once before ("stoic" was added
 * there and not here) with no build failure to catch it.
 *
 * Kept local (not imported from codex-ouronet) so codex-core imports no
 * Ouronet types — see this module's own doc comment.
 *
 * NOT every member here is derivable by THIS factory's mnemonic-only
 * `deriveStoaChainKeypair` seam — see `MnemonicSeedType` below for that
 * narrower, capability-scoped subset.
 */
export type StoaChainSeedType = "koala" | "chainweaver" | "eckowallet" | "stoic";

/**
 * The subset of `StoaChainSeedType` this factory can actually derive a key
 * from via the mnemonic-based `HeadlessResolverDeps.deriveStoaChainKeypair`
 * seam (bound to `StoaChainWalletBuilder.createWalletPairFromMnemonic`).
 * Mirrors `@stoachain/stoa-core/wallet`'s own `SeedType` verbatim (that
 * external type is unrelated to and independent of `StoaChainSeedType` above).
 *
 * `"stoic"` (Stoa Dalos) is deliberately EXCLUDED: a stoic seed's `secret`
 * decrypts to a 1600-bit DALOS bitstring, not a mnemonic, so feeding it to
 * this seam would derive the wrong key via the wrong algorithm. Stoic seeds
 * are resolved entirely outside this factory, before it ever runs — see the
 * skip-guard in `getKeyPairByPublicKey`'s derived-account loop below, and
 * `packages/codex-ouronet/src/resolver/headlessKadenaDeps.ts`'s
 * `resolveStoicKeypair` doc for the full reasoning.
 */
export type MnemonicSeedType = "koala" | "chainweaver" | "eckowallet";

/**
 * A pure (directly-imported) keypair entry. Minimal structural mirror of the
 * Ouronet `IPureKeypair` — only the fields the resolve algorithm reads.
 */
export interface PureKeypairLike {
  publicKey: string;
  /** Encrypted private key blob; decrypted via the injected `decryptSecret`. */
  encryptedPrivateKey: string;
}

/**
 * A derivable StoaChain seed. Minimal structural mirror of the Ouronet
 * `IStoaChainSeed` — the encrypted mnemonic `secret`, the `seedType` (passed
 * through to the derived keypair verbatim), and the recorded `accounts`.
 */
export interface StoaChainSeedLike {
  /** Encrypted mnemonic blob; decrypted via the injected `decryptSecret`. */
  secret: string;
  seedType: StoaChainSeedType;
  accounts: Array<{ publicKey: string; index: number }>;
}

/**
 * The minimal snapshot slice the resolver reads. A STRUCTURAL subset of the
 * codex state — NOT `CodexSnapshotBase` (whose StoaChain arrays are Ouronet-side).
 * A raw caller-fed snapshot can violate the array-present promise, so the
 * factory normalizes `?? []` at entry.
 */
export interface SnapshotSlice {
  kadenaSeeds: StoaChainSeedLike[];
  pureKeypairs: PureKeypairLike[];
}

/**
 * A signing-ready resolved keypair. Structurally identical to
 * `@stoachain/stoa-core/signing`'s `IStoaChainKeypair` (the byte-mirror is
 * deliberate — D5 asserts assignability at the binding site). `seedType` is
 * `MnemonicSeedType`, not the wider `StoaChainSeedType`: this factory only
 * ever RESOLVES a mnemonic-derived keypair (never drops the default `"koala"`)
 * — a `"stoic"` resolution is `resolveStoicKeypair`'s job entirely outside
 * this factory, returning its own distinct shape, never this one.
 * `encryptedSecretKey` is the opaque `@kadena/hd-wallet` EncryptedString
 * object (`unknown`), never a hex string.
 */
export interface ResolvedStoaChainKeypair {
  publicKey: string;
  privateKey: string;
  seedType?: MnemonicSeedType | "foreign";
  encryptedSecretKey?: unknown;
  password?: string;
}

/**
 * The injected StoaChain crypto/wallet seam. The caller (D5) binds the real
 * `@stoachain` primitives; codex-core holds none. Each function is the headless
 * analogue of one browser-resolver crypto touchpoint.
 */
export interface HeadlessResolverDeps {
  /** Binds `smartDecrypt` — decrypts BOTH `encryptedPrivateKey` and `seed.secret`. */
  decryptSecret(ciphertext: string, password: string): Promise<string>;
  /** Binds `StoaChainWalletBuilder.createWalletPairFromMnemonic`. `secretKey` is opaque.
   *  `seedType` is `MnemonicSeedType`, not `StoaChainSeedType` — this seam is
   *  mnemonic-only and must never be asked to derive a `"stoic"` key (see
   *  `MnemonicSeedType`'s doc comment). The derived-account loop below narrows
   *  to this type via its stoic skip-guard before calling this. */
  deriveStoaChainKeypair(
    password: string,
    mnemonic: string,
    index: number,
    seedType: MnemonicSeedType,
  ): Promise<{ publicKey: string; secretKey: unknown }>;
  /** Binds `kadenaDecrypt`. `encryptedSecretKey` is the opaque wallet secret. */
  decryptWalletSecret(password: string, encryptedSecretKey: unknown): Promise<Uint8Array>;
  /** Binds `buildExtendedForeignSigningKey` — the 128-hex extended-key repackage. */
  buildExtendedForeignKey(
    extendedPrivHex: string,
    publicKeyHex: string,
  ): Promise<{ encryptedSecretKey: unknown; password: string }>;
  /** Binds `toHexString`. The `> 64 → slice(0, 64)` truncation is the factory's plumbing. */
  toHex(bytes: Uint8Array): string;
  /** Binds `buildCodexPubSet(kadenaSeeds, [], pureKeypairs)` — cheap, no decryption. */
  collectCodexPubs(kadenaSeeds: StoaChainSeedLike[], pureKeypairs: PureKeypairLike[]): Set<string>;
}

/** The resolver surface the factory returns. */
export interface HeadlessCodexResolver {
  getKeyPairByPublicKey(
    snapshot: SnapshotSlice,
    publicKey: string,
    password: string,
  ): Promise<ResolvedStoaChainKeypair>;
  listCodexPubs(snapshot: SnapshotSlice): Set<string>;
}

/**
 * Build a headless codex resolver bound to the injected crypto seam. The
 * returned object resolves a pubkey to a signing-ready keypair (password-direct,
 * no unlock gate) and lists every codex pubkey (cheap, no decryption).
 */
export function createHeadlessCodexResolver(deps: HeadlessResolverDeps): HeadlessCodexResolver {
  async function getKeyPairByPublicKey(
    snapshot: SnapshotSlice,
    publicKey: string,
    password: string,
  ): Promise<ResolvedStoaChainKeypair> {
    // Normalize a caller-fed snapshot: a partial JSON snapshot can omit either
    // array, so a missing key must reach the structured not-found error rather
    // than a raw TypeError from `.find`/`for..of` on `undefined`.
    const pureKeypairs = snapshot.pureKeypairs ?? [];
    const kadenaSeeds = snapshot.kadenaSeeds ?? [];

    // 1. Pure-keypair lookup (foreign keys imported directly into the codex).
    //    Checked FIRST and returns early — the pure path WINS a pubkey collision
    //    (funds-critical: a mis-ordered branch would resolve the wrong key).
    const purePair = pureKeypairs.find((k) => k.publicKey === publicKey);
    if (purePair) {
      const privateKey = await deps.decryptSecret(purePair.encryptedPrivateKey, password);
      // 128-hex = BIP32-Ed25519 extended key (Chainweaver / kadenakeys.io format);
      // nacl cannot sign these, so route through the WASM extended-key signer by
      // repackaging into its expected encrypted-blob + password shape.
      if (privateKey.length === 128) {
        const { encryptedSecretKey, password: walletPw } = await deps.buildExtendedForeignKey(
          privateKey,
          publicKey,
        );
        return {
          publicKey,
          privateKey,
          seedType: "chainweaver",
          encryptedSecretKey,
          password: walletPw,
        };
      }
      return { publicKey, privateKey, seedType: "foreign" };
    }

    // 2. Derived-account lookup across all StoaChain seeds.
    for (const seed of kadenaSeeds) {
      // "stoic" (Stoa Dalos) seeds are NOT mnemonic-based — a real caller
      // resolves them via `resolveStoicKeypair` BEFORE this factory ever runs
      // (see packages/codex-ouronet/src/resolver/headlessKadenaDeps.ts). If one
      // reaches here anyway (corrupt state, a future direct caller, a
      // reordering bug upstream), skip it rather than feed a DALOS bitstring to
      // the mnemonic-only `deriveStoaChainKeypair` seam below — that would
      // silently derive the WRONG key via the wrong algorithm. Falling through
      // to the ordinary not-found error is the safe outcome. This line also
      // narrows `seed.seedType` from `StoaChainSeedType` to `MnemonicSeedType`
      // for the rest of the loop body, so the `deriveStoaChainKeypair` call
      // below type-checks with no cast.
      if (seed.seedType === "stoic") continue;

      const account = (seed.accounts ?? []).find((a) => a.publicKey === publicKey);
      if (!account) continue;

      const mnemonic = await deps.decryptSecret(seed.secret, password);
      const { publicKey: pub, secretKey: encryptedSecretKey } = await deps.deriveStoaChainKeypair(
        password,
        mnemonic,
        account.index,
        seed.seedType,
      );
      // Koala gives a 32-byte (64-hex) Ed25519 secret that nacl signs directly.
      // chainweaver/eckowallet extended keys are 96 bytes (192 hex) — truncate to
      // 64 as a fallback; their real signing routes through the WASM path using
      // `encryptedSecretKey` + `password`.
      const decryptedPk = await deps.decryptWalletSecret(password, encryptedSecretKey);
      let hexKey = deps.toHex(decryptedPk);
      if (hexKey.length > 64) hexKey = hexKey.slice(0, 64);

      return {
        publicKey: pub,
        privateKey: hexKey,
        seedType: seed.seedType,
        encryptedSecretKey,
        password,
      };
    }

    // 3. Not found — the secret-free structured diagnostic. Guard
    //    `seed.accounts ?? []` so a corrupt seed does not crash the reduce.
    const derivedAccountCount = kadenaSeeds.reduce(
      (sum, seed) => sum + (seed.accounts ?? []).length,
      0,
    );
    throw new CodexKeyMissingError(publicKey, pureKeypairs.length, derivedAccountCount);
  }

  function listCodexPubs(snapshot: SnapshotSlice): Set<string> {
    return deps.collectCodexPubs(snapshot.kadenaSeeds ?? [], snapshot.pureKeypairs ?? []);
  }

  return { getKeyPairByPublicKey, listCodexPubs };
}
