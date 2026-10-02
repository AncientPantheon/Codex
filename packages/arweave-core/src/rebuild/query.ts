/**
 * GraphQL rebuild query through the gateway pool.
 *
 * `queryOwnerUploads(pool, ownerAddress, opts?)` POSTs `{endpoint}/graphql` through
 * the Phase 2 pool and returns every matching upload's `{ id, tags }` — the
 * rebuild source of truth. It filters by BOTH the cryptographically-bound
 * `owners` field AND the tag pair (`App-Name`, `Codex-Owner`), paginating until
 * `hasNextPage` is false. An owner with zero matching on-chain tags resolves `[]`
 * (SUCCESS, never an error, never a rotation).
 *
 * SECURITY — the `owners` filter is MANDATORY, not optional. Tags are plain
 * uploader-supplied metadata: any third party can upload a data item forging
 * `App-Name` + `Codex-Owner: <victim>` for fractions of a cent, poisoning the
 * victim's "authoritative" rebuild (CWE-345). The GraphQL `owners` field matches
 * the cryptographically-bound SIGNER address; because the upload path pins
 * `Codex-Owner` = `addressOf(jwk)` = the actual signer, every legitimate upload
 * satisfies both filters, so `owners` excludes forgeries at zero cost. This is a
 * deliberate, documented extension of the handoff's tags-only wording.
 *
 * Network I/O flows through the runtime-global `fetch` (Node >=20 + browsers) via
 * the pool — NOT arweave-js, NO GraphQL client dependency. The pool is passed IN
 * by the caller. Failures inside the per-endpoint operation THROW so the pool
 * rotates; pool exhaustion propagates `GatewayPoolExhaustedError` unwrapped.
 *
 * `queryUploadById(pool, id, opts?)` (T7, `arweave-upload-encryption`) is the
 * retroactive-add lookup: a single-id `transactions(ids: [$id])` query through
 * the SAME `{endpoint}/graphql` route, reusing `joinUrl`/`parsePage`/the
 * origin-only pre-flight verbatim — only the filter variable and the GraphQL
 * document differ from `queryOwnerUploads`. A well-formed, empty (zero-match)
 * response resolves `null` — "not found" is never an error; only a genuine
 * network/gateway failure (a non-2xx response, an unparseable body, a malformed
 * `transactions` shape) throws, exactly as `parsePage` already distinguishes for
 * `queryOwnerUploads`.
 *
 * `queryUploadsByTag(pool, tagName, tagValue, opts?)` (T2,
 * `arweave-non-removable-account`) is the tag-ONLY lookup `queryOwnerUploads`
 * cannot provide because its `owners` filter is mandatory (see the SECURITY
 * note above): "does any upload anywhere carry this tag?", e.g. the
 * chain-query safety net that checks for a confirmed upload tagged
 * `Codex-Encryptor: <address>`. A single-page `transactions(tags: $tags,
 * first: $first)` query — NO `owners`, NO pagination loop — reusing
 * `joinUrl`/`parsePage`/the origin-only pre-flight verbatim, same as
 * `queryUploadById`. `opts.first` defaults LOW (1) because the sanctioned
 * caller only needs an existence check; a caller wanting a full list must
 * pass a larger `first` explicitly. An empty `edges` array resolves `[]` —
 * "no matches" is never an error.
 */

import type { GatewayPool } from "../gateway/types.js";
import { assertOriginOnlyEndpoints } from "../endpoints.js";
import { isCanonicalAddress } from "../canonical.js";
import {
  InvalidAddressError,
  InvalidTransactionIdError,
  InvalidGatewayResponseError,
} from "../reads/errors.js";
import {
  DEFAULT_APP_NAME,
  TAG_APP_NAME,
  TAG_CODEX_OWNER,
} from "../upload/tags.js";
import {
  InvalidRebuildParamsError,
  RebuildPageLimitError,
} from "./errors.js";
import {
  DEFAULT_REBUILD_MAX_PAGES,
  DEFAULT_REBUILD_PAGE_SIZE,
  type FetchFn,
  type OwnerUploadRecord,
  type QueryOwnerUploadsOptions,
} from "./types.js";

