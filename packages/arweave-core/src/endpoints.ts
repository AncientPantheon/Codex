/**
 * Package-wide ORIGIN-ONLY endpoint policy.
 *
 * arweave-js builds request URLs as `protocol://host:port/{route}` with NO
 * path-prefix support (lib/api.js), so a gateway endpoint carrying a path,
 * query, or fragment can never be served correctly on the transfer path — the
 * prefix would be silently dropped and a money-moving transaction posted to the
 * wrong URL. Rather than let reads accept what transfers reject, the WHOLE
 * package enforces origin-only endpoints: `sendTransfer`, `getBalance`, and
 * `getTransactionStatus` all run `assertOriginOnlyEndpoints` over the pool's
 * configured endpoint list BEFORE the first pool attempt. A path/query/fragment
 * endpoint is a deterministic caller-config error, surfaced UNWRAPPED with zero
 * pool attempts — never a transient failure that burns the retry schedule.
 *
 * A trailing-slash-only path (`https://arweave.net/`) is acceptable: its parsed
 * pathname is the empty root `/`, which arweave-js appends routes to directly.
 */

/**
 * Thrown when a gateway endpoint URL carries a non-root path, a query string,
 * or a fragment — a shape the origin-only request model cannot serve.
 *
 * Follows the family typed-error shape: extends `Error`, overrides a readonly
 * `name`, restores the prototype chain in the constructor, and carries the
 * offending endpoint verbatim in a structured field so consumers never parse
 * the message. The endpoint is caller-supplied gateway config (a URL), never
 * key material — safe to carry and log.
 */
export class UnsupportedEndpointError extends Error {
  public override readonly name = "UnsupportedEndpointError";

  /** The offending endpoint URL, verbatim. */
  public readonly endpoint: string;

  constructor(endpoint: string) {
    super(
      `Unsupported gateway endpoint: ${endpoint} — endpoints must be origin-only ` +
        `(no path, query, or fragment; a trailing slash is allowed).`,
    );
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    this.endpoint = endpoint;
  }
}

/** Whether a single endpoint URL is origin-only (no non-root path, no query, no
 *  fragment, and no embedded credentials). A trailing-slash-only path counts as
 *  the empty root.
 *
 *  Userinfo (`user:pass@host`) is rejected because the tx path reconstructs the
 *  arweave-js instance from `{protocol, host, port}` alone — silently DROPPING
 *  credentials — while the raw-fetch reads path string-concatenates the verbatim
 *  base, PRESERVING them. That divergence (reads sending credentials the tx path
 *  drops) is exactly what the origin-only policy exists to prevent, so a
 *  credentialed endpoint is not origin-only. */
function isOriginOnly(endpoint: string): boolean {
  const url = new URL(endpoint);
  const hasPath = url.pathname !== "" && url.pathname !== "/";
  const hasQuery = url.search !== "";
  const hasFragment = url.hash !== "";
  const hasCredentials = url.username !== "" || url.password !== "";
  return !hasPath && !hasQuery && !hasFragment && !hasCredentials;
}

/**
 * Assert every endpoint in the list is origin-only. Throws
 * `UnsupportedEndpointError` (carrying the FIRST offending endpoint) if any
 * endpoint has a non-root path, query, or fragment. Endpoints are assumed
 * `new URL(...)`-parseable (the gateway pool validates parseability at
 * construction); this guard adds the origin-only constraint on top.
 */
export function assertOriginOnlyEndpoints(
  endpoints: readonly string[],
): void {
  for (const endpoint of endpoints) {
    if (!isOriginOnly(endpoint)) {
      throw new UnsupportedEndpointError(endpoint);
    }
  }
}
