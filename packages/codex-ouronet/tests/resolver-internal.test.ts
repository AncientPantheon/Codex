/**
 * InternalCodexResolver tests — verify the resolver bridges the store
 * to the KeyResolver contract correctly.
 *
 * Test strategy:
 *   - listCodexPubs: pure data, no crypto, asserts set semantics.
 *   - getKeyPairByPublicKey: a mix of real-crypto + targeted error cases.
 *     One end-to-end happy-path roundtrip for pure-keypairs (smartEncrypt
 *     → store → resolver → assert decrypted privateKey matches). One
 *     end-to-end roundtrip for koala-seed derived accounts (real
 *     mnemonic → real BIP39/SLIP-10 derivation → assert returned pubkey
 *     matches the indexed account's). Error cases are pure: locked +
 *     pubkey-not-found.
 *   - requestForeignKey: default-throws when no callback; delegates when
 *     a callback is provided.
 *
 * Why not mock smartDecrypt + KadenaWalletBuilder: those are the actual
 * crypto primitives consumers depend on at runtime. Mocking them would
 * hide regressions where the resolver mis-orders the password-cache
 * pull, the smartDecrypt call, or the KadenaWalletBuilder invocation.
 * Real crypto is slow (~1-2s per test for the SLIP-10 derivation) but
 * gives us a real assurance signal.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { InternalCodexResolver } from "@ancientpantheon/codex-ouronet/resolver";
import {
  CodexKeyMissingError,
  CodexLockedError,
} from "@ancientpantheon/codex-ouronet/errors";
import type { IKadenaSeed, IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

import { smartEncrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder } from "@stoachain/stoa-core/wallet";
import { universalSignTransaction } from "@stoachain/stoa-core/signing";
import { kadenaDecrypt } from "@stoachain/kadena-stoic-legacy/hd-wallet";
import { binToHex } from "@stoachain/kadena-stoic-legacy/cryptography-utils";
import { ed25519 } from "@noble/curves/ed25519";

const PASSWORD = "hunter2-test-password";

// --------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------

/** A known-good 64-hex private key + its derived 64-hex pubkey for the
 *  pure-keypair happy-path test. Deterministic — never regenerated. */
const FIXTURE_PURE_PRIVKEY = "a".repeat(64);
const FIXTURE_PURE_PUBKEY = "b".repeat(64);

/** Make a IPureKeypair with the fixture private key encrypted at PASSWORD. */
async function makePureKeypair(): Promise<IPureKeypair> {
  const encrypted = await smartEncrypt(FIXTURE_PURE_PRIVKEY, PASSWORD, "1.0");
  return {
    id: "pure-1",
    label: "Test pure",
    publicKey: FIXTURE_PURE_PUBKEY,
    encryptedPrivateKey: encrypted,
    createdAt: "2026-05-25T10:00:00.000Z",
  };
}

/** Build a real koala seed: generate mnemonic → encrypt at PASSWORD →
 *  derive account[0] for its pubkey. The resolver test will then ask
 *  for that pubkey and the resolver should return a matching keypair. */
async function makeKoalaSeed(): Promise<{
  seed: IKadenaSeed;
  derivedPub: string;
}> {
  const mnemonic = await KadenaWalletBuilder.generateMnemonic(24);
  const { publicKey } =
    await KadenaWalletBuilder.createWalletPairFromMnemonic(
      PASSWORD,
      mnemonic,
      0,
      "koala"
    );
  const encryptedMnemonic = await smartEncrypt(mnemonic, PASSWORD, "1.0");
  return {
    seed: {
      id: "seed-1",
      name: "Test Seed",
      seedType: "koala",
      version: "1.0.0",
      index: 0,
      secret: encryptedMnemonic,
      main: `k:${publicKey}`,
      createdAt: "2026-05-25T10:00:00.000Z",
      accounts: [
        {
          index: 0,
          publicKey,
          derivationPath: "m/44'/626'/0'/0/0",
        },
      ],
    },
    derivedPub: publicKey,
  };
}

/** Build a real CHAINWEAVER pure keypair the way a user would after pasting a
 *  128-hex KadenaKeys / Chainweaver export into AddPureKeypairForm: generate a
 *  12-word mnemonic, derive the canonical extended key (empty wallet password →
 *  plaintext scalar, first 64 bytes = kL‖kR) + its public key, then store the
 *  128-hex private key encrypted at the codex PASSWORD. */
