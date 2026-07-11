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
