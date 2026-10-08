/**
 * The REAL kickstart -> encrypt -> reveal/decrypt -> derive round trip behind
 * `checkArweaveRestoreEligibility` / `backupCodex`.
 *
 * WHY THIS FILE EXISTS (regression lock for
 * `docs/work/codex-backup-bitstring-reveal-bug/`): every pre-existing test of
 * this chain — `arweave-restore-eligibility-wiring.test.ts`,
 * `codex-backup-wiring.test.ts`, `real-arweave-adapter-panel-deps.test.ts` —
 * injects `revealAccountSecret: async () => "1".repeat(1600)`, i.e. a FAKE,
 * already-correctly-sized bitstring. That made a real, shipped bug invisible
 * by construction: an Ouronet account's decrypted `secret` is NOT a bitstring
 * (`IOuroAccount.secret` holds the representation its own `originMode` names,
 * `backup` holds the private key), so the real chain fed a 286-character
 * base-49 scalar into `generateFromBitStringAtRangesAsync` and died with
 * "seed bitstring must be exactly 1024 (APOLLO) or 1600 (DALOS Genesis)
 * characters".
 *
 * So this suite uses NO pre-sized fake bitstring anywhere. It drives:
 *   - the REAL `kickstartCodex` store action (real APOLLO/DALOS derivation,
 *     real `encryptStringV2` at the codex password),
 *   - the REAL `kickstartAndInstallPrimeArweaveSeed` host composition (real
 *     `bitStringOf` re-derivation, real encrypt, real `addArweaveSeed`),
 *   - the REAL `createRevealAccountSecret` / `createRevealArweaveSeedSecret` /
 *     `createRevealStandardApolloBitstring` decrypt seams,
 *   - the REAL `buildRealPanelDeps` eligibility resolver.
 *
 * The ONLY fake is the RSA-4096 keygen itself (~6.7 s per key), and it is
 * faked DETERMINISTICALLY IN ITS BITS (`addressForBits`) — never a constant
 * address. That is what keeps the assertion honest: eligibility compares a
 * re-derived address against a stored one, and with a bits-keyed fake those
 * two addresses are equal if and only if the two bitstrings are byte-equal.
 * A constant-address fake (what the pre-existing suite uses) would pass even
 * on a completely wrong bitstring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";
import type { KeygenWorkerMsg } from "@ancientpantheon/codex-arweave/keygen";
import type { KickstartArgsV3, KickstartResultV3 } from "@ancientpantheon/codex-ouronet/codex-identity";

// Only the two NETWORK-touching boundaries are faked (same `vi.mock` +
// `importOriginal` discipline as `arweave-restore-eligibility-wiring.test.ts`):
// the fee quote, because `bufferedFeeCap` has no injectable `apiFactory` seam,
// and the upload itself, which would need a live/faked gateway transport. Every
// crypto step on the way there stays REAL.
const { backupCodexToLibraryMock } = vi.hoisted(() => ({
  backupCodexToLibraryMock: vi.fn(),
}));

vi.mock("@ancientpantheon/arweave-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ancientpantheon/arweave-core")>();
  return { ...actual, estimateFee: vi.fn(async () => 1_000_000n) };
});

vi.mock("@ancientpantheon/codex-arweave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ancientpantheon/codex-arweave")>();
  return { ...actual, backupCodexToLibrary: backupCodexToLibraryMock };
});

const { buildRealPanelDeps } = await import("../src/realArweaveAdapter");
const {
  createRevealAccountSecret,
  createRevealArweaveSeedSecret,
  createRevealStandardApolloBitstring,
} = await import("../src/ForeignChainsWiring");
const { kickstartAndInstallPrimeArweaveSeed } = await import("../src/kickstartPrimeArweaveSeed");

const PW = "real-roundtrip-codex-password";
/** Real `encryptStringV2` is PBKDF2-SHA512/600k; a full kickstart runs several. */
const T = { timeout: 180_000 };

const CODEX_ID_WORDS =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
const PRIME_WORDS = "mike november oscar papa quebec romeo";

