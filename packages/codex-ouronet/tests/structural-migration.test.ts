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
import { seedWordsToBitString, validateSeedWords } from "@ouronet/dalos-crypto/gen1";
import {
  runStructuralMigration,
  seedPhraseShapeReason,
  STRUCTURAL_SHAPE_TARGET_VERSION,
} from "@ancientpantheon/codex-ouronet/structural-migration";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/types";

const T = { timeout: 120_000 };

/** A real 1600-char DALOS bitstring, deterministic and trivially inspectable. */
const REAL_BITSTRING_1600 = "01".repeat(800);

/** The MEASURED shape of a genuine DALOS phrase in the owner's real exported
 *  codex (`Ionut_OuronetCodex_v1.0.0_2026-11-26`, decrypted and measured in
 *  honest-failure-reporting/design.md): 154 chars, 24 tokens, first token
 *  `bid`. Rebuilt here from BIP39-English words — the only wordlist any
 *  phrase-producing surface in this repo draws from
 *  (`StoaChainWalletBuilder.generateMnemonic(12|24)`) — so the real file's
 *  own dimensions are exercised on every machine, not only the one that has
 *  the export on disk. */
const MEASURED_REAL_PHRASE =
  "bid day just attack address climb actual void method cargo " +
  "fuel soldier bright fancy donkey exist shoulder silly mimic " +
  "canal fiber pulse exercise scissors";

/** This file's own long-standing 24-token fixture (144 chars) — the second
 *  calibration point for the §3 word-shape bounds. */
const REPO_FIXTURE_PHRASE =
  "bid day just attack address climb actual void method cave " +
  "fuel soldier bright fancy donkey exist gown silly mimic " +
  "canal fiber pulse exercise fit";

/** Word-ish prose: every glyph is in the 256-glyph DALOS character set and
 *  every token is 1-256 glyphs long, so `validateSeedWords` accepts it
 *  outright — the admission this file's own garbage-fixture comment already
 *  makes ("unlike plain prose, which validateSeedWords happily accepts").
 *  Converting THIS over `secret` is design.md §3's data-loss risk. */
const PROSE_VALIDATE_SEED_WORDS_ACCEPTS = "this is my private note it is not a seed phrase";

/** Same tokenisation the engine itself applies to a decrypted plaintext. */
function toTokens(plaintext: string): string[] {
  return plaintext.trim().split(/\s+/).filter(Boolean);
}

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

/**
 * These two cases decrypt REAL codex exports that live on one developer's
 * disk, outside the repo. Both the files and the password are therefore
 * SUPPLIED BY THE ENVIRONMENT, never written down here:
 *
 *   CODEX_FOREIGN_FIXTURE_DIR       — directory holding the two exports
 *   CODEX_FOREIGN_FIXTURE_PASSWORD  — their password
 *
 * The password used to be a string literal in this file. That is why it is
 * not any more: this repo is PUBLIC, and committing the file published a
 * real credential. It has since been rotated and purged from history. Do not
 * reintroduce a literal here, and do not vendor the codices in — a public
 * repo is the wrong home for somebody's exported codex.
 *
 * When either variable is unset, or the files are absent, the block SKIPS
 * rather than failing. It previously hard-failed with ENOENT anywhere but
 * that one machine, which is what broke the v1.7.0 publish run: green
 * locally, red in CI, for reasons unrelated to the code under test.
 */
const REAL_PASSWORD = process.env.CODEX_FOREIGN_FIXTURE_PASSWORD ?? "";
const FOREIGN_FIXTURE_DIR = process.env.CODEX_FOREIGN_FIXTURE_DIR ?? "";
const REAL_FILES = FOREIGN_FIXTURE_DIR
  ? [
      `${FOREIGN_FIXTURE_DIR}/Ionut_OuronetCodex_2026-10-11_13-22-23.json`,
      `${FOREIGN_FIXTURE_DIR}/Iounut-Latests_OuronetCodex_2026-10-11_13-22-23.json`,
    ]
  : [];
const REAL_FIXTURES_AVAILABLE =
  REAL_PASSWORD !== "" && REAL_FILES.length > 0 && REAL_FILES.every((f) => fs.existsSync(f));