const OPERATION = "queryOwnerUploads";

/** Max value for the GraphQL `first` argument (the arweave.net gateway maximum). */
const MAX_PAGE_SIZE = 100;

/** The paginated GraphQL query. Uses variables ($owners/$tags/$first/$after)
 *  exclusively — the owner is NEVER string-interpolated into the query text. */
const QUERY = `query($owners: [String!], $tags: [TagFilter!], $first: Int, $after: String) {
  transactions(owners: $owners, tags: $tags, first: $first, after: $after) {
    pageInfo { hasNextPage }
    edges { cursor node { id tags { name value } } }
  }
}`;

const defaultFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

/** Join an endpoint base URL with a route, collapsing any double slash at the
 *  seam (a trailing-slash endpoint + a leading-slash route must not double up). */
function joinUrl(endpointBaseUrl: string, route: string): string {
  const base = endpointBaseUrl.replace(/\/+$/, "");
  const path = route.replace(/^\/+/, "");
  return `${base}/${path}`;
}

/** A single validated page: the collected records plus the pagination cursor
 *  and the endpoint that actually served (and thus minted the cursor for) it. */
interface Page {
  records: OwnerUploadRecord[];
  hasNextPage: boolean;
  lastCursor: string | null;
  servedBy: string;
}

/** Sentinel resolved (never thrown) at operation entry when a stale cursor would
 *  be replayed against an endpoint that did not mint it — the loop restarts. */
const RESTART = Symbol("cursor-endpoint-rebind");

/** Validate one gateway response body and extract a {@link Page}. Throws
 *  {@link InvalidGatewayResponseError} for any invalid shape so the pool rotates.
 *  `operation` labels the thrown error (defaults to `queryOwnerUploads`'s own
 *  label); `queryUploadById` passes its own label through so a caller reading
 *  `InvalidGatewayResponseError.operation` sees which query actually failed. */
function parsePage(body: unknown, endpointBaseUrl: string, operation: string = OPERATION): Page {
  if (typeof body !== "object" || body === null) {
    throw new InvalidGatewayResponseError(operation, endpointBaseUrl, "non-object-body");
  }

  const errors = (body as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new InvalidGatewayResponseError(operation, endpointBaseUrl, "graphql-errors");
  }

  const edges = (body as { data?: { transactions?: { edges?: unknown } } })?.data
    ?.transactions?.edges;
  const pageInfo = (body as { data?: { transactions?: { pageInfo?: { hasNextPage?: unknown } } } })
    ?.data?.transactions?.pageInfo;
  if (!Array.isArray(edges) || typeof pageInfo?.hasNextPage !== "boolean") {
    throw new InvalidGatewayResponseError(operation, endpointBaseUrl, "malformed-transactions-shape");
  }

  const records: OwnerUploadRecord[] = [];
  let lastCursor: string | null = null;
  for (const edge of edges) {
    const cursor = (edge as { cursor?: unknown }).cursor;
    const node = (edge as { node?: unknown }).node as
      | { id?: unknown; tags?: unknown }
      | undefined;
    if (typeof node?.id !== "string" || !isCanonicalAddress(node.id)) {
      // A hostile gateway returning "../graphql" or control chars feeds path
      // traversal / cache poisoning into the source-of-truth cache.
      throw new InvalidGatewayResponseError(operation, endpointBaseUrl, "invalid-node-id");
    }
    if (!Array.isArray(node.tags)) {
      throw new InvalidGatewayResponseError(operation, endpointBaseUrl, "invalid-node-tags");
    }
    // Every tag the gateway returns is copied through verbatim, by shape only —
    // NEVER filtered or matched by name. This is what makes T4's schema-versioning
    // tags (Codex-Tag-Schema-Version, Codex-Upload-Id, Codex-Item-Type) flow
    // through additively with zero changes needed here: a 7-tag fixture round-trips
    // all 7, and a pre-schema 4-tag fixture (missing Codex-Tag-Schema-Version)
    // round-trips its 4 untouched — never dropped, never an error. Tag-NAME
    // interpretation is a consumer's job (e.g. `codex-arweave`'s rebuild), not this
    // layer's.
    const tags: Array<{ name: string; value: string }> = [];
    for (const tag of node.tags) {
      const t = tag as { name?: unknown; value?: unknown };
      if (typeof t.name !== "string" || typeof t.value !== "string") {
        throw new InvalidGatewayResponseError(operation, endpointBaseUrl, "invalid-tag-shape");
      }
      tags.push({ name: t.name, value: t.value });
    }
    records.push({ id: node.id, tags });
    lastCursor = typeof cursor === "string" ? cursor : null;
  }

  // Progress-consistency: a body that reports another page but cannot advance
  // pagination (zero edges, or a last edge with no usable cursor) can never make
  // progress — it is by construction an invalid answer, NOT a page-limit case.
  if (pageInfo.hasNextPage) {
    if (records.length === 0 || lastCursor === null || lastCursor === "") {
      throw new InvalidGatewayResponseError(operation, endpointBaseUrl, "no-progress");
    }
  }

  return { records, hasNextPage: pageInfo.hasNextPage, lastCursor, servedBy: endpointBaseUrl };
}

