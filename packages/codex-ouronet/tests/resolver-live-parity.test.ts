/**
 * CROSS-PACKAGE LIVE-PARITY — closes D4's residual gap P-001 (FUNDS-CRITICAL).
 *
 * The D4 coordination note (item 5 / §8) mandates as a FIRM D5 obligation a
 * cross-package parity test that runs the REAL crypto through the LIVE,
 * core-backed `InternalCodexResolver` once codex-ouronet consumes core — the
 * task that provably closes the transcription-vs-live gap.
 *
 * ---------------------------------------------------------------------------
 * WHY A NEW REAL-KDF FIXTURE (Option A — the conductor's decision)
 * ---------------------------------------------------------------------------
 * D4's golden fixture
 * (packages/codex-core/tests/fixtures/resolver-parity-golden.json) is
 * DETERMINISTIC-FAKE: sentinel 64-hex pubkeys, a lookup-table "seam" mapping
 * ciphertext strings to plaintext, and a tagged-object `encryptedSecretKey`.
 * It proves the resolver's PLUMBING (which array, which branch, the
 * length===128 fork, the >64 truncation, the seedType tags) — NOT the real
 * KDF/cipher bytes. Replaying its raw values through the LIVE real-@stoachain
 * resolver CANNOT reproduce its fake `expected`: real `smartDecrypt` rejects
 * the sentinel "throwaway-…-cipher" strings. So this test does NOT replay D4's
 * fake JSON. It uses a NEW real-KDF THROWAWAY fixture
 * (`tests/fixtures/resolver-live-fixture.json`, emitted by
 * `tests/fixtures/generate-resolver-live-fixture.mjs`) whose blobs are REAL V2
 * AES-GCM / PBKDF2-SHA512-600k ciphertexts and whose derived expected outputs
 * were computed by the REAL `KadenaWalletBuilder`. This is the TRUE live
 * byte-proof: real encrypt → real decrypt → real derive round-trips to the
 * known throwaway values.
 *
 * The fixture uses V2 blobs ONLY, to sidestep the pre-existing
 * `@stoachain/stoa-core/dist/crypto/v2.js` extensionless `import("./v1")` bug
 * that only triggers on the legacy V1 encode/decode path. Both the generator's
 * emit and the live resolver's `smartDecrypt` take the V2 branch — never `./v1`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS RED NOW (the P-001 closure driver)
 * ---------------------------------------------------------------------------
 * Two independent, structural reasons the parity cases FAIL at Wave 1 and GREEN
 * only when T9.6 (Wave 4) lands the rewire:
 *
 *   1. `@ancientpantheon/codex-core`'s resolver types (`ResolvedKadenaKeypair`)
 *      are not resolvable from codex-ouronet's test env yet — codex-core is a
 *      declared `workspace:*` dep with NO cross-package vitest alias (T9.6 adds
 *      the `@ancientpantheon/codex-core` alias to `vitest.config.ts`).
 *   2. The live `InternalCodexResolver` is NOT yet a thin binding onto core's
 *      factory — it still runs its own inline `@stoachain` path. T9.6 makes it
 *      delegate to `createHeadlessCodexResolver`, KEEPING the browser auth gate
 *      (`passwordCache` → `CodexLockedError`) as the wrapper.
 *
 * ---------------------------------------------------------------------------
 * THE AUTH-GATE SEEDING (the load-bearing correction, kept from prior attempt)
 * ---------------------------------------------------------------------------
 * `InternalCodexResolver.getKeyPairByPublicKey(publicKey)` takes NO password arg.
 * It reads `store.getState().passwordCache` and throws `CodexLockedError` BEFORE
 * any decrypt (`InternalCodexResolver.ts:124-131`). So the parity replay:
 *   (1) builds the LIVE Zustand store from the fixture's snapshot slice;
 *   (2) SEEDS a non-expired `passwordCache` via the store's REAL unlock action
 *       `actions.authenticate(password, ttlMinutes)` with the throwaway password;
 *   (3) constructs the LIVE core-backed `InternalCodexResolver(store)`;
 *   (4) calls `getKeyPairByPublicKey(pub)` (NO password arg) and asserts the
 *       returned keypair is BYTE-IDENTICAL to the fixture's real expected.
 * A SEPARATE case asserts a LOCKED store throws `CodexLockedError` BEFORE any
 * decrypt — keeping the GATE concern distinct from the DECRYPT-parity concern.
 *
 * ---------------------------------------------------------------------------
 * SECRET HYGIENE (funds-critical)
 * ---------------------------------------------------------------------------
 * The fixture material is COMMITTED THROWAWAY (header `__WARNING__`). This is
 * where real `@stoachain` decrypt runs against real ciphertext — it NEVER
 * `console.log`s any decrypted private key / mnemonic / password; all parity
 * comparisons are in-memory deep-equals. The throwaway flag is re-asserted so
 * no reviewer mistakes the fixture for real key material.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { InternalCodexResolver } from "@ancientpantheon/codex-ouronet/resolver";
import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";
import type {
  IKadenaSeed,
  IPureKeypair,
} from "@ancientpantheon/codex-ouronet/types";

// The REAL @stoachain primitives — the exact seam the live resolver runs
// inline today and that T9.6 injects into core's headless factory. Bound here
// so the cross-package parity assertion feeds core the SAME crypto the live
// resolver uses (identical primitives → any output diff is a plumbing drift).
import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import { KadenaWalletBuilder } from "@stoachain/stoa-core/wallet";
import { toHexString } from "@stoachain/stoa-core/signing";
import { buildCodexPubSet } from "@stoachain/stoa-core/guard";
import { kadenaDecrypt, kadenaEncrypt } from "@stoachain/kadena-stoic-legacy/hd-wallet";
import { legacyKadenaChangePassword } from "@stoachain/kadena-stoic-legacy/hd-wallet/chainweaver";
import { hexToBin } from "@stoachain/kadena-stoic-legacy/cryptography-utils";

// RED driver #1 (RUNTIME): codex-core's public entry is NOT resolvable from
// codex-ouronet's test env yet — `@ancientpantheon/codex-core` is a declared
// `workspace:*` dep with NO cross-package vitest alias (T9.6 adds the
// `@ancientpantheon/codex-core` alias to `vitest.config.ts` when it rewires
// InternalCodexResolver onto this very factory). Because this is a VALUE import
// (not `import type`), esbuild does NOT strip it — the module load throws
// `ERR_PACKAGE_PATH_NOT_EXPORTED` NOW, failing every case in this file until
// T9.6 wires the alias. `createHeadlessCodexResolver` is the exact factory the
// live resolver delegates to after T9.6, so importing it here pins the
// cross-package seam the live proof depends on.
import { createHeadlessCodexResolver } from "@ancientpantheon/codex-core";
import type { ResolvedKadenaKeypair } from "@ancientpantheon/codex-core";
// The REAL signing-ready keypair type the resolver's KeyResolver contract
// returns — the assignability cross-check target (D4 note item 3).
import type { IKadenaKeypair } from "@stoachain/stoa-core/signing";

// ---------------------------------------------------------------------------
// Real-KDF fixture (committed THROWAWAY material) — read-only, never mutated.
// ---------------------------------------------------------------------------

interface LiveCase {
  name: string;
  publicKey: string;
  expected: {
    publicKey: string;
    privateKey: string;
    seedType: string;
    password?: string;
  };
}

interface LiveFixture {
  __WARNING__: string;
  password: string;
  snapshot: {
    pureKeypairs: Array<{ publicKey: string; encryptedPrivateKey: string }>;
    kadenaSeeds: Array<{
      secret: string;
      seedType: "koala" | "chainweaver" | "eckowallet";
      accounts: Array<{ publicKey: string; index: number }>;
    }>;
  };
  cases: LiveCase[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "resolver-live-fixture.json",
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as LiveFixture;

// The exact throwaway codex password the fixture encrypted its blobs at. The
// value SEEDED into passwordCache MUST equal this exactly — smartDecrypt fails
// otherwise, and the derived branch returns `password` = the cache value, so a
// mismatch surfaces as a decrypt regression rather than a clear failure.
const CODEX_PASSWORD = fixture.password;
const EXTENDED_FOREIGN_SCRAMBLE_PW = "codex-extended-foreign";

/**
 * Hydrate the fixture's snapshot slice into IKadenaSeed[] / IPureKeypair[] the
 * live store's `addKadenaSeed` / `addPureKeypair` actions accept. The fixture's
 * minimal shapes are widened with the id/version/createdAt metadata the store
 * entities require — the resolve algorithm reads only the pubkey/secret/index
 * fields the fixture carries, so the synthesized metadata is inert to parity.
 */
