/**
 * rebuild-query.test.ts — GraphQL rebuild query through the gateway pool.
 *
 * `queryOwnerUploads(pool, ownerAddress, opts?)` POSTs `{endpoint}/graphql` through
 * the Phase 2 pool, filtering by `owners: [ownerAddress]` AND the tag pair
 * (`App-Name`, `Codex-Owner`), paginating until `hasNextPage` is false, and
 * returns `{ id, tags }[]` — the rebuild source of truth. An owner with zero
 * matching on-chain tags resolves `[]` (SUCCESS, never an error, never rotation).
 *
 * Tests use a REAL Phase 2 pool (multi-endpoint, injected instant sleep) plus an
 * injected fake fetch returning standard Response objects. No network, no module
 * mocking. Cursor-endpoint binding, progress-consistency, and the owners-filter
 * security extension are all proven end-to-end.
 */

import { describe, it, expect, vi } from "vitest";
import { createGatewayPool } from "../src/gateway/pool.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";
import { queryOwnerUploads, queryUploadById, queryUploadsByTag } from "../src/rebuild/query.js";
import { DEFAULT_REBUILD_PAGE_SIZE } from "../src/rebuild/types.js";
import {
  RebuildPageLimitError,
  InvalidRebuildParamsError,
} from "../src/rebuild/errors.js";
import {
  InvalidAddressError,
  InvalidTransactionIdError,
  InvalidGatewayResponseError,
} from "../src/reads/errors.js";
import { UnsupportedEndpointError } from "../src/endpoints.js";
import {
  DEFAULT_APP_NAME,
  TAG_APP_NAME,
  TAG_CODEX_OWNER,
  TAG_CODEX_TAG_SCHEMA_VERSION,
  CODEX_TAG_SCHEMA_VERSION_CURRENT,
  TAG_CODEX_UPLOAD_ID,
  TAG_CODEX_ITEM_TYPE,
} from "../src/upload/tags.js";

const instantSleep = async () => {};

/** A canonical 43-char base64url address (fixture-independent shape gate). */
const ADDR = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);
/** A second distinct canonical address (used as a returned node id). */
const ID1 = "0123456789012345678901234567890123456789012";
const ID2 = "abcABCabcABCabcABCabcABCabcABCabcABCabcAB_-";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a GraphQL transactions body. */
function gqlBody(
  edges: Array<{ cursor: string; id: string; tags: Array<{ name: string; value: string }> }>,
  hasNextPage: boolean,
) {
  return {
    data: {
      transactions: {
        pageInfo: { hasNextPage },
        edges: edges.map((e) => ({
          cursor: e.cursor,
          node: { id: e.id, tags: e.tags },
        })),
      },
    },
  };
}

const TAGS1 = [
  { name: TAG_APP_NAME, value: DEFAULT_APP_NAME },
  { name: TAG_CODEX_OWNER, value: ADDR },
];