/**
 * Query every matching upload for `ownerAddress` through the gateway pool.
 *
 * Order of operations: (0) origin-only pre-flight over the pool's configured
 * endpoints — a pathed endpoint surfaces `UnsupportedEndpointError` unwrapped
 * with zero attempts; (1) validate caller inputs BEFORE any pool attempt; (2-5)
 * paginate, one `pool.execute` per page, restarting from `after: null` if a
 * mid-pagination rotation would replay a cursor at an endpoint that did not mint
 * it, throwing `RebuildPageLimitError` rather than silently truncating; (6)
 * resolve the collected records in gateway-returned order.
 */
export async function queryOwnerUploads(
  pool: GatewayPool,
  ownerAddress: string,
  opts?: QueryOwnerUploadsOptions,
): Promise<OwnerUploadRecord[]> {
  // (1) caller input validation — an explicitly provided appName must be a
  // non-empty string BEFORE the address check so an empty filter never slips by.
  if (opts?.appName !== undefined && (typeof opts.appName !== "string" || opts.appName.length === 0)) {
    throw new InvalidRebuildParamsError(
      "appName",
      "empty-or-non-string",
      "appName, when provided, must be a non-empty string.",
    );
  }
  if (!isCanonicalAddress(ownerAddress)) {
    throw new InvalidAddressError(ownerAddress);
  }

  const pageSize = opts?.pageSize ?? DEFAULT_REBUILD_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new InvalidRebuildParamsError(
      "pageSize",
      "out-of-range",
      `pageSize must be an integer in 1..${MAX_PAGE_SIZE}.`,
    );
  }

  const maxPages = opts?.maxPages ?? DEFAULT_REBUILD_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new InvalidRebuildParamsError(
      "maxPages",
      "out-of-range",
      "maxPages must be an integer >= 1.",
    );
  }

  const appName = opts?.appName ?? DEFAULT_APP_NAME;
  const fetchFn = opts?.fetchFn ?? defaultFetch;
  const onProgress = opts?.onProgress;

  // (0) origin-only pre-flight over ALL configured endpoints (the snapshot
  // enumerates them verbatim from construction). UnsupportedEndpointError
  // surfaces UNWRAPPED before the first pool attempt.
  assertOriginOnlyEndpoints(pool.getHealthSnapshot().map((e) => e.endpoint));

  const tagFilter = [
    { name: TAG_APP_NAME, values: [appName] },
    { name: TAG_CODEX_OWNER, values: [ownerAddress] },
  ];

  // Pagination loop. `records`/`after`/`cursorEndpoint` reset on a restart.
  let records: OwnerUploadRecord[] = [];
  let after: string | null = null;
  // The endpoint that minted the current `after` cursor. A cursor is opaque and
  // per-endpoint: replaying it at a different endpoint after a rotation is
  // undefined behavior (silent dup/drop), so we restart instead.
  let cursorEndpoint: string | null = null;
  let pagesFetched = 0;

  for (;;) {
    if (pagesFetched >= maxPages) {
      // hasNextPage must still be true to reach here (the loop returns below when
      // it is false); refuse to return a partial source-of-truth set.
      throw new RebuildPageLimitError(pagesFetched, records.length);
    }

    // Capture the loop state this attempt is built on. `pool.execute` may run the
    // op against a DIFFERENT endpoint than last time (rotation); the op detects
    // that at entry and resolves the RESTART sentinel without sending a request.
    const requestedAfter = after;
    const boundEndpoint = cursorEndpoint;

    const outcome = await pool.execute<Page | typeof RESTART>(
      async function queryOwnerUploads(endpointBaseUrl, { signal }) {
        // CURSOR-ENDPOINT BINDING (detected AT OPERATION ENTRY, before any
        // request): when we hold a cursor minted by a different endpoint, the
        // stale cursor must never be fired here. Resolve (not throw) the restart
        // sentinel — a throw would spuriously rotate and poison this endpoint's
        // health for a non-failure.
        if (requestedAfter !== null && boundEndpoint !== null && boundEndpoint !== endpointBaseUrl) {
          return RESTART;
        }

        const url = joinUrl(endpointBaseUrl, "graphql");
        const response = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            query: QUERY,
            variables: {
              owners: [ownerAddress],
              tags: tagFilter,
              first: pageSize,
              after: requestedAfter,
            },
          }),
        });

        if (!response.ok) {
          throw new InvalidGatewayResponseError(
            OPERATION,
            endpointBaseUrl,
            `http-status-${response.status}`,
          );
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "unparseable-json");
        }

        // page.servedBy carries this endpoint, so the loop binds the next
        // cursor to the endpoint that actually minted it.
        return parsePage(body, endpointBaseUrl);
      },
    );

    if (outcome === RESTART) {
      // A mid-pagination rotation landed us on a new endpoint. Discard everything
      // collected against the old endpoint and restart from after:null. The
      // restart still consumed a maxPages budget slot below, so a flapping pool
      // terminates in RebuildPageLimitError rather than looping forever.
      records = [];
      after = null;
      cursorEndpoint = null;
      pagesFetched += 1;
      continue;
    }

    pagesFetched += 1;
    records = records.concat(outcome.records);
    // Fires AFTER every genuinely-fetched page (never for the RESTART branch
    // above, which never reaches here) — the running totals for THIS owner.
    onProgress?.({ pagesFetched, recordsFound: records.length });

    if (!outcome.hasNextPage) {
      return records;
    }

    after = outcome.lastCursor;
    // Bind the cursor to the endpoint that ACTUALLY served this page, taken from
    // the op's own return value — NOT pool.getActiveEndpoint(), whose shared
    // mutable state a concurrent consumer of the same pool can overwrite across
    // the await boundary, mis-binding the cursor to an endpoint that never
    // served the page.
    cursorEndpoint = outcome.servedBy;
  }
}

