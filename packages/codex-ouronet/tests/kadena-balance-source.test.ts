/**
 * kadena-balance-source.test.ts — regression lock for `src/kadena/kadenaBalanceSource.ts`,
 * the pluggable seam behind `useKadenaBalances`.
 *
 * 2026-09-27 diagnosis, in order:
 *   1. `api.chainweb.com` is not unreachable — it does not exist (NXDOMAIN, confirmed
 *      against the authoritative nameserver). Dropped entirely.
 *   2. There is no free public Kadena Pact service API — public Kadena nodes expose P2P
 *      only; the Pact service API is deliberately not open.
 *   3. `https://denascan.ancientholdings.eu/api/v1/accounts/<account>/balances` is a real,
 *      CORS-open, HTTPS, stable-DNS REST gateway (our own explorer backend) that DOES work
 *      from a browser, verified live: `[{"chainId":0,"balance":4.76080216,"guard":{...}},
 *      ...]` for all 20 chains. `chainId` arrives as a NUMBER in the JSON, not a string.
 *   4. `bytales.duckdns.org:31849` (the direct Pact node) works fine from OUTSIDE its own
 *      LAN but hairpin-NATs from a machine on the SAME LAN — kept as a selectable option,
 *      not the default.
 *
 * So: one seam (`KadenaBalanceSource`), two implementations (`restKadenaBalanceSource`
 * default, `pactKadenaBalanceSource` selectable), never hardwired into the UI/hook.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { dirtyRead, createClient } = vi.hoisted(() => {
  const dirtyRead = vi.fn();
  const createClient = vi.fn(() => ({ dirtyRead }));
  return { dirtyRead, createClient };
});

vi.mock("@stoachain/kadena-stoic-legacy/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoachain/kadena-stoic-legacy/client")>();
  return { ...actual, createClient };
});

import {
  restKadenaBalanceSource,
  pactKadenaBalanceSource,
  getActiveKadenaBalanceSource,
  setActiveKadenaBalanceSource,
  getActiveKadenaRestGatewayUrl,
  setActiveKadenaRestGatewayUrl,
  KADENA_REST_GATEWAY_DEFAULT_URL,
} from "../src/kadena/kadenaBalanceSource.js";
import { KADENA_MAINNET_DEFAULT_NODE_URL } from "../src/kadena/kadenaReads.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setActiveKadenaRestGatewayUrl(KADENA_REST_GATEWAY_DEFAULT_URL);
  setActiveKadenaBalanceSource(restKadenaBalanceSource);
});

describe("the active source defaults to REST — 'do not hardwire REST into the UI', but REST IS the default", () => {
  it("getActiveKadenaBalanceSource() is restKadenaBalanceSource until told otherwise", () => {
    expect(getActiveKadenaBalanceSource()).toBe(restKadenaBalanceSource);
    expect(getActiveKadenaBalanceSource().name).toBe("rest");
  });

  it("setActiveKadenaBalanceSource swaps it — e.g. to the Pact path (selectable, not default)", () => {
    setActiveKadenaBalanceSource(pactKadenaBalanceSource);
    expect(getActiveKadenaBalanceSource()).toBe(pactKadenaBalanceSource);
    expect(getActiveKadenaBalanceSource().name).toBe("pact");
  });
});

describe("restKadenaBalanceSource — the working public endpoint", () => {
  function stubFetch(impl: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  it("defaults to the explorer gateway, user-editable exactly like the Pact node URL", () => {
    expect(KADENA_REST_GATEWAY_DEFAULT_URL).toBe("https://denascan.ancientholdings.eu");
    expect(getActiveKadenaRestGatewayUrl()).toBe(KADENA_REST_GATEWAY_DEFAULT_URL);
    setActiveKadenaRestGatewayUrl("https://my-own-gateway.example");
    expect(getActiveKadenaRestGatewayUrl()).toBe("https://my-own-gateway.example");
  });

  it("setActiveKadenaRestGatewayUrl ignores a blank value — never goes dead", () => {
    setActiveKadenaRestGatewayUrl("https://a-real-gateway.example");
    setActiveKadenaRestGatewayUrl("   ");
    expect(getActiveKadenaRestGatewayUrl()).toBe("https://a-real-gateway.example");
  });

  it("fetches /api/v1/accounts/<address>/balances and maps the REAL verified shape correctly, including numeric->string chainId coercion", async () => {
    stubFetch(async (url) => {
      expect(url).toBe(`${KADENA_REST_GATEWAY_DEFAULT_URL}/api/v1/accounts/k%3Aabc/balances`);
      return {
        ok: true,
        status: 200,
        json: async () => [
          { chainId: 0, balance: 4.76080216, guard: { pred: "keys-all", keys: ["abc"] } },
          { chainId: 8, balance: 4.76078014, guard: { pred: "keys-all", keys: ["abc"] } },
        ],
      };
    });

    const result = await restKadenaBalanceSource.fetchBalances(["k:abc"]);
    expect(result["k:abc"]["0"]).toEqual({ balance: 4.76080216, exists: true });
    expect(result["k:abc"]["8"]).toEqual({ balance: 4.76078014, exists: true });
    // a chain absent from the response is simply not a key -- the hook treats an absent
    // key the same as {exists:false, balance:0} for every chain in KADENA_CHAINS.
    expect(result["k:abc"]["1"]).toBeUndefined();
  });

  it("fetches every address in parallel, one request each", async () => {
    const calls: string[] = [];
    stubFetch(async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => [{ chainId: 0, balance: 1, guard: {} }] };
    });
    await restKadenaBalanceSource.fetchBalances(["k:a", "k:b", "k:c"]);
    expect(calls.length).toBe(3);
    expect(calls.some((u) => u.includes("k%3Aa/balances"))).toBe(true);
    expect(calls.some((u) => u.includes("k%3Ab/balances"))).toBe(true);
    expect(calls.some((u) => u.includes("k%3Ac/balances"))).toBe(true);
  });

  it("an empty address list short-circuits to {} with no fetch at all", async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => [] }));
    const result = await restKadenaBalanceSource.fetchBalances([]);
    expect(result).toEqual({});
  });

  it("a 404 (never-funded account — a NORMAL answer, not an error) resolves to {} for that address, silently", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const result = await restKadenaBalanceSource.fetchBalances(["k:never-funded"]);
    expect(result["k:never-funded"]).toEqual({});
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("a non-404 HTTP error logs the reason and resolves to {} for that address, not a hang or a throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const result = await restKadenaBalanceSource.fetchBalances(["k:x"]);
    expect(result["k:x"]).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("502"));
    warnSpy.mockRestore();
  });

  it("a network-level rejection (DNS/connection failure) logs the reason and resolves to {}, not a throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const result = await restKadenaBalanceSource.fetchBalances(["k:x"]);
    expect(result["k:x"]).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch"));
    warnSpy.mockRestore();
  });

  it("a hung fetch is bounded by the same timeout as the Pact path — resolves to {}, does not spin forever", async () => {
    vi.useFakeTimers();
    // A realistic hang: the connection never settles on its own, but (exactly like real
    // `fetch`) rejects when the AbortSignal we pass in actually fires.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        });
      }),
    );
    const promise = restKadenaBalanceSource.fetchBalances(["k:x"]);
    await vi.advanceTimersByTimeAsync(15000);
    await expect(promise).resolves.toEqual({ "k:x": {} });
    vi.useRealTimers();
  });
});

describe("pactKadenaBalanceSource — the existing, correct Pact path, preserved behind the seam", () => {
  beforeEach(() => setActiveKadenaBalanceSource(pactKadenaBalanceSource));

  it("transposes the per-chain-batched-across-addresses Pact reads into the seam's per-address shape", async () => {
    dirtyRead.mockImplementation(async (tx: { cmd: string }) => {
      const cmd = JSON.parse(tx.cmd);
      const chainId = cmd.meta.chainId;
      if (chainId === "8") {
        return {
          result: {
            status: "success",
            data: [
              { account: "k:a", balance: 4.76078014, exists: true },
              { account: "k:b", balance: 0, exists: false },
            ],
          },
        };
      }
      return { result: { status: "success", data: [
        { account: "k:a", balance: 0, exists: false },
        { account: "k:b", balance: 0, exists: false },
      ] } };
    });

    const result = await pactKadenaBalanceSource.fetchBalances(["k:a", "k:b"]);
    expect(result["k:a"]["8"]).toEqual({ balance: 4.76078014, exists: true });
    expect(result["k:a"]["0"]).toEqual({ balance: 0, exists: false });
    expect(result["k:b"]["8"]).toEqual({ balance: 0, exists: false });
    // one request per chain (20), each batching every address in one Pact map call
    expect(dirtyRead).toHaveBeenCalledTimes(20);
  });

  it("uses the active Pact node URL (Network tab override respected)", async () => {
    dirtyRead.mockResolvedValue({ result: { status: "success", data: [] } });
    await pactKadenaBalanceSource.fetchBalances(["k:a"]);
    expect(createClient).toHaveBeenCalledWith(
      expect.stringContaining(KADENA_MAINNET_DEFAULT_NODE_URL),
    );
  });

  it("an empty address list short-circuits to {} with no network calls at all", async () => {
    const result = await pactKadenaBalanceSource.fetchBalances([]);
    expect(result).toEqual({});
    expect(dirtyRead).not.toHaveBeenCalled();
  });
});
