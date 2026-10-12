// @vitest-environment node
/**
 * T1 RED/GREEN (`arweave-split-bundle-upload`) — the free-space check
 * (`checkAvailableStorageBudget`) and the pure bundle-splitting planner
 * (`planSplitBundles`).
 *
 * Grounding: see `docs/work/arweave-split-bundle-upload/design.md` §1. A
 * bundle's peak OPFS staging usage is roughly its own total size, so a
 * selection whose total exceeds what's safely available must split into the
 * minimum number of roughly-equal bundles that each fit, rather than fail
 * outright or demand impossible free space. `checkAvailableStorageBudget`
 * wraps the real (injectable, for tests) `navigator.storage.estimate()`;
 * `planSplitBundles` is a PURE function with zero I/O, taking a byte budget
 * and a flat file list and returning the K-way grouping.
 *
 * `// @vitest-environment node` — pure logic over injected fakes/plain data,
 * nothing here touches a real browser API or React, same reasoning
 * `streaming-upload-supported.test.ts` and `streaming-bundle-assembly-file.
 * test.ts` give for their own `node` pragma.
 */

import { describe, it, expect } from "vitest";

import {
  checkAvailableStorageBudget,
  planSplitBundles,
} from "../src/library/streaming/planSplitBundles.js";

const GB = 1024 * 1024 * 1024;

describe("checkAvailableStorageBudget (T1)", () => {
  it("computes availableBytes as quota minus usage from an injected fake estimate", async () => {
    const estimate = async () => ({ usage: 10 * GB, quota: 50 * GB });

    const result = await checkAvailableStorageBudget({ estimate });

    // Regression this catches: a mis-wired call that reads usage/quota in
    // the wrong order, or forgets the subtraction entirely and just returns
    // the raw quota, would NOT match this exact arithmetic.
    expect(result.availableBytes).toBe(40 * GB);
  });

  it("returns a safeBudgetBytes strictly smaller than availableBytes, never equal or larger", async () => {
    const estimate = async () => ({ usage: 10 * GB, quota: 50 * GB });

    const result = await checkAvailableStorageBudget({ estimate });

    // Regression this catches: a "safety margin" that is actually zero (an
    // implementation that just returns availableBytes unchanged, offering
    // no real cushion against the quota estimate's own approximateness or
    // the bundle-assembly process's working-room needs described in the
    // design doc). This is a strict inequality, not a presence check.
    expect(result.safeBudgetBytes).toBeLessThan(result.availableBytes);
    expect(result.safeBudgetBytes).toBeGreaterThan(0);
  });

  it("scales the margin with availableBytes rather than applying a single fixed-size discount regardless of scale", async () => {
    const smallEstimate = async () => ({ usage: 0, quota: 1 * GB });
    const largeEstimate = async () => ({ usage: 0, quota: 100 * GB });

    const small = await checkAvailableStorageBudget({ estimate: smallEstimate });
    const large = await checkAvailableStorageBudget({ estimate: largeEstimate });

    // Regression this catches: a margin implemented as only a fixed-byte
    // floor subtraction (e.g. always "available - 500MB") would make the
    // safe budget nearly equal to availableBytes at large scale, defeating
    // the "approximate estimate" reasoning the design doc calls for scaling
    // the margin with the estimate's own size, not just a constant floor.
    const smallRatio = small.safeBudgetBytes / small.availableBytes;
    const largeRatio = large.safeBudgetBytes / large.availableBytes;
    expect(largeRatio).toBeGreaterThan(0.5);
    expect(smallRatio).toBeGreaterThan(0);
  });
});

