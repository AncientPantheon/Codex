/**
 * gateway-pool-health.test.ts — Wave 2 coverage for the Arweave gateway pool's
 * exponential backoff and health-aware failover layer, extending T2.1's
 * rotation funnel in the same `pool.ts`.
 *
 * Scope (T2.2):
 *   - Backoff: between ALL successive failed attempts within one call (including
 *     same-endpoint retries under maxAttemptsPerEndpoint) the pool waits an
 *     exponentially increasing delay via the injected `sleep` seam, configurable
 *     base/cap, capped at the max. Tests inject an instant RECORDING sleep and
 *     assert the exact delay sequence (base, 2x, 4x, ... capped).
 *   - Health: a failing endpoint is marked unhealthy and SKIPPED (deprioritized)
 *     in selection ordering until a configurable cooldown elapses (injected
 *     `now` clock); after cooldown it is eligible again; selection prefers the
 *     FIRST configured endpoint (primary) once it is healthy.
 *   - Last-resort rule: health ordering influences WHERE a call starts, but one
 *     call may still attempt EVERY endpoint (including currently-unhealthy ones)
 *     before throwing GatewayPoolExhaustedError — never fails without trying
 *     every endpoint, never hangs.
 *   - Snapshot transitions across failure -> cooldown -> recovery.
 *
 * All seams injected: recording `sleep`, controllable `now`. No real timers.
 */

import { describe, it, expect, vi } from "vitest";
import { createGatewayPool } from "../src/gateway/pool.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";

/** A sleep seam that records every requested delay and resolves instantly. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

/** A controllable clock: `now()` returns whatever `t` currently holds. */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void; set: (t: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (v: number) => {
      t = v;
    },
  };
}

describe("gateway pool — exponential backoff between failed attempts", () => {
  it("waits base, 2x base, 4x base ... between successive same-endpoint retries", async () => {
    const { sleep, delays } = recordingSleep();
    const pool = createGatewayPool({
      endpoints: ["https://only.example"],
      maxAttemptsPerEndpoint: 5,
      backoffBaseMs: 100,
      backoffMaxMs: 100000,
      sleep,
      now: () => 0,
    });
    const op = async () => {
      throw new Error("always down");
    };

    await expect(pool.execute(op)).rejects.toThrow(GatewayPoolExhaustedError);

    // 5 attempts => 4 inter-attempt waits: 100, 200, 400, 800. The delay grows
    // exponentially from the base; no wait is recorded after the final failure
    // (the call throws instead of retrying).
    expect(delays).toEqual([100, 200, 400, 800]);
  });

  it("caps the exponential delay at backoffMaxMs", async () => {
    const { sleep, delays } = recordingSleep();
    const pool = createGatewayPool({
      endpoints: ["https://only.example"],
      maxAttemptsPerEndpoint: 6,
      backoffBaseMs: 100,
      backoffMaxMs: 500,
      sleep,
      now: () => 0,
    });
    const op = async () => {
      throw new Error("always down");
    };

    await expect(pool.execute(op)).rejects.toThrow(GatewayPoolExhaustedError);

    // 6 attempts => 5 waits. Uncapped they would be 100,200,400,800,1600 —
    // the cap clamps everything at or above 500 down to exactly 500.
    expect(delays).toEqual([100, 200, 400, 500, 500]);
  });

  it("applies backoff between failures across a multi-endpoint rotation", async () => {
    const { sleep, delays } = recordingSleep();
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 2,
      backoffBaseMs: 50,
      backoffMaxMs: 100000,
      sleep,
      now: () => 0,
    });
    const op = async (endpoint: string) => {
      throw new Error(`down:${endpoint}`);
    };

    await expect(pool.execute(op)).rejects.toThrow(GatewayPoolExhaustedError);

    // 2 endpoints x 2 attempts = 4 failures => 3 inter-attempt waits, each
    // doubling from the base: 50, 100, 200.
    expect(delays).toEqual([50, 100, 200]);
  });

  it("records no backoff wait when the first attempt succeeds", async () => {
    const { sleep, delays } = recordingSleep();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      backoffBaseMs: 100,
      sleep,
      now: () => 0,
    });

    const result = await pool.execute(async (e) => `ok:${e}`);

    expect(result).toBe("ok:https://a.example");
    expect(delays).toEqual([]);
  });
});

