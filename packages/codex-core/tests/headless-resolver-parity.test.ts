/**
 * PARITY GOLDEN-FIXTURE REPLAY — the D-08 success criterion.
 *
 * "Parity tests prove the factory's decrypt output equals the existing resolver
 * path for the same encrypted blob and password." (discussion D6, requirement
 * D-08.) This is FUNDS-CRITICAL: if the headless factory resolves a pubkey to a
 * DIFFERENT keypair than the browser resolver, a server consumer signs with the
 * wrong key.
 *
 * ---------------------------------------------------------------------------
 * WHY A SELF-CONTAINED REPLAY (not a live cross-package import)
 * ---------------------------------------------------------------------------
 * The real browser resolver (`InternalCodexResolver`) lives in
 * `packages/codex-ouronet`, which is an EMPTY SKELETON at D4 execution time
 * (the C-phase rewire to consume core is D5/Phase 9). It also pulls Zustand +
 * React, which codex-core must not depend on. So we CANNOT import the live
 * resolver here. Instead this test is an ALGORITHM-EQUIVALENCE REPLAY, fully
 * self-contained in codex-core:
 *
 *   (a) the new `createHeadlessCodexResolver(deps).getKeyPairByPublicKey`, AND
 *   (b) `transcribedBrowserResolve(...)` below — an in-test FAITHFUL
 *       TRANSCRIPTION of the browser resolver's `getKeyPairByPublicKey` body
 *       (`InternalCodexResolver.ts` L124-198) MINUS the browser coupling (no
 *       `passwordCache` gate, no Zustand `getState()`: the same snapshot +
 *       password are fed directly).
 *
 * BOTH share the EXACT SAME injected crypto seam (built from the committed
 * golden fixture's `seam` maps). Because the seam is identical, any output
 * difference is a PLUMBING difference (wrong array, wrong branch, missing
 * truncation, wrong seedType tag) — so byte-identical output PROVES structural
 * parity, not a stale snapshot. We ALSO assert both equal the fixture's
 * pre-committed `expected` output (the golden anchor: catches drift if BOTH the
 * factory and the transcription regress together).
 *
 * ---------------------------------------------------------------------------
 * THE TRANSCRIPTION IS THE PARITY ANCHOR — keep it L-for-L with the source.
 * ---------------------------------------------------------------------------
 * `transcribedBrowserResolve` below MIRRORS `InternalCodexResolver.ts` L124-198
 * line-for-line (the four branches, the `length === 128` fork, the `> 64`
 * truncation, the seedType tags, the not-found path) — MINUS the auth gate
 * (L127-132) and the Zustand `getState()` (L125), which the headless model
 * drops by design. T8.3's GREEN factory must match THIS body byte-for-byte.
 *
 * RESIDUAL GAP (plan P-001): the transcription is a SURROGATE for the live
 * resolver — a hand copy can silently drift from the real source. D5/Phase 9
 * MUST add a cross-package parity test that replays this same golden fixture
 * through the LIVE `InternalCodexResolver` once codex-ouronet consumes core.
 *
 * ---------------------------------------------------------------------------
 * SECRET HYGIENE (funds-critical, N-06)
 * ---------------------------------------------------------------------------
 * The fixture material is COMMITTED THROWAWAY (header `__WARNING__`). This test
 * NEVER `console.log`s any decrypted private material — all parity comparisons
 * are in-memory deep-equals. The throwaway sentinels are high-entropy so the
 * secret-hygiene guards are meaningful.
 *
 * RED: `../src/resolver` does not exist yet (no `src/resolver/`; `src/index.ts`
 * has no resolver export) — this whole file fails to import until T8.3 lands
 * the factory subpath barrel.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// RED: the factory subpath barrel does not exist yet. T8.3 (Wave 2) creates it.
import {
  createHeadlessCodexResolver,
  type ResolvedStoaChainKeypair,
  type HeadlessResolverDeps,
  type SnapshotSlice,
} from "../src/resolver/index.js";

// ---------------------------------------------------------------------------
// Golden fixture (committed THROWAWAY material)
// ---------------------------------------------------------------------------

interface GoldenSeam {
  decryptSecret: Record<string, string>;
  extendedForeignPassword: string;
  extendedForeignEncryptedSecretKey: unknown;
  deriveByIndex: Record<string, { publicKey: string; secretKey: unknown }>;
  toHexByMarker: { trunc: string; default: string };
}

interface GoldenCase {
  name: string;
  publicKey: string;
  password: string;
  expected: ResolvedStoaChainKeypair;
}

interface GoldenFixture {
  __WARNING__: string;
  password: string;
  snapshot: SnapshotSlice;
  seam: GoldenSeam;
  cases: GoldenCase[];
  __truncationAnchor__: { longHex192: string; truncatedTo64: string };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "resolver-parity-golden.json"), "utf8"),
) as GoldenFixture;

// ---------------------------------------------------------------------------
// The deterministic seam — rebuilt from the fixture's own maps so both the
// factory and the transcription share IDENTICAL injected primitives.
// ---------------------------------------------------------------------------

function markerOf(secret: unknown): "trunc" | "default" {
  return (secret as { __kind?: string })?.__kind === "trunc" ? "trunc" : "default";
}

function makeGoldenSeam(seam: GoldenSeam): HeadlessResolverDeps {
  return {
    async decryptSecret(ciphertext: string): Promise<string> {
      const plain = seam.decryptSecret[ciphertext];
      if (plain === undefined) {
        throw new Error("golden seam: unknown ciphertext (fixture drift)");
      }
      return plain;
    },
    async deriveStoaChainKeypair(_password, _mnemonic, index): Promise<{ publicKey: string; secretKey: unknown }> {
      const entry = seam.deriveByIndex[String(index)];
      if (!entry) throw new Error("golden seam: unknown derive index (fixture drift)");
      return { publicKey: entry.publicKey, secretKey: entry.secretKey };
    },
    async decryptWalletSecret(_password, encryptedSecretKey): Promise<Uint8Array> {
      // The real kadenaDecrypt returns a Uint8Array; the fixture carries the
      // marker through so toHex can map it to the right hex length. We stash the
      // marker on a branded object the fake toHex reads (in-memory only).
      return { __marker: markerOf(encryptedSecretKey) } as unknown as Uint8Array;
    },
    async buildExtendedForeignKey(): Promise<{ encryptedSecretKey: unknown; password: string }> {
      return {
        encryptedSecretKey: seam.extendedForeignEncryptedSecretKey,
        password: seam.extendedForeignPassword,
      };
    },
    toHex(bytes: Uint8Array): string {
      const marker = (bytes as unknown as { __marker?: "trunc" | "default" }).__marker ?? "default";
      return seam.toHexByMarker[marker];
    },
    collectCodexPubs(kadenaSeeds, pureKeypairs): Set<string> {
      const set = new Set<string>();
      for (const p of pureKeypairs ?? []) set.add(p.publicKey);
      for (const s of kadenaSeeds ?? []) for (const a of s.accounts ?? []) set.add(a.publicKey);
      return set;
    },
  };
}

// ---------------------------------------------------------------------------
// PARITY ANCHOR — faithful transcription of InternalCodexResolver.ts L124-198.
// Mirrors the source line-for-line MINUS the auth gate (L127-132) and the
// Zustand getState() (L125), which the headless model drops. The seedType tags,
// the length===128 fork, and the >64 truncation are copied verbatim.
// ---------------------------------------------------------------------------

async function transcribedBrowserResolve(
  snapshot: SnapshotSlice,
  publicKey: string,
  password: string,
  deps: HeadlessResolverDeps,
): Promise<ResolvedStoaChainKeypair> {
  const pureKeypairs = snapshot.pureKeypairs ?? [];
  const kadenaSeeds = snapshot.kadenaSeeds ?? [];

  // 1. Pure-keypair lookup (InternalCodexResolver.ts:134-161).
  const purePair = pureKeypairs.find((k) => k.publicKey === publicKey);
  if (purePair) {
    const privateKey = await deps.decryptSecret(purePair.encryptedPrivateKey, password);
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

  // 2. Derived-account lookup (InternalCodexResolver.ts:163-198).
  for (const seed of kadenaSeeds) {
    const account = (seed.accounts ?? []).find((a) => a.publicKey === publicKey);
    if (!account) continue;

    const mnemonic = await deps.decryptSecret(seed.secret, password);
    const { publicKey: pub, secretKey: encryptedSecretKey } = await deps.deriveStoaChainKeypair(
      password,
      mnemonic,
      account.index,
      seed.seedType,
    );
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

  // 3. Not found — the transcription is only exercised on present keys here.
  throw new Error(`transcription: ${publicKey} not found`);
}

// ---------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------

describe("headless resolver — golden-fixture parity replay (D-08 success criterion)", () => {
  it("the committed fixture is flagged THROWAWAY (no real funds)", () => {
    // Secret hygiene: the fixture MUST self-identify as throwaway so no reviewer
    // mistakes it for real key material.
    expect(fixture.__WARNING__).toContain("THROWAWAY");
    expect(fixture.__WARNING__).toContain("no real funds");
  });

  for (const testCase of [
    "pure-foreign (64-hex → seedType foreign)",
    "pure-extended (128-hex → seedType chainweaver)",
    "derived-koala (64-hex, no truncation)",
    "derived-truncated (>64 hex → sliced to 64)",
  ]) {
    it(`factory output === browser-resolver transcription === golden expected: ${testCase}`, async () => {
      const gc = fixture.cases.find((c) => c.name === testCase);
      expect(gc, `fixture must contain case "${testCase}"`).toBeDefined();
      const { publicKey, password, expected } = gc!;

      const deps = makeGoldenSeam(fixture.seam);
      const resolver = createHeadlessCodexResolver(deps);

      // (a) the new factory over the golden snapshot + password.
      const fromFactory = await resolver.getKeyPairByPublicKey(fixture.snapshot, publicKey, password);
      // (b) the faithful browser-resolver transcription over the SAME inputs + seam.
      const fromTranscription = await transcribedBrowserResolve(
        fixture.snapshot,
        publicKey,
        password,
        deps,
      );

      // Structural parity: factory === browser transcription (same seam → any
      // diff is a plumbing bug). Byte-identical across EVERY field.
      expect(fromFactory).toEqual(fromTranscription);
      // Golden anchor: both equal the pre-committed expected (catches co-drift).
      expect(fromFactory).toEqual(expected);
    });
  }

  it("pure-keypair 64-hex path resolves to seedType 'foreign' with NO wallet secret/password fields", async () => {
    // The plain-foreign branch (privateKey.length !== 128) returns exactly
    // { publicKey, privateKey, seedType: "foreign" } — no encryptedSecretKey,
    // no password (InternalCodexResolver.ts:156-160).
    const gc = fixture.cases.find((c) => c.name.startsWith("pure-foreign"))!;
    const resolver = createHeadlessCodexResolver(makeGoldenSeam(fixture.seam));
    const out = await resolver.getKeyPairByPublicKey(fixture.snapshot, gc.publicKey, gc.password);

    expect(out.seedType).toBe("foreign");
    expect(out.privateKey.length).toBe(64);
    expect(out.encryptedSecretKey).toBeUndefined();
    expect(out.password).toBeUndefined();
  });

  it("extended 128-hex path returns seedType 'chainweaver' and the REAL EXTENDED_FOREIGN_SCRAMBLE_PW ('codex-extended-foreign')", async () => {
    // Funds-critical (bug F-002): universalSignTransaction gates the Chainweaver
    // WASM path on password === "codex-extended-foreign". If D5 binds a
    // buildExtendedForeignKey returning a different value, extended-key signing
    // breaks — so the golden pins the exact constant from
    // InternalCodexResolver.ts:56, returned at :152-153.
    const gc = fixture.cases.find((c) => c.name.startsWith("pure-extended"))!;
    const resolver = createHeadlessCodexResolver(makeGoldenSeam(fixture.seam));
    const out = await resolver.getKeyPairByPublicKey(fixture.snapshot, gc.publicKey, gc.password);

    expect(out.privateKey.length).toBe(128);
    expect(out.seedType).toBe("chainweaver");
    expect(out.password).toBe("codex-extended-foreign");
    expect(out.encryptedSecretKey).toBeDefined();
  });

  it("derived path applies the >64 hex truncation (slices the 192-hex decrypt to its first 64 chars)", async () => {
    // The derived branch truncates toHex output > 64 to the first 64 chars
    // (InternalCodexResolver.ts:189). The fixture's truncation anchor pins the
    // exact slice so a dropped truncation (which would ship a 192-hex private
    // key) fails loudly.
    const gc = fixture.cases.find((c) => c.name.startsWith("derived-truncated"))!;
    const resolver = createHeadlessCodexResolver(makeGoldenSeam(fixture.seam));
    const out = await resolver.getKeyPairByPublicKey(fixture.snapshot, gc.publicKey, gc.password);

    expect(fixture.__truncationAnchor__.longHex192.length).toBe(192);
    expect(out.privateKey).toBe(fixture.__truncationAnchor__.truncatedTo64);
    expect(out.privateKey.length).toBe(64);
    expect(out.privateKey).toBe(fixture.__truncationAnchor__.longHex192.slice(0, 64));
  });

  it("derived koala path passes the seed's seedType through verbatim ('koala')", async () => {
    // seedType passthrough (audit F-BUG-001): the derived path returns
    // seed.seedType verbatim — a koala seed yields seedType "koala", proving the
    // ResolvedStoaChainKeypair union includes "koala" (not just foreign/chainweaver).
    const gc = fixture.cases.find((c) => c.name.startsWith("derived-koala"))!;
    const resolver = createHeadlessCodexResolver(makeGoldenSeam(fixture.seam));
    const out = await resolver.getKeyPairByPublicKey(fixture.snapshot, gc.publicKey, gc.password);

    expect(out.seedType).toBe("koala");
    expect(out.password).toBe(gc.password);
    expect(out.encryptedSecretKey).toBeDefined();
  });

  it("NO decrypted private material appears verbatim in any resolved output's stringify beyond the keypair fields (throwaway-safe by construction)", async () => {
    // Sanity guard on the FIXTURE's own hygiene: the committed golden 'expected'
    // outputs never carry the codex password as a stray field on the pure paths
    // (only the derived/extended branches legitimately carry a transient
    // password, mirroring InternalCodexResolver.ts:153/:197).
    const pureForeign = fixture.cases.find((c) => c.name.startsWith("pure-foreign"))!;
    expect(JSON.stringify(pureForeign.expected)).not.toContain(fixture.password);

    const extended = fixture.cases.find((c) => c.name.startsWith("pure-extended"))!;
    // Extended branch's password is the scramble constant, NOT the codex password.
    expect(extended.expected.password).toBe("codex-extended-foreign");
    expect(JSON.stringify(extended.expected)).not.toContain(fixture.password);
  });
});
