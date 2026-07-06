/**
 * Phase 2 (CL-06/CL-07) — the Arweave `ChainConnection` seam.
 *
 * `createArweaveConnection({ gatewayUrl, fetchFn? })` is the Codex-path bridge:
 * it builds a `createGatewayPool({ endpoints: [gatewayUrl] })` from an EXPLICITLY
 * supplied gateway URL and wraps it as a Phase-1 `ChainConnection` (via
 * `createDirectNodeConnection`), so the network-settings model + health work
 * uniformly. The invariant under test: the endpoint is ALWAYS the injected
 * `gatewayUrl` — never a hidden `arweave.net` default. The transport delegates
 * reads (balance/status) and broadcast (POST /tx of an already-signed tx) to the
 * injected gateway, and `poll` maps arweave-core's confirmation status onto the
 * seam's pending/final result.
 *
 * KEYLESS (N-01): `send` takes exactly one already-signed tx and NO key. There is
 * no build/sign here — the Codex signs elsewhere and hands a signed tx in.
 */

import { describe, it, expect } from "vitest";

import { createArweaveConnection } from "../src/connection";
import { ARWEAVE_CHAIN_ID } from "../src/address-book";
import { KNOWN_ADDRESS, confirmedBody } from "./e2-helpers";

const GATEWAY = "https://my-gateway.example";

/** A fetch fake that records every URL/init it is called with and answers from a
 *  scripted queue (status + body) so a test drives read/broadcast/probe with zero
 *  real network. */
function makeRecordingFetch(
  responses: Array<{ status: number; body: string }>,
) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let i = 0;
  const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
    };
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createArweaveConnection — a ChainConnection over an EXPLICIT gateway URL (CL-06)", () => {
  it("speaks for the Arweave chain id (a direct node serves exactly one chain)", () => {
    const { fetchFn } = makeRecordingFetch([{ status: 200, body: "0" }]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });
    expect(conn.chainId).toBe(ARWEAVE_CHAIN_ID);
  });

  it("reads a balance against the INJECTED gatewayUrl, never arweave.net", async () => {
    const { fetchFn, calls } = makeRecordingFetch([
      { status: 200, body: "1500000000000" },
    ]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });

    const balance = await conn.read({ kind: "balance", address: KNOWN_ADDRESS });

    expect(balance).toBe(1_500_000_000_000n);
    // The read URL is composed from the injected gateway — the invariant.
    expect(calls[0].url).toBe(`${GATEWAY}/wallet/${KNOWN_ADDRESS}/balance`);
    expect(calls.every((c) => !c.url.includes("arweave.net"))).toBe(true);
  });

  it("polls a tx to `final` when confirmations reach the finality depth", async () => {
    const { fetchFn, calls } = makeRecordingFetch([
      { status: 200, body: JSON.stringify(confirmedBody(25)) },
    ]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });

    const result = await conn.poll({ txId: "z".repeat(43) });

    expect(result.status).toBe("final");
    expect(calls[0].url).toBe(`${GATEWAY}/tx/${"z".repeat(43)}/status`);
  });

  it("polls a tx to `pending` while it is accepted-but-unmined (HTTP 202)", async () => {
    const { fetchFn } = makeRecordingFetch([{ status: 202, body: "" }]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });

    const result = await conn.poll({ txId: "y".repeat(43) });

    expect(result.status).toBe("pending");
  });

  it("broadcasts an ALREADY-SIGNED tx via POST {gatewayUrl}/tx and returns the node response", async () => {
    const { fetchFn, calls } = makeRecordingFetch([{ status: 200, body: "OK" }]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });

    const signedTx = { id: "abc", owner: "o", signature: "s" };
    await conn.send(signedTx);

    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeDefined();
    expect(post!.url).toBe(`${GATEWAY}/tx`);
    // The exact signed tx is forwarded verbatim as the POST body (the Codex
    // signed it elsewhere; the connection only relays it).
    expect(JSON.parse(post!.body!)).toEqual(signedTx);
  });

  it("reports health.reachable=true and coverage = exactly [arweave] when the gateway answers", async () => {
    const { fetchFn } = makeRecordingFetch([{ status: 200, body: "{}" }]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });

    const health = await conn.health();

    expect(health.reachable).toBe(true);
    // A direct node advertises exactly its one served chain — never a wider set.
    expect(health.coveredChains).toEqual([ARWEAVE_CHAIN_ID]);
  });

  it("reports health.reachable=false when the gateway probe fails", async () => {
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn: failing });

    const health = await conn.health();

    expect(health.reachable).toBe(false);
  });
});

describe("createArweaveConnection — keyless seam (N-01)", () => {
  it("send takes ONE already-signed tx and accepts no key argument", async () => {
    const { fetchFn } = makeRecordingFetch([{ status: 200, body: "OK" }]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });
    // Arity is exactly 1 — a second (key) parameter would be a keyless-seam break.
    expect(conn.send.length).toBe(1);
  });

  it("never reads a key/jwk field off the read query (relays only the address)", async () => {
    // A sentinel getter on a `jwk` field that throws if the connection ever
    // reaches for key material while relaying an opaque READ query. The read path
    // must consume ONLY the address — a balance read holds no key.
    const trap = () => {
      throw new Error("connection touched key material on the read query");
    };
    const { fetchFn } = makeRecordingFetch([{ status: 200, body: "1000000000000" }]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });

    const queryWithTrap = { kind: "balance", address: KNOWN_ADDRESS };
    Object.defineProperty(queryWithTrap, "jwk", { get: trap, enumerable: false });
    Object.defineProperty(queryWithTrap, "seed", { get: trap, enumerable: false });

    await expect(
      conn.read(queryWithTrap),
    ).resolves.toBe(1_000_000_000_000n);
  });

  it("broadcasts the signed tx verbatim WITHOUT accepting a separate key argument", async () => {
    // The signed tx is relayed as-is (public `owner`/`signature`/`id` — never a
    // private field, since the Codex signs elsewhere). Passing a would-be key as a
    // second arg is ignored: `send` is arity-1 and forwards only the tx it is given.
    const { fetchFn, calls } = makeRecordingFetch([{ status: 200, body: "OK" }]);
    const conn = createArweaveConnection({ gatewayUrl: GATEWAY, fetchFn });

    const signedTx = { id: "abc", owner: "pub-owner", signature: "sig" };
    await (conn.send as (tx: unknown, key?: unknown) => Promise<unknown>)(
      signedTx,
      { d: "would-be-private-key" },
    );

    const post = calls.find((c) => c.method === "POST");
    // The second (key) arg never reaches the wire — only the signed tx is posted.
    expect(JSON.parse(post!.body!)).toEqual(signedTx);
    expect(post!.body).not.toContain("would-be-private-key");
  });
});
