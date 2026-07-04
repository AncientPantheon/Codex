/**
 * Per-endpoint arweave-js client factory.
 *
 * The transfer path fetches anchors/prices and posts transactions through
 * arweave-js. Its `Api` builds request URLs as `protocol://host:port/{route}`
 * (lib/api.js) and its config defaults are `127.0.0.1`/`http` — so ANY field
 * left unset silently targets localhost instead of the pool's gateway. This
 * factory therefore parses the pool's endpoint URL and constructs the instance
 * with EXPLICIT `protocol`, `host`, and `port`; omitting any of them is a
 * consensus-relevant footgun, not a convenience default.
 *
 * Because arweave-js has no path-prefix support, an endpoint carrying a
 * non-root path, query, or fragment can never be served correctly — it is
 * rejected here (defense-in-depth) via the SHARED `UnsupportedEndpointError`
 * from `../endpoints.js`. The primary enforcement is the eager pre-flight in
 * the transfer/read paths; this guard is the second line so a mis-configured
 * endpoint can never mint a mis-targeted client.
 *
 * Instances are cached per endpoint so repeated pool operations on the same
 * gateway reuse one client. The cache is FACTORY-SCOPED — created by
 * `createEndpointClientFactory` and closed over — so its lifetime is tied to
 * its consumer with no process-lifetime module global and no other shared
 * state.
 */

import Arweave from "arweave";
import { assertOriginOnlyEndpoints } from "../endpoints.js";

/** An arweave-js instance, as produced by `Arweave.init`. */
export type ArweaveInstance = ReturnType<typeof Arweave.init>;

/** Default port for a protocol when the endpoint URL omits an explicit one. */
function defaultPortFor(protocol: string): number {
  return protocol === "https" ? 443 : 80;
}

/**
 * Construct an arweave-js instance targeting a single pool endpoint.
 *
 * Rejects a non-origin-only endpoint (non-root path, query, or fragment) with
 * the shared `UnsupportedEndpointError`. The endpoint is assumed
 * `new URL(...)`-parseable (the gateway pool validates parseability at
 * construction); this factory adds the origin-only constraint on top.
 *
 * Port is passed as a NUMBER so the instance's api config reports it as a
 * number (matching arweave-js's own default resolution), never the raw URL
 * port string.
 */
export function arweaveForEndpoint(endpointBaseUrl: string): ArweaveInstance {
  assertOriginOnlyEndpoints([endpointBaseUrl]);

  const url = new URL(endpointBaseUrl);
  const protocol = url.protocol.replace(/:$/, "");
  const host = url.hostname;
  const port = url.port === "" ? defaultPortFor(protocol) : Number(url.port);

  return Arweave.init({ protocol, host, port });
}

/**
 * A factory that maps an endpoint base URL to a cached arweave-js instance:
 * the same endpoint string yields the same instance; different endpoints yield
 * different instances.
 */
export type EndpointClientFactory = (
  endpointBaseUrl: string,
) => ArweaveInstance;

/**
 * Create a factory-scoped endpoint-client cache. Each call returns an
 * independent factory with its own cache, so cache lifetime is tied to the
 * consumer that created it — there is no shared process-lifetime state and two
 * factories never share instances.
 */
export function createEndpointClientFactory(): EndpointClientFactory {
  const cache = new Map<string, ArweaveInstance>();

  return (endpointBaseUrl: string): ArweaveInstance => {
    const cached = cache.get(endpointBaseUrl);
    if (cached !== undefined) {
      return cached;
    }

    const instance = arweaveForEndpoint(endpointBaseUrl);
    cache.set(endpointBaseUrl, instance);
    return instance;
  };
}