describe("queryOwnerUploads — caller input validation (before any pool attempt)", () => {
  it("throws InvalidAddressError for a 42-char address with ZERO fetch calls", async () => {
    const fetchFn = vi.fn();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await expect(
      queryOwnerUploads(pool, ADDR.slice(0, 42), { fetchFn }),
    ).rejects.toThrow(InvalidAddressError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws InvalidAddressError for a '+'-containing address with ZERO fetch calls", async () => {
    const fetchFn = vi.fn();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const bad = "a+cdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);
    await expect(queryOwnerUploads(pool, bad, { fetchFn })).rejects.toThrow(
      InvalidAddressError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects out-of-range pageSize (0, 101, non-integer) as InvalidRebuildParamsError, zero calls", async () => {
    for (const pageSize of [0, 101, 2.5]) {
      const fetchFn = vi.fn();
      const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });
      await expect(
        queryOwnerUploads(pool, ADDR, { pageSize, fetchFn }),
      ).rejects.toThrow(InvalidRebuildParamsError);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("names pageSize as the offending option in the structured field", async () => {
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });
    try {
      await queryOwnerUploads(pool, ADDR, { pageSize: 0, fetchFn: vi.fn() });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidRebuildParamsError);
      expect((err as InvalidRebuildParamsError).field).toBe("pageSize");
    }
  });

  it("rejects maxPages of 0 as InvalidRebuildParamsError, zero calls", async () => {
    const fetchFn = vi.fn();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });
    await expect(
      queryOwnerUploads(pool, ADDR, { maxPages: 0, fetchFn }),
    ).rejects.toThrow(InvalidRebuildParamsError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects an explicitly empty appName as InvalidRebuildParamsError, zero calls", async () => {
    const fetchFn = vi.fn();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });
    await expect(
      queryOwnerUploads(pool, ADDR, { appName: "", fetchFn }),
    ).rejects.toThrow(InvalidRebuildParamsError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("queryOwnerUploads — origin-only pre-flight", () => {
  it("surfaces UnsupportedEndpointError UNWRAPPED with ZERO attempts for a pathed endpoint", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(gqlBody([], false)));
    const pool = createGatewayPool({
      endpoints: ["https://gw.example/graphql-proxy"],
      sleep: instantSleep,
    });

    await expect(queryOwnerUploads(pool, ADDR, { fetchFn })).rejects.toThrow(
      UnsupportedEndpointError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("queryOwnerUploads — empty-result contract", () => {
  it("resolves [] for the exact live-verified zero-match body (no error, no rotation)", async () => {
    // The exact body observed live against arweave.net/graphql for a zero-match owner.
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: { transactions: { pageInfo: { hasNextPage: false }, edges: [] } },
      }),
    );
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    await expect(queryOwnerUploads(pool, ADDR, { fetchFn })).resolves.toEqual([]);
    // Success on the first endpoint — never rotates to B.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("queryOwnerUploads — single page mapping", () => {
  it("maps one page of 2 edges to 2 records with ids + tags verbatim", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        gqlBody(
          [
            { cursor: "c1", id: ID1, tags: TAGS1 },
            { cursor: "c2", id: ID2, tags: TAGS1 },
          ],
          false,
        ),
      ),
    );
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await queryOwnerUploads(pool, ADDR, { fetchFn });
    expect(result).toEqual([
      { id: ID1, tags: TAGS1 },
      { id: ID2, tags: TAGS1 },
    ]);
  });
});

describe("queryOwnerUploads — T4 schema-versioning tags flow through additively", () => {
  it("round-trips a fixture carrying all 7 tags (the 4 original + schema version, upload id, item type) with every tag intact", async () => {
    const fullTags = [
      ...TAGS1,
      { name: TAG_CODEX_TAG_SCHEMA_VERSION, value: CODEX_TAG_SCHEMA_VERSION_CURRENT },
      { name: TAG_CODEX_UPLOAD_ID, value: "upload-123" },
      { name: TAG_CODEX_ITEM_TYPE, value: "file" },
    ];
    const fetchFn = vi.fn(async () =>
      jsonResponse(gqlBody([{ cursor: "c1", id: ID1, tags: fullTags }], false)),
    );
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await queryOwnerUploads(pool, ADDR, { fetchFn });

    expect(result).toEqual([{ id: ID1, tags: fullTags }]);
  });

  it("still returns a valid record with no thrown error for a fixture carrying only the original 4 tags (a pre-existing upload that predates the schema)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(gqlBody([{ cursor: "c1", id: ID1, tags: TAGS1 }], false)),
    );
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await queryOwnerUploads(pool, ADDR, { fetchFn });

    expect(result).toEqual([{ id: ID1, tags: TAGS1 }]);
    // No Codex-Tag-Schema-Version tag present — must not be dropped or thrown on.
    expect(
      result[0].tags.some((t) => t.name === TAG_CODEX_TAG_SCHEMA_VERSION),
    ).toBe(false);
  });
});

