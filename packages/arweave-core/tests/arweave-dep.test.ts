/**
 * arweave-dep.test.ts — interop smoke test for the sole runtime dependency.
 *
 * arweave-js 1.15.7 is a CommonJS package: `main` = `./node/index.js` does
 * `module.exports = Arweave` (a class with a static `init`), its types are
 * declared via `export = Arweave` in `node/index.d.ts`, and it ships NO
 * `exports` field. Under this repo's ESM + `moduleResolution: bundler`
 * toolchain the ONLY correct runtime import form is the default import
 * (`import Arweave from "arweave"`) resolved through `esModuleInterop`.
 *
 * This suite is the phase's canary for that CJS/ESM boundary: if the default
 * import ever fails to yield the class (interop trap) or the static `init`
 * ever stops constructing an instance with the expected member surface, this
 * fails here — cheaper than discovering it inside the signer or transfer path.
 *
 * arweave-js's Api config defaults to 127.0.0.1/http (NOT arweave.net), so the
 * host MUST be passed explicitly; the getConfig() assertion pins that the
 * explicit host actually reaches the instance. Construction only — no network.
 */

import { describe, it, expect } from "vitest";
import Arweave from "arweave";

describe("arweave dependency interop (CJS default-import under ESM/bundler)", () => {
  it("resolves the default import to a class exposing a static init", () => {
    expect(typeof Arweave).toBe("function");
    expect(typeof (Arweave as { init?: unknown }).init).toBe("function");
  });

  it("constructs an instance via Arweave.init with the consensus-critical member surface as functions", () => {
    const instance = Arweave.init({
      host: "arweave.net",
      protocol: "https",
      port: 443,
    });

    expect(typeof instance.transactions.sign).toBe("function");
    expect(typeof instance.transactions.post).toBe("function");
    expect(typeof instance.transactions.getStatus).toBe("function");
    expect(typeof instance.wallets.getBalance).toBe("function");
    expect(typeof instance.createTransaction).toBe("function");
  });

  it("reflects the explicitly-passed host through the instance api config", () => {
    const instance = Arweave.init({
      host: "arweave.net",
      protocol: "https",
      port: 443,
    });

    const config = instance.api.getConfig();

    expect(config.host).toBe("arweave.net");
    expect(config.protocol).toBe("https");
    expect(config.port).toBe(443);
  });
});
