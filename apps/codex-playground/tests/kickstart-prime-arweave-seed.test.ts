// ============================================================================
// RED SPEC — T4 of docs/work/codex-recovery-backup-tagging/plan.md.
//
// `kickstartAndInstallPrimeArweaveSeed` is the HOST-LAYER composition that
// makes `docs/work/arweave-seed-restore/design.md`'s precondition true for
// every freshly-kickstarted codex: the Prime Ouronet account and the Prime
// Arweave seed must share origin words. This test pins the COMPOSITION —
// call order + argument wiring — independent of any UI, worker, or real
// crypto: every heavy/side-effecting dependency (kickstart itself, the
// bitstring re-derivation, T3's `deriveArweaveSeedAtPositionZero`, the
// at-rest encryption, and the store's `addArweaveSeed`) is INJECTED, exactly
// like `packages/codex-arweave/src/keygen/KeygenRunner.ts`'s own
// `FakeKeygenRunner` test-double convention — so this suite never spawns a
// real Worker or pays real PBKDF2/RSA-4096 cost.
//
// WHY each assertion matters:
//   - "installs the Prime Arweave seed after a successful kickstart" is the
//     actual acceptance criterion (T4's "Done when"): without this wiring, a
//     fresh codex has NO Arweave seed at all, and `codex-seed-restore-flow`
//     (the topic this unblocks) has nothing to restore from.
//   - "derives the bitstring from the SAME words passed to codexPrimeSeed"
//     guards the precondition itself — a bug that derived from the WRONG
//     words would silently produce a seed that can never again be
//     re-derived from memorized seed words, defeating the whole feature.
//   - "never installs the seed if keygen fails" guards against a partial/
//     broken install: an Arweave seed whose #0 key can never be reproduced
//     is worse than no seed (it LOOKS restorable and is not).
//   - "refuses a non-fresh-dalos kickstart" guards the one real constraint:
//     only `fresh-dalos` produces a DALOS-curve CodexPrime account an
//     Arweave seed (1600-bit DALOS only) can ever be derived from — wiring
//     this helper to any other source would silently misbehave deep inside
//     `bitStringOf` instead of failing loudly at the call site.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import type { KickstartArgsV3, KickstartResultV3 } from "@ancientpantheon/codex-ouronet/codex-identity";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

import {
  kickstartAndInstallPrimeArweaveSeed,
  PRIME_ARWEAVE_SEED_LABEL,
} from "../src/kickstartPrimeArweaveSeed";
import type { StoredArweaveSeed } from "../src/ForeignChainsWiring";

const WORDS = "orbit lantern meadow cobalt granite ember";

function fakeKickstartArgs(
  overrides: Partial<KickstartArgsV3["codexPrimeSeed"]> = {},
): KickstartArgsV3 {
  return {
    codexIdSeed: { mode: "words", value: WORDS },
    codexPrimeSeed: { source: "fresh-dalos", words: WORDS, ...overrides } as KickstartArgsV3["codexPrimeSeed"],
    duoPrime: { mode: "auto-pure-keys" },
  };
}

/** A minimal fake `IOuroAccount` — only the fields this module's own logic
 *  reads matter; the rest are placeholders. `deriveBitstring` is injected in
 *  every test below, so this never reaches the real `bitStringOf`. */
const FAKE_CODEX_PRIME: IOuroAccount = {
  id: "ouro-1",
  version: "2",
  isSmart: false,
  address: "Ѻ.fakeaddress",
  guard: null,
  stoaChainLedger: null,
  publicKey: "fake-pub",
  secret: "fake-ciphertext",
  backup: "",
  isPrime: true,
  originMode: "seedWords",
  originCurve: "dalos",
};

/** A fake `KickstartResultV3` — only `codexPrime` is read by this module;
 *  the rest is cast through, mirroring the real shape only where it matters. */
function fakeKickstartResult(): KickstartResultV3 {
  return {
    codexPrime: FAKE_CODEX_PRIME,
  } as unknown as KickstartResultV3;
}

