/**
 * ============================================================================
 * OFFLINE GENERATOR for resolver-parity-golden.json — THROWAWAY MATERIAL ONLY.
 * ============================================================================
 *
 * Run:  node tests/fixtures/generate-resolver-parity-golden.mjs > tests/fixtures/resolver-parity-golden.json
 *
 * This script PRODUCED the committed `resolver-parity-golden.json`. It is
 * committed, version-pinned, and REPRODUCIBLE: re-running it emits the exact
 * same bytes (deterministic — no randomness, no clock, no network). A reviewer
 * can run it and `git diff` the output against the committed JSON to audit that
 * the golden values are not a magic constant.
 *
 * ---------------------------------------------------------------------------
 * WHY A GENERATOR AT ALL (bug F-001)
 * ---------------------------------------------------------------------------
 * The parity test replays the golden fixture through BOTH (a) the new
 * `createHeadlessCodexResolver` factory and (b) an in-test faithful
 * transcription of the browser resolver's `getKeyPairByPublicKey` body. BOTH
 * share the SAME injected crypto seam — so if the golden values were wrong but
 * self-consistent, BOTH would match a bad golden and ship green. This generator
 * is the INDEPENDENT anchor: it computes the golden expected outputs from the
 * SAME algorithm the transcription mirrors, but as a standalone artifact a
 * reviewer diffs. Committing it makes the golden reproducible, not magic.
 *
 * ---------------------------------------------------------------------------
 * THROWAWAY-MATERIAL PROVENANCE (funds-critical, N-06)
 * ---------------------------------------------------------------------------
 * Every secret in the emitted fixture is a synthetic, high-entropy THROWAWAY
 * token invented here for the test. There is NO real keyfile, NO real mnemonic
 * with value, NO wallet holding funds. The `publicKey` values are arbitrary
 * 64-hex sentinels, not addresses that derive from any funded key. Do NOT fund
 * anything derived from this material; do NOT reuse it anywhere real.
 *
 * ---------------------------------------------------------------------------
 * THE SEAM SCHEME (why this is deterministic-fake, not real WASM)
 * ---------------------------------------------------------------------------
 * codex-core is `@stoachain`-free (D3/D7). This generator therefore does NOT
 * import the real `smartDecrypt` / `KadenaWalletBuilder` / `kadenaDecrypt` /
 * `buildExtendedForeignSigningKey`. Instead it models each seam touchpoint's
 * INPUT→OUTPUT *contract* — the exact shape/branch the real primitive feeds the
 * resolver algorithm — with a deterministic fake. The parity proof is
 * STRUCTURAL/ALGORITHMIC: it proves the factory's PLUMBING (which array, which
 * branch, the length===128 fork, the >64 truncation, the seedType tags, the
 * not-found path) matches the browser resolver's plumbing byte-for-byte, given
 * identical seam outputs. It is explicitly NOT a proof against the real KDF/
 * cipher bytes — that live-resolver cross-check is a REQUIRED D5 forward-carry
 * (once codex-ouronet consumes core; see D4-COORDINATION-NOTE residual gap).
 *
 * The one place a REAL constant enters is the extended-key branch's returned
 * `password`: it MUST equal the real `EXTENDED_FOREIGN_SCRAMBLE_PW` from
 * `InternalCodexResolver.ts:56` ("codex-extended-foreign"), because
 * `universalSignTransaction` gates the Chainweaver WASM path on that exact
 * value (bug F-002). It is pinned verbatim below.
 *
 * PINNED @stoachain VERSIONS D5 WILL BIND (the algorithm this golden matches):
 *   @stoachain/stoa-core            4.3.6   (smartDecrypt, KadenaWalletBuilder,
 *                                            toHexString, buildCodexPubSet)
 *   @stoachain/kadena-stoic-legacy  4.3.6   (kadenaDecrypt, kadenaEncrypt,
 *                                            legacyKadenaChangePassword)
 * Source-of-truth algorithm reproduced:
 *   ouronet-codex/src/resolver/InternalCodexResolver.ts  L124-198 + L77-93.
 * If D5 binds a different @stoachain version whose primitives change these
 * shapes, re-run this generator against the new versions and re-commit the JSON.
 * ============================================================================
 */

