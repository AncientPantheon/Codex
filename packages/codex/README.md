# @ancientpantheon/codex

The consumer-facing multi-chain Codex aggregator. **Install this single package to get the whole wallet** — the chain-agnostic core, the browser interface layer, and every chain module — re-exposed through subpath exports:

| Import | What you get |
| --- | --- |
| `@ancientpantheon/codex` | the chain-agnostic root: codec, vault, adapter/snapshot + foreign-chain contracts, connection/resolver factory (no React) |
| `@ancientpantheon/codex/provider` | the composed top-level `<CodexProvider>` |
| `@ancientpantheon/codex/hooks` | the React hooks (`useCodex`, `useCodexAuth`, `useOuroAccounts`, …) |
| `@ancientpantheon/codex/ui` | the full UI (tabs, settings, cards, the debouncer) |
| `@ancientpantheon/codex/ouronet` | the Ouronet (Kadena/Pact) chain module — adapter, connection, identity, resolver, state, errors, types |
| `@ancientpantheon/codex/arweave` | the Arweave chain module — adapter, keyring, connection, panel |
| `@ancientpantheon/codex/ui.css` | the merged stylesheet (`import "@ancientpantheon/codex/ui.css"`) |

A React app gets the full multi-chain wallet from one dependency; a headless consumer imports only the core it needs without pulling React.

## Install

```bash
npm install @ancientpantheon/codex @ancientpantheon/arweave-core
```

`@ancientpantheon/arweave-core` is the aggregate's one external `@ancientpantheon` dependency (published separately). You also provide the peers you already have: `react`, `react-dom`, the `@stoachain/*` chain primitives, `@noble/curves`, and `lucide-react`.

## How the bundle works

The four internal member packages (`codex-core`, `codex-ui`, `codex-ouronet`, `codex-arweave`) stay **private** and are **bundled** — their compiled JS *and* types are inlined into this package's `dist` (via tsup). A consumer never installs or resolves them. Everything third-party (React, the `@stoachain/*` primitives, `zustand`, CodeMirror, `arweave`, `@ardrive/turbo-sdk`, …) stays external and is provided through this package's `dependencies`/`peerDependencies`.

**Browser note:** `@ardrive/turbo-sdk` ships a Node build at its root export. A browser consumer (Vite/Next/webpack) must alias it onto its `/web` build — the same aliasing `arweave-core` documents — so the browser crypto driver is bundled instead of the Node build.

## Status

Version `0.13.0` on public npmjs. The aggregate: the six subpath barrels wired to the members and the members bundled in (JS + types self-contained — a TypeScript consumer type-checks against only this package + `arweave-core`).

## Version history

**v0.13.2** — The "complete rehaul of all Ouronet code" round: confirmed and fixed 9 distinct broken/disabled execute paths in `codex-ouronet`, each independently re-verified against LIVE mainnet chain state (`describe-module`) rather than source-tree greps — the deployed Ouronet Pact contracts underwent a full "patron/executor canon 2.2" rehaul (2026-09-22) invisible to static checks. Triggered by Release StoicTag's execute STILL failing after v0.13.1. Fixes the StoicTag execute crash itself (stale pre-rehaul argument shape), the shared patron payment-key lookup used by three modals (a retired chain function), Rotate Guard and Rotate Payment Key (both permanently disabled; Rotate Payment Key's disabled state was masking a second EXECUTE-level bug underneath), and restores the Link/Revoke Dual API Key INFO previews removed in an earlier round for lack of a confirmed name — now confirmed and reconnected. A full re-scan of every on-chain call this package's `codex-ouronet` makes now resolves cleanly against mainnet. `codex-ouronet` release only (`codex-ui`/`arweave-core`/`codex-arweave` unchanged).

**v0.13.0** — A full wiring audit of every Ouronet execute flow, prompted by a real reported failure: a signed action on a locked codex hung forever on "Processing…" with no visible way to unlock. Fixed the root cause (a global password-prompt modal could render invisibly behind an already-open ZBOM action modal — affecting all 12 signed-action flows at once) plus 4 more modal-specific bugs (2 permanently-disabled execute buttons, 2 silently-wrong cost estimates), and added the first-ever direct unit test coverage for every Ouronet Pact-code builder. `codex-ouronet` + `codex-ui` release (`arweave-core`/`codex-arweave` unchanged).

**v0.12.4** — The last 3 `DPL-UR.URC_00*` reads in `codex-ouronet` switched to their `P-UI-ONE` replacements, now confirmed deployed on mainnet. Fixes the Single API / Dual API tabs, which were silently rendering the archived read's failure as "not deployed" / "0" against real on-chain data. `codex`-only release (`arweave-core` unchanged).

**v0.12.3** — Genuine functional fix in `codex-ouronet`: 4 of the 7 `DPL-UR.URC_00*` reads are now read LIVE from `O-UI-SEVEN` directly (new package-local interim implementations), bypassing the still-unpatched external `@ouronet/ouronet-core` dependency. Ouronet Accounts tab hydration, the Stoa Accounts balance summary, and Address Book StoicTag status resolution all read live chain data again. The remaining 3 (Pythia registration/dual-link/pricing) are now named but deliberately not switched — they ship in a not-yet-confirmed-deployed chain release. `codex`-only release (`arweave-core` unchanged).

