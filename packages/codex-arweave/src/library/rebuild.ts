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

  return {
    id: record.id,
    owner,
    itemId,
    contentType,
    status: "final",
    createdAt: REBUILD_CREATED_AT,
    tags: [...record.tags],
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
  const { store, pool, fetchFn, opts: queryOpts } = opts;

  // POOL-FIRST: queryOwnerUploads(pool, owner, opts). Forward the fetch seam
  // alongside any caller-supplied query knobs.
  const records = await queryOwnerUploads(pool, owner, {
    fetchFn,
    ...queryOpts,
  });

  const entries = records.map(recordToEntry);
  await store.reconcile(owner, entries);
}