const OPERATION_BY_ID = "queryUploadById";

/** The single-id GraphQL query. SAME shape as {@link QUERY} (`transactions {
 *  pageInfo { hasNextPage } edges { cursor node { id tags { name value } } } }`)
 *  so the existing `parsePage` validates/maps its response verbatim — only the
 *  filter differs (`ids: $ids` instead of `owners`/`tags`). Uses a variable
 *  ($ids) exclusively — the id is NEVER string-interpolated into the query
 *  text. */
const QUERY_BY_ID = `query($ids: [ID!]) {
  transactions(ids: $ids) {
    pageInfo { hasNextPage }
    edges { cursor node { id tags { name value } } }
  }
}`;

/** Options for {@link queryUploadById}. */
export interface QueryUploadByIdOptions {
  /** Injectable fetch seam; defaults to a binding-safe call-time delegate to
   *  `globalThis.fetch` (the SAME `defaultFetch` `queryOwnerUploads` uses). */
  fetchFn?: FetchFn;
}

/**
 * Look up ONE upload by transaction/data-item id through the gateway pool —
 * the T7 retroactive-add lookup. Reuses `queryOwnerUploads`'s own
 * query-construction style verbatim: a single `pool.execute` POSTs
 * `{endpoint}/graphql` with the id carried ONLY as a GraphQL variable, and the
 * response is validated/mapped by the SAME `parsePage` used for pagination.
 *
 * Resolves `null` for a well-formed, empty (zero-match) response — "not found"
 * is never an error. Resolves the first matching record when found (an id is
 * unique, so more than one edge is not an expected shape, but the first is
 * taken defensively rather than throwing). Only a genuine network/gateway
 * failure — a non-2xx response, unparseable JSON, a malformed `transactions`
 * shape, or pool exhaustion — throws (rotating first, exactly like
 * `queryOwnerUploads`).
 *
 * Order of operations mirrors `queryOwnerUploads`: (0) origin-only pre-flight
 * over the pool's configured endpoints; (1) validate the id's canonical form
 * BEFORE any pool attempt; (2) one `pool.execute` POST; (3) resolve `null` or
 * the first record.
 */
