import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Self-referencing source-resolution aliases: tests import from
// `@ancientpantheon/codex-ouronet/<subpath>` and resolve against this package's
// own `src/` instead of built `dist/` artifacts. Subpath aliases come BEFORE the
// bare-root alias so vitest picks the most-specific match first.
//
// Cross-package aliases were DROPPED in the lift out of stoa-js. The chain
// primitives (@stoachain/stoa-core, @stoachain/ouronet-core, @stoachain/dalos-crypto)
// now live in a separate repository and are consumed from the registry: they
// resolve from `node_modules/@stoachain/*/dist` via each package's `exports` map.
// There is no sibling `../stoa-core/src` / `../ouronet-core/src` on disk to alias to.
//
// NOTE on kadena-stoic-legacy: it is intentionally NOT aliased (any subpath).
// Its vendored .cjs source uses internal `require("./X")` calls that vitest's
// transform layer cannot resolve against `src/`; they only work after the
// build-time .cjs extension rewrite lands files in `dist/`. So it must resolve
// from the published `exports` map (post-build dist), never from source.
const codexOuronetSrc = resolve(__dirname, "src");

// Cross-package source alias for the sibling headless base. The rewired
// InternalCodexResolver + the adapter/snapshot extension consume
// `@ancientpantheon/codex-core` at VALUE level (the allowed core ← ui ← ouronet
// direction); the resolver-live-parity test also imports its factory + resolver
// types directly. codex-core is a declared `workspace:*` dep but has no
// published `dist` in the test env, so tests resolve it against its own `src/`
// tree here (mirroring the self-ref subpath aliases below).
const codexCoreSrc = resolve(__dirname, "../codex-core/src");

// Cross-package source alias for the sibling generic React shell. The rewired
// barrels (src/{provider,hooks,ui,components}/index.ts) now re-export codex-ui's
// generic shell (the allowed core ← ui ← ouronet direction); the provider
// wrapper mounts codex-ui's <CodexProvider>. codex-ui is a declared
// `workspace:*` dep but has no published `dist` in the test env, so tests
// resolve it against its own `src/` tree here (mirroring the codex-core alias).
const codexUiSrc = resolve(__dirname, "../codex-ui/src");

// Absolute path to this package's OWN nested React 19.2.7 copy. `dedupe` alone
// does not collapse the second copy (root react 18.3.1 pulled via root zustand),
// so zustand's `useStore` still binds `useSyncExternalStore` from the root copy
// while the components bind the nested copy — a null hooks dispatcher. Aliasing
// every React specifier to this one physical directory forces a single instance.
// Forward-slash (POSIX) form so Vite's alias replacement is stable on Windows —
// backslash replacements can survive to the resolver and fail to match.
const toPosix = (p: string): string => p.replace(/\\/g, "/");
const reactDir = toPosix(resolve(__dirname, "node_modules/react"));
const reactDomDir = toPosix(resolve(__dirname, "node_modules/react-dom"));

// lucide-react is hoisted to the repo root with no `exports` map, so vitest
// externalizes its bare-specifier ESM barrel and Node-resolves the barrel's
// `import { forwardRef } from "react"` against the root react 18.3.1 — its icon
// elements then carry an 18-era forward_ref symbol that nested react-dom 19
// rejects ("a React Element from an older version of React was rendered").
// `server.deps.inline` did not un-externalize the bare barrel. Aliasing the bare
// specifier to the barrel's absolute path makes vitest treat it as an in-graph
// module, so it is transformed and its `react` import flows through the react
// alias below onto the single nested react 19.2.7.
const lucideReactEsm = toPosix(resolve(__dirname, "../../node_modules/lucide-react/dist/esm/lucide-react.js"));

