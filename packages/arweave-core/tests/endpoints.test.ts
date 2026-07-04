/**
 * endpoints.test.ts — the package-wide origin-only endpoint policy.
 *
 * arweave-js builds request URLs as `protocol://host:port/{route}` with NO
 * path-prefix support, so a path/query/fragment endpoint can never serve the
 * transfer path. Rather than let reads silently accept what transfers reject,
 * the WHOLE package enforces origin-only endpoints via `assertOriginOnlyEndpoints`.
 *
 * These tests lock the predicate `sendTransfer`/`getBalance`/`getTransactionStatus`
 * and the tx endpoint-client factory all delegate to:
 *   - clean origins pass (https, http-localhost with port, explicit ports, trailing slash)
 *   - a non-root path/query/fragment endpoint throws UnsupportedEndpointError
 *     carrying the offending endpoint verbatim in a structured field
 */

import { describe, it, expect } from "vitest";
import {
  assertOriginOnlyEndpoints,
  UnsupportedEndpointError,
} from "../src/endpoints.js";

describe("assertOriginOnlyEndpoints — clean origins pass", () => {
  it("accepts a plain https origin with no path", () => {
    expect(() =>
      assertOriginOnlyEndpoints(["https://arweave.net"]),
    ).not.toThrow();
  });

  it("accepts a trailing-slash-only origin (root path is not a real path)", () => {
    // `https://arweave.net/` parses to pathname "/" — the empty root, which
    // arweave-js appends routes to directly. It must be accepted so the common
    // canonical form is not rejected.
    expect(() =>
      assertOriginOnlyEndpoints(["https://arweave.net/"]),
    ).not.toThrow();
  });

  it("accepts a self-run http gateway on localhost with an explicit port", () => {
    // http://localhost:1984 is the legitimate self-run gateway use case — the
    // policy is about path/query/fragment, never scheme or port.
    expect(() =>
      assertOriginOnlyEndpoints(["http://localhost:1984"]),
    ).not.toThrow();
  });

  it("accepts an explicit non-default https port", () => {
    expect(() =>
      assertOriginOnlyEndpoints(["https://gw.example:8443"]),
    ).not.toThrow();
  });

  it("accepts a multi-endpoint list where every entry is a clean origin", () => {
    expect(() =>
      assertOriginOnlyEndpoints([
        "https://arweave.net",
        "https://gw.example:8443/",
        "http://localhost:1984",
      ]),
    ).not.toThrow();
  });
});

describe("assertOriginOnlyEndpoints — pathed/query/fragment endpoints throw", () => {
  it("throws UnsupportedEndpointError for an endpoint with a non-root path", () => {
    // A path prefix would be silently dropped by arweave-js's baseURL builder,
    // posting money-moving transactions to the wrong URL.
    expect(() =>
      assertOriginOnlyEndpoints(["https://gw.example/api"]),
    ).toThrow(UnsupportedEndpointError);
  });

  it("carries the offending endpoint verbatim in a structured field (not just the message)", () => {
    try {
      assertOriginOnlyEndpoints(["https://gw.example/api/v2"]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedEndpointError);
      // Consumers inspect the field, never parse the message.
      expect((err as UnsupportedEndpointError).endpoint).toBe(
        "https://gw.example/api/v2",
      );
      expect((err as UnsupportedEndpointError).name).toBe(
        "UnsupportedEndpointError",
      );
    }
  });

  it("throws for an endpoint carrying a query string", () => {
    expect(() =>
      assertOriginOnlyEndpoints(["https://gw.example?token=abc"]),
    ).toThrow(UnsupportedEndpointError);
  });

  it("throws for an endpoint carrying embedded credentials (userinfo)", () => {
    // A credentialed endpoint is served inconsistently: the tx path rebuilds the
    // arweave-js instance from {protocol,host,port} alone (dropping credentials),
    // while the raw-fetch reads path preserves user:pass@ in the URL — the exact
    // reads-accept-what-transfers-reject divergence the policy forbids. Userinfo
    // does not appear in pathname/search/hash, so it must be checked explicitly.
    expect(() =>
      assertOriginOnlyEndpoints(["https://user:pass@arweave.net"]),
    ).toThrow(UnsupportedEndpointError);
    expect(() =>
      assertOriginOnlyEndpoints(["https://user@arweave.net"]),
    ).toThrow(UnsupportedEndpointError);
  });

  it("throws for an endpoint carrying a fragment", () => {
    expect(() =>
      assertOriginOnlyEndpoints(["https://gw.example/#frag"]),
    ).toThrow(UnsupportedEndpointError);
  });

  it("throws on the FIRST offending endpoint in a mixed list, naming that endpoint", () => {
    try {
      assertOriginOnlyEndpoints([
        "https://clean.example",
        "https://pathed.example/api",
        "https://also-pathed.example/x",
      ]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as UnsupportedEndpointError).endpoint).toBe(
        "https://pathed.example/api",
      );
    }
  });

  it("propagates the offending endpoint even when it is otherwise unparseable-looking but URL-valid", () => {
    // A bare path segment after the host is the canonical rejection case.
    expect(() =>
      assertOriginOnlyEndpoints(["https://gw.example/wallet"]),
    ).toThrow(UnsupportedEndpointError);
  });
});
