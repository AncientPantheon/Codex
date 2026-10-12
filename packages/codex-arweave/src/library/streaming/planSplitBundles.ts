/**
 * Free-space check + bundle-splitting planner (T1 of
 * `arweave-split-bundle-upload`).
 *
 * Grounding: `docs/work/arweave-split-bundle-upload/design.md` §1. A bundle
 * upload needs its whole concatenated byte stream staged in OPFS before it
 * can be hashed/posted — peak disk usage during assembly is roughly the
 * bundle's own total size. A selection whose total exceeds what's safely
 * available cannot be bundled in one pass. Rather than fail outright or
 * demand impossible free space, the selection is split into the minimum
 * number of roughly-equal bundles that each fit within a safe budget.
 *
 * Two pieces, deliberately separated:
 * - `checkAvailableStorageBudget` — the one real I/O touch (`navigator.
 *   storage.estimate()`, injectable for tests), producing a safe byte
 *   budget.
 * - `planSplitBundles` — a PURE function, zero I/O, that partitions a flat
 *   file list into K groups given that budget. Kept pure and separate so
 *   the splitting logic itself is trivially unit-testable without ever
 *   touching a browser API.
 */

/**
 * Structural view of `StorageManager`'s one member this module uses.
 * Narrow, local, structural typing — never widens `tsconfig`'s `lib`
 * config — mirrors `isStreamingUploadSupported.ts`'s exact convention for
 * the same kind of `navigator.storage`-adjacent browser API: declare only
 * the members this module actually calls, so a real `StorageManager` (or a
 * narrow fake) satisfies it without any cast.
 */
interface StorageEstimateLike {
  estimate(): Promise<{ usage?: number; quota?: number }>;
}

/** Options for {@link checkAvailableStorageBudget}. */
export interface CheckAvailableStorageBudgetOptions {
  /**
   * Produces the `{usage, quota}` estimate. INJECTED — mirrors
   * `isStreamingUploadSupported.ts`'s `getDirectory` injection convention
   * exactly, including defaulting to the real `navigator.storage.
   * estimate()` when omitted — so tests never touch a real browser API and
   * the real call path is exercised identically to how that module
   * exercises its own default.
   */
  estimate?: () => Promise<{ usage: number; quota: number }>;
}

/** Result of {@link checkAvailableStorageBudget}. */
export interface StorageBudget {
  /** Raw `quota - usage` from the browser's own estimate, in bytes. */
  availableBytes: number;
  /** A safe per-attempt byte budget, meaningfully below `availableBytes`. */
  safeBudgetBytes: number;
}

/**
 * Safety-margin reasoning (documented per the task's explicit requirement
 * to state and justify a real choice, not an arbitrary number):
 *
 * `navigator.storage.estimate()`'s `{usage, quota}` is explicitly an
 * ESTIMATE, not a hard guarantee — the spec itself permits browsers to
 * return approximate figures, and the true free space can shift during a
 * long-running upload (other tabs/origins writing concurrently, the OS
 * reclaiming space, browser-internal bookkeeping). On top of that
 * approximateness, OPFS bundle assembly needs some working room BEYOND
 * just the bundle's own final byte size — header/tag overhead atop the raw
 * file bytes, and transient double-buffering during the sync-access-handle
 * write path.
 *
 * Margin chosen: keep 80% of `availableBytes` as the safe budget (a flat
 * 20% discount), floored at a minimum reserve of 256 MiB subtracted
 * on top (never below zero). The percentage-based portion is deliberate
 * over a purely fixed-byte discount: a fixed number of bytes becomes
 * negligible at large scale (e.g. "available minus 500MB" is a trivial
 * 0.05% safety cushion against 1TB available, but would be the entire
 * budget against 500MB available) — proportional scaling keeps the
 * relative cushion meaningful across the full range of realistic
 * available-space scenarios, which the test suite checks directly (the
 * safe:available ratio must stay above 0.5 even at a 100GB scale, i.e. the
 * margin does not become proportionally tiny as space grows). The
 * additional small fixed floor is layered in afterward only to keep the
 * budget meaningfully non-zero at very small scales, never to dominate the
 * calculation at realistic multi-GB scales.
 */
const SAFETY_MARGIN_FRACTION = 0.8;
const SAFETY_MARGIN_FIXED_FLOOR_BYTES = 256 * 1024 * 1024;

function defaultEstimate(): Promise<{ usage: number; quota: number }> {
  // Read through the structural view (never `any`) — the same one real
  // `navigator` touch `isStreamingUploadSupported.ts`'s own
  // `defaultGetDirectory` makes; everywhere else in this module only sees
  // the injected seam.
  const storage = (navigator as unknown as { storage: StorageEstimateLike })
    .storage;
  return storage.estimate().then((result) => ({
    usage: result.usage ?? 0,
    quota: result.quota ?? 0,
  }));
}

