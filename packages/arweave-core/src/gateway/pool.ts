/**
 * Arweave gateway pool — config-driven, dependency-free rotation/retry funnel.
 *
 * Generalizes the sibling stoa-js `withFailover` primary/fallback pattern
 * (stoa-core/src/network/nodeFailover.ts) to an N-endpoint ordered list, and
 * makes the pool a factory-scoped instance (config-driven per requirements)
 * rather than the sibling's module-level singleton — cleaner for tests and for
 * later multi-consumer reuse.
 *
 * Concurrency contract: the rotation cursor and per-attempt tracking are
 * PER-CALL-LOCAL, computed over an endpoint ordering snapshotted at call start.
 * The only shared instance state is the active-endpoint preference and the
 * eagerly-initialized health records (health flag transitions land in the
 * backoff/health layer). Two concurrent `execute` calls each independently try
 * every endpoint.
 *
 * This module imports NOTHING from `src/keys/` or `src/units.ts` and adds no
 * npm dependency.
 */

import {
  GatewayPoolExhaustedError,
  InvalidGatewayConfigError,
  type GatewayAttempt,
} from "./errors.js";
import { createHealthTracker } from "./health.js";
import type {
  ClearRequestTimerFn,
  EndpointHealth,
  GatewayOperation,
  GatewayPool,
  GatewayPoolConfig,
  NowFn,
  SetRequestTimerFn,
  SleepFn,
} from "./types.js";

/** Default endpoint when no config is supplied. */
const DEFAULT_ENDPOINT = "https://arweave.net";

/** Default number of attempts per endpoint. A transient hiccup on the default
 *  single-endpoint config does not terminally fail the call. */
const DEFAULT_MAX_ATTEMPTS_PER_ENDPOINT = 3;

/** Default base backoff delay (ms) between the first pair of failed attempts.
 *  Each subsequent inter-attempt wait doubles, capped at `backoffMaxMs`. */
const DEFAULT_BACKOFF_BASE_MS = 100;

/** Default cap (ms) on the exponentially-growing backoff delay. */
const DEFAULT_BACKOFF_MAX_MS = 10_000;

/** Default cooldown (ms) a failed endpoint is skipped in preferred selection
 *  before it becomes eligible again. */
const DEFAULT_HEALTH_COOLDOWN_MS = 30_000;

/** Default per-attempt request timeout (ms). A black-holed gateway (connection
 *  accepted, response never sent) is abandoned after this bound so the pool
 *  rotates instead of stalling. 15s is generous for an honest gateway read/post
 *  yet far below Node's 300s socket default that this guard replaces. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Real delay used when no `sleep` seam is injected. */
const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Real clock used when no `now` seam is injected. */
const realNow: NowFn = () => Date.now();

/** Real cancelable request-timeout timer used when no seam is injected. */
const realSetRequestTimer: SetRequestTimerFn = (onTimeout, ms) =>
  setTimeout(onTimeout, ms);

/** Real timer cancel used when no seam is injected. */
const realClearRequestTimer: ClearRequestTimerFn = (handle) => {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
};

/**
 * Create a gateway pool from the given config. Validates the config
 * SYNCHRONOUSLY: an empty endpoints array or any non-URL-parseable endpoint
 * throws `InvalidGatewayConfigError` before a pool is ever constructed.
 */
