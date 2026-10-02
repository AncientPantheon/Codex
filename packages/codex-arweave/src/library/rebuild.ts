/**
 * The rebuild-from-chain self-heal (E-08, N-07) — reconstruct the Library from
 * the on-chain tag index, the SOURCE OF TRUTH.
 *
 * `rebuildLibrary` runs arweave-core `queryOwnerUploads` (owner-scoped, filtered
 * by the cryptographically-bound signer, so forged tags cannot poison the set),
 * maps each `OwnerUploadRecord` to a `LibraryEntry`, and hands the batch to the
 * store's field-level `reconcile`.
 *
 * Determinism: rebuilt-only entries carry a REBUILD-STABLE sentinel `createdAt`
 * (0) — never `Date.now()` and never the gateway-returned index — so `list`
 * ordering (createdAt DESC, id DESC tiebreak) is identical across rebuilds even
 * when the gateway returns the same ids in a different order.
 *
 * N-07: imports ONLY arweave-core (`queryOwnerUploads` + the tag-name constants)
 * and the `LibraryStore` seam. It NEVER touches the codec / backup, and the
 * manifest flag is RE-DETECTED via the SAME content-type helper the upload path
 * uses (one spelling for upload↔rebuild).
 */

import {
  queryOwnerUploads,
  TAG_CODEX_ITEM_ID,
  TAG_CONTENT_TYPE,
  TAG_CODEX_OWNER,
  TAG_CODEX_UPLOAD_ID,
  type OwnerUploadRecord,
  type QueryOwnerUploadsOptions,
  type GatewayPool,
  type Tag,
} from "@ancientpantheon/arweave-core";

import { MANIFEST_CONTENT_TYPE } from "./constants.js";
import type { LibraryEntry, LibraryStore } from "./types.js";

/**
 * The rebuild-stable ordering key for rebuilt-only entries. A fixed sentinel
 * (NOT `Date.now()`, NOT the gateway order) so `list`'s ordering is carried by
 * the deterministic id tiebreak and is identical across repeated rebuilds.
 */
const REBUILD_CREATED_AT = 0;

/** Options for {@link rebuildLibrary}. */
export interface RebuildLibraryOptions {
  /** The Library seam the reconstructed entries are reconciled into. */
  store: LibraryStore;
  /** The gateway pool the GraphQL query runs through (POOL-FIRST arg). */
  pool: GatewayPool;
  /** Injectable fetch seam forwarded to arweave-core — tests inject a fake. */
  fetchFn?: typeof fetch;
  /** Optional pass-through of the rebuild query knobs (appName/pageSize/maxPages). */
  opts?: QueryOwnerUploadsOptions;
  /** Optional per-page progress callback, forwarded straight through to
   *  arweave-core's `queryOwnerUploads` (see that option's own doc comment
   *  for the exact firing contract — page-level, running totals, never for a
   *  discarded mid-pagination restart). `rebuildLibraryForAllOwners` below is
   *  the multi-address caller that actually composes this into a UI-facing
   *  progress event; a single-owner caller may still use it directly. */
  onProgress?: (progress: { pagesFetched: number; recordsFound: number }) => void;
}

