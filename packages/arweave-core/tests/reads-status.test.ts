/**
 * reads-status.test.ts — transaction confirmation status/depth reads.
 *
 * `getTransactionStatus(pool, txId, opts?)` fetches `GET {endpoint}/tx/{txId}/status`
 * through the Phase 2 pool and maps VALID gateway answers to a discriminated
 * result:
 *   - HTTP 200 + JSON { block_height, block_indep_hash, number_of_confirmations }
 *     -> confirmed variant, plus `final = number_of_confirmations >= confirmationDepth`
 *   - HTTP 202 -> pending variant
 *   - HTTP 404 -> not-found variant (a legitimate answer for a fresh tx; resolves,
 *     does NOT rotate)
 * Any other status, or a 200 body failing shape validation, throws inside the op
 * so the pool rotates.
 */

import { describe, it, expect, vi } from "vitest";
import { createGatewayPool } from "../src/gateway/pool.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";
import {
  getTransactionStatus,
  DEFAULT_CONFIRMATION_DEPTH,
} from "../src/reads/status.js";
import {
  InvalidTransactionIdError,
  InvalidGatewayResponseError,
} from "../src/reads/errors.js";
import { UnsupportedEndpointError } from "../src/endpoints.js";

const instantSleep = async () => {};

const TXID = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CONFIRMED_BODY = {
  block_height: 1234567,
  block_indep_hash: "someIndepHashBase64Url",
  number_of_confirmations: 15,
};

describe("getTransactionStatus — txId pre-validation", () => {
  it("throws InvalidTransactionIdError for a malformed id without touching the pool", async () => {
    const fetchFn = vi.fn();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(
      getTransactionStatus(pool, "short", { fetchFn }),
    ).rejects.toThrow(InvalidTransactionIdError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("carries the offending txId in a structured field", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });
    try {
      await getTransactionStatus(pool, "bad id !!", { fetchFn: vi.fn() });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransactionIdError);
      expect((err as InvalidTransactionIdError).transactionId).toBe(
        "bad id !!",
      );
    }
  });
});

describe("getTransactionStatus — origin-only pre-flight", () => {
  it("surfaces UnsupportedEndpointError UNWRAPPED with ZERO pool attempts for a pathed endpoint", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(CONFIRMED_BODY));
    const pool = createGatewayPool({
      endpoints: ["https://gw.example/api"],
      sleep: instantSleep,
    });

    await expect(
      getTransactionStatus(pool, TXID, { fetchFn }),
    ).rejects.toThrow(UnsupportedEndpointError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("getTransactionStatus — status variant mapping", () => {
  it("maps HTTP 200 + valid body to a confirmed variant carrying the block fields", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(CONFIRMED_BODY));
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await getTransactionStatus(pool, TXID, { fetchFn });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") throw new Error("narrowing");
    expect(result.blockHeight).toBe(1234567);
    expect(result.blockIndepHash).toBe("someIndepHashBase64Url");
    expect(result.numberOfConfirmations).toBe(15);
  });

  it("maps HTTP 202 to a pending variant", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 202 }));
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await getTransactionStatus(pool, TXID, { fetchFn });
    expect(result.status).toBe("pending");
  });

  it("maps HTTP 404 to a not-found variant WITHOUT rotating (a legitimate fresh-tx answer)", async () => {
    const fetchFn = vi.fn(async () => new Response("Not Found", { status: 404 }));
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await getTransactionStatus(pool, TXID, { fetchFn });
    expect(result.status).toBe("not-found");
    // A valid answer resolves on the first endpoint — no rotation to B.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("getTransactionStatus — confirmation depth flips final", () => {
  it("final is false when confirmations are below the depth threshold", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ...CONFIRMED_BODY, number_of_confirmations: 9 }),
    );
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await getTransactionStatus(pool, TXID, {
      fetchFn,
      confirmationDepth: 10,
    });
    if (result.status !== "confirmed") throw new Error("expected confirmed");
    expect(result.final).toBe(false);
  });

  it("final is true when confirmations are AT the depth threshold", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ...CONFIRMED_BODY, number_of_confirmations: 10 }),
    );
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await getTransactionStatus(pool, TXID, {
      fetchFn,
      confirmationDepth: 10,
    });
    if (result.status !== "confirmed") throw new Error("expected confirmed");
    expect(result.final).toBe(true);
  });

  it("final is true when confirmations are ABOVE the depth threshold", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ ...CONFIRMED_BODY, number_of_confirmations: 50 }),
    );
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await getTransactionStatus(pool, TXID, {
      fetchFn,
      confirmationDepth: 10,
    });
    if (result.status !== "confirmed") throw new Error("expected confirmed");
    expect(result.final).toBe(true);
  });

  it("uses DEFAULT_CONFIRMATION_DEPTH (10) when no confirmationDepth option is given", async () => {
    expect(DEFAULT_CONFIRMATION_DEPTH).toBe(10);
    // 9 confirmations is below the default 10 -> not final.
    const belowFetch = vi.fn(async () =>
      jsonResponse({ ...CONFIRMED_BODY, number_of_confirmations: 9 }),
    );
    const poolBelow = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });
    const below = await getTransactionStatus(poolBelow, TXID, {
      fetchFn: belowFetch,
    });
    if (below.status !== "confirmed") throw new Error("expected confirmed");
    expect(below.final).toBe(false);

    // 10 confirmations meets the default -> final.
    const atFetch = vi.fn(async () =>
      jsonResponse({ ...CONFIRMED_BODY, number_of_confirmations: 10 }),
    );
    const poolAt = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });
    const at = await getTransactionStatus(poolAt, TXID, { fetchFn: atFetch });
    if (at.status !== "confirmed") throw new Error("expected confirmed");
    expect(at.final).toBe(true);
  });
});

