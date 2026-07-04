/**
 * turbo-dep.test.ts — interop smoke test for the @ardrive/turbo-sdk dependency.
 *
 * @ardrive/turbo-sdk 1.42.0 is the OPPOSITE packaging shape from arweave-js:
 * it is `type: "module"` WITH an `exports` map (`.`/`./node` → the Node build,
 * `./web` → the web build) and NO `browser` field. Under this repo's ESM +
 * `moduleResolution: bundler` toolchain the root specifier resolves to the Node
 * build, so named ESM imports (`import { TurboFactory, ArweaveSigner }`) are the
 * correct runtime form — arweave-js's CJS default-import findings do NOT transfer.
 *
 * This suite is the phase's canary for that ESM-exports-map boundary: if the
 * named imports ever fail to resolve, if the factory's static methods stop being
 * functions, if `new ArweaveSigner(jwk)` stops constructing, or if the
 * authenticated client stops exposing the `upload`/`uploadFile` members the
 * upload path (T4.3) builds on, it fails HERE — cheaper than discovering it
 * deep in the upload orchestration.
 *
 * Construction only: no upload, no network. The signer is fed the committed
 * Phase 2 fixture JWK (9-field ArweaveJwk, assignment-compatible with turbo's
 * ArweaveJWK/JWKInterface). The address it derives is never funded.
 */

import { describe, it, expect } from "vitest";
import { TurboFactory, ArweaveSigner } from "@ardrive/turbo-sdk";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

describe("turbo-sdk dependency interop (ESM named imports under exports-map/bundler)", () => {
  it("resolves the named imports to a factory object and a signer constructor", () => {
    expect(typeof TurboFactory).toBe("function");
    expect(typeof ArweaveSigner).toBe("function");
  });

  it("exposes TurboFactory.authenticated and TurboFactory.unauthenticated as functions", () => {
    expect(typeof TurboFactory.authenticated).toBe("function");
    expect(typeof TurboFactory.unauthenticated).toBe("function");
  });

  it("constructs an ArweaveSigner from the Phase 2 fixture JWK without throwing", () => {
    const signer = new ArweaveSigner(TEST_KEYFILE);

    expect(signer).toBeInstanceOf(ArweaveSigner);
  });

  it("builds an authenticated client from the fixture JWK exposing upload + uploadFile as functions", () => {
    const client = TurboFactory.authenticated({
      privateKey: TEST_KEYFILE,
      token: "arweave",
    });

    expect(typeof client.upload).toBe("function");
    expect(typeof client.uploadFile).toBe("function");
  });
});
