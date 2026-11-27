/**
 * rebuildFullKeyWithReason — the typed failure reason behind the reveal's
 * old dead-end "Could not derive bitstring." (honest-failure-reporting §4).
 *
 * The defect these specs pin: `rebuildFullKey` caught a precisely-typed
 * `InvalidBitStringError` whose message already said *exactly* what was
 * wrong — "invalid bitstring (length 153, expected 1600) ... non-binary
 * character "b" at position 0" — and returned `null`, so the reveal could
 * only render a sentence that explains nothing. Reproduced against the
 * owner's real codex: seed [0]'s `secret` still held its 24-word phrase
 * while `wordsSecret` was absent (the pre-repair state), so a word phrase
 * was routed through the bitstring path.
 *
 * Every spec below therefore asserts on the SHAPE OF THE STORED VALUE —
 * what it actually is — because that is the thing the user cannot see and
 * cannot guess. Three things would regress silently without them:
 *
 *   - collapsing all failures into one message again (nothing says 24 words),
 *   - hardcoding the 1600-bit expectation (an APOLLO reveal would lie),
 *   - telling a user to run the repair when the repair cannot help (a
 *     right-shaped value the key check rejected is not a shape problem).
 *
 * `rebuildFullKey` / `bitStringOf` keep their `null` contract on purpose —
 * `seedDashboard.ts`, `codex-arweave`'s panels and the playground all read
 * it — and the last describe block holds that line.
 *
 * No `vi.mock` anywhere: the real DALOS crypto runs. `console.error` is
 * silenced with a spy (not a module mock) exactly as the sibling
 * `codex-identity-rebuild-full-key.test.ts` does, because the caught error
 * is still logged for forensics.
 */

import { describe, it, expect, vi } from "vitest";
// The typed-reason surface is read through the module directly (the house
// idiom for internals — 76 spec files in this package import `../src/...`);
// `codex-identity/index.ts` is NOT in this change's scope.
import {
  rebuildFullKeyWithReason,
  describeSecretShape,
} from "../src/codex-identity/rebuildFullKey.js";
// The back-compat block reads the PUBLIC barrel on purpose: that is the
// surface the other packages consume.
import {
  rebuildFullKey,
  bitStringOf,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import {
  createDefaultRegistry,
  createOuronetAccount,
} from "@stoachain/stoa-core/dalos";

/** A genuine 24-token DALOS phrase, same shape as the owner's seed [0]:
 *  24 whitespace-separated runes of plain letters. Its character count is
 *  never hardcoded below — every assertion reads `PHRASE.length`. */
const PHRASE =
  "bid quartz vortex lumen crag nimbus falcon rivet plume cinder oblique tundra " +
  "helix marble juniper sable thorn vellum wicket zephyr onyx garnet flint dusk";

/** The 1600-bit bitstring of a real key — the value the bitstring path
 *  expects to be handed. */
function validBitString(curve: "dalos" | "apollo" = "dalos"): string {
  const registry = createDefaultRegistry();
  return createOuronetAccount(registry, {
    mode: "seedWords",
    data: ["alpha", "bravo", "charlie", "delta", "echo"],
    primitiveId: curve === "apollo" ? "dalos-apollo" : "dalos-gen-1",
  }).privateKey.bitString;
}

/** Runs `fn` with `console.error` muted — the helper still logs the caught
 *  error, and that log is not what these specs are about. */
function quietly<T>(fn: () => T): T {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// The reported reason
// ---------------------------------------------------------------------------

describe("rebuildFullKeyWithReason — a word phrase read as a bitstring", () => {
  it("names the stored value as 24 seed words of the real character count, instead of a bare failure", () => {
    const outcome = quietly(() => rebuildFullKeyWithReason(PHRASE, "bitString", "dalos"));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("shapeMismatch");
    expect(outcome.failure.shape).toEqual({
      kind: "words",
      tokens: 24,
      length: PHRASE.length,
    });
    // The user-facing sentence must carry BOTH halves of the diagnosis: what
    // the value is, and what was expected of it.
    expect(outcome.failure.message).toContain("24 seed words");
    expect(outcome.failure.message).toContain(`${PHRASE.length} characters`);
    expect(outcome.failure.message).toContain("1600-bit bitstring");
  });

  it("points at the repair that fixes this exact state — the Codex Upgrade", () => {
    const outcome = quietly(() => rebuildFullKeyWithReason(PHRASE, "bitString", "dalos"));

    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.message).toContain("Upgrade Codex Now");
  });

  it("keeps the thrown error for the log but never puts the crypto library's internal string in the user's sentence", () => {
    const outcome = quietly(() => rebuildFullKeyWithReason(PHRASE, "bitString", "dalos"));

    if (outcome.ok) throw new Error("unreachable");
    // The diagnosis that used to be discarded is retained...
    expect(outcome.failure.cause).toContain("InvalidBitStringError");
    expect(outcome.failure.cause).toContain("expected 1600");
    // ...but `generateScalarFromBitString: ...` is a function name, not a
    // sentence for a person (honest-failure-reporting §5's complaint).
    expect(outcome.failure.message).not.toContain("generateScalarFromBitString");
  });

  it("states the APOLLO expectation as 1024 bits on the apollo curve", () => {
    const outcome = quietly(() => rebuildFullKeyWithReason(PHRASE, "bitString", "apollo"));

    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.message).toContain("1024-bit bitstring");
    expect(outcome.failure.message).not.toContain("1600");
  });

  it("names the bitmap geometry when the same phrase is read as a bitmap", () => {
    const outcome = quietly(() => rebuildFullKeyWithReason(PHRASE, "bitmap", "dalos"));

    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("shapeMismatch");
    expect(outcome.failure.message).toContain("40×40 bitmap");
    expect(outcome.failure.message).toContain("24 seed words");
  });
});