/**
 * The fake keygen's address, derived DETERMINISTICALLY from the bitstring it
 * was handed — the property the whole suite rests on (see the file header).
 * Also asserts the library's own input contract up front
 * (`@ouronet/dalos-crypto/rsa4096`'s `validateSeedBitString`: exactly 1024 or
 * 1600 characters of '0'/'1'), so a malformed bitstring fails HERE, with the
 * same diagnosis the real library would give, instead of silently producing
 * an address.
 */
function addressForBits(bits: string): string {
  if (bits.length !== 1024 && bits.length !== 1600) {
    throw new Error(
      "seed bitstring must be exactly 1024 (APOLLO) or 1600 (DALOS Genesis) characters",
    );
  }
  if (!/^[01]+$/.test(bits)) {
    throw new Error("seed bitstring must contain only '0' and '1' characters");
  }
  let h = 0n;
  for (const ch of bits) h = (h * 2n + (ch === "1" ? 1n : 0n)) % 0xffffffffffffffffn;
  return `arweave-address-for-${h.toString(36)}`;
}

/** A `Worker` stand-in speaking the real `start-seeded` protocol, answering
 *  with {@link addressForBits} of the bits it actually received. */
function makeBitsKeyedWorker(): Worker {
  const worker = {
    onmessage: null as ((ev: { data: KeygenWorkerMsg }) => void) | null,
    onerror: null as ((ev: unknown) => void) | null,
    postMessage(msg: unknown): void {
      const { bits } = msg as { bits: string };
      queueMicrotask(() => {
        let address: string;
        try {
          address = addressForBits(bits);
        } catch (err) {
          worker.onmessage?.({
            data: { kind: "error", message: err instanceof Error ? err.message : String(err) },
          });
          return;
        }
        worker.onmessage?.({
          data: { kind: "key", index: 0, jwk: {} as ArweaveJwk, address },
        });
        worker.onmessage?.({ data: { kind: "batch-done" } });
      });
    },
    terminate(): void {},
  };
  return worker as unknown as Worker;
}

/** A freshly kickstarted codex with its Prime Arweave Seed installed exactly
 *  the way the real app installs it, plus the `#0` `ForeignKeyEntry` the real
 *  "generate key #0" step would have stored for that seed. */
async function freshCodexWithPrimeArweaveSeed(): Promise<{
  store: ReturnType<typeof createCodexStore>;
  kickstartResult: KickstartResultV3;
  primeArweaveSeedId: string;
  foreignKeys: ForeignKeyEntry[];
}> {
  const store = createCodexStore();
  await store.getState().actions.init(new MemoryCodexAdapter("dev"), "dev");
  store.getState().actions.authenticate(PW, 600);

  const args: KickstartArgsV3 = {
    codexIdSeed: { mode: "words", value: CODEX_ID_WORDS },
    codexPrimeSeed: { source: "fresh-dalos", words: PRIME_WORDS },
    duoPrime: { mode: "auto-pure-keys" },
  };

  let derivedBits = "";
  const { kickstartResult } = await kickstartAndInstallPrimeArweaveSeed(args, {
    kickstart: (a) =>
      store.getState().actions.kickstartCodex(a) as Promise<KickstartResultV3>,
    // The real ~6.7 s RSA-4096 derivation, faked — but faked on the REAL bits
    // the real `bitStringOf` re-derivation produced.
    deriveArweaveSeedAtPositionZero: async ({ bitstring }) => {
      derivedBits = bitstring;
      return { index: 0, jwk: {} as ArweaveJwk, address: addressForBits(bitstring) };
    },
    workerFactory: makeBitsKeyedWorker,
    encryptSecret: (plaintext) => encryptStringV2(plaintext, PW),
    addArweaveSeed: (seed) => store.getState().actions.addArweaveSeed(seed),
  });

  const primeSeed = store.getState().arweaveSeeds.find((s) => s.isPrime === true);
  if (primeSeed === undefined) throw new Error("test setup: no Prime Arweave Seed installed");

  // What the real app stores once the user generates the seed's key #0.
  const foreignKeys: ForeignKeyEntry[] = [
    {
      id: "prime-arweave-key-0",
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile: "irrelevant-for-eligibility",
      seedId: primeSeed.id,
      index: 0,
      address: addressForBits(derivedBits),
    },
  ];

  return { store, kickstartResult, primeArweaveSeedId: primeSeed.id, foreignKeys };
}

