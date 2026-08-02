/**
 * createHeadlessKadenaResolver — the server-safe, pre-bound Kadena KeyResolver
 * (docs/work/khronoton-headless-kadena-resolver/design.md; Topic 1 of Pythia's
 * khronoton-keyresolver-delegation).
 *
 * Strategy mirrors resolver-internal.test.ts but through the HEADLESS factory
 * (no Zustand store, no auth gate): real crypto end-to-end (real BIP39/SLIP-10
 * derivation, real smartEncrypt), because mocking the primitives would hide the
 * exact seedType-routing regression this whole delegation exists to prevent.
 *
 * Covers the handoff's acceptance criteria:
 *   - koala derived-account resolve (the default seedType),
 *   - chainweaver extended-key (128-hex) resolve → WASM path + a VALID signature,
 *   - pure/foreign keypair resolve,
 *   - listCodexPubs across seeds + pures,
 *   - wrong-key / not-found → CodexKeyMissingError with structured counts,
 *   - fire-time: loadSnapshot + getPassword re-invoked each call (a mutation
 *     between calls is reflected without rebuilding the resolver).
 */

import { describe, it, expect } from "vitest";
import {
  createHeadlessKadenaResolver,
  type SnapshotSlice,
} from "@ancientpantheon/codex-ouronet/resolver";
import { CodexKeyMissingError } from "@ancientpantheon/codex-ouronet/errors";

import { smartEncrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import { universalSignTransaction } from "@stoachain/stoa-core/signing";
import { kadenaDecrypt } from "@stoachain/kadena-stoic-legacy/hd-wallet";
import { binToHex } from "@stoachain/kadena-stoic-legacy/cryptography-utils";
import { ed25519 } from "@noble/curves/ed25519";

const PASSWORD = "hunter2-headless-password";

const FIXTURE_PURE_PRIVKEY = "a".repeat(64);
const FIXTURE_PURE_PUBKEY = "b".repeat(64);

async function makePureEntry(): Promise<{ publicKey: string; encryptedPrivateKey: string }> {
  return {
    publicKey: FIXTURE_PURE_PUBKEY,
    encryptedPrivateKey: await smartEncrypt(FIXTURE_PURE_PRIVKEY, PASSWORD, "1.0"),
  };
}

type SeedType = "koala" | "chainweaver" | "eckowallet";

/** Build a real seed of the given seedType with account[0] recorded from the
 *  ACTUAL derivation (so the recorded pubkey matches what the mnemonic derives).
 *  chainweaver/eckowallet 12-word; koala 24-word. */
async function makeSeed(
  seedType: SeedType,
): Promise<{ seed: SnapshotSlice["kadenaSeeds"][number]; derivedPub: string }> {
  const words = seedType === "koala" ? 24 : 12;
  const mnemonic = await StoaChainWalletBuilder.generateMnemonic(words);
  const { publicKey } = await StoaChainWalletBuilder.createWalletPairFromMnemonic(
    PASSWORD,
    mnemonic,
    0,
    seedType,
  );
  return {
    seed: {
      seedType,
      secret: await smartEncrypt(mnemonic, PASSWORD, "1.0"),
      accounts: [{ publicKey, index: 0 }],
    },
    derivedPub: publicKey,
  };
}

async function makeKoalaSeed(): Promise<{ seed: SnapshotSlice["kadenaSeeds"][number]; derivedPub: string }> {
  return makeSeed("koala");
}

async function makeChainweaverPure(): Promise<{
  entry: { publicKey: string; encryptedPrivateKey: string };
  publicKey: string;
  canonicalPriv: string;
}> {
  const mnemonic = await StoaChainWalletBuilder.generateMnemonic(12);
  const { publicKey, secretKey } = await StoaChainWalletBuilder.createWalletPairFromMnemonic(
    "",
    mnemonic,
    0,
    "chainweaver",
  );
  const raw = await kadenaDecrypt("", secretKey);
  const canonicalPriv = binToHex(raw).slice(0, 128);
  return {
    entry: {
      publicKey,
      encryptedPrivateKey: await smartEncrypt(canonicalPriv, PASSWORD, "1.0"),
    },
    publicKey,
    canonicalPriv,
  };
}

function makeUnsignedCommandFor(pubKey: string, hashBytes: Uint8Array) {
  const cmd = JSON.stringify({ signers: [{ pubKey }] });
  const hash = Buffer.from(hashBytes).toString("base64url");
  return { cmd, hash, sigs: [undefined] } as any;
}

/** A resolver whose snapshot + password come from mutable closures, so tests can
 *  assert fire-time re-reads and count invocations. */
function makeResolver(initial: SnapshotSlice) {
  let snapshot = initial;
  let loadCount = 0;
  let pwCount = 0;
  const resolver = createHeadlessKadenaResolver({
    loadSnapshot: () => {
      loadCount++;
      return snapshot;
    },
    getPassword: () => {
      pwCount++;
      return PASSWORD;
    },
  });
  return {
    resolver,
    setSnapshot: (s: SnapshotSlice) => {
      snapshot = s;
    },
    counts: () => ({ loadCount, pwCount }),
  };
}

describe("createHeadlessKadenaResolver", () => {
  describe("listCodexPubs()", () => {
    it("returns empty set on empty codex", async () => {
      const { resolver } = makeResolver({ kadenaSeeds: [], pureKeypairs: [] });
      expect((await resolver.listCodexPubs()).size).toBe(0);
    });

    it("includes both pure-keypair and derived-account pubkeys", async () => {
      const pure = await makePureEntry();
      const { seed, derivedPub } = await makeKoalaSeed();
      const { resolver } = makeResolver({ kadenaSeeds: [seed], pureKeypairs: [pure] });
      const set = await resolver.listCodexPubs();
      expect(set.has(FIXTURE_PURE_PUBKEY)).toBe(true);
      expect(set.has(derivedPub)).toBe(true);
    });

    it("tolerates a snapshot missing an array (treats it as empty, no throw)", async () => {
      const { resolver } = makeResolver({} as unknown as SnapshotSlice);
      expect((await resolver.listCodexPubs()).size).toBe(0);
    });
  });

  describe("getKeyPairByPublicKey()", () => {
    it("resolves a pure keypair as foreign seedType", async () => {
      const pure = await makePureEntry();
      const { resolver } = makeResolver({ kadenaSeeds: [], pureKeypairs: [pure] });
      const kp = await resolver.getKeyPairByPublicKey(FIXTURE_PURE_PUBKEY);
      expect(kp.publicKey).toBe(FIXTURE_PURE_PUBKEY);
      expect(kp.privateKey).toBe(FIXTURE_PURE_PRIVKEY);
      expect(kp.seedType).toBe("foreign");
    });

    it("resolves a koala-seed-derived account (seedType-complete default path)", async () => {
      const { seed, derivedPub } = await makeKoalaSeed();
      const { resolver } = makeResolver({ kadenaSeeds: [seed], pureKeypairs: [] });
      const kp = await resolver.getKeyPairByPublicKey(derivedPub);
      expect(kp.publicKey).toBe(derivedPub);
      expect(kp.seedType).toBe("koala");
      expect(kp.privateKey).toHaveLength(64);
      expect(kp.encryptedSecretKey).toBeDefined();
      expect(kp.password).toBe(PASSWORD);
    }, 15000);

    it("routes a 128-hex chainweaver key through the WASM path and produces a VALID signature", async () => {
      const { entry, publicKey } = await makeChainweaverPure();
      const { resolver } = makeResolver({ kadenaSeeds: [], pureKeypairs: [entry] });
      const kp = await resolver.getKeyPairByPublicKey(publicKey);
      expect(kp.seedType).toBe("chainweaver");
      expect(kp.privateKey).toHaveLength(128);
      expect(kp.encryptedSecretKey).toBeDefined();
      expect(kp.password).toBeTruthy();

      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hashBytes[i] = (i * 37 + 11) & 0xff;
      const tx = makeUnsignedCommandFor(publicKey, hashBytes);
      const signed: any = await universalSignTransaction(tx, [
        {
          publicKey: kp.publicKey,
          secretKey: kp.privateKey,
          seedType: kp.seedType,
          encryptedSecretKey: kp.encryptedSecretKey,
          password: kp.password,
        },
      ]);
      const sigHex: string = signed.sigs?.[0]?.sig;
      expect(sigHex, "a signature should be attached").toBeTruthy();
      const ok = ed25519.verify(
        Uint8Array.from(Buffer.from(sigHex, "hex")),
        hashBytes,
        Uint8Array.from(Buffer.from(publicKey, "hex")),
      );
      expect(ok, "signature must verify against the imported key's pubkey").toBe(true);
    }, 20000);

    // The EXACT scenario that motivated this handoff: a non-koala operator SEED
    // (chainweaver/eckowallet), re-derived through the derived-account branch. A
    // koala-only hand-roll derived the WRONG key here and refused to sign. Prove
    // the delegated path derives the RIGHT key and signs validly for both.
    it.each(["chainweaver", "eckowallet"] as const)(
      "resolves + signs a %s SEED-derived account (the motivating non-koala scenario)",
      async (seedType) => {
        const { seed, derivedPub } = await makeSeed(seedType);
        const { resolver } = makeResolver({ kadenaSeeds: [seed], pureKeypairs: [] });
        const kp = await resolver.getKeyPairByPublicKey(derivedPub);
        expect(kp.publicKey).toBe(derivedPub);
        expect(kp.seedType).toBe(seedType);
        expect(kp.encryptedSecretKey).toBeDefined();
        expect(kp.password).toBe(PASSWORD);

        const hashBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) hashBytes[i] = (i * 53 + 7) & 0xff;
        const tx = makeUnsignedCommandFor(derivedPub, hashBytes);
        const signed: any = await universalSignTransaction(tx, [
          {
            publicKey: kp.publicKey,
            secretKey: kp.privateKey,
            seedType: kp.seedType,
            encryptedSecretKey: kp.encryptedSecretKey,
            password: kp.password,
          },
        ]);
        const sigHex: string = signed.sigs?.[0]?.sig;
        expect(sigHex, "a signature should be attached").toBeTruthy();
        const ok = ed25519.verify(
          Uint8Array.from(Buffer.from(sigHex, "hex")),
          hashBytes,
          Uint8Array.from(Buffer.from(derivedPub, "hex")),
        );
        expect(ok, `${seedType} seed-derived signature must verify`).toBe(true);
      },
      25000,
    );

    // Wrong-key refusal guard: a seed whose RECORDED account pubkey disagrees with
    // what the mnemonic actually derives (corrupt codex / wrong seedType tag) must
    // REFUSE to sign, not silently return a mislabeled key.
    it("refuses to sign when the recorded pubkey doesn't match the derived key", async () => {
      const { seed } = await makeSeed("koala");
      const bogusPub = "d".repeat(64);
      // Corrupt the recorded account: claim `bogusPub` lives at index 0 (the
      // mnemonic really derives something else). getKeyPairByPublicKey(bogusPub)
      // finds the account by bogusPub, derives the real key, and must refuse.
      const corrupted = {
        ...seed,
        accounts: [{ publicKey: bogusPub, index: 0 }],
      };
      const { resolver } = makeResolver({ kadenaSeeds: [corrupted], pureKeypairs: [] });
      await expect(resolver.getKeyPairByPublicKey(bogusPub)).rejects.toThrow(
        /derived a different public key|refusing to sign/i,
      );
    }, 15000);

    it("throws CodexKeyMissingError with structured counts for an unknown pubkey", async () => {
      const pure = await makePureEntry();
      const { seed } = await makeKoalaSeed();
      const { resolver } = makeResolver({ kadenaSeeds: [seed], pureKeypairs: [pure] });
      try {
        await resolver.getKeyPairByPublicKey("c".repeat(64));
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(CodexKeyMissingError);
        const err = e as CodexKeyMissingError;
        expect(err.pureKeypairCount).toBe(1);
        expect(err.derivedAccountCount).toBe(1);
        expect(err.publicKey).toBe("c".repeat(64));
      }
    }, 15000);
  });

  describe("fire-time re-read (never cached)", () => {
    it("re-invokes loadSnapshot + getPassword on every call and reflects a mutation", async () => {
      const pure = await makePureEntry();
      const h = makeResolver({ kadenaSeeds: [], pureKeypairs: [] });

      // Empty at first.
      expect((await h.resolver.listCodexPubs()).size).toBe(0);

      // Mutate the snapshot WITHOUT rebuilding the resolver.
      h.setSnapshot({ kadenaSeeds: [], pureKeypairs: [pure] });
      expect((await h.resolver.listCodexPubs()).size).toBe(1);

      const kp = await h.resolver.getKeyPairByPublicKey(FIXTURE_PURE_PUBKEY);
      expect(kp.privateKey).toBe(FIXTURE_PURE_PRIVKEY);

      // loadSnapshot ran for each of the 3 calls; getPassword only for the
      // resolve (listCodexPubs needs no secret).
      const { loadCount, pwCount } = h.counts();
      expect(loadCount).toBe(3);
      expect(pwCount).toBe(1);
    });
  });
});