export default defineConfig({
  // Keep lucide-react out of the esbuild dep pre-bundle. Pre-bundling snapshots
  // its `react`/`react/jsx-runtime` imports against the root react 18.3.1 before
  // resolve.alias runs, so its icon elements come from a second React copy and
  // nested react-dom 19 rejects them ("a React Element from an older version of
  // React was rendered"). Excluding it defers resolution to the aliased inline
  // transform, which pins it to the single nested react 19.2.7.
  optimizeDeps: { exclude: ["lucide-react"] },
  resolve: {
    // A second React copy (root 18.3.1, pulled via root zustand) loads alongside
    // this package's nested react 19.2.7, giving two physical React instances in
    // one process. The hooks dispatcher then reads null and every component that
    // touches a zustand store throws on `useSyncExternalStore`. Collapse to one
    // React instance so the dispatcher is shared across zustand, testing-library,
    // and the components under test.
    dedupe: ["react", "react-dom"],
    alias: [
      // Bare-specifier React aliases pinning every consumer (zustand,
      // @testing-library/react, the components) to this package's single nested
      // react 19.2.7. Subpath aliases (jsx-runtime, jsx-dev-runtime) come before
      // the bare-root aliases so the most-specific match wins first. These are
      // disjoint from the `@ancientpantheon/*` self-ref aliases below.
      { find: /^react\/jsx-runtime$/, replacement: `${reactDir}/jsx-runtime.js` },
      { find: /^react\/jsx-dev-runtime$/, replacement: `${reactDir}/jsx-dev-runtime.js` },
      { find: /^react-dom\/client$/, replacement: `${reactDomDir}/client.js` },
      { find: /^react-dom$/, replacement: `${reactDomDir}/index.js` },
      { find: /^react$/, replacement: `${reactDir}/index.js` },
      { find: /^lucide-react$/, replacement: lucideReactEsm },
      // Self-referencing subpath aliases for tests inside codex-ouronet.
      // Includes "/state" and "/codex-identity" which are NOT in package.json's
      // `exports` map (intentionally private). Tests reach them via these aliases;
      // external consumers cannot.
      { find: /^@ancientpantheon\/codex-ouronet\/rekey$/, replacement: `${codexOuronetSrc}/rekey/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/adapters$/, replacement: `${codexOuronetSrc}/adapters/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/provider$/, replacement: `${codexOuronetSrc}/provider/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/hooks$/, replacement: `${codexOuronetSrc}/hooks/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/components$/, replacement: `${codexOuronetSrc}/components/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/resolver$/, replacement: `${codexOuronetSrc}/resolver/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/errors$/, replacement: `${codexOuronetSrc}/errors/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/types$/, replacement: `${codexOuronetSrc}/types/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/google-drive$/, replacement: `${codexOuronetSrc}/google-drive/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/codex-identity$/, replacement: `${codexOuronetSrc}/codex-identity/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/ui$/, replacement: `${codexOuronetSrc}/ui/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/zbom$/, replacement: `${codexOuronetSrc}/zbom/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/state$/, replacement: `${codexOuronetSrc}/state/index.ts` },
      // Connection subpath (Phase 3): the Kadena connection helper barrel. Phase 4
      // resolves the injected connection through this path. Internal deep imports
      // (the stoaNetwork shim, resolverProvider) stay relative in tests — not
      // surfaced as public subpaths.
      { find: /^@ancientpantheon\/codex-ouronet\/connection$/, replacement: `${codexOuronetSrc}/connection/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet$/, replacement: `${codexOuronetSrc}/index.ts` },
      // Cross-package: the sibling headless base. Subpath before bare-root so the
      // most-specific match wins first (F-BUG-003 — the resolver rewire consumes
      // core's headless factory + the adapter/snapshot generic seam).
      { find: /^@ancientpantheon\/codex-core\/(.*)$/, replacement: `${codexCoreSrc}/$1/index.ts` },
      { find: /^@ancientpantheon\/codex-core$/, replacement: `${codexCoreSrc}/index.ts` },
      // Cross-package: the sibling generic React shell. Subpath before bare-root
      // so the most-specific match wins first. The rewired barrels re-export
      // codex-ui's generic provider/hooks/ui/components; the provider wrapper
      // mounts codex-ui's <CodexProvider>.
      { find: /^@ancientpantheon\/codex-ui\/(.*)$/, replacement: `${codexUiSrc}/$1/index.ts` },
      { find: /^@ancientpantheon\/codex-ui$/, replacement: `${codexUiSrc}/index.ts` },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // zustand, lucide-react and the @radix-ui/* primitives are all hoisted to the
    // repo root and ship as pre-built modules that vitest externalizes by default.
    // Externalized, their bare `import ... from "react"` resolves through Node
    // against their own (root) location — hitting root react 18.3.1, a second
    // physical React instance. The symptom differs per library: zustand throws a
    // null hooks dispatcher (`useSyncExternalStore`), lucide-react produces "a
    // React Element from an older version of React", and the @radix-ui context
    // primitive (used by the rotate-guard dialog) throws null `useMemo`.
    // Inlining un-externalizes them so their React imports flow through the
    // resolve.alias pipeline onto the single nested react 19.2.7. NB: inlining
    // alone un-externalizes zustand and @radix-ui/* (they have proper `exports`
    // maps); lucide-react has no `exports` map, so its bare barrel additionally
    // needs the explicit resolve.alias above to be pulled in-graph.
    // (@testing-library/react is nested and already resolves the right copy.)
    server: { deps: { inline: [/zustand/, /lucide-react/, /@radix-ui\//] } },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