function makeDeps(overrides: Partial<Parameters<typeof kickstartAndInstallPrimeArweaveSeed>[1]> = {}) {
  const kickstartResult = fakeKickstartResult();
  const kickstart = vi.fn().mockResolvedValue(kickstartResult);
  const deriveBitstring = vi.fn().mockReturnValue("1".repeat(1600));
  const deriveArweaveSeedAtPositionZero = vi.fn().mockResolvedValue({
    index: 0,
    jwk: {} as unknown,
    address: "fake-arweave-address",
  });
  const workerFactory = vi.fn(() => ({}) as Worker);
  const encryptSecret = vi.fn(async (plaintext: string) => `ENC(${plaintext})`);
  const addArweaveSeed = vi.fn().mockResolvedValue(undefined);

  return {
    kickstartResult,
    deps: {
      kickstart,
      deriveBitstring,
      deriveArweaveSeedAtPositionZero,
      workerFactory,
      encryptSecret,
      addArweaveSeed,
      ...overrides,
    },
  };
}

describe("kickstartAndInstallPrimeArweaveSeed", () => {
  it("installs the Prime Arweave seed after a successful kickstart, isPrime: true", async () => {
    const { deps, kickstartResult } = makeDeps();
    const args = fakeKickstartArgs();

    const result = await kickstartAndInstallPrimeArweaveSeed(args, deps);

    expect(deps.kickstart).toHaveBeenCalledWith(args);
    expect(deps.addArweaveSeed).toHaveBeenCalledTimes(1);
    const installed = (deps.addArweaveSeed as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as StoredArweaveSeed;
    expect(installed.isPrime).toBe(true);
    expect(installed.name).toBe(PRIME_ARWEAVE_SEED_LABEL);
    expect(installed.secret).toBe("ENC(" + "1".repeat(1600) + ")");
    expect(installed.wordsSecret).toBe(`ENC(${WORDS})`);
    expect(result.kickstartResult).toBe(kickstartResult);
    expect(result.bitstring).toBe("1".repeat(1600));
  });

  it("derives the bitstring from the SAME account + words kickstart just produced", async () => {
    const { deps, kickstartResult } = makeDeps();
    const args = fakeKickstartArgs();

    await kickstartAndInstallPrimeArweaveSeed(args, deps);

    expect(deps.deriveBitstring).toHaveBeenCalledWith(kickstartResult.codexPrime, WORDS);
  });

  it("derives Arweave seed index 0 at the SAME bitstring before persisting anything", async () => {
    const { deps } = makeDeps();
    const args = fakeKickstartArgs();

    await kickstartAndInstallPrimeArweaveSeed(args, deps);

    expect(deps.deriveArweaveSeedAtPositionZero).toHaveBeenCalledWith(
      expect.objectContaining({ bitstring: "1".repeat(1600), workerFactory: deps.workerFactory }),
    );
    // Call order: derive-at-0 must complete BEFORE the seed is persisted —
    // a seed installed before its #0 key is confirmed derivable is the exact
    // "looks restorable and is not" bug this composition exists to prevent.
    const deriveOrder = (deps.deriveArweaveSeedAtPositionZero as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const addOrder = (deps.addArweaveSeed as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(deriveOrder).toBeLessThan(addOrder);
  });

  it("never installs the seed if the #0 derivation fails (no partial/unrecoverable install)", async () => {
    const { deps } = makeDeps({
      deriveArweaveSeedAtPositionZero: vi.fn().mockRejectedValue(new Error("worker exploded")),
    });
    const args = fakeKickstartArgs();

    await expect(kickstartAndInstallPrimeArweaveSeed(args, deps)).rejects.toThrow("worker exploded");
    expect(deps.addArweaveSeed).not.toHaveBeenCalled();
  });

  it("forwards onProgress through to the derivation so a ~6.7s wait is never a silent freeze", async () => {
    const { deps } = makeDeps();
    const args = fakeKickstartArgs();
    const onProgress = vi.fn();

    await kickstartAndInstallPrimeArweaveSeed(args, deps, onProgress);

    expect(deps.deriveArweaveSeedAtPositionZero).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress }),
    );
  });

  it("refuses a non-fresh-dalos kickstart (the only source with a DALOS-curve CodexPrime)", async () => {
    const { deps } = makeDeps();
    const args: KickstartArgsV3 = {
      codexIdSeed: { mode: "words", value: WORDS },
      codexPrimeSeed: { source: "reuse-codexid-whole" },
      duoPrime: { mode: "auto-pure-keys" },
    };

    await expect(kickstartAndInstallPrimeArweaveSeed(args, deps)).rejects.toThrow(/fresh-dalos/);
    expect(deps.kickstart).not.toHaveBeenCalled();
  });
});