describe("queryOwnerUploads — pagination", () => {
  it("passes page 1's last cursor as `after` on the second request and concatenates", async () => {
    const afters: Array<string | null> = [];
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      afters.push(body.variables.after ?? null);
      if (body.variables.after == null) {
        return jsonResponse(gqlBody([{ cursor: "cursor-A", id: ID1, tags: TAGS1 }], true));
      }
      return jsonResponse(gqlBody([{ cursor: "cursor-B", id: ID2, tags: TAGS1 }], false));
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await queryOwnerUploads(pool, ADDR, { fetchFn });

    expect(afters).toEqual([null, "cursor-A"]);
    expect(result).toEqual([
      { id: ID1, tags: TAGS1 },
      { id: ID2, tags: TAGS1 },
    ]);
  });

  it("throws RebuildPageLimitError (pages + records fields) when hasNextPage still true after maxPages", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      const cursor = `c${n++}`;
      // Every page reports another page — the loop never terminates on its own.
      return jsonResponse(gqlBody([{ cursor, id: ID1, tags: TAGS1 }], true));
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    let thrown: unknown;
    try {
      await queryOwnerUploads(pool, ADDR, { maxPages: 3, fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RebuildPageLimitError);
    expect((thrown as RebuildPageLimitError).pagesFetched).toBe(3);
    expect((thrown as RebuildPageLimitError).recordsCollected).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe("queryOwnerUploads — onProgress callback", () => {
  // Regression guard for the owner-reported "no visible progress on a big
  // rebuild" gap: a codex with many uploads across many pages had NO way to
  // show the user anything was happening mid-rebuild — `queryOwnerUploads`
  // resolved (or threw RebuildPageLimitError) only at the very end. This pins
  // the fix: an injected `onProgress` fires after EVERY genuinely fetched
  // page (not per-record — page-level granularity matches the loop's own
  // natural checkpoint) with the RUNNING total pages/records for this one
  // owner's query.
  it("calls onProgress after each fetched page with the running pagesFetched/recordsFound totals", async () => {
    const calls: Array<{ pagesFetched: number; recordsFound: number }> = [];
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.variables.after == null) {
        return jsonResponse(gqlBody([{ cursor: "cursor-A", id: ID1, tags: TAGS1 }], true));
      }
      return jsonResponse(
        gqlBody(
          [
            { cursor: "cursor-B1", id: ID2, tags: TAGS1 },
            { cursor: "cursor-B2", id: ID2, tags: TAGS1 },
          ],
          false,
        ),
      );
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await queryOwnerUploads(pool, ADDR, {
      fetchFn,
      onProgress: (p) => calls.push(p),
    });

    // Page 1: 1 record. Page 2: 2 MORE records — the total is RUNNING, not
    // per-page.
    expect(calls).toEqual([
      { pagesFetched: 1, recordsFound: 1 },
      { pagesFetched: 2, recordsFound: 3 },
    ]);
  });

  it("never fires onProgress for the restart's own silent budget-consuming iteration (mid-pagination rotation discards a stale cursor without a real fetch succeeding)", async () => {
    // The EXACT scenario the "cursor-endpoint binding" describe block below
    // already pins deterministically (A serves page 1, dies on page 2, the
    // loop restarts and B serves the full 2-page run from after:null) —
    // reused verbatim here rather than inventing a new pool-rotation
    // sequence, since the precise endpoint-selection behavior on a restart is
    // that test's own well-established contract, not this one's to re-derive.
    const bReceivedCursors: Array<string | null> = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      const after: string | null = body.variables.after ?? null;

      if (url.startsWith("https://a.example")) {
        if (after == null) {
          return jsonResponse(gqlBody([{ cursor: "A-cursor-1", id: ID1, tags: TAGS1 }], true));
        }
        return jsonResponse({ e: 1 }, 500);
      }

      bReceivedCursors.push(after);
      if (after == null) {
        return jsonResponse(gqlBody([{ cursor: "B-cursor-1", id: ID2, tags: TAGS1 }], true));
      }
      return jsonResponse(gqlBody([{ cursor: "B-cursor-2", id: ID1, tags: TAGS1 }], false));
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });
    const calls: Array<{ pagesFetched: number; recordsFound: number }> = [];

    await queryOwnerUploads(pool, ADDR, { fetchFn, onProgress: (p) => calls.push(p) });

    // A's genuine page 1 fires once (pagesFetched:1). The restart's OWN
    // budget-consuming iteration (pagesFetched:2) is silent — no onProgress
    // call ever reports pagesFetched:2 — then B's two genuine pages fire at
    // pagesFetched 3 and 4. The gap at 2 IS the assertion.
    expect(calls.map((c) => c.pagesFetched)).toEqual([1, 3, 4]);
    expect(calls).toEqual([
      { pagesFetched: 1, recordsFound: 1 },
      { pagesFetched: 3, recordsFound: 1 },
      { pagesFetched: 4, recordsFound: 2 },
    ]);
  });
});

describe("queryOwnerUploads — pool rotation semantics", () => {
  it("retries on B after A returns HTTP 500 and resolves with B's answer", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://a.example")) return jsonResponse({ e: 1 }, 500);
      return jsonResponse(gqlBody([{ cursor: "c1", id: ID1, tags: TAGS1 }], false));
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    await expect(queryOwnerUploads(pool, ADDR, { fetchFn })).resolves.toEqual([
      { id: ID1, tags: TAGS1 },
    ]);
  });

  it("rejects GatewayPoolExhaustedError UNWRAPPED with per-endpoint attempts when every endpoint fails", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ e: 1 }, 503));
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await queryOwnerUploads(pool, ADDR, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    expect((thrown as GatewayPoolExhaustedError).attempts.map((a) => a.endpoint)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("rotates on a 200 body carrying a GraphQL errors array (A) to B's clean answer", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://a.example")) {
        return jsonResponse({ errors: [{ message: "index lag" }], data: null });
      }
      return jsonResponse(gqlBody([{ cursor: "c1", id: ID1, tags: TAGS1 }], false));
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    await expect(queryOwnerUploads(pool, ADDR, { fetchFn })).resolves.toEqual([
      { id: ID1, tags: TAGS1 },
    ]);
  });
});