async function makeChainweaverPureKeypair(): Promise<{
  pureKeypair: IPureKeypair;
  publicKey: string;
  canonicalPriv: string;
}> {
  const mnemonic = await KadenaWalletBuilder.generateMnemonic(12);
  // Canonical derivation — identical to SeedWordsTab.revealPrivateKey.
  const { publicKey, secretKey } =
    await KadenaWalletBuilder.createWalletPairFromMnemonic(
      "",
      mnemonic,
      0,
      "chainweaver"
    );
  const raw = await kadenaDecrypt("", secretKey);
  const canonicalPriv = binToHex(raw).slice(0, 128); // 64 bytes kL‖kR
  const encrypted = await smartEncrypt(canonicalPriv, PASSWORD, "1.0");
  return {
    pureKeypair: {
      id: "pure-cw-1",
      label: "Imported Chainweaver",
      publicKey,
      encryptedPrivateKey: encrypted,
      createdAt: "2026-06-10T10:00:00.000Z",
    },
    publicKey,
    canonicalPriv,
  };
}

/** Minimal unsigned Pact command whose single signer is `pubKey`. The `hash`
 *  is the message the WASM signer signs; 32 random-ish bytes base64url-encoded
 *  is sufficient (the chainweaver branch signs the decoded hash bytes). */
function makeUnsignedCommandFor(pubKey: string, hashBytes: Uint8Array) {
  const cmd = JSON.stringify({ signers: [{ pubKey }] });
  const hash = Buffer.from(hashBytes).toString("base64url");
  return { cmd, hash, sigs: [undefined] } as any;
}

// --------------------------------------------------------------------
// Suite
// --------------------------------------------------------------------

