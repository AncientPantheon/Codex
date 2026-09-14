// @vitest-environment node
/**
 * E5 — the PURE index-range planner (`planIndexRanges`), implementing
 * "skip already-populated positions" per
 * `docs/HANDOFF-rsa4096-skip-populated-indices.md`.
 *
 * The planner turns one of the four UI position modes into the `ranges` array
 * handed to `generateFromBitStringAtRangesAsync`, having already dropped every
 * index the Codex holds a key for. At ~6.7 s per RSA-4096 key, each index that
 * slips through the filter is multiple wasted seconds of CPU — that is the
 * regression these cases guard.
 *
 * WHAT THIS IS NOT: the never-clobber guard. `ranges.js` opens with
 * `const seen = new Set([0])`, so the library force-generates index 0 on EVERY
 * call no matter what `ranges` says. Reporting 0 as `skipped` therefore does
 * NOT stop it being regenerated — the authoritative guard lives at the
 * storage/`onResult` step (a later task). These tests assert the planner's
 * bookkeeping only.
 *
 * `// @vitest-environment node`: pure logic, no DOM, no crypto, no I/O.
 */

import { describe, it, expect } from "vitest";

import {
  planIndexRanges,
  type IndexPlan,
  type PlanIndexRangesInput,
} from "../src/seeds/planIndexRanges";

/** Narrows to a successful plan, failing loudly (with the error text) otherwise. */
function plan(input: PlanIndexRangesInput): IndexPlan {
  const result = planIndexRanges(input);
  if ("error" in result) {
    throw new Error(`expected a plan, got error: ${result.error}`);
  }
  return result;
}

/** Narrows to the error branch, failing loudly if a plan came back instead. */
function planError(input: PlanIndexRangesInput): string {
  const result = planIndexRanges(input);
  if (!("error" in result)) {
    throw new Error(
      `expected an error, got a plan over ${JSON.stringify(result.ranges)}`,
    );
  }
  return result.error;
}

/**
 * The indices covered by a plan's `ranges`, asserting the handoff's singleton
 * shape (`{start:i, end:i}`) on the way — the library sorts/dedupes internally,
 * so singletons are both correct and the simplest thing to verify.
 */
function indicesOf(result: IndexPlan): number[] {
  for (const range of result.ranges) {
    expect(range.end).toBe(range.start);
  }
  return result.ranges.map((range) => range.start);
}

const CAP = 100;

describe("planIndexRanges — the four UI position modes", () => {
  it("`default` over an empty keystore plans exactly index 0", () => {
    // The `Default — just #0` action must actually ask for #0. An empty
    // `ranges` here would leave the UI reporting a run that generates nothing.
    const result = plan({ selection: { kind: "default" }, existing: [], cap: CAP });

    expect(result.ranges).toEqual([{ start: 0, end: 0 }]);
    expect(result.requested).toEqual([0]);
    expect(result.skipped).toEqual([]);
  });

  it("`single` plans index 0 plus the chosen position, ascending", () => {
    // `Custom position — #0 plus one more`: position 7 alone would silently
    // drop #0 from `requested`, misreporting what the run covers.
    const result = plan({
      selection: { kind: "single", position: 7 },
      existing: [],
      cap: CAP,
    });

    expect(result.requested).toEqual([0, 7]);
    expect(indicesOf(result)).toEqual([0, 7]);
  });

  it("`single` at position 0 collapses to a single index, not a duplicate", () => {
    // Picking #0 as the "one more" position must not queue #0 twice — a
    // duplicate is a second 6.7 s prime search for a key already in hand.
    const result = plan({
      selection: { kind: "single", position: 0 },
      existing: [],
      cap: CAP,
    });

    expect(result.requested).toEqual([0]);
    expect(indicesOf(result)).toEqual([0]);
  });

  it("`upTo` skips the positions already in the keystore and reports them", () => {
    // The headline behaviour of the handoff: 2 and 4 are already stored, so
    // they must cost no generation time and must be visible to the UI as
    // skipped rather than silently vanishing from the run.
    const result = plan({
      selection: { kind: "upTo", n: 5 },
      existing: [2, 4],
      cap: CAP,
    });

    expect(result.requested).toEqual([0, 1, 2, 3, 4, 5]);
    expect(indicesOf(result)).toEqual([0, 1, 3, 5]);
    expect(result.skipped).toEqual([2, 4]);
  });

  it("`ranges` unions the supplied ranges and always includes index 0", () => {
    // The library force-includes 0 anyway; `requested` must say so, otherwise
    // the caller's progress accounting is off by one key on every run.
    const result = plan({
      selection: { kind: "ranges", ranges: [{ start: 3, end: 5 }, { start: 9, end: 9 }] },
      existing: [],
      cap: CAP,
    });

    expect(result.requested).toEqual([0, 3, 4, 5, 9]);
    expect(indicesOf(result)).toEqual([0, 3, 4, 5, 9]);
  });

  it("deduplicates overlapping ranges so no index is planned twice", () => {
    // Overlapping intervals are easy to enter in the `Skipping intervals` UI.
    // A duplicated index means the same key generated (and stored) twice.
    const result = plan({
      selection: {
        kind: "ranges",
        ranges: [
          { start: 2, end: 6 },
          { start: 4, end: 8 },
          { start: 0, end: 1 },
        ],
      },
      existing: [],
      cap: CAP,
    });

    expect(result.requested).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(indicesOf(result)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(result.requested).size).toBe(result.requested.length);
  });
});

