import { defineConfig } from "tsup";

// The aggregator bundle. tsup inlines ONLY the four private workspace members
// (codex-core, codex-ui, codex-ouronet, codex-arweave) into codex's own dist, so
// a consumer installs one package and never has to resolve those private names.
//
// Everything else stays EXTERNAL and is provided by the consumer through codex's
// own package.json:
//   - peerDependencies: react, react-dom, @stoachain/*, @noble/curves, lucide-react
//   - dependencies:     zustand, @codemirror/*, @radix-ui/*, sonner, clsx,
//                       tailwind-merge, @uiw/react-codemirror, @lezer/*, and
//                       @ancientpantheon/arweave-core (itself published)
// tsup externalizes deps + peerDeps by default; `noExternal` force-bundles the
// four private members over that default.
const INTERNAL = /^@ancientpantheon\/codex-(core|ui|ouronet|arweave)(\/.*)?$/;

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "provider/index": "src/provider/index.ts",
    "hooks/index": "src/hooks/index.ts",
    "ui/index": "src/ui/index.ts",
    "ouronet/index": "src/ouronet/index.ts",
    "arweave/index": "src/arweave/index.ts",
  },
  format: ["esm"],
  target: "es2020",
  outDir: "dist",
  // This package has no server-side/Node runtime target at all — every member
  // is browser-only (WebCrypto, IndexedDB, OPFS). Without this, esbuild's
  // default platform ("node") resolves ANY transitively-bundled dependency's
  // package.json "browser" field/exports condition as if it didn't exist,
  // silently taking that dependency's Node build instead — even though the
  // dependency itself correctly publishes a browser-safe one. Confirmed with
  // two real, independent instances inside arbundles' own dependency graph
  // (pulled in transitively via @ancientpantheon/arweave-core, bundled into
  // this package through the four-member noExternal above): arbundles itself
  // (exports["."].browser → a real web build, ignored without this) AND, one
  // level deeper, axios via @ethersproject/providers (a package.json
  // "browser" field remapping its Node HTTP adapter to a no-op, also ignored
  // without this) — both inlined their literal Node code (fs/http2/
  // stream-promises) into this package's own published dist, which broke a
  // real downstream consumer's production `vite build` (OuronetUI,
  // 2026-10-15 — see that repo's HANDOFF-codex-1.5.2-browser-build.md for the
  // full trace). `platform: "browser"` is esbuild's general fix: it adds the
  // "browser" condition to package exports resolution AND honors the legacy
  // "browser" field remapping, for every transitively-bundled dependency,
  // not just the ones already found.
  platform: "browser",
  // `platform: "browser"` alone is too strict for a published LIBRARY (as
  // opposed to a final app bundle): it makes esbuild treat EVERY Node
  // builtin reference as a hard resolve error instead of leaving it as a
  // bare external import for the CONSUMER's own bundler/polyfill setup to
  // handle — which broke the build entirely on arbundles' own web build
  // still bare-importing "crypto"/"stream" (real functional browser
  // polyfills exist for both, via e.g. OuronetUI's own
  // vite-plugin-node-polyfills — this is fine to leave external, and is
  // exactly how 1.1.0's own dist already behaved). Explicitly externalizing
  // just the SAFELY-polyfillable Node builtins restores that tolerant
  // behavior under platform: "browser", while still letting the hard-error
  // behavior catch anything from the genuinely un-polyfillable set
  // (fs/http2/stream-promises/child_process/net/tls/dns — no real browser
  // shim exists for any of these, only an inert "empty" stub, which is
  // what actually broke the OuronetUI build: a named destructure against an
  // empty stub's nonexistent exports) — if one of THOSE ever gets pulled in
  // again by some future dependency change, the build fails loudly here,
  // rather than shipping broken and failing silently three steps downstream
  // in a consumer's own `vite build`.
  esbuildOptions(options) {
    options.external = [
      ...(options.external ?? []),
      "crypto",
      "stream",
      "buffer",
      "events",
      "util",
      "path",
      "http",
      "https",
      "zlib",
      "url",
    ];
  },

  tsconfig: "tsconfig.tsup.json",
  // tsconfig.tsup.json inherits the workspace `paths` → member SRC, so the four
  // private members are part of this compilation and both the JS + dts passes
  // inline them automatically (no external re-exports the consumer can't resolve).
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  sourcemap: false,
  noExternal: [INTERNAL],
});