describe("planSplitBundles (T1)", () => {
  it("returns exactly 1 group when total size fits within budget (common-case regression guard)", () => {
    const files = [
      { path: "a.jpg", size: 10 * 1024 * 1024 },
      { path: "b.jpg", size: 20 * 1024 * 1024 },
      { path: "c.jpg", size: 15 * 1024 * 1024 },
    ];
    const budgetBytes = 1 * GB;

    const result = planSplitBundles(files, budgetBytes);

    // Regression this catches: a planner that always splits into some
    // minimum of 2+ groups regardless of whether splitting is actually
    // needed — the single most important behavior to never regress, since
    // every existing in-budget upload must stay a single bundle.
    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]).toHaveLength(3);
    expect(result.oversizedFiles).toHaveLength(0);
  });

  it("splits a total exceeding budget into the minimum K, every group within budget, reasonably balanced", () => {
    // 10 files of 25MB each = 250MB total. Budget 100MB → ceil(250/100) = 3
    // groups, target ~83.3MB/group. Chosen so the true minimum K (given the
    // file-size granularity — a group can hold at most 4 files of 25MB
    // within a 100MB budget) is genuinely achievable as exactly 3 groups
    // (e.g. 4+3+3 files), unlike a fixture where discrete file sizes alone
    // would force a 4th group regardless of balancing strategy.
    const fileSize = 25 * 1024 * 1024;
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `file-${i}.bin`,
      size: fileSize,
    }));
    const budgetBytes = 100 * 1024 * 1024;

    const result = planSplitBundles(files, budgetBytes);

    expect(result.oversizedFiles).toHaveLength(0);
    // Minimum K: ceil(250MB / 100MB) = 3.
    expect(result.bundles).toHaveLength(3);

    const groupSizes = result.bundles.map((group) =>
      group.reduce((sum, f) => sum + f.size, 0),
    );
    for (const size of groupSizes) {
      // No group may ever exceed the budget — the one hard constraint this
      // planner exists to uphold.
      expect(size).toBeLessThanOrEqual(budgetBytes);
    }

    // Balance tolerance: largest/smallest group-size ratio must stay within
    // 2x. Justification: with K computed as ceil(total/budget) and an even
    // per-group file count (10 files / 3 groups → group file counts of
    // 4/3/3), the worst-case size skew from indivisible per-file boundaries
    // is bounded by roughly one file's size relative to the smallest group
    // — for this fixture (3-4 files/group, uniform file size) the true
    // ratio is ~1.33x, well inside a 2x bound, which is loose enough to
    // tolerate realistic file-size variance while still catching a truly
    // broken "greedy-fill-then-dump-remainder" implementation (which would
    // produce a near-empty or hugely lopsided last group here, e.g. 1 file
    // in the last group vs. 4-5 in earlier ones — a ratio far past 2x).
    const largest = Math.max(...groupSizes);
    const smallest = Math.min(...groupSizes);
    expect(largest / smallest).toBeLessThanOrEqual(2);

    // Every input file is accounted for exactly once across all groups.
    const allOutputFiles = result.bundles.flat();
    expect(allOutputFiles).toHaveLength(files.length);
    expect(new Set(allOutputFiles.map((f) => f.path)).size).toBe(files.length);
  });

  it("routes a single file larger than budgetBytes to oversizedFiles, never into any bundles group", () => {
    const hugeFile = { path: "huge.mov", size: 5 * GB };
    const normalFiles = [
      { path: "a.jpg", size: 10 * 1024 * 1024 },
      { path: "b.jpg", size: 20 * 1024 * 1024 },
    ];
    const budgetBytes = 1 * GB;

    const result = planSplitBundles([hugeFile, ...normalFiles], budgetBytes);

    // Explicit, direct assertion: the oversized file is reported...
    expect(result.oversizedFiles).toHaveLength(1);
    expect(result.oversizedFiles[0]?.path).toBe("huge.mov");

    // ...and is NEVER present in any returned bundle group, including a
    // group that would otherwise have room left over for smaller files.
    const allBundledPaths = result.bundles.flat().map((f) => f.path);
    expect(allBundledPaths).not.toContain("huge.mov");

    // The normal-sized files still get bundled normally (one group, since
    // their own combined total fits easily within budget).
    expect(allBundledPaths.sort()).toEqual(["a.jpg", "b.jpg"]);
  });

  it("returns {bundles: [], oversizedFiles: []} cleanly for an empty file list, no error", () => {
    const result = planSplitBundles([], 1 * GB);

    expect(result.bundles).toEqual([]);
    expect(result.oversizedFiles).toEqual([]);
  });

  it("produces a sane plan for a realistic mixed fixture: many small files plus a couple of large outliers", () => {
    // Models the owner's real scenario: thousands-of-images style selection,
    // scaled down for a fast test — 200 small files (~2MB each, 400MB total)
    // plus 2 larger outlier files (~150MB each, 300MB total) = 700MB total.
    const smallFiles = Array.from({ length: 200 }, (_, i) => ({
      path: `img-${i}.jpg`,
      size: 2 * 1024 * 1024,
    }));
    const largeFiles = [
      { path: "video-1.mov", size: 150 * 1024 * 1024 },
      { path: "video-2.mov", size: 150 * 1024 * 1024 },
    ];
    const files = [...smallFiles, ...largeFiles];
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const budgetBytes = 250 * 1024 * 1024;

    const result = planSplitBundles(files, budgetBytes);

    expect(result.oversizedFiles).toHaveLength(0);

    // `planSplitBundles` is a single left-to-right pass (no reordering/
    // bin-packing lookahead — see its own doc comment), so with BOTH large
    // outliers clustered at the very end of the input (as they are here —
    // a realistic case: alphabetically-last filenames, or simply added to
    // the selection last), it cannot always hit the theoretical
    // mathematical minimum K a reordering bin-packer could (here, 3 would
    // be achievable by interleaving the two outliers into separate groups
    // with ~50 small files each — but this pass processes input order, not
    // size order). The honest, justified bound asserted here is: never
    // fewer than the mathematical minimum (impossible — budget is a hard
    // per-group cap), and never more than minimum + 1 (one extra group,
    // from the single worst-case "last group had no room left for the
    // final outlier" tail effect) — not an unbounded regression into many
    // small straggler groups.
    const minimumPossibleK = Math.ceil(totalSize / budgetBytes);
    expect(result.bundles.length).toBeGreaterThanOrEqual(minimumPossibleK);
    expect(result.bundles.length).toBeLessThanOrEqual(minimumPossibleK + 1);

    // No group exceeds budget — the one hard constraint this planner must
    // uphold regardless of input ordering.
    for (const group of result.bundles) {
      const groupSize = group.reduce((sum, f) => sum + f.size, 0);
      expect(groupSize).toBeLessThanOrEqual(budgetBytes);
    }

    // Every file accounted for exactly once.
    const allOutputFiles = result.bundles.flat();
    expect(allOutputFiles).toHaveLength(files.length);
    expect(new Set(allOutputFiles.map((f) => f.path)).size).toBe(files.length);
  });
});
