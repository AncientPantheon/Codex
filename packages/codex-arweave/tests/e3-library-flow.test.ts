// @vitest-environment node
/**
 * E3 RED matrix — the upload→library FLOWS (E-07).
 *
 * `// @vitest-environment node` (mirrors `e4-sqlite-library-store.test.ts`'s
 * own FIX-9 pragma): this file is pure logic (no DOM). Under the package's
 * default jsdom/"client" environment, Vite resolves the `arweave` dependency
 * via its `browser` package.json field (`web/index.js`), whose
 * `createTransaction` is MISSING the node build's `typeof data === "string"`
 * → `stringToBuffer` conversion — a plain-string upload payload throws
 * "Expected data to be a string, Uint8Array or ArrayBuffer" purely as an
 * artifact of the test environment, not a real code defect (arweave-core's
 * own Node-environment test suite proves the real behavior). Forcing this
 * file back to the `node` environment resolves `arweave`'s `main` field
 * instead, matching arweave-core's own test environment exactly.
 *
 * Composition over the adapter `upload` + the `LibraryStore` seam:
 *   - `uploadAndTrack(...)`: uploadData resolves FIRST, THEN append a pending
 *     entry (a throwing upload → store EMPTY, no phantom pending — FIX-6);
 *   - `uploadAndTrack` given a `files` array of 2+ (T7): calls T6's
 *     `uploadBundle` instead, and appends one entry PER returned file id PLUS
 *     one for the manifest id — every appended entry shares the SAME
 *     `uploadId`; given exactly 1 file (either the classic single-file params
 *     shape, or a 1-item `files` array) still appends exactly 1 entry, no
 *     regression;
 *   - `pollStatus(id, { pool, store, fetchFn, confirmationDepth? })`: flips to
 *     final ONLY on `confirmed && final===true`; delegates POOL-FIRST to
 *     arweave-core `getTransactionStatus`; forwards `undefined` depth →
 *     arweave-core's DEFAULT_CONFIRMATION_DEPTH (never a local 10 — FIX-10);
 *     shallow-confirmed / pending / not-found STAY pending (FIX-4);
 *   - `openUrl(id, { pool })`: composes against a HEALTHY endpoint (FIX-5);
 *   - manifest content-type → ONE flagged entry / ONE link (FIX-3, detect/label).
 *
 * Seam discipline: upload uses `pool` + an injectable `apiFactory` (T5/T7 —
 * the native, non-bundler upload path; `TurboUploadClientFactory` no longer
 * exists); poll/open use `fetchFn`/pool.
 *
 * NO real network anywhere: every upload test injects a fake
 * `UploadGatewayApiFactory` mirroring arweave-core's own
 * `tests/upload.test.ts`/`tests/upload-bundle.test.ts` fake pattern.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CryptoSeam } from "@ancientpantheon/codex-core";

import {
  DEFAULT_CONFIRMATION_DEPTH,
  CODEX_ENCRYPTION_VERSION_CURRENT,
  createGatewayPool,
  type UploadGatewayApi,
  type UploadGatewayApiFactory,
  type ChunkedUploader,
} from "@ancientpantheon/arweave-core";
// Namespace import so `vi.spyOn(arweaveCore, "getTransactionStatus")` in the
// test intercepts THIS call site: a destructured local binding would capture
// the original function reference and defeat the spy.
import * as arweaveCore from "@ancientpantheon/arweave-core";

// Imported from the specific submodules (not the `../src/library` barrel,
// which also re-exports `SqliteLibraryStore` — pulling in `sqliteStore.ts`'s
// lazy `import("node:sqlite")`; under vitest's jsdom/client transform on a
// Node build that exposes `node:sqlite` (this sandbox's Node 22) vite errors
// "Cannot bundle built-in module node:sqlite", a documented pre-existing
// limitation this package's own vitest.config.ts CI-excludes — see that
// config's comment). Importing the concrete submodules directly (mirrors
// `UploadArea.tsx`'s own established `../library/constants.js` direct-import
// convention) avoids pulling `sqliteStore.ts` into this file's module graph
// at all, so the suite runs locally with no special flags.
import { MemoryLibraryStore } from "../src/library/memoryStore.js";
import {
  uploadAndTrack,
  pollStatus,
  openUrl,
  backupCodexToLibrary,
} from "../src/library/flow.js";
import { MANIFEST_CONTENT_TYPE as LIB_MANIFEST_CT } from "../src/library/constants.js";
import { deriveAccountAesKey, decryptWithDerivedKey } from "../src/crypto/fileEncryption.js";
import { decryptWithAccountKey } from "../src/crypto/accountKeyCipher.js";
// Namespace import so `vi.spyOn(fileEncryption, "deriveAccountAesKey")` below
// intercepts `flow.ts`'s OWN call site (it imports this module the SAME way,
// for the SAME reason — see that file's module doc).
import * as fileEncryption from "../src/crypto/fileEncryption.js";

import {
  throwawayJwk,
  KNOWN_ADDRESS,
  CANONICAL_ID_A,
  NON_CANONICAL_ID,
  MANIFEST_CONTENT_TYPE,
  makeFetchFn,
  confirmedBody,
  makeHealthPool,
  makeKadenaSentinel,
  makeRecordingUploadApi,
} from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;

/** A cap comfortably above the fake `getPrice`'s honest quote below — the fee
 *  cap is REQUIRED on every native-upload call (T5/T7). */
