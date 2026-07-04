/**
 * gateway-pool-rotation.test.ts — Wave 1 coverage for the Arweave gateway
 * pool's core rotation/retry primitive and construction-time config validation.
 *
 * Scope (T2.1, pre-backoff): the pool is a config-driven, dependency-free
 * funnel that routes a caller-supplied per-endpoint async operation across an
 * ordered endpoint list, rotating on failure until every endpoint has been
 * attempted `maxAttemptsPerEndpoint` times, then throwing exactly ONE
 * `GatewayPoolExhaustedError` carrying every per-attempt underlying failure.
 *
 * These tests lock the invariants the later phases depend on:
 *   - config-only switch (custom endpoint list used verbatim; default is arweave.net)
 *   - rotation (A fails -> B succeeds -> call resolves with B's result)
 *   - single-endpoint retry (fail-twice-then-succeed; fail-all -> exhausted with N attempts)
 *   - per-call-local state (two concurrent execute calls each try every endpoint)
 *   - construction-time rejection (empty list, non-URL endpoint) — thrown SYNCHRONOUSLY
 *   - snapshot completeness (eager, one verbatim entry per configured endpoint at construction)
 *
 * Every pool injects an instant `sleep` seam so these rotation tests stay
 * instant and valid after T2.2 wires real backoff delays into the same funnel.
 */

import { describe, it, expect, vi } from "vitest";
import { createGatewayPool } from "../src/gateway/pool.js";
import {
  GatewayPoolExhaustedError,
  InvalidGatewayConfigError,
} from "../src/gateway/errors.js";

/** Instant sleep seam — defensive determinism for rotation tests. */
const instantSleep = async () => {};

