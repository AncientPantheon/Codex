/**
 * ============================================================================
 * REAL-KDF LIVE FIXTURE GENERATOR for resolver-live-fixture.json.
 * THROWAWAY MATERIAL ONLY — no real funds, never reuse.
 * ============================================================================
 *
 * Run (from packages/codex-ouronet):
 *   node tests/fixtures/generate-resolver-live-fixture.mjs > tests/fixtures/resolver-live-fixture.json
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (the real P-001 closure — Option A)
 * ---------------------------------------------------------------------------
 * D4's golden fixture (packages/codex-core/tests/fixtures/resolver-parity-golden.json)
 * is DETERMINISTIC-FAKE: sentinel 64-hex pubkeys, tagged-object
 * `encryptedSecretKey`, and a seam that maps ciphertext strings to plaintext
 * via a lookup table — NOT real KDF/cipher bytes. Replaying its raw values
 * through the LIVE real-@stoachain resolver cannot reproduce its fake
 * `expected` (real smartDecrypt would reject the sentinel "throwaway-…-cipher"
 * strings). The conductor's DECISION was Option A: author a NEW real-KDF
 * throwaway fixture — the TRUE live byte-proof.
 *
 * This generator uses the SAME real crypto codex-ouronet already installs and
 * that resolver-internal.test.ts exercises green (13/13):
 *   - smartEncrypt(plain, pw, "2")  → REAL V2 AES-GCM / PBKDF2-SHA512-600k blob.
 *   - StoaChainWalletBuilder.createWalletPairFromMnemonic → REAL BIP39/SLIP-10.
 *   - kadenaDecrypt + binToHex + toHexString → the resolver's private-key hex.
 *
 * CRITICAL — V2 ONLY: every smartEncrypt call passes schemaVersion "2" so
 * isCodexUpgraded() → true → encryptStringV2 (no `import("./v1")`). This
 * sidesteps the pre-existing @stoachain/stoa-core/dist/crypto/v2.js
 * extensionless `import("./v1")` bug, which only triggers on the legacy V1
 * encode/decode path. The blobs this emits are V2, so both the emit here and
 * the live resolver's smartDecrypt take the V2 branch — never `./v1`.
 *
 * ---------------------------------------------------------------------------
 * THE ALGORITHM THIS MIRRORS (source of truth)
 * ---------------------------------------------------------------------------
 * src/resolver/InternalCodexResolver.ts getKeyPairByPublicKey (L124-198 +
 * L77-93). The expected outputs are COMPUTED here by running the real
 * primitives through the same branch logic the resolver runs — so the JSON is
 * the real algorithm's real output, not a hand-typed constant. Re-running this
 * generator regenerates real (fresh-salt, thus different-ciphertext) blobs but
 * the same DERIVED pubkeys / private-key hex, because the mnemonics are pinned.
 *
 * ---------------------------------------------------------------------------
 * THROWAWAY-MATERIAL PROVENANCE (funds-critical, secret hygiene)
 * ---------------------------------------------------------------------------
 * The private key, mnemonics, and password below are synthetic throwaway
 * tokens invented for this test. Do NOT fund anything derived from them.
 * ============================================================================
 */

