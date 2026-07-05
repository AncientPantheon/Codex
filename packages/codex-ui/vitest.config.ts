import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Self-referencing source-resolution alias: tests import from
// `@ancientpantheon/codex-ui` and resolve against this package's own `src/`
// instead of built `dist/` artifacts. The carve waves add subpath barrels
// (`./ui`, `./hooks`, `./provider`); their more-specific aliases, when added,
// must precede this bare-root alias so vitest picks the most-specific match.
const codexUiSrc = resolve(__dirname, "src");

// Absolute paths to this package's OWN nested React 19 copy. `dedupe` alone does
// not collapse the second copy (root react 18.3.1 pulled via other workspace
// deps), so a consumer such as zustand's `useStore` would bind
// `useSyncExternalStore` from the root copy while the components bind the nested
// copy — a null hooks dispatcher. Aliasing every React specifier to this one
// physical directory forces a single instance. Forward-slash (POSIX) form so
// Vite's alias replacement is stable on Windows — backslash replacements can
// survive to the resolver and fail to match.
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
// alias below onto the single nested react 19.
const lucideReactEsm = toPosix(resolve(__dirname, "../../node_modules/lucide-react/dist/esm/lucide-react.js"));

export default defineConfig({
  // Keep lucide-react out of the esbuild dep pre-bundle. Pre-bundling snapshots
  // its `react`/`react/jsx-runtime` imports against the root react 18.3.1 before
  // resolve.alias runs, so its icon elements come from a second React copy and
  // nested react-dom 19 rejects them. Excluding it defers resolution to the
  // aliased inline transform, which pins it to the single nested react 19.
  optimizeDeps: { exclude: ["lucide-react"] },
  resolve: {
    // A second React copy (root 18.3.1) loads alongside this package's nested
    // react 19, giving two physical React instances in one process. The hooks
    // dispatcher then reads null and every component that touches a zustand store
    // throws on `useSyncExternalStore`. Collapse to one React instance so the
    // dispatcher is shared across zustand, testing-library, and the components
    // under test.
    dedupe: ["react", "react-dom"],
    alias: [
      // Bare-specifier React aliases pinning every consumer (zustand,
      // @testing-library/react, the components) to this package's single nested
      // react 19. Subpath aliases (jsx-runtime, jsx-dev-runtime, react-dom/client)
      // come before the bare-root aliases so the most-specific match wins first.
      { find: /^react\/jsx-runtime$/, replacement: `${reactDir}/jsx-runtime.js` },
      { find: /^react\/jsx-dev-runtime$/, replacement: `${reactDir}/jsx-dev-runtime.js` },
      { find: /^react-dom\/client$/, replacement: `${reactDomDir}/client.js` },
      { find: /^react-dom$/, replacement: `${reactDomDir}/index.js` },
      { find: /^react$/, replacement: `${reactDir}/index.js` },
      { find: /^lucide-react$/, replacement: lucideReactEsm },
      // Self-referencing bare-root alias for tests inside codex-ui. Subpath
      // aliases (added by the carve waves) must be inserted ABOVE this line.
      { find: /^@ancientpantheon\/codex-ui$/, replacement: `${codexUiSrc}/index.ts` },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // zustand, lucide-react and the @radix-ui/* primitives (used by the future
    // carved shell) are hoisted to the repo root and ship as pre-built modules
    // that vitest externalizes by default. Externalized, their bare
    // `import ... from "react"` resolves through Node against their own (root)
    // location — hitting root react 18.3.1, a second physical React instance.
    // Inlining un-externalizes them so their React imports flow through the
    // resolve.alias pipeline onto the single nested react 19. NB: inlining alone
    // un-externalizes zustand and @radix-ui/* (proper `exports` maps);
    // lucide-react has no `exports` map, so its bare barrel additionally needs
    // the explicit resolve.alias above to be pulled in-graph.
    // (@testing-library/react is nested and already resolves the right copy.)
    server: { deps: { inline: [/zustand/, /lucide-react/, /@radix-ui\//] } },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
