/**
 * upload-bundle-browser-crypto.test.ts — regression test for the
 * `apps/codex-playground` "2 files, real Arweave adapter, Confirm & Upload"
 * live throw:
 *
 *   node:crypto createHash is unavailable in the browser bundle — the
 *   Arweave/Turbo upload path hashes/signs via WebCrypto (getCryptoDriver),
 *   so this Node-only branch must not be reached in the playground.
 *
 * ROOT CAUSE (not the shim's own stated premise): `apps/codex-playground`'s
 * `crypto.shim.ts` deliberately throws on `createHash`/`createSign`, on the
 * premise that arbundles' web build only reaches Node's `crypto` from
 * `deepHash`/`hashStream`'s Node-only async-iterator/stream branch — NEVER
 * actually exercised in the playground, since every file is already read as
 * a concrete `Uint8Array` before reaching `uploadBundle`. That premise is
 * correct for `deepHash`/`hashStream`, but WRONG for a separate, always-
 * reached code path: `DataItem.prototype.sign()` (arbundles' web build,
 * `src/DataItem.js`) ends with `return this.rawId;`, and the `rawId` getter
 * is `createHash("sha256").update(this.rawSignature).digest()` —
 * UNCONDITIONALLY, regardless of the already-cached `_id` WebCrypto computed
 * moments earlier in the SAME method. `bundleAndSignData`'s own per-item
 * loop (`d.isSigned() ? d.rawId : await sign(d, signer)`) hits the identical
 * getter for every item this module had already signed. So `uploadBundle`'s
 * OLD implementation — `await item.sign(signer)` then `bundleAndSignData(...)`
 * then reading `item.id`/`manifestItem.id` — reached this getter NINE times
 * for a 2-file bundle (3 items x [item.sign()'s internal rawId read +
 * bundleAndSignData's rawId read + this module's own .id read]), and ANY ONE
 * of those is enough to throw under the browser-aliased `crypto` shim.
 *
 * This is NOT a stream/async-iterator input-shape bug — every file byte
 * entering `uploadBundle` is already a concrete `Uint8Array`
 * (`realArweaveAdapter.ts`'s `files.map(async (file) => ({ ...,
 * data: new Uint8Array(await file.arrayBuffer()), ... }))`), confirmed by
 * reading `createData`/`bundleAndSignData` end-to-end: neither ever
 * constructs or receives a stream for this call shape.
 *
 * REPRODUCTION MECHANISM: `vi.mock`/`vi.importActual` CANNOT reproduce the
 * live throw here — Vitest's SSR module graph externalizes `node_modules`
 * dependencies for this package (`vitest.config.ts` inlines none), so
 * `arbundles` (and its internal `import { createHash } from "crypto"`) is
 * loaded through Node's OWN native resolver/loader, completely bypassing
 * Vite's mock virtualization for that module and its whole subgraph —
 * confirmed empirically while building this test (neither mocking `crypto`
 * nor `arbundles`, however constructed, ever intercepted arbundles' internal
 * `crypto` import). `tests/support/crypto-shim-loader.mjs` installs a REAL
 * Node `module.register()` ESM loader hook instead — one level below
 * Vitest/Vite — reproducing the exact TWO resolutions
 * `apps/codex-playground/vite.config.ts` applies for the real (non-mocked)
 * adapter: `crypto`/`node:crypto` -> the fail-loud shim, and `arbundles` ->
 * its own `browser` package-export condition's target
 * (`build/web/esm/webIndex.js`).
 */

import { describe, it, expect } from "vitest";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";
import type { UploadGatewayApi, UploadGatewayApiFactory, ChunkedUploader } from "../src/upload/nativeUpload.js";
import type Transaction from "arweave/node/lib/transaction";

const instantSleep = async () => {};
const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
const PRICE = "1000000000";
const CAP = 1000000000000n;

class FakeChunkedUploader implements ChunkedUploader {
  private chunkIndex = 0;
  constructor(private readonly totalChunks = 1) {}
  get isComplete(): boolean {
    return this.chunkIndex === this.totalChunks;
  }
  async uploadChunk(): Promise<void> {
    this.chunkIndex++;
  }
}

function makeFakeFactory(): UploadGatewayApiFactory {
  return (_endpoint: string): UploadGatewayApi => ({
    async getAnchor() {
      return ANCHOR;
    },
    async getPrice() {
      return PRICE;
    },
    async getUploader(_tx: Transaction) {
      return new FakeChunkedUploader(1);
    },
  });
}

describe("uploadBundle under the playground's browser-aliased crypto shim", () => {
  it("does not throw 'node:crypto createHash is unavailable' for a 2-file bundle", async () => {
    // Installed here (inside the test body, BEFORE the dynamic imports below)
    // rather than at module top-level: ES module static imports are resolved
    // and evaluated before any of a module's own top-level statements run, so
    // a `register()` call ahead of a STATIC `import { uploadBundle } from
    // "../src/upload/bundle.js"` would be too late — `bundle.ts`'s own
    // (static) `import ... from "arbundles"` would already have resolved
    // through the loader chain as it stood before `register()` ran. Dynamic
    // `import()`, performed only after `register()` below, guarantees the
    // hook is active for every subsequent resolution this test triggers.
    register(
      pathToFileURL(resolvePath(__dirname, "support/crypto-shim-loader.mjs")).href,
      pathToFileURL(__filename).href,
    );

    const { uploadBundle } = await import("../src/upload/bundle.js");
    const { createGatewayPool } = await import("../src/gateway/pool.js");

    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });

    const result = await uploadBundle(
      pool,
      {
        jwk: TEST_KEYFILE,
        files: [
          { path: "a.txt", data: new TextEncoder().encode("file a"), contentType: "text/plain" },
          { path: "b.txt", data: new TextEncoder().encode("file b"), contentType: "text/plain" },
        ],
        maxRewardWinston: CAP,
        category: "nft-data",
        assetType: "image",
        encrypted: false,
      },
      { apiFactory: makeFakeFactory() },
    );

    expect(result.manifestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.fileIds).toHaveLength(2);
    for (const entry of result.fileIds) {
      expect(entry.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});
