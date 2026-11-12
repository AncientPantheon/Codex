/**
 * Migration progress — and above all, the no-seed-words guarantee.
 *
 * The live wizard choice carries plaintext words. This row must never. The
 * tests below prove that over a REAL new-words run rather than trusting the
 * type, because a future field could reintroduce one and the type alone
 * would not notice at the boundary where objects get assigned wholesale.
 */

import { describe, it, expect } from "vitest";
import {
  toPersistableAccountSelection,
  isResumableSelection,
  containsSuspectedSecret,
} from "../src/codex/migrationProgress.js";
import type {
  MigrationProgress,
  MigrationSelection,
} from "../src/codex/migrationProgress.js";

const WORDS = "river stone ember ancient hodler vault";

describe("toPersistableAccountSelection — the guarantee", () => {
  it("DROPS the words from a new-words choice", () => {
    const out = toPersistableAccountSelection({ kind: "new-words", words: WORDS });
    expect(out).toEqual({ kind: "new-words" });
    expect(JSON.stringify(out)).not.toContain("river");
    expect(Object.keys(out)).toEqual(["kind"]);
  });

  it("keeps the id for an existing-account choice (an id is not a secret)", () => {
    expect(toPersistableAccountSelection({ kind: "existing", accountId: "ouro-7" }))
      .toEqual({ kind: "existing", accountId: "ouro-7" });
  });

  it("carries nothing for keep-current", () => {
    expect(toPersistableAccountSelection({ kind: "keep-current" }))
      .toEqual({ kind: "keep-current" });
  });

  it("no serialized form of ANY converted choice contains the words", () => {
    const all = [
      { kind: "keep-current" } as const,
      { kind: "existing", accountId: "ouro-7" } as const,
      { kind: "new-words", words: WORDS } as const,
    ].map(toPersistableAccountSelection);
    expect(JSON.stringify(all)).not.toContain(WORDS);
    for (const w of WORDS.split(" ")) {
      expect(JSON.stringify(all)).not.toContain(w);
    }
  });
});

describe("a full recorded run carries no secret material", () => {
  it("a new-words run, recorded end to end, has nothing secret in it", () => {
    const selection: MigrationSelection = {
      account: toPersistableAccountSelection({ kind: "new-words", words: WORDS }),
      payment: { kind: "stoic-dalos-position-0" },
      guard: { kind: "custom", keys: ["a".repeat(64), "b".repeat(64)], pred: "keys-2" },
      derivationMethod: "stoic-dalos",
    };
    const row: MigrationProgress = {
      stage: "committing",
      startedAt: "2026-10-29T10:00:00.000Z",
      updatedAt: "2026-10-29T10:05:00.000Z",
      selection,
      committed: { seedId: "seed-1", accountId: "ouro-1", locksWritten: true },
    };

    expect(JSON.stringify(row)).not.toContain(WORDS);
    expect(containsSuspectedSecret(row)).toBe(false);
  });

  it.each([
    { kind: "update-keyset-recommended" as const },
    { kind: "update-keyset-custom" as const, keys: ["c".repeat(64)], pred: "keys-all" },
    {
      kind: "use-existing-keyset" as const,
      ns: "ouronet-ns", ksn: "owner-made-keyset",
      keys: ["d".repeat(64)], pred: "keys-2",
    },
  ])("a run recording guard choice %o has nothing secret in it, and round-trips unchanged through JSON", (guard) => {
    const selection: MigrationSelection = {
      account: toPersistableAccountSelection({ kind: "keep-current" }),
      payment: { kind: "stoic-dalos-position-0" },
      guard,
    };
    const row: MigrationProgress = {
      stage: "selection",
      startedAt: "2026-11-09T10:00:00.000Z",
      updatedAt: "2026-11-09T10:00:00.000Z",
      selection,
    };

    expect(containsSuspectedSecret(row)).toBe(false);
    // Round trip: the row is pure JSON-serializable data (exactly how it
    // travels in the codex export) — parsing a serialized copy back must
    // reproduce the guard choice byte-for-byte, same guarantee the
    // existing "custom" kind already relies on implicitly.
    const roundTripped = JSON.parse(JSON.stringify(row)) as MigrationProgress;
    expect(roundTripped.selection?.guard).toEqual(guard);
  });

  it("the scanner CATCHES a row that smuggled words back in", () => {
    // Proves the guard above is load-bearing rather than vacuous.
    const bad = {
      stage: "selection",
      selection: { account: { kind: "new-words", words: WORDS } },
    };
    expect(containsSuspectedSecret(bad)).toBe(true);
  });

  it("does not false-positive on a boolean flag whose name reads secret-ish", () => {
    expect(containsSuspectedSecret({ committed: { wordsWritten: true } })).toBe(false);
  });
});

describe("isResumableSelection", () => {
  it("refuses to resume a new-words run — its substance was never stored", () => {
    expect(isResumableSelection({ account: { kind: "new-words" } })).toBe(false);
  });

  it("resumes the two paths that persist as ids", () => {
    expect(isResumableSelection({ account: { kind: "keep-current" } })).toBe(true);
    expect(isResumableSelection({ account: { kind: "existing", accountId: "x" } })).toBe(true);
  });

  it("refuses when there is no selection at all", () => {
    expect(isResumableSelection(undefined)).toBe(false);
  });
});
