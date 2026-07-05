/**
 * E3 RED matrix — the upload→library FLOWS (E-07).
 *
 * Composition over the adapter `upload` + the `LibraryStore` seam:
 *   - `uploadAndTrack(...)`: uploadData resolves FIRST, THEN append a pending
 *     entry (a throwing Turbo client → store EMPTY, no phantom pending — FIX-6);
 *   - `pollStatus(id, { pool, store, fetchFn, confirmationDepth? })`: flips to
 *     final ONLY on `confirmed && final===true`; delegates POOL-FIRST to
 *     arweave-core `getTransactionStatus`; forwards `undefined` depth →
 *     arweave-core's DEFAULT_CONFIRMATION_DEPTH (never a local 10 — FIX-10);
 *     shallow-confirmed / pending / not-found STAY pending (FIX-4);
 *   - `openUrl(id, { pool })`: composes against a HEALTHY endpoint (FIX-5);
 *   - manifest content-type → ONE flagged entry / ONE link (FIX-3, detect/label).
 *
 * Seam discipline: upload uses `clientFactory`; poll/open use `fetchFn`/pool.
 *
 * RED: the `../src/library` flow surface does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DEFAULT_CONFIRMATION_DEPTH,
  type GatewayPool,
} from "@ancientpantheon/arweave-core";
import * as arweaveCore from "@ancientpantheon/arweave-core";

// RED: none of these exist yet (T13.5 store + T13.6 flows GREEN).
import {
  MemoryLibraryStore,
  uploadAndTrack,
  pollStatus,
  openUrl,
  MANIFEST_CONTENT_TYPE as LIB_MANIFEST_CT,
} from "../src/library";

import {
  throwawayJwk,
  KNOWN_ADDRESS,
  CANONICAL_ID_A,
  NON_CANONICAL_ID,
  MANIFEST_CONTENT_TYPE,
  makeRecordingTurboClient,
  makeFetchFn,
  confirmedBody,
  makeHealthPool,
  makeKadenaSentinel,
} from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;

describe("E3 flow — upload-succeeds-THEN-append-pending (E-07, FIX-6)", () => {
  let store: MemoryLibraryStore;
  beforeEach(() => {
    store = new MemoryLibraryStore();
  });

  it("(a) after uploadData RESOLVES, appends a status:'pending' entry that list(owner) includes", async () => {
    const turbo = makeRecordingTurboClient({ id: CANONICAL_ID_A });

    const result = await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "payload",
        contentType: "text/plain",
        itemId: "item-1",
      },
      { store, clientFactory: turbo.factory },
    );

    expect(result.id).toBe(CANONICAL_ID_A);
    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(CANONICAL_ID_A);
    expect(list[0].status).toBe("pending");
    expect(list[0].owner).toBe(OWNER);
    // createdAt is a real local timestamp (not the sentinel 0 — locally-originated).
    expect(list[0].createdAt).toBeGreaterThan(0);
  });

  it("(b) NO-PHANTOM-PENDING: a throwing Turbo client rejects AND leaves the store EMPTY", async () => {
    const turbo = makeRecordingTurboClient({ throws: true });

    await expect(
      uploadAndTrack(
        { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i" },
        { store, clientFactory: turbo.factory },
      ),
    ).rejects.toBeTruthy();

    // Append happens ONLY after upload success — the crash path leaves no orphan.
    expect(await store.list(OWNER)).toHaveLength(0);
  });
});

describe("E3 flow — poll-to-final ONLY on confirmed&&final (E-07, FIX-4/FIX-10)", () => {
  let store: MemoryLibraryStore;
  beforeEach(async () => {
    store = new MemoryLibraryStore();
    const turbo = makeRecordingTurboClient({ id: CANONICAL_ID_A });
    await uploadAndTrack(
      { jwk: throwawayJwk, data: "p", contentType: "text/plain", itemId: "i" },
      { store, clientFactory: turbo.factory },
    );
  });

  it("(c) a 200 with confirmations >= DEFAULT_CONFIRMATION_DEPTH flips the entry to final", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH));

    await pollStatus(CANONICAL_ID_A, { pool, store, fetchFn });

    expect((await store.get(CANONICAL_ID_A))!.status).toBe("final");
  });

  it("(c.guard) delegates POOL-FIRST to getTransactionStatus (pool is arg 1, not arg 2)", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH));
    const spy = vi.spyOn(arweaveCore, "getTransactionStatus");

    await pollStatus(CANONICAL_ID_A, { pool, store, fetchFn });

    expect(spy).toHaveBeenCalledTimes(1);
    // POOL-FIRST arity: getTransactionStatus(pool, id, opts) — NOT (id, {pool}).
    const [arg1, arg2, arg3] = spy.mock.calls[0];
    expect(arg1).toBe(pool);
    expect(arg2).toBe(CANONICAL_ID_A);
    expect(arg3).toMatchObject({ fetchFn });
    spy.mockRestore();
  });

  it("(d.1) SHALLOW-CONFIRMED (1..9, confirmed&&final:false) STAYS pending", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH - 1));

    await pollStatus(CANONICAL_ID_A, { pool, store, fetchFn });

    // A mined-but-shallow tx is NOT final — no premature flip.
    expect((await store.get(CANONICAL_ID_A))!.status).toBe("pending");
  });

  it("(d.2) a 202 (pending) and a 404 (not-found) both LEAVE the entry pending, no throw", async () => {
    const pool = makeHealthPool();

    await pollStatus(CANONICAL_ID_A, { pool, store, fetchFn: makeFetchFn(202, {}) });
    expect((await store.get(CANONICAL_ID_A))!.status).toBe("pending");

    await pollStatus(CANONICAL_ID_A, { pool, store, fetchFn: makeFetchFn(404, {}) });
    expect((await store.get(CANONICAL_ID_A))!.status).toBe("pending");
  });

  it("(e) DEPTH-CONSTANT: omitting confirmationDepth forwards undefined → arweave-core's DEFAULT flips at exactly DEFAULT_CONFIRMATION_DEPTH", async () => {
    const pool = makeHealthPool();
    // Exactly at the imported default (never a hardcoded local 10).
    const fetchFn = makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH));

    await pollStatus(CANONICAL_ID_A, { pool, store, fetchFn });
    expect((await store.get(CANONICAL_ID_A))!.status).toBe("final");
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
    const turbo = makeRecordingTurboClient({ id: CANONICAL_ID_A });
    await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "manifest bytes",
        contentType: MANIFEST_CONTENT_TYPE,
        itemId: "manifest-1",
      },
      { store, clientFactory: turbo.factory },
    );

    const list = await store.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].manifest).toEqual({ isManifest: true });

    const pool = makeHealthPool([
      { endpoint: "https://healthy.example", healthy: true, active: true },
    ]);
    const url = openUrl(CANONICAL_ID_A, { pool });
    expect(url).toBe(`https://healthy.example/${CANONICAL_ID_A}`);
  });

  it("(m.2) a non-manifest content-type entry has NO manifest flag", async () => {
    const turbo = makeRecordingTurboClient({ id: CANONICAL_ID_A });
    await uploadAndTrack(
      { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "plain-1" },
      { store, clientFactory: turbo.factory },
    );

    const list = await store.list(OWNER);
    expect(list[0].manifest).toBeUndefined();
  });
});

describe("E3 flow — RUNTIME Kadena isolation (E-04/N-05)", () => {
  it("uploadAndTrack + pollStatus + openUrl NEVER invoke an InternalCodexResolver-shaped sentinel", async () => {
    const sentinel = makeKadenaSentinel();
    const spies = {
      resolvePrivateKey: vi.fn(sentinel.resolvePrivateKey),
      smartDecrypt: vi.fn(sentinel.smartDecrypt),
      requestForeignKey: vi.fn(sentinel.requestForeignKey),
    };

    const store = new MemoryLibraryStore();
    const turbo = makeRecordingTurboClient({ id: CANONICAL_ID_A });
    const pool: GatewayPool = makeHealthPool();

    await uploadAndTrack(
      { jwk: throwawayJwk, data: "p", contentType: "text/plain", itemId: "i" },
      { store, clientFactory: turbo.factory },
    );
    await pollStatus(CANONICAL_ID_A, {
      pool,
      store,
      fetchFn: makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH)),
    });
    openUrl(CANONICAL_ID_A, { pool });

    expect(spies.resolvePrivateKey).not.toHaveBeenCalled();
    expect(spies.smartDecrypt).not.toHaveBeenCalled();
    expect(spies.requestForeignKey).not.toHaveBeenCalled();
  });
});
