/**
 * `runStructuralMigration` — the Structural Migration Engine
 * (docs/work/structural-migration-engine/design.md).
 *
 * Fixes the real, confirmed (2a) bug: a legacy `"stoic"` kadenaSeeds entry
 * (or any arweaveSeeds entry — same secret/wordsSecret convention, no
 * seedType at all) whose `secret` decrypts to raw DALOS words instead of
 * the pre-converted 1600/1024-char bitstring every current call site
 * assumes. Mirrors `rekeyCodex`'s proven shape: pure w.r.t. its snapshot
 * argument, skip-not-drop on anything unresolvable.
 *
 * Real crypto (PBKDF2-SHA512/600k, or the real files' legacy PBKDF2-
 * SHA256/10k V1 envelope) — generous timeouts throughout.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { runStructuralMigration, STRUCTURAL_SHAPE_TARGET_VERSION } from "@ancientpantheon/codex-ouronet/structural-migration";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/types";

const T = { timeout: 120_000 };

/** A real 1600-char DALOS bitstring, deterministic and trivially inspectable. */
const REAL_BITSTRING_1600 = "01".repeat(800);

/** Build a minimal CodexSnapshot fixture carrying one kadenaSeeds entry
 *  (mirrors rekey.test.ts's own `makeSnapshot` pattern for overall shape). */
function makeKadenaSnapshot(seed: Record<string, unknown>): CodexSnapshot {
  return {
    schemaVersion: 3,
    lastUpdatedAt: null,
    lastUpdatedDevice: "main",
    uiSettings: {} as CodexSnapshot["uiSettings"],
    kadenaSeeds: [seed],
    ouroAccounts: [],
    pureKeypairs: [],
  } as unknown as CodexSnapshot;
}

function makeArweaveSnapshot(seed: Record<string, unknown>): CodexSnapshot {
  return {
    schemaVersion: 3,
    lastUpdatedAt: null,
    lastUpdatedDevice: "main",
    uiSettings: {} as CodexSnapshot["uiSettings"],
    kadenaSeeds: [],
    ouroAccounts: [],
    pureKeypairs: [],
    arweaveSeeds: [seed],
  } as unknown as CodexSnapshot;
}

/** Reads one of the two real legacy Foreign codex exports and extracts its
 *  single `kadenaWallets[0]` entry (wire name for the live `kadenaSeeds`
 *  slice). Read directly off the real filesystem path — never copied into
 *  the repo (same handling the design.md calls for). */
function readRealStoicSeed(absolutePath: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as {
    kadenaWallets: Record<string, unknown>[];
  };
  const entry = raw.kadenaWallets[0];
  expect(entry.seedType).toBe("stoic");
  return entry;
}

const REAL_PASSWORD = "<redacted-rotated-credential>";
const REAL_FILES = [
  "/home/ancientbox/ClaudeWS/Miscellaneous/_Codices/Foreign/Ionut_OuronetCodex_2026-10-11_13-22-23.json",
  "/home/ancientbox/ClaudeWS/Miscellaneous/_Codices/Foreign/Iounut-Latests_OuronetCodex_2026-10-11_13-22-23.json",
];

describe("runStructuralMigration — real legacy codex files (bug 2a)", () => {
  for (const file of REAL_FILES) {
    it(`fixes the real stoic seed's secret and preserves the original words in ${file}`, async () => {
      const entry = readRealStoicSeed(file);
      const seedId = entry.id as string;

      // Prove no data is lost: capture the ORIGINAL plaintext behind the
      // ORIGINAL ciphertext before the engine ever runs.
      const originalPlaintext = await smartDecrypt(entry.secret as string, REAL_PASSWORD);

      const snapshot = makeKadenaSnapshot(entry);
      const result = await runStructuralMigration(snapshot, REAL_PASSWORD);

      expect(result.fixedSeedIds).toContain(seedId);

      const fixedSecretPlain = await smartDecrypt(result.snapshot.kadenaSeeds[0].secret, REAL_PASSWORD);
      expect(fixedSecretPlain).toMatch(/^[01]{1600}$/);

      const fixedWordsPlain = await smartDecrypt(result.snapshot.kadenaSeeds[0].wordsSecret!, REAL_PASSWORD);
      expect(fixedWordsPlain).toBe(originalPlaintext);
    }, T.timeout);
  }
});

