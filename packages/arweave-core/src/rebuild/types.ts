/**
 * Rebuild-query public types and defaults.
 *
 * The rebuild query is the source of truth for a later Library cache: given an
 * owner address, it queries the gateway GraphQL index by the tag schema through
 * the Phase 2 pool and returns the matching transaction ids + tags. A consumer
 * reconstructs entries from these `{ id, tags }` records.
 *
 * `maxPages`'s default decides when the public `RebuildPageLimitError` fires, so
 * both page defaults are EXPORTED, JSDoc'd named constants (the
 * `DEFAULT_CONFIRMATION_DEPTH` idiom) — consumers must be able to introspect the
 * limit that governs the error they may catch.
 */

/**
 * One matching on-chain upload: the transaction / data-item id and its tags,
 * in gateway-returned order. The reconstruction INPUT for a later Library cache.
 */
export interface OwnerUploadRecord {
  /** The transaction / data-item id (canonical 43-char base64url form). */
  readonly id: string;
  /** The item's on-chain tags, verbatim, in gateway-returned order. */
  readonly tags: ReadonlyArray<{ name: string; value: string }>;
}

/**
 * Default page size for the GraphQL `first` argument. `100` is the arweave.net
 * gateway maximum — an oversized value would deterministically fail on EVERY
 * endpoint and burn the whole pool, so the validated range is `1..100`.
 */
export const DEFAULT_REBUILD_PAGE_SIZE = 100;

/**
 * Default cap on cumulative page fetches before {@link RebuildPageLimitError}
 * fires. Restarts (from cursor-endpoint-binding rotations) count against this
 * same budget so a flapping pool still terminates rather than looping forever.
 */
export const DEFAULT_REBUILD_MAX_PAGES = 50;

/**
 * The injectable fetch seam. Its default MUST be binding-safe and resolved at
 * CALL time — a bare `globalThis.fetch` captured at module load would throw
 * `TypeError: Illegal invocation` in browsers (WebIDL receiver brand check) when
 * called detached, and would blind test stubs installed after module load.
 */
export type FetchFn = typeof fetch;

/** Options for the rebuild query. */
export interface QueryOwnerUploadsOptions {
  /** App-Name filter override; defaults to `DEFAULT_APP_NAME`. When EXPLICITLY
   *  provided it must be a non-empty string — an empty App-Name filter would
   *  silently match nothing (the same `""`-bypass rigor as the upload builder). */
  appName?: string;
  /** GraphQL `first` per page. Integer in `1..100`; defaults to
   *  {@link DEFAULT_REBUILD_PAGE_SIZE}. */
  pageSize?: number;
  /** Cumulative page-fetch cap before {@link RebuildPageLimitError}. Integer
   *  `>= 1`; defaults to {@link DEFAULT_REBUILD_MAX_PAGES}. */
  maxPages?: number;
  /** Injectable fetch seam; defaults to a binding-safe call-time delegate to
   *  `globalThis.fetch`. */
  fetchFn?: FetchFn;
}
