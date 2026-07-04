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
 */

import type { GatewayPool } from "../gateway/types.js";
import { assertOriginOnlyEndpoints } from "../endpoints.js";
import { isCanonicalAddress } from "../canonical.js";
import { InvalidAddressError, InvalidGatewayResponseError } from "../reads/errors.js";
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
 *  {@link InvalidGatewayResponseError} for any invalid shape so the pool rotates. */
function parsePage(body: unknown, endpointBaseUrl: string): Page {
  if (typeof body !== "object" || body === null) {
    throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "non-object-body");
  }

  const errors = (body as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "graphql-errors");
  }

  const edges = (body as { data?: { transactions?: { edges?: unknown } } })?.data
    ?.transactions?.edges;
  const pageInfo = (body as { data?: { transactions?: { pageInfo?: { hasNextPage?: unknown } } } })
    ?.data?.transactions?.pageInfo;
  if (!Array.isArray(edges) || typeof pageInfo?.hasNextPage !== "boolean") {
    throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "malformed-transactions-shape");
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
      throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "invalid-node-id");
    }
    if (!Array.isArray(node.tags)) {
      throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "invalid-node-tags");
    }
    const tags: Array<{ name: string; value: string }> = [];
    for (const tag of node.tags) {
      const t = tag as { name?: unknown; value?: unknown };
      if (typeof t.name !== "string" || typeof t.value !== "string") {
        throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "invalid-tag-shape");
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
      throw new InvalidGatewayResponseError(OPERATION, endpointBaseUrl, "no-progress");
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