describe("createGatewayPool — construction-time config validation", () => {
  it("throws InvalidGatewayConfigError synchronously for an empty endpoints array", () => {
    // A pool that could be constructed with zero endpoints would be able to
    // exhaust with an empty `attempts` array — a silent no-op failure. The
    // guard makes that unconstructable, matching the sibling's F-SEC-002 lesson.
    expect(() =>
      createGatewayPool({ endpoints: [], sleep: instantSleep }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it("throws InvalidGatewayConfigError synchronously for an endpoint that fails URL parsing", () => {
    expect(() =>
      createGatewayPool({ endpoints: ["not a url"], sleep: instantSleep }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it("accepts a self-run gateway on plain http (URL-parseable, not https-restricted)", () => {
    // http://localhost:1984 is a legitimate self-run Arweave gateway — the
    // validation is URL-parseability ONLY, never a scheme allow-list.
    expect(() =>
      createGatewayPool({
        endpoints: ["http://localhost:1984"],
        sleep: instantSleep,
      }),
    ).not.toThrow();
  });

  it("throws InvalidGatewayConfigError synchronously for a non-positive or fractional maxAttemptsPerEndpoint", () => {
    // Same-class complement to the empty-endpoints guard: a maxAttemptsPerEndpoint
    // of 0 (or negative) would make the retry loop never run, so the pool would
    // exhaust with an empty `attempts` array — the exact silent no-op failure the
    // construction guard exists to prevent. A fractional value would also mis-detect
    // the final attempt and trigger a spurious backoff wait.
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() =>
        createGatewayPool({
          endpoints: ["https://arweave.net"],
          maxAttemptsPerEndpoint: bad,
          sleep: instantSleep,
        }),
      ).toThrow(InvalidGatewayConfigError);
    }
    // The reason discriminant is set for programmatic inspection.
    try {
      createGatewayPool({
        endpoints: ["https://arweave.net"],
        maxAttemptsPerEndpoint: 0,
        sleep: instantSleep,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidGatewayConfigError);
      expect((err as InvalidGatewayConfigError).reason).toBe(
        "invalid-max-attempts",
      );
    }
  });

  it("accepts a valid positive-integer maxAttemptsPerEndpoint", () => {
    expect(() =>
      createGatewayPool({
        endpoints: ["https://arweave.net"],
        maxAttemptsPerEndpoint: 5,
        sleep: instantSleep,
      }),
    ).not.toThrow();
  });
});

describe("createGatewayPool — config-only endpoint switch", () => {
  it("routes operations to a custom endpoint list verbatim with no other change", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://gateway.self.example"],
      sleep: instantSleep,
    });
    const op = vi.fn(async (endpoint: string) => endpoint);

    const result = await pool.execute(op);

    // The operation is handed the configured endpoint string verbatim — a
    // self-run gateway is reached by config change alone. The second arg is the
    // per-attempt context carrying the abort signal.
    expect(result).toBe("https://gateway.self.example");
    expect(op).toHaveBeenCalledWith(
      "https://gateway.self.example",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("defaults to https://arweave.net when constructed with no config", async () => {
    const pool = createGatewayPool({ sleep: instantSleep });
    const op = vi.fn(async (endpoint: string) => endpoint);

    const result = await pool.execute(op);

    expect(result).toBe("https://arweave.net");
  });
});

describe("createGatewayPool — rotation across endpoints", () => {
  it("retries on endpoint B and resolves with B's result when endpoint A fails", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });
    // A always fails; B succeeds. A transient single-gateway problem must not
    // fail the call — rotation carries it to B.
    const op = vi.fn(async (endpoint: string) => {
      if (endpoint === "https://a.example") throw new Error("A is down");
      return `ok:${endpoint}`;
    });

    const result = await pool.execute(op);

    expect(result).toBe("ok:https://b.example");
    expect(op).toHaveBeenCalledWith("https://a.example", expect.anything());
    expect(op).toHaveBeenCalledWith("https://b.example", expect.anything());
  });

  it("prefers the endpoint that last succeeded on the next call (active-endpoint preference)", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });
    const failingOnA = async (endpoint: string) => {
      if (endpoint === "https://a.example") throw new Error("A is down");
      return endpoint;
    };
    await pool.execute(failingOnA);

    // After A failed and B succeeded, the active preference is B — the next
    // call starts at B and is served without ever touching A.
    const secondOp = vi.fn(async (endpoint: string) => endpoint);
    const result = await pool.execute(secondOp);

    expect(result).toBe("https://b.example");
    expect(secondOp).toHaveBeenCalledTimes(1);
    expect(secondOp).toHaveBeenCalledWith("https://b.example", expect.anything());
  });
});

describe("createGatewayPool — single-endpoint retry", () => {
  it("retries the one endpoint up to maxAttemptsPerEndpoint and resolves on the 3rd attempt", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://only.example"],
      maxAttemptsPerEndpoint: 3,
      sleep: instantSleep,
    });
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error(`transient ${calls}`);
      return "recovered";
    });

    const result = await pool.execute(op);

    // A transient hiccup on the default single-endpoint config does NOT
    // terminally fail the call — it retries within maxAttemptsPerEndpoint.
    expect(result).toBe("recovered");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("defaults maxAttemptsPerEndpoint to 3 so a single-endpoint pool retries 3 times", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://only.example"],
      sleep: instantSleep,
    });
    const op = vi.fn(async () => {
      throw new Error("always down");
    });

    await expect(pool.execute(op)).rejects.toThrow(GatewayPoolExhaustedError);
    // Default is 3 (not 1): the funnel makes 3 attempts before terminal failure.
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("throws GatewayPoolExhaustedError with exactly 3 attempts entries when all attempts fail", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://only.example"],
      maxAttemptsPerEndpoint: 3,
      sleep: instantSleep,
    });
    const underlying = [
      new Error("fail-1"),
      new Error("fail-2"),
      new Error("fail-3"),
    ];
    let i = 0;
    const op = async () => {
      throw underlying[i++];
    };

    let thrown: unknown;
    try {
      await pool.execute(op);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    const exhausted = thrown as GatewayPoolExhaustedError;
    // One entry per failed attempt, in order, each preserving the underlying
    // error object verbatim (not a stringified copy) — consumers inspect,
    // never parse.
    expect(exhausted.attempts).toHaveLength(3);
    expect(exhausted.attempts.map((a) => a.endpoint)).toEqual([
      "https://only.example",
      "https://only.example",
      "https://only.example",
    ]);
    expect(exhausted.attempts.map((a) => a.error)).toEqual(underlying);
    expect(exhausted.attempts[0].error).toBe(underlying[0]);
  });

  it("never throws the opaque underlying error directly — always the typed terminal error", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://only.example"],
      maxAttemptsPerEndpoint: 2,
      sleep: instantSleep,
    });
    const op = async () => {
      throw new Error("raw network error");
    };

    await expect(pool.execute(op)).rejects.toBeInstanceOf(
      GatewayPoolExhaustedError,
    );
    await expect(pool.execute(op)).rejects.not.toThrow("raw network error");
  });
});