describe("queryOwnerUploads — response validation (throws → rotation)", () => {
  it("rejects a body missing the data.transactions.edges shape as InvalidGatewayResponseError", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: { transactions: {} } }));
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });
    let thrown: unknown;
    try {
      await queryOwnerUploads(pool, ADDR, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    expect((thrown as GatewayPoolExhaustedError).attempts[0].error).toBeInstanceOf(
      InvalidGatewayResponseError,
    );
  });

  it("rejects an edge node whose id is not the canonical 43-char form (cache-poisoning guard)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(gqlBody([{ cursor: "c1", id: "../graphql", tags: TAGS1 }], false)),
    );
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });
    let thrown: unknown;
    try {
      await queryOwnerUploads(pool, ADDR, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    expect((thrown as GatewayPoolExhaustedError).attempts[0].error).toBeInstanceOf(
      InvalidGatewayResponseError,
    );
  });

  it("rejects unparseable JSON as InvalidGatewayResponseError (rotation)", async () => {
    const fetchFn = vi.fn(async () => new Response("not json{", { status: 200 }));
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });
    let thrown: unknown;
    try {
      await queryOwnerUploads(pool, ADDR, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    expect((thrown as GatewayPoolExhaustedError).attempts[0].error).toBeInstanceOf(
      InvalidGatewayResponseError,
    );
  });

  it("rejects a literal JSON null body (HTTP 200) as InvalidGatewayResponseError with reason non-object-body (rotation, not a raw TypeError)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(null));
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });
    let thrown: unknown;
    try {
      await queryOwnerUploads(pool, ADDR, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    const attemptError = (thrown as GatewayPoolExhaustedError).attempts[0].error;
    expect(attemptError).toBeInstanceOf(InvalidGatewayResponseError);
    expect((attemptError as InvalidGatewayResponseError).reason).toBe("non-object-body");
  });

  it("progress-consistency: hasNextPage true with edges:[] throws InvalidGatewayResponseError (rotation, not a 50-request spin)", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://a.example")) {
        // Can never make progress: rotation, not RebuildPageLimitError.
        return jsonResponse(gqlBody([], true));
      }
      return jsonResponse(gqlBody([{ cursor: "c1", id: ID1, tags: TAGS1 }], false));
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    await expect(queryOwnerUploads(pool, ADDR, { fetchFn })).resolves.toEqual([
      { id: ID1, tags: TAGS1 },
    ]);
  });

  it("progress-consistency: last edge with empty cursor + hasNextPage true rotates", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://a.example")) {
        return jsonResponse(gqlBody([{ cursor: "", id: ID1, tags: TAGS1 }], true));
      }
      return jsonResponse(gqlBody([{ cursor: "c1", id: ID2, tags: TAGS1 }], false));
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    await expect(queryOwnerUploads(pool, ADDR, { fetchFn })).resolves.toEqual([
      { id: ID2, tags: TAGS1 },
    ]);
  });
});