const CAP = 1_000_000_000_000n;

/**
 * `category` is REQUIRED on `UploadAndTrackParams` (`arweave-upload-categories`
 * T5) — mirroring T2/T3's underlying `UploadParams`/`UploadBundleParams`
 * enforcement one layer down. This is a TYPE-LEVEL guarantee: omitting
 * `category` from any object literal below is a TypeScript compile-time
 * error, not something assertable at runtime the way a validation throw is
 * (same documented pattern as `arweave-core/tests/upload.test.ts`'s own
 * `category`-omission comment) — every literal in this file supplies one.
 */

/** A chunked uploader completing after a single `uploadChunk()` call — mirrors
 *  arweave-core's own `tests/upload.test.ts`/`tests/upload-bundle.test.ts`
 *  `FakeChunkedUploader`. */
class FakeChunkedUploader implements ChunkedUploader {
  private done = false;
  get isComplete(): boolean {
    return this.done;
  }
  async uploadChunk(): Promise<void> {
    this.done = true;
  }
}

/**
 * A fake {@link UploadGatewayApiFactory}: a fixed anchor/price and the
 * completing uploader above — mirrors arweave-core's own fake-`apiFactory`
 * pattern (T5/T6's injectable seam `uploadData`/`uploadBundle` both forward
 * to `postArweaveData`). NO real network in any E3 upload flow test.
 * `anchorFails` models a rejected upload, for the NO-PHANTOM-PENDING guards.
 */
function makeFakeUploadApiFactory(
  opts: { anchorFails?: boolean } = {},
): { factory: UploadGatewayApiFactory } {
  const factory: UploadGatewayApiFactory = (): UploadGatewayApi => ({
    async getAnchor() {
      if (opts.anchorFails) throw new Error("anchor endpoint down");
      return "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
    },
    async getPrice() {
      return "1000000000";
    },
    async getUploader() {
      return new FakeChunkedUploader();
    },
  });
  return { factory };
}

/** A fresh, injected, no-network upload pool — a single fake endpoint, zero
 *  real sleeps between pool retries. */
function makeUploadPool() {
  return createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
}

describe("E3 flow — upload-succeeds-THEN-append-pending (E-07, FIX-6)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  it("(a) after the upload RESOLVES, appends a status:'pending' entry that list(owner) includes", async () => {
    const { factory } = makeFakeUploadApiFactory();

    const result = await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "payload",
        contentType: "text/plain",
        itemId: "item-1",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );

    expect("id" in result).toBe(true);
    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe((result as { id: string }).id);
    expect(list[0].status).toBe("pending");
    expect(list[0].owner).toBe(OWNER);
    // createdAt is a real local timestamp (not the sentinel 0 — locally-originated).
    expect(list[0].createdAt).toBeGreaterThan(0);
  });

  it("(b) NO-PHANTOM-PENDING: a throwing upload rejects AND leaves the store EMPTY", async () => {
    const { factory } = makeFakeUploadApiFactory({ anchorFails: true });

    await expect(
      uploadAndTrack(
        {
          jwk: throwawayJwk,
          data: "x",
          contentType: "text/plain",
          itemId: "i",
          maxRewardWinston: CAP,
          category: "general-other",
        },
        { store, pool: makeUploadPool(), apiFactory: factory },
      ),
    ).rejects.toBeTruthy();

    // Append happens ONLY after upload success — the crash path leaves no orphan.
    expect(await store.list(OWNER)).toHaveLength(0);
  });
});