describe("createGatewayPool — multi-endpoint exhaustion schedule", () => {
  it("attempts every endpoint maxAttemptsPerEndpoint times before exhausting", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 2,
      sleep: instantSleep,
    });
    const op = vi.fn(async (endpoint: string) => {
      throw new Error(`down:${endpoint}`);
    });

    let thrown: unknown;
    try {
      await pool.execute(op);
    } catch (err) {
      thrown = err;
    }

    const exhausted = thrown as GatewayPoolExhaustedError;
    // 2 endpoints x 2 attempts each = 4 total failed attempts, each endpoint
    // appearing exactly maxAttemptsPerEndpoint times.
    expect(exhausted.attempts).toHaveLength(4);
    const perEndpoint = exhausted.attempts.reduce<Record<string, number>>(
      (acc, a) => {
        acc[a.endpoint] = (acc[a.endpoint] ?? 0) + 1;
        return acc;
      },
      {},
    );
    expect(perEndpoint["https://a.example"]).toBe(2);
    expect(perEndpoint["https://b.example"]).toBe(2);
  });
});

describe("createGatewayPool — per-call-local state (concurrency)", () => {
  it("two interleaved execute calls each independently try every endpoint on exhaustion", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 2,
      sleep: instantSleep,
    });

    // Deterministic interleaving via a shared per-endpoint call counter — both
    // calls always fail, so each must independently exhaust the full schedule.
    // If rotation state were shared on the instance, the two calls would
    // corrupt each other's cursors and one would skip endpoints.
    const opA = vi.fn(async (endpoint: string) => {
      throw new Error(`callA-down:${endpoint}`);
    });
    const opB = vi.fn(async (endpoint: string) => {
      throw new Error(`callB-down:${endpoint}`);
    });

    const [resA, resB] = await Promise.allSettled([
      pool.execute(opA),
      pool.execute(opB),
    ]);

    expect(resA.status).toBe("rejected");
    expect(resB.status).toBe("rejected");
    const errA = (resA as PromiseRejectedResult).reason;
    const errB = (resB as PromiseRejectedResult).reason;

    expect(errA).toBeInstanceOf(GatewayPoolExhaustedError);
    expect(errB).toBeInstanceOf(GatewayPoolExhaustedError);
    // Each call's attempts covers the full 4-attempt schedule — no endpoint
    // skipped, no cross-call interference.
    expect((errA as GatewayPoolExhaustedError).attempts).toHaveLength(4);
    expect((errB as GatewayPoolExhaustedError).attempts).toHaveLength(4);
    expect(opA).toHaveBeenCalledTimes(4);
    expect(opB).toHaveBeenCalledTimes(4);
  });

  it("a call that succeeds and a concurrent call that exhausts do not interfere", async () => {
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 2,
      sleep: instantSleep,
    });

    const succeeding = async (endpoint: string) => `ok:${endpoint}`;
    const failing = async (endpoint: string) => {
      throw new Error(`down:${endpoint}`);
    };

    const [ok, bad] = await Promise.allSettled([
      pool.execute(succeeding),
      pool.execute(failing),
    ]);

    expect(ok.status).toBe("fulfilled");
    expect((ok as PromiseFulfilledResult<string>).value).toMatch(/^ok:https:/);
    expect(bad.status).toBe("rejected");
    expect((bad as PromiseRejectedResult).reason).toBeInstanceOf(
      GatewayPoolExhaustedError,
    );
  });
});

