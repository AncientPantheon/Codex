/**
 * `codex-seed-restore-activation` T3 — the REAL host-app wiring of
 * `ArweavePanelDeps.checkArweaveRestoreEligibility` and the
 * eligibility-gated `backupCodexToLibrary` params (`codexPassword`/
 * `primeArweaveSeedBitstring`/`cryptoSeam`), both in `buildRealPanelDeps`
 * (realArweaveAdapter.ts), plus `buildArweaveWiring`'s threading of the
 * Prime Ouronet account / Prime Arweave seed identity into it
 * (ForeignChainsWiring.tsx).
 *
 * Mirrors `codex-backup-wiring.test.ts`'s own "drive `buildRealPanelDeps`/
 * `buildArweaveWiring` directly, assert on the resulting `deps`" style, and
 * `real-arweave-adapter-send.test.ts`'s "a real encrypted `ForeignKeyEntry`,
 * fed through the real `decryptArweaveKey`" pattern for `jwk`.
 *
 * NO real network, NO real RSA-4096 keygen for the KEY material itself:
 * `estimateFee` (arweave-core) and `backupCodexToLibrary` (codex-arweave)
 * are both mocked at the MODULE boundary (`vi.mock` + `vi.hoisted`, keeping
 * every other export REAL via `importOriginal`) — the fee quote because
 * `bufferedFeeCap` has no injectable `apiFactory` seam of its own (unlike
 * `uploadAndTrack`'s `library/flow.ts` counterpart), and the upload because
 * exercising a real `uploadCodexBackup` needs a live/faked gateway
 * transport this file does not attempt to fake at that layer — the task's
 * own "Done when" explicitly allows "a real or faked `uploadCodexBackup`
 * call". The mocked `backupCodexToLibrary` still runs the REAL
 * `Codex-Backup-Recovery-Key` tag recipe (`opts.cryptoSeam.encrypt(
 * codexPassword, primeArweaveSeedBitstring)` — the exact one-liner
 * `accountKeyCipher.ts`'s own `encryptWithAccountKey` is), through the REAL
 * injected `cryptoSeam` (`{ encrypt: encryptStringV2, decrypt: smartDecrypt
 * }`) `buildRealPanelDeps` actually constructs — so the recovery-tag
 * round-trip assertion below exercises REAL crypto; only the
 * network-touching upload call itself is faked.
 *
 * The ELIGIBILITY re-derivation (`checkArweaveRestoreEligibility`, T1) is
 * NOT mocked — it runs for real, against an injected `FakeWorker` mirroring
 * `seeds-derive-prime-seed.test.ts`'s own convention (the worker replies
 * ASYNCHRONOUSLY, from inside `postMessage`, rather than requiring the test
 * to synchronously `emit()` right after construction — this resolver awaits
 * `revealAccountSecret`/`revealArweaveSeedSecret` BEFORE the worker is ever
 * built, so the synchronous-emit convention those simpler tests use does
 * not apply here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { smartDecrypt, encryptStringV2 } from "@stoachain/stoa-core/crypto";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import type { KeygenWorkerMsg } from "@ancientpantheon/codex-arweave/keygen";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

const { backupCodexToLibraryMock } = vi.hoisted(() => {
  return { backupCodexToLibraryMock: vi.fn() };
});

vi.mock("@ancientpantheon/arweave-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ancientpantheon/arweave-core")>();
  return {
    ...actual,
    // No injectable `apiFactory` seam on `bufferedFeeCap` — fake the quote
    // itself so `backupCodex` never reaches a real gateway.
    estimateFee: vi.fn(async () => 1_000_000n),
  };
});

vi.mock("@ancientpantheon/codex-arweave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ancientpantheon/codex-arweave")>();
  return {
    ...actual,
    backupCodexToLibrary: backupCodexToLibraryMock,
  };
});

const { buildRealPanelDeps } = await import("../src/realArweaveAdapter");
const {
  buildArweaveWiring,
  createRevealArweaveSeedSecret,
  ARWEAVE_WIRING_MODE_REAL,
} = await import("../src/ForeignChainsWiring");

const TEST_PASSWORD = "correct horse battery staple";
const OURONET_BITSTRING = "1".repeat(1600);
const WRONG_BITSTRING = "0".repeat(1600);
const PRIME_ARWEAVE_SEED_BITSTRING = "1".repeat(800) + "0".repeat(800);
const DERIVED_ADDRESS = "derived-arweave-address-0";
const STORED_PRIME_ARWEAVE_ADDRESS = DERIVED_ADDRESS;
const WRONG_STORED_ADDRESS = "some-other-stored-address";
const OWNER_ADDRESS = "test-arweave-owner-address";
const FAKE_JWK = { kty: "RSA", n: "fake", e: "AQAB" };

/** A fake `Worker` that replies ASYNCHRONOUSLY from `postMessage` (a
 *  microtask after the message is posted) rather than requiring the caller
 *  to synchronously `emit()` right after construction — this suite's
 *  resolver awaits other async seams BEFORE the worker is ever built, so
 *  the worker cannot assume its `onmessage` is already wired by the time
 *  the test gets control back. */
