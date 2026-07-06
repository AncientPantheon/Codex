/**
 * The REAL bundle-emit tree-shake gate helper (E-12 / N-08 — FIX-2).
 *
 * `emitBundle(entry)` runs a real esbuild bundle+tree-shake over `entry` and
 * returns the module paths that ACTUALLY SURVIVE tree-shaking into the emitted
 * bundle. The E4 gate (`tests/e4-treeshake-bundle.test.ts`) inspects those
 * retained paths to prove the light consumer surface excludes the heavy deps
 * (`@ardrive/turbo-sdk` behind a dynamic `import()`, and the bare `arweave`
 * package tree-shaken from arweave-core's `sideEffects:false` barrel) while the
 * panel/heavy entries still reach them.
 *
 * METRIC — retained OUTPUT, not the crawl (the measurement-bug correction):
 * esbuild's `metafile.inputs` lists every module esbuild PARSES/CRAWLS, NOT the
 * subset kept after tree-shaking — a module re-exported by a `sideEffects:false`
 * barrel appears in `metafile.inputs` even when tree-shaking drops every byte of
 * it from the emit. So the gate derives its module set from
 * `metafile.outputs[<outfile>].inputs` filtered to `bytesInOutput > 0` — the
 * modules that CONTRIBUTED BYTES to the emitted bundle. That is what "bundled"
 * actually means, and it is what reflects tree-shaking.
 *
 * RESILIENT RESOLUTION — so the bundle emits at all: `@ardrive/turbo-sdk` pulls
 * a large transitive graph of OPTIONAL, uninstalled signer peers (`@cosmjs/*`,
 * `@solana/web3.js`, `@ethersproject/*`, `tweetnacl`, ...). `platform:"node"`
 * externalizes node builtins; the `resilient-externals` plugin externalizes any
 * bare specifier esbuild cannot resolve. An externalized module is BY DEFINITION
 * not bundled — the correct semantics for the gate. `arweave` and
 * `@ardrive/turbo-sdk` themselves ARE installed, so they are NEVER force-externalized:
 * the tree-shaker decides their fate, and that decision IS the measurement.
 */

import { build } from "esbuild";
import path from "node:path";

/**
 * Normalize a path to forward slashes so the gate's F-4 path-segment matching
 * (`node_modules/arweave/`) is OS-independent.
 * @param {string} p
 * @returns {string}
 */
const toPosix = (p) => p.replace(/\\/g, "/");

/**
 * esbuild plugin: externalize any bare specifier that fails to resolve (the
 * uninstalled optional Turbo signer peers). A recursion guard (`pluginData`
 * sentinel) prevents the plugin's own `resolve()` probe from re-entering.
 */
const resilientExternals = {
  name: "resilient-externals",
  setup(b) {
    b.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData === "resilient-probe") return undefined;
      if (args.kind === "entry-point") return undefined;
      const p = args.path;
      // relative / absolute specifiers resolve normally
      if (p.startsWith(".") || path.isAbsolute(p)) return undefined;
      const probe = await b.resolve(p, {
        importer: args.importer,
        resolveDir: args.resolveDir,
        kind: args.kind,
        namespace: args.namespace,
        pluginData: "resilient-probe",
      });
      // Unresolvable bare specifier (uninstalled optional peer) -> externalize.
      // Not bundled == correct gate semantics; it never reached the output.
      if (probe.errors.length > 0) return { path: p, external: true };
      return { path: probe.path, external: probe.external };
    });
  },
};

/**
 * Bundle `entryAbsPath` with tree-shaking enabled and return the module paths
 * that survived into the emitted bundle.
 *
 * @param {string} entryAbsPath absolute path to the entry module
 * @returns {Promise<{ inputKeys: string[] }>} retained (contributed-bytes)
 *   module paths, POSIX-normalized. Named `inputKeys` for continuity, but these
 *   are RETAINED-OUTPUT modules, not the raw crawl.
 */
export async function emitBundle(entryAbsPath) {
  const result = await build({
    entryPoints: [entryAbsPath],
    bundle: true,
    treeShaking: true,
    metafile: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins: [resilientExternals],
  });

  const { metafile } = result;

  // Union the retained inputs across every emitted output chunk (a single entry
  // with no code-splitting yields one JS output; dynamic imports may add more).
  const retained = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const [inputPath, meta] of Object.entries(output.inputs)) {
      if (meta.bytesInOutput > 0) retained.add(toPosix(inputPath));
    }
  }

  return { inputKeys: [...retained] };
}