// --- The real extended-branch scramble password (InternalCodexResolver.ts:56) ---
const EXTENDED_FOREIGN_SCRAMBLE_PW = "codex-extended-foreign";

// --- Deterministic THROWAWAY sentinels (high-entropy so not.toContain guards bite) ---
const CODEX_PASSWORD =
  "THROWAWAY-codex-pw-9f3c1a7e5b2d8046c1e97a4f0d6b3852aa1c7e94d0f28b6a3c5e719d40f8b62a";
const PURE_FOREIGN_MNEMONIC_SECRET =
  "throwaway-pure-foreign-cipher-4d9a1f7c0e63b28a5d1c9e04f7a2b86d3e0c5f19a7b4d206e8c3f1a9d5b70e42c";
const PURE_EXTENDED_MNEMONIC_SECRET =
  "throwaway-pure-extended-cipher-8b2e6a04d1f97c35e0a8d24b6f1c093a7e5d820b4c6f19e3a0d7b58c214f6039e";
const SEED_MNEMONIC_CIPHER =
  "throwaway-seed-secret-cipher-1c7f0a94e6b23d85f0a1c8e47b2d906a5e3c1f80b4d69a2e7c05f318d4b6e920a";

// The plaintext mnemonic a seed's `secret` decrypts to (throwaway, high-entropy).
const SEED_PLAINTEXT_MNEMONIC =
  "throwaway zebra orbit crimson velvet ninth harbor quantum ledger pigment rustic bramble echo violet nomad thistle";

// --- 64-hex plain-foreign private key (length !== 128 → seedType "foreign") ---
const FOREIGN_PRIVATE_KEY_64 =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";
// --- 128-hex extended private key (length === 128 → seedType "chainweaver") ---
const EXTENDED_PRIVATE_KEY_128 =
  "0f1e2d3c4b5a6978" +
  "8796a5b4c3d2e1f0" +
  "00112233445566778899aabbccddeeff" +
  "102132435465768798a9bacbdcedfe0f" +
  "1122334455667788" +
  "99aabbccddeeff00";
// The opaque EncryptedString the extended repackage returns (modelled as a tagged
// object — the real one is a @kadena/hd-wallet EncryptedString; carried as unknown).
const EXTENDED_ENCRYPTED_SECRET = {
  __kind: "throwaway-encrypted-string",
  of: "extended-foreign-repackage",
};

// --- Derived-account fixtures ---
// Arbitrary throwaway 64-hex publicKey sentinels (NOT funded addresses).
const PURE_FOREIGN_PUB =
  "cafe0000111122223333444455556666777788889999aaaabbbbccccddddeee0";
const PURE_EXTENDED_PUB =
  "beef0000111122223333444455556666777788889999aaaabbbbccccddddeee1";
const DERIVED_SEED_PUB =
  "d00d0000111122223333444455556666777788889999aaaabbbbccccddddeee2";

// The derived keypair's re-derived pub (KadenaWalletBuilder returns this).
const DERIVED_REDERIVED_PUB = DERIVED_SEED_PUB;
// The opaque wallet secret KadenaWalletBuilder returns as `secretKey`.
const DERIVED_ENCRYPTED_SECRET = {
  __kind: "throwaway-encrypted-string",
  of: "koala-seed-derived",
};
// kadenaDecrypt(password, encryptedSecretKey) → Uint8Array → toHexString → 64 hex.
// For koala this is exactly 64 hex (no truncation). We model a 64-hex output.
const DERIVED_DECRYPTED_HEX_64 =
  "11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff";