**v0.12.2** — Corrects v0.12.1's own characterization of the seven `DPL-UR.URC_00*` reads in `codex-ouronet`: DPL-UR is archived and these do NOT resolve on mainnet at all, not merely "fragile behind a host shim." 4 of 7 have a confirmed `O-UI-SEVEN` replacement, now reflected in the read registry and doc comments (though the live read stays broken until the external `@ouronet/ouronet-core` dependency, confirmed unpatched at its latest published version 4.6.0, ships a compatible release); 3 of 7 have no confirmed replacement and are flagged confirmed-broken rather than guess-renamed. Documentation/metadata-only — no runtime behavior changes. `codex`-only release (`arweave-core` unchanged).

**v0.12.1** — Critical on-chain call-site fixes in `codex-ouronet`, found via an external chain-symbol audit against mainnet. Several ZBOM cost-preview reads had their `INFO_` name segments swapped (`MODULE|INFO_Action` sent, chain wants `INFO_MODULE|Action`); several others referenced retired Kadena-named/`INFO-ZERO`-hosted functions that have since moved to their Stoa-named/`INFO-ONE` equivalents; three write calls (Revoke/Rename/Link Dual API Key) were one argument short of their declared arity and failed closed instead of executing at all — fixed with a best-justified `executor` argument that is **not independently chain-verified** (see `codex-ouronet`'s own CHANGELOG before shipping a mainnet transaction through these three flows); two cost-preview reads that couldn't be verified to exist under any name were removed rather than guess-renamed, which also fixed an independent bug where the Link Dual API Key button could never become clickable at all. No public API shape changes. `codex`-only release (`arweave-core` unchanged).

**v0.12.0** — Full Pantheonic-mobile compliance across the whole packaged UI surface (`codex-ui` + `codex-ouronet`'s UI + `codex-arweave`'s panel), so the whole thing degrades correctly when embedded in a host that only hands it a portion of the screen (e.g. OuronetUI), not just when running full-viewport standalone. New shared mobile primitives in `codex-ui` (container-relative `useIsMobile`, `SwipeDeck`, the Controls riser/drawer pattern, `EdgeRail`, and `CodexModalShell`'s full-screen-on-mobile flip). Every packaged tab (Seed Words, Pure Keypairs, Ouronet Accounts, Address Book on the Chainweb side; Pure Keys, Seeds, Accounts on the Arweave side) got mobile-specific layouts, and — the headline pattern — tapping a row now opens its detail as a genuine full-screen page instead of an inline expand bounded to a small on-screen zone. ZBOM action modals (Rotate/Activate/etc.) now stack correctly on top of that full-screen view and go edge-to-edge full-screen on mobile too. Stoa Dalos and Arweave seeds can now persist a separately-encrypted `wordsSecret` so a seed created from typed/generated words shows those same words back on later reveal. The header debouncer gained the "What is this?" full-screen explainer present in the original OuronetUI implementation (a labeled pill, not an easy-to-miss icon), and its per-tier hover tooltip no longer clips when mounted inside a bounded host rectangle. Also adds Send AR's Super Max (a riskier full-wallet-sweep mode using the exact live fee, no buffer). No breaking changes. `codex`-only release (`arweave-core` unchanged).

**v0.11.0** — Two new chain capabilities. **Arweave**: Pure Keys (RSA-4096 generate/import, PEM + JSON keyfiles) and Seeds (Direct Deterministic RSA + Seed Words, unified seed picker/reveal) categories wired end-to-end; live per-account balances with native AR send (Fee Included/Fee On Top modes, real on-chain confirmation polling via the gateway's own status endpoint, a ViewBlock explorer link with an honest indexing-lag caption, and a live "Updated Xs ago" balance-freshness indicator); the watch-list and Prime Arweave Seed now persist through codex backup export/import; real gateway mode is the default. **Direct native Stoa/UrStoa movement**: a Stoa/UrStoa toggle on the Chainweb Accounts tab exposing Transfer/Stake/Unstake/Collect (liquid + staked + claimable balances, live tooltips) alongside native Stoa send (now showing the sending chain + the sender's balance on that specific chain). **Cross-cutting fix**: every signed action above — plus Send AR — now pops the real password prompt on a locked codex and resumes automatically, instead of dead-ending on a static error. `codex`-only release (`arweave-core` unchanged).

**v0.10.0** — Transaction gas-price fix (affects every signed transaction). All 13 transaction-building sites omitted `meta.gasPrice`, so Pact's `1e-8` default went out on the wire instead of the live Yin Engine floor. Re-pinned to `@stoachain/stoa-core` / `@stoachain/kadena-stoic-legacy` **>=4.4.0** and `@ouronet/ouronet-core` **>=4.6.0**, whose `CodexSigningStrategy.execute()` now performs ONE `stoaGasMeta()` clock read per call and injects `gasPrice` + `creationTime` into every `build(ctx)` callback (alongside `gasLimit`). Every site now takes both from that ctx instead of re-reading the clock — which also fixes a latent request-key bug, since `build()` runs twice (simulation + real) and a per-call `safeCreationTime()` produced a different command hash between the two passes. **Consumers must have `@stoachain/stoa-core >=4.4.0` and `@ouronet/ouronet-core >=4.6.0`.** `codex`-only release.

**v0.9.1** — Address Book display fix. Long Ouronet addresses no longer bulge past the page width — the entry-list grid is clamped with `minmax(0, 1fr)` so unbreakable addresses truncate instead of overflowing (fixes all three sub-tabs: Ouronet, StoaChain, StoicTags). Ouronet entries now render with the same blue-highlighted, width-filling, centered middle-truncation component as the Ouronet Accounts tab, and render directly in their final form (no visible "retract" flash). Removes the erroneous `KADENA:MAINNET` chain chip from the Address Book (StoaChain is mainnet-only). `codex`-only release.

**v0.9.0** — Pythia consumer-API-key management. Two new Ouronet-account sub-tabs — **Single API** (link Apollo ₱./Π. halves into a dual API key) and **Dual API** (manage the linked composite keys) — with three both-owner-authorized ZBOM transaction modals: **Link** (no fee), **Rename lane** (100 STOA, 4-way split), and **Revoke** (1 IGNIS kill-switch); costs + split receivers are read from the on-chain INFO so they never drift. Adds a **post-transaction refresh** so the accounts view re-reads chain state automatically after any tx confirms (no manual reload). `codex`-only release.

**v0.8.1** — bug fix. The Ouronet account card no longer hides an account's Payment Key when that payment-key address has never held STOA. The chain's `payment-key-existance` flag reports funding (virgin vs funded), not whether a payment key exists — every registered account has one — so the card now shows the payment-key address regardless of funding, with a "virgin · never funded" marker instead of dropping the whole section.

**v0.8.0** — additive, no breaking changes. Adds `createHeadlessKadenaResolver`, exported from `@ancientpantheon/codex/ouronet`: a server-safe, pre-bound Kadena `KeyResolver` for headless Khronoton automatons (Pythia, Mnemosyne). A consumer supplies a `loadSnapshot` + `getPassword` thunk pair and binds **zero** `@stoachain` crypto itself — all seedType-aware derivation (koala / chainweaver / eckowallet / pure-foreign, with the wrong-key refusal guard) is delegated to Codex's one canonical headless resolver instead of hand-rolled per consumer. Loads no React/DOM from `/ouronet`. `codex`-only release (`arweave-core` unchanged).

**v0.7.0** — additive, no breaking changes. Adds `autoSignApolloChallenge`, exported from `@ancientpantheon/codex/ouronet`: lets a server-side Automaton (Pythia first) prove ₱./Π. Apollo-account ownership autonomously, on a recurring timer, with zero browser and zero human prompt. Reuses the exact canonical challenge message and `dalos-apollo` Schnorr signing already proven by the existing browser `/apollo-verify` flow, so a signature it produces verifies against Pythia's existing verifier unchanged. `codex`-only release (`arweave-core` unchanged).

**v0.6.1** — dependency rename, no behaviour change. Released 2026-07-22. The Ouronet libraries moved to `@ouronet/ouronet-core` and `@ouronet/dalos-crypto` in the Phase-4 reorganisation; the old names are deprecated. The codec version gate now reflects the core's widened reader (accepts `"1.2"` and `"1.3"`) while asserting the writer stays pinned at `"1.2"`. **1570 specs pass.**

**v0.6.0** — Codex password rotation. New `rekeyCodex(snapshot, old, new)` — a pure, isomorphic transform (from `@ancientpantheon/codex/ouronet`) that re-encrypts the WHOLE secret inventory old→new (pre-flight verify, skip-not-drop, V2 output). Plus a `changeCodexPassword` store action wired as the default `onChangePassword`, so the change-password card works out of the box. Resolves Handoff 07.

**v0.5.1** — Fix the zbom STOA fee mark (`StoaChainCostDisplay`): render the gold ❖ glyph inline instead of an `<img>` to a host-app asset that broke in consumers (e.g. Mnemosyne). Self-contained in the bundle. No API changes.

**v0.5.0** — First functional aggregate: wired + bundled `codex-core`/`codex-ui`/`codex-ouronet`/`codex-arweave` through `provider`/`hooks`/`ui`/`ouronet`/`arweave` + `ui.css`; tsup dts-rollup so the `.d.ts` are self-contained.

**v0.0.1** — Initial package skeleton (empty barrels).

## Bundled member versions

<!-- BEGIN member-versions (generated by scripts/gen-readme-versions.mjs) -->
| Member package | Version |
| --- | --- |
| `@ancientpantheon/codex-core` | `0.3.0` |
| `@ancientpantheon/codex-ui` | `0.7.0` |
| `@ancientpantheon/codex-ouronet` | `0.13.2` |
| `@ancientpantheon/codex-arweave` | `0.4.0` |
| `@ancientpantheon/arweave-core` | `0.2.0` |
<!-- END member-versions -->