describe("queryOwnerUploads — request composition (URL + variables)", () => {
  it("POSTs the composed {endpoint}/graphql URL with owners AND the exact tag filter", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(input);
      seenInit = init;
      return jsonResponse(gqlBody([], false));
    });
    // Trailing-slash endpoint proves no double-slash in the composed URL.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net/"], sleep: instantSleep });

    await queryOwnerUploads(pool, ADDR, { fetchFn });

    expect(seenUrl).toBe("https://arweave.net/graphql");
    expect(seenUrl).not.toMatch(/\/\/graphql/);
    expect(seenInit?.method).toBe("POST");
    expect((seenInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const body = JSON.parse(String(seenInit?.body));
    // owners filter carries the verbatim owner.
    expect(body.variables.owners).toEqual([ADDR]);
    // Tag filter keys on the T4.2 constants; App-Name default from the imported constant.
    expect(body.variables.tags).toEqual([
      { name: TAG_APP_NAME, values: [DEFAULT_APP_NAME] },
      { name: TAG_CODEX_OWNER, values: [ADDR] },
    ]);
    expect(body.variables.first).toBe(DEFAULT_REBUILD_PAGE_SIZE);
    expect(body.variables.after ?? null).toBeNull();
    // Query uses GraphQL variables, never string interpolation of the owner.
    expect(body.query).toContain("$owners");
    expect(body.query).not.toContain(ADDR);
  });

  it("uses an explicit appName override in the tag filter", async () => {
    let body: { variables: { tags: Array<{ name: string; values: string[] }> } } | undefined;
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(gqlBody([], false));
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await queryOwnerUploads(pool, ADDR, { appName: "Custom-App", fetchFn });
    expect(body?.variables.tags[0]).toEqual({ name: TAG_APP_NAME, values: ["Custom-App"] });
  });
});

describe("queryOwnerUploads — cursor-endpoint binding (mid-pagination rotation)", () => {
  it("restarts from after:null on B after A serves page 1 then 500s on page 2; B never receives A's cursor", async () => {
    const bReceivedCursors: Array<string | null> = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      const after: string | null = body.variables.after ?? null;

      if (url.startsWith("https://a.example")) {
        if (after == null) {
          // A serves page 1 (with a cursor it minted).
          return jsonResponse(gqlBody([{ cursor: "A-cursor-1", id: ID1, tags: TAGS1 }], true));
        }
        // A dies on page 2.
        return jsonResponse({ e: 1 }, 500);
      }

      // B: record every cursor it receives to prove it never sees A's.
      bReceivedCursors.push(after);
      if (after == null) {
        return jsonResponse(gqlBody([{ cursor: "B-cursor-1", id: ID2, tags: TAGS1 }], true));
      }
      return jsonResponse(gqlBody([{ cursor: "B-cursor-2", id: ID1, tags: TAGS1 }], false));
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await queryOwnerUploads(pool, ADDR, { fetchFn });

    // Final result equals B's full run from after:null — no duplicate from A's discarded page 1.
    expect(result).toEqual([
      { id: ID2, tags: TAGS1 },
      { id: ID1, tags: TAGS1 },
    ]);
    // B NEVER received A's cursor: its first request is after:null, then its own minted cursor.
    expect(bReceivedCursors).toEqual([null, "B-cursor-1"]);
    expect(bReceivedCursors).not.toContain("A-cursor-1");
  });
});