export function createGatewayPool(config: GatewayPoolConfig = {}): GatewayPool {
  const endpoints =
    config.endpoints === undefined ? [DEFAULT_ENDPOINT] : config.endpoints;

  if (endpoints.length === 0) {
    throw new InvalidGatewayConfigError("empty-endpoints");
  }
  for (const endpoint of endpoints) {
    try {
      // URL-parseability ONLY — a self-run gateway at http://localhost:1984 is
      // a legitimate use case, so no scheme allow-list.
      new URL(endpoint);
    } catch {
      throw new InvalidGatewayConfigError("invalid-endpoint-url", endpoint);
    }
  }

  const maxAttemptsPerEndpoint =
    config.maxAttemptsPerEndpoint ?? DEFAULT_MAX_ATTEMPTS_PER_ENDPOINT;
  // Same-class complement to the empty-endpoints guard: a non-positive or
  // fractional attempts count would make the retry loop never run (or mis-detect
  // the final attempt), letting the pool exhaust with an empty `attempts` array
  // — the exact "silent no-op failure" the construction guard exists to prevent.
  if (
    !Number.isInteger(maxAttemptsPerEndpoint) ||
    maxAttemptsPerEndpoint < 1
  ) {
    throw new InvalidGatewayConfigError(
      "invalid-max-attempts",
      maxAttemptsPerEndpoint,
    );
  }
  const requestTimeoutMs =
    config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  // Same-class complement to the max-attempts guard: a non-positive or fractional
  // timeout would schedule a nonsensical abort (fire-immediately or never), so it
  // is rejected at construction rather than corrupting the per-attempt bound.
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new InvalidGatewayConfigError(
      "invalid-request-timeout",
      requestTimeoutMs,
    );
  }

  const sleep = config.sleep ?? realSleep;
  const now = config.now ?? realNow;
  const setRequestTimer = config.setRequestTimer ?? realSetRequestTimer;
  const clearRequestTimer = config.clearRequestTimer ?? realClearRequestTimer;
  const backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
  const healthCooldownMs =
    config.healthCooldownMs ?? DEFAULT_HEALTH_COOLDOWN_MS;

  // Shared instance state: the health tracker (eager records, one per
  // configured endpoint in order) and the active-endpoint preference. Nothing
  // else is shared. Health re-eligibility is evaluated lazily via `now` — no
  // background timers.
  const health = createHealthTracker(endpoints, healthCooldownMs, now);
  let activeEndpoint = endpoints[0];

  /** The exponentially-growing backoff delay before the retry that follows the
   *  Nth failure within a call (N = 0 for the first failure): base, 2×base,
   *  4×base, …, capped at `backoffMaxMs`. */
  function backoffDelayFor(failureIndex: number): number {
    const uncapped = backoffBaseMs * 2 ** failureIndex;
    return Math.min(uncapped, backoffMaxMs);
  }

  async function execute<T>(operation: GatewayOperation<T>): Promise<T> {
    // Health-aware ordering snapshotted at call start: healthy endpoints first
    // (configured order → primary preferred), unhealthy ones as last resort.
    // Snapshotting per call keeps concurrent calls from corrupting each other.
    const ordering = health.orderingForCall();
    const attempts: GatewayAttempt[] = [];

    for (let attempt = 0; attempt < maxAttemptsPerEndpoint; attempt++) {
      for (const endpoint of ordering) {
        // Bound THIS attempt: an AbortController fired by the request-timeout
        // timer abandons a black-holed gateway so the loop rotates. The timer is
        // cleared on settle (success OR failure) so no timer outlives the attempt.
        const controller = new AbortController();
        const timer = setRequestTimer(() => {
          controller.abort();
        }, requestTimeoutMs);
        try {
          const result = await operation(endpoint, {
            signal: controller.signal,
          });
          // Settled in time — cancel the abort timer so it never outlives the
          // attempt (no leak, no spurious late abort).
          clearRequestTimer(timer);
          // The endpoint served the request: it is healthy again and becomes
          // the preferred start for the next call.
          health.markHealthy(endpoint);
          activeEndpoint = endpoint;
          return result;
        } catch (error) {
          // Settled (failed or aborted) — cancel the abort timer BEFORE the
          // backoff wait so no timer is armed across the sleep.
          clearRequestTimer(timer);
          // Deprioritize the failed endpoint for subsequent calls (cooldown),
          // and back off before the next attempt within THIS call.
          health.markUnhealthy(endpoint);
          const isLastAttempt =
            attempt === maxAttemptsPerEndpoint - 1 &&
            endpoint === ordering[ordering.length - 1];
          attempts.push({ endpoint, error });
          // No wait after the final failure — the call throws instead of
          // retrying. Otherwise back off exponentially via the `sleep` seam.
          if (!isLastAttempt) {
            await sleep(backoffDelayFor(attempts.length - 1));
          }
        }
      }
    }

    throw new GatewayPoolExhaustedError(operation.name || "execute", attempts);
  }

  function getHealthSnapshot(): ReadonlyArray<EndpointHealth> {
    return health.snapshot(activeEndpoint);
  }

  function getActiveEndpoint(): string {
    return activeEndpoint;
  }

  return { execute, getHealthSnapshot, getActiveEndpoint };
}