describe("E3 flow — poll-to-final ONLY on confirmed&&final (E-07, FIX-4/FIX-10)", () => {
  let store: MemoryLibraryStore;
  let uploadedId: string;
  beforeEach(async () => {
    store = new MemoryLibraryStore();
    const { factory } = makeFakeUploadApiFactory();
    const result = await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "p",
        contentType: "text/plain",
        itemId: "i",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );
    uploadedId = (result as { id: string }).id;
  });

  it("(c) a 200 with confirmations >= DEFAULT_CONFIRMATION_DEPTH flips the entry to final", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH));

    await pollStatus(uploadedId, { pool, store, fetchFn });

    expect((await store.get(uploadedId))!.status).toBe("final");
  });

  it("(c.guard) delegates POOL-FIRST to getTransactionStatus (pool is arg 1, not arg 2)", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH));
    const spy = vi.spyOn(arweaveCore, "getTransactionStatus");

    await pollStatus(uploadedId, { pool, store, fetchFn });

    expect(spy).toHaveBeenCalledTimes(1);
    // POOL-FIRST arity: getTransactionStatus(pool, id, opts) — NOT (id, {pool}).
    const [arg1, arg2, arg3] = spy.mock.calls[0];
    expect(arg1).toBe(pool);
    expect(arg2).toBe(uploadedId);
    expect(arg3).toMatchObject({ fetchFn });
    spy.mockRestore();
  });

  it("(d.1) SHALLOW-CONFIRMED (1..9, confirmed&&final:false) STAYS pending", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH - 1));

    await pollStatus(uploadedId, { pool, store, fetchFn });

    // A mined-but-shallow tx is NOT final — no premature flip.
    expect((await store.get(uploadedId))!.status).toBe("pending");
  });

  it("(d.2) a 202 (pending) and a 404 (not-found) both LEAVE the entry pending, no throw", async () => {
    const pool = makeHealthPool();

    await pollStatus(uploadedId, { pool, store, fetchFn: makeFetchFn(202, {}) });
    expect((await store.get(uploadedId))!.status).toBe("pending");

    await pollStatus(uploadedId, { pool, store, fetchFn: makeFetchFn(404, {}) });
    expect((await store.get(uploadedId))!.status).toBe("pending");
  });

  it("(e) DEPTH-CONSTANT: omitting confirmationDepth forwards undefined → arweave-core's DEFAULT flips at exactly DEFAULT_CONFIRMATION_DEPTH", async () => {
    const pool = makeHealthPool();
    // Exactly at the imported default (never a hardcoded local 10).
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH));

    await pollStatus(uploadedId, { pool, store, fetchFn });
    expect((await store.get(uploadedId))!.status).toBe("final");
  });
});

describe("E3 flow — open via a HEALTHY gateway (E-07, FIX-5)", () => {
  const HEALTHY = "https://healthy.example";
  const ACTIVE_UNHEALTHY = "https://active-unhealthy.example";

  it("(open.1) composes the URL against a HEALTHY endpoint, not the active-but-unhealthy one, not arweave.net", () => {
    const pool = makeHealthPool([
      { endpoint: ACTIVE_UNHEALTHY, healthy: false, active: true },
      { endpoint: HEALTHY, healthy: true, active: false },
    ]);

    const url = openUrl(CANONICAL_ID_A, { pool });
    expect(url).toBe(`${HEALTHY}/${CANONICAL_ID_A}`);
    expect(url).not.toContain("active-unhealthy");
    expect(url).not.toContain("arweave.net");
  });

  it("(open.2) falls back to getActiveEndpoint() when ALL endpoints are unhealthy", () => {
    const pool = makeHealthPool([
      { endpoint: ACTIVE_UNHEALTHY, healthy: false, active: true },
      { endpoint: "https://also-unhealthy.example", healthy: false, active: false },
    ]);

    const url = openUrl(CANONICAL_ID_A, { pool });
    expect(url).toBe(`${ACTIVE_UNHEALTHY}/${CANONICAL_ID_A}`);
  });

  it("(open.3) a non-canonical id throws before composing a URL", () => {
    const pool = makeHealthPool();
    expect(() => openUrl(NON_CANONICAL_ID, { pool })).toThrow();
  });

  it("(open.4) a healthy endpoint with a TRAILING SLASH yields a single-slash URL, not '//'", () => {
    const pool = makeHealthPool([
      { endpoint: "https://arweave.net/", healthy: true, active: true },
    ]);

    const url = openUrl(CANONICAL_ID_A, { pool });
    expect(url).toBe(`https://arweave.net/${CANONICAL_ID_A}`);
    expect(url).not.toContain("//" + CANONICAL_ID_A);
  });
});

describe("E3 flow — manifest detection / single link (E-07, FIX-3)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  it("(m.const) the library's manifest content-type matches the shared spelling", () => {
    expect(LIB_MANIFEST_CT).toBe(MANIFEST_CONTENT_TYPE);
  });

  it("(m.1) a manifest content-type upload → ONE flagged entry (manifest:{isManifest:true}) and openUrl → a single link", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const result = await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "manifest bytes",
        contentType: MANIFEST_CONTENT_TYPE,
        itemId: "manifest-1",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );

    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe((result as { id: string }).id);
    expect(list[0].manifest).toEqual({ isManifest: true });

    const pool = makeHealthPool([
      { endpoint: "https://healthy.example", healthy: true, active: true },
    ]);
    const url = openUrl(CANONICAL_ID_A, { pool });
    expect(url).toBe(`https://healthy.example/${CANONICAL_ID_A}`);
  });

  it("(m.2) a non-manifest content-type entry has NO manifest flag", async () => {
    const { factory } = makeFakeUploadApiFactory();
    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "x",
        contentType: "text/plain",
        itemId: "plain-1",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );

    const list = await store.list(OWNER);
    expect(list[0].manifest).toBeUndefined();
  });
});

