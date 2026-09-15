/**
 * reads-fee.test.ts — Winston price-quote reads through the gateway pool.
 *
 * `estimateFee(pool, byteSize, target, opts?)` fetches a reward (fee) quote in
 * Winston for a `byteSize`-byte transfer to `target`, through the Phase 2 pool,
 * and returns it as a `bigint`. This is the SAME "fetch and validate a Winston
 * price quote through the pool" logic `tx/transfer.ts`'s `sendTransfer` used to
 * keep inline (lines ~197-210) — extracted here so there is exactly one
 * implementation, reused by both `sendTransfer` (via `opts.getPrice`, threaded
 * from its own test-injectable `apiFactory`) and any standalone caller.
 *
 * The raw response MUST pass the strict `^\d+$` gate before `BigInt(...)` (the
 * Phase 2 lenient-BigInt lesson: `BigInt("")` -> 0n, whitespace trimmed, `0x`/
 * `1e3` accepted). A gate-failing quote throws `InvalidGatewayPriceError`
 * INSIDE the pool operation so the pool rotates.
 *
 * Tests use a REAL Phase 2 pool (multi-endpoint, injected instant sleep) plus
 * an injected fake `getPrice` seam of plain functions — mirroring
 * `reads-balance.test.ts`'s fake-`fetchFn` structure, no network, no
 * arweave-js network objects.
 */

import { describe, it, expect, vi } from "vitest";
import { createGatewayPool } from "../src/gateway/pool.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";
import { estimateFee } from "../src/reads/fee.js";
import { InvalidGatewayPriceError } from "../src/tx/errors.js";

const instantSleep = async () => {};

/** A canonical 43-char base64url target (the fixture-independent shape gate). */
const TARGET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);
const BYTE_SIZE = 0;

describe("estimateFee — successful quote", () => {
  it("resolves the Winston price as a bigint via the injected getPrice seam", async () => {
    const getPrice = vi.fn(async () => "1000000000");
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(
      estimateFee(pool, BYTE_SIZE, TARGET, { getPrice }),
    ).resolves.toBe(1000000000n);
    expect(getPrice).toHaveBeenCalledWith("https://a.example", BYTE_SIZE, TARGET);
  });

  it("parses a Winston amount beyond Number.MAX_SAFE_INTEGER to the exact bigint", async () => {
    // 66846281419287301199 > 2^53 — a Number() round-trip would lose precision;
    // bigint end-to-end preserves it exactly.
    const getPrice = vi.fn(async () => "66846281419287301199");
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(estimateFee(pool, BYTE_SIZE, TARGET, { getPrice })).resolves.toBe(
      66846281419287301199n,
    );
  });
});

describe("estimateFee — malformed quote", () => {
  it("rejects the lenient-BigInt traps as InvalidGatewayPriceError (via rotation → exhaustion)", async () => {
    // Each trap would silently coerce through BigInt(): "" -> 0n, " 123" trimmed,
    // "1e3" and "0x10" accepted, a decimal is a non-integer amount. A single
    // endpoint returning any of them must NOT resolve to a wrong reward.
    const traps = ["", " 123", "1e3", "0x10", "12.5"];
    for (const trap of traps) {
      const getPrice = vi.fn(async () => trap);
      const pool = createGatewayPool({
        endpoints: ["https://a.example"],
        maxAttemptsPerEndpoint: 1,
        sleep: instantSleep,
      });

      let thrown: unknown;
      try {
        await estimateFee(pool, BYTE_SIZE, TARGET, { getPrice });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
      const attempt = (thrown as GatewayPoolExhaustedError).attempts[0];
      expect(attempt.error).toBeInstanceOf(InvalidGatewayPriceError);
    }
  });
});

describe("estimateFee — pool rotation semantics", () => {
  it("rotates to endpoint B's honest quote after A's gate-failing quote", async () => {
    const getPrice = vi.fn(async (endpoint: string) => {
      if (endpoint === "https://a.example") return "1e3";
      return "1000000000";
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    await expect(estimateFee(pool, BYTE_SIZE, TARGET, { getPrice })).resolves.toBe(
      1000000000n,
    );
    expect(getPrice).toHaveBeenCalledWith("https://a.example", BYTE_SIZE, TARGET);
    expect(getPrice).toHaveBeenCalledWith("https://b.example", BYTE_SIZE, TARGET);
  });

  it("rejects with GatewayPoolExhaustedError UNWRAPPED (per-endpoint attempts) when every endpoint fails", async () => {
    const getPrice = vi.fn(async () => {
      throw new Error("ECONNRESET — simulated network failure");
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await estimateFee(pool, BYTE_SIZE, TARGET, { getPrice });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    const attempts = (thrown as GatewayPoolExhaustedError).attempts;
    expect(attempts.map((a) => a.endpoint)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});