describe("planIndexRanges — index 0 and the already-populated partition", () => {
  it("reports an already-populated index 0 as skipped and omits it from ranges", () => {
    // NOTE: this is an OPTIMISATION, not protection. `ranges.js` does
    // `const seen = new Set([0])`, so index 0 is regenerated regardless of
    // what this plan says; the never-clobber guard belongs at storage time.
    // What IS load-bearing here: 0 appears in `skipped`, so the caller knows
    // not to store the result the library will hand back for it.
    const result = plan({
      selection: { kind: "upTo", n: 2 },
      existing: [0],
      cap: CAP,
    });

    expect(result.requested).toEqual([0, 1, 2]);
    expect(indicesOf(result)).toEqual([1, 2]);
    expect(result.skipped).toEqual([0]);
  });

  it("plans nothing when every requested index is already populated", () => {
    // A re-run of an already-complete range must not queue any generation.
    const result = plan({
      selection: { kind: "upTo", n: 3 },
      existing: [3, 1, 0, 2],
      cap: CAP,
    });

    expect(result.ranges).toEqual([]);
    expect(result.skipped).toEqual([0, 1, 2, 3]);
  });

  it("ignores keystore entries outside the requested selection", () => {
    // `existing` is the whole seed's index space; only the intersection with
    // this run belongs in `skipped`, or the UI would report phantom skips.
    const result = plan({
      selection: { kind: "upTo", n: 2 },
      existing: [1, 50, 900],
      cap: CAP,
    });

    expect(result.skipped).toEqual([1]);
    expect(indicesOf(result)).toEqual([0, 2]);
  });
});

describe("planIndexRanges — refusals", () => {
  it("refuses a selection that would generate more than `cap` indices", () => {
    // The progressive ceiling (100 with no Arweave key, 1000 once one exists)
    // is enforced through this branch; at 6.7 s/key an unchecked run is hours.
    const message = planError({
      selection: { kind: "upTo", n: CAP }, // 0..100 inclusive = cap + 1 indices
      existing: [],
      cap: CAP,
    });

    expect(message).toMatch(/101/);
    expect(message).toMatch(/100/);
  });

  it("accepts a selection of exactly `cap` indices", () => {
    // The boundary must not be off by one, or the UI refuses a legal run.
    const result = plan({
      selection: { kind: "upTo", n: CAP - 1 },
      existing: [],
      cap: CAP,
    });

    expect(result.ranges).toHaveLength(CAP);
  });

  it("counts only the indices it will generate against `cap`, not the skipped ones", () => {
    // Already-populated positions cost no CPU, so they must not consume the
    // ceiling — otherwise resuming a large seed becomes impossible.
    const result = plan({
      selection: { kind: "upTo", n: CAP },
      existing: [7],
      cap: CAP,
    });

    expect(result.requested).toHaveLength(CAP + 1);
    expect(result.ranges).toHaveLength(CAP);
    expect(result.skipped).toEqual([7]);
  });

  it("refuses an enormous span without expanding it", () => {
    // A naive expand-then-check would build a billion-element array and hang
    // the tab before ever reaching the cap test. This must return promptly.
    const message = planError({
      selection: { kind: "upTo", n: 1_000_000_000 },
      existing: [],
      cap: CAP,
    });

    expect(message).toMatch(/100/);
  });

  it("refuses a range whose end precedes its start", () => {
    // The library throws `BatchRangeError` on this; an inverted range would
    // otherwise expand to nothing and quietly generate fewer keys than asked.
    const message = planError({
      selection: { kind: "ranges", ranges: [{ start: 5, end: 2 }] },
      existing: [],
      cap: CAP,
    });

    expect(message).toMatch(/5/);
    expect(message).toMatch(/2/);
  });

  it("refuses a negative index", () => {
    const message = planError({
      selection: { kind: "single", position: -1 },
      existing: [],
      cap: CAP,
    });

    expect(message).toMatch(/-1/);
  });

  it("refuses a non-integer index", () => {
    const message = planError({
      selection: { kind: "upTo", n: 2.5 },
      existing: [],
      cap: CAP,
    });

    expect(message).toMatch(/2\.5/);
  });

  it("refuses a negative bound inside a supplied range", () => {
    const message = planError({
      selection: { kind: "ranges", ranges: [{ start: -3, end: 4 }] },
      existing: [],
      cap: CAP,
    });

    expect(message).toMatch(/-3/);
  });

  it("returns an error rather than throwing on malformed input", () => {
    // The caller surfaces `error` inline in the UI; a thrown exception would
    // escape mid-run and take the generate flow down with it.
    expect(() =>
      planIndexRanges({
        selection: { kind: "ranges", ranges: [{ start: 9, end: 1 }] },
        existing: [],
        cap: CAP,
      }),
    ).not.toThrow();
  });
});