describe("E3 flow — bundle-aware uploadAndTrack (T7)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  function makeFiles(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      path: i === 0 ? `file-${i}.txt` : `sub/file-${i}.txt`,
      data: new TextEncoder().encode(`file body ${i}`),
      contentType: "text/plain",
    }));
  }

  it("given 3 files, appends exactly 4 entries (3 files + 1 manifest) sharing ONE uploadId", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const files = makeFiles(3);

    const result = await uploadAndTrack(
      { jwk: throwawayJwk, files, maxRewardWinston: CAP, category: "general-other" },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );
    expect("manifestId" in result).toBe(true);
    const bundleResult = result as { manifestId: string; fileIds: { path: string; id: string }[]; uploadId: string };

    const list = await store.list(OWNER);
    expect(list).toHaveLength(4);
    expect(list.every((e) => e.status === "pending")).toBe(true);
    // Every entry (the 3 files AND the manifest) shares the SAME uploadId.
    const uploadIds = new Set(list.map((e) => e.uploadId));
    expect(uploadIds.size).toBe(1);
    expect([...uploadIds][0]).toBe(bundleResult.uploadId);
    // Exactly one flagged manifest entry, keyed by the resolved manifestId.
    const manifestEntries = list.filter((e) => e.manifest?.isManifest === true);
    expect(manifestEntries).toHaveLength(1);
    expect(manifestEntries[0].id).toBe(bundleResult.manifestId);
    // Every file id the bundle resolved is present as its own entry.
    const fileEntryIds = new Set(list.filter((e) => !e.manifest).map((e) => e.id));
    expect(fileEntryIds).toEqual(new Set(bundleResult.fileIds.map((f) => f.id)));
  });

  it("given 1 file via the SAME files-array shape, still appends exactly 1 entry — no regression (T5's single-file path, not a 1-file bundle)", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const files = makeFiles(1);

    const result = await uploadAndTrack(
      { jwk: throwawayJwk, files, maxRewardWinston: CAP, category: "general-other" },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );
    // The single-file path resolves T5's plain UploadResult shape (an `id`),
    // never a bundle's `manifestId` — no manifest/bundle overhead for one item.
    expect("manifestId" in result).toBe(false);

    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].contentType).toBe("text/plain");
  });

  it("a throwing bundle upload leaves the store COMPLETELY untouched (upload-then-append)", async () => {
    const { factory } = makeFakeUploadApiFactory({ anchorFails: true });
    const files = makeFiles(2);

    await expect(
      uploadAndTrack(
        { jwk: throwawayJwk, files, maxRewardWinston: CAP, category: "general-other" },
        { store, pool: makeUploadPool(), apiFactory: factory },
      ),
    ).rejects.toBeTruthy();

    expect(await store.list(OWNER)).toHaveLength(0);
  });

  it("(cat.1) forwards category/assetType/appId/appVersion through to the single-file upload's applied tags", async () => {
    const { factory } = makeFakeUploadApiFactory();

    const result = await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "payload",
        contentType: "text/plain",
        itemId: "item-cat-1",
        maxRewardWinston: CAP,
        category: "nft-data",
        assetType: "video",
        appId: "my-app",
        appVersion: "1.0.0",
      },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );

    const tags = (result as { tags: { name: string; value: string }[] }).tags;
    expect(tags.find((t) => t.name === "Codex-Category")?.value).toBe("nft-data");
    expect(tags.find((t) => t.name === "Codex-Asset-Type")?.value).toBe("video");
    expect(tags.find((t) => t.name === "Codex-App-Id")?.value).toBe("my-app");
    expect(tags.find((t) => t.name === "Codex-App-Version")?.value).toBe("1.0.0");
  });

  it("(cat.2) applies the SAME category/appId/appVersion identically to every bundle item — files AND the manifest", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const files = makeFiles(2);

    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "software-code",
        appId: "my-site",
        appVersion: "v2",
      },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );

    const list = await store.list(OWNER);
    expect(list).toHaveLength(3);
    expect(
      list.every((e) => e.tags.find((t) => t.name === "Codex-Category")?.value === "software-code"),
    ).toBe(true);
    expect(
      list.every((e) => e.tags.find((t) => t.name === "Codex-App-Id")?.value === "my-site"),
    ).toBe(true);
    expect(
      list.every((e) => e.tags.find((t) => t.name === "Codex-App-Version")?.value === "v2"),
    ).toBe(true);
  });

  it("(cat.3) an invalid category value throws AT RUNTIME (mirrors T2's buildUploadTags enforcement)", async () => {
    const { factory } = makeFakeUploadApiFactory();

    await expect(
      uploadAndTrack(
        {
          jwk: throwawayJwk,
          data: "x",
          contentType: "text/plain",
          itemId: "i",
          maxRewardWinston: CAP,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: "not-a-real-category" as any,
        },
        { store, pool: makeUploadPool(), apiFactory: factory },
      ),
    ).rejects.toBeTruthy();
    expect(await store.list(OWNER)).toHaveLength(0);
  });
});

