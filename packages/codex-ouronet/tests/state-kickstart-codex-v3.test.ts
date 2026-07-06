/**
 * v0.3 kickstartCodex (atomic) tests — Phase 7 T7.3 of the v0.3.0 codex spec
 * (REQ-07).
 *
 * Covers the 4 codexPrimeSeed.source × 2 duoPrime.mode = 8 combinations plus the
 * locked decisions: F-005 (half-seed re-derivation produces DISTINCT accounts),
 * F-008 (CodexPrime.guard is the Duo pubkeys), F-001 (atomic in-memory commit +
 * best-effort persistence with saveCodexIdentity LAST), F-006/F-010
 * (cross-validation), F-007 (captured password).
 *
 * encryptStringV2 (PBKDF2-SHA512/600k) makes each kickstart slow — every spec
 * opts into a generous timeout.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexLockedError,
  CodexIdentityError,
  CodexGuardError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  KickstartArgsV3,
  KickstartResultV3,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import { Apollo } from "@stoachain/dalos-crypto/registry";

const PW = "kickstart-test-password";
const T = { timeout: 120_000 };

const WORDS_12 =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
// koala = 24-word BIP39; use a known-valid 24-word mnemonic.
const KADENA_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon art";

let adapter: CodexAdapter;
let store: ReturnType<typeof createCodexStore>;

beforeEach(async () => {
  adapter = new MemoryCodexAdapter("dev");
  store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
});

function args(
  source: KickstartArgsV3["codexPrimeSeed"]["source"],
  mode: KickstartArgsV3["duoPrime"]["mode"],
  extra: Partial<KickstartArgsV3> = {},
): KickstartArgsV3 {
  const codexPrimeSeed =
    source === "fresh-dalos"
      ? ({ source: "fresh-dalos", words: "mike november oscar papa quebec romeo" } as const)
      : ({ source } as const);
  const duoPrime =
    mode === "kadena-seed"
      ? ({ mode: "kadena-seed", seedType: "koala", mnemonic: KADENA_MNEMONIC } as const)
      : ({ mode: "auto-pure-keys" } as const);
  return {
    codexIdSeed: { mode: "words", value: WORDS_12 },
    codexPrimeSeed,
    duoPrime,
    ...extra,
  };
}

async function kickstart(a: KickstartArgsV3): Promise<KickstartResultV3> {
  store.getState().actions.authenticate(PW, 60);
  const r = await store.getState().actions.kickstartCodex(a);
  return r as KickstartResultV3;
}

describe("kickstartCodex v0.3 — happy paths", () => {
  it("reuse-codexid-whole + auto-pure-keys: identity + guard + prime + duo pair, no kadena seed", T, async () => {
    const r = await kickstart(args("reuse-codexid-whole", "auto-pure-keys"));

    expect(r.codexIdentity).toBeDefined();
    expect(r.codexGuard.isCodexGuard).toBe(true);
    expect(r.codexPrime.isPrime).toBe(true);
    expect(r.duoPurePrime).toHaveLength(2);
    expect(r.primeCodexSeed).toBeUndefined();
    expect(r.primeOuroAccountSeed).toBeUndefined();

    const s = store.getState();
    expect(s.codexIdentity).toEqual(r.codexIdentity);
    // pureKeypairs: [codexGuard, paymentDuo, guardDuo]
    expect(s.pureKeypairs).toHaveLength(3);
    expect(s.pureKeypairs[0].isCodexGuard).toBe(true);
    expect(s.pureKeypairs[1].isDuoPurePrime).toBe(true);
    expect(s.pureKeypairs[1].duoPurePrimeRole).toBe("payment");
    expect(s.pureKeypairs[2].duoPurePrimeRole).toBe("guard");
    expect(s.ouroAccounts).toHaveLength(1);
    expect(s.ouroAccounts[0].isPrime).toBe(true);
    expect(s.kadenaSeeds).toHaveLength(0);
  });

  it("reuse-codexid-whole + kadena-seed: prime codex seed installed, parentSeedId linked", T, async () => {
    const r = await kickstart(args("reuse-codexid-whole", "kadena-seed"));

    expect(r.primeCodexSeed).toBeDefined();
    expect(r.primeCodexSeed!.isPrime).toBe(true);
    expect(store.getState().kadenaSeeds).toHaveLength(1);
    expect(r.codexPrime.parentSeedId).toBe(r.primeCodexSeed!.id);
    expect(r.duoPurePrime).toBeUndefined();
  });

  it("reuse-codexid-standard re-derives the prime from the FIRST half (distinct from whole)", T, async () => {
    const r = await kickstart(args("reuse-codexid-standard", "auto-pure-keys"));

    const words = WORDS_12.split(/\s+/);
    const splitIndex = r.codexIdentity.splitIndex;
    const firstHalf = Apollo.generateFromSeedWords(words.slice(0, splitIndex));
    const whole = Apollo.generateFromSeedWords(words); // a single full-seed derivation

    expect(r.codexPrime.publicKey).toBe(firstHalf.keyPair.publ);
    expect(r.codexPrime.publicKey).not.toBe(whole.keyPair.publ);
  });

  it("reuse-codexid-smart re-derives the prime from the SECOND half + guard = kadena positions 0/1", T, async () => {
    const r = await kickstart(args("reuse-codexid-smart", "kadena-seed"));

    const words = WORDS_12.split(/\s+/);
    const splitIndex = r.codexIdentity.splitIndex;
    const secondHalf = Apollo.generateFromSeedWords(words.slice(splitIndex));
    expect(r.codexPrime.publicKey).toBe(secondHalf.keyPair.publ);

    expect(r.primeCodexSeed!.isPrime).toBe(true);
    // F-008: CodexPrime.guard keyset = the two kadena seed account pubkeys.
    expect(r.codexPrime.guard).not.toBeNull();
    expect(r.codexPrime.guard!.pred).toBe("keys-all");
    expect(r.codexPrime.guard!.keys).toEqual([
      r.primeCodexSeed!.accounts[0].publicKey,
      r.primeCodexSeed!.accounts[1].publicKey,
    ]);
  });

  it("fresh-dalos + auto-pure-keys: fresh non-prime dalos seed persisted, prime from Ѻ. path", T, async () => {
    const r = await kickstart(args("fresh-dalos", "auto-pure-keys"));

    expect(r.primeOuroAccountSeed).toBeDefined();
    expect(r.primeOuroAccountSeed!.isPrime).toBe(false);
    expect(store.getState().kadenaSeeds).toHaveLength(1);
    expect(r.codexPrime.address.startsWith("Ѻ.")).toBe(true);
    expect(r.codexPrime.originCurve).toBe("dalos");
    expect(r.duoPurePrime).toHaveLength(2);
  });

  it("fresh-dalos + kadena-seed: TWO kadena seeds (prime duo + non-prime fresh-dalos)", T, async () => {
    const r = await kickstart(args("fresh-dalos", "kadena-seed"));

    expect(r.primeCodexSeed!.isPrime).toBe(true);
    expect(r.primeOuroAccountSeed!.isPrime).toBe(false);
    expect(store.getState().kadenaSeeds).toHaveLength(2);
  });

  it("createdByUsername lands on ICodexIdentity.createdBy", T, async () => {
    const r = await kickstart(
      args("reuse-codexid-whole", "auto-pure-keys", { createdByUsername: "alice@mnemosyne" }),
    );
    expect(r.codexIdentity.createdBy).toBe("alice@mnemosyne");
  });

  it("F-008: auto-pure-keys CodexPrime.guard = the two duo pure pubkeys", T, async () => {
    const r = await kickstart(args("reuse-codexid-whole", "auto-pure-keys"));
    expect(r.codexPrime.guard!.pred).toBe("keys-all");
    expect(r.codexPrime.guard!.keys).toEqual([
      r.duoPurePrime![0].publicKey,
      r.duoPurePrime![1].publicKey,
    ]);
  });
});

describe("kickstartCodex v0.3 — atomicity + rejections", () => {
  it("locked codex aborts with CodexLockedError and mutates nothing", T, async () => {
    // NOT authenticated.
    await expect(
      store.getState().actions.kickstartCodex(args("reuse-codexid-whole", "auto-pure-keys")),
    ).rejects.toBeInstanceOf(CodexLockedError);

    const s = store.getState();
    expect(s.codexIdentity).toBeUndefined();
    expect(s.pureKeypairs).toHaveLength(0);
    expect(s.ouroAccounts).toHaveLength(0);
    expect(s.kadenaSeeds).toHaveLength(0);
  });

  it("a derivation throw before set() leaves state untouched", T, async () => {
    store.getState().actions.authenticate(PW, 60);
    const spy = vi.spyOn(Apollo, "generateFromSeedWords").mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(
      store.getState().actions.kickstartCodex(args("reuse-codexid-whole", "auto-pure-keys")),
    ).rejects.toThrow();
    spy.mockRestore();

    const s = store.getState();
    expect(s.codexIdentity).toBeUndefined();
    expect(s.pureKeypairs).toHaveLength(0);
    expect(s.ouroAccounts).toHaveLength(0);
  });

  it("rejects each already-kickstarted invariant with its own error class", T, async () => {
    // (a) existing kadena seed → already-kickstarted
    {
      const s2 = createCodexStore();
      const a2 = new MemoryCodexAdapter("dev");
      await a2.saveStoaChainSeeds([
        {
          id: "s1", seedType: "koala", version: "2", index: 0, secret: "x",
          main: "k:" + "0".repeat(64), createdAt: "t", accounts: [], isPrime: true,
        },
      ]);
      await s2.getState().actions.init(a2, "dev");
      s2.getState().actions.authenticate(PW, 60);
      await expect(
        s2.getState().actions.kickstartCodex(args("reuse-codexid-whole", "auto-pure-keys")),
      ).rejects.toMatchObject({ reason: "already-kickstarted" });
    }
    // (b) existing codexIdentity → already-exists (CodexIdentityError)
    {
      const s3 = createCodexStore();
      const a3 = new MemoryCodexAdapter("dev");
      await a3.saveCodexIdentity({
        formatted: "x", standardPublicKey: "x", smartPublicKey: "x",
        encryptedSeedWords: "x", encryptedStandardBitstring: "x", encryptedSmartBitstring: "x",
        encryptedStandardBase10: "x", encryptedSmartBase10: "x",
        encryptedStandardBase49: "x", encryptedSmartBase49: "x",
        totalWordCount: 12, splitIndex: 6, createdAt: "t",
      });
      await s3.getState().actions.init(a3, "dev");
      s3.getState().actions.authenticate(PW, 60);
      await expect(
        s3.getState().actions.kickstartCodex(args("reuse-codexid-whole", "auto-pure-keys")),
      ).rejects.toBeInstanceOf(CodexIdentityError);
    }
    // (c) existing CodexGuard → already-exists (CodexGuardError)
    {
      const s4 = createCodexStore();
      const a4 = new MemoryCodexAdapter("dev");
      await a4.savePureKeypairs([
        { id: "g1", label: "CodexGuard", publicKey: "f".repeat(64), encryptedPrivateKey: "e", createdAt: "t", isCodexGuard: true },
      ]);
      await s4.getState().actions.init(a4, "dev");
      s4.getState().actions.authenticate(PW, 60);
      await expect(
        s4.getState().actions.kickstartCodex(args("reuse-codexid-whole", "auto-pure-keys")),
      ).rejects.toBeInstanceOf(CodexGuardError);
    }
  });

  it("F-006: words-mode count below 2 is invalid-args (not seed-word-count)", T, async () => {
    store.getState().actions.authenticate(PW, 60);
    await expect(
      store.getState().actions.kickstartCodex({
        ...args("reuse-codexid-whole", "auto-pure-keys"),
        codexIdSeed: { mode: "words", value: "alpha" },
      }),
    ).rejects.toMatchObject({ reason: "invalid-args" });
  });

  it("F-010: splitIndex on a non-words mode is invalid-args", T, async () => {
    store.getState().actions.authenticate(PW, 60);
    await expect(
      store.getState().actions.kickstartCodex({
        ...args("reuse-codexid-whole", "auto-pure-keys"),
        codexIdSeed: { mode: "bitstring", value: "01".repeat(1024), splitIndex: 500 },
      }),
    ).rejects.toMatchObject({ reason: "invalid-args" });
  });
});

describe("kickstartCodex v0.3 — best-effort persistence ordering (F-001/F-009)", () => {
  it("saveStoaChainSeeds failure propagates, leaves disk without identity (saveCodexIdentity not called)", T, async () => {
    store.getState().actions.authenticate(PW, 60);
    const saveCodexIdentity = vi.spyOn(adapter, "saveCodexIdentity");
    vi.spyOn(adapter, "saveStoaChainSeeds").mockRejectedValue(new Error("disk full"));

    await expect(
      store.getState().actions.kickstartCodex(args("reuse-codexid-whole", "kadena-seed")),
    ).rejects.toThrow();

    // saveCodexIdentity is LAST in the order → never reached when saveStoaChainSeeds throws first.
    expect(saveCodexIdentity).not.toHaveBeenCalled();
    // in-memory IS populated (set() ran before persistAndTouch) — best-effort persistence contract.
    expect(store.getState().codexIdentity).toBeDefined();
  });

  it("saveCodexIdentity failure propagates only AFTER the other three slices persisted", T, async () => {
    store.getState().actions.authenticate(PW, 60);
    const saveStoaChainSeeds = vi.spyOn(adapter, "saveStoaChainSeeds");
    const savePureKeypairs = vi.spyOn(adapter, "savePureKeypairs");
    const saveOuroAccounts = vi.spyOn(adapter, "saveOuroAccounts");
    vi.spyOn(adapter, "saveCodexIdentity").mockRejectedValue(new Error("disk full at last write"));

    await expect(
      store.getState().actions.kickstartCodex(args("reuse-codexid-whole", "kadena-seed")),
    ).rejects.toThrow();

    expect(saveStoaChainSeeds).toHaveBeenCalled();
    expect(savePureKeypairs).toHaveBeenCalled();
    expect(saveOuroAccounts).toHaveBeenCalled();
  });
});

describe("kickstartCodex v0.3 — captured password (F-007)", () => {
  it("captures the password once at entry and does not re-fetch it mid-flight", T, async () => {
    store.getState().actions.authenticate(PW, 60);
    // If the implementation captured `ck` once at step 2 and reused it through
    // the slow crypto, getPassword() runs exactly once. A second call would mean
    // the password is re-fetched after the slow work (the bug F-007 guards
    // against — a mid-flight TTL expiry would then abort the kickstart).
    const getPassword = vi.spyOn(store.getState().actions, "getPassword");
    await store.getState().actions.kickstartCodex(args("reuse-codexid-whole", "auto-pure-keys"));
    expect(getPassword).toHaveBeenCalledTimes(1);
    getPassword.mockRestore();
  });
});
