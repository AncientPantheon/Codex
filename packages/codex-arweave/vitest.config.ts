import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Resolve the workspace packages E1 EDITS (codex-core codec/vault/chains, codex-ouronet
// store/adapters/hooks) to their `src` — so the E1 tests see live source edits without a
// dist rebuild. This is the monorepo-standard cross-package test resolution (mirrors the
// codex-ui/codex-ouronet/playground vitest configs) and, critically, keeps the parallel
// Wave-2 GREEN tasks (T11.5 edits codex-ouronet state, T11.8 edits codex-ouronet adapters)
// from racing on a shared `dist` rebuild. arweave-core is shipped/stable → resolves via its
// published dist (not aliased). codex-ui (pulled transitively by codex-ouronet/hooks) also
// resolves via its built dist.
const pkgs = resolve(__dirname, "..");
const toPosix = (p: string): string => p.replace(/\\/g, "/");
const core = toPosix(`${pkgs}/codex-core/src`);
const ouronet = toPosix(`${pkgs}/codex-ouronet/src`);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Force the aliased workspace `src` through vitest's transform (not Node's
    // externalized require of a built package) so the aliases actually apply.
    server: { deps: { inline: [/@ancientpantheon\/codex-core/, /@ancientpantheon\/codex-ouronet/] } },
  },
  resolve: {
    alias: [
      { find: /^@ancientpantheon\/codex-core\/(.*)$/, replacement: `${core}/$1/index.ts` },
      { find: /^@ancientpantheon\/codex-core$/, replacement: `${core}/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet\/(.*)$/, replacement: `${ouronet}/$1/index.ts` },
      { find: /^@ancientpantheon\/codex-ouronet$/, replacement: `${ouronet}/index.ts` },
    ],
  },
});
