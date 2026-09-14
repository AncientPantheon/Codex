/**
 * The PURE index-range planner for seeded Arweave (RSA-4096) generation — the
 * "skip already-populated positions" step of
 * `docs/HANDOFF-rsa4096-skip-populated-indices.md`.
 *
 * It turns one of the four UI position modes into the `ranges` array handed to
 * `generateFromBitStringAtRangesAsync`, having first dropped every index the
 * Codex already holds a key for. At ~6.7 s per key, each index that slips
 * through is multiple wasted seconds of CPU. Emitted ranges are SINGLETONS
 * (`{start:i, end:i}`) — the library sorts and deduplicates internally, so
 * granularity is free and singletons are the simplest correct form.
 *
 * CRITICAL — this planner is an OPTIMISATION, NOT the correctness guard.
 * `generateFromBitStringAtRanges` FORCE-INCLUDES INDEX 0 ON EVERY CALL,
 * whatever `ranges` says (verified in the library source, `rsa4096/ranges.js`:
 * `const seen = new Set([0])`, with `indices = [0]` seeded alongside it; there
 * is no parameter to opt out). So filtering index 0 out of `ranges` does NOT
 * stop the library regenerating it, and reporting it in `skipped` does not
 * protect the stored key. The authoritative never-clobber guard lives at the
 * storage / `onResult` step and must be applied to EVERY index:
 *
 *     if (await keystore.has(seedId, index)) return; // never overwrite
 *
 * Everything here is pure: no crypto, no I/O, no React. Malformed input comes
 * back as `{ error }` for the UI to surface inline — never as a throw, which
 * would escape mid-run and take the generate flow down with it.
 */

/** An inclusive `[start, end]` range of address indices (the library's shape). */
export interface IndexRange {
  start: number;
  end: number;
}

/**
 * The four UI position modes. Index 0 is part of every one of them — both
 * because the library forces it and because a seed's `#0` is its primary
 * address.
 */
export type IndexSelection =
  /** `Default — just #0`. */
  | { kind: "default" }
  /** `Custom position — #0 plus one more`. */
  | { kind: "single"; position: number }
  /** `Up to — #0 through N` (inclusive). */
  | { kind: "upTo"; n: number }
  /** `Skipping intervals — a list of ranges`, unioned, plus #0. */
  | { kind: "ranges"; ranges: readonly IndexRange[] };

/** Planner input: what the user picked, what the keystore already holds, and the per-run ceiling. */
export interface PlanIndexRangesInput {
  selection: IndexSelection;
  /** Indices of THIS seed that already have a stored key. Order/duplicates are irrelevant. */
  existing: readonly number[];
  /** The progressive per-run ceiling (100 while the Codex holds no Arweave key, else 1000). */
  cap: number;
}

/** A successful plan. */
export interface IndexPlan {
  /** Singleton ranges for the indices to generate, ascending. */
  ranges: IndexRange[];
  /** Every index the selection expanded to, deduplicated and ascending. */
  requested: number[];
  /** The requested indices already present in `existing`, ascending. */
  skipped: number[];
}

/** A plan, or a human-readable refusal for the UI to show inline. */
export type PlanIndexRangesResult = IndexPlan | { error: string };

/** Whether `value` is usable as an address index. */
function isIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Validates the selection and reduces it to the inclusive spans it covers —
 * index 0 always among them. Returns an error string instead of spans when a
 * bound is negative, non-integer, or inverted.
 */
function spansOf(selection: IndexSelection): IndexRange[] | { error: string } {
  const spans: IndexRange[] = [{ start: 0, end: 0 }];

  switch (selection.kind) {
    case "default":
      return spans;

    case "single":
      if (!isIndex(selection.position)) {
        return { error: `index ${selection.position} must be a non-negative integer` };
      }
      spans.push({ start: selection.position, end: selection.position });
      return spans;

    case "upTo":
      if (!isIndex(selection.n)) {
        return { error: `index ${selection.n} must be a non-negative integer` };
      }
      spans.push({ start: 0, end: selection.n });
      return spans;

    case "ranges":
      for (const range of selection.ranges) {
        if (!isIndex(range.start) || !isIndex(range.end)) {
          return {
            error: `range [${range.start}, ${range.end}] must have non-negative integer bounds`,
          };
        }
        if (range.end < range.start) {
          return { error: `range [${range.start}, ${range.end}] has end before start` };
        }
        spans.push({ start: range.start, end: range.end });
      }
      return spans;
  }
}

/** Merges spans into a disjoint, ascending cover (adjacent spans coalesce too). */
function mergeSpans(spans: readonly IndexRange[]): IndexRange[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: IndexRange[] = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end + 1) {
      if (span.end > last.end) last.end = span.end;
    } else {
      merged.push({ start: span.start, end: span.end });
    }
  }

  return merged;
}

/** How many indices a disjoint cover contains. */
function coverSize(cover: readonly IndexRange[]): number {
  return cover.reduce((total, span) => total + (span.end - span.start + 1), 0);
}

/**
 * Plans the generation run: expands `selection`, partitions it against
 * `existing`, and emits singleton ranges for what is left to generate.
 *
 * The cap is tested BEFORE the spans are expanded (using the cover's size
 * arithmetic, not a materialised list), so an absurd selection such as
 * `{kind:"upTo", n: 1e9}` is refused promptly instead of building a
 * billion-element array and freezing the tab.
 */
export function planIndexRanges(input: PlanIndexRangesInput): PlanIndexRangesResult {
  const { selection, existing, cap } = input;

  const spans = spansOf(selection);
  if ("error" in spans) return spans;

  const cover = mergeSpans(spans);
  const existingSet = new Set(existing);

  // Exact counts without expanding: the union's size minus the stored indices
  // that fall inside it. `existing` is bounded by the keys actually held.
  let alreadyHeld = 0;
  for (const index of existingSet) {
    if (cover.some((span) => index >= span.start && index <= span.end)) alreadyHeld += 1;
  }
  const toGenerate = coverSize(cover) - alreadyHeld;

  if (toGenerate > cap) {
    return {
      error: `this run would generate ${toGenerate} positions, but the per-run limit is ${cap}`,
    };
  }

  // Bounded by `cap + existing.length` now, so this expansion is always safe.
  const requested: number[] = [];
  const skipped: number[] = [];
  const ranges: IndexRange[] = [];

  for (const span of cover) {
    for (let index = span.start; index <= span.end; index += 1) {
      requested.push(index);
      // Index 0 lands in `skipped` like any other held index — see the file
      // header: that does NOT prevent the library regenerating it.
      if (existingSet.has(index)) skipped.push(index);
      else ranges.push({ start: index, end: index });
    }
  }

  return { ranges, requested, skipped };
}
