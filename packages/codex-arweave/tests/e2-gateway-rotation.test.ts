/**
 * E2 RED matrix — gateway rotation on the send path (E-05 success criterion).
 *
 * SHAPE-DRIVES T12.4. Rotation is INTERNAL to arweave-core's `pool.execute`; E2
 * exercises it via a REAL `createGatewayPool({ endpoints:[A,B] })` with an
 * INSTANT `sleep` seam (no backoff wall-time) and a fake `apiFactory` whose
 * endpoint-A op THROWS and endpoint-B op SUCCEEDS. The send still RESOLVES,
 * proving retry+rotation is exercised on a gateway failure.
 *
 * SEAM DISCIPLINE: the SEND path uses `opts.apiFactory` (NOT `fetchFn`). The
 * failure is simulated at the apiFactory (per-endpoint) level, not the pool.
 */

import { describe, it, expect } from "vitest";

import { createGatewayPool, ARWEAVE_ADDRESS_RE } from "@ancientpantheon/arweave-core";

import { createArweaveAdapter } from "../src/adapter";
import { throwawayJwk, CANONICAL_TARGET, ENDPOINT_A, ENDPOINT_B } from "./e2-helpers";

/**
 * A fake apiFactory whose endpoint-A ops THROW (simulating a down gateway) and
 * endpoint-B ops SUCCEED. Records which endpoints the post reached.
 */
function makeRotatingApiFactory() {
  const postedEndpoints: string[] = [];
  const apiFactory = (endpoint: string) => {
    const isA = endpoint === ENDPOINT_A;
    return {
      getAnchor: async () => {
        if (isA) throw new Error("gateway A down (getAnchor)");
        return "anchor-last-tx";
      },
      getPrice: async (_byteSize: number, _target: string) => {
        if (isA) throw new Error("gateway A down (getPrice)");
        return "5000000000";
      },
      postTransaction: async (_tx: { id: string }) => {
        if (isA) throw new Error("gateway A down (post)");
        postedEndpoints.push(endpoint);
        return { status: 200, statusText: "OK" };
      },
    };
  };
  return { apiFactory, postedEndpoints };
}

describe("gateway rotation — a send survives an endpoint-A failure (E-05)", () => {
  it("rotates from a failing endpoint A to a healthy endpoint B and still resolves the send", async () => {
    // Real pool, INSTANT sleep so no backoff wall-time elapses.
    const pool = createGatewayPool({
      endpoints: [ENDPOINT_A, ENDPOINT_B],
      sleep: async () => {},
      maxAttemptsPerEndpoint: 1,
    });
    const adapter = createArweaveAdapter({ pool });

    const { apiFactory, postedEndpoints } = makeRotatingApiFactory();
    const built = await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    });

    const result = (await adapter.post(built, throwawayJwk, { apiFactory })) as {
      id: string;
      reward: bigint;
    };

    // The send reached a signed+posted result despite endpoint A failing.
    expect(ARWEAVE_ADDRESS_RE.test(result.id)).toBe(true);
    expect(result.reward).toBe(5_000_000_000n);
    // Rotation was exercised: the successful post landed on endpoint B.
    expect(postedEndpoints).toContain(ENDPOINT_B);
    expect(postedEndpoints).not.toContain(ENDPOINT_A);
  });
});