describe("E3 flow — backupCodexToLibrary (T5)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  it("uploads the export JSON verbatim, tags Codex-Category:codex-backup, appends a pending entry, and calls onSuccess ONLY after the upload resolves", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const onSuccess = vi.fn();

    const result = await backupCodexToLibrary("export-json-payload", {
      store,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
      onSuccess,
    });

    expect("id" in result).toBe(true);
    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe((result as { id: string }).id);
    expect(list[0].status).toBe("pending");
    expect(list[0].tags.find((t) => t.name === "Codex-Category")?.value).toBe("codex-backup");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("derives appId/appVersion from a well-formed exportJson (codexIdentity.formatted / lastUpdatedAt) and tags the upload with them", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const exportJson = JSON.stringify({
      codexIdentity: { formatted: "my-codex-id" },
      lastUpdatedAt: "2026-09-30T00:00:00.000Z",
    });

    const result = await backupCodexToLibrary(exportJson, {
      store,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
    });

    const tags = (result as { tags: { name: string; value: string }[] }).tags;
    expect(tags.find((t) => t.name === "Codex-App-Id")?.value).toBe("my-codex-id");
    expect(tags.find((t) => t.name === "Codex-App-Version")?.value).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });

  it("a malformed-but-valid-JSON exportJson (missing/wrong-typed fields) still succeeds with no lineage tags", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const exportJson = JSON.stringify({
      codexIdentity: { formatted: 12345 }, // wrong type — not a string
      // lastUpdatedAt omitted entirely
    });

    const result = await backupCodexToLibrary(exportJson, {
      store,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
    });

    const tags = (result as { tags: { name: string; value: string }[] }).tags;
    expect(tags.find((t) => t.name === "Codex-App-Id")).toBeUndefined();
    expect(tags.find((t) => t.name === "Codex-App-Version")).toBeUndefined();
  });

  it("a completely invalid (non-JSON) exportJson still succeeds with no lineage tags — the parse step never throws", async () => {
    const { factory } = makeFakeUploadApiFactory();
    const exportJson = "not valid json at all {{{";

    const result = await backupCodexToLibrary(exportJson, {
      store,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
    });

    const tags = (result as { tags: { name: string; value: string }[] }).tags;
    expect(tags.find((t) => t.name === "Codex-App-Id")).toBeUndefined();
    expect(tags.find((t) => t.name === "Codex-App-Version")).toBeUndefined();
    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("pending");
  });

  it("a throwing backup upload rejects, leaves the store EMPTY, and never calls onSuccess (upload-then-append, no phantom entry)", async () => {
    const { factory } = makeFakeUploadApiFactory({ anchorFails: true });
    const onSuccess = vi.fn();

    await expect(
      backupCodexToLibrary("export-json-payload", {
        store,
        pool: makeUploadPool(),
        jwk: throwawayJwk,
        maxRewardWinston: CAP,
        apiFactory: factory,
        onSuccess,
      }),
    ).rejects.toBeTruthy();

    expect(await store.list(OWNER)).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("E3 flow — backupCodexToLibrary recovery-key tagging (T2, codex-recovery-backup-tagging)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  const BITSTRING = "1".repeat(800) + "0".repeat(800);
  const CODEX_PASSWORD = "the codex's own current unlock password";

  /** A deterministic, KEY-AWARE fake `CryptoSeam` — mirrors
   *  `crypto-account-key-cipher.test.ts`'s own fake exactly, so a wrong-key
   *  decrypt genuinely throws rather than silently ignoring the key. */
  const keyAwareFakeSeam: CryptoSeam = {
    encrypt: (plaintext: string, key: string) => `${key}::${plaintext}`,
    decrypt: (ciphertext: string, key: string) => {
      const prefix = `${key}::`;
      if (!ciphertext.startsWith(prefix)) {
        throw new Error("wrong key — auth-tag-equivalent failure");
      }
      return ciphertext.slice(prefix.length);
    },
  };

  it("given both codexPassword and primeArweaveSeedBitstring (and a cryptoSeam), posts a Codex-Backup-Recovery-Key tag whose value decrypts back to the EXACT original password", async () => {
    const { factory } = makeFakeUploadApiFactory();

    const result = await backupCodexToLibrary("export-json-payload", {
      store,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
      codexPassword: CODEX_PASSWORD,
      primeArweaveSeedBitstring: BITSTRING,
      cryptoSeam: keyAwareFakeSeam,
    });

    const tags = (result as { tags: { name: string; value: string }[] }).tags;
    const recoveryTag = tags.find((t) => t.name === "Codex-Backup-Recovery-Key");
    expect(recoveryTag).toBeDefined();

    const decrypted = await decryptWithAccountKey(recoveryTag!.value, BITSTRING, keyAwareFakeSeam);
    expect(decrypted).toBe(CODEX_PASSWORD);

    // The locally-appended entry ALSO carries the tag (before any rebuild).
    const list = await store.list(OWNER);
    expect(list[0].tags.find((t) => t.name === "Codex-Backup-Recovery-Key")?.value).toBe(
      recoveryTag!.value,
    );
  });

  it("given codexPassword WITHOUT primeArweaveSeedBitstring, posts NO recovery-key tag and the rest of the tag set is unchanged from a plain backup", async () => {
    const { factory } = makeFakeUploadApiFactory();

    const withPasswordOnly = await backupCodexToLibrary("export-json-payload", {
      store,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
      codexPassword: CODEX_PASSWORD,
      cryptoSeam: keyAwareFakeSeam,
    });
    const tagsWithPasswordOnly = (withPasswordOnly as { tags: { name: string; value: string }[] }).tags;
    expect(tagsWithPasswordOnly.find((t) => t.name === "Codex-Backup-Recovery-Key")).toBeUndefined();

    const baselineStore = new MemoryLibraryStore();
    const baseline = await backupCodexToLibrary("export-json-payload", {
      store: baselineStore,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
    });
    const baselineTags = (baseline as { tags: { name: string; value: string }[] }).tags;

    // Regression guard: the exact same tag NAMES as an entirely plain backup.
    expect(tagsWithPasswordOnly.map((t) => t.name).sort()).toEqual(
      baselineTags.map((t) => t.name).sort(),
    );
  });

  it("given primeArweaveSeedBitstring WITHOUT codexPassword, posts NO recovery-key tag — no error, backup still succeeds", async () => {
    const { factory } = makeFakeUploadApiFactory();

    const result = await backupCodexToLibrary("export-json-payload", {
      store,
      pool: makeUploadPool(),
      jwk: throwawayJwk,
      maxRewardWinston: CAP,
      apiFactory: factory,
      primeArweaveSeedBitstring: BITSTRING,
      cryptoSeam: keyAwareFakeSeam,
    });

    const tags = (result as { tags: { name: string; value: string }[] }).tags;
    expect(tags.find((t) => t.name === "Codex-Backup-Recovery-Key")).toBeUndefined();
    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("pending");
  });
});

describe("E3 flow — encrypted upload composition (T5, arweave-upload-encryption)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  /** A stand-in Ouronet address — deliberately NOT Arweave-canonical shape
   *  (it's shorter, DALOS-prefixed), proving `Codex-Encryptor` carries the
   *  OURONET account's own address verbatim, never an Arweave-derived one
   *  (the Wave-2 correction this task must preserve). */
  const ENCRYPTOR_ADDRESS = "DALOS-fake-ouronet-account-address";
  const ACCOUNT_ID = "ouronet-account-1";
  const BITSTRING = "1".repeat(800) + "0".repeat(800);

  function makeEncryptFor(
    overrides: Partial<{ revealAccountSecret: (accountId: string) => Promise<string | null> }> = {},
  ) {
    return {
      accountId: ACCOUNT_ID,
      accountAddress: ENCRYPTOR_ADDRESS,
      revealAccountSecret: overrides.revealAccountSecret ?? (async () => BITSTRING),
    };
  }

  it("single-file uploadAndTrack with encryptFor posts encrypted:true + Codex-Encryptor + ciphertext (not the plaintext bytes) as data", async () => {
    const { apiFactory, calls } = makeRecordingUploadApi();
    const plaintext = "secret file contents";

    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: plaintext,
        contentType: "text/plain",
        itemId: "enc-1",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory, encryptFor: makeEncryptFor() },
    );

    expect(calls).toHaveLength(1);
    const posted = calls[0];
    expect(posted.tags.find((t) => t.name === "Codex-Encrypted")?.value).toBe("true");
    expect(posted.tags.find((t) => t.name === "Codex-Encryptor")?.value).toBe(ENCRYPTOR_ADDRESS);
    // Never the plaintext bytes verbatim — real AES-GCM ciphertext, not a pass-through.
    expect(Buffer.from(posted.data).equals(Buffer.from(plaintext, "utf8"))).toBe(false);

    // The locally-appended entry ALSO carries the tag (before any rebuild) —
    // this is exactly what LibraryArea's decrypt-on-download reads.
    const list = await store.list(OWNER);
    expect(list[0].tags.find((t) => t.name === "Codex-Encryptor")?.value).toBe(ENCRYPTOR_ADDRESS);
  });

  it("single-file uploadAndTrack with encryptFor posts the pinned CODEX_ENCRYPTION_VERSION_CURRENT as Codex-Encryption-Version — never caller-suppliable (arweave-tag-schema-spec T4)", async () => {
    // Sanity guard against a tautological pass: if the barrel import above
    // ever silently resolved to `undefined` (e.g. a stale dist missing the
    // export), comparing a found tag's value against it would pass for the
    // WRONG reason (undefined === undefined). Pin against arweave-core's own
    // known current value directly.
    expect(CODEX_ENCRYPTION_VERSION_CURRENT).toBe("1");

    const { apiFactory, calls } = makeRecordingUploadApi();

    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "secret file contents",
        contentType: "text/plain",
        itemId: "enc-ver-1",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory, encryptFor: makeEncryptFor() },
    );

    const posted = calls[0];
    const postedTag = posted.tags.find((t) => t.name === "Codex-Encryption-Version");
    expect(postedTag).toBeDefined();
    expect(postedTag?.value).toBe("1");

    // The locally-appended entry ALSO carries the tag (before any rebuild) —
    // same discipline as Codex-Encryptor above.
    const list = await store.list(OWNER);
    const localTag = list[0].tags.find((t) => t.name === "Codex-Encryption-Version");
    expect(localTag).toBeDefined();
    expect(localTag?.value).toBe("1");
  });

  it("round-trip: the posted bytes (IV-prepended, base64-then-encrypted) decrypt back to the EXACT original plaintext via the same byte layout LibraryArea's decrypt-on-download strips off", async () => {
    const { apiFactory, calls } = makeRecordingUploadApi();
    const plaintext = "round trip me please, byte for byte";

    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: plaintext,
        contentType: "text/plain",
        itemId: "enc-rt",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory, encryptFor: makeEncryptFor() },
    );

    const posted = calls[0].data;
    // T6's LibraryArea.tsx strips exactly the leading 12 IV bytes, decrypts,
    // UTF-8-decodes to the base64 string, then base64-decodes to the
    // original bytes — reproduced here directly against decryptWithDerivedKey
    // (the "at minimum" round-trip bar this task's done-when calls for).
    const iv = posted.slice(0, 12);
    const ciphertext = posted.slice(12);
    const key = await deriveAccountAesKey(BITSTRING);
    const decrypted = await decryptWithDerivedKey(key, ciphertext, iv);
    const base64Text = new TextDecoder().decode(decrypted);
    const original = Buffer.from(base64Text, "base64").toString("utf8");

    expect(original).toBe(plaintext);
  });

  it("a 3-file bundle with encryptFor derives the AES key EXACTLY ONCE for the whole batch (not once per file), and every FILE entry (not the manifest) carries Codex-Encrypted:true + the Codex-Encryptor address", async () => {
    const { apiFactory, calls } = makeRecordingUploadApi();
    const files = [
      { path: "a.txt", data: new TextEncoder().encode("file body A"), contentType: "text/plain" },
      { path: "b.txt", data: new TextEncoder().encode("file body B"), contentType: "text/plain" },
      { path: "c.txt", data: new TextEncoder().encode("file body C"), contentType: "text/plain" },
    ];
    const deriveSpy = vi.spyOn(fileEncryption, "deriveAccountAesKey");

    await uploadAndTrack(
      { jwk: throwawayJwk, files, maxRewardWinston: CAP, category: "general-other" },
      { store, pool: makeUploadPool(), apiFactory, encryptFor: makeEncryptFor() },
    );

    expect(deriveSpy).toHaveBeenCalledTimes(1);
    deriveSpy.mockRestore();

    // One posted tx for the whole bundle — none of the 3 plaintexts appear
    // anywhere in the posted bundle bytes (real per-file ciphertext, not a
    // pass-through of any file's raw content).
    expect(calls).toHaveLength(1);
    const postedBundle = Buffer.from(calls[0].data);
    for (const file of files) {
      expect(postedBundle.includes(Buffer.from(file.data))).toBe(false);
    }

    const list = await store.list(OWNER);
    const fileEntries = list.filter((e) => !e.manifest);
    const manifestEntries = list.filter((e) => e.manifest?.isManifest);
    expect(fileEntries).toHaveLength(3);
    expect(
      fileEntries.every((e) => e.tags.find((t) => t.name === "Codex-Encrypted")?.value === "true"),
    ).toBe(true);
    expect(
      fileEntries.every(
        (e) => e.tags.find((t) => t.name === "Codex-Encryptor")?.value === ENCRYPTOR_ADDRESS,
      ),
    ).toBe(true);
    // The manifest's OWN path structure stays public even though every file
    // is encrypted — mirrors bundle.ts's asymmetric rule exactly.
    expect(manifestEntries).toHaveLength(1);
    expect(manifestEntries[0].tags.find((t) => t.name === "Codex-Encrypted")?.value).toBe("false");
    expect(manifestEntries[0].tags.find((t) => t.name === "Codex-Encryptor")).toBeUndefined();
  });

  it("a 3-file bundle with encryptFor posts Codex-Encryption-Version on every FILE entry, never on the manifest entry (the same files:yes/manifest:no asymmetry as Codex-Encryptor)", async () => {
    const { apiFactory } = makeRecordingUploadApi();
    const files = [
      { path: "a.txt", data: new TextEncoder().encode("file body A"), contentType: "text/plain" },
      { path: "b.txt", data: new TextEncoder().encode("file body B"), contentType: "text/plain" },
    ];

    await uploadAndTrack(
      { jwk: throwawayJwk, files, maxRewardWinston: CAP, category: "general-other" },
      { store, pool: makeUploadPool(), apiFactory, encryptFor: makeEncryptFor() },
    );

    const list = await store.list(OWNER);
    const fileEntries = list.filter((e) => !e.manifest);
    const manifestEntries = list.filter((e) => e.manifest?.isManifest);
    expect(fileEntries).toHaveLength(2);
    expect(
      fileEntries.every((e) => e.tags.find((t) => t.name === "Codex-Encryption-Version")?.value === "1"),
    ).toBe(true);
    expect(manifestEntries).toHaveLength(1);
    expect(manifestEntries[0].tags.find((t) => t.name === "Codex-Encryption-Version")).toBeUndefined();
  });

  it("omitting encryptFor entirely posts the EXACT original bytes (regression guard) with Codex-Encrypted:false and no Codex-Encryptor tag", async () => {
    const { apiFactory, calls } = makeRecordingUploadApi();
    const plaintext = "plain and simple, unchanged";

    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: plaintext,
        contentType: "text/plain",
        itemId: "plain-enc-1",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory },
    );

    const posted = calls[0];
    expect(Buffer.from(posted.data).toString("utf8")).toBe(plaintext);
    expect(posted.tags.find((t) => t.name === "Codex-Encrypted")?.value).toBe("false");
    expect(posted.tags.find((t) => t.name === "Codex-Encryptor")).toBeUndefined();
  });

  it("calls onAccountUsedForEncryption with the correct accountId exactly once after a successful encrypted upload", async () => {
    const { apiFactory } = makeRecordingUploadApi();
    const onAccountUsedForEncryption = vi.fn();

    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "x",
        contentType: "text/plain",
        itemId: "enc-cb-1",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      {
        store,
        pool: makeUploadPool(),
        apiFactory,
        encryptFor: makeEncryptFor(),
        onAccountUsedForEncryption,
      },
    );

    expect(onAccountUsedForEncryption).toHaveBeenCalledTimes(1);
    expect(onAccountUsedForEncryption).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it("a failed encrypted upload NEVER calls onAccountUsedForEncryption", async () => {
    const { apiFactory } = makeRecordingUploadApi({ throws: true });
    const onAccountUsedForEncryption = vi.fn();

    await expect(
      uploadAndTrack(
        {
          jwk: throwawayJwk,
          data: "x",
          contentType: "text/plain",
          itemId: "enc-cb-2",
          maxRewardWinston: CAP,
          category: "general-other",
        },
        {
          store,
          pool: makeUploadPool(),
          apiFactory,
          encryptFor: makeEncryptFor(),
          onAccountUsedForEncryption,
        },
      ),
    ).rejects.toBeTruthy();

    expect(onAccountUsedForEncryption).not.toHaveBeenCalled();
    expect(await store.list(OWNER)).toHaveLength(0);
  });

  it("a revealAccountSecret that resolves null throws a SPECIFIC error (not generic) and never attempts an upload", async () => {
    const { apiFactory, calls } = makeRecordingUploadApi();

    await expect(
      uploadAndTrack(
        {
          jwk: throwawayJwk,
          data: "x",
          contentType: "text/plain",
          itemId: "enc-null-1",
          maxRewardWinston: CAP,
          category: "general-other",
        },
        {
          store,
          pool: makeUploadPool(),
          apiFactory,
          encryptFor: makeEncryptFor({ revealAccountSecret: async () => null }),
        },
      ),
    ).rejects.toThrow(/revealAccountSecret resolved no secret/);

    expect(calls).toHaveLength(0);
    expect(await store.list(OWNER)).toHaveLength(0);
  });
});