describe("rebuildFullKeyWithReason — the other failure modes stay distinguishable", () => {
  it("measures a too-short bitstring as binary of its real length, not as words", () => {
    const half = validBitString().slice(0, 800);
    const outcome = quietly(() => rebuildFullKeyWithReason(half, "bitString", "dalos"));

    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("shapeMismatch");
    expect(outcome.failure.shape).toEqual({ kind: "binary", length: 800 });
    expect(outcome.failure.message).toContain("800 characters of binary");
    // Nothing here is a words-in-the-wrong-slot problem, so the structural
    // repair is not advertised: it would not fix a truncated bitstring.
    expect(outcome.failure.message).not.toContain("Upgrade Codex Now");
  });

  it("reports an empty secret as empty, with no crypto error behind it", () => {
    const outcome = rebuildFullKeyWithReason("   ", "seedWords", "dalos");

    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("empty");
    expect(outcome.failure.shape).toEqual({ kind: "empty", length: 0 });
    expect(outcome.failure.message).toMatch(/empty/i);
    expect(outcome.failure.cause).toBeUndefined();
  });

  it("separates a right-shaped value the key check rejected from a wrong-shaped one", () => {
    // "123" IS a base-10 integer — the shape the mode asks for — and the
    // DALOS private-key validator still refuses it (cofactor tail). Telling
    // this user their secret is the wrong shape, or to run a repair, would
    // both be false.
    const outcome = quietly(() => rebuildFullKeyWithReason("123", "integerBase10", "dalos"));

    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.failure.code).toBe("rejected");
    expect(outcome.failure.shape).toEqual({ kind: "digits", length: 3 });
    expect(outcome.failure.message).toContain("base-10 integer");
    expect(outcome.failure.message).not.toContain("Upgrade Codex Now");
    expect(outcome.failure.cause).toContain("InvalidPrivateKeyError");
  });
});

describe("rebuildFullKeyWithReason — the success path is the same derivation", () => {
  it("returns the very key `rebuildFullKey` returns, not a second implementation", () => {
    const outcome = rebuildFullKeyWithReason(PHRASE, "seedWords", "dalos");
    const viaNullApi = rebuildFullKey(PHRASE, "seedWords", "dalos");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.key.privateKey.bitString).toHaveLength(1600);
    expect(outcome.key.standardAddress).toBe(viaNullApi!.standardAddress);
    expect(outcome.key.privateKey.bitString).toBe(viaNullApi!.privateKey.bitString);
  });

  it("accepts a real 1600-bit bitstring through the bitstring path", () => {
    const bits = validBitString();
    const outcome = rebuildFullKeyWithReason(bits, "bitString", "dalos");

    if (!outcome.ok) throw new Error(`expected ok, got: ${outcome.failure.message}`);
    expect(outcome.key.privateKey.bitString).toBe(bits);
  });
});

// ---------------------------------------------------------------------------
// describeSecretShape — the measurement on its own
// ---------------------------------------------------------------------------

describe("describeSecretShape", () => {
  it("reads a real 1600-bit bitstring as binary of 1600 characters", () => {
    const bits = validBitString();
    expect(describeSecretShape(bits)).toEqual({ kind: "binary", length: 1600 });
  });

  it("reads a 24-token phrase as words, counting the tokens", () => {
    expect(describeSecretShape(PHRASE)).toEqual({
      kind: "words",
      tokens: 24,
      length: PHRASE.length,
    });
  });

  it("does not mistake a base-10 integer for a one-word phrase", () => {
    expect(describeSecretShape("948302")).toEqual({ kind: "digits", length: 6 });
  });

  it("reads the comma-separated bitmap serialisation as rows", () => {
    const rows = Array.from({ length: 40 }, () => "#".repeat(40)).join(",");
    expect(describeSecretShape(rows)).toEqual({ kind: "bitmapRows", rows: 40, length: rows.length });
  });

  it("refuses to guess when the value matches nothing — it reports the length only", () => {
    expect(describeSecretShape("0101!!")).toEqual({ kind: "unknown", length: 6 });
  });

  it("measures the trimmed value, so stored whitespace never inflates the reported length", () => {
    expect(describeSecretShape(`  ${PHRASE}\n`)).toEqual({
      kind: "words",
      tokens: 24,
      length: PHRASE.length,
    });
  });
});

// ---------------------------------------------------------------------------
// Back-compatibility — four packages read the `null` contract
// ---------------------------------------------------------------------------

describe("the existing null-returning surface is untouched", () => {
  it("rebuildFullKey still returns null (not an outcome object) on a failure", () => {
    const result = quietly(() => rebuildFullKey(PHRASE, "bitString", "dalos"));
    expect(result).toBeNull();
  });

  it("bitStringOf still returns null on a failure and the bitstring on success", () => {
    const failed = quietly(() =>
      bitStringOf({ address: "Ѻ.whatever", originMode: "bitString" }, PHRASE),
    );
    expect(failed).toBeNull();

    const ok = bitStringOf({ address: "Ѻ.whatever", originMode: "seedWords" }, PHRASE);
    expect(ok).toHaveLength(1600);
  });
});
