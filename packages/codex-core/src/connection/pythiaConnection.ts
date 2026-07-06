/**
 * `createPythiaConnection` (CL-02) — a thin, KEYLESS REST client that mirrors the
 * Pythia gateway wire surface.
 *
 *   read  → POST {baseUrl}/{chainId}/read   (body = the opaque read query)
 *   send  → POST {baseUrl}/{chainId}/send   (body = the caller-SIGNED tx)
 *   poll  → POST {baseUrl}/{chainId}/poll   (body = the opaque tx ref)
 *   health→ GET  {baseUrl}/healthz
 *
 * codex-core does NOT depend on `@ancientpantheon/pythia-client`: the leaf package
 * mirrors the REST shape rather than taking a cross-repo dependency. `fetchFn` is
 * injectable (defaults to the runtime global `fetch`) so tests use a fake — no
 * real network.
 *
 * COVERAGE ASSUMPTION: the Pythia `/healthz` snapshot does not (today) carry an
 * explicit chain list — it reports `{ service, active, routing, sources }`. So
 * `coveredChains` is derived tolerantly:
 *   1. if the body carries an explicit `coveredChains` (or `chains`) string
 *      array, it is honoured VERBATIM (future-proofs the day Pythia advertises
 *      its chains);
 *   2. otherwise, when the service reports live (`service === "ok"` or a truthy
 *      `reachable`), coverage falls back to the single `chainId` this connection
 *      was configured for.
 * Coverage is READ from the response — never a fixed hardcoded chain list.
 */

import type {
  ChainConnection,
  ConnectionHealth,
  ConnectionPollResult,
  FetchLike,
} from "./types.js";

/** Options for {@link createPythiaConnection}. */
export interface PythiaConnectionOptions {
  /** The Pythia gateway base URL (a trailing slash is tolerated). */
  baseUrl: string;
  /** The chain this connection targets — the `{chainId}` route prefix. */
  chainId: string;
  /** Injected fetch; defaults to the runtime global `fetch`. */
  fetchFn?: FetchLike;
}

/** Read `coveredChains`/`chains` off an opaque healthz body if it is a string[]. */
function explicitCoverage(body: unknown): string[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const candidate = record.coveredChains ?? record.chains;
  if (Array.isArray(candidate) && candidate.every((c) => typeof c === "string")) {
    return candidate as string[];
  }
  return undefined;
}

/** True if the healthz body self-reports the service as live. */
function reportsLive(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  return record.service === "ok" || record.reachable === true;
}

/**
 * True if EVERY per-key poll result is `final`. Tolerant of the Pythia
 * `{ results: { <key>: { status } } }` shape; an absent/empty results map is
 * treated as not-yet-final (`pending`).
 */
function allFinal(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const results = (body as Record<string, unknown>).results;
  if (typeof results !== "object" || results === null) return false;
  const entries = Object.values(results as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(
    (r) =>
      typeof r === "object" &&
      r !== null &&
      (r as Record<string, unknown>).status === "final",
  );
}

/**
 * Create a Pythia-backed `ChainConnection`. Keyless: `read`/`send`/`poll` relay
 * the caller's opaque payload verbatim; no key/seed parameter exists.
 */
export function createPythiaConnection(
  options: PythiaConnectionOptions,
): ChainConnection {
  const { chainId } = options;
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetchFn: FetchLike =
    options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);

  async function postJson(route: string, payload: unknown): Promise<unknown> {
    const response = await fetchFn(`${base}/${chainId}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }

  return {
    chainId,

    read(query: unknown): Promise<unknown> {
      return postJson("read", query);
    },

    send(signedTx: unknown): Promise<unknown> {
      return postJson("send", signedTx);
    },

    async poll(ref: unknown): Promise<ConnectionPollResult> {
      const body = await postJson("poll", ref);
      return { status: allFinal(body) ? "final" : "pending", detail: body };
    },

    async health(): Promise<ConnectionHealth> {
      const response = await fetchFn(`${base}/healthz`, { method: "GET" });
      if (!response.ok) {
        return { reachable: false, coveredChains: [] };
      }
      const body = await response.json();
      const explicit = explicitCoverage(body);
      const coveredChains = explicit ?? (reportsLive(body) ? [chainId] : []);
      return { reachable: true, coveredChains };
    },
  };
}
