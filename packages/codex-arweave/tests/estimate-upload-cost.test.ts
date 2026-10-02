// @vitest-environment node
/**
 * estimate-upload-cost.test.ts — T1 (arweave-upload-wizard Wave 1).
 *
 * `estimateUploadCostAr` is a THIN wrapper around arweave-core's
 * `estimateFee` + `winstonToAr` — no new price-quote logic of its own. Tests
 * mirror `packages/arweave-core/tests/reads-fee.test.ts`'s own fee-quote
 * test-fake convention: a REAL Phase 2 pool (single endpoint, injected
 * instant sleep) plus an injected fake `getPrice` seam, no network.
 *
 * The one behavior worth guarding here is the SEAM, not arithmetic that
 * already has its own test coverage in arweave-core: given a fake quote,
 * does the wrapper (a) resolve the Winston bigint unmodified and (b) produce
 * its `ar` field via `winstonToAr` itself (never a second, reimplemented
 * conversion) — and does it still work with no `target` (the byte-size-only,
 * no-recipient case a data upload needs, exactly like `estimateFee`'s own
 * optional-target behavior).
 */

import { describe, it, expect, vi } from "vitest";
import { createGatewayPool, winstonToAr } from "@ancientpantheon/arweave-core";

import { estimateUploadCostAr } from "../src/panel/estimateUploadCost.js";

const instantSleep = async () => {};

/** A canonical 43-char base64url target (the fixture-independent shape gate). */
const TARGET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);
const BYTE_SIZE = 12345;

describe("estimateUploadCostAr — given a fake price quote", () => {
  it("resolves { winston, ar } where ar is exactly winstonToAr(winston)'s own output", async () => {
    // Regression this guards: a hand-rolled AR string (instead of delegating
    // to winstonToAr) would silently drift from the shared conversion (wrong
    // decimal placement, trailing zeros, etc.) the moment either diverges.
    const getPrice = vi.fn(async () => "66846281419287301199");
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await estimateUploadCostAr(pool, BYTE_SIZE, {
      target: TARGET,
      getPrice,
    });

    expect(result.winston).toBe(66846281419287301199n);
    expect(result.ar).toBe(winstonToAr(66846281419287301199n));
    expect(getPrice).toHaveBeenCalledWith("https://a.example", BYTE_SIZE, TARGET);
  });

  it("still resolves a quote when target is omitted (byte-size-only, no recipient)", async () => {
    // Regression this guards: a data upload has no transfer recipient — if
    // the wrapper required `target` (or failed to forward `undefined`
    // through to estimateFee) a plain upload-cost estimate would break.
    const getPrice = vi.fn(async () => "1000000000");
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await estimateUploadCostAr(pool, BYTE_SIZE, { getPrice });

    expect(result.winston).toBe(1000000000n);
    expect(result.ar).toBe(winstonToAr(1000000000n));
    expect(getPrice).toHaveBeenCalledWith("https://a.example", BYTE_SIZE, undefined);
  });
});
