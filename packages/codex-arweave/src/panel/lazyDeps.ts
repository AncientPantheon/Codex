/**
 * The heavy-runtime LAZY BOUNDARY for the Arweave panel (E-12 / N-08 — FIX-2).
 *
 * The panel `./panel` subpath is the HEAVY entry: this module is the single
 * place the heavy protocol runtime is reached, so a LIGHT consumer (the `.`
 * root, the `./address-book` subpath) never transits it and stays tree-shakeable.
 *
 * `@ardrive/turbo-sdk` is loaded through a DYNAMIC `import()` here (never a
 * top-level static import), so on any path that does not reach `loadTurbo()`
 * the bundler can split/defer Turbo entirely — Turbo is genuinely lazy, the
 * load-bearing tree-shake claim. `arweave` is reached STATICALLY via
 * `createArweaveAdapter` (arweave-core's `sendTransfer`/`uploadData` edge); it is
 * part of the heavy entry by design and is correctly retained in the panel
 * bundle while a light consumer tree-shakes it away.
 */

import {
  createArweaveAdapter,
  type ArweaveAdapterDeps,
} from "../adapter/index.js";

/**
 * The lazily-loaded Turbo SDK module surface the upload path warms. Kept opaque
 * (`unknown`) at the boundary — the concrete client factory lives in
 * arweave-core's own lazy `turboClient.ts`; this boundary only proves Turbo is
 * reachable exclusively behind a dynamic `import()`.
 */
export type TurboSdkModule = typeof import("@ardrive/turbo-sdk");

/**
 * Dynamically load `@ardrive/turbo-sdk`. This is the explicit lazy boundary: the
 * only reference to the Turbo package in codex-arweave is this `await import`,
 * so Turbo never enters a static graph reached by the light surface.
 */
export async function loadTurbo(): Promise<TurboSdkModule> {
  return import("@ardrive/turbo-sdk");
}

/**
 * Build the DEFAULT heavy Arweave adapter runtime (the static `arweave` edge)
 * for a consumer that does not inject its own. Reaching this composes
 * arweave-core's `sendTransfer`/`uploadData` (hence the bare `arweave` package),
 * and its upload path reaches Turbo through {@link loadTurbo}. Kept on the
 * `./panel` subpath so it is part of the heavy entry, never the light root.
 */
export function createDefaultArweaveRuntime(deps: ArweaveAdapterDeps) {
  return createArweaveAdapter(deps);
}
