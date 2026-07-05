/**
 * Shared E2 RED-matrix test helpers.
 *
 * These build the two arweave-core injection seams as PLAIN FAKES so every
 * signer/send/read test runs with ZERO real network and ZERO real funds:
 *   - the SEND seam is `opts.apiFactory` (a per-endpoint `getAnchor`/`getPrice`/
 *     `postTransaction` trio);
 *   - the READ seam is `opts.fetchFn` (a `typeof fetch` returning a Response-
 *     shaped object).
 * The two are NOT interchangeable — a send test injects an apiFactory, a
 * balance/status test injects a fetchFn (the seam-discipline contract).
 *
 * The throwaway JWK is E1's committed, NEVER-funded fixture — reused verbatim.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { ArweaveJwk } from "@ancientpantheon/arweave-core";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** The E1 throwaway JWK (canonical 9-field RSA-4096). NEVER funded. */
export const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

/** The throwaway fixture's KNOWN deterministic 43-char address. */
export const KNOWN_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

/** A second canonical 43-char base64url target (recipient) — structurally valid,
 *  never a real recipient (tests never post to a live gateway). */
export const CANONICAL_TARGET = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";

/** The default origin-only endpoint the fake pool advertises. arweave-core's
 *  origin-only pre-flight scans `pool.getHealthSnapshot()` — a pathed endpoint
 *  would fail it before the seam is ever exercised. */
export const ENDPOINT_A = "https://gateway-a.example";
export const ENDPOINT_B = "https://gateway-b.example";

/**
 * A minimal `GatewayPool` fake: `execute` runs the operation against ONE fixed
 * endpoint (no rotation — rotation is exercised separately with a real pool),
 * `getHealthSnapshot` advertises an origin-only endpoint so the pre-flight
 * passes. Not a real pool; just enough surface for `sendTransfer`/reads.
 */
export function makeSingleEndpointPool(endpoint = ENDPOINT_A) {
  return {
    execute: async <T>(
      op: (endpoint: string, ctx: { signal: AbortSignal }) => Promise<T>,
    ): Promise<T> => op(endpoint, { signal: new AbortController().signal }),
    getHealthSnapshot: () => [{ endpoint }],
    getActiveEndpoint: () => endpoint,
  };
}

/** Options for {@link makeFakeApiFactory}. */
export interface FakeApiFactoryConfig {
  /** The anchor (`last_tx`) each endpoint returns. */
  anchor?: string;
  /** The reward quote (Winston decimal string) each endpoint returns. */
  price?: string;
  /** The HTTP status the post returns (2xx = success). */
  postStatus?: number;
}

/**
 * A spied fake `TransferGatewayApiFactory`: records every getAnchor/getPrice/
 * postTransaction call so a test can assert WHICH steps ran (e.g. the fee-cap
 * row asserts post was never reached). One shared call-log across endpoints.
 */
export function makeFakeApiFactory(config: FakeApiFactoryConfig = {}) {
  const {
    anchor = "anchor-last-tx",
    price = "1000",
    postStatus = 200,
  } = config;
  const calls = {
    getAnchor: 0,
    getPrice: 0,
    postTransaction: 0,
    postedTxIds: [] as string[],
  };
  const apiFactory = (_endpoint: string) => ({
    getAnchor: async () => {
      calls.getAnchor += 1;
      return anchor;
    },
    getPrice: async (_byteSize: number, _target: string) => {
      calls.getPrice += 1;
      return price;
    },
    postTransaction: async (tx: { id: string }) => {
      calls.postTransaction += 1;
      calls.postedTxIds.push(tx.id);
      return { status: postStatus, statusText: postStatus === 200 ? "OK" : "ERR" };
    },
  });
  return { apiFactory, calls };
}

/**
 * A fake `fetchFn` (a `typeof fetch`) that returns a Response-shaped object for
 * the READS path (balance/status). The status + body are fixed per call.
 */
export function makeFetchFn(
  status: number,
  body: unknown,
): typeof fetch {
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