function fixturePureKeypairs(): IPureKeypair[] {
  return fixture.snapshot.pureKeypairs.map((p, i) => ({
    id: `fixture-pure-${i}`,
    label: `fixture pure ${i}`,
    publicKey: p.publicKey,
    encryptedPrivateKey: p.encryptedPrivateKey,
    createdAt: "2026-07-05T00:00:00.000Z",
  }));
}

function fixtureKadenaSeeds(): IKadenaSeed[] {
  return fixture.snapshot.kadenaSeeds.map((s, i) => ({
    id: `fixture-seed-${i}`,
    name: `fixture seed ${i}`,
    seedType: s.seedType,
    version: "2",
    index: 0,
    secret: s.secret,
    main: "",
    createdAt: "2026-07-05T00:00:00.000Z",
    accounts: s.accounts.map((a) => ({
      index: a.index,
      publicKey: a.publicKey,
      derivationPath: `m/44'/626'/0'/0/${a.index}`,
    })),
  }));
}

/** Build a live store hydrated with the fixture snapshot. Does NOT unlock — the
 *  caller decides whether to seed passwordCache (parity) or leave it locked
 *  (the gate assertion). */
async function buildFixtureStore(): Promise<
  ReturnType<typeof createCodexStore>
> {
  const store = createCodexStore();
  await store.getState().actions.init(new MemoryCodexAdapter("dev"), "dev");
  for (const seed of fixtureKadenaSeeds()) {
    await store.getState().actions.addKadenaSeed(seed);
  }
  for (const kp of fixturePureKeypairs()) {
    await store.getState().actions.addPureKeypair(kp);
  }
  return store;
}