/** Read a tag value by name from a record's tag list; `undefined` when absent. */
function tagValue(tags: ReadonlyArray<Tag>, name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

/** Map one on-chain record to a `final`, rebuild-stable {@link LibraryEntry}. */
function recordToEntry(record: OwnerUploadRecord): LibraryEntry {
  const contentType = tagValue(record.tags, TAG_CONTENT_TYPE) ?? "";
  const itemId = tagValue(record.tags, TAG_CODEX_ITEM_ID) ?? "";
  const owner = tagValue(record.tags, TAG_CODEX_OWNER) ?? "";
  // T7: read the Codex-Upload-Id tag (Wave 1 T2 / Wave 2 T4) so a rebuilt
  // bundle's N files + manifest group back together under one uploadId — the
  // SAME value `uploadAndTrack`'s bundle path shares across the entries it
  // appends locally (`library/flow.ts`). A record whose tags predate the
  // schema (no Codex-Upload-Id tag) falls back to the record's own id, so a
  // pre-existing upload still rebuilds without erroring or losing grouping
  // identity (it simply groups as its own one-item action, mirroring
  // `uploadData`'s own `uploadId: itemId` convention for a fresh single-file
  // upload).
  const uploadId = tagValue(record.tags, TAG_CODEX_UPLOAD_ID) ?? record.id;

  return {
    id: record.id,
    owner,
    itemId,
    contentType,
    status: "final",
    createdAt: REBUILD_CREATED_AT,
    tags: [...record.tags],
    uploadId,
    ...(contentType === MANIFEST_CONTENT_TYPE
      ? { manifest: { isManifest: true } as const }
      : {}),
  };
}

/**
 * Reconstruct `owner`'s Library from the on-chain index and reconcile it into
 * the store.
 *
 * A wiped store self-heals to the full set; a both-present id keeps its local
 * `createdAt` + `manifest` and gains `status:"final"` + refreshed tags (the
 * store's field-level merge); a local entry absent from the query survives; and
 * an owner with zero records is a no-op.
 */
export async function rebuildLibrary(
  owner: string,
  opts: RebuildLibraryOptions,
): Promise<void> {
  const { store, pool, fetchFn, opts: queryOpts, onProgress } = opts;

  // POOL-FIRST: queryOwnerUploads(pool, owner, opts). Forward the fetch seam
  // alongside any caller-supplied query knobs + the progress callback.
  const records = await queryOwnerUploads(pool, owner, {
    fetchFn,
    onProgress,
    ...queryOpts,
  });

  const entries = records.map(recordToEntry);
  await store.reconcile(owner, entries);
}

/** One owner's own page/record progress — arweave-core's `queryOwnerUploads`
 *  progress shape, re-exported here under a named type so a multi-owner
 *  caller doesn't have to reach into arweave-core just to type it. */
export interface OwnerRebuildProgress {
  pagesFetched: number;
  recordsFound: number;
}

/** A multi-owner auto-rebuild's current progress: WHICH owner (by index/
 *  total) is currently being rebuilt, plus that owner's own page/record
 *  progress — the exact composition `rebuildLibraryForAllOwners` reports. */
export interface MultiOwnerRebuildProgress {
  /** 0-based index of the owner CURRENTLY being rebuilt. */
  ownerIndex: number;
  /** Total (de-duplicated) owners this run is rebuilding. */
  totalOwners: number;
  /** The CURRENT owner's own running page/record progress. */
  currentOwnerProgress: OwnerRebuildProgress;
}

/** Options for {@link rebuildLibraryForAllOwners}. */
export interface RebuildLibraryForAllOwnersOptions {
  /** The Library seam the reconstructed entries are reconciled into — the
   *  SAME store every owner's rebuild reconciles into. */
  store: LibraryStore;
  /** The gateway pool every owner's GraphQL query runs through. */
  pool: GatewayPool;
  /** Injectable fetch seam forwarded to every owner's `rebuildLibrary` call. */
  fetchFn?: typeof fetch;
  /** Optional pass-through of the rebuild query knobs, applied to EVERY
   *  owner's query (appName/pageSize/maxPages). */
  opts?: QueryOwnerUploadsOptions;
  /** Composed progress callback — fires with the CURRENT owner's index/total
   *  alongside that owner's own page/record progress, every time the
   *  underlying `rebuildLibrary` call's own `onProgress` would fire. */
  onProgress?: (progress: MultiOwnerRebuildProgress) => void;
  /** Fires once per owner whose `rebuildLibrary` call REJECTS, after the
   *  failure is caught and before moving on to the next owner — so a caller
   *  can surface WHICH address(es) failed without the whole batch aborting.
   *  Absent, a failure is simply swallowed and the batch still continues —
   *  the same "one bad row never blocks the others" resilience
   *  `ArweaveAccountsArea.tsx`'s own `Promise.allSettled` balance-read
   *  convention already establishes for this exact shape of problem, just
   *  reported via a callback here (the composition runs outside any
   *  component, so there is no local state to collect into). */
  onOwnerError?: (owner: string, error: unknown) => void;
}

/**
 * Rebuild-from-chain for EVERY owner address in `owners`, SEQUENTIALLY,
 * de-duplicated (mirrors `LibraryArea`'s own `[...new Set(owners)]` —
 * a caller that (harmlessly) repeats the same address is never re-queried).
 *
 * Sequential, not parallel: each call's own `onProgress` composes into ONE
 * `ownerIndex`-tagged event stream a UI can render as "address N of M, P
 * pages checked, R found so far" — a concept that only makes sense for one
 * owner being actively rebuilt at a time, and the pool is shared across every
 * call regardless, so there is no concurrency upside to running them in
 * parallel here the way `ArweaveAccountsArea`'s independent, pool-free
 * balance reads have.
 *
 * A single owner's `rebuildLibrary` rejecting does NOT abort the remaining
 * owners (see {@link RebuildLibraryForAllOwnersOptions.onOwnerError}'s own
 * doc comment for why) — a bad/unreachable address must never hide every
 * OTHER address's uploads.
 */
export async function rebuildLibraryForAllOwners(
  owners: readonly string[],
  opts: RebuildLibraryForAllOwnersOptions,
): Promise<void> {
  const { store, pool, fetchFn, opts: queryOpts, onProgress, onOwnerError } = opts;
  const uniqueOwners = [...new Set(owners)];
  const totalOwners = uniqueOwners.length;

  for (let ownerIndex = 0; ownerIndex < totalOwners; ownerIndex += 1) {
    const owner = uniqueOwners[ownerIndex]!;
    try {
      await rebuildLibrary(owner, {
        store,
        pool,
        fetchFn,
        opts: queryOpts,
        onProgress:
          onProgress === undefined
            ? undefined
            : (currentOwnerProgress) => onProgress({ ownerIndex, totalOwners, currentOwnerProgress }),
      });
    } catch (cause) {
      onOwnerError?.(owner, cause);
    }
  }
}
