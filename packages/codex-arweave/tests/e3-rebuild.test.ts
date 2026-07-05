/**
 * E3 RED matrix — rebuild-from-chain self-heal (E-08, N-07).
 *
 * `rebuildLibrary(owner, { store, pool, fetchFn?, opts? })` runs arweave-core
 * `queryOwnerUploads` (the on-chain tag index, the SOURCE OF TRUTH), maps each
 * `OwnerUploadRecord` to a `LibraryEntry` (extract itemId/contentType/owner via
 * the arweave-core TAG_* constants; status:"final"; a REBUILD-STABLE sentinel
 * createdAt; RE-DETECT the manifest flag), and `store.reconcile`s. Pins:
 *   - a WIPED store self-heals to N entries newest-first, deterministic;
 *   - tag-name coherence: upload↔rebuild share the arweave-core TAG_* spelling;
 *   - rebuilt entries are status:"final";
 *   - manifest re-detection (a manifest content-type record → flagged entry);
 *   - FIELD-LEVEL merge (local manifest+createdAt survive; status→final; tags
 *     refreshed);
 *   - IDEMPOTENCY-OF-ORDERING: rebuild TWICE with the 2nd fetchFn returning the
 *     SAME ids in a DIFFERENT (permuted) order → identical order + identical
 *     createdAt (discriminates a rebuild-stable key from a gateway-order key);
 *   - idempotent-no-dup, non-destructive (local pending survives), zero-records
 *     → no-op.
 *
 * RED: the `../src/library` rebuild surface does not exist yet.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  TAG_CODEX_ITEM_ID,
  TAG_CONTENT_TYPE,
  TAG_CODEX_OWNER,
  buildUploadTags,
  type Tag,
} from "@ancientpantheon/arweave-core";

// RED: none of these exist yet (T13.5 store + T13.6 rebuild GREEN).
import {
  MemoryLibraryStore,
  rebuildLibrary,
  type LibraryEntry,
} from "../src/library";

import {
  KNOWN_ADDRESS,
  CANONICAL_ID_A,
  CANONICAL_ID_B,
  MANIFEST_CONTENT_TYPE,
  ownerUploadRecords,
  makeFetchFn,
  makeHealthPool,
  graphqlRebuildBody,
} from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;

const tagVal = (tags: readonly Tag[], name: string): string | undefined =>
  tags.find((t) => t.name === name)?.value;

describe("E3 rebuild — wiped-store self-heal (E-08)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  it("(a) an EMPTY store reconstructs N entries from the GraphQL records, newest-first deterministic", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, graphqlRebuildBody(ownerUploadRecords));

    await rebuildLibrary(OWNER, { store, pool, fetchFn });

    const list = await store.list(OWNER);
    expect(list).toHaveLength(ownerUploadRecords.length);
    // All ids present, owner-scoped.
    expect(new Set(list.map((e) => e.id))).toEqual(
      new Set(ownerUploadRecords.map((r) => r.id)),
    );
    expect(list.every((e) => e.owner === OWNER)).toBe(true);
    // Rebuilt-only entries share the sentinel createdAt (0) → ordering is carried
    // entirely by the SECONDARY id tiebreak (id DESC in list = newest-first).
    expect(list.every((e) => e.createdAt === 0)).toBe(true);
    const ids = list.map((e) => e.id);
    const sortedDesc = [...ids].sort().reverse();
    expect(ids).toEqual(sortedDesc);
  });

  it("(b) tag-name coherence: itemId/contentType/owner are extracted via the arweave-core TAG_* constants — a buildUploadTags upload round-trips", async () => {
    // An upload's tags (built by arweave-core) become a queryOwnerUploads record
    // read back with the SAME constants — one spelling for upload↔rebuild.
    const uploadedTags = buildUploadTags({
      ownerAddress: OWNER,
      contentType: "image/png",
      itemId: "round-trip-item",
    });
    const record = { id: CANONICAL_ID_A, tags: uploadedTags };
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, graphqlRebuildBody([record]));

    await rebuildLibrary(OWNER, { store, pool, fetchFn });

    const e = await store.get(CANONICAL_ID_A);
    expect(e!.itemId).toBe(tagVal(uploadedTags, TAG_CODEX_ITEM_ID));
    expect(e!.contentType).toBe(tagVal(uploadedTags, TAG_CONTENT_TYPE));
    expect(e!.owner).toBe(tagVal(uploadedTags, TAG_CODEX_OWNER));
    expect(e!.itemId).toBe("round-trip-item");
    expect(e!.contentType).toBe("image/png");
  });

  it("(c) a rebuilt-from-chain entry is status:'final' (the index only sees mined txs)", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, graphqlRebuildBody(ownerUploadRecords));

    await rebuildLibrary(OWNER, { store, pool, fetchFn });

    expect((await store.list(OWNER)).every((e) => e.status === "final")).toBe(true);
  });

  it("(d) RE-DETECT manifest: a record whose Content-Type IS the manifest type → entry carries manifest:{isManifest:true}", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, graphqlRebuildBody(ownerUploadRecords));

    await rebuildLibrary(OWNER, { store, pool, fetchFn });

    const list = await store.list(OWNER);
    const manifestRecord = ownerUploadRecords.find(
      (r) => tagVal(r.tags, "Content-Type") === MANIFEST_CONTENT_TYPE,
    )!;
    const manifestEntry = list.find((e) => e.id === manifestRecord.id)!;
    expect(manifestEntry.manifest).toEqual({ isManifest: true });

    // A non-manifest record has NO flag.
    const plainRecord = ownerUploadRecords.find(
      (r) => tagVal(r.tags, "Content-Type") !== MANIFEST_CONTENT_TYPE,
    )!;
    const plainEntry = list.find((e) => e.id === plainRecord.id)!;
    expect(plainEntry.manifest).toBeUndefined();
  });
});

describe("E3 rebuild — field-level merge with existing locals (E-08, FIX-2)", () => {
  it("(e) a local id with manifest+createdAt merged against a rebuild record KEEPS both, SETS final, REFRESHES tags", async () => {
    const store = new MemoryLibraryStore();
    // A local, manifest-flagged, pending entry with a KNOWN createdAt + stale tags.
    const local: LibraryEntry = {
      id: CANONICAL_ID_A,
      owner: OWNER,
      itemId: "local-item",
      contentType: MANIFEST_CONTENT_TYPE,
      status: "pending",
      createdAt: 7777,
      tags: buildUploadTags({
        ownerAddress: OWNER,
        contentType: MANIFEST_CONTENT_TYPE,
        itemId: "local-item",
      }),
      manifest: { isManifest: true },
    };
    await store.append(local);

    // The rebuild returns a record for the SAME id with FRESH tags.
    const freshTags = buildUploadTags({
      ownerAddress: OWNER,
      contentType: MANIFEST_CONTENT_TYPE,
      itemId: "refreshed-item",
    });
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(
      200,
      graphqlRebuildBody([{ id: CANONICAL_ID_A, tags: freshTags }]),
    );

    await rebuildLibrary(OWNER, { store, pool, fetchFn });

    const merged = await store.get(CANONICAL_ID_A);
    expect(merged!.createdAt).toBe(7777); // local createdAt survives
    expect(merged!.manifest).toEqual({ isManifest: true }); // local manifest survives
    expect(merged!.status).toBe("final"); // chain sets finality
    expect(tagVal(merged!.tags, TAG_CODEX_ITEM_ID)).toBe("refreshed-item"); // tags refreshed
    // No duplicate.
    expect((await store.list(OWNER)).filter((e) => e.id === CANONICAL_ID_A)).toHaveLength(1);
  });

  it("(e.2) a NON-manifest local merged against an INCOMING manifest record → the merged entry GAINS the manifest flag (MERGE path re-derives like INSERT)", async () => {
    const store = new MemoryLibraryStore();
    // A local, NON-manifest, pending entry (no manifest flag, plain content-type).
    const local: LibraryEntry = {
      id: CANONICAL_ID_A,
      owner: OWNER,
      itemId: "local-item",
      contentType: "text/plain",
      status: "pending",
      createdAt: 8888,
      tags: buildUploadTags({
        ownerAddress: OWNER,
        contentType: "text/plain",
        itemId: "local-item",
      }),
    };
    await store.append(local);
    expect((await store.get(CANONICAL_ID_A))!.manifest).toBeUndefined();

    // The rebuild returns a record for the SAME id whose Content-Type IS the
    // manifest type — the merged entry must end up flagged AND manifest-typed.
    const manifestTags = buildUploadTags({
      ownerAddress: OWNER,
      contentType: MANIFEST_CONTENT_TYPE,
      itemId: "now-manifest",
    });
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(
      200,
      graphqlRebuildBody([{ id: CANONICAL_ID_A, tags: manifestTags }]),
    );

    await rebuildLibrary(OWNER, { store, pool, fetchFn });

    const merged = await store.get(CANONICAL_ID_A);
    expect(merged!.contentType).toBe(MANIFEST_CONTENT_TYPE); // incoming manifest type
    expect(merged!.manifest).toEqual({ isManifest: true }); // flag re-derived on merge
    expect(merged!.createdAt).toBe(8888); // local createdAt still survives
    expect(merged!.status).toBe("final");
  });
});

describe("E3 rebuild — idempotency + non-destructive (E-08, FIX-1d)", () => {
  it("(f) IDEMPOTENCY-OF-ORDERING: a 2nd rebuild returning the SAME ids in a PERMUTED order yields identical order + identical createdAt", async () => {
    const store = new MemoryLibraryStore();
    const pool = makeHealthPool();

    // First rebuild: records in fixture order.
    await rebuildLibrary(OWNER, {
      store,
      pool,
      fetchFn: makeFetchFn(200, graphqlRebuildBody(ownerUploadRecords)),
    });
    const first = await store.list(OWNER);
    const firstOrder = first.map((e) => e.id);
    const firstCreatedAt = first.map((e) => e.createdAt);

    // Second rebuild: SAME ids, DIFFERENT (reversed) gateway order — this is what
    // discriminates a rebuild-stable key (sentinel 0 + id tiebreak → identical)
    // from a gateway-order-index or Date.now() key (would reorder/re-timestamp).
    const permuted = [...ownerUploadRecords].reverse();
    await rebuildLibrary(OWNER, {
      store,
      pool,
      fetchFn: makeFetchFn(200, graphqlRebuildBody(permuted)),
    });
    const second = await store.list(OWNER);

    expect(second.map((e) => e.id)).toEqual(firstOrder);
    expect(second.map((e) => e.createdAt)).toEqual(firstCreatedAt);
  });

  it("(g) idempotent-no-dup: running rebuild twice yields the SAME N entries (upsert by id)", async () => {
    const store = new MemoryLibraryStore();
    const pool = makeHealthPool();
    const fetchFn = () => makeFetchFn(200, graphqlRebuildBody(ownerUploadRecords));

    await rebuildLibrary(OWNER, { store, pool, fetchFn: fetchFn() });
    await rebuildLibrary(OWNER, { store, pool, fetchFn: fetchFn() });

    expect(await store.list(OWNER)).toHaveLength(ownerUploadRecords.length);
  });

  it("(h) NON-DESTRUCTIVE: a local pending entry ABSENT from the rebuild result SURVIVES", async () => {
    const store = new MemoryLibraryStore();
    // A local pending upload the chain has not yet indexed.
    await store.append({
      id: CANONICAL_ID_B,
      owner: OWNER,
      itemId: "still-pending",
      contentType: "text/plain",
      status: "pending",
      createdAt: 5000,
      tags: buildUploadTags({
        ownerAddress: OWNER,
        contentType: "text/plain",
        itemId: "still-pending",
      }),
    });

    const pool = makeHealthPool();
    // The rebuild returns records that do NOT include CANONICAL_ID_B.
    const others = ownerUploadRecords.filter((r) => r.id !== CANONICAL_ID_B);
    await rebuildLibrary(OWNER, {
      store,
      pool,
      fetchFn: makeFetchFn(200, graphqlRebuildBody(others)),
    });

    const survivor = await store.get(CANONICAL_ID_B);
    expect(survivor).toBeDefined();
    expect(survivor!.status).toBe("pending");
    expect(survivor!.createdAt).toBe(5000);
  });

  it("(i) an owner with ZERO on-chain records → queryOwnerUploads resolves [] → the rebuild is a no-op", async () => {
    const store = new MemoryLibraryStore();
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, graphqlRebuildBody([]));

    await rebuildLibrary(OWNER, { store, pool, fetchFn });
    expect(await store.list(OWNER)).toHaveLength(0);

    // A no-op does not clobber an existing local entry either.
    await store.append({
      id: CANONICAL_ID_A,
      owner: OWNER,
      itemId: "local",
      contentType: "text/plain",
      status: "pending",
      createdAt: 42,
      tags: [],
    });
    await rebuildLibrary(OWNER, {
      store,
      pool,
      fetchFn: makeFetchFn(200, graphqlRebuildBody([])),
    });
    expect(await store.get(CANONICAL_ID_A)).toBeDefined();
  });
});