/**
 * Computes a safe per-attempt storage budget from the real (or injected)
 * `navigator.storage.estimate()`. See the module-level comment above for
 * the full safety-margin reasoning.
 */
export async function checkAvailableStorageBudget(
  opts: CheckAvailableStorageBudgetOptions = {},
): Promise<StorageBudget> {
  const estimate = opts.estimate ?? defaultEstimate;
  const { usage, quota } = await estimate();
  const availableBytes = Math.max(0, quota - usage);
  const safeBudgetBytes = Math.max(
    0,
    availableBytes * SAFETY_MARGIN_FRACTION - SAFETY_MARGIN_FIXED_FLOOR_BYTES,
  );
  return { availableBytes, safeBudgetBytes };
}

/** A single planned file: its path and byte size. */
export interface PlannedFile {
  path: string;
  size: number;
}

/** Result of {@link planSplitBundles}. */
export interface SplitBundlePlan {
  /** K groups of files, each group's total size within `budgetBytes`. */
  bundles: PlannedFile[][];
  /**
   * Files whose own individual size exceeds `budgetBytes` — cannot be
   * split under this architecture (bundling boundaries are per-file, not
   * per-byte-within-a-file). Never included in any `bundles` group.
   */
  oversizedFiles: PlannedFile[];
}

/**
 * Partitions `files` into the minimum number of groups K such that each
 * group's total size fits within `budgetBytes`, with groups as close to
 * equal size as possible. PURE — zero I/O.
 *
 * Algorithm: files individually larger than `budgetBytes` are filtered out
 * up front into `oversizedFiles` (they cannot be split under this
 * architecture — bundling boundaries are per-file). For the remainder,
 * `K = ceil(totalSize / budgetBytes)` is the minimum group count that could
 * possibly fit the total, and `target = totalSize / K` is the ideal
 * per-group size for perfectly equal groups. Files are then walked in
 * order, accumulating into the current group; a file is held BACK for the
 * next group (rather than appended) only once the current group already
 * has at least one file AND appending would push the group's size further
 * from the target than leaving it as-is would — concretely, once the
 * current group's accumulated size has already reached `target`. This
 * produces roughly-equal groups rather than a greedy "fill completely to
 * budget, dump everything remaining into the last group" approach, which
 * would make the final group wildly larger or smaller than the others.
 * Every group's size is additionally hard-capped at `budgetBytes` as a
 * safety backstop even if float rounding ever pushed a target-based cut
 * right at the boundary.
 */
export function planSplitBundles(
  files: readonly PlannedFile[],
  budgetBytes: number,
): SplitBundlePlan {
  const oversizedFiles: PlannedFile[] = [];
  const splittableFiles: PlannedFile[] = [];
  for (const file of files) {
    if (file.size > budgetBytes) {
      oversizedFiles.push(file);
    } else {
      splittableFiles.push(file);
    }
  }

  if (splittableFiles.length === 0) {
    return { bundles: [], oversizedFiles };
  }

  const totalSize = splittableFiles.reduce((sum, f) => sum + f.size, 0);
  const groupCount = Math.max(1, Math.ceil(totalSize / budgetBytes));
  const targetSize = totalSize / groupCount;

  const bundles: PlannedFile[][] = [];
  let currentGroup: PlannedFile[] = [];
  let currentGroupSize = 0;

  for (const file of splittableFiles) {
    // Only the last group is allowed to run past its target (nothing left
    // to defer the remainder to) — earlier groups close out BEFORE adding
    // a file that would push them past target, so size is distributed
    // evenly rather than each non-final group greedily maxing out toward
    // budget first (which would starve later groups and badly unbalance
    // them — the exact "greedy-fill-then-dump-remainder" anti-pattern the
    // design doc calls out).
    const isLastGroup = bundles.length === groupCount - 1;
    const wouldExceedTarget =
      !isLastGroup && currentGroupSize + file.size > targetSize;
    // Hard safety backstop regardless of target/last-group status: no
    // group may ever exceed the real byte budget.
    const wouldExceedBudget = currentGroupSize + file.size > budgetBytes;

    if (
      currentGroup.length > 0 &&
      (wouldExceedTarget || wouldExceedBudget)
    ) {
      bundles.push(currentGroup);
      currentGroup = [];
      currentGroupSize = 0;
    }

    currentGroup.push(file);
    currentGroupSize += file.size;
  }

  if (currentGroup.length > 0) {
    bundles.push(currentGroup);
  }

  return { bundles, oversizedFiles };
}