describe("queryOwnerUploads — cursor binds to the SERVING endpoint, not shared pool state", () => {
  it("keeps page 1's cursor bound to A even when a concurrent consumer flips the pool's activeEndpoint to B between pages", async () => {
    // A real pool serves BOTH pages from A (the fetch below only ever answers A).
    // We wrap it in a thin pass-through whose `getActiveEndpoint()` reports B
    // once page 1 has resolved — modelling a concurrent consumer of the SAME pool
    // (getBalance / sendTransfer) succeeding on B and overwriting the shared,
    // single `activeEndpoint` across the rebuild's await boundary.
    //
    // Pre-fix the loop read `cursorEndpoint = pool.getActiveEndpoint()` AFTER the
    // page resolved, capturing B — an endpoint that never served the page. On
    // page 2 the RESTART sentinel then fired (bound "B" !== serving "A"),
    // discarding page 1 and re-issuing from after:null (A would see a SECOND
    // `null` instead of "A-cursor-1"), corrupting the authoritative set. Post-fix
    // the cursor comes from the op's own returned `servedBy` (A) → no restart.
    const inner = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });
    let page1Resolved = false;
    const pool = {
      execute: inner.execute,
      getHealthSnapshot: () => inner.getHealthSnapshot(),
      // The concurrent-consumer clobber: shared activeEndpoint is B after page 1.
      getActiveEndpoint: () => (page1Resolved ? "https://b.example" : inner.getActiveEndpoint()),
    };

    const aReceivedAfters: Array<string | null> = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      const after: string | null = body.variables.after ?? null;
      if (!url.startsWith("https://a.example")) throw new Error("rebuild fetch unexpectedly hit B");

      aReceivedAfters.push(after);
      if (after == null) {
        // Page 1: A mints "A-cursor-1", reports another page. The concurrent
        // consumer's clobber takes effect from here onward.
        page1Resolved = true;
        return jsonResponse(gqlBody([{ cursor: "A-cursor-1", id: ID1, tags: TAGS1 }], true));
      }
      // Page 2: A must receive its OWN cursor, never a spurious restart to null.
      return jsonResponse(gqlBody([{ cursor: "A-cursor-2", id: ID2, tags: TAGS1 }], false));
    });

    const result = await queryOwnerUploads(pool, ADDR, { fetchFn });

    // Shared state was clobbered to B, yet the cursor stayed bound to A.
    expect(pool.getActiveEndpoint()).toBe("https://b.example");
    // A saw exactly two requests: page 1 (null) then page 2 with A's OWN cursor.
    // A spurious restart would surface as a second `null` after "A-cursor-1".
    expect(aReceivedAfters).toEqual([null, "A-cursor-1"]);
    // The full, correct record set — both pages, no duplicate, no drop.
    expect(result).toEqual([
      { id: ID1, tags: TAGS1 },
      { id: ID2, tags: TAGS1 },
    ]);
  });
});

