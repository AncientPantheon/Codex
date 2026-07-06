/**
 * RED contract tests for `createDirectNodeConnection` (CL-03).
 *
 * The direct-node connection wraps a single node/gateway URL for ONE chain. It
 * does NOT know the Chainweb/Arweave protocol — the chain-specific transport
 * (`read`/`send`/`poll`, plus an optional `probe`) is INJECTED by the later
 * phase that owns the chain. codex-core only wires delegation + a reachability
 * probe.
 *
 * health() = a reachability probe: `transport.probe?()` if supplied, otherwise a
 * GET to `nodeUrl` via the injected fetch. Coverage is always exactly the single
 * `chainId` this connection serves (a direct node speaks for one chain).
 *
 * RED: imports from `../src/connection/index.js`, which does not exist yet.
 */

import { describe, it, expect } from "vitest";
import { createDirectNodeConnection, type FetchLike } from "../src/connection/index.js";

describe("createDirectNodeConnection (CL-03)", () => {
  it("delegates read/send/poll to the injected transport with the caller payload untouched", async () => {
    const seen: Record<string, unknown> = {};
    const conn = createDirectNodeConnection({
      chainId: "arweave",
      nodeUrl: "https://arweave.example",
      transport: {
        read: async (q) => {
          seen.read = q;
          return { r: "read" };
        },
        send: async (tx) => {
          seen.send = tx;
          return { r: "send" };
        },
        poll: async (ref) => {
          seen.poll = ref;
          return { status: "final" as const };
        },
      },
    });

    await expect(conn.read({ q: 1 })).resolves.toEqual({ r: "read" });
    await expect(conn.send({ tx: 2 })).resolves.toEqual({ r: "send" });
    await expect(conn.poll({ ref: 3 })).resolves.toEqual({ status: "final" });

    expect(seen.read).toEqual({ q: 1 });
    expect(seen.send).toEqual({ tx: 2 });
    expect(seen.poll).toEqual({ ref: 3 });
    expect(conn.chainId).toBe("arweave");
  });

  it("health uses transport.probe? when supplied and reports coverage as the single served chain", async () => {
    const conn = createDirectNodeConnection({
      chainId: "arweave",
      nodeUrl: "https://arweave.example",
      transport: {
        read: async () => ({}),
        send: async () => ({}),
        poll: async () => ({ status: "final" as const }),
        probe: async () => true,
      },
    });

    const health = await conn.health();
    expect(health.reachable).toBe(true);
    expect(health.coveredChains).toEqual(["arweave"]);
  });

  it("health reports unreachable when transport.probe resolves false", async () => {
    const conn = createDirectNodeConnection({
      chainId: "arweave",
      nodeUrl: "https://arweave.example",
      transport: {
        read: async () => ({}),
        send: async () => ({}),
        poll: async () => ({ status: "final" as const }),
        probe: async () => false,
      },
    });

    const health = await conn.health();
    expect(health.reachable).toBe(false);
    expect(health.coveredChains).toEqual(["arweave"]);
  });

  it("health falls back to a GET on nodeUrl via the injected fetch when no probe is supplied", async () => {
    let probedUrl = "";
    const fetchFn: FetchLike = async (url) => {
      probedUrl = url;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const conn = createDirectNodeConnection({
      chainId: "arweave",
      nodeUrl: "https://arweave.example",
      fetchFn,
      transport: {
        read: async () => ({}),
        send: async () => ({}),
        poll: async () => ({ status: "final" as const }),
      },
    });

    const health = await conn.health();
    expect(probedUrl).toBe("https://arweave.example");
    expect(health.reachable).toBe(true);
    expect(health.coveredChains).toEqual(["arweave"]);
  });

  it("health reports unreachable when the fallback fetch probe throws (node down)", async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };

    const conn = createDirectNodeConnection({
      chainId: "arweave",
      nodeUrl: "https://arweave.example",
      fetchFn,
      transport: {
        read: async () => ({}),
        send: async () => ({}),
        poll: async () => ({ status: "final" as const }),
      },
    });

    const health = await conn.health();
    expect(health.reachable).toBe(false);
  });
});