function makeFakeWorker(address: string): Worker {
  const worker = {
    onmessage: null as ((ev: { data: KeygenWorkerMsg }) => void) | null,
    onerror: null as ((ev: unknown) => void) | null,
    posted: [] as unknown[],
    postMessage(msg: unknown): void {
      worker.posted.push(msg);
      queueMicrotask(() => {
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

async function makeEntry(address: string = OWNER_ADDRESS): Promise<ForeignKeyEntry> {
  const encryptedKeyfile = await encryptStringV2(JSON.stringify(FAKE_JWK), TEST_PASSWORD);
  return {
    id: address,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile,
    address,
  };
}

/** The #0 `ForeignKeyEntry` generated for the Prime Arweave seed — the
 *  only place this host app caches "the Prime Arweave seed's actual stored
 *  address" (an Arweave seed is nothing but a 1600-bit bitstring; it gets an
 *  address only once a key is actually derived from it, same provenance
 *  `ArweaveSeedsArea.tsx`'s own `indicesOfSeed` already keys on). */
function primeSeedIndexZeroEntry(address: string): ForeignKeyEntry {
  return {
    id: "generated-key-id",
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: "irrelevant-ciphertext",
    seedId: "seed-prime",
    index: 0,
    address,
  };
}

beforeEach(() => {
  backupCodexToLibraryMock.mockReset();
  backupCodexToLibraryMock.mockImplementation(
    async (
      _exportJson: string,
      opts: {
        codexPassword?: string;
        primeArweaveSeedBitstring?: string;
        cryptoSeam?: { encrypt: typeof encryptStringV2; decrypt: typeof smartDecrypt };
      },
    ) => {
      const tags: { name: string; value: string }[] = [];
      if (
        opts.codexPassword !== undefined &&
        opts.primeArweaveSeedBitstring !== undefined &&
        opts.cryptoSeam !== undefined
      ) {
        tags.push({
          name: "Codex-Backup-Recovery-Key",
          value: await opts.cryptoSeam.encrypt(opts.codexPassword, opts.primeArweaveSeedBitstring),
        });
      }
      return { id: "fake-backup-id", tags };
    },
  );
});

describe("buildRealPanelDeps — checkArweaveRestoreEligibility", () => {
  it("resolves true when the re-derived address matches the Prime Arweave seed's stored #0 address", async () => {
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [primeSeedIndexZeroEntry(STORED_PRIME_ARWEAVE_ADDRESS)],
      primeOuronetAccountId: "ouro-prime",
      revealAccountSecret: async (id) => (id === "ouro-prime" ? OURONET_BITSTRING : null),
      primeArweaveSeedId: "seed-prime",
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await expect(deps.checkArweaveRestoreEligibility?.()).resolves.toBe(true);
  });

  it("resolves false when the re-derived address does NOT match the stored address (unrelated-words seed)", async () => {
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [primeSeedIndexZeroEntry(WRONG_STORED_ADDRESS)],
      primeOuronetAccountId: "ouro-prime",
      revealAccountSecret: async (id) => (id === "ouro-prime" ? WRONG_BITSTRING : null),
      primeArweaveSeedId: "seed-prime",
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await expect(deps.checkArweaveRestoreEligibility?.()).resolves.toBe(false);
  });

  it("resolves false (never throws) when there is no Prime Ouronet account id", async () => {
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [primeSeedIndexZeroEntry(STORED_PRIME_ARWEAVE_ADDRESS)],
      primeArweaveSeedId: "seed-prime",
      revealAccountSecret: async () => OURONET_BITSTRING,
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await expect(deps.checkArweaveRestoreEligibility?.()).resolves.toBe(false);
  });

  it("resolves false (never throws) when there is no Prime Arweave seed at all", async () => {
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [],
      primeOuronetAccountId: "ouro-prime",
      revealAccountSecret: async () => OURONET_BITSTRING,
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await expect(deps.checkArweaveRestoreEligibility?.()).resolves.toBe(false);
  });

  it("resolves false when the Prime Arweave seed exists but no #0 key has been generated for it yet", async () => {
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [],
      primeOuronetAccountId: "ouro-prime",
      revealAccountSecret: async () => OURONET_BITSTRING,
      primeArweaveSeedId: "seed-prime",
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await expect(deps.checkArweaveRestoreEligibility?.()).resolves.toBe(false);
  });
});

describe("buildRealPanelDeps().backupCodex — eligibility-gated recovery params", () => {
  it("ELIGIBLE: calls backupCodexToLibrary with codexPassword/primeArweaveSeedBitstring/cryptoSeam, and the posted recovery tag decrypts back to the exact codex password", async () => {
    const entry = await makeEntry();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: OWNER_ADDRESS,
      foreignKeys: [entry, primeSeedIndexZeroEntry(STORED_PRIME_ARWEAVE_ADDRESS)],
      getPassword: () => TEST_PASSWORD,
      getExportJson: async () => '{"codex":"export"}',
      primeOuronetAccountId: "ouro-prime",
      revealAccountSecret: async (id) => (id === "ouro-prime" ? OURONET_BITSTRING : null),
      primeArweaveSeedId: "seed-prime",
      revealArweaveSeedSecret: async (id) =>
        id === "seed-prime" ? PRIME_ARWEAVE_SEED_BITSTRING : null,
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await deps.backupCodex('{"codex":"export"}');

    expect(backupCodexToLibraryMock).toHaveBeenCalledTimes(1);
    const [, opts] = backupCodexToLibraryMock.mock.calls[0] as [
      string,
      {
        codexPassword?: string;
        primeArweaveSeedBitstring?: string;
        cryptoSeam?: { encrypt: typeof encryptStringV2; decrypt: typeof smartDecrypt };
      },
    ];
    expect(opts.codexPassword).toBe(TEST_PASSWORD);
    expect(opts.primeArweaveSeedBitstring).toBe(PRIME_ARWEAVE_SEED_BITSTRING);
    expect(opts.cryptoSeam).toBeDefined();

    const result = backupCodexToLibraryMock.mock.results[0]!.value as Promise<{
      tags: { name: string; value: string }[];
    }>;
    const { tags } = await result;
    const recoveryTag = tags.find((t) => t.name === "Codex-Backup-Recovery-Key");
    expect(recoveryTag).toBeDefined();
    const decrypted = await smartDecrypt(recoveryTag!.value, PRIME_ARWEAVE_SEED_BITSTRING);
    expect(decrypted).toBe(TEST_PASSWORD);
  });

  it("INELIGIBLE: calls backupCodexToLibrary with NONE of the three new params — byte-identical to pre-this-task behavior", async () => {
    const entry = await makeEntry();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: OWNER_ADDRESS,
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
      getExportJson: async () => '{"codex":"export"}',
      // No primeOuronetAccountId / primeArweaveSeedId / reveal seams wired —
      // this codex has neither configured, so eligibility must resolve
      // false, not throw.
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await deps.backupCodex('{"codex":"export"}');

    expect(backupCodexToLibraryMock).toHaveBeenCalledTimes(1);
    const [, opts] = backupCodexToLibraryMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(opts).sort()).toEqual(
      ["jwk", "maxRewardWinston", "onSuccess", "pool", "store"].sort(),
    );
    expect(opts.codexPassword).toBeUndefined();
    expect(opts.primeArweaveSeedBitstring).toBeUndefined();
    expect(opts.cryptoSeam).toBeUndefined();
  });

  it("ELIGIBLE but the seed's own plaintext bits cannot be read: falls back to the no-new-params shape instead of posting a broken tag", async () => {
    const entry = await makeEntry();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: OWNER_ADDRESS,
      foreignKeys: [entry, primeSeedIndexZeroEntry(STORED_PRIME_ARWEAVE_ADDRESS)],
      getPassword: () => TEST_PASSWORD,
      getExportJson: async () => '{"codex":"export"}',
      primeOuronetAccountId: "ouro-prime",
      revealAccountSecret: async (id) => (id === "ouro-prime" ? OURONET_BITSTRING : null),
      primeArweaveSeedId: "seed-prime",
      // Reveal refuses (e.g. a race against a re-lock) — must not crash the backup.
      revealArweaveSeedSecret: async () => null,
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await deps.backupCodex('{"codex":"export"}');

    const [, opts] = backupCodexToLibraryMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.codexPassword).toBeUndefined();
    expect(opts.primeArweaveSeedBitstring).toBeUndefined();
    expect(opts.cryptoSeam).toBeUndefined();
  });

  it("checks eligibility exactly ONCE per backupCodex call (never two RSA re-derivations for one logical action)", async () => {
    const entry = await makeEntry();
    const workerFactory = vi.fn(() => makeFakeWorker(DERIVED_ADDRESS));
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: OWNER_ADDRESS,
      foreignKeys: [entry, primeSeedIndexZeroEntry(STORED_PRIME_ARWEAVE_ADDRESS)],
      getPassword: () => TEST_PASSWORD,
      getExportJson: async () => '{"codex":"export"}',
      primeOuronetAccountId: "ouro-prime",
      revealAccountSecret: async () => OURONET_BITSTRING,
      primeArweaveSeedId: "seed-prime",
      revealArweaveSeedSecret: async () => PRIME_ARWEAVE_SEED_BITSTRING,
      workerFactory,
    });

    await deps.backupCodex('{"codex":"export"}');

    expect(workerFactory).toHaveBeenCalledTimes(1);
  });
});

describe("buildArweaveWiring (real mode) — threads the Prime identity + reveal seams into buildRealPanelDeps", () => {
  const FAKE_PRIME_ACCOUNT: IOuroAccount = {
    id: "ouro-prime",
    version: "2",
    isSmart: false,
    address: "test-prime-ouronet-address",
    guard: null,
    stoaChainLedger: null,
    publicKey: "fake-pub",
    secret: "fake-ciphertext",
    backup: "",
    isPrime: true,
    originMode: "seedWords",
    originCurve: "dalos",
  };

  it("derives primeOuronetAccountId from ouronetAccounts' isDefault entry and primeArweaveSeedId from arweaveSeeds' isPrime entry, reaching a real eligible result end to end", async () => {
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_REAL,
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [primeSeedIndexZeroEntry(STORED_PRIME_ARWEAVE_ADDRESS)],
      ouronetAccounts: [{ id: "ouro-prime", label: "CodexPrime", account: FAKE_PRIME_ACCOUNT, isDefault: true }],
      arweaveSeeds: [{ id: "seed-prime", label: "Prime Arweave Seed", bits: "", isPrime: true }],
      revealAccountSecret: async (id) => (id === "ouro-prime" ? OURONET_BITSTRING : null),
      revealArweaveSeedSecret: async (id) =>
        id === "seed-prime" ? PRIME_ARWEAVE_SEED_BITSTRING : null,
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await expect(panelDeps.checkArweaveRestoreEligibility?.()).resolves.toBe(true);
  });

  it("no isDefault Ouronet account and no isPrime Arweave seed at all: resolves false, not a throw", async () => {
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_REAL,
      gatewayUrl: "https://arweave.example.invalid",
      ouronetAccounts: [],
      arweaveSeeds: [],
      workerFactory: () => makeFakeWorker(DERIVED_ADDRESS),
    });

    await expect(panelDeps.checkArweaveRestoreEligibility?.()).resolves.toBe(false);
  });
});

