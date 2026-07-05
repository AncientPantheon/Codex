/**
 * Shared E3 RED-matrix test helpers.
 *
 * E3 has TWO disjoint injection seams (never interchange them):
 *   - the UPLOAD seam is `UploadOptions.clientFactory` (a fake `TurboUploadClient`
 *     whose `upload({ data, dataItemOpts })` records the call and returns an id);
 *   - the STATUS / REBUILD seam is `fetchFn` (a `typeof fetch` returning a
 *     Response-shaped object) forwarded to arweave-core `getTransactionStatus` /
 *     `queryOwnerUploads`.
 *
 * The GatewayPool fakes here are richer than E2's: E3's `openUrl` reads the
 * per-endpoint `healthy`/`active` flags off `getHealthSnapshot()`, so the pool
 * fake advertises the full `EndpointHealth` shape (E2's `makeSingleEndpointPool`
 * omitted the flags).
 *
 * The throwaway JWK is E1's committed, NEVER-funded fixture — reused verbatim so
 * the upload owner-address anchor is the known 43-char constant.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type {
  ArweaveJwk,
  Tag,
  TurboUploadClient,
  EndpointHealth,
  GatewayPool,
} from "@ancientpantheon/arweave-core";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** The E1 throwaway JWK (canonical 9-field RSA-4096). NEVER funded. */
export const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

/** The throwaway fixture's KNOWN deterministic 43-char address — the Codex-Owner
 *  anchor the rebuild filter keys on. */
export const KNOWN_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

/** The frozen OwnerUploadRecord[] rebuild fixture — PUBLIC tag data ONLY. */
export const ownerUploadRecords = JSON.parse(
  readFileSync(join(FIXTURES, "e3-owner-upload-records.json"), "utf8"),
) as ReadonlyArray<{ id: string; tags: ReadonlyArray<Tag> }>;

/** A second canonical 43-char base64url id — structurally valid, never real. */
export const CANONICAL_ID_A = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";
/** A third canonical 43-char id (lexicographically LATER than CANONICAL_ID_A —
 *  drives the secondary `id` tiebreak assertions). */
export const CANONICAL_ID_B = "ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKkJjIiHhGgFfE";
/** A non-canonical id (wrong length) — must be rejected before any compose/upload. */
export const NON_CANONICAL_ID = "not-a-canonical-arweave-id";

export const MANIFEST_CONTENT_TYPE = "application/x.arweave-manifest+json";

/** A recording fake `TurboUploadClient`: captures the `{ data, dataItemOpts }`
 *  of every `upload` call and returns the configured id. A `throws` flag makes
 *  the client reject (the `upload-rejected` path). */
export interface RecordingTurboClient {
  factory: (jwk: ArweaveJwk) => TurboUploadClient;
  calls: Array<{ data: string | Uint8Array; tags: Tag[]; jwk: ArweaveJwk }>;
}

export function makeRecordingTurboClient(
  opts: { id?: string; throws?: boolean } = {},
): RecordingTurboClient {
  const { id = CANONICAL_ID_A, throws = false } = opts;
  const calls: RecordingTurboClient["calls"] = [];
  const factory = (jwk: ArweaveJwk): TurboUploadClient => ({
    upload: async (p) => {
      calls.push({ data: p.data, tags: p.dataItemOpts.tags, jwk });
      if (throws) {
        throw new Error("turbo upload rejected");
      }
      return { id };
    },
  });
  return { factory, calls };
}

/** A fake `fetchFn` (a `typeof fetch`) returning a fixed status + body — the
 *  READS/REBUILD seam. Mirrors E2's `makeFetchFn`. */
export function makeFetchFn(status: number, body: unknown): typeof fetch {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return (async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  })) as unknown as typeof fetch;
}

/** A well-formed confirmed-status body with the given confirmation count. */
export function confirmedBody(numberOfConfirmations: number) {
  return {
    block_height: 1_000_000,
    block_indep_hash: "z".repeat(64),
    number_of_confirmations: numberOfConfirmations,
  };
}

/** A GraphQL rebuild response body wrapping the given OwnerUploadRecord-shaped
 *  edges into the `data.transactions` shape `queryOwnerUploads` parses. Single
 *  page (no next cursor). */
export function graphqlRebuildBody(
  records: ReadonlyArray<{ id: string; tags: ReadonlyArray<Tag> }>,
) {
  return {
    data: {
      transactions: {
        pageInfo: { hasNextPage: false },
        edges: records.map((r) => ({
          cursor: `cursor-${r.id}`,
          node: { id: r.id, tags: r.tags },
        })),
      },
    },
  };
}

const DEFAULT_ENDPOINT = "https://gateway-a.example";

/** A `GatewayPool` fake with configurable per-endpoint health. `execute` runs
 *  the operation against the first endpoint (no rotation); `getHealthSnapshot`
 *  advertises the full `EndpointHealth` shape (endpoint/healthy/active) so
 *  `openUrl`'s healthy-selection rule is exercised; `getActiveEndpoint` returns
 *  the endpoint flagged `active` (or the first). */
export function makeHealthPool(
  endpoints: ReadonlyArray<EndpointHealth> = [
    { endpoint: DEFAULT_ENDPOINT, healthy: true, active: true },
  ],
): GatewayPool {
  const active = endpoints.find((e) => e.active) ?? endpoints[0];
  return {
    execute: async <T>(
      op: (
        endpoint: string,
        ctx: { signal: AbortSignal },
      ) => Promise<T>,
    ): Promise<T> =>
      op(endpoints[0].endpoint, { signal: new AbortController().signal }),
    getHealthSnapshot: () => endpoints,
    getActiveEndpoint: () => active.endpoint,
  } as GatewayPool;
}

/** An InternalCodexResolver-shaped sentinel: any invocation is a Critical N-05
 *  isolation breach (the E3 flows must NEVER touch the Kadena resolver). */
export function makeKadenaSentinel() {
  const throwTouch = () => {
    throw new Error("Kadena resolver was touched");
  };
  return {
    resolvePrivateKey: throwTouch,
    smartDecrypt: throwTouch,
    requestForeignKey: throwTouch,
  };
}
