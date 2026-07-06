import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { alias, dedupe } from "./resolve.shared";

// A transitive dep (@stoachain/stoa-core's signing path) does
// `import { Buffer } from "node:buffer"`. Vite externalizes Node builtins for the
// browser bundle, so `Buffer` resolves to nothing and the production build fails
// at bundle time ("Buffer is not exported by __vite-browser-external"). The
// `buffer` package (already in the workspace) is the browser-safe polyfill —
// aliasing the `node:buffer` (and bare `buffer`) specifier onto it supplies the
// named `Buffer` export so the app bundles for the browser.
const bufferShim = resolve(
  __dirname,
  "../../node_modules/buffer/index.js",
).replace(/\\/g, "/");

// Browser `process` polyfill for the Arweave/Turbo real-toggle path (see
// process.shim.ts). `arweave`/`@ardrive/turbo-sdk` reach for a bare `process`
// global Vite does not supply for the browser; aliasing `process` (+ the
// `node:process` specifier) onto the shim keeps the production bundle from
// failing with "process is not defined".
const processShim = resolve(__dirname, "process.shim.ts").replace(/\\/g, "/");

// `@ardrive/turbo-sdk` has NO `browser` field and its ROOT export is the NODE
// build (imports `fs`/`crypto`/`node:stream`). arweave-core's turboClient.ts
// documents the required browser story: bundler consumers MUST alias the package
// onto its `/web` export so the web build (browser crypto driver) is bundled
// instead of the Node build. This rewrites the lazy `import("@ardrive/turbo-sdk")`
// in codex-arweave's lazyDeps.ts onto the web entry. Kept alongside the
// optimizeDeps.exclude below so Turbo remains a real lazy chunk.
const turboWeb = resolve(
  __dirname,
  "../../node_modules/@ardrive/turbo-sdk/lib/esm/web/index.js",
).replace(/\\/g, "/");

// Browser `crypto` shim (see crypto.shim.ts). Turbo's `@dha-team/arbundles` web
// build statically imports `{ createHash } from "crypto"` (used only in unreachable
// Node-stream branches); Vite externalizes `crypto` to an empty stub, so the static
// `createHash` binding is missing and the build fails. The shim supplies it.
const cryptoShim = resolve(__dirname, "crypto.shim.ts").replace(/\\/g, "/");

// Browser `stream` shim (see stream.shim.ts). arbundles' web build statically
// imports `{ PassThrough, Transform } from "stream"` (Node upload path only); Vite
// externalizes `stream` to an empty stub, so the named bindings are missing.
const streamShim = resolve(__dirname, "stream.shim.ts").replace(/\\/g, "/");

export default defineConfig({
  plugins: [react()],
  // `define: { global: "globalThis" }` — D6 was Kadena-only and never bundled
  // the Node-oriented Arweave/Turbo libs, which reference a bare `global`. Vite
  // does NOT auto-polyfill `global` for the browser, so any real-toggle path that
  // loads `arweave`/Turbo would crash the bundle with "global is not defined".
  // Mapping `global` → `globalThis` supplies it. This gap is INVISIBLE to the
  // injected-fake jsdom tests (which never load real arweave/Turbo) and only
  // surfaces under `vite build` — hence the build is the load-bearing gate.
  define: {
    global: "globalThis",
  },
  resolve: {
    // Single React instance — prevents the two-React "Invalid hook call".
    dedupe,
    // Workspace-source aliases (hot reload) — codex-ui exact-match keeps the
    // `/ui.css` subpath falling through; codex-ouronet prefix resolves `/adapters`;
    // codex-arweave prefix resolves `/panel` + `/address-book` from src.
    // Prepend the node:buffer + process shims so they resolve before Vite
    // externalizes the Node builtins.
    alias: [
      { find: /^node:buffer$/, replacement: bufferShim },
      { find: /^buffer$/, replacement: bufferShim },
      { find: /^node:process$/, replacement: processShim },
      { find: /^process$/, replacement: processShim },
      // Turbo browser story: rewrite the lazy `@ardrive/turbo-sdk` import onto its
      // `/web` build so the browser crypto driver (not the Node build) is bundled.
      { find: /^@ardrive\/turbo-sdk$/, replacement: turboWeb },
      // Supply `createHash`/`createSign`/`constants` for arbundles' web build
      // (unreachable Node-only branches).
      { find: /^crypto$/, replacement: cryptoShim },
      { find: /^node:crypto$/, replacement: cryptoShim },
      // Supply `PassThrough`/`Transform` for arbundles' web build (Node upload path).
      { find: /^stream$/, replacement: streamShim },
      { find: /^node:stream$/, replacement: streamShim },
      ...alias,
    ],
  },
  optimizeDeps: {
    // Keep `@ardrive/turbo-sdk` a REAL lazy chunk. The panel reaches Turbo ONLY
    // through `await import("@ardrive/turbo-sdk")` (codex-arweave lazyDeps.ts), so
    // excluding it from dep pre-bundling preserves the code-split boundary — Turbo
    // emits its OWN chunk under `vite build` instead of being eager-inlined into the
    // entry. Do NOT also `include` Turbo here: that would eager-prebundle it and
    // fight the lazy split.
    exclude: ["@ardrive/turbo-sdk"],
    esbuildOptions: {
      // Mirror the `global` → `globalThis` mapping into the dep pre-bundle pass so
      // pre-bundled Arweave deps resolve `global` too.
      define: {
        global: "globalThis",
      },
    },
  },
});
