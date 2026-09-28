/**
 * createKadenaConnection (2026-09-26) — the Network tab's third row: a
 * ChainConnection for a real Kadena mainnet node, independent of
 * stoa-core's StoaChain global.
 *
 * Simpler contract than `createStoaChainConnection`'s own test suite
 * (see this file's own doc comment for why): no signing options, no
 * `applyNodeConfig`/global redirect — just health + a read/send/poll relay
 * over the `mainnet01` chainweb path, mirroring the StoaChain transport's
 * own proven shape with the network segment swapped.
 */

import { describe, it, expect, vi } from "vitest";
import { createKadenaConnection, KADENA_CONNECTION_CHAIN_ID, KADENA_DIRECT_NODE_URL } from "./index.js";
import { KADENA_MAINNET_DEFAULT_NODE_URL } from "../kadena/kadenaReads.js";

const CUSTOM_URL = "https://my-kadena-node.example.com";

describe("createKadenaConnection", () => {
  it("defaults to the confirmed-live Kadena gateway (2026-09-28: a transparent passthrough at denascan.ancientholdings.eu, unblocking real signing/broadcast — the direct duckdns node is HTTP-only and hairpin-NATs from its own LAN, kept selectable via KADENA_DIRECT_NODE_URL, no longer the default) — surfaced, not hidden", () => {
    expect(KADENA_MAINNET_DEFAULT_NODE_URL).toBe("https://denascan.ancientholdings.eu");
    const conn = createKadenaConnection();
    expect(conn.chainId).toBe(KADENA_CONNECTION_CHAIN_ID);
  });

  it("still re-exports the direct duckdns node as a selectable (non-default) option, for whoever is actually on its own LAN", () => {
    expect(KADENA_DIRECT_NODE_URL).toBe("http://bytales.duckdns.org:31849");
    expect(KADENA_DIRECT_NODE_URL).not.toBe(KADENA_MAINNET_DEFAULT_NODE_URL);
  });

  it("produces a ChainConnection whose health covers only the kadena chain over the given node URL", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const conn = createKadenaConnection({ nodeUrl: CUSTOM_URL, fetchFn });

    const health = await conn.health();
    expect(health.reachable).toBe(true);
    expect(health.coveredChains).toEqual([KADENA_CONNECTION_CHAIN_ID]);
    expect(fetchFn).toHaveBeenCalledWith(CUSTOM_URL, expect.objectContaining({ method: "GET" }));
  });

  it("reports unreachable (not throws) when the probe fails", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("network down"); });
    const conn = createKadenaConnection({ nodeUrl: CUSTOM_URL, fetchFn });
    const health = await conn.health();
    expect(health.reachable).toBe(false);
  });

  it("relays a read to the node's mainnet01 chainweb path — NOT stoa's", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { status: "success", data: 42 } }),
    }));
    const conn = createKadenaConnection({ nodeUrl: CUSTOM_URL, chainId: "0", fetchFn });

    const out = await conn.read({ pactCode: "(+ 1 1)" });
    expect(fetchFn).toHaveBeenCalledWith(
      `${CUSTOM_URL}/chainweb/0.0/mainnet01/chain/0/pact/api/v1/local`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(out).toEqual({ result: { status: "success", data: 42 } });
  });

  it("relays to a different chain id when configured", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const conn = createKadenaConnection({ nodeUrl: CUSTOM_URL, chainId: "5", fetchFn });
    await conn.read({ pactCode: "(+ 1 1)" });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/chain/5/pact/api/v1/local"),
      expect.anything(),
    );
  });
});
