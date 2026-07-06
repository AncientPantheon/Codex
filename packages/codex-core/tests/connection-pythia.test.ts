/**
 * RED contract tests for `createPythiaConnection` (CL-02).
 *
 * The Pythia connection is a thin, KEYLESS REST client mirroring the Pythia
 * gateway wire surface (verified against the Pythia repo's routes):
 *   - read  → POST {baseUrl}/{chainId}/read
 *   - send  → POST {baseUrl}/{chainId}/send  (broadcast of caller-SIGNED cmds)
 *   - poll  → POST {baseUrl}/{chainId}/poll
 *   - health→ GET  {baseUrl}/healthz
 *
 * codex-core does NOT depend on `@ancientpantheon/pythia-client`; it mirrors the
 * REST shape so the leaf package stays free of a cross-repo dependency. Tests
 * inject a FAKE fetch — no real network is ever touched.
 *
 * COVERAGE assumption (documented): the Pythia `/healthz` snapshot does not (yet)
 * carry an explicit chain list, so `health().coveredChains` is derived
 * tolerantly: an explicit `coveredChains`/`chains` array on the body is honoured
 * verbatim if present; otherwise, when the service reports live
 * (`service === "ok"` or `reachable === true`), coverage falls back to the single
 * `chainId` this connection was configured for. Coverage is READ from the
 * response — never a fixed hardcoded chain list.
 *
 * RED: imports from `../src/connection/index.js`, which does not exist yet.
 */

import { describe, it, expect } from "vitest";
import { createPythiaConnection, type FetchLike } from "../src/connection/index.js";

/** A captured fetch call for URL/method/body assertions. */
interface Captured {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Build a fake fetch (a `FetchLike`) that records every call and returns a canned
 * JSON body. Mirrors the subset of the Response contract the connection consumes.
 */
function fakeFetch(
  responder: (url: string) => { status?: number; json: unknown },
): { fetchFn: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const { status = 200, json } = responder(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    };
  };
  return { fetchFn, calls };
}

describe("createPythiaConnection (CL-02)", () => {
  it("read POSTs to {baseUrl}/{chainId}/read with the query as the JSON body and returns the node response verbatim", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ json: { result: "read-ok" } }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test",
      chainId: "stoachain",
      fetchFn,
    });

    const result = await conn.read({ code: "(coin.details \"alice\")" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://pythia.test/stoachain/read");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ code: "(coin.details \"alice\")" });
    expect(result).toEqual({ result: "read-ok" });
  });

  it("send POSTs the caller-signed tx to {baseUrl}/{chainId}/send and returns the node response verbatim", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ json: { requestKeys: ["rk1"] } }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test",
      chainId: "stoachain",
      fetchFn,
    });

    const result = await conn.send({ cmds: ["signed-cmd"] });

    expect(calls[0].url).toBe("https://pythia.test/stoachain/send");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ cmds: ["signed-cmd"] });
    expect(result).toEqual({ requestKeys: ["rk1"] });
  });

  it("poll POSTs to {baseUrl}/{chainId}/poll and maps a pending status into a ConnectionPollResult", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({
      json: { results: { rk1: { status: "pending", depth: 0 } } },
    }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test",
      chainId: "stoachain",
      fetchFn,
    });

    const result = await conn.poll({ requestKeys: ["rk1"] });

    expect(calls[0].url).toBe("https://pythia.test/stoachain/poll");
    expect(calls[0].method).toBe("POST");
    expect(result.status).toBe("pending");
    expect(result.detail).toEqual({ results: { rk1: { status: "pending", depth: 0 } } });
  });

  it("poll reports final when every request key is final", async () => {
    const { fetchFn } = fakeFetch(() => ({
      json: { results: { rk1: { status: "final", depth: 5 } } },
    }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test",
      chainId: "stoachain",
      fetchFn,
    });

    const result = await conn.poll({ requestKeys: ["rk1"] });
    expect(result.status).toBe("final");
  });

  it("health GETs {baseUrl}/healthz and honours an explicit coveredChains array from the body verbatim", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({
      json: { service: "ok", coveredChains: ["stoachain", "kadena"] },
    }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test",
      chainId: "stoachain",
      fetchFn,
    });

    const health = await conn.health();

    expect(calls[0].url).toBe("https://pythia.test/healthz");
    expect(calls[0].method).toBe("GET");
    expect(health.reachable).toBe(true);
    expect(health.coveredChains).toEqual(["stoachain", "kadena"]);
  });

  it("health falls back to the configured chainId when the healthz body advertises no explicit chain list but reports service ok", async () => {
    const { fetchFn } = fakeFetch(() => ({
      json: {
        service: "ok",
        active: { sourceId: "s1", url: "u" },
        routing: "primary",
        sources: [{ id: "s1", url: "u", role: "primary", reachable: true }],
      },
    }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test",
      chainId: "stoachain",
      fetchFn,
    });

    const health = await conn.health();

    // No explicit list on the snapshot → coverage is the configured chain, not a
    // hardcoded guess; still driven by the live signal in the response.
    expect(health.reachable).toBe(true);
    expect(health.coveredChains).toEqual(["stoachain"]);
  });

  it("health reports unreachable with empty coverage on a non-2xx healthz response", async () => {
    const { fetchFn } = fakeFetch(() => ({ status: 503, json: {} }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test",
      chainId: "stoachain",
      fetchFn,
    });

    const health = await conn.health();
    expect(health.reachable).toBe(false);
    expect(health.coveredChains).toEqual([]);
  });

  it("strips a trailing slash on baseUrl so URLs never double up", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ json: {} }));
    const conn = createPythiaConnection({
      baseUrl: "https://pythia.test/",
      chainId: "stoachain",
      fetchFn,
    });

    await conn.read({ code: "x" });
    expect(calls[0].url).toBe("https://pythia.test/stoachain/read");
  });
});
