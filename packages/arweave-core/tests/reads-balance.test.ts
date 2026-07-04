/**
 * reads-balance.test.ts — address balance reads through the gateway pool.
 *
 * `getBalance(pool, address, opts?)` fetches `GET {endpoint}/wallet/{address}/balance`
 * through the Phase 2 pool and returns the Winston amount as a `bigint`. The
 * response body is raw text that MUST pass the strict `^\d+$` gate before
 * `BigInt(...)` (the Phase 2 lenient-BigInt lesson: `BigInt("")` -> 0n,
 * whitespace trimmed, `0x` accepted). Non-2xx and gate failures THROW inside the
 * pool operation so rotation/backoff engage.
 *
 * Tests use a REAL Phase 2 pool (multi-endpoint, injected instant sleep) plus an
 * injected fake fetch returning standard Response objects. No network, no module
 * mocking.
 */

import { describe, it, expect, vi } from "vitest";
import { createGatewayPool } from "../src/gateway/pool.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";
import { getBalance } from "../src/reads/balance.js";
import {
  InvalidAddressError,
  InvalidGatewayResponseError,
} from "../src/reads/errors.js";
import { UnsupportedEndpointError } from "../src/endpoints.js";

const instantSleep = async () => {};

/** A canonical 43-char base64url address (the fixture-independent shape gate). */
const ADDR = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("getBalance — address pre-validation (before any network call)", () => {
  it("throws InvalidAddressError for a too-short address without touching the pool", async () => {
    const fetchFn = vi.fn();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(getBalance(pool, "tooshort", { fetchFn })).rejects.toThrow(
      InvalidAddressError,
    );
    // Caller error must not burn a pool attempt.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("carries the offending address in a structured field (public, safe)", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });
    try {
      await getBalance(pool, "not-valid!!", { fetchFn: vi.fn() });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidAddressError);
      expect((err as InvalidAddressError).address).toBe("not-valid!!");
    }
  });
});

describe("getBalance — origin-only pre-flight", () => {
  it("surfaces UnsupportedEndpointError UNWRAPPED with ZERO pool attempts for a pathed endpoint", async () => {
    const fetchFn = vi.fn(async () => textResponse("0"));
    const pool = createGatewayPool({
      endpoints: ["https://gw.example/api"],
      sleep: instantSleep,
    });

    await expect(getBalance(pool, ADDR, { fetchFn })).rejects.toThrow(
      UnsupportedEndpointError,
    );
    // Pre-flight runs BEFORE the first pool attempt — fetch is never called.
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("getBalance — value parsing (strict amounts gate)", () => {
  it('parses "0" to 0n', async () => {
    const fetchFn = vi.fn(async () => textResponse("0"));
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(getBalance(pool, ADDR, { fetchFn })).resolves.toBe(0n);
  });

  it("parses a Winston amount beyond Number.MAX_SAFE_INTEGER to the exact bigint", async () => {
    // 66846281419287301199 > 2^53 — a Number() round-trip would lose precision;
    // bigint end-to-end preserves it exactly.
    const fetchFn = vi.fn(async () =>
      textResponse("66846281419287301199"),
    );
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(getBalance(pool, ADDR, { fetchFn })).resolves.toBe(
      66846281419287301199n,
    );
  });

  it("rejects the lenient-BigInt traps as InvalidGatewayResponseError (via rotation → exhaustion)", async () => {
    // Each trap would silently coerce through BigInt(): "" -> 0n, " 123" trimmed,
    // "1e3" and "0x10" accepted, a decimal is a non-integer amount. A single
    // endpoint returning any of them must NOT resolve to a wrong balance.
    const traps = ["", " 123", "1e3", "0x10", "12.5"];
    for (const trap of traps) {
      const fetchFn = vi.fn(async () => textResponse(trap));
      const pool = createGatewayPool({
        endpoints: ["https://a.example"],
        maxAttemptsPerEndpoint: 1,
        sleep: instantSleep,
      });
      // The gate throws inside the op -> pool rotates/exhausts -> terminal error
      // whose recorded attempt is the InvalidGatewayResponseError.
      let thrown: unknown;
      try {
        await getBalance(pool, ADDR, { fetchFn });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
      const attempt = (thrown as GatewayPoolExhaustedError).attempts[0];
      expect(attempt.error).toBeInstanceOf(InvalidGatewayResponseError);
    }
  });
});

describe("getBalance — pool rotation semantics", () => {
  it("retries on endpoint B after A returns HTTP 500 and resolves with B's answer", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://a.example")) return textResponse("boom", 500);
      return textResponse("42");
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    await expect(getBalance(pool, ADDR, { fetchFn })).resolves.toBe(42n);
  });

  it("rejects with GatewayPoolExhaustedError UNWRAPPED (per-endpoint attempts) when every endpoint fails", async () => {
    const fetchFn = vi.fn(async () => textResponse("down", 503));
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await getBalance(pool, ADDR, { fetchFn });
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

  it("composes the per-endpoint URL correctly (endpoint base + route, no double slashes)", async () => {
    const seen: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      seen.push(String(input));
      return textResponse("7");
    });
    // Trailing-slash endpoint — the composed URL must not produce a double slash.
    const pool = createGatewayPool({
      endpoints: ["https://arweave.net/"],
      sleep: instantSleep,
    });

    await getBalance(pool, ADDR, { fetchFn });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(`https://arweave.net/wallet/${ADDR}/balance`);
    expect(seen[0]).not.toMatch(/\/\/wallet/);
  });
});

describe("getBalance — default fetch seam is binding-safe and call-time resolved", () => {
  it("delegates to globalThis.fetch with the composed URL when no fetchFn is injected", async () => {
    const stub = vi.fn(async (_input: string | URL | Request) =>
      textResponse("5"),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const pool = createGatewayPool({
        endpoints: ["https://arweave.net"],
        sleep: instantSleep,
      });
      // No fetchFn: the default must resolve globalThis.fetch at CALL time (so a
      // stub installed after module load is honored) and invoke it bound.
      await expect(getBalance(pool, ADDR)).resolves.toBe(5n);
      expect(stub).toHaveBeenCalledTimes(1);
      expect(String(stub.mock.calls[0][0])).toBe(
        `https://arweave.net/wallet/${ADDR}/balance`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
