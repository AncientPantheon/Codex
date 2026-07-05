/**
 * E2 RED matrix — balance-as-display + confirmation status (E-05).
 *
 * SHAPE-DRIVES T12.4's `src/adapter/status.ts` sibling surface. Balance stays a
 * base-unit `bigint` on the adapter (E1's `getBalance`, unchanged); E2 adds a
 * DISPLAY helper that converts via arweave-core `winstonToAr` (a SIBLING, not a
 * D3 contract method), and a confirmation-status read via arweave-core
 * `getTransactionStatus` over the pool with an injected `fetchFn`.
 *
 * RESOLVED SHAPES (pinned here for T12.4):
 *   - `arweaveBalanceAsAr(pool, address, opts?): Promise<string>` — a thin
 *     compose of `getBalance` (bigint) → `winstonToAr` (exact AR string).
 *   - `arweaveTransactionStatus(pool, txId, opts?): Promise<TransactionStatus>`
 *     — a thin delegate to arweave-core `getTransactionStatus`.
 * Both live in `src/adapter/status.ts`, re-exported from `../src/adapter`.
 *
 * SEAM DISCIPLINE: the READS path injects `opts.fetchFn` (a `typeof fetch`), NOT
 * `opts.apiFactory` (that is the SEND seam). Every read here uses a fake fetchFn
 * returning a Response-shaped object — zero real network.
 *
 * FINALITY: `final = numberOfConfirmations >= confirmationDepth` — the boundary
 * is INCLUSIVE (an implementer must not read it as `>`).
 */

import { describe, it, expect } from "vitest";

import {
  winstonToAr,
  DEFAULT_CONFIRMATION_DEPTH,
} from "@ancientpantheon/arweave-core";

import {
  arweaveBalanceAsAr,
  arweaveTransactionStatus,
  createArweaveAdapter,
} from "../src/adapter";
import {
  KNOWN_ADDRESS,
  CANONICAL_TARGET,
  throwawayJwk,
  makeSingleEndpointPool,
  makeFakeApiFactory,
  makeFetchFn,
  confirmedBody,
} from "./e2-helpers";

describe("balance-as-display — winstonToAr exact conversion (E-05, N-10)", () => {
  it("winstonToAr renders base-unit winston as an EXACT AR string (no scientific notation)", () => {
    // The exact display invariant E2 surfaces.
    expect(winstonToAr(1_500_000_000_000n)).toBe("1.5");
    expect(winstonToAr(1n)).toBe("0.000000000001");
    expect(winstonToAr(0n)).toBe("0");
  });

  it("arweaveBalanceAsAr composes getBalance (winston bigint) → winstonToAr display", async () => {
    // getBalance returns 1_500_000_000_000 winston → "1.5" AR.
    const pool = makeSingleEndpointPool();
    const fetchFn = makeFetchFn(200, "1500000000000");

    const display = await arweaveBalanceAsAr(pool as never, KNOWN_ADDRESS, { fetchFn });

    expect(display).toBe("1.5");
  });
});

describe("confirmation status — pending vs final via getTransactionStatus (E-05)", () => {
  it("HTTP 202 → pending", async () => {
    const status = await arweaveTransactionStatus(
      makeSingleEndpointPool() as never,
      KNOWN_ADDRESS,
      { fetchFn: makeFetchFn(202, "") },
    );
    expect(status.status).toBe("pending");
  });

  it("HTTP 404 → not-found (resolves; does NOT rotate/exhaust the pool)", async () => {
    let executeCalls = 0;
    const pool = {
      ...makeSingleEndpointPool(),
      execute: async <T>(
        op: (endpoint: string, ctx: { signal: AbortSignal }) => Promise<T>,
      ): Promise<T> => {
        executeCalls += 1;
        return op("https://gateway-a.example", { signal: new AbortController().signal });
      },
    };

    const status = await arweaveTransactionStatus(pool as never, KNOWN_ADDRESS, {
      fetchFn: makeFetchFn(404, ""),
    });

    expect(status.status).toBe("not-found");
    // A 404 resolves on the first gateway — no rotation, one execute call.
    expect(executeCalls).toBe(1);
  });

  it("HTTP 200 with confirmations BELOW the default depth → confirmed, final:false", async () => {
    const status = await arweaveTransactionStatus(
      makeSingleEndpointPool() as never,
      KNOWN_ADDRESS,
      { fetchFn: makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH - 1)) },
    );
    expect(status.status).toBe("confirmed");
    if (status.status === "confirmed") {
      expect(status.numberOfConfirmations).toBe(DEFAULT_CONFIRMATION_DEPTH - 1);
      expect(status.final).toBe(false);
    }
  });

  it("HTTP 200 with confirmations EXACTLY AT the default depth → final:true (inclusive >= boundary)", async () => {
    const status = await arweaveTransactionStatus(
      makeSingleEndpointPool() as never,
      KNOWN_ADDRESS,
      { fetchFn: makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH)) },
    );
    expect(status.status).toBe("confirmed");
    if (status.status === "confirmed") {
      // The boundary is inclusive: === depth ⇒ final. NOT `>`.
      expect(status.final).toBe(true);
    }
  });

  it("a TUNED confirmationDepth flips final at the tuned boundary", async () => {
    const pool = makeSingleEndpointPool();

    const belowTuned = await arweaveTransactionStatus(pool as never, KNOWN_ADDRESS, {
      fetchFn: makeFetchFn(200, confirmedBody(2)),
      confirmationDepth: 3,
    });
    const atTuned = await arweaveTransactionStatus(pool as never, KNOWN_ADDRESS, {
      fetchFn: makeFetchFn(200, confirmedBody(3)),
      confirmationDepth: 3,
    });

    expect(belowTuned.status === "confirmed" && belowTuned.final).toBe(false);
    expect(atTuned.status === "confirmed" && atTuned.final).toBe(true);
  });
});

describe("COMPOSED send → final (E-05 success criterion: a send's txid reaches final depth)", () => {
  it("pipes a successful send's TransferResult.id into getTransactionStatus and reaches final:true", async () => {
    const pool = makeSingleEndpointPool();
    const adapter = createArweaveAdapter({ pool: pool as never });

    // 1) Send via the SEND seam (fake apiFactory), reaching a signed+posted result.
    const { apiFactory } = makeFakeApiFactory({ price: "5000000000", postStatus: 200 });
    const built = await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    });
    const result = (await adapter.post(built, throwawayJwk, { apiFactory })) as {
      id: string;
    };

    // 2) Poll that exact txid via the READS seam (fake fetchFn) at >= depth.
    const status = await arweaveTransactionStatus(pool as never, result.id, {
      fetchFn: makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH)),
    });

    expect(status.status).toBe("confirmed");
    if (status.status === "confirmed") {
      expect(status.final).toBe(true);
    }
  });
});