// A second derived case exercises the >64 truncation: toHexString yields 192 hex,
// the resolver truncates to the first 64 chars.
const DERIVED_LONG_HEX_192 =
  "abc1230000000000000000000000000000000000000000000000000000000000" + // first 64 (kept)
  "def4560000000000000000000000000000000000000000000000000000000000" +
  "aaa9990000000000000000000000000000000000000000000000000000000000";
const DERIVED_TRUNCATED_HEX_64 = DERIVED_LONG_HEX_192.slice(0, 64);
const DERIVED_TRUNC_SEED_PUB =
  "7ea50000111122223333444455556666777788889999aaaabbbbccccddddeee3";

/**
 * Faithful transcription of `InternalCodexResolver.getKeyPairByPublicKey`
 * (L124-198) MINUS the browser coupling (no passwordCache gate, no Zustand).
 * This is the SAME algorithm the in-test transcription mirrors — used here to
 * COMPUTE the golden expected output, so the JSON is the algorithm's real output
 * for the given seam, not a hand-typed constant.
 */
function resolveGolden(snapshot, publicKey, password, seam) {
  const purePairs = snapshot.pureKeypairs ?? [];
  const seeds = snapshot.kadenaSeeds ?? [];

  const purePair = purePairs.find((k) => k.publicKey === publicKey);
  if (purePair) {
    const privateKey = seam.decryptSecret(purePair.encryptedPrivateKey, password);
    if (privateKey.length === 128) {
      const { encryptedSecretKey, password: walletPw } = seam.buildExtendedForeignKey(
        privateKey,
        publicKey,
      );
      return { publicKey, privateKey, seedType: "chainweaver", encryptedSecretKey, password: walletPw };
    }
    return { publicKey, privateKey, seedType: "foreign" };
  }

  for (const seed of seeds) {
    const account = (seed.accounts ?? []).find((a) => a.publicKey === publicKey);
    if (!account) continue;
    const mnemonic = seam.decryptSecret(seed.secret, password);
    const { publicKey: pub, secretKey: encryptedSecretKey } = seam.deriveKadenaKeypair(
      password,
      mnemonic,
      account.index,
      seed.seedType,
    );
    const decryptedPk = seam.decryptWalletSecret(password, encryptedSecretKey);
    let hexKey = seam.toHex(decryptedPk);
    if (hexKey.length > 64) hexKey = hexKey.slice(0, 64);
    return { publicKey: pub, privateKey: hexKey, seedType: seed.seedType, encryptedSecretKey, password };
  }

  throw new Error("golden generator: target not found — fixture is malformed");
}

/**
 * The deterministic seam whose INPUT→OUTPUT contract the fixture captures. The
 * in-CI test rebuilds an equivalent seam from the fixture's own maps, so the
 * replay behavior matches these outputs exactly.
 */
const seam = {
  decryptSecret(ciphertext) {
    const map = {
      [PURE_FOREIGN_MNEMONIC_SECRET]: FOREIGN_PRIVATE_KEY_64,
      [PURE_EXTENDED_MNEMONIC_SECRET]: EXTENDED_PRIVATE_KEY_128,
      [SEED_MNEMONIC_CIPHER]: SEED_PLAINTEXT_MNEMONIC,
    };
    if (!(ciphertext in map)) throw new Error("generator seam: unknown ciphertext");
    return map[ciphertext];
  },
  buildExtendedForeignKey() {
    return { encryptedSecretKey: EXTENDED_ENCRYPTED_SECRET, password: EXTENDED_FOREIGN_SCRAMBLE_PW };
  },
  deriveKadenaKeypair(_pw, _mnemonic, index) {
    // index 0 → the 64-hex koala case; index 1 → the >64 truncation case.
    if (index === 1) return { publicKey: DERIVED_TRUNC_SEED_PUB, secretKey: { __kind: "trunc", of: "long" } };
    return { publicKey: DERIVED_REDERIVED_PUB, secretKey: DERIVED_ENCRYPTED_SECRET };
  },
  decryptWalletSecret(_pw, encryptedSecretKey) {
    // Return a tagged marker the toHex fake maps to the right hex length.
    return encryptedSecretKey;
  },
  toHex(bytes) {
    if (bytes && bytes.__kind === "trunc") return DERIVED_LONG_HEX_192;
    return DERIVED_DECRYPTED_HEX_64;
  },
};

