/**
 * RED contract tests for the `ChainConnection` seam (CL-01) + the keyless
 * invariant (N-01).
 *
 * `ChainConnection` is the per-chain, KEYLESS transport interface: it relays a
 * read query, broadcasts an ALREADY-SIGNED tx, polls tx status, and reports
 * health (reachability + advertised chain coverage). It NEVER builds requests,
 * signs, or holds keys — codex-core does not reimplement Chainweb/Arweave
 * protocol; the payloads are OPAQUE (`unknown`), filled by the chain modules in
 * later phases.
 *
 * N-01 is asserted at the TYPE level here: a `@ts-expect-error` proves that no
 * transport method accepts a key/seed/sign parameter. If someone widened a
 * method to take a signing key, the `@ts-expect-error` would go stale (the call
 * would compile) and tsc would flag the now-unused directive — turning the
 * keyless invariant into a compile-time guard.
 *
 * RED: imports from `../src/connection/index.js`, which does not exist yet.
 */

import { describe, it, expect } from "vitest";
import type {
  ChainConnection,
  ConnectionHealth,
  ConnectionPollResult,
} from "../src/connection/index.js";

/**
 * A conforming fake ChainConnection. It only compiles if the interface exposes
 * exactly `read`/`send`/`poll`/`health` with the opaque-payload shapes — and
 * only if NONE of them require a key parameter.
 */
const fake: ChainConnection = {
  chainId: "stoachain",
  read: async (query: unknown) => ({ echoedQuery: query }),
  send: async (signedTx: unknown) => ({ broadcast: signedTx }),
  poll: async (): Promise<ConnectionPollResult> => ({ status: "final" }),
  health: async (): Promise<ConnectionHealth> => ({
    reachable: true,
    coveredChains: ["stoachain"],
  }),
};

describe("ChainConnection seam (CL-01)", () => {
  it("exposes the four keyless transport methods over an opaque payload", async () => {
    expect(fake.chainId).toBe("stoachain");
    await expect(fake.read({ code: "(coin.details \"alice\")" })).resolves.toEqual({
      echoedQuery: { code: "(coin.details \"alice\")" },
    });
    await expect(fake.send({ cmds: ["signed-by-caller"] })).resolves.toEqual({
      broadcast: { cmds: ["signed-by-caller"] },
    });
  });

  it("poll returns a pending|final ConnectionPollResult", async () => {
    const pending: ConnectionPollResult = { status: "pending" };
    const final: ConnectionPollResult = { status: "final", detail: { depth: 4 } };
    expect(pending.status).toBe("pending");
    expect(final.detail).toEqual({ depth: 4 });
  });

  it("health advertises reachability + covered chains", async () => {
    const health = await fake.health();
    expect(health.reachable).toBe(true);
    expect(health.coveredChains).toEqual(["stoachain"]);
  });

  it("N-01: no transport method accepts a key/sign parameter (compile-time guard)", async () => {
    // read relays a query only — passing a signing key is a type error. If the
    // seam ever gained a key parameter this @ts-expect-error would go stale and
    // tsc would fail on the unused directive, catching the regression.
    // @ts-expect-error read() takes exactly one opaque query arg, never a key.
    await fake.read({ code: "x" }, { privateKey: "SECRET" });
    // @ts-expect-error send() broadcasts an already-signed tx; no seed arg.
    await fake.send({ cmds: [] }, "SEED_PHRASE");
  });
});