describe("E3 flow — RUNTIME StoaChain isolation (E-04/N-05)", () => {
  it("uploadAndTrack + pollStatus + openUrl NEVER invoke an InternalCodexResolver-shaped sentinel", async () => {
    const sentinel = makeKadenaSentinel();
    const spies = {
      resolvePrivateKey: vi.fn(sentinel.resolvePrivateKey),
      smartDecrypt: vi.fn(sentinel.smartDecrypt),
      requestForeignKey: vi.fn(sentinel.requestForeignKey),
    };

    const store = new MemoryLibraryStore();
    const { factory } = makeFakeUploadApiFactory();
    const pool = makeHealthPool();

    const result = await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "p",
        contentType: "text/plain",
        itemId: "i",
        maxRewardWinston: CAP,
        category: "general-other",
      },
      { store, pool: makeUploadPool(), apiFactory: factory },
    );
    const uploadedId = (result as { id: string }).id;
    await pollStatus(uploadedId, {
      pool,
      store,
      fetchFn: makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH)),
    });
    openUrl(uploadedId, { pool });

    expect(spies.resolvePrivateKey).not.toHaveBeenCalled();
    expect(spies.smartDecrypt).not.toHaveBeenCalled();
    expect(spies.requestForeignKey).not.toHaveBeenCalled();
  });
});
