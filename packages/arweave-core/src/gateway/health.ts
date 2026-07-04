/**
 * Health-aware endpoint selection for the gateway pool.
 *
 * Generalizes the sibling AncientHoldings `node-selector` prefer-primary,
 * sticky failover behavior to the pool's N-endpoint list, but with a key
 * deliberate deviation: instead of a background probe/interval loop (a
 * lifecycle liability inside a headless library — the sibling needed
 * `unref?.()` to avoid pinning the Node event loop), health re-eligibility is
 * evaluated LAZILY at selection time via an injected `now()` clock. An endpoint
 * marked unhealthy carries a cooldown deadline; once `now()` reaches it, the
 * endpoint is eligible again with zero timers.
 *
 * This module imports NOTHING from `src/keys/` or `src/units.ts` and adds no
 * npm dependency.
 */

import type { EndpointHealth, NowFn } from "./types.js";

/** Internal, mutable health record. One per configured endpoint, in order.
 *  `unhealthyUntil` is the clock value at/after which the endpoint becomes
 *  eligible again; `null` means the endpoint is currently healthy. */
interface HealthRecord {
  readonly endpoint: string;
  unhealthyUntil: number | null;
}

/** The health tracker's surface: the pool consults it for ordering and
 *  transitions endpoint state, and exposes its snapshot verbatim. */
export interface HealthTracker {
  /**
   * The endpoint ordering a call should start from: currently-healthy
   * endpoints in CONFIGURED order (so the first configured endpoint — the
   * primary — is preferred when healthy), followed by currently-unhealthy
   * endpoints (also in configured order) as a LAST RESORT so a single call
   * still attempts every endpoint before exhausting.
   */
  orderingForCall(): string[];

  /** Mark an endpoint unhealthy, skipped in preferred selection until
   *  `now() + cooldownMs`. Idempotent per call. */
  markUnhealthy(endpoint: string): void;

  /** Mark an endpoint healthy again (clears any cooldown) — called when an
   *  operation against it succeeds. */
  markHealthy(endpoint: string): void;

  /** Whether the endpoint is currently eligible (healthy or past cooldown). */
  isHealthy(endpoint: string): boolean;

  /** Per-endpoint frozen snapshot: one entry per CONFIGURED endpoint, verbatim
   *  string, in configured order. `active` is computed against the supplied
   *  active endpoint. */
  snapshot(activeEndpoint: string): ReadonlyArray<EndpointHealth>;
}

/**
 * Create a health tracker over the configured endpoints. Records are eagerly
 * initialized (one per endpoint, in order, all healthy) so the snapshot is
 * complete from construction, before any call.
 */
export function createHealthTracker(
  endpoints: readonly string[],
  cooldownMs: number,
  now: NowFn,
): HealthTracker {
  const records: HealthRecord[] = endpoints.map((endpoint) => ({
    endpoint,
    unhealthyUntil: null,
  }));

  function recordFor(endpoint: string): HealthRecord | undefined {
    return records.find((r) => r.endpoint === endpoint);
  }

  function isHealthy(endpoint: string): boolean {
    const record = recordFor(endpoint);
    if (record === undefined || record.unhealthyUntil === null) return true;
    // Lazy cooldown: the endpoint is eligible again once the clock reaches the
    // deadline. Clear the deadline so subsequent checks are cheap.
    if (now() >= record.unhealthyUntil) {
      record.unhealthyUntil = null;
      return true;
    }
    return false;
  }

  function orderingForCall(): string[] {
    const healthy: string[] = [];
    const unhealthy: string[] = [];
    for (const record of records) {
      if (isHealthy(record.endpoint)) healthy.push(record.endpoint);
      else unhealthy.push(record.endpoint);
    }
    // Healthy endpoints first (configured order → primary preferred), then the
    // unhealthy ones as last resort so every endpoint is still attempted.
    return [...healthy, ...unhealthy];
  }

  function markUnhealthy(endpoint: string): void {
    const record = recordFor(endpoint);
    if (record === undefined) return;
    record.unhealthyUntil = now() + cooldownMs;
  }

  function markHealthy(endpoint: string): void {
    const record = recordFor(endpoint);
    if (record === undefined) return;
    record.unhealthyUntil = null;
  }

  function snapshot(activeEndpoint: string): ReadonlyArray<EndpointHealth> {
    return records.map((record) =>
      Object.freeze({
        endpoint: record.endpoint,
        healthy: isHealthy(record.endpoint),
        active: record.endpoint === activeEndpoint,
      }),
    );
  }

  return {
    orderingForCall,
    markUnhealthy,
    markHealthy,
    isHealthy,
    snapshot,
  };
}