describe.skipIf(!REAL_FIXTURES_AVAILABLE)("runStructuralMigration — real legacy codex files (bug 2a)", () => {
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

/**
 * `honest-failure-reporting` design.md §2 — "The repair stamps completion
 * unconditionally".
 *
 * `Codex_Shape_Version` is the claim `useNeedsStructuralUpgrade` reads to
 * decide whether `CodexIdPage` offers "Upgrade Codex Now" or the terminal
 * "✓ Versioned". Stamping it while a seed is still unreadable marks a
 * broken codex current and removes the only retry path the user has.
 */
describe("runStructuralMigration — the completion stamp is a claim, not a formality (§2)", () => {
  /** A stoic entry whose `secret` is `plaintext` under `password`. */
  async function stoicSeed(id: string, plaintext: string, password: string): Promise<Record<string, unknown>> {
    return {
      id,
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret: await encryptStringV2(plaintext, password),
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    };
  }

  it("does not stamp Codex_Shape_Version when a seed was skipped, so the upgrade stays offered", async () => {
    const password = "stamp-skip-pw";
    const snapshot = makeKadenaSnapshot(
      await stoicSeed("unreadable-seed", "not-words-or-bits!@#$%^&*()", password),
    );

    const result = await runStructuralMigration(snapshot, password);

    expect(result.skipped).toHaveLength(1);
    expect(result.snapshot.Codex_Shape_Version).toBeUndefined();
  }, T.timeout);

  it("clears an inherited stamp when a seed was skipped, rather than leaving a stale 'current' claim", async () => {
    const password = "stamp-stale-pw";
    const base = makeKadenaSnapshot(
      await stoicSeed("unreadable-seed-2", "not-words-or-bits!@#$%^&*()", password),
    );
    const snapshot = {
      ...base,
      Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION,
    } as unknown as CodexSnapshot;

    const result = await runStructuralMigration(snapshot, password);

    expect(result.skipped).toHaveLength(1);
    // A stale claim over a still-unresolved seed is exactly what the
    // LocalStorage adapter's `codex_shape_version` shard refuses to keep
    // ("absent -> removeItem"); the engine must not produce one either.
    expect(result.snapshot.Codex_Shape_Version).toBeUndefined();
  }, T.timeout);
});

/**
 * design.md §2 — the three indistinguishable silent `continue`s. With no
 * counters, "this codex has no seeds I am responsible for" and "every seed
 * was already fine" both reach the UI as `Fixed 0 seeds.`
 */
describe("runStructuralMigration — outcome counters (§2)", () => {
  it("reports examined 0 / notEligible 1 for a codex whose only seed is a type this engine never walks", async () => {
    const password = "counters-not-eligible-pw";
    const snapshot = makeKadenaSnapshot({
      id: "koala-only",
      seedType: "koala",
      version: "1.0",
      index: 0,
      secret: await encryptStringV2("abandon abandon about", password),
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.examined).toBe(0);
    expect(result.notEligible).toBe(1);
    expect(result.alreadyCurrent).toBe(0);
    expect(result.emptySecret).toBe(0);
    expect(result.fixedSeedIds).toEqual([]);
    expect(result.skipped).toEqual([]);
  }, T.timeout);

  it("accounts for every walked entry exactly once across a mixed codex", async () => {
    const password = "counters-mixed-pw";
    const snapshot = {
      schemaVersion: 3,
      lastUpdatedAt: null,
      lastUpdatedDevice: "main",
      uiSettings: {} as CodexSnapshot["uiSettings"],
      kadenaSeeds: [
        {
          id: "mixed-words",
          seedType: "stoic",
          version: "1.0",
          index: 0,
          secret: await encryptStringV2(MEASURED_REAL_PHRASE, password),
          main: "deadbeef",
          createdAt: "2026-01-01T00:00:00.000Z",
          accounts: [],
        },
        {
          id: "mixed-current",
          seedType: "stoic",
          version: "1.0",
          index: 1,
          secret: await encryptStringV2(REAL_BITSTRING_1600, password),
          main: "deadbeef",
          createdAt: "2026-01-01T00:00:00.000Z",
          accounts: [],
        },
        {
          id: "mixed-empty",
          seedType: "stoic",
          version: "1.0",
          index: 2,
          secret: "",
          main: "deadbeef",
          createdAt: "2026-01-01T00:00:00.000Z",
          accounts: [],
        },
        {
          id: "mixed-garbage",
          seedType: "stoic",
          version: "1.0",
          index: 3,
          secret: await encryptStringV2("not-words-or-bits!@#$%^&*()", password),
          main: "deadbeef",
          createdAt: "2026-01-01T00:00:00.000Z",
          accounts: [],
        },
        {
          id: "mixed-koala",
          seedType: "koala",
          version: "1.0",
          index: 4,
          secret: await encryptStringV2("abandon abandon about", password),
          main: "deadbeef",
          createdAt: "2026-01-01T00:00:00.000Z",
          accounts: [],
        },
      ],
      ouroAccounts: [],
      pureKeypairs: [],
    } as unknown as CodexSnapshot;

    const result = await runStructuralMigration(snapshot, password);

    expect(result.fixedSeedIds).toEqual(["mixed-words"]);
    expect(result.skipped.map((s) => s.id)).toEqual(["mixed-garbage"]);
    expect(result.alreadyCurrent).toBe(1);
    expect(result.emptySecret).toBe(1);
    expect(result.notEligible).toBe(1);
    expect(result.examined).toBe(4);
    // The accounting invariant: every walked entry lands in exactly one
    // bucket. A future branch with a bare `continue` breaks this sum, which
    // is the whole disease §2 describes.
    expect(result.examined).toBe(
      result.fixedSeedIds.length + result.skipped.length + result.alreadyCurrent + result.emptySecret,
    );
  }, T.timeout);
});

/**
 * design.md §3 — "A word-shaped plaintext is overwritten without a real
 * check — DATA LOSS RISK".
 *
 * `validateSeedWords` admits 1-256 tokens of DALOS runes, and the rune set
 * includes all of `[0-9A-Za-z]` — so almost any alphanumeric plaintext
 * passes it and used to be converted to a bitstring straight over `secret`.
 */
describe("runStructuralMigration — word-shape gate before any overwrite (§3)", () => {
  it("accepts both measured real DALOS phrase shapes — the owner's 24-token/154-char one and this repo's own 24-token fixture", () => {
    expect(MEASURED_REAL_PHRASE.length).toBe(154);
    expect(toTokens(MEASURED_REAL_PHRASE)).toHaveLength(24);
    expect(toTokens(MEASURED_REAL_PHRASE)[0]).toBe("bid");
    expect(seedPhraseShapeReason(toTokens(MEASURED_REAL_PHRASE))).toBeNull();

    expect(REPO_FIXTURE_PHRASE.length).toBe(144);
    expect(toTokens(REPO_FIXTURE_PHRASE)).toHaveLength(24);
    expect(seedPhraseShapeReason(toTokens(REPO_FIXTURE_PHRASE))).toBeNull();
  });

  it("rejects the word-ish prose validateSeedWords itself happily accepts", () => {
    const tokens = toTokens(PROSE_VALIDATE_SEED_WORDS_ACCEPTS);
    // The library gate this engine used to rely on alone: no throw at all.
    expect(() => validateSeedWords(tokens)).not.toThrow();
    // The positive shape test does the work the library cannot.
    expect(seedPhraseShapeReason(tokens)).toMatch(/\S/);
  });

  it("leaves `secret` byte-identical and records a skip when the plaintext is prose rather than a phrase", async () => {
    const password = "shape-prose-pw";
    const originalSecret = await encryptStringV2(PROSE_VALIDATE_SEED_WORDS_ACCEPTS, password);
    const snapshot = makeKadenaSnapshot({
      id: "prose-seed",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret: originalSecret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.fixedSeedIds).toEqual([]);
    expect(result.skipped.map((s) => s.id)).toEqual(["prose-seed"]);
    // The only copy of this plaintext is still exactly where it was.
    expect(result.snapshot.kadenaSeeds[0].secret).toBe(originalSecret);
    expect(result.snapshot.kadenaSeeds[0].wordsSecret).toBeUndefined();
    expect(result.snapshot.Codex_Shape_Version).toBeUndefined();
  }, T.timeout);

  it("preserves the original plaintext VERBATIM in wordsSecret before overwriting secret", async () => {
    const password = "shape-preserve-pw";
    // Deliberately irregular spacing: preservation must be byte-exact, not
    // a re-join of the parsed tokens.
    const plaintext = `  ${MEASURED_REAL_PHRASE.replace("bid day", "bid   day")}  `;
    const snapshot = makeKadenaSnapshot({
      id: "preserve-seed",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret: await encryptStringV2(plaintext, password),
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.fixedSeedIds).toEqual(["preserve-seed"]);
    const secretPlain = await smartDecrypt(result.snapshot.kadenaSeeds[0].secret, password);
    expect(secretPlain).toBe(seedWordsToBitString(toTokens(MEASURED_REAL_PHRASE)));
    const wordsPlain = await smartDecrypt(result.snapshot.kadenaSeeds[0].wordsSecret!, password);
    expect(wordsPlain).toBe(plaintext);
  }, T.timeout);

  it("refuses to overwrite a secret whose wordsSecret already holds a DIFFERENT phrase", async () => {
    const password = "shape-conflict-pw";
    const originalSecret = await encryptStringV2(MEASURED_REAL_PHRASE, password);
    const originalWordsSecret = await encryptStringV2(REPO_FIXTURE_PHRASE, password);
    const snapshot = makeKadenaSnapshot({
      id: "conflict-seed",
      seedType: "stoic",
      version: "1.0",
      index: 0,
      secret: originalSecret,
      wordsSecret: originalWordsSecret,
      main: "deadbeef",
      createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    });

    const result = await runStructuralMigration(snapshot, password);

    expect(result.fixedSeedIds).toEqual([]);
    expect(result.skipped.map((s) => s.id)).toEqual(["conflict-seed"]);
    // Neither field is touched: converting `secret` here would destroy one
    // of the two distinct phrases this entry holds.
    expect(result.snapshot.kadenaSeeds[0].secret).toBe(originalSecret);
    expect(result.snapshot.kadenaSeeds[0].wordsSecret).toBe(originalWordsSecret);
  }, T.timeout);
});