// --- Build the snapshot slice + per-case golden expectations ---
const snapshot = {
  pureKeypairs: [
    { publicKey: PURE_FOREIGN_PUB, encryptedPrivateKey: PURE_FOREIGN_MNEMONIC_SECRET },
    { publicKey: PURE_EXTENDED_PUB, encryptedPrivateKey: PURE_EXTENDED_MNEMONIC_SECRET },
  ],
  kadenaSeeds: [
    {
      secret: SEED_MNEMONIC_CIPHER,
      seedType: "koala",
      accounts: [
        { publicKey: DERIVED_SEED_PUB, index: 0 },
        { publicKey: DERIVED_TRUNC_SEED_PUB, index: 1 },
      ],
    },
  ],
};

const cases = [
  { name: "pure-foreign (64-hex → seedType foreign)", publicKey: PURE_FOREIGN_PUB },
  { name: "pure-extended (128-hex → seedType chainweaver)", publicKey: PURE_EXTENDED_PUB },
  { name: "derived-koala (64-hex, no truncation)", publicKey: DERIVED_SEED_PUB },
  { name: "derived-truncated (>64 hex → sliced to 64)", publicKey: DERIVED_TRUNC_SEED_PUB },
].map((c) => ({
  ...c,
  password: CODEX_PASSWORD,
  expected: resolveGolden(snapshot, c.publicKey, CODEX_PASSWORD, seam),
}));

// --- The seam maps the CI test rebuilds a deterministic seam from ---
const seamData = {
  decryptSecret: {
    [PURE_FOREIGN_MNEMONIC_SECRET]: FOREIGN_PRIVATE_KEY_64,
    [PURE_EXTENDED_MNEMONIC_SECRET]: EXTENDED_PRIVATE_KEY_128,
    [SEED_MNEMONIC_CIPHER]: SEED_PLAINTEXT_MNEMONIC,
  },
  extendedForeignPassword: EXTENDED_FOREIGN_SCRAMBLE_PW,
  extendedForeignEncryptedSecretKey: EXTENDED_ENCRYPTED_SECRET,
  deriveByIndex: {
    0: { publicKey: DERIVED_REDERIVED_PUB, secretKey: DERIVED_ENCRYPTED_SECRET },
    1: { publicKey: DERIVED_TRUNC_SEED_PUB, secretKey: { __kind: "trunc", of: "long" } },
  },
  toHexByMarker: {
    trunc: DERIVED_LONG_HEX_192,
    default: DERIVED_DECRYPTED_HEX_64,
  },
};

const fixture = {
  __WARNING__: "THROWAWAY test material — no real funds; never reuse",
  __provenance__:
    "Generated by tests/fixtures/generate-resolver-parity-golden.mjs. Reproducible: re-run and diff. " +
    "Models InternalCodexResolver.ts L124-198 + L77-93 seam contracts; pins @stoachain/stoa-core@4.3.6 + " +
    "@stoachain/kadena-stoic-legacy@4.3.6 (the versions D5 binds). NOT a real-KDF byte proof — that is a D5 " +
    "live-resolver cross-check (see D4-COORDINATION-NOTE residual gap).",
  password: CODEX_PASSWORD,
  snapshot,
  seam: seamData,
  cases,
  // Explicit expected-truncation anchor for the reviewer.
  __truncationAnchor__: {
    longHex192: DERIVED_LONG_HEX_192,
    truncatedTo64: DERIVED_TRUNCATED_HEX_64,
  },
};

process.stdout.write(JSON.stringify(fixture, null, 2) + "\n");