describe("queryOwnerUploads — default fetch seam is binding-safe and call-time resolved", () => {
  it("delegates to globalThis.fetch when no fetchFn is injected", async () => {
    const stub = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(gqlBody([], false)),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const pool = createGatewayPool({ endpoints: ["https://arweave.net"], sleep: instantSleep });
      await expect(queryOwnerUploads(pool, ADDR)).resolves.toEqual([]);
      expect(stub).toHaveBeenCalledTimes(1);
      expect(String(stub.mock.calls[0][0])).toBe("https://arweave.net/graphql");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("queryUploadById — T7 single-id lookup (retroactive add)", () => {
  it("throws InvalidTransactionIdError for a 42-char id with ZERO fetch calls (caller validation before any pool attempt)", async () => {
    const fetchFn = vi.fn();
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await expect(
      queryUploadById(pool, ID1.slice(0, 42), { fetchFn }),
    ).rejects.toThrow(InvalidTransactionIdError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("surfaces UnsupportedEndpointError UNWRAPPED with ZERO attempts for a pathed endpoint", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(gqlBody([], false)));
    const pool = createGatewayPool({
      endpoints: ["https://gw.example/graphql-proxy"],
      sleep: instantSleep,
    });

    await expect(queryUploadById(pool, ID1, { fetchFn })).rejects.toThrow(
      UnsupportedEndpointError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("resolves null for a well-formed, empty (zero-match) response — NEVER throws for 'not found'", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(gqlBody([], false)));
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await expect(queryUploadById(pool, ID1, { fetchFn })).resolves.toBeNull();
  });

  it("resolves the matching record's id + tags verbatim when found", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(gqlBody([{ cursor: "c1", id: ID1, tags: TAGS1 }], false)),
    );
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await expect(queryUploadById(pool, ID1, { fetchFn })).resolves.toEqual({
      id: ID1,
      tags: TAGS1,
    });
  });

  it("POSTs the composed {endpoint}/graphql URL with an $ids variable, never string-interpolating the id into the query text", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(input);
      seenInit = init;
      return jsonResponse(gqlBody([], false));
    });
    // Trailing-slash endpoint proves no double-slash in the composed URL.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net/"], sleep: instantSleep });

    await queryUploadById(pool, ID1, { fetchFn });

    expect(seenUrl).toBe("https://arweave.net/graphql");
    expect(seenInit?.method).toBe("POST");
    expect((seenInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const body = JSON.parse(String(seenInit?.body));
    expect(body.variables.ids).toEqual([ID1]);
    expect(body.query).toContain("$ids");
    expect(body.query).not.toContain(ID1);
  });

  it("rejects GatewayPoolExhaustedError UNWRAPPED when every endpoint fails — a genuine gateway failure, unlike 'not found'", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ e: 1 }, 503));
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await queryUploadById(pool, ID1, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
  });

  it("delegates to globalThis.fetch when no fetchFn is injected", async () => {
    const stub = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(gqlBody([], false)),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const pool = createGatewayPool({ endpoints: ["https://arweave.net"], sleep: instantSleep });
      await expect(queryUploadById(pool, ID1)).resolves.toBeNull();
      expect(stub).toHaveBeenCalledTimes(1);
      expect(String(stub.mock.calls[0][0])).toBe("https://arweave.net/graphql");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("queryUploadsByTag — tag-only query (no owner filter), the T2 chain-query safety-net seam", () => {
  const TAG_NAME = "Codex-Encryptor";
  const TAG_VALUE = ADDR;
  const TAG_FIXTURE_TAGS = [
    { name: TAG_NAME, value: TAG_VALUE },
    { name: "Codex-Encrypted", value: "true" },
  ];

  it("resolves the parsed records for a fixture response with matching edges", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(gqlBody([{ cursor: "c1", id: ID1, tags: TAG_FIXTURE_TAGS }], false)),
    );
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await expect(queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { fetchFn })).resolves.toEqual([
      { id: ID1, tags: TAG_FIXTURE_TAGS },
    ]);
  });

  it("resolves [] for an empty edges array — never throws for 'no matches'", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(gqlBody([], false)));
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await expect(queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { fetchFn })).resolves.toEqual([]);
  });

  it("composes the query body with ONLY a tags filter — no owners key anywhere in variables", async () => {
    let seenInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return jsonResponse(gqlBody([], false));
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { fetchFn });

    const body = JSON.parse(String(seenInit?.body));
    expect(body.variables.tags).toEqual([{ name: TAG_NAME, values: [TAG_VALUE] }]);
    expect(body.variables).not.toHaveProperty("owners");
    expect(body.query).not.toMatch(/owners/);
    // The query uses GraphQL variables, never string-interpolating the tag value.
    expect(body.query).toContain("$tags");
    expect(body.query).not.toContain(TAG_VALUE);
  });

  it("defaults `first` to a low value (existence-check sized) when opts.first is omitted", async () => {
    let body: { variables: { first: number } } | undefined;
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(gqlBody([], false));
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { fetchFn });

    expect(body?.variables.first).toBe(1);
  });

  it("honors an explicit opts.first override for a caller that wants a full list", async () => {
    let body: { variables: { first: number } } | undefined;
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(gqlBody([], false));
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    await queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { first: 100, fetchFn });

    expect(body?.variables.first).toBe(100);
  });

  it("POSTs the composed {endpoint}/graphql URL, same URL-join convention as queryOwnerUploads", async () => {
    let seenUrl = "";
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      seenUrl = String(input);
      return jsonResponse(gqlBody([], false));
    });
    // Trailing-slash endpoint proves no double-slash in the composed URL.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net/"], sleep: instantSleep });

    await queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { fetchFn });

    expect(seenUrl).toBe("https://arweave.net/graphql");
  });

  it("surfaces UnsupportedEndpointError UNWRAPPED with ZERO attempts for a pathed endpoint", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(gqlBody([], false)));
    const pool = createGatewayPool({
      endpoints: ["https://gw.example/graphql-proxy"],
      sleep: instantSleep,
    });

    await expect(queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { fetchFn })).rejects.toThrow(
      UnsupportedEndpointError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects GatewayPoolExhaustedError UNWRAPPED when every endpoint fails — a genuine gateway failure never silently resolves []", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ e: 1 }, 503));
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await queryUploadsByTag(pool, TAG_NAME, TAG_VALUE, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
  });

  it("delegates to globalThis.fetch when no fetchFn is injected", async () => {
    const stub = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(gqlBody([], false)),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const pool = createGatewayPool({ endpoints: ["https://arweave.net"], sleep: instantSleep });
      await expect(queryUploadsByTag(pool, TAG_NAME, TAG_VALUE)).resolves.toEqual([]);
      expect(stub).toHaveBeenCalledTimes(1);
      expect(String(stub.mock.calls[0][0])).toBe("https://arweave.net/graphql");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
