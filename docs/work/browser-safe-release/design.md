# Browser-safe release: turbo-sdk, the missing guard, and ui.css

Triggered by a consumer handoff: the AncientHoldings hub (Next 16 / Turbopack,
`output: standalone`) cannot build against `@ancientpantheon/codex` 1.6.0.

```
the chunking context does not support external modules (request: node:stream/promises)
  @ardrive/turbo-sdk/lib/esm/node/index.js
  → @ancientpantheon/codex/dist/chunk-FBSWCZ7E.js
  → the hub's client component CodexDropIn.tsx
```

Three claims arrived. Verified:

| claim | verdict |
|---|---|
| browser build breaks via turbo-sdk | **CONFIRMED** — mechanism differs from the report |
| `engines` floor `>=22.12` | **REFUTED** |
| `dist/ui.css` needs patching | **CONFIRMED** — two independent bugs |

## 1. The break, and why the proposed fix was wrong

The handoff proposed importing `@ardrive/turbo-sdk/web` instead of the bare
specifier. **Measured, that does not work.** An esbuild `--platform=browser`
bundle of `@ardrive/turbo-sdk/web` fails on:

- `node:stream` — turbo's own `lib/esm/common/http.js`
- `stream` — turbo's own `lib/esm/common/events.js`
- `stream`, `crypto` — `@dha-team/arbundles/build/web/esm/src/stream/index.js`
- `crypto` — `@dha-team/arbundles/build/web/esm/src/deepHash.js`

Turbo's `common/` layer is shared by both builds, so the web subpath inherits
the Node dependency. Shipping that one-liner would have reproduced the same
class of failure on a different specifier and burned another release.

**The actual cause.** `@ardrive/turbo-sdk` is referenced exactly once in the
whole monorepo:

`packages/codex-arweave/src/panel/lazyDeps.ts:36`
```ts
export async function loadTurbo(): Promise<TurboSdkModule> {
  return import("@ardrive/turbo-sdk");
}
```

**Nothing calls it.** Its only consumer is a re-export at
`packages/codex-arweave/src/panel/index.ts:55`. Its own doc says it exists so
that "this boundary only proves Turbo is reachable exclusively behind a
dynamic `import()`" — and `e4-treeshake-bundle.test.ts` assertion (d) asserts
Turbo IS retained in the panel bundle. A function that exists to demonstrate a
property, plus a test pinning it in place, is the entire cause.

The real upload path is `arbundles` ANS-104 via `arweave-core`
(`uploadData` / `uploadBundle`). `packages/arweave-core/src` contains **zero**
turbo references. `@ardrive/turbo-sdk` is declared only at
`packages/codex/package.json:72` and used nowhere.

A dynamic `import()` is not an escape hatch: the bundler must still RESOLVE
the specifier and emit a browser chunk for it, which is exactly what the
consumer's error says.

**Decision: delete it.** `loadTurbo`, `TurboSdkModule`, the re-export, and the
dependency. The specifier leaves the graph entirely. No subpath selection, no
`browser` condition, no server-only split — none of which would be needed for
code nobody runs.

## 2. The missing guard — the part that matters most

Two guards exist. **Both are structurally incapable of catching this.**

`.github/workflows/publish.yml:259`:
```sh
if grep -rlE "from '(fs|http2|stream/promises|child_process|net|tls|dns)'" dist/; then
```
Three blind spots: it misses `node:`-prefixed specifiers; it matches only
single quotes and only the static `from '...'` form, never `import('...')`;
and fatally, **it greps codex's own `dist/`** while turbo-sdk is an external
dependency whose bytes are never emitted there. No grep of `dist/` can observe
this class of bug.

`packages/codex-arweave/tests/e4-treeshake-bundle.test.ts` runs with
`platform: "node"` and externalizes unresolvable bare specifiers, so it can
never see `node:*` leakage; and its assertion (d) actively requires Turbo to
be present.

This bug class has now shipped twice — 1.5.3 fixed the identical thing for
`arbundles`, and `loadTurbo` was simply never given the same treatment.

**Decision: the guard must RESOLVE, not grep.** A real browser-platform bundle
of every published entry in `packages/codex`'s `exports` map, failing on any
unresolvable Node builtin. That is the only check that sees through an
external dependency, and it is what would have caught both instances.

## 3. ui.css

**Bug A — an `@import` after rules.** `bundle-css.mjs` concatenates
`codex-ui/dist/ui.css` and `codex-ouronet/dist/ui.css`, each of which begins
with the same Google Fonts `@import`. The second copy lands after ~95 lines of
rules. Per spec an `@import` following any rule is invalid and dropped;
Turbopack and Lightning CSS warn or hard-error. Both source files carry the
comment "`@import` MUST be the first statement" — correct individually,
violated by the concatenation.

**Bug B — ~200 unscoped Tailwind utilities.** `codex-ui/tailwind.config.js`
sets `corePlugins: { preflight: false }` and scopes its RESET to `.codex-ui`,
but sets no `prefix` and no `important`, so `@tailwind utilities` emits at
global scope: `.flex`, `.hidden`, `.block`, `.border`, `.rounded`, `.w-full`,
`.text-sm`, `.truncate`, media-query variants, and more. A consumer using
Tailwind has its own classes overridden by load order. The scoping intent is
documented and sincere; only the reset was ever scoped.

This is why the consumer maintains a patch file against our stylesheet. Fixing
it upstream removes their need to re-cut it per release.

## 4. Not in scope, recorded so it is not mistaken for an oversight

- **`arweave-core`'s static bare `arbundles` import**
  (`src/upload/bundle.js`): currently safe only because `arbundles` publishes
  an `exports["."].browser` condition. That is luck, not design, and it is the
  next instance of this bug. It is a published peer dependency built by plain
  `tsc` with no browser platform setting. Make the specifier explicit.
- **`packages/codex/src/ui/index.ts:15`** statically re-exports
  `CodexTabsWired`, which imports `@ancientpantheon/codex-arweave/panel`,
  collapsing the light/heavy split `codex-arweave` deliberately built. Even
  after this fix, `./ui` drags the whole Arweave panel runtime into a consumer
  that wanted a provider. A `./ui/wired` subpath would restore it. Logged.

## Acceptance criteria

1. No source file in any package references `@ardrive/turbo-sdk`, and the
   dependency is removed from `packages/codex/package.json`.
2. `e4-treeshake-bundle.test.ts`'s Turbo assertions are rewritten to assert
   ABSENCE, with the reason recorded — not deleted.
3. A new guard bundles every entry of `packages/codex`'s `exports` map at
   `platform: "browser"` and fails on any unresolved Node builtin. It must
   FAIL on today's `dist/` if turbo-sdk is reinstated, proving it bites.
4. The CI check is replaced by, or additionally runs, that guard.
5. `dist/ui.css` contains at most one `@import`, as its first statement.
6. Tailwind utilities in `codex-ui`'s stylesheet are scoped so they cannot
   override a consumer's identically-named classes.
7. All five packages typecheck; suites stay green at their current baselines
   (codex-core 346, codex-ui 314, codex-ouronet 2167 + 1 known pact failure,
   codex-arweave 1136 + 1 skipped, playground 249).
8. `packages/codex` builds, and a browser bundle of each published entry is
   free of `node:*`.