function liveCase(name: string): LiveCase {
  const lc = fixture.cases.find((c) => c.name === name);
  if (!lc) throw new Error(`live fixture missing case "${name}"`);
  return lc;
}

/** The transient scramble password the extended-key repackage uses — mirrors
 *  InternalCodexResolver.ts:56. Must be identical between the re-scramble and
 *  the returned keypair `password` so the WASM signer un-scrambles correctly. */
const CORE_SEAM_EXTENDED_PW = "codex-extended-foreign";

/**
 * Bind the REAL @stoachain primitives into core's HeadlessResolverDeps seam —
 * the SAME binding T9.6 injects when it rewires InternalCodexResolver onto
 * `createHeadlessCodexResolver`. Mirrors InternalCodexResolver.ts:77-93 for the
 * extended-key repackage. Feeding core the identical crypto the live resolver
 * uses makes the cross-package equality a plumbing-parity proof, not a crypto
 * difference. Reads/returns nothing secret to stdout.
 */
function realStoaSeam() {
  return {
    decryptSecret: (ciphertext: string, password: string) =>
      smartDecrypt(ciphertext, password),
    deriveKadenaKeypair: (
      password: string,
      mnemonic: string,
      index: number,
      seedType: "koala" | "chainweaver" | "eckowallet",
    ) =>
      KadenaWalletBuilder.createWalletPairFromMnemonic(
        password,
        mnemonic,
        index,
        seedType,
      ),
    decryptWalletSecret: (password: string, encryptedSecretKey: unknown) =>
      kadenaDecrypt(password, encryptedSecretKey as never),
    buildExtendedForeignKey: async (
      extendedPrivHex: string,
      publicKeyHex: string,
    ) => {
      const xprv = new Uint8Array(128);
      xprv.set(hexToBin(extendedPrivHex), 0);
      xprv.set(hexToBin(publicKeyHex), 64);
      const scrambled = new Uint8Array(
        await legacyKadenaChangePassword(xprv, "", CORE_SEAM_EXTENDED_PW),
      );
      const encryptedSecretKey = await kadenaEncrypt(
        CORE_SEAM_EXTENDED_PW,
        scrambled,
      );
      return { encryptedSecretKey, password: CORE_SEAM_EXTENDED_PW };
    },
    toHex: (bytes: Uint8Array) => toHexString(bytes),
    collectCodexPubs: (kadenaSeeds: unknown[], pureKeypairs: unknown[]) =>
      buildCodexPubSet(kadenaSeeds as never, [], pureKeypairs as never),
  };
}