describe("getTransactionStatus — pool rotation semantics", () => {
  it("retries on endpoint B after A returns HTTP 500 and resolves with B's answer", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://a.example"))
        return new Response("boom", { status: 500 });
      return jsonResponse(CONFIRMED_BODY);
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await getTransactionStatus(pool, TXID, { fetchFn });
    expect(result.status).toBe("confirmed");
  });

  it.each([
    ["negative confirmations", { ...CONFIRMED_BODY, number_of_confirmations: -1 }],
    ["fractional confirmations", { ...CONFIRMED_BODY, number_of_confirmations: 10.5 }],
    ["Infinity-ish confirmations", { ...CONFIRMED_BODY, number_of_confirmations: 1e400 }],
    ["negative block_height", { ...CONFIRMED_BODY, block_height: -5 }],
    ["empty block_indep_hash", { ...CONFIRMED_BODY, block_indep_hash: "" }],
  ])(
    "treats a 200 body with %s as garbage → rotation → exhaustion (a dishonest gateway cannot flip `final`)",
    async (_label, badBody) => {
      // number_of_confirmations drives the `final` finality decision, so a
      // non-negative-safe-integer value must NOT pass the shape gate — otherwise
      // a single dishonest gateway could send Infinity to forge final:true.
      const fetchFn = vi.fn(async () => jsonResponse(badBody));
      const pool = createGatewayPool({
        endpoints: ["https://a.example", "https://b.example"],
        maxAttemptsPerEndpoint: 1,
        sleep: instantSleep,
      });
      await expect(
        getTransactionStatus(pool, TXID, { fetchFn }),
      ).rejects.toBeInstanceOf(GatewayPoolExhaustedError);
    },
  );

  it("treats a malformed 200 JSON body as a rotation trigger, then exhausts", async () => {
    // A 200 with a body that fails shape validation must NOT resolve to a bogus
    // confirmed result — it throws inside the op so the pool rotates, then
    // exhausts across all endpoints.
    const fetchFn = vi.fn(async () =>
      jsonResponse({ block_height: "not-a-number" }),
    );
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await getTransactionStatus(pool, TXID, { fetchFn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    const attempts = (thrown as GatewayPoolExhaustedError).attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts[0].error).toBeInstanceOf(InvalidGatewayResponseError);
  });

  it("treats an unexpected HTTP status (e.g. 500 everywhere) as exhaustion, unwrapped", async () => {
    const fetchFn = vi.fn(async () => new Response("err", { status: 500 }));
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    await expect(
      getTransactionStatus(pool, TXID, { fetchFn }),
    ).rejects.toBeInstanceOf(GatewayPoolExhaustedError);
  });

  it("composes the per-endpoint URL correctly (no double slashes) for a trailing-slash endpoint", async () => {
    const seen: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      seen.push(String(input));
      return jsonResponse(CONFIRMED_BODY);
    });
    const pool = createGatewayPool({
      endpoints: ["https://arweave.net/"],
      sleep: instantSleep,
    });

    await getTransactionStatus(pool, TXID, { fetchFn });
    expect(seen[0]).toBe(`https://arweave.net/tx/${TXID}/status`);
    expect(seen[0]).not.toMatch(/\/\/tx/);
  });
});

describe("getTransactionStatus — default fetch seam is binding-safe and call-time resolved", () => {
  it("delegates to globalThis.fetch with the composed URL when no fetchFn is injected", async () => {
    const stub = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse(CONFIRMED_BODY),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const pool = createGatewayPool({
        endpoints: ["https://arweave.net"],
        sleep: instantSleep,
      });
      const result = await getTransactionStatus(pool, TXID);
      expect(result.status).toBe("confirmed");
      expect(stub).toHaveBeenCalledTimes(1);
      expect(String(stub.mock.calls[0][0])).toBe(
        `https://arweave.net/tx/${TXID}/status`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