describe("InternalCodexResolver", () => {
  let store: ReturnType<typeof createCodexStore>;
  let resolver: InternalCodexResolver;

  beforeEach(async () => {
    const adapter = new MemoryCodexAdapter("dev");
    store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
    resolver = new InternalCodexResolver(store);
  });

  describe("listCodexPubs()", () => {
    it("returns empty set on empty codex", () => {
      const set = resolver.listCodexPubs() as Set<string>;
      expect(set.size).toBe(0);
    });

    it("includes pure-keypair pubkeys", async () => {
      const kp = await makePureKeypair();
      await store.getState().actions.addPureKeypair(kp);
      const set = resolver.listCodexPubs() as Set<string>;
      expect(set.has(FIXTURE_PURE_PUBKEY)).toBe(true);
      expect(set.size).toBe(1);
    });

    it("includes derived-account pubkeys from all seeds", async () => {
      const { seed, derivedPub } = await makeKoalaSeed();
      await store.getState().actions.addKadenaSeed(seed);
      const set = resolver.listCodexPubs() as Set<string>;
      expect(set.has(derivedPub)).toBe(true);
    });

    it("re-reads the store on each call (reflects mutations)", async () => {
      expect((resolver.listCodexPubs() as Set<string>).size).toBe(0);
      const kp = await makePureKeypair();
      await store.getState().actions.addPureKeypair(kp);
      expect((resolver.listCodexPubs() as Set<string>).size).toBe(1);
    });
  });

  describe("getKeyPairByPublicKey()", () => {
    it("throws CodexLockedError when codex is locked", async () => {
      const kp = await makePureKeypair();
      await store.getState().actions.addPureKeypair(kp);
      // No authenticate() call — store stays locked.
      await expect(
        resolver.getKeyPairByPublicKey(FIXTURE_PURE_PUBKEY)
      ).rejects.toThrow(CodexLockedError);
    });

    it("throws CodexKeyMissingError for unknown pubkeys", async () => {
      store.getState().actions.authenticate(PASSWORD, 60);
      await expect(
        resolver.getKeyPairByPublicKey("dead".repeat(16))
      ).rejects.toThrow(CodexKeyMissingError);
    });

    it("returns decrypted pure-keypair as foreign seedType", async () => {
      const kp = await makePureKeypair();
      await store.getState().actions.addPureKeypair(kp);
      store.getState().actions.authenticate(PASSWORD, 60);

      const result = await resolver.getKeyPairByPublicKey(FIXTURE_PURE_PUBKEY);
      expect(result.publicKey).toBe(FIXTURE_PURE_PUBKEY);
      expect(result.privateKey).toBe(FIXTURE_PURE_PRIVKEY);
      expect(result.seedType).toBe("foreign");
    });

    it("returns derived keypair for a koala-seed-derived account", async () => {
      const { seed, derivedPub } = await makeKoalaSeed();
      await store.getState().actions.addKadenaSeed(seed);
      store.getState().actions.authenticate(PASSWORD, 60);

      const result = await resolver.getKeyPairByPublicKey(derivedPub);
      expect(result.publicKey).toBe(derivedPub);
      expect(result.seedType).toBe("koala");
      // Koala secret is 32 bytes → 64 hex chars.
      expect(result.privateKey).toHaveLength(64);
      // Both encryptedSecretKey + password should be present for the
      // universalSign WASM-vs-nacl branch to route correctly downstream.
      expect(result.encryptedSecretKey).toBeDefined();
      expect(result.password).toBe(PASSWORD);
    }, 10000);

    it("routes a 128-hex Chainweaver pure keypair through the WASM extended-key signer", async () => {
      const { pureKeypair, publicKey, canonicalPriv } =
        await makeChainweaverPureKeypair();
      await store.getState().actions.addPureKeypair(pureKeypair);
      store.getState().actions.authenticate(PASSWORD, 60);

      const result = await resolver.getKeyPairByPublicKey(publicKey);
      // Extended foreign keys must NOT take the nacl ("foreign") path.
      expect(result.seedType).toBe("chainweaver");
      expect(result.privateKey).toBe(canonicalPriv);
      expect(result.privateKey).toHaveLength(128);
      expect(result.encryptedSecretKey).toBeDefined();
      expect(result.password).toBeTruthy();
    }, 15000);

    it("produces a VALID Ed25519 signature for an imported Chainweaver key (end-to-end)", async () => {
      const { pureKeypair, publicKey } = await makeChainweaverPureKeypair();
      await store.getState().actions.addPureKeypair(pureKeypair);
      store.getState().actions.authenticate(PASSWORD, 60);

      const keypair = await resolver.getKeyPairByPublicKey(publicKey);

      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hashBytes[i] = (i * 37 + 11) & 0xff;
      const tx = makeUnsignedCommandFor(publicKey, hashBytes);

      const signed: any = await universalSignTransaction(tx, [
        {
          publicKey: keypair.publicKey,
          secretKey: keypair.privateKey,
          seedType: keypair.seedType,
          encryptedSecretKey: keypair.encryptedSecretKey,
          password: keypair.password,
        },
      ]);

      const sigHex: string = signed.sigs?.[0]?.sig;
      expect(sigHex, "a signature should be attached").toBeTruthy();
      const ok = ed25519.verify(
        Uint8Array.from(Buffer.from(sigHex, "hex")),
        hashBytes,
        Uint8Array.from(Buffer.from(publicKey, "hex"))
      );
      expect(ok, "signature must verify against the imported key's pubkey").toBe(
        true
      );
    }, 15000);

    it("emits CodexKeyMissingError with structured counts", async () => {
      // 1 pure keypair + 1 derived account → counts reach the error.
      const kp = await makePureKeypair();
      await store.getState().actions.addPureKeypair(kp);
      const { seed } = await makeKoalaSeed();
      await store.getState().actions.addKadenaSeed(seed);
      store.getState().actions.authenticate(PASSWORD, 60);

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
    }, 10000);
  });

  describe("requestForeignKey()", () => {
    it("throws CodexKeyMissingError when no callback is wired", async () => {
      await expect(
        resolver.requestForeignKey("nope".repeat(16))
      ).rejects.toThrow(CodexKeyMissingError);
    });

    it("delegates to the provided callback", async () => {
      const customResolver = new InternalCodexResolver(store, {
        requestForeignKey: async (pub) => `priv-for-${pub.slice(0, 4)}`,
      });
      const result = await customResolver.requestForeignKey("abcd".repeat(16));
      expect(result).toBe("priv-for-abcd");
    });
  });
});