export async function queryUploadById(
  pool: GatewayPool,
  id: string,
  opts?: QueryUploadByIdOptions,
): Promise<OwnerUploadRecord | null> {
  // (1) caller input validation BEFORE any pool attempt — an id is a
  // transaction/data-item id, not an owner address, so its own typed error
  // (InvalidTransactionIdError) names it correctly.
  if (!isCanonicalAddress(id)) {
    throw new InvalidTransactionIdError(id);
  }

  const fetchFn = opts?.fetchFn ?? defaultFetch;

  // (0) origin-only pre-flight over ALL configured endpoints, before the first
  // pool attempt — same policy as queryOwnerUploads.
  assertOriginOnlyEndpoints(pool.getHealthSnapshot().map((e) => e.endpoint));

  const page = await pool.execute<Page>(async function queryUploadById(endpointBaseUrl, { signal }) {
    const url = joinUrl(endpointBaseUrl, "graphql");
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        query: QUERY_BY_ID,
        variables: { ids: [id] },
      }),
    });

    if (!response.ok) {
      throw new InvalidGatewayResponseError(
        OPERATION_BY_ID,
        endpointBaseUrl,
        `http-status-${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new InvalidGatewayResponseError(OPERATION_BY_ID, endpointBaseUrl, "unparseable-json");
    }

    return parsePage(body, endpointBaseUrl, OPERATION_BY_ID);
  });

  return page.records[0] ?? null;
}

const OPERATION_BY_TAG = "queryUploadsByTag";

/** Default `first` for {@link queryUploadsByTag} — deliberately LOW (an
 *  existence check needs only "does at least one match exist?", not a full
 *  list). A caller that wants a full list must pass a larger `opts.first`
 *  explicitly; this default never paginates beyond the single requested page. */
const DEFAULT_TAG_QUERY_FIRST = 1;

/** The tag-only GraphQL query. SAME response shape as {@link QUERY}
 *  (`transactions { pageInfo { hasNextPage } edges { cursor node { id tags {
 *  name value } } } }`) so the existing `parsePage` validates/maps its
 *  response verbatim — only the filter differs: `tags: $tags` ONLY, no
 *  `owners`. Uses a variable ($tags) exclusively — the tag value is NEVER
 *  string-interpolated into the query text. */
const QUERY_BY_TAG = `query($tags: [TagFilter!], $first: Int) {
  transactions(tags: $tags, first: $first) {
    pageInfo { hasNextPage }
    edges { cursor node { id tags { name value } } }
  }
}`;

/** Options for {@link queryUploadsByTag}. */
export interface QueryUploadsByTagOptions {
  /** GraphQL `first` argument. Defaults to {@link DEFAULT_TAG_QUERY_FIRST}
   *  (low — sized for an existence check). A caller that wants a full list of
   *  matches must pass a larger value explicitly. */
  first?: number;
  /** Injectable fetch seam; defaults to a binding-safe call-time delegate to
   *  `globalThis.fetch` (the SAME `defaultFetch` `queryOwnerUploads` uses). */
  fetchFn?: FetchFn;
}

/**
 * Query uploads by a SINGLE arbitrary tag name/value pair ONLY — no `owners`
 * filter. This is the gap `queryOwnerUploads` deliberately does not cover: its
 * `owners` filter is mandatory (see the module doc comment's SECURITY note),
 * so it cannot answer "does any upload anywhere carry this tag?" — e.g. the
 * `arweave-non-removable-account` chain-query safety net, which must find any
 * confirmed upload tagged `Codex-Encryptor: <address>` regardless of which
 * account actually paid for/signed it.
 *
 * UNLIKE `queryOwnerUploads`, this does NOT paginate — it issues exactly one
 * `pool.execute` POST for `opts.first` edges (default {@link
 * DEFAULT_TAG_QUERY_FIRST}, i.e. 1 — sized for an existence check, not a full
 * list). A caller that wants every matching upload must pass a larger
 * `opts.first` explicitly; this function never loops beyond that single page.
 *
 * Resolves `[]` for a well-formed, empty (zero-match) response — "no
 * matches" is never an error. Only a genuine network/gateway failure — a
 * non-2xx response, unparseable JSON, a malformed `transactions` shape, or
 * pool exhaustion — throws (rotating first, exactly like `queryOwnerUploads`
 * and `queryUploadById`).
 *
 * Order of operations mirrors `queryUploadById`: (0) origin-only pre-flight
 * over the pool's configured endpoints; (1) one `pool.execute` POST with
 * ONLY `tags`/`first` as GraphQL variables; (2) resolve the parsed records.
 */
export async function queryUploadsByTag(
  pool: GatewayPool,
  tagName: string,
  tagValue: string,
  opts?: QueryUploadsByTagOptions,
): Promise<OwnerUploadRecord[]> {
  const first = opts?.first ?? DEFAULT_TAG_QUERY_FIRST;
  const fetchFn = opts?.fetchFn ?? defaultFetch;

  // (0) origin-only pre-flight over ALL configured endpoints, before the first
  // pool attempt — same policy as queryOwnerUploads/queryUploadById.
  assertOriginOnlyEndpoints(pool.getHealthSnapshot().map((e) => e.endpoint));

  const page = await pool.execute<Page>(async function queryUploadsByTag(endpointBaseUrl, { signal }) {
    const url = joinUrl(endpointBaseUrl, "graphql");
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        query: QUERY_BY_TAG,
        variables: {
          tags: [{ name: tagName, values: [tagValue] }],
          first,
        },
      }),
    });

    if (!response.ok) {
      throw new InvalidGatewayResponseError(
        OPERATION_BY_TAG,
        endpointBaseUrl,
        `http-status-${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new InvalidGatewayResponseError(OPERATION_BY_TAG, endpointBaseUrl, "unparseable-json");
    }

    return parsePage(body, endpointBaseUrl, OPERATION_BY_TAG);
  });

  return page.records;
}
