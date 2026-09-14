import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import { alias, dedupe } from "./resolve.shared";

// The "Codex version" the shell header renders — read at config time from the
// flagship @ancientpantheon/codex-ouronet package.json, IDENTICALLY to
// vite.config.ts, so the test harness and dev/build agree on one source.
//
// WHY it must be repeated here: Vitest reads `vitest.config.ts` INSTEAD of
// `vite.config.ts` when both exist — it does not merge them. So the `define` that
// supplies `__CODEX_VERSION__` for dev/build was invisible to the suite, and every
// App-rendering test died with `ReferenceError: __CODEX_VERSION__ is not defined`
// (App.tsx renders `v{__CODEX_VERSION__}` in BOTH the load screen and the
// dashboard topbar).
const CODEX_VERSION = JSON.parse(
  readFileSync(resolve(__dirname, "../../packages/codex-ouronet/package.json"), "utf8"),
).version as string;

// codex-arweave's `sqliteStore.ts` reaches Node's `node:sqlite` builtin through a
// LAZY, availability-gated `import(/* @vite-ignore */ "node:sqlite")`. That module
// is pulled into this app's graph transitively (the `@ancientpantheon/codex-arweave`
// SOURCE alias in resolve.shared routes the package barrel through Vite), and under
// the jsdom CLIENT environment Vite refuses to resolve a Node builtin at all:
//
//   Error: Cannot bundle built-in module "node:sqlite" imported from
//   "packages/codex-arweave/src/library/sqliteStore.ts"
//
// which fails the whole MODULE GRAPH — 5 of 9 test files could not even load.
// `@vite-ignore` only suppresses the dynamic-import ANALYSIS warning; it does not
// stop resolution in a client environment.
//
// This stub resolves the specifier to a tiny virtual module whose `DatabaseSync`
// throws on construction. The playground suite never opens a real SQLite library
// store (the panel's library seam is the injected in-memory store), and the REAL
// `node:sqlite` behaviour is covered by codex-arweave's own Node-environment tests
// — so stubbing here restores the graph without weakening any coverage. Scoped to
// the exact `node:sqlite` specifier; nothing else is intercepted.
function nodeSqliteStub(): Plugin {
  const VIRTUAL_ID = "\0codex-playground:node-sqlite-stub";
  return {
    name: "codex-playground:node-sqlite-stub",
    enforce: "pre",
    resolveId(source) {
      return source === "node:sqlite" ? VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null;
      return [
        "export class DatabaseSync {",
        "  constructor() {",
        '    throw new Error("node:sqlite is stubbed under the jsdom test environment");',
        "  }",
        "}",
        "export default { DatabaseSync };",
      ].join("\n");
    },
  };
}

export default defineConfig({
  plugins: [nodeSqliteStub()],
  // Mirrors vite.config.ts's `__CODEX_VERSION__` define (see CODEX_VERSION above).
  define: {
    __CODEX_VERSION__: JSON.stringify(CODEX_VERSION),
  },
  resolve: {
    // Same single-React dedupe + workspace-source aliases as vite.config so the
    // .tsx React tests run under jsdom with one React instance and the codex-ouronet
    // `/adapters` subpath (concrete CodexSnapshot) resolves identically to dev.
    dedupe,
    alias,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    server: {
      deps: {
        // Force these node_modules deps through Vite's transform pipeline so the
        // react/react-dom aliases in resolve.shared apply to THEIR bare `react`
        // imports too. Externalized (default) node_modules deps are resolved by
        // Node's resolver — a dep at ROOT node_modules pulls the ROOT React 18.3.1
        // (nearest copy) while the renderer runs on the app's React 19 copy.
        //   - zustand → its useSyncExternalStore reads a null dispatcher (the
        //     provider-mount crash).
        //   - lucide-react → the shell's tab icons (<Atom>, <Sprout>, …) are
        //     React-18 elements handed to the React-19 reconciler, which throws
        //     "A React Element from an older version of React was rendered".
        // Inlining routes each dep's `react`/`jsx-runtime` import through the
        // single-copy alias so every module renders on ONE React instance.
        inline: ["zustand", "lucide-react"],
      },
    },
  },
});
