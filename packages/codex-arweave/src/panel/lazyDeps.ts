/**
 * The heavy-runtime LAZY BOUNDARY for the Arweave panel (E-12 / N-08 — FIX-2).
 *
 * The panel `./panel` subpath is the HEAVY entry: this module is the single
 * place the heavy protocol runtime is reached, so a LIGHT consumer (the `.`
 * root, the `./address-book` subpath) never transits it and stays tree-shakeable.
 *
 * `arweave` is reached STATICALLY via `createArweaveAdapter` (arweave-core's
 * `sendTransfer`/`uploadData` edge); it is part of the heavy entry by design and
 * is correctly retained in the panel bundle while a light consumer tree-shakes
 * it away.
 *
 * HISTORY (browser-safe-release, 2026-11): this module also used to export
 * `loadTurbo()` / `TurboSdkModule`, a dynamic `import("@ardrive/turbo-sdk")`
 * whose stated purpose was to DEMONSTRATE that Turbo was reachable only behind
 * a dynamic import. Nothing ever called it — the real upload path is arbundles
 * ANS-104 through arweave-core (`uploadData`/`uploadBundle`), which has zero
 * Turbo references. A dynamic `import()` is not an escape hatch: a bundler must
 * still RESOLVE the specifier and emit a browser chunk for it, which is exactly
 * how it broke a consumer's Turbopack build on 1.6.0
 * (`node:stream/promises` ← `@ardrive/turbo-sdk/lib/esm/node/index.js`). The
 * specifier was deleted from the graph entirely rather than re-pointed at a
 * subpath; `packages/codex/scripts/browser-safety-guard.mjs` now fails the
 * build if any published entry needs a Node-only builtin in a browser bundle.
 */

import {
  createArweaveAdapter,
  type ArweaveAdapterDeps,
} from "../adapter/index.js";

/**
 * Build the DEFAULT heavy Arweave adapter runtime (the static `arweave` edge)
 * for a consumer that does not inject its own. Reaching this composes
 * arweave-core's `sendTransfer`/`uploadData` (hence the bare `arweave` package
 * and its arbundles ANS-104 upload path). Kept on the `./panel` subpath so it is
 * part of the heavy entry, never the light root.
 */
export function createDefaultArweaveRuntime(deps: ArweaveAdapterDeps) {
  return createArweaveAdapter(deps);
}