describe("gateway pool — health-aware failover and cooldown", () => {
  it("marks a failing endpoint unhealthy and skips it in the next call's ordering until cooldown elapses", async () => {
    const clock = fakeClock(1000);
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      healthCooldownMs: 5000,
      sleep: async () => {},
      now: clock.now,
    });

    // First call: A fails, B succeeds -> A is marked unhealthy.
    await pool.execute(async (endpoint) => {
      if (endpoint === "https://a.example") throw new Error("A down");
      return endpoint;
    });

    // A is within cooldown: the next call must NOT start at A. Record the order
    // endpoints are attempted; A (unhealthy) is deprioritized behind B.
    const orderCall1: string[] = [];
    await pool.execute(async (endpoint) => {
      orderCall1.push(endpoint);
      return endpoint;
    });
    expect(orderCall1[0]).toBe("https://b.example");
    expect(orderCall1).not.toContain("https://a.example");

    // After the cooldown elapses, A becomes eligible again and the pool prefers
    // the primary (first configured) endpoint once more.
    clock.advance(5000);
    const orderCall2: string[] = [];
    await pool.execute(async (endpoint) => {
      orderCall2.push(endpoint);
      return endpoint;
    });
    expect(orderCall2[0]).toBe("https://a.example");
  });

  it("prefers the FIRST configured endpoint (primary) once it recovers even when a fallback is currently active", async () => {
    const clock = fakeClock(0);
    const pool = createGatewayPool({
      endpoints: ["https://primary.example", "https://fallback.example"],
      maxAttemptsPerEndpoint: 1,
      healthCooldownMs: 1000,
      sleep: async () => {},
      now: clock.now,
    });

    // Primary fails once -> fallback becomes active, primary unhealthy.
    await pool.execute(async (endpoint) => {
      if (endpoint === "https://primary.example") throw new Error("primary down");
      return endpoint;
    });
    expect(pool.getActiveEndpoint()).toBe("https://fallback.example");

    // Cooldown elapses: primary eligible again. Next successful call routes to
    // the primary first (prefer-primary recovery), making it active again.
    clock.advance(1000);
    const first: string[] = [];
    await pool.execute(async (endpoint) => {
      first.push(endpoint);
      return endpoint;
    });
    expect(first[0]).toBe("https://primary.example");
    expect(pool.getActiveEndpoint()).toBe("https://primary.example");
  });

  it("last resort: a single call still attempts every endpoint (including unhealthy) before exhausting", async () => {
    const clock = fakeClock(0);
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example", "https://c.example"],
      maxAttemptsPerEndpoint: 1,
      healthCooldownMs: 100000,
      sleep: async () => {},
      now: clock.now,
    });

    // Prime: A and B both fail (B succeeds nothing) so both are unhealthy going
    // into the next call, while C stays healthy.
    await pool.execute(async (endpoint) => {
      if (endpoint === "https://c.example") return endpoint;
      throw new Error(`down:${endpoint}`);
    });

    // Now EVERY endpoint fails. Even though A and B are unhealthy, the pool must
    // still try all three before throwing — it never fails without trying every
    // endpoint, and never hangs.
    const attempted = new Set<string>();
    const op = vi.fn(async (endpoint: string) => {
      attempted.add(endpoint);
      throw new Error(`all-down:${endpoint}`);
    });

    let thrown: unknown;
    try {
      await pool.execute(op);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    const exhausted = thrown as GatewayPoolExhaustedError;
    // All three endpoints appear in the attempts — none skipped as last resort.
    expect(new Set(exhausted.attempts.map((a) => a.endpoint))).toEqual(
      new Set(["https://a.example", "https://b.example", "https://c.example"]),
    );
    expect(attempted).toEqual(
      new Set(["https://a.example", "https://b.example", "https://c.example"]),
    );
  });
});

describe("gateway pool — health snapshot transitions", () => {
  it("transitions a snapshot entry healthy -> unhealthy on failure and back after cooldown", async () => {
    const clock = fakeClock(2000);
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      healthCooldownMs: 4000,
      sleep: async () => {},
      now: clock.now,
    });

    // Construction: every endpoint healthy, primary active.
    const initial = pool.getHealthSnapshot();
    expect(initial.map((e) => e.healthy)).toEqual([true, true]);
    expect(initial.find((e) => e.endpoint === "https://a.example")?.active).toBe(true);

    // A fails, B serves -> A unhealthy, B active.
    await pool.execute(async (endpoint) => {
      if (endpoint === "https://a.example") throw new Error("A down");
      return endpoint;
    });

    const afterFailure = pool.getHealthSnapshot();
    expect(afterFailure.find((e) => e.endpoint === "https://a.example")?.healthy).toBe(false);
    expect(afterFailure.find((e) => e.endpoint === "https://b.example")?.healthy).toBe(true);
    expect(afterFailure.find((e) => e.endpoint === "https://b.example")?.active).toBe(true);

    // Still within cooldown: A remains unhealthy in the snapshot.
    clock.advance(3999);
    expect(
      pool.getHealthSnapshot().find((e) => e.endpoint === "https://a.example")?.healthy,
    ).toBe(false);

    // Cooldown elapsed: A is eligible again (healthy) in the snapshot.
    clock.advance(1);
    expect(
      pool.getHealthSnapshot().find((e) => e.endpoint === "https://a.example")?.healthy,
    ).toBe(true);
  });

  it("keeps returning one frozen entry per configured endpoint in configured order", async () => {
    const clock = fakeClock(0);
    const endpoints = ["https://a.example", "https://b.example", "https://c.example"];
    const pool = createGatewayPool({
      endpoints,
      maxAttemptsPerEndpoint: 1,
      sleep: async () => {},
      now: clock.now,
    });

    await pool.execute(async (endpoint) => {
      if (endpoint !== "https://c.example") throw new Error("down");
      return endpoint;
    });

    const snapshot = pool.getHealthSnapshot();
    expect(snapshot.map((e) => e.endpoint)).toEqual(endpoints);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });
});
