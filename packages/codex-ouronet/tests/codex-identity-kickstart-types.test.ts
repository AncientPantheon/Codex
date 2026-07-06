/**
 * KickstartArgsV3 / KickstartResultV3 type-shape + validateKickstartArgs tests
 * — Phase 7 T7.1 of the v0.3.0 codex spec (REQ-07).
 *
 * Two contracts are pinned here:
 *   1. The v0.3 kickstart input/output SHAPES (design doc §4.2) — exercised via
 *      literal construction so a mis-typed field fails tsc (vitest runs through
 *      the TS transform).
 *   2. The pure `validateKickstartArgs` runtime validator — it throws
 *      `CodexKickstartError("invalid-args")` naming the failing field for every
 *      shape violation, and accepts every well-formed 4×2 source/mode combo.
 *
 * Cross-validation (the `reuse-codexid-whole` ↔ wordCount<=256 constraint and
 * the words-mode 2..512 count check) is NOT exercised here — that lives in T7.3
 * because it needs the post-tokenisation word count, not just the raw value.
 */

import { describe, it, expect } from "vitest";
import {
  validateKickstartArgs,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import type {
  CodexIdSeedMode,
  CodexIdSeedInput,
  CodexPrimeSeedSource,
  DuoPrimeMode,
  KickstartArgsV3,
  KickstartResultV3,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import { CodexKickstartError } from "@ancientpantheon/codex-ouronet/errors";
import type {
  ICodexIdentity,
  IPureKeypair,
  IOuroAccount,
  IStoaChainSeed,
} from "@ancientpantheon/codex-ouronet/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_SOURCES: CodexPrimeSeedSource["source"][] = [
  "reuse-codexid-whole",
  "reuse-codexid-standard",
  "reuse-codexid-smart",
  "fresh-dalos",
];

const ALL_MODES: DuoPrimeMode["mode"][] = ["kadena-seed", "auto-pure-keys"];

function buildPrimeSeed(source: CodexPrimeSeedSource["source"]): CodexPrimeSeedSource {
  return source === "fresh-dalos"
    ? { source: "fresh-dalos", words: "fresh dalos words here" }
    : { source };
}

function buildDuoPrime(mode: DuoPrimeMode["mode"]): DuoPrimeMode {
  return mode === "kadena-seed"
    ? { mode: "kadena-seed", seedType: "koala", mnemonic: "twelve word kadena mnemonic phrase goes right about here ok" }
    : { mode: "auto-pure-keys" };
}

function buildArgs(
  source: CodexPrimeSeedSource["source"],
  mode: DuoPrimeMode["mode"],
): KickstartArgsV3 {
  return {
    codexIdSeed: { mode: "words", value: "alpha bravo charlie delta" },
    codexPrimeSeed: buildPrimeSeed(source),
    duoPrime: buildDuoPrime(mode),
  };
}

// ---------------------------------------------------------------------------
// 1-4: type-compile assertions (no runtime behavior; tsc is the test)
// ---------------------------------------------------------------------------

describe("KickstartArgsV3 / KickstartResultV3 shapes", () => {
  it("constructs a full KickstartArgsV3 literal (whole + kadena-seed + createdByUsername)", () => {
    const args: KickstartArgsV3 = {
      codexIdSeed: { mode: "words", value: "alpha bravo charlie delta", splitIndex: 2 },
      codexPrimeSeed: { source: "reuse-codexid-whole" },
      duoPrime: { mode: "kadena-seed", seedType: "chainweaver", mnemonic: "m m m m m m m m m m m m" },
      createdByUsername: "alice@mnemosyne",
    };
    expect(args.codexIdSeed.mode).toBe("words");
    expect(args.codexPrimeSeed.source).toBe("reuse-codexid-whole");
    expect(args.duoPrime.mode).toBe("kadena-seed");
  });

  it("admits each codexPrimeSeed.source variant", () => {
    const variants: CodexPrimeSeedSource[] = [
      { source: "reuse-codexid-whole" },
      { source: "reuse-codexid-standard" },
      { source: "reuse-codexid-smart" },
      { source: "fresh-dalos", words: "w w w" },
    ];
    expect(variants.map((v) => v.source)).toEqual(ALL_SOURCES);
  });

  it("admits each duoPrime.mode variant", () => {
    const variants: DuoPrimeMode[] = [
      { mode: "kadena-seed", seedType: "eckowallet", mnemonic: "x x x x x x x x x x x x" },
      { mode: "auto-pure-keys" },
    ];
    expect(variants.map((v) => v.mode)).toEqual(ALL_MODES);
  });

  it("admits each CodexIdSeedMode variant", () => {
    const modes: CodexIdSeedMode[] = ["words", "bitstring", "bitmap", "base10", "base49"];
    const inputs: CodexIdSeedInput[] = modes.map((mode) => ({ mode, value: "v" }));
    expect(inputs).toHaveLength(5);
  });

  it("constructs a full KickstartResultV3 (all 6 fields) and a minimal one (3 required)", () => {
    const identity = {} as ICodexIdentity;
    const guard = {} as IPureKeypair;
    const prime = {} as IOuroAccount;
    const seed = {} as IStoaChainSeed;
    const pure = {} as IPureKeypair;

    const full: KickstartResultV3 = {
      codexIdentity: identity,
      codexGuard: guard,
      codexPrime: prime,
      primeCodexSeed: seed,
      duoPurePrime: [pure, pure],
      primeOuroAccountSeed: seed,
    };
    const minimal: KickstartResultV3 = {
      codexIdentity: identity,
      codexGuard: guard,
      codexPrime: prime,
    };
    expect(full.duoPurePrime).toHaveLength(2);
    expect(minimal.primeCodexSeed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5-8: validateKickstartArgs runtime behavior
// ---------------------------------------------------------------------------

describe("validateKickstartArgs", () => {
  it("accepts a well-formed args object without throwing", () => {
    expect(() => validateKickstartArgs(buildArgs("reuse-codexid-whole", "kadena-seed"))).not.toThrow();
  });

  it("rejects malformed top-level shapes naming the missing field", () => {
    const reject = (input: unknown) => {
      expect(() => validateKickstartArgs(input)).toThrow(CodexKickstartError);
      try {
        validateKickstartArgs(input);
      } catch (e) {
        expect((e as CodexKickstartError).reason).toBe("invalid-args");
      }
    };
    reject(null);
    reject(undefined);
    reject(123);

    // missing codexIdSeed
    const noSeed = buildArgs("reuse-codexid-whole", "kadena-seed") as unknown as Record<string, unknown>;
    delete noSeed.codexIdSeed;
    expect(() => validateKickstartArgs(noSeed)).toThrowError(/codexIdSeed/);

    // missing codexPrimeSeed
    const noPrime = buildArgs("reuse-codexid-whole", "kadena-seed") as unknown as Record<string, unknown>;
    delete noPrime.codexPrimeSeed;
    expect(() => validateKickstartArgs(noPrime)).toThrowError(/codexPrimeSeed/);

    // missing duoPrime
    const noDuo = buildArgs("reuse-codexid-whole", "kadena-seed") as unknown as Record<string, unknown>;
    delete noDuo.duoPrime;
    expect(() => validateKickstartArgs(noDuo)).toThrowError(/duoPrime/);
  });

  it("rejects nested violations naming the failing field", () => {
    // bad codexIdSeed.mode
    expect(() =>
      validateKickstartArgs({
        ...buildArgs("reuse-codexid-whole", "kadena-seed"),
        codexIdSeed: { mode: "invalid", value: "v" },
      }),
    ).toThrowError(/codexIdSeed\.mode/);

    // empty codexIdSeed.value
    expect(() =>
      validateKickstartArgs({
        ...buildArgs("reuse-codexid-whole", "kadena-seed"),
        codexIdSeed: { mode: "words", value: "" },
      }),
    ).toThrowError(/codexIdSeed\.value/);

    // fresh-dalos without words
    expect(() =>
      validateKickstartArgs({
        ...buildArgs("reuse-codexid-whole", "kadena-seed"),
        codexPrimeSeed: { source: "fresh-dalos" },
      }),
    ).toThrowError(/words/);

    // kadena-seed without mnemonic
    expect(() =>
      validateKickstartArgs({
        ...buildArgs("reuse-codexid-whole", "kadena-seed"),
        duoPrime: { mode: "kadena-seed", seedType: "koala" },
      }),
    ).toThrowError(/mnemonic/);

    // kadena-seed with unknown seedType
    expect(() =>
      validateKickstartArgs({
        ...buildArgs("reuse-codexid-whole", "kadena-seed"),
        duoPrime: { mode: "kadena-seed", seedType: "unknown", mnemonic: "m m m" },
      }),
    ).toThrowError(/seedType/);
  });

  it("rejects splitIndex on a non-words mode (F-010)", () => {
    expect(() =>
      validateKickstartArgs({
        ...buildArgs("reuse-codexid-whole", "kadena-seed"),
        codexIdSeed: { mode: "bitstring", value: "01".repeat(1024), splitIndex: 500 },
      }),
    ).toThrowError(/splitIndex only valid for mode='words'/);
  });

  it("accepts all 8 source × mode combinations", () => {
    for (const source of ALL_SOURCES) {
      for (const mode of ALL_MODES) {
        expect(() => validateKickstartArgs(buildArgs(source, mode))).not.toThrow();
      }
    }
  });
});
