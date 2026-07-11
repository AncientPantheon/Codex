# HANDOFF — `@ancientpantheon/codex` aggregate needs its `.d.ts` types bundled

**From:** Mnemosyne integration (codex.ancientholdings.eu consumer)
**Re:** the single aggregate package `@ancientpantheon/codex@0.5.0`
**Status:** ✅ RESOLVED (2026-07-11) — see the resolution note at the bottom. Runtime **and** types are now self-contained; the acceptance test passes.

---

## ✅ RESOLUTION (2026-07-11)

The aggregate was empty (all six barrels were `export {}`) — it is now wired **and** bundled:

- The six barrels re-export the members (`.`→codex-core, `./provider`/`./hooks`/`./ui`→codex-ouronet's composed barrels, `./ouronet`→codex-ouronet chain surface, `./arweave`→codex-arweave + connection + panel).
- Build switched from bare `tsc` to **tsup** (`packages/codex/tsup.config.ts`). It bundles the four private members' **JS** into `dist` chunks, and — via a dedicated `tsconfig.tsup.json` that resolves the members through the workspace `paths`→src — rollup-plugin-dts **inlines their types** too. Result: `grep @ancientpantheon/codex-(core|ui|ouronet|arweave)` over `dist/**/*.d.ts` returns only comments (zero real re-exports).
- `arweave-core` stays external (published); `arweave` + `@ardrive/turbo-sdk` are declared deps so the 10 MB Turbo node build is NOT inlined. Merged `./ui.css` shipped.
- **Acceptance test PASSED** exactly as specified below: packed the tarball, installed it + `arweave-core` + peers in a scratch dir, and `tsc --moduleResolution bundler` on the probe returned **zero** `TS2307`.

**Remaining before the npm link is live:** publish `@ancientpantheon/codex@0.5.0` + `@ancientpantheon/arweave-core@0.2.0` (tag-push → `publish.yml`). NOTE: the repo's full `npm run typecheck` is currently red in **pre-existing test files** (codex-ouronet + codex-arweave `tests/*` — a TS/lib bump, unrelated to the aggregate); `publish.yml` gates on typecheck, so those need clearing or the CI typecheck scoping adjusted before the tag publishes. The aggregate's own source + build + consumer probe are all green.

---

## Original report (below) — kept for the record

**Status:** publish-blocker for TypeScript consumers — runtime is fine, `tsc` is not.

## TL;DR

The aggregate bundles the **runtime JS** correctly (self-contained), but its **type
declarations (`.d.ts`) still `export * from` the un-published sub-packages**. A
TypeScript consumer that installs only `@ancientpantheon/codex` (+ `arweave-core`)
will **install and run fine but fail its type-check build** (`TS2307: Cannot find
module '@ancientpantheon/codex-ouronet/...'`). To be a true single package, the
`.d.ts` must be **rolled up / inlined** the same way the JS already is.

## Evidence (from `packages/codex/dist`, v0.5.0)

Runtime `*.js` entrypoints — **bundled, self-contained** ✅ (no external codex-* refs):
`index.js`, `provider/index.js`, `hooks/index.js`, `ui/index.js`, `ouronet/index.js`, `arweave/index.js`.

Type `*.d.ts` entrypoints — **still reference external sub-packages** ❌:

```
codex/index.d.ts          → @ancientpantheon/codex-core
codex/provider/index.d.ts → @ancientpantheon/codex-ouronet/provider
codex/hooks/index.d.ts    → @ancientpantheon/codex-ouronet/hooks
codex/ui/index.d.ts       → @ancientpantheon/codex-ouronet/ui
codex/ouronet/index.d.ts  → @ancientpantheon/codex-ouronet/{adapters,connection,types,
                             errors,resolver,state,codex-identity}
codex/arweave/index.d.ts  → @ancientpantheon/codex-arweave/*, @ancientpantheon/codex-core,
                             @ancientpantheon/codex-ouronet/*
```

`package.json` declares **only** `@ancientpantheon/arweave-core: ^0.2.0` as an
`@ancientpantheon` dependency — so none of the `codex-*` sub-packages the `.d.ts`
re-export from will be installed alongside the aggregate.

## Why it breaks Mnemosyne specifically

Mnemosyne is a Next.js + TypeScript app; `next build` runs `tsc`. When it imports,
e.g., `import { CodexProvider } from "@ancientpantheon/codex/provider"`, tsc reads
`dist/provider/index.d.ts`, sees `export * from "@ancientpantheon/codex-ouronet/provider"`,
and must resolve `codex-ouronet` to get the type. It isn't installed → build fails.
(`skipLibCheck` does not save this — it skips *checking* `.d.ts` internals, not the
module *resolution* of the re-export.)

## The fix

Bundle/rollup the declarations so the emitted `.d.ts` **inline** the types instead of
re-exporting external specifiers. Any of:

- **tsup** with `dts: true` (esbuild + rollup-plugin-dts under the hood) — simplest if
  the JS is already built with tsup/esbuild.
- **rollup-plugin-dts** as a dedicated `.d.ts` rollup pass.
- **@microsoft/api-extractor** to roll each subpath entry into a single `.d.ts`.

Target: after the fix, `grep -r "@ancientpantheon/codex-\(core\|ui\|ouronet\|arweave\)"
packages/codex/dist/**/*.d.ts` returns **nothing** (only `arweave-core`, the one real
external dep, may remain — and it is published).

## Acceptance test (do this before publishing)

```bash
# In a scratch dir, with ONLY the aggregate + arweave-core available:
npm pack packages/codex            # -> ancientpantheon-codex-0.5.0.tgz
mkdir /tmp/codex-consumer && cd /tmp/codex-consumer && npm init -y
npm i ../ancientpantheon-codex-0.5.0.tgz @ancientpantheon/arweave-core
# a .ts that imports each subpath the aggregate advertises:
cat > probe.ts <<'TS'
import { CodexProvider } from "@ancientpantheon/codex/provider";
import { useCodexAuth } from "@ancientpantheon/codex/hooks";
import { CodexTabs, ObservationalCodexIdDisplay } from "@ancientpantheon/codex/ui";
import { emptySnapshot, type CodexAdapter, type IStoaChainSeed } from "@ancientpantheon/codex/ouronet";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex/arweave";
import { createConnectionResolver } from "@ancientpantheon/codex";
console.log(!!CodexProvider, !!useCodexAuth, !!CodexTabs, !!ObservationalCodexIdDisplay, !!emptySnapshot, ARWEAVE_CHAIN_ID, !!createConnectionResolver);
TS
npx tsc --noEmit --moduleResolution bundler probe.ts   # must pass with ZERO TS2307
```

If that passes with only the aggregate + `arweave-core` installed, Mnemosyne can consume
the single package cleanly.

## Also confirm before publish

- Publish **both** `@ancientpantheon/codex` **and** `@ancientpantheon/arweave-core`
  (the aggregate's only external `@ancientpantheon` dep). `codex` alone won't resolve.
- Keep the subpath export surface stable — Mnemosyne wires to exactly:
  `. / ./provider / ./hooks / ./ui / ./ouronet / ./arweave / ./ui.css`.

## What Mnemosyne does the moment the corrected package is live

Flip 5 `file:` deps → `@ancientpantheon/codex` + `@ancientpantheon/arweave-core`, rewrite
imports to the subpaths above, wire the "Update Codex" admin button into a real
`npm install @ancientpantheon/codex@latest` puller, then `next build` + browser-verify.
Send the npm link when it's up.