describe("runStructuralMigration — no-op on an already-current-shape seed", () => {
  it("leaves a stoic seed whose secret is already a real 1600-char bitstring untouched", async () => {
    const password = "already-current-pw";
    const secret = await encryptStringV2(REAL_BITSTRING_1600, password);
    const snapshot = makeKadenaSnapshot({
      id: "already-current-seed",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.fixedSeedIds).toEqual([]);
    expect(result.skipped).toEqual([]);
    const decrypted = await smartDecrypt(result.snapshot.kadenaSeeds[0].secret, password);
    expect(decrypted).toBe(REAL_BITSTRING_1600);
    expect(result.snapshot.Codex_Shape_Version).toBe("1.0.0");
    expect(STRUCTURAL_SHAPE_TARGET_VERSION).toBe("1.0.0");
  }, T.timeout);
});

describe("runStructuralMigration — unresolvable garbage plaintext", () => {
  it("skips (does not drop) a stoic seed whose secret decrypts to neither words nor a bitstring, with no requestMissingData", async () => {
    const password = "garbage-pw";
    // Not bitstring-shaped, AND not valid DALOS words either — "-" and the
    // symbol characters are not in the 256-glyph DALOS character set, so
    // this is genuinely unresolvable automatically (unlike plain prose,
    // which validateSeedWords happily accepts as a word list).
    const originalSecret = await encryptStringV2("not-words-or-bits!@#$%^&*()", password);
    const snapshot = makeKadenaSnapshot({
      id: "garbage-seed",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret: originalSecret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.skipped).toEqual([
      { slice: "kadenaSeeds", id: "garbage-seed", reason: expect.any(String) },
    ]);
    expect(result.fixedSeedIds).toEqual([]);
    // Original ciphertext preserved verbatim — never dropped/overwritten.
    expect(result.snapshot.kadenaSeeds[0].secret).toBe(originalSecret);
  }, T.timeout);

  it("resolves the same garbage seed when requestMissingData supplies real valid DALOS words", async () => {
    const password = "garbage-pw-2";
    const originalSecret = await encryptStringV2("not-words-or-bits!@#$%^&*()", password);
    const snapshot = makeKadenaSnapshot({
      id: "garbage-seed-2",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret: originalSecret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    // A real, valid DALOS word list (the real file's own 24-word plaintext,
    // decoupled from file I/O here — any valid list works; this one is
    // known-good from the probe above).
    const suppliedWords =
      "bid day just attack address climb actual void method cave " +
      "fuel soldier bright fancy donkey exist gown silly mimic " +
      "canal fiber pulse exercise fit";

    const result = await runStructuralMigration(snapshot, password, {
      requestMissingData: async () => suppliedWords,
    });

    expect(result.skipped).toEqual([]);
    expect(result.fixedSeedIds).toContain("garbage-seed-2");

    const fixedSecretPlain = await smartDecrypt(result.snapshot.kadenaSeeds[0].secret, password);
    const expectedBitstring = seedWordsToBitString(suppliedWords.trim().split(/\s+/));
    expect(fixedSecretPlain).toBe(expectedBitstring);
  }, T.timeout);
});

describe("runStructuralMigration — arweaveSeeds (no seedType field at all)", () => {
  it("fixes an arweaveSeeds entry whose secret decrypts to valid DALOS words, same as a stoic kadenaSeeds entry", async () => {
    const password = "arweave-pw";
    const words = [
      "bid", "day", "just", "attack", "address", "climb", "actual", "void",
      "method", "cave", "fuel", "soldier", "bright", "fancy", "donkey",
      "exist", "gown", "silly", "mimic", "canal", "fiber", "pulse",
      "exercise", "fit",
    ];
    const originalSecret = await encryptStringV2(words.join(" "), password);
    const snapshot = makeArweaveSnapshot({
      id: "arweave-seed-1",
      secret: originalSecret,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.fixedSeedIds).toContain("arweave-seed-1");
    expect(result.skipped).toEqual([]);

    const fixedSecretPlain = await smartDecrypt(result.snapshot.arweaveSeeds![0].secret, password);
    expect(fixedSecretPlain).toBe(seedWordsToBitString(words));

    const fixedWordsPlain = await smartDecrypt(result.snapshot.arweaveSeeds![0].wordsSecret!, password);
    expect(fixedWordsPlain).toBe(words.join(" "));
  }, T.timeout);
});

describe("runStructuralMigration — non-stoic kadenaSeeds entries are never walked", () => {
  it("leaves a koala (mnemonic) seed completely untouched, even though its secret is neither bitstring- nor DALOS-words-shaped", async () => {
    const password = "koala-pw";
    // A real BIP39 mnemonic — not DALOS-words-shaped (irrelevant anyway: a
    // koala entry must never even be decrypted by this engine).
    const mnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon " +
      "abandon abandon abandon about";
    const originalSecret = await encryptStringV2(mnemonic, password);
    const snapshot = makeKadenaSnapshot({
      id: "koala-seed",
      seedType: "koala",
      version: "1.0",
      index: 0,
      secret: originalSecret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.fixedSeedIds).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.snapshot.kadenaSeeds[0].secret).toBe(originalSecret);
  }, T.timeout);
});

describe("runStructuralMigration — onProgress (live progress reporting)", () => {
  /** Two checked entries (one stoic kadenaSeeds, one arweaveSeeds), both
   *  legacy-words-shaped, so a real run visits >=2 checked entries and the
   *  byte-identical comparison below actually exercises the fix path. */
  async function makeTwoEntrySnapshot(password: string): Promise<CodexSnapshot> {
    const words = [
      "bid", "day", "just", "attack", "address", "climb", "actual", "void",
      "method", "cave", "fuel", "soldier", "bright", "fancy", "donkey",
      "exist", "gown", "silly", "mimic", "canal", "fiber", "pulse",
      "exercise", "fit",
    ];
    const secret = await encryptStringV2(words.join(" "), password);
    return {
      schemaVersion: 3,
      lastUpdatedAt: null,
      lastUpdatedDevice: "main",
      uiSettings: {} as CodexSnapshot["uiSettings"],
      kadenaSeeds: [
        {
          id: "progress-seed-kadena",
          seedType: "stoic",
          version: "1.0",
          index: 0,
          secret,
          main: "deadbeef",
          createdAt: "2026-01-01T00:00:00.000Z",
          accounts: [],
        },
      ],
      ouroAccounts: [],
      pureKeypairs: [],
      arweaveSeeds: [
        {
          id: "progress-seed-arweave",
          secret,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as unknown as CodexSnapshot;
  }

  it("calls onProgress at least twice with at least two different strings across 2 checked entries", async () => {
    const password = "progress-pw";
    const snapshot = await makeTwoEntrySnapshot(password);
    const calls: string[] = [];

    await runStructuralMigration(snapshot, password, {
      onProgress: (step) => calls.push(step),
    });

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(calls).size).toBeGreaterThanOrEqual(2);
  }, T.timeout);

  it("omitting onProgress changes no other return value — re-running the existing already-current-shape fixture with onProgress added is byte-identical", async () => {
    // Reuses the SAME already-current-shape fixture as the "no-op" describe
    // block above: the engine never re-encrypts a no-op entry, so its
    // ciphertext is passed through verbatim, making a literal, byte-level
    // snapshot comparison meaningful (unlike a fix path, where
    // `encryptStringV2`'s random IV/salt makes re-encrypting the SAME
    // plaintext twice produce different ciphertext bytes).
    const password = "already-current-pw-progress";
    const secret = await encryptStringV2(REAL_BITSTRING_1600, password);
    const fixture = {
      id: "already-current-seed-progress",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    };

    const resultWithout = await runStructuralMigration(makeKadenaSnapshot({ ...fixture }), password);
    const resultWith = await runStructuralMigration(makeKadenaSnapshot({ ...fixture }), password, {
      onProgress: () => {},
    });

    expect(resultWith.fixedSeedIds).toEqual(resultWithout.fixedSeedIds);
    expect(resultWith.skipped).toEqual(resultWithout.skipped);
    expect(resultWith.snapshot).toEqual(resultWithout.snapshot);
  }, T.timeout);
});

describe("runStructuralMigration — purity", () => {
  it("never mutates its input snapshot argument", async () => {
    const password = "purity-pw";
    const secret = await encryptStringV2("not words or bits", password);
    const snapshot = makeKadenaSnapshot({
      id: "purity-seed",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });
    const before = structuredClone(snapshot);

    await runStructuralMigration(snapshot, password);

    expect(snapshot).toEqual(before);
  }, T.timeout);
});