describe("createGatewayPool — per-request timeout / abort seam (never-settles is bounded)", () => {
  it("throws InvalidGatewayConfigError synchronously for a non-positive or fractional requestTimeoutMs", () => {
    // Same-class guard as maxAttemptsPerEndpoint: a zero/negative/fractional
    // timeout would schedule a nonsensical abort, so it is rejected at construction.
    for (const bad of [0, -1, 15.5, Number.NaN]) {
      expect(() =>
        createGatewayPool({
          endpoints: ["https://arweave.net"],
          requestTimeoutMs: bad,
          sleep: instantSleep,
        }),
      ).toThrow(InvalidGatewayConfigError);
    }
    try {
      createGatewayPool({
        endpoints: ["https://arweave.net"],
        requestTimeoutMs: 0,
        sleep: instantSleep,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidGatewayConfigError);
      expect((err as InvalidGatewayConfigError).reason).toBe(
        "invalid-request-timeout",
      );
    }
  });

  it("abandons an endpoint whose op NEVER settles after requestTimeoutMs and rotates to the next", async () => {
    // A black-holed gateway (connection accepted, response never sent) must NOT
    // stall the whole pool call. Driven deterministically via an injected timer
    // seam: the fake fires the scheduled abort synchronously, so no real wall time
    // passes and the test cannot hang.
    let scheduledAbort: (() => void) | null = null;
    const timer = {
      set: (cb: () => void) => {
        scheduledAbort = cb;
        return Symbol("handle");
      },
      clear: () => {
        scheduledAbort = null;
      },
    };

    const pool = createGatewayPool({
      endpoints: ["https://black-hole.example", "https://healthy.example"],
      maxAttemptsPerEndpoint: 1,
      requestTimeoutMs: 15_000,
      sleep: instantSleep,
      setRequestTimer: timer.set,
      clearRequestTimer: timer.clear,
    });

    const op = vi.fn(
      (endpoint: string, ctx: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          if (endpoint === "https://black-hole.example") {
            // Never resolves on its own — only the abort can end it. Fire the
            // scheduled timeout to prove the pool bounds the hung attempt.
            ctx.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
            scheduledAbort?.();
            return;
          }
          resolve(`ok:${endpoint}`);
        }),
    );

    const result = await pool.execute(op);

    // The black-holed attempt was abandoned via abort and the call rotated to the
    // healthy endpoint instead of hanging forever.
    expect(result).toBe("ok:https://healthy.example");
    expect(op).toHaveBeenCalledWith(
      "https://black-hole.example",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("exhausts with the typed error when EVERY endpoint's op never settles (all time out)", async () => {
    let scheduledAbort: (() => void) | null = null;
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      requestTimeoutMs: 15_000,
      sleep: instantSleep,
      setRequestTimer: (cb: () => void) => {
        scheduledAbort = cb;
        return Symbol("handle");
      },
      clearRequestTimer: () => {
        scheduledAbort = null;
      },
    });

    const op = (_endpoint: string, ctx: { signal: AbortSignal }) =>
      new Promise<string>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
        scheduledAbort?.();
      });

    let thrown: unknown;
    try {
      await pool.execute(op);
    } catch (err) {
      thrown = err;
    }

    // Every hung attempt was bounded and recorded; the call exhausts with the
    // typed terminal error rather than hanging.
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    expect((thrown as GatewayPoolExhaustedError).attempts).toHaveLength(2);
  });

  it("clears the scheduled abort timer when the op settles in time (no leak)", async () => {
    const cleared: symbol[] = [];
    let handleSeq = 0;
    const pool = createGatewayPool({
      endpoints: ["https://fast.example"],
      requestTimeoutMs: 15_000,
      sleep: instantSleep,
      setRequestTimer: () => {
        const h = Symbol(`handle-${handleSeq++}`);
        return h;
      },
      clearRequestTimer: (h: unknown) => {
        cleared.push(h as symbol);
      },
    });

    await pool.execute(async (endpoint: string) => `ok:${endpoint}`);

    // A successfully-settled op must clear its abort timer so no dangling timer
    // survives the attempt.
    expect(cleared).toHaveLength(1);
  });
});

describe("createGatewayPool — health snapshot completeness (eager init)", () => {
  it("a freshly constructed, never-called pool's snapshot enumerates every configured endpoint verbatim in order", () => {
    const endpoints = [
      "https://primary.example",
      "https://secondary.example",
      "http://localhost:1984",
    ];
    const pool = createGatewayPool({ endpoints, sleep: instantSleep });

    const snapshot = pool.getHealthSnapshot();

    // Cross-phase contract: Phase 3's pre-flight enumerates endpoints through
    // this snapshot BEFORE any call — records are eagerly initialized at
    // construction, one verbatim entry per configured endpoint in order.
    expect(snapshot.map((e) => e.endpoint)).toEqual(endpoints);
    expect(snapshot).toHaveLength(3);
  });

  it("defaults the snapshot to the single arweave.net entry when constructed with no endpoints config", () => {
    const pool = createGatewayPool({ sleep: instantSleep });

    const snapshot = pool.getHealthSnapshot();

    expect(snapshot.map((e) => e.endpoint)).toEqual(["https://arweave.net"]);
  });
});