import { smartEncrypt, smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import { toHexString } from "@stoachain/stoa-core/signing";
import { kadenaDecrypt } from "@stoachain/kadena-stoic-legacy/hd-wallet";
import { binToHex } from "@stoachain/kadena-stoic-legacy/cryptography-utils";

// Force every smartEncrypt onto the V2 branch (isCodexUpgraded parses >= 1).
const V2 = "2";

// --- Throwaway codex password (the value SEEDED into passwordCache in-test) ---
const CODEX_PASSWORD =
  "THROWAWAY-live-codex-pw-6d2f9a4c1e70b385a0d9c4f27b1e806a5c3d0f19e8b46a2d7c0f513892ae64b0";

// --- (i) A KNOWN THROWAWAY pure 64-hex private key (plain-foreign branch) ---
//     length !== 128 → resolver returns seedType "foreign", NO password field.
const PURE_FOREIGN_PRIVATE_KEY =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";
// Its 64-hex public key sentinel — the pure-foreign path returns publicKey
// verbatim (it does NOT re-derive), so any stable 64-hex string works as the
// lookup key. This is a THROWAWAY sentinel, not a funded address.
const PURE_FOREIGN_PUB =
  "f00d0000111122223333444455556666777788889999aaaabbbbccccddddeee0";

// --- (ii) A KNOWN THROWAWAY 24-word mnemonic for the koala DERIVED branch ---
//     Real BIP39 (24-word) + SLIP-10 Ed25519 derivation computes the expected
//     pubkey + private-key hex. This is the canonical all-zero BIP39 test vector
//     (23×"abandon" + "art") — a universally-known throwaway, funds NOTHING.
const KOALA_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon art";

/**
 * Build the pure-foreign case: encrypt the known 64-hex private key at the
 * codex password (V2), and compute the expected resolver output.
 */
async function buildPureForeignCase() {
  const encryptedPrivateKey = await smartEncrypt(
    PURE_FOREIGN_PRIVATE_KEY,
    CODEX_PASSWORD,
    V2,
  );
  // Round-trip self-check: the committed blob MUST decrypt back to the known
  // key under the throwaway password, or the live test would fail for a fixture
  // reason rather than a resolver reason.
  const roundTrip = await smartDecrypt(encryptedPrivateKey, CODEX_PASSWORD);
  if (roundTrip !== PURE_FOREIGN_PRIVATE_KEY) {
    throw new Error("pure-foreign fixture: V2 round-trip mismatch");
  }
  return {
    pureKeypair: { publicKey: PURE_FOREIGN_PUB, encryptedPrivateKey },
    case: {
      name: "pure-foreign",
      publicKey: PURE_FOREIGN_PUB,
      expected: {
        publicKey: PURE_FOREIGN_PUB,
        privateKey: PURE_FOREIGN_PRIVATE_KEY,
        seedType: "foreign",
      },
    },
  };
}

/**
 * Build the koala DERIVED case: encrypt the known mnemonic at the codex
 * password (V2), then run the resolver's real derivation algorithm to compute
 * the expected { publicKey, privateKey (<=64 hex), seedType, password }.
 * The `encryptedSecretKey` the resolver returns is a fresh @kadena/hd-wallet
 * EncryptedString whose bytes are non-deterministic per derivation call — so
 * we do NOT pin it in the fixture; the test asserts it is DEFINED (present),
 * not byte-equal, and pins the deterministic fields (pubkey, priv hex, tag).
 */
async function buildDerivedKoalaCase() {
  const encryptedMnemonic = await smartEncrypt(KOALA_MNEMONIC, CODEX_PASSWORD, V2);

  // Mirror InternalCodexResolver.ts L171-189 with the REAL primitives.
  const mnemonic = await smartDecrypt(encryptedMnemonic, CODEX_PASSWORD);
  const { publicKey, secretKey } =
    await StoaChainWalletBuilder.createWalletPairFromMnemonic(
      CODEX_PASSWORD,
      mnemonic,
      0,
      "koala",
    );
  const decryptedPk = await kadenaDecrypt(CODEX_PASSWORD, secretKey);
  let hexKey = toHexString(decryptedPk);
  if (hexKey.length > 64) hexKey = hexKey.slice(0, 64);

  return {
    seed: {
      secret: encryptedMnemonic,
      seedType: "koala",
      accounts: [{ publicKey, index: 0 }],
    },
    case: {
      name: "derived-koala",
      publicKey,
      expected: {
        publicKey,
        privateKey: hexKey,
        seedType: "koala",
        // encryptedSecretKey intentionally omitted from `expected` — it is a
        // fresh per-call blob, asserted present (defined) but not byte-pinned.
        password: CODEX_PASSWORD,
      },
    },
  };
}

/**
 * Build the extended (128-hex chainweaver) DERIVED-from-import case: derive a
 * canonical 128-hex extended key exactly as SeedWordsTab.revealPrivateKey does
 * (12-word chainweaver mnemonic, empty wallet password → plaintext scalar,
 * first 128 hex = kL‖kR), encrypt it at the codex password (V2), and record the
 * expected resolver output. length === 128 → the chainweaver WASM branch, whose
 * returned `password` is the fixed EXTENDED_FOREIGN_SCRAMBLE_PW constant.
 */
async function buildExtendedForeignCase() {
  const mnemonic = await StoaChainWalletBuilder.generateMnemonic(12);
  const { publicKey, secretKey } =
    await StoaChainWalletBuilder.createWalletPairFromMnemonic(
      "",
      mnemonic,
      0,
      "chainweaver",
    );
  const raw = await kadenaDecrypt("", secretKey);
  const canonicalPriv = binToHex(raw).slice(0, 128); // 64 bytes kL‖kR

  const encryptedPrivateKey = await smartEncrypt(canonicalPriv, CODEX_PASSWORD, V2);
  const roundTrip = await smartDecrypt(encryptedPrivateKey, CODEX_PASSWORD);
  if (roundTrip !== canonicalPriv || canonicalPriv.length !== 128) {
    throw new Error("extended-foreign fixture: V2 round-trip / length mismatch");
  }

  return {
    pureKeypair: { publicKey, encryptedPrivateKey },
    case: {
      name: "pure-extended",
      publicKey,
      expected: {
        publicKey,
        privateKey: canonicalPriv,
        seedType: "chainweaver",
        // The resolver's buildExtendedForeignSigningKey returns this constant.
        password: "codex-extended-foreign",
        // encryptedSecretKey omitted — a fresh AES-wrap per call, asserted
        // present but not byte-pinned.
      },
    },
  };
}

async function main() {
  const pureForeign = await buildPureForeignCase();
  const derivedKoala = await buildDerivedKoalaCase();
  const extendedForeign = await buildExtendedForeignCase();

  const fixture = {
    __WARNING__:
      "THROWAWAY test material — no real funds; never reuse. Real-KDF V2 blobs " +
      "(PBKDF2-SHA512-600k / AES-GCM). Regenerating produces fresh ciphertexts " +
      "but the same DERIVED pubkeys/private-key hex (mnemonics are pinned).",
    __provenance__:
      "Generated by tests/fixtures/generate-resolver-live-fixture.mjs. Uses REAL " +
      "@stoachain smartEncrypt(V2) + StoaChainWalletBuilder.createWalletPairFromMnemonic " +
      "(same primitives as resolver-internal.test.ts, 13/13 green). Mirrors " +
      "InternalCodexResolver.ts L124-198 + L77-93. V2-only to avoid the v2.js " +
      "extensionless import('./v1') bug.",
    password: CODEX_PASSWORD,
    snapshot: {
      pureKeypairs: [pureForeign.pureKeypair, extendedForeign.pureKeypair],
      kadenaSeeds: [derivedKoala.seed],
    },
    cases: [pureForeign.case, extendedForeign.case, derivedKoala.case],
  };

  process.stdout.write(JSON.stringify(fixture, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
