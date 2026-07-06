/**
 * RED contract tests for the snapshot-fed headless resolver factory (D4).
 *
 * codex-core owns the state-to-keypair PLUMBING, never the StoaChain crypto. The
 * real primitives (`smartDecrypt`, `StoaChainWalletBuilder.createWalletPairFromMnemonic`,
 * `kadenaDecrypt`, `buildExtendedForeignSigningKey`, `toHexString`, `buildCodexPubSet`)
 * are INJECTED by the consumer (D5) as `HeadlessResolverDeps` — core stays
 * `@stoachain`-free, React-free, DOM-free (D7/N-08). The factory reproduces the
 * browser resolver's algorithm (`InternalCodexResolver.getKeyPairByPublicKey`
 * L124-212 + `buildExtendedForeignSigningKey` L77-93 + `listCodexPubs` L116-122)
 * WITHOUT its Zustand/passwordCache coupling: the snapshot is a plain data slice
 * and the password is a DIRECT argument (the "no password-cache gate" deliverable).
 *
 * These deterministic fakes PROVE the seam-injection discipline (mirroring the
 * Phase-7 vault fake-`CryptoSeam` test): every branch is driven WITHOUT real
 * crypto, so the assertions pin the factory's OWN branching (which array, the
 * `length === 128` extended branch, the `> 64` truncation, branch precedence,
 * the secret-free not-found error) — the load-bearing, funds-critical decisions.
 *
 * RED: the resolver subpath barrel `../src/resolver` does not exist yet (no
 * `src/resolver/` on disk; `CodexKeyMissingError` not yet in `src/codex/errors`),
 * so this whole file fails to import until T8.3's GREEN lands it.
 *
 * ASYNC DISCIPLINE (stack F-002): `getKeyPairByPublicKey` returns a Promise
 * because every injected seam fn is async — every resolution assertion `await`s,
 * and the not-found path uses `rejects.toBeInstanceOf`, never the synchronous
 * `.toThrow()` (a pending Promise is truthy → green-on-broken). `listCodexPubs`
 * is synchronous.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createHeadlessCodexResolver,
  type HeadlessResolverDeps,
  type ResolvedStoaChainKeypair,
  type SnapshotSlice,
  type StoaChainSeedLike,
  type PureKeypairLike,
} from "../src/resolver/index.js";
import { CodexError, CodexKeyMissingError } from "../src/codex/errors.js";

// ---------------------------------------------------------------------------
// High-entropy sentinels (stack F-003): long, unique, random tokens so the
// secret-hygiene `not.toContain(...)` guards on the not-found path are a
// MEANINGFUL guarantee. A short password like "pw" can coincidentally
// substring-match an unrelated message → a false PASS masking a real leak.
// ---------------------------------------------------------------------------
const PASSWORD = "pw-9f3a7c1e5b8d0246a1c3e5f7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7";
const MNEMONIC_SENTINEL =
  "mnemonic-a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";
const DECRYPTED_PLAIN_64 =
  "aa11bb22cc33dd44ee55ff66007788990011223344556677889900aabbccddee"; // 64 hex
const DECRYPTED_EXTENDED_128 =
  "cc33dd44ee55ff66007788990011223344556677889900aabbccddeeff112233" +
  "44556677889900aabbccddeeff00112233445566778899aabbccddeeff001122"; // 128 hex

// An opaque `@kadena/hd-wallet` EncryptedString stand-in. F-BUG-002: this is
// `unknown` — NEVER a hex string — carried through verbatim. Using a
// non-string object here proves the factory never string-coerces it.
const OPAQUE_ENCRYPTED_SECRET = { __encryptedString: "opaque-wallet-secret-object" };
const OPAQUE_EXTENDED_SECRET = { __encryptedString: "opaque-extended-secret-object" };
const EXTENDED_SCRAMBLE_PW = "codex-extended-foreign";

// Derived-path fakes: a 192-hex `toHex` output exercises the `> 64 → slice(0,64)`
// truncation explicitly. The first 64 chars are the expected privateKey.
const DERIVED_HEX_192 =
  "1111111111111111111111111111111111111111111111111111111111111111" +
  "2222222222222222222222222222222222222222222222222222222222222222" +
  "3333333333333333333333333333333333333333333333333333333333333333"; // 192 hex
const DERIVED_HEX_192_TRUNCATED = DERIVED_HEX_192.slice(0, 64);
const DERIVED_PUB = "derived-pub-koala-account-0";

// ---------------------------------------------------------------------------
// Deterministic fake seam. Each fn is a spy so we can assert WHICH decrypt
// path ran (branch precedence, funds-critical). Ciphertext→plaintext is a
// keyed map so `decryptSecret` is a pure lookup, not real crypto.
// ---------------------------------------------------------------------------
function makeFakeDeps(overrides: Partial<HeadlessResolverDeps> = {}): HeadlessResolverDeps {
  const decryptSecret = vi.fn(async (ciphertext: string, password: string): Promise<string> => {
    if (password !== PASSWORD) throw new Error("fake-seam: wrong password");
    switch (ciphertext) {
      case "enc-plain-foreign":
        return DECRYPTED_PLAIN_64;
      case "enc-extended-128":
        return DECRYPTED_EXTENDED_128;
      case "enc-seed-secret":
        return MNEMONIC_SENTINEL;
      default:
        throw new Error(`fake-seam: unknown ciphertext ${ciphertext}`);
    }
  });

  const deriveStoaChainKeypair = vi.fn(
    async (
      _password: string,
      _mnemonic: string,
      _index: number,
      _seedType: string
    ): Promise<{ publicKey: string; secretKey: unknown }> => {
      // Echo the derivation deterministically; secretKey is the opaque object.
      return { publicKey: DERIVED_PUB, secretKey: OPAQUE_ENCRYPTED_SECRET };
    }
  );

  const decryptWalletSecret = vi.fn(
    async (_password: string, _encryptedSecretKey: unknown): Promise<Uint8Array> => {
      // Content is irrelevant — `toHex` is what produces the asserted hex.
      return new Uint8Array([1, 2, 3, 4]);
    }
  );

  const buildExtendedForeignKey = vi.fn(
    async (
      _extendedPrivHex: string,
      _publicKeyHex: string
    ): Promise<{ encryptedSecretKey: unknown; password: string }> => {
      return { encryptedSecretKey: OPAQUE_EXTENDED_SECRET, password: EXTENDED_SCRAMBLE_PW };
    }
  );

  const toHex = vi.fn((_bytes: Uint8Array): string => DERIVED_HEX_192);

  const collectCodexPubs = vi.fn(
    (kadenaSeeds: StoaChainSeedLike[], pureKeypairs: PureKeypairLike[]): Set<string> => {
      const set = new Set<string>();
      for (const p of pureKeypairs) set.add(p.publicKey);
      for (const s of kadenaSeeds) for (const a of s.accounts ?? []) set.add(a.publicKey);
      return set;
    }
  );

  return {
    decryptSecret,
    deriveStoaChainKeypair,
    decryptWalletSecret,
    buildExtendedForeignKey,
    toHex,
    collectCodexPubs,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Snapshot fixtures.
// ---------------------------------------------------------------------------
const PURE_FOREIGN: PureKeypairLike = {
  publicKey: "pub-pure-foreign",
  encryptedPrivateKey: "enc-plain-foreign",
};
const PURE_EXTENDED: PureKeypairLike = {
  publicKey: "pub-pure-extended",
  encryptedPrivateKey: "enc-extended-128",
};
const KOALA_SEED: StoaChainSeedLike = {
  secret: "enc-seed-secret",
  seedType: "koala",
  accounts: [{ publicKey: DERIVED_PUB, index: 0 }],
};

function snapshot(over: Partial<SnapshotSlice> = {}): SnapshotSlice {
  return {
    kadenaSeeds: over.kadenaSeeds ?? [],
    pureKeypairs: over.pureKeypairs ?? [],
  };
}

describe("createHeadlessCodexResolver — factory shape + no password-cache gate", () => {
  it("returns an object exposing getKeyPairByPublicKey and listCodexPubs", () => {
    const resolver = createHeadlessCodexResolver(makeFakeDeps());
    expect(typeof resolver.getKeyPairByPublicKey).toBe("function");
    expect(typeof resolver.listCodexPubs).toBe("function");
  });

  it("resolves with a correct password + present key WITHOUT any unlock ceremony (no CodexLockedError, no Date.now gate)", async () => {
    const now = vi.spyOn(Date, "now");
    const resolver = createHeadlessCodexResolver(makeFakeDeps());

    const result = await resolver.getKeyPairByPublicKey(
      snapshot({ pureKeypairs: [PURE_FOREIGN] }),
      PURE_FOREIGN.publicKey,
      PASSWORD
    );

    // Password is a DIRECT arg — a fresh call succeeds with no passwordCache /
    // expiresAt / isUnlocked check, and the factory never consults the clock.
    expect(result.publicKey).toBe(PURE_FOREIGN.publicKey);
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
});

describe("getKeyPairByPublicKey — PURE-KEYPAIR path (InternalCodexResolver L134-161)", () => {
  it("plain-foreign branch: 64-hex decrypt returns {publicKey, privateKey, seedType:'foreign'} with NO encryptedSecretKey/password", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);

    const result = await resolver.getKeyPairByPublicKey(
      snapshot({ pureKeypairs: [PURE_FOREIGN] }),
      PURE_FOREIGN.publicKey,
      PASSWORD
    );

    expect(deps.decryptSecret).toHaveBeenCalledWith(PURE_FOREIGN.encryptedPrivateKey, PASSWORD);
    // A 64-hex privateKey is a plain foreign key: tagged "foreign", carries
    // neither encryptedSecretKey nor password (nacl signs it directly).
    expect(result).toEqual({
      publicKey: PURE_FOREIGN.publicKey,
      privateKey: DECRYPTED_PLAIN_64,
      seedType: "foreign",
    });
    expect(result).not.toHaveProperty("encryptedSecretKey");
    expect(result).not.toHaveProperty("password");
    // The plain-foreign branch never repackages an extended key.
    expect(deps.buildExtendedForeignKey).not.toHaveBeenCalled();
  });

  it("extended branch: a 128-hex decrypt routes through buildExtendedForeignKey → seedType 'chainweaver' carrying the opaque encryptedSecretKey + scramble password", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);

    const result = await resolver.getKeyPairByPublicKey(
      snapshot({ pureKeypairs: [PURE_EXTENDED] }),
      PURE_EXTENDED.publicKey,
      PASSWORD
    );

    // length === 128 is the load-bearing decision: it MUST call the repackager
    // with (decryptedPrivateKey, publicKey) and tag the result "chainweaver".
    expect(deps.buildExtendedForeignKey).toHaveBeenCalledWith(
      DECRYPTED_EXTENDED_128,
      PURE_EXTENDED.publicKey
    );
    expect(result).toEqual({
      publicKey: PURE_EXTENDED.publicKey,
      privateKey: DECRYPTED_EXTENDED_128,
      seedType: "chainweaver",
      encryptedSecretKey: OPAQUE_EXTENDED_SECRET,
      password: EXTENDED_SCRAMBLE_PW,
    });
    // F-BUG-002: encryptedSecretKey is the opaque object, never string-coerced.
    expect(typeof result.encryptedSecretKey).not.toBe("string");
  });
});

describe("getKeyPairByPublicKey — DERIVED-ACCOUNT path (InternalCodexResolver L163-198)", () => {
  it("derives via decryptSecret(seed.secret)→deriveStoaChainKeypair→decryptWalletSecret→toHex, truncating hexKey.length>64 to slice(0,64), passing seed.seedType through verbatim", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);

    const result = await resolver.getKeyPairByPublicKey(
      snapshot({ kadenaSeeds: [KOALA_SEED] }),
      DERIVED_PUB,
      PASSWORD
    );

    // The derived pipeline: decrypt the mnemonic, derive at the recorded index
    // with the seed's own seedType, decrypt the wallet secret, hex-stringify.
    expect(deps.decryptSecret).toHaveBeenCalledWith(KOALA_SEED.secret, PASSWORD);
    expect(deps.deriveStoaChainKeypair).toHaveBeenCalledWith(
      PASSWORD,
      MNEMONIC_SENTINEL,
      0,
      "koala"
    );
    expect(deps.decryptWalletSecret).toHaveBeenCalledWith(PASSWORD, OPAQUE_ENCRYPTED_SECRET);

    // F-BUG-001: seedType passes through as "koala" (the DEFAULT type) — this
    // TYPECHECKS against ResolvedStoaChainKeypair only if the local union keeps
    // "koala"/"eckowallet" (not a truncated "foreign"|"chainweaver" subset).
    const expected: ResolvedStoaChainKeypair = {
      publicKey: DERIVED_PUB,
      // hexKey.length (192) > 64 → truncated to the first 64 chars.
      privateKey: DERIVED_HEX_192_TRUNCATED,
      seedType: "koala",
      encryptedSecretKey: OPAQUE_ENCRYPTED_SECRET,
      password: PASSWORD,
    };
    expect(result).toEqual(expected);
    expect(result.privateKey).toHaveLength(64);
  });

  it("does NOT truncate a hexKey that is exactly 64 chars (only >64 truncates)", async () => {
    const deps = makeFakeDeps({
      toHex: vi.fn((_bytes: Uint8Array): string => DECRYPTED_PLAIN_64), // 64 hex
    });
    const resolver = createHeadlessCodexResolver(deps);

    const result = await resolver.getKeyPairByPublicKey(
      snapshot({ kadenaSeeds: [KOALA_SEED] }),
      DERIVED_PUB,
      PASSWORD
    );

    expect(result.privateKey).toBe(DECRYPTED_PLAIN_64);
    expect(result.privateKey).toHaveLength(64);
  });
});

describe("getKeyPairByPublicKey — BRANCH PRECEDENCE (funds-critical, L135-164 early-return)", () => {
  it("pure-keypair path WINS when the same pub is in BOTH pureKeypairs and a seed account (derived path never runs)", async () => {
    const deps = makeFakeDeps();
    // Same pubkey present as a pure keypair AND as a derived account.
    const collidingPub = "pub-collision";
    const purePair: PureKeypairLike = {
      publicKey: collidingPub,
      encryptedPrivateKey: "enc-plain-foreign",
    };
    const seedWithColliding: StoaChainSeedLike = {
      secret: "enc-seed-secret",
      seedType: "koala",
      accounts: [{ publicKey: collidingPub, index: 0 }],
    };
    const resolver = createHeadlessCodexResolver(deps);

    const result = await resolver.getKeyPairByPublicKey(
      snapshot({ pureKeypairs: [purePair], kadenaSeeds: [seedWithColliding] }),
      collidingPub,
      PASSWORD
    );

    // Pure path is checked first and returns early: result is "foreign", and
    // the seed-derivation seam was NEVER touched. A mis-ordered branch would
    // resolve the WRONG key → signing with the wrong key.
    expect(result.seedType).toBe("foreign");
    expect(deps.decryptSecret).toHaveBeenCalledWith(purePair.encryptedPrivateKey, PASSWORD);
    expect(deps.deriveStoaChainKeypair).not.toHaveBeenCalled();
    expect(deps.decryptWalletSecret).not.toHaveBeenCalled();
  });
});

describe("getKeyPairByPublicKey — PARTIAL/CORRUPT snapshot robustness (bug F-004/F-005)", () => {
  it("a snapshot OMITTING pureKeypairs reaches CodexKeyMissingError (via ?? []), NOT a raw TypeError", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);
    // Deliberately omit pureKeypairs entirely (a raw JSON snapshot can do this).
    const partial = { kadenaSeeds: [] } as unknown as SnapshotSlice;

    await expect(
      resolver.getKeyPairByPublicKey(partial, "pub-missing", PASSWORD)
    ).rejects.toBeInstanceOf(CodexKeyMissingError);
  });

  it("a snapshot OMITTING kadenaSeeds reaches CodexKeyMissingError (via ?? []), NOT a raw TypeError", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);
    const partial = { pureKeypairs: [] } as unknown as SnapshotSlice;

    await expect(
      resolver.getKeyPairByPublicKey(partial, "pub-missing", PASSWORD)
    ).rejects.toBeInstanceOf(CodexKeyMissingError);
  });

  it("a seed whose accounts is absent yields CodexKeyMissingError (not a TypeError from .find/.length on undefined)", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);
    const corruptSeed = { secret: "enc-seed-secret", seedType: "koala" } as unknown as StoaChainSeedLike;

    await expect(
      resolver.getKeyPairByPublicKey(
        snapshot({ kadenaSeeds: [corruptSeed] }),
        "pub-missing",
        PASSWORD
      )
    ).rejects.toBeInstanceOf(CodexKeyMissingError);
  });
});

describe("getKeyPairByPublicKey — NOT-FOUND path (N-06 secret hygiene, L200-212)", () => {
  it("throws CodexKeyMissingError (also instanceof CodexError) carrying structured counts for a pub in neither array", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);
    const snap = snapshot({
      pureKeypairs: [PURE_FOREIGN, PURE_EXTENDED], // count 2
      kadenaSeeds: [
        { secret: "s1", seedType: "koala", accounts: [{ publicKey: "a", index: 0 }] },
        {
          secret: "s2",
          seedType: "chainweaver",
          accounts: [
            { publicKey: "b", index: 0 },
            { publicKey: "c", index: 1 },
          ],
        },
      ], // derived count 3
    });

    const err = await resolver
      .getKeyPairByPublicKey(snap, "pub-not-present", PASSWORD)
      .then(() => {
        throw new Error("expected rejection");
      })
      .catch((e: unknown) => e);

    // Subclass identity depends on the CodexError base's prototype-chain restore.
    expect(err).toBeInstanceOf(CodexKeyMissingError);
    expect(err).toBeInstanceOf(CodexError);
    const keyErr = err as CodexKeyMissingError;
    expect(keyErr.publicKey).toBe("pub-not-present");
    expect(keyErr.pureKeypairCount).toBe(2);
    expect(keyErr.derivedAccountCount).toBe(3);
  });

  it("the not-found error is SECRET-FREE: message shortens the pubkey (slice(0,8)…slice(-4)) and never echoes password/mnemonic/private material", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);
    const longPub = "abcd1234deadbeefcafebabe0000ffff9999"; // long enough to shorten
    const snap = snapshot({
      pureKeypairs: [{ publicKey: "other", encryptedPrivateKey: "enc-plain-foreign" }],
      kadenaSeeds: [KOALA_SEED],
    });

    const err = (await resolver
      .getKeyPairByPublicKey(snap, longPub, PASSWORD)
      .catch((e: unknown) => e)) as CodexKeyMissingError;

    const shortKey = `${longPub.slice(0, 8)}…${longPub.slice(-4)}`;
    expect(err.message).toContain(shortKey);
    // The full pubkey is NEVER echoed (only the shortened form).
    expect(err.message).not.toContain(longPub);
    // High-entropy sentinels: a substring match here would be a real leak.
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain(MNEMONIC_SENTINEL);
    expect(err.message).not.toContain(DECRYPTED_PLAIN_64);
  });

  it("derivedAccountCount reduce guards seed.accounts ?? [] so a corrupt seed does not TypeError before the structured error is built (bug F-004)", async () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);
    const snap = snapshot({
      pureKeypairs: [],
      kadenaSeeds: [
        { secret: "s1", seedType: "koala", accounts: [{ publicKey: "a", index: 0 }] },
        { secret: "s2", seedType: "koala" } as unknown as StoaChainSeedLike, // no accounts
      ],
    });

    const err = (await resolver
      .getKeyPairByPublicKey(snap, "pub-not-present", PASSWORD)
      .catch((e: unknown) => e)) as CodexKeyMissingError;

    expect(err).toBeInstanceOf(CodexKeyMissingError);
    // Only the first seed's single account counts; the accounts-less seed
    // contributes 0 rather than crashing the reduce.
    expect(err.derivedAccountCount).toBe(1);
  });
});

describe("listCodexPubs — delegates to the injected collectCodexPubs (L116-122, no decrypt, no password)", () => {
  it("returns the Set<string> from collectCodexPubs(kadenaSeeds, pureKeypairs)", () => {
    const deps = makeFakeDeps();
    const resolver = createHeadlessCodexResolver(deps);
    const snap = snapshot({
      pureKeypairs: [PURE_FOREIGN],
      kadenaSeeds: [KOALA_SEED],
    });

    const pubs = resolver.listCodexPubs(snap);

    expect(deps.collectCodexPubs).toHaveBeenCalledWith(snap.kadenaSeeds, snap.pureKeypairs);
    expect(pubs).toBeInstanceOf(Set);
    expect(pubs.has(PURE_FOREIGN.publicKey)).toBe(true);
    expect(pubs.has(DERIVED_PUB)).toBe(true);
    // No decryption happens on the cheap pub-listing path.
    expect(deps.decryptSecret).not.toHaveBeenCalled();
  });
});