describe("createRevealArweaveSeedSecret — the Prime Arweave seed's on-demand plaintext-bits reveal seam", () => {
  it("decrypts the named seed's secret under the current codex password", async () => {
    const secret = await encryptStringV2(PRIME_ARWEAVE_SEED_BITSTRING, TEST_PASSWORD);
    const reveal = createRevealArweaveSeedSecret({
      seeds: [{ id: "seed-prime", secret, createdAt: new Date().toISOString(), isPrime: true }],
      getPassword: () => TEST_PASSWORD,
    });

    await expect(reveal("seed-prime")).resolves.toBe(PRIME_ARWEAVE_SEED_BITSTRING);
  });

  it("resolves null (never throws) for an unknown seed id", async () => {
    const reveal = createRevealArweaveSeedSecret({ seeds: [], getPassword: () => TEST_PASSWORD });

    await expect(reveal("no-such-seed")).resolves.toBeNull();
  });

  it("resolves null (never throws) when the decrypt fails (locked codex / wrong password)", async () => {
    const secret = await encryptStringV2(PRIME_ARWEAVE_SEED_BITSTRING, TEST_PASSWORD);
    const reveal = createRevealArweaveSeedSecret({
      seeds: [{ id: "seed-prime", secret, createdAt: new Date().toISOString(), isPrime: true }],
      getPassword: () => {
        throw new Error("locked");
      },
    });

    await expect(reveal("seed-prime")).resolves.toBeNull();
  });
});
