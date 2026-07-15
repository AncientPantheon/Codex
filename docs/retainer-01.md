# Retainer 01 — Codex package knowledge handoff

**Purpose:** carry the hard-won, non-obvious knowledge from the session that
built + published `@ancientpantheon/codex` into future sessions. Read this first
when resuming work on this repo. (Successors: `retainer-02.md`, `03`, … as needed.)

**Repo:** `D:/_Claude/AncientPantheon/Codex` · **Branch:** `feat/codex-migration-c-d`
(NOT `main` — work + tags happen on this feature branch). **Also see** the
auto-memory at `~/.claude/projects/D---Claude-AncientPantheon-Codex/memory/`
(MEMORY.md indexes it) — especially `codex-aggregator-distribution.md`.

---

## 1. What this repo is + current published state

An npm-workspaces monorepo (pure `tsc` per member, `tsup` for the aggregate,
vitest 4, ESM, Node ≥20). **Published on npm (public):**

- **`@ancientpantheon/codex@0.6.0`** — the consumer-facing aggregate. `latest`.
- **`@ancientpantheon/arweave-core@0.2.0`** — low-level Arweave protocol lib.

Consumers do **`npm install @ancientpantheon/codex`** — npm auto-pulls
`arweave-core` (a normal dependency). The `@ancientpantheon` npm scope is owned
by the user; the npm token is stored as an **org-level GitHub secret named
`NPM_PUBLISHER`** (StoaChain + AncientPantheon orgs — one name across every repo;
standardized in commit `7557522`, replacing the older split `NPMPUSHER`/`NPM_TOKEN`).
It publishes new packages under the scope fine (no reviewer gate was hit).

### The 6 packages (packages/*)
| Package | Published? | Role |
|---|---|---|
| `@ancientpantheon/codex` | ✅ public | the AGGREGATE — bundles the 4 private members |
| `@ancientpantheon/arweave-core` | ✅ public | Arweave protocol (keys, gateway, tx, upload, rebuild); deps `arweave` + `@ardrive/turbo-sdk` |
| `@ancientpantheon/codex-core` | ❌ private | chain-agnostic base (codec, vault, adapter/snapshot contracts, resolver) |
| `@ancientpantheon/codex-ui` | ❌ private | React layer (CodexProvider, 16 hooks, UI leaves) |
| `@ancientpantheon/codex-ouronet` | ❌ private | Ouronet/Kadena/Pact module (signer, zbom, CodexID, rekey) — the flagship |
| `@ancientpantheon/codex-arweave` | ❌ private | Arweave Codex module (adapter, keyring, panel) |

Plus `apps/codex-playground` — the standalone Vite SPA on **localhost:3009**. It
resolves the members via **workspace src aliases** (`resolve.shared.ts` → src),
so it always runs the LOCAL source and never consumes the npm packages. Publishing
does NOT affect it; it hot-reloads member src changes.

---

## 2. Distribution architecture — "Path A" (bundle, don't publish members)