/** The plain snapshot slice core's factory reads (no store, no metadata). */
function fixtureSnapshotSlice() {
  return {
    pureKeypairs: fixture.snapshot.pureKeypairs,
    kadenaSeeds: fixture.snapshot.kadenaSeeds,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("InternalCodexResolver — real-KDF live parity (closes D4 P-001)", () => {
  it("the fixture is flagged THROWAWAY (no real funds — secret hygiene)", () => {
    // Real decrypt runs against this material; it MUST self-identify as
    // throwaway so no reviewer mistakes it for real key material.
    expect(fixture.__WARNING__).toContain("THROWAWAY");
    expect(fixture.__WARNING__).toContain("no real funds");
  });

  it("codex-core's headless factory is the cross-package seam the live resolver binds", () => {
    // Runtime touch of the imported value so the cross-package dependency is
    // real (not tree-shaken) — the module load fails NOW without the T9.6
    // vitest alias, and this pins the factory the live resolver delegates to.
    expect(typeof createHeadlessCodexResolver).toBe("function");
  });

  describe("real round-trip through the LIVE core-backed resolver", () => {
    let store: ReturnType<typeof createCodexStore>;

    beforeEach(async () => {
      store = await buildFixtureStore();
      // SEED a non-expired passwordCache via the store's REAL unlock action at
      // the throwaway password the fixture blobs were encrypted with. 60 min
      // TTL keeps the cache non-expired for the whole test.
      store.getState().actions.authenticate(CODEX_PASSWORD, 60);
    });

    it("pure-foreign: real V2 decrypt → known 64-hex private key, seedType foreign, no password", async () => {
      // The plain-foreign path (privateKey.length !== 128) returns exactly
      // { publicKey, privateKey, seedType: "foreign" }. Byte-equal proves the
      // live resolver's real smartDecrypt recovered the known throwaway key
      // and took the correct (non-extended) branch.
      const lc = liveCase("pure-foreign");
      const resolver = new InternalCodexResolver(store);
      const resolved = await resolver.getKeyPairByPublicKey(lc.publicKey);

      expect(resolved.publicKey).toBe(lc.expected.publicKey);
      expect(resolved.privateKey).toBe(lc.expected.privateKey);
      expect(resolved.seedType).toBe("foreign");
      expect(resolved.password).toBeUndefined();
      expect(resolved.encryptedSecretKey).toBeUndefined();

      // CROSS-PACKAGE parity (RED until T9.6 wires the codex-core alias): the
      // live resolver and core's headless factory, fed the SAME real seam, must
      // resolve BYTE-IDENTICALLY. A diff means the live rewire drifted from the
      // canonical headless algorithm — the funds-safety regression P-001 guards.
      const core = createHeadlessCodexResolver(realStoaSeam());
      const coreResolved = await core.getKeyPairByPublicKey(
        fixtureSnapshotSlice(),
        lc.publicKey,
        CODEX_PASSWORD,
      );
      expect(coreResolved).toEqual(resolved);
    }, 15000);

    it("pure-extended: real 128-hex extended key routes to the chainweaver WASM branch", async () => {
      // length === 128 → the extended-key path. buildExtendedForeignSigningKey
      // returns the fixed EXTENDED_FOREIGN_SCRAMBLE_PW; universalSignTransaction
      // gates the Chainweaver WASM path on that exact constant (funds-critical).
      const lc = liveCase("pure-extended");
      const resolver = new InternalCodexResolver(store);
      const resolved = await resolver.getKeyPairByPublicKey(lc.publicKey);

      expect(resolved.publicKey).toBe(lc.expected.publicKey);
      expect(resolved.privateKey).toBe(lc.expected.privateKey);
      expect(resolved.privateKey.length).toBe(128);
      expect(resolved.seedType).toBe("chainweaver");
      expect(resolved.password).toBe(EXTENDED_FOREIGN_SCRAMBLE_PW);
      expect(lc.expected.password).toBe(EXTENDED_FOREIGN_SCRAMBLE_PW);
      // A fresh AES-wrap per call — asserted present, not byte-pinned.
      expect(resolved.encryptedSecretKey).toBeDefined();

      // CROSS-PACKAGE parity (RED until T9.6): live vs core on the extended
      // branch must agree on the deterministic fields. encryptedSecretKey is a
      // fresh per-call AES-wrap on BOTH sides, so compare the stable fields.
      const core = createHeadlessCodexResolver(realStoaSeam());
      const coreResolved = await core.getKeyPairByPublicKey(
        fixtureSnapshotSlice(),
        lc.publicKey,
        CODEX_PASSWORD,
      );
      expect(coreResolved.publicKey).toBe(resolved.publicKey);
      expect(coreResolved.privateKey).toBe(resolved.privateKey);
      expect(coreResolved.seedType).toBe(resolved.seedType);
      expect(coreResolved.password).toBe(resolved.password);
    }, 15000);

    it("derived-koala: real BIP39/SLIP-10 derivation → known pubkey + 64-hex private key", async () => {
      // The seed's mnemonic is real-V2-decrypted, then re-derived at index 0 via
      // the REAL KadenaWalletBuilder. Byte-equality on the derived pubkey +
      // private-key hex is the core live proof: real decrypt → real derive
      // round-trips to the known throwaway values.
      const lc = liveCase("derived-koala");
      const resolver = new InternalCodexResolver(store);
      const resolved = await resolver.getKeyPairByPublicKey(lc.publicKey);

      expect(resolved.publicKey).toBe(lc.expected.publicKey);
      expect(resolved.privateKey).toBe(lc.expected.privateKey);
      expect(resolved.privateKey).toHaveLength(64);
      expect(resolved.seedType).toBe("koala");
      // The derived path returns `password` = the codex cache value. It MUST
      // equal EXACTLY the seeded throwaway password — a mismatch is a
      // password-consistency bug, not a decrypt regression.
      expect(resolved.password).toBe(CODEX_PASSWORD);
      expect(lc.expected.password).toBe(CODEX_PASSWORD);
      expect(resolved.encryptedSecretKey).toBeDefined();

      // CROSS-PACKAGE parity (RED until T9.6): live vs core on the derived
      // branch must agree byte-for-byte on the deterministic fields (the
      // encryptedSecretKey blob is a fresh per-derivation @kadena/hd-wallet
      // EncryptedString on both sides, so it is not byte-comparable).
      const core = createHeadlessCodexResolver(realStoaSeam());
      const coreResolved = await core.getKeyPairByPublicKey(
        fixtureSnapshotSlice(),
        lc.publicKey,
        CODEX_PASSWORD,
      );
      expect(coreResolved.publicKey).toBe(resolved.publicKey);
      expect(coreResolved.privateKey).toBe(resolved.privateKey);
      expect(coreResolved.seedType).toBe(resolved.seedType);
      expect(coreResolved.password).toBe(resolved.password);
    }, 15000);
  });

  describe("auth gate — locked store throws BEFORE decrypt", () => {
    it("a store with NO passwordCache throws CodexLockedError (never reaches decrypt)", async () => {
      const store = await buildFixtureStore();
      // No authenticate() call — passwordCache stays null, store stays locked.
      const resolver = new InternalCodexResolver(store);
      const lc = liveCase("pure-foreign");

      await expect(
        resolver.getKeyPairByPublicKey(lc.publicKey),
      ).rejects.toThrow(CodexLockedError);
    });

    it("a store with an EXPIRED passwordCache throws CodexLockedError (never reaches decrypt)", async () => {
      const store = await buildFixtureStore();
      // Seed then force-expire the cache: TTL 0 → expiresAt <= Date.now().
      store.getState().actions.authenticate(CODEX_PASSWORD, 0);
      const resolver = new InternalCodexResolver(store);
      const lc = liveCase("pure-foreign");

      await expect(
        resolver.getKeyPairByPublicKey(lc.publicKey),
      ).rejects.toThrow(CodexLockedError);
    });
  });

  describe("assignability cross-check (D5 obligation, type-level)", () => {
    it("ResolvedKadenaKeypair (D4 structural return) is assignable to the real IKadenaKeypair", async () => {
      // Compile-time proof: a value typed as D4's ResolvedKadenaKeypair binds to
      // the real @stoachain IKadenaKeypair without a cast. This is the D5
      // assignability obligation — if the two shapes drift (e.g. a truncated
      // seedType union or a string-coerced encryptedSecretKey), this fails `tsc`.
      // At runtime we replay one real case through the type to keep the
      // assertion honest (not a bare typecheck-only stub).
      const store = await buildFixtureStore();
      store.getState().actions.authenticate(CODEX_PASSWORD, 60);
      const resolver = new InternalCodexResolver(store);
      const lc = liveCase("derived-koala");

      const resolved: ResolvedKadenaKeypair =
        await resolver.getKeyPairByPublicKey(lc.publicKey);
      // The load-bearing line: ResolvedKadenaKeypair → IKadenaKeypair with no cast.
      const asContract: IKadenaKeypair = resolved;

      expect(asContract.publicKey).toBe(lc.expected.publicKey);
      expect(asContract.seedType).toBe(lc.expected.seedType);
    }, 15000);
  });
});
