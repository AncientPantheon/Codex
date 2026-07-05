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

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Single React instance — prevents the two-React "Invalid hook call".
    dedupe,
    // Workspace-source aliases (hot reload) — codex-ui exact-match keeps the
    // `/ui.css` subpath falling through; codex-ouronet prefix resolves `/adapters`.
    // Prepend the node:buffer shim so it resolves before Vite externalizes it.
    alias: [
      { find: /^node:buffer$/, replacement: bufferShim },
      { find: /^buffer$/, replacement: bufferShim },
      ...alias,
    ],
  },
});