**Decided this session.** Consumers pull ONE package (`codex`); the 4 private
members are **bundled INTO** `codex/dist` (JS *and* inlined `.d.ts`) via tsup.
`arweave-core` stays external/published (heavy `arweave`/`turbo` deps kept out of
the bundle — externalized so the ~10 MB Turbo node build isn't inlined; browser
consumers must alias `@ardrive/turbo-sdk` → its `/web` build, same as the
playground's vite config).

Why Path A over publishing each member: members aren't standalone products; the
`codex-ui ↔ codex-ouronet` circular dep makes multi-publish painful; bundling
freezes a tested combo. Publish a member individually only when it earns real
standalone value (like `arweave-core` did). Each subpackage keeps its OWN version
(informational); the aggregate has its own version; the aggregate README
auto-lists member versions via `scripts/gen-readme-versions.mjs` (runs in build).

### Aggregate subpath surface (STABLE — Mnemosyne wires these)
`@ancientpantheon/codex` · `/provider` · `/hooks` · `/ui` · `/ouronet` ·
`/arweave` · `/ui.css`. `rekeyCodex` is on `/ouronet`.

### The tsup bundle (packages/codex/)
- `tsup.config.ts` — 6 ESM entries, `dts: true`, `noExternal: [/codex-(core|ui|ouronet|arweave)/]`.
- `tsconfig.tsup.json` — INHERITS the base `paths` (→ member SRC) so both esbuild
  AND rollup-plugin-dts treat members as internal and inline them. Has `jsx: react-jsx`
  + `lib: [ES2023, DOM, DOM.Iterable]` (it compiles member TSX). Do NOT reintroduce
  a `paths: {}` override — that broke dts subpath inlining.
- **Acceptance test** (the correctness gate, from Mnemosyne handoff): `npm pack`
  codex, install it + `arweave-core` + peers in a scratch dir, run
  `tsc --moduleResolution bundler` on a probe importing every subpath → must be
  ZERO `TS2307`. Was passing at publish.

---

## 3. Build / test / PUBLISH playbook (the operationally critical part)

**publish.yml + ci.yml both build BEFORE typecheck/test.** A fresh checkout has
no `dist/`, and typecheck/vitest resolve siblings via built dist. Order matters.

**The circular pair (`codex-ui ↔ codex-ouronet`)** deadlocks a cold `npm run
build` (each needs the other's dist). Solved by `scripts/build-circular-pair.mjs`
— a two-pass bootstrap (tsc emits despite errors, so pass-1 seeds codex-ouronet's
dist, codex-ui builds, then codex-ouronet rebuilds clean). The root `build` script
calls it. Don't "simplify" the build back to a flat member loop — it will
deadlock on a cold CI checkout.

**`tsconfig.base.json` `paths`** map the 4 private members via a `root + wildcard`
pair each (`@ancientpantheon/codex-<m>/*` → `src/*/index.ts`) so a cold
`tsc --noEmit` resolves EVERY member subpath from source, no dist needed.
`arweave-core` is deliberately ABSENT from `paths` (external/published; resolved
via its built dist + skipLibCheck, which also sidesteps a `Uint8Array`/`BufferSource`
lib-variance in its source under the DOM lib).

**CI-excluded tests:** `packages/codex-arweave/vitest.config.ts` excludes 6 tests
ONLY when `process.env.CI` is set — the `tests/e3-*` (node:sqlite) + some
`tests/e4-panel-*`/`e4-integration-smoke` React tests. Root cause: vitest/vite
refuses to bundle the `node:sqlite` builtin under jsdom on the Linux runner (it
does NOT reproduce on local Windows; two "fixes" had zero CI effect). This is a
harness limitation, NOT a defect in shipped code. **Follow-up task exists** to fix
the harness (run sqlite tests in the node env) and drop the exclusion.

### To publish a fix (e.g. next patch)
1. Make the change in the member(s).
2. Bump the affected member(s) + the `codex` aggregate version. `arweave-core`
   stays 0.2.0 unless IT changed.
3. Update `packages/codex/CHANGELOG.md` (new `## X.Y.Z` heading at top) + README
   `## Status` line (`` `X.Y.Z` on public npmjs ``) + version-history (`**vX.Y.Z**`).
   publish.yml's **doc-parity gate** greps for these EXACT forms on the queued pkg.
4. **RUN THE LOCAL AUDIT before tagging** (this session learned it the hard way —
   CI-only failures otherwise cost blind tag-push rounds):
   - `find packages -maxdepth 2 -name dist -type d -exec rm -rf {} +` then
     `CI=true bash -c 'npm run build && npm run typecheck && npm test'` → exit 0.
   - Replicate the doc-parity greps for the tag version.
   - `npm pack --dry-run --workspace=@ancientpantheon/codex` → valid tarball.
   - Grep the built `packages/codex/dist` to confirm the fix is actually in the bundle.
5. Commit, push branch. Then tag + push: `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`.
   The workflow matches tag→package version (`v0.6.0` → only codex, since
   arweave-core is 0.2.0). To publish BOTH, push two tags.
6. `publish.yml` runs build+typecheck+test, then `npm publish --provenance`, then
   a GitHub Release. **Publish takes ~5.5–6 min end-to-end** — the CI test suite
   dominates; the actual `npm publish` is seconds.
7. Poll: `npm view @ancientpantheon/codex@X.Y.Z version`.

To re-point a tag after a fix: `git push origin :refs/tags/vX.Y.Z` (delete remote)
→ `git tag -d vX.Y.Z` → recreate on new commit → push.

---

## 4. `rekeyCodex` — codex password rotation (v0.6.0, Mnemosyne Handoff 07)

Was MISSING from the package (only `ChangePasswordCard` form + a consumer seam;
the real transform lived in OuronetUI's app). Now:

- `packages/codex-ouronet/src/rekey/index.ts` → **`rekeyCodex(snapshot, oldPw,
  newPw): Promise<{ snapshot, skipped }>`** — pure, isomorphic (Node+browser),
  store-free. Walks the FULL secret inventory as the single source of truth:
  `kadenaSeeds[].secret`, `ouroAccounts[].{secret,backup}`,
  `pureKeypairs[].encryptedPrivateKey`, `foreignKeys[].encryptedKeyfile`, and the
  9 `CodexID.encrypted*` fields (`CODEX_IDENTITY_SECRET_FIELDS`). Pre-flight
  verify → `WrongPasswordError` before any mutation; decrypt-old →
  `encryptStringV2`-new (V2 output); **skip-not-drop** (un-decryptable fields kept
  verbatim + reported). Also exports `collectCodexPasswordSecrets` (the complete,
  drift-proof superset of the old incomplete `ui/settings/encryptionState`
  collector — which still only covers 3 slices; could be pointed at this).
- Store action **`changeCodexPassword(old, new)`** (state/store.ts) = rekey the
  live snapshot + `saveAll` + re-cache the session. Default-wired as
  `ChangePasswordCard`'s `onChangePassword` in `CodexSettingsSection` (consumer
  prop still wins).
- Crypto from `@stoachain/stoa-core/crypto`: `smartDecrypt` (V1+V2),
  `encryptStringV2`, `WrongPasswordError`, `allEncryptedV2`. Reference algorithm:
  OuronetUI `src/context/wallet-context.tsx` `upgradeCodexEncryption`.
- Exported to consumers via `@ancientpantheon/codex/ouronet`.

**The load-bearing lesson baked into this design:** the secret-field inventory is
package-owned and GROWS (CodexID's 9 fields landed in 0.3.0). A consumer-inline
field-walk silently misses new fields → those secrets stay under the OLD password
→ permanent lockout after rotation. Keep the ONE inventory in `rekey/index.ts`
correct as the snapshot shape evolves — that's the whole reason it's in the package.

---

## 5. Release history (all on branch feat/codex-migration-c-d)

- **0.5.0** (2026-07-11, tags v0.2.0+v0.5.0) — first functional aggregate: wired
  + bundled the members; tsup dts-rollup. Getting publish.yml green (it had NEVER
  run green — nothing was on npm) took: lockfile sync, build-first gate order, the
  circular-pair bootstrap, wildcard src paths, pre-existing test-typecheck fixes,
  and the CI node:sqlite test exclusion.
- **0.5.1** (2026-07-12) — zbom STOA fee mark (`StoaChainCostDisplay`) now renders
  the gold **❖** glyph (`#ceac5f`) inline instead of `<img src="/images/coins/WSTOA.svg">`
  (a host-app asset that broke as a missing image in consumers like Mnemosyne).
  **Pattern gotcha:** don't reference host-app public assets from bundled member
  code — use self-contained glyphs/inline SVG. OuronetUI's canonical token glyphs:
  ❖ = STOA (gold #ceac5f), ◈ = SSTOA, Ѻ = OURO.
- **0.6.0** (2026-07-12) — `rekeyCodex` + `changeCodexPassword` (see §4).

---

## 6. Consumers + open handoffs

- **Mnemosyne** (`D:/_Claude/AncientPantheon/Mnemosyne`, `codex.ancientholdings.eu`)
  — server-custody consumer (master-key sealed; codex password is a machine value).
  Consumes `@ancientpantheon/codex`. Its handoffs live in
  `Mnemosyne/docs/handoffs/`. It will build admin Download/Load endpoints on
  `rekeyCodex` (Node, server-side). Handoff 07 = rekeyCodex, RESOLVED by v0.6.0.
- `Codex/docs/HANDOFF-codex-aggregate-dts-bundling.md` — the dts-inlining request,
  RESOLVED (v0.5.0). `Codex/docs/HANDOFF-apollo-ownership-verifier.md`,
  `HANDOFF-pythia-dual-apollo.md`, `docs/DUAL-APOLLO-CONSUMER-IDENTITY.md`,
  `CONSUMER-INTEGRATION.md` — earlier work, still relevant reference.
- OuronetUI (`D:/_Claude/StoaOuronet/OuronetUI`) — the ORIGINAL app the package was
  carved from (the D5 carve). Best reference for how a proven consumer wires things
  (wallet-context, token glyphs, upgradeCodexEncryption).

## 7. Outstanding follow-ups (spawned as task chips this session)
1. **Fix the node:sqlite vitest harness** in codex-arweave (run the e3 sqlite +
   e4-panel-library tests in the node environment) and drop the `process.env.CI`
   exclusion in `packages/codex-arweave/vitest.config.ts`.
2. (Optional) Point `ui/settings/encryptionState.collectCodexSecrets` at
   `collectCodexPasswordSecrets` so the V1/V2 badge reads the full inventory.

## 8. Standing conventions (do not violate)
- Commit/push/publish ONLY when asked. End commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Never handle/enter the npm or GitHub tokens — publishing goes through
  `publish.yml` (CI), triggered by a tag push. That's the sanctioned path.
- Security constraints preserved throughout: Apollo/Pythia keys are keyless
  (public key + signature only); the Apollo SEED never leaves the Codex; the
  activation UI never sets `activated=true` (hub Cronoton only); private keys never
  leave the browser in the /apollo-verify verifier; throwaway/testnet fixtures only.
