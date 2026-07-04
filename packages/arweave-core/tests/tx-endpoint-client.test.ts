/**
 * tx-endpoint-client.test.ts — the per-endpoint arweave-js client factory.
 *
 * The transfer path posts through arweave-js, whose Api builds request URLs as
 * `protocol://host:port/{route}` and whose config defaults are 127.0.0.1/http
 * (NOT arweave.net) — so any field left unset silently targets localhost. The
 * factory therefore MUST parse the pool's endpoint URL and construct the
 * instance with EXPLICIT protocol/host/port; these tests pin that the parsed
 * values reach the instance's api config verbatim.
 *
 * arweave-js has no path-prefix support, so a pathed/query/fragment endpoint is
 * rejected (defense-in-depth) via the SHARED `UnsupportedEndpointError` from
 * `../src/endpoints.js` — not a second local class.
 *
 * Instances are cached per normalized endpoint so repeated pool operations on
 * the same endpoint reuse one client; the cache is factory-scoped, not a
 * process-lifetime global. Construction only — no network anywhere.
 */

import { describe, it, expect } from "vitest";
import {
  createEndpointClientFactory,
  arweaveForEndpoint,
} from "../src/tx/endpointClient.js";
import { UnsupportedEndpointError } from "../src/endpoints.js";

describe("arweaveForEndpoint — explicit protocol/host/port reach the instance", () => {
  it("parses an https origin to protocol https, host arweave.net, default port 443", () => {
    // A bare https URL has no explicit port; the factory must supply the
    // protocol default (443) — leaving it unset would default to arweave-js's
    // 127.0.0.1/http/80 and post to localhost.
    const config = arweaveForEndpoint("https://arweave.net").api.getConfig();

    expect(config.protocol).toBe("https");
    expect(config.host).toBe("arweave.net");
    expect(config.port).toBe(443);
  });

  it("parses an http localhost origin with explicit port to http/localhost/1984", () => {
    // The self-run gateway use case: http://localhost:1984 must round-trip its
    // explicit port unchanged so config-only gateway switching keeps working.
    const config = arweaveForEndpoint("http://localhost:1984").api.getConfig();

    expect(config.protocol).toBe("http");
    expect(config.host).toBe("localhost");
    expect(config.port).toBe(1984);
  });

  it("supplies the http protocol default port (80) when no port is present", () => {
    const config = arweaveForEndpoint("http://gw.example").api.getConfig();

    expect(config.protocol).toBe("http");
    expect(config.host).toBe("gw.example");
    expect(config.port).toBe(80);
  });

  it("respects an explicit non-default https port over the protocol default", () => {
    // An explicit :8443 must win over the 443 https default — otherwise the
    // factory would silently post to the wrong port.
    const config = arweaveForEndpoint("https://gw.example:8443").api.getConfig();

    expect(config.protocol).toBe("https");
    expect(config.host).toBe("gw.example");
    expect(config.port).toBe(8443);
  });

  it("accepts a trailing-slash-only origin (root path is not a real path)", () => {
    const config = arweaveForEndpoint("https://arweave.net/").api.getConfig();

    expect(config.protocol).toBe("https");
    expect(config.host).toBe("arweave.net");
    expect(config.port).toBe(443);
  });
});

describe("arweaveForEndpoint — origin-only guard (shared UnsupportedEndpointError)", () => {
  it("throws UnsupportedEndpointError for an endpoint with a non-root path", () => {
    // arweave-js drops the path prefix silently; a money-moving post would hit
    // the wrong URL. The factory must reject rather than mis-target.
    expect(() => arweaveForEndpoint("https://gw.example/api")).toThrow(
      UnsupportedEndpointError,
    );
  });

  it("carries the offending endpoint verbatim in the shared error's structured field", () => {
    try {
      arweaveForEndpoint("https://gw.example/api/v2");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedEndpointError);
      expect((err as UnsupportedEndpointError).endpoint).toBe(
        "https://gw.example/api/v2",
      );
    }
  });

  it("throws UnsupportedEndpointError for an endpoint carrying a query string", () => {
    expect(() => arweaveForEndpoint("https://gw.example?token=abc")).toThrow(
      UnsupportedEndpointError,
    );
  });

  it("throws UnsupportedEndpointError for an endpoint carrying a fragment", () => {
    expect(() => arweaveForEndpoint("https://gw.example/#frag")).toThrow(
      UnsupportedEndpointError,
    );
  });
});

describe("createEndpointClientFactory — factory-scoped caching by normalized endpoint", () => {
  it("returns the SAME instance for the same endpoint string (cache hit)", () => {
    // Repeated pool operations on one endpoint must reuse a single client
    // rather than mint a new arweave-js instance per attempt.
    const factory = createEndpointClientFactory();
    const first = factory("https://arweave.net");
    const second = factory("https://arweave.net");

    expect(second).toBe(first);
  });

  it("returns DIFFERENT instances for different endpoints", () => {
    const factory = createEndpointClientFactory();
    const a = factory("https://arweave.net");
    const b = factory("https://gw.example:8443");

    expect(b).not.toBe(a);
    expect(a.api.getConfig().host).toBe("arweave.net");
    expect(b.api.getConfig().host).toBe("gw.example");
  });

  it("scopes the cache to the factory instance — two factories do not share clients", () => {
    // The cache lifetime is tied to its consumer (factory), not a module global,
    // so an independent factory constructs its own instance for the same endpoint.
    const factoryA = createEndpointClientFactory();
    const factoryB = createEndpointClientFactory();

    const fromA = factoryA("https://arweave.net");
    const fromB = factoryB("https://arweave.net");

    expect(fromB).not.toBe(fromA);
  });

  it("still enforces the origin-only guard through the factory", () => {
    const factory = createEndpointClientFactory();

    expect(() => factory("https://gw.example/api")).toThrow(
      UnsupportedEndpointError,
    );
  });
});