const OWNER_ADDRESS = "real-roundtrip-arweave-owner";

beforeEach(() => {
  backupCodexToLibraryMock.mockReset();
  backupCodexToLibraryMock.mockResolvedValue({ id: "fake-backup-tx-id", tags: [] });
});

describe("checkArweaveRestoreEligibility — REAL kickstart -> encrypt -> reveal -> derive round trip", () => {
  it(
    "resolves TRUE for a codex kickstarted by the real `kickstartAndInstallPrimeArweaveSeed` (no fake pre-sized bitstring anywhere)",
    T,
    async () => {
      const { store, kickstartResult, primeArweaveSeedId, foreignKeys } =
        await freshCodexWithPrimeArweaveSeed();

      const deps = buildRealPanelDeps({
        gatewayUrl: "https://arweave.example.invalid",
        foreignKeys,
        primeOuronetAccountId: kickstartResult.codexPrime.id,
        primeOuronetAccount: kickstartResult.codexPrime,
        revealAccountSecret: createRevealAccountSecret({
          accounts: store.getState().ouroAccounts,
          getPassword: () => PW,
        }),
        primeArweaveSeedId,
        revealArweaveSeedSecret: createRevealArweaveSeedSecret({
          seeds: store.getState().arweaveSeeds,
          getPassword: () => PW,
        }),
        workerFactory: makeBitsKeyedWorker,
      });

      await expect(deps.checkArweaveRestoreEligibility?.()).resolves.toBe(true);
    },
  );
});

describe("backupCodex — the reported symptom's own entry point, on a REAL codex", () => {
  it(
    "reaches backupCodexToLibrary with REAL, correctly-sized envelope bitstrings (1600 Master Seed / 1024 Standard Apollo)",
    T,
    async () => {
      const { store, kickstartResult, primeArweaveSeedId, foreignKeys } =
        await freshCodexWithPrimeArweaveSeed();
      const identity = store.getState().codexIdentity ?? null;
      if (identity === null) throw new Error("test setup: kickstart produced no Codex Identity");

      const ownerEntry: ForeignKeyEntry = {
        id: OWNER_ADDRESS,
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: await encryptStringV2(
          JSON.stringify({ kty: "RSA", n: "fake", e: "AQAB" }),
          PW,
        ),
        address: OWNER_ADDRESS,
      };

      const deps = buildRealPanelDeps({
        gatewayUrl: "https://arweave.example.invalid",
        address: OWNER_ADDRESS,
        foreignKeys: [ownerEntry, ...foreignKeys],
        getPassword: () => PW,
        getExportJson: async () => '{"codex":"export"}',
        primeOuronetAccountId: kickstartResult.codexPrime.id,
        primeOuronetAccount: kickstartResult.codexPrime,
        revealAccountSecret: createRevealAccountSecret({
          accounts: store.getState().ouroAccounts,
          getPassword: () => PW,
        }),
        primeArweaveSeedId,
        revealArweaveSeedSecret: createRevealArweaveSeedSecret({
          seeds: store.getState().arweaveSeeds,
          getPassword: () => PW,
        }),
        revealStandardApolloBitstring: createRevealStandardApolloBitstring({
          identity,
          getPassword: () => PW,
        }),
        workerFactory: makeBitsKeyedWorker,
      });

      await deps.backupCodex('{"codex":"export"}');

      expect(backupCodexToLibraryMock).toHaveBeenCalledTimes(1);
      const [, opts] = backupCodexToLibraryMock.mock.calls[0] as [
        string,
        { primeArweaveSeedBitstring: string; standardApolloBitstring: string; codexPassword: string },
      ];
      // The exact contract `@ouronet/dalos-crypto/rsa4096`'s own
      // `validateSeedBitString` enforces — asserted on the values the REAL
      // reveal chain produced, never on an injected fake.
      expect(opts.primeArweaveSeedBitstring).toMatch(/^[01]{1600}$/);
      expect(opts.standardApolloBitstring).toMatch(/^[01]{1024}$/);
      expect(opts.codexPassword).toBe(PW);
    },
  );
});
