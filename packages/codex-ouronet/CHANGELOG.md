# Changelog

## 1.1.1 — 2026-10-08

**PATCH — real bug fix, found via a disciplined debug investigation, not
a guess.** `state/store.ts`'s `kickstartCodex`, `fresh-dalos` path: stored
the CodexPrime account's private scalar (`keyPair.priv`) in the entry's
`secret` field while recording `originMode: "seedWords"` — every other
consumer in this codebase (`bitStringOf`/`rebuildFullKey` and everything
built on them) treats `secret` as "the original input matching
`originMode`," so this mismatch made real bitstring re-derivation
silently reconstruct the wrong value for any freshly-kickstarted
`fresh-dalos` codex. Invisible to every existing test, all of which inject
an already-correctly-shaped fake bitstring directly rather than exercising
the real kickstart→store→reveal→re-derive round trip. Found when it broke
a new downstream feature (`@ancientpantheon/codex-arweave`'s whole-codex
Arweave backup, whose real-browser verification was the first thing to
actually exercise this real path end to end). Root-caused via a full
reproduce→hypothesize→evidence-chain investigation: confirmed via direct
probing that `bitStringOf(account, priv)` does not reproduce the real
1600-bit bitstring while `bitStringOf(account, words)` does. Fixed by
storing the words in `secret` for `fresh-dalos`, matching its own declared
`originMode`. Regression-tested with a real kickstart + real encrypt/
decrypt round trip and a keygen fake whose derived address depends on the
actual bitstring value (not just its length), so a wrong *value* — not
only a wrong length — would be caught.

A codex kickstarted before this fix keeps its old, mismatched `secret` —
downstream consumers now get a clean, non-crashing "not eligible"/wrong-
value result for that codex rather than the confusing crash this bug
previously caused; restoring such a codex to full correctness needs its
own, separate, not-yet-built migration step (the original words are
still recoverable from the same codex's own backing seed material).

## 1.0.0 — 2026-09-28

**MAJOR — real Kadena mainnet sends, working end to end, for the first
time: same-chain and cross-chain, from a launcher whose tooltip now
correctly shows all three transfer variants. Fixes a critical, previously
undetected StoaChain signing bug (every native Send would have failed
on-chain), a silent no-op in the cross-chain progress toast, and the
Kadena node's own reachability, plus the Rule 7/8 tooltip canon upgrade.
Ships alongside `@ancientpantheon/codex@1.0.0`.**

- **Critical fix: StoaChain native Send (`SendStoaModal.tsx`) was
  building every transaction with its own signer UNSCOPED — no
  `clist` at all.** On the mistaken theory (now corrected) that an
  unscoped guard signer auto-authorizes any capability a call requests.
  That holds for a plain `enforce-guard` check, not for a Pact `@managed`
  capability: `coin.TRANSFER`/`coin.TRANSFER_XCHAIN` must be explicitly
  declared by some signer, confirmed against the deployed `coin` contract
  directly and cross-checked against OuronetUI's own working
  implementation. Every same-chain and chain-0 cross-chain Send would
  have failed on-chain with `"Managed capability coin.TRANSFER was not
  installed"` — found via live testing, root-caused, and fixed;
  `buildGasStationTransaction`'s own signature now requires a
  `guardCapabilities` builder from every caller so this can't silently
  regress.
- Kadena same-chain sends were unreachable for any chain other than the
  default: the source/target chain pickers mutually excluded each
  other's current value (inherited from an OuronetUI cross-chain-only
  ancestor, where that made sense — same-chain didn't). Same-chain is
  now selectable on every chain pair, for both StoaChain and Kadena.
- The native Send launcher's hover tooltip only ever cycled through the
  two same-chain variants, silently omitting cross-chain — for Kadena a
  plain oversight (the registry already described
  `coin.transfer-crosschain`); for StoaChain, `coin.C_TransferAcross`
  isn't in the upstream registry at all, so the tooltip's cycling engine
  gained real support for mixing a registry-resolved variant and a
  local-stopgap variant in ONE cycle (previously only single-key). Both
  launchers now correctly cycle all three variants, and the cross-chain
  variant's own example values are real (a genuine second account as
  receiver, a real chain id as target) instead of the registry's generic
  ghost data, which for Kadena had been showing the SAME value for
  receiver and target-chain.
- Kadena reads/writes now default to a real, reachable HTTPS gateway
  (`https://denascan.ancientholdings.eu`, a transparent Chainweb
  passthrough forwarding `local`/`send`/`poll`/`listen`/`spv`) instead of
  a direct HTTP-only node that hairpin-NATs from its own LAN and trips
  browser mixed-content blocks. The old direct node stays available as a
  selectable option (`KADENA_DIRECT_NODE_URL`), never the default. Every
  network/timeout error a Kadena send can hit now names the node it was
  actually talking to, and 4 read functions that used to silently return
  `null`/`[]` on a chain-side envelope failure (indistinguishable from a
  dead host) now log the real reason first.
- The Kadena receiver-existence check now routes through the same
  pluggable "active balance source" seam reads already use (REST by
  default) instead of unconditionally hitting the direct node — closes a
  live-reported "Could not verify the receiver account" failure that had
  nothing to do with the receiver.
- Both chains' cross-chain send toast used to show NO progress at all
  during the two longest waits (initiate confirmation, ~100s; SPV proof,
  ~100-150s) — the toast only ever appeared at the very end or on hard
  failure. Both now drive a real 3-step progress toast from the moment
  the send starts, with the real request key attached to each step as
  soon as it exists; a completed step is now visually distinct (solid
  fill + bold label) instead of fading to the same quiet gray as a
  pending one.
- Tooltip canon upgraded to `@ouronet/talos-registry@2.2.0`: Rule 7
  (`unfilledFillable`) closed 8 silently-no-op account-management
  launchers that were filling a tooltip's preview-only `account` field
  instead of the real `patron`/`executor` execution parameters; Rule 8
  classifies a live-read "no row for this key" refusal as a friendly,
  non-alarming message (the raw chain text stays on hover) instead of
  rendering it identically to a genuinely broken contract call.

## 0.19.0 — 2026-09-27

**MINOR — the pre-ZBOM tooltip: hover any button that opens a ZBOM and see
the function it will call, the PREVIEW's own declared parameters (not the
execution's — the two routinely differ), and a live cost preview, before
the modal ever mounts. Talos-registry-native throughout — no hand-built
Pact string anywhere in this feature. Also covers Codex's 5 native STOA
(`coin.*`) launchers, previously untouched by any tooltip at all, with a
distinct gold-bordered card and no fabricated cost preview; and a launcher
that fronts a runtime choice between several possible calls (Send, Transfer
UrStoa) now cycles through each one instead of naming only one.**

- New `PreZbomHint`/`PreZbomTooltipCard` component tree
  (`zbom/cfm/PreZbomHint.tsx`) — a new talos-registry-native tooltip,
  deliberately NOT a reuse of the existing `ExecutionTooltip.tsx`. Per the
  owner's ruling that the pre-open tooltip belongs on the LAUNCHER, never a
  ZBOM's own execute surface: live testing surfaced that `ZbomLayout.tsx`'s
  execute button had been wired to `ExecutionTooltip` all along (via an
  `executionSpec` prop, used by exactly 2 modals), drawing a hover card over
  the modal it annotated — removed entirely (not deprecated), guarded by a
  new class-wide test (`zbom-execute-button-no-tooltip.test.ts`) asserting
  the pattern can't silently reappear anywhere in `src`. `ExecutionTooltip.tsx`
  itself stays, used only by `Zone2Wrapper.tsx`'s signature-only header label.
  Resolves an
  `entrypoint` key live via `tryGetEntrypoint`/`getPreview`, merges preview
  values by the PREVIEW's own param names (caller values → the entrypoint's
  ghost example data → a type-aware placeholder), and renders the live read
  via `buildPreviewCall` — the same registry primitive the talos-registry
  migration already established elsewhere in this package.
- All 11 ZBOM-opening launcher call-sites across `OuronetAccountsTab.tsx`,
  `SingleApiPanel.tsx`, and `DualApiPanel.tsx` now wrapped — 4 using their
  already-exported registry-key constants (the Pythia dual-API-key
  launchers), 8 using a literal key string (verified live against the
  registry; exporting constants for these is a separate, already-tracked
  migration topic). Enforced by two new class-wide tests: one proves every
  known launcher is wrapped with its EXACT expected entrypoint (not just
  "some `<PreZbomHint>` region" — catches a swapped/mispaired entrypoint
  between two adjacent wraps), one proves every entrypoint used resolves
  against the live installed registry.
- New "Pre-ZBOM Tooltip" toggle in the ZBOM settings tab, default ON.
  Persisted via the existing per-consumer settings registry
  (`useConsumerSettings`) under `consumerName` (new `CodexProvider` prop,
  default `"Codex"` — see `@ancientpantheon/codex-ui`'s changelog), not the
  shared `uiSettings` slice — the separation is the point: this preference
  can differ per app embedding this package, from one codex. Off means off:
  the live read structurally never mounts, not just a hidden UI element.
- Extracted `readablePreview`/`Preview`/style constants (previously
  duplicated between this new tooltip and `ExecutionTooltip.tsx`, and
  already silently drifted on a `decimal: 0` edge case — one copy rendered
  a genuine zero-IGNIS cost as `[object Object]`) into a shared
  `zbom/cfm/previewFormatting.ts`, fixing that drift for both call sites at
  once and locking it with a dedicated regression test.
- Long preview values (an Ouronet account is a 162-glyph string) are now
  middle-elided (`shorten()`, new in `previewFormatting.ts`) — keeping head
  AND tail, quotes preserved outside the elision — instead of running the
  card off the edge of the screen; the full value stays reachable via a
  `title` attribute on hover. `ExecutionTooltipCard`'s own per-argument
  MISSING/too-many-argument checks are now skipped for a deliberately-empty
  `args` (Zone2Wrapper's signature-only use) instead of flagging every
  parameter red, a side effect of the execute-button wiring's removal above
  leaving that as `ExecutionTooltipCard`'s only remaining caller.
- Fixed a second live-reported bug: hovering a launcher built on this
  package's own `GoldenBtn`/`VioletBtn`/`GreenBtn` (`ui/internal/
  accountFields.tsx` — Rotate Payment Key/Guard/Sovereign/Governor,
  Release/Register StoicTag) showed no tooltip at all. Those three
  components are plain functions with a fixed prop signature and no
  `...rest` spread, so Radix's `Tooltip.Trigger asChild` (which clones its
  child and injects the ref + hover handlers directly onto it) had its
  injected props silently dropped before ever reaching the real `<button>`.
  `PreZbomHint` now wraps its `children` in a plain `<span>` before handing
  off to `ActionTooltip`, guaranteeing Radix always has a real host element
  to attach to — fixed once for every launcher, without touching the three
  shared button components (used throughout the app, not just here).
- Upgraded to `@ouronet/talos-registry@1.2.0` and corrected the numbered
  argument list back to the PREVIEW's own declared parameters — never the
  execution's — after a live complaint had briefly been mis-fixed the other
  way: previews differ from their executions in name, order, and arity for
  410 of 423 entrypoints, and binding by the exec's own names/positions is
  the exact bug class this feature exists to prevent. Also respects the
  registry's new per-parameter `ghost.use` tags (`display`/`tooltip`, 6 of
  423 entrypoints, all guard-typed — a restricted param now renders the
  registry's own authoritative string instead of a hand-derived guess, or
  is hidden from the tooltip entirely per the registry's own contract), and
  detects a ghost value that IS the literal sentinel string `"example"` as
  a placeholder rather than real data. The live-read gate now blocks on ANY
  placeholder argument, not only when every argument is one.
- Added native STOA (`coin.*`) tooltip support. `coin` is StoaChain's own
  root-namespace contract, never in the Talos registry by design (the
  registry describes deployed `ouronet-ns` modules only) — a new,
  hand-authored `zbom/cfm/nativeStoaSpecs.ts` (7 entrypoints, each verified
  line-for-line against the deployed `coin` contract by a dedicated test
  that fails loudly on drift and skips visibly, not silently, when the
  sibling Pact checkout is absent from a machine) backs a distinct
  gold-bordered "STOA NATIVE" card: no cost preview, no IGNIS line, an
  explicit "paid by the signer directly" footer instead. Wires the 5
  previously-uncovered Send/Transfer/Stake/Unstake/Collect UrStoa launchers
  in `StoaAccountsTab.tsx`, each now showing its correct hand-verified
  signature where it previously showed nothing at all.
- `PreZbomHint`'s `entrypoint` prop now also accepts an array of entrypoint
  keys, for a launcher that fronts a runtime choice between several
  possible calls — Send and Transfer UrStoa each pick between a plain
  transfer and an "Anew" variant depending on whether the receiver account
  already exists, unknowable at hover time. Given several keys, the
  tooltip cycles through them one at a time (a 10-second window each, with
  a depletion bar and one dot per variant), always restarting at the first
  variant on a fresh hover.

## 0.18.0 — 2026-09-27

**MINOR — fix a Codex-internal type divergence that broke every headless-
resolver consumer's typecheck (Pythia, Khronoton) whenever a codex held a
"stoic" (Stoa Dalos) seed. Root-caused after Pythia's own agent reported
`keyResolver.ts:88` failing to compile on every deploy that bumps
`@ancientpantheon/codex` to `@latest`.**

- `@ancientpantheon/codex-core@0.5.0`'s `StoaChainSeedType` was a hand-kept,
  3-member local mirror of this package's own `SeedType`
  (`src/types/entities.ts`) — its doc comment claimed a "verbatim" mirror,
  but `SeedType` gained a 4th member ("stoic") when Stoa Dalos seeds shipped
  and the mirror was never updated. Since `StoaChainSeedType` feeds
  `SnapshotSlice`, the parameter type of this package's own
  `createHeadlessKadenaResolver` (built for headless automaton consumers),
  a real `CodexSnapshot` carrying a stoic seed stopped being assignable —
  breaking the typecheck for every downstream consumer, not just this
  package's own build.
- Fixed in `codex-core` (see its own changelog for the full type-split
  reasoning: `StoaChainSeedType` now 4-member as a pure data label,
  `MnemonicSeedType` new-and-3-member as the actual derivation-capable
  subset, plus a compiler-enforced skip-guard so a "stoic" seed can never
  silently reach the mnemonic-only derivation seam).
- New compile-time parity test here (`tests/type-seedtype-parity.test.ts`)
  proves this package's `SeedType` and codex-core's `StoaChainSeedType` stay
  in lockstep — a future member added to one without the other now fails
  `tsc` instead of shipping a silent drift.
- No behavior change for existing koala/chainweaver/eckowallet/pure-foreign
  resolution in `InternalCodexResolver` or `createHeadlessKadenaResolver`;
  `resolveStoicKeypair`'s Stoa Dalos derivation path is untouched.

## 0.17.0 — 2026-09-27

**MINOR — real Kadena balances, made reliable, plus the first slice of the
`@ouronet/talos-registry` migration. Two owner-driven threads this round: "you
gotta read the modules with pythia with describe modules" turned into a full
diagnosis chain on Kadena balance reads (four real, distinct bugs found and
fixed in sequence, not one), and the talos-registry HANDOFF's Pythia
entrypoints (Link/Revoke/Rename Dual API Key, Deploy API Key) migrated off
hand-built Pact strings onto the registry's `buildCall`/`buildPreviewCall`.**

### Kadena balances — the diagnosis chain

Reported symptom: "loading the balances spins and spins and nothing is
shown," later "empty for all addresses" even for accounts independently
confirmed funded. Four distinct, real bugs, found and fixed in the order they
were hit — each one masked the next until fixed:

1. **No timeout on the raw Pact read.** `createClient(...).dirtyRead()` (from
   `@stoachain/kadena-stoic-legacy/client`) has no timeout of its own —
   confirmed by reading its source: no `timeout`/`AbortController`/`signal`
   anywhere. A connection that hangs rather than cleanly fails (a
   firewalled/dropped host:port) waited on the browser's own OS-level
   connection timeout, which can run to minutes — this was the literal
   "spins and spins" symptom. New `KADENA_READ_TIMEOUT_MS` (10s), raced
   against every `dirtyRead` call in `kadenaReads.ts`.
2. **Exception swallowing.** Every read's `catch { return null }` made a DNS
   failure, a connection timeout, and a genuinely-absent account all return
   the identical `null` — precisely why an unreachable node presented as
   "can't talk to the node" instead of "that hostname does not exist," which
   cost real diagnosis time. New `logKadenaReadError` (deduped per
   function+message, so a 20-chain batch against one dead host doesn't spam
   20 identical lines) — the null/`[]` contract for callers is unchanged,
   only the reason now reaches the console.
3. **`api.chainweb.com`, the widely-documented "official" Kadena mainnet
   endpoint, does not exist.** Not unreachable, not filtered — confirmed via
   `dig` against the authoritative AWS nameserver: NXDOMAIN, authoritative
   answer. There is also no free public Kadena Pact service API to fall back
   to (checked against a live node's own peer list: every public peer
   answers the P2P `/cut` endpoint but 404s on `/pact/api/v1/local` — public
   Kadena nodes expose P2P, the Pact service API is deliberately not open).
   `KADENA_MAINNET_DEFAULT_NODE_URL` moved to our own confirmed-live node
   (`bytales.duckdns.org:31849`) as an interim step.
4. **Hairpin NAT.** That node's hostname resolves to its own public IP; a
   machine on the SAME LAN as the node can't reach it there — the LAN router
   won't loop traffic addressed to its own public IP back to itself. Works
   fine from anywhere else (confirmed from an external VPS), fails
   specifically from the node's own network. Resolved by **not depending on
   that node as the default path at all** — see the new balance-source seam
   below.

### New: `kadena/kadenaBalanceSource.ts` — one seam, two implementations

- `KadenaBalanceSource` interface + `restKadenaBalanceSource` (**default**)
  + `pactKadenaBalanceSource` (selectable, not default).
  `getActiveKadenaBalanceSource`/`setActiveKadenaBalanceSource` — a
  module-level global mirroring `kadenaReads.ts`'s own `activeKadenaNodeUrl`
  pattern.
- **REST default**: `https://denascan.ancientholdings.eu/api/v1/accounts/
  <address>/balances` — our own Kadena explorer backend. HTTPS (no
  mixed-content problem), stable DNS (no dynamic-IP problem), CORS wide open
  (`access-control-allow-origin: *`, confirmed via a live preflight),
  verified against the direct node at the same instant (identical balance to
  the last digit). Same 10s timeout + deduped error-logging discipline as
  the Pact path. `chainId` arrives as a JSON number in this API, coerced to
  the string form this package uses everywhere else.
- **Pact path preserved, not deleted** — `pactKadenaBalanceSource` wraps the
  existing, correct `getKadenaBalancesBatch` unchanged, just no longer
  hardwired into `useKadenaBalances`. Kept because the REST gateway is
  read-only and always will be — `createKadenaConnection.ts` already notes
  signing/broadcast is separate future work only the Pact path can grow
  into.
- `useKadenaBalances.ts` now calls through the seam instead of hardcoding
  either path — swapping the active source is a one-line call, no hook or UI
  rewrite needed.
- `apps/codex-playground` gained `VITE_KADENA_NODE_URL` (see its own
  `.env.example`): an opt-in local-dev override for the Pact path's node URL
  (e.g. `http://localhost:31849` from the node's own LAN), read once at
  startup, falling back to the shipped production default when unset.
  Deliberately NOT a silent runtime "try X, fall back to Y" — that would
  mask a real production outage as a working dev box.

### Kadena mode UI — explorer link + unit label

- The per-row and mobile-fullscreen explorer-link buttons now point at
  `https://denascan.ancientholdings.eu/accounts/<address>` (matching that
  explorer's own URL form) and render in a distinct green palette when
  `activeNetwork === "kadena"`, instead of staying gold and silently linking
  to Stoa's explorer regardless of network.
- Balance totals now say "KDA" in Kadena mode instead of a hardcoded "STOA"
  suffix (list row total, expanded "Total \\<Chain\\> Balance").
- Known, separate, not-attempted-here gap: `MobileAddressFullScreen`'s
  per-chain grid still iterates `STOA_CHAINS` (10), not `KADENA_CHAINS`
  (20) — a Kadena account with balance on chain 10+ won't show that chain's
  row in the mobile fullscreen view yet. Flagged in that component's own doc
  comment.

### `@ouronet/talos-registry` — Pythia ops migrated (topic 1 of 3)

Added `@ouronet/talos-registry` as a `^1.1.0` peer + dev dependency (per the
HANDOFF-talos-registry-CODEX.md brief — caret, not `>=`: a major bump of that
package means the deployed Pact contract surface changed incompatibly). This
release migrates its first slice: the three local Pythia Pact-call
builders — `dualLinkOps.ts`, `linkDualApiKey.ts`, `deployApiKey.ts` — off
hand-built template literals onto `buildCall`/`buildPreviewCall`, which
render calls from the real deployed contract surface and throw loudly on any
name/arity mismatch instead of silently partially-applying.

- Every EXEC/preview pair now sources its param names from the live registry
  rather than a hand-maintained constant — closing the exact bug class this
  migration exists to prevent (confirmed live: 3 of 4 entrypoints here have a
  preview whose param names/count genuinely differ from their EXEC call —
  e.g. `C_DeployApiKey`'s account slot is `executor` on the EXEC side,
  `owner-account` on the preview side).
- The four modals that display these previews (`RenameDualLaneModal`,
  `RevokeDualLinkModal`, `LinkDualApiKeyModal`, `ActivateApolloPythiaKeyModal`)
  now call the new `buildXPreview` exports instead of hand-writing their own
  copy of the same call string.
- Non-entrypoint view/selector reads (`UR_ApiKeyRowOrNull`, the `P-UI-ONE`
  batch reads, `DALOS.UR_AccountStoa`) aren't in the registry's scope — they
  stay hand-built but now source their namespace prefix from the registry's
  own `namespace` export instead of the `KADENA_NAMESPACE` alias, so every
  namespaced call in these three files traces to one source of truth.
- Remaining two topics of this migration (StoicTag/Rotate ops, and
  registry-surfacing/verification — `surfaceHash` + version in settings, a
  test walking every used key through `tryGetEntrypoint`) are tracked
  separately, not shipped in this release.

**Verified**: full suite green, typecheck clean, 2-round adversarial review
on the Pythia-ops migration with a terminal full-scope clean pass. Two real,
pre-existing bugs surfaced during that review but confirmed untouched by the
migration diff (a guard-loading stuck-state bug in `LinkDualApiKeyModal`,
leftover debug `console.log` calls in `ActivateApolloPythiaKeyModal`) —
flagged for separate follow-up, not fixed in this release.

## 0.16.0 — 2026-09-26

**MINOR — the Kadena switch + read functions. Owner directive: "how do i
swtich to kadena when i have chainweb as selected blockchain? we also need
an entry here for the kadena connection... lets wire first the kadena
switch, and read functions. for this we need directly pact constructors,
there arent any modules we can call the reading functions from."**

### The mechanism — why this bypasses `@stoachain/stoa-core`'s `pactRead` entirely

- Confirmed by reading `@stoachain/stoa-core`'s own source
  (`dist/network/nodeFailover.js`, `dist/constants/kadena.js`,
  `dist/reads/rawCalibratedRead.js`): every transaction `pactRead` builds is
  stamped `.setNetworkId("stoa")` — hardcoded, with NO override seam (no
  setter, no per-call option, no env var). A transaction built this way and
  sent to real Kadena mainnet would be rejected node-side as a network-id
  mismatch, regardless of host. The owner's own instinct — "we need directly
  pact constructors, there arent any modules we can call the reading
  functions from" — was independently confirmed: real Kadena mainnet has
  none of Ouronet's custom deployed contracts (DALOS/CODEX/PYTHIA/etc,
  Stoa-only), only the standard `coin` module every Chainweb-family chain
  ships with.

### New: `kadena/kadenaReads.ts` — raw Pact-constructor reads

- `getKadenaBalance`, `getKadenaAccountDetails`, `checkKadenaAccountExists`,
  `getKadenaBalancesBatch` — hand-built `coin.get-balance`/`coin.details`
  Pact code, sent via `createClient(url).dirtyRead(tx)` from
  `@stoachain/kadena-stoic-legacy/client` — the SAME low-level primitive
  stoa-core's own failover client is built on internally, just with Kadena's
  own host + `networkId: "mainnet01"` instead of stoa-core's hardcoded ones.
- `setActiveKadenaNodeUrl`/`getActiveKadenaNodeUrl` — a module-level global
  (mirroring stoa-core's own `setNodeConfig`/`getActiveHost` pattern) the
  Network tab's new Kadena row pushes into, so every deeply-nested Kadena
  read picks up the configured node with no prop-drilling needed through
  `ForeignChainsTab` → `ChainwebPanel` → `StoaAccountsTab`.
- `KADENA_CHAINS`/`KADENA_CHAIN_COUNT` — 20 chains (0-19), Kadena mainnet's
  real topology since the 2020 chain-expansion, vs. StoaChain's 10
  (`STOA_CHAINS`).

### New: `connection/createKadenaConnection.ts` — the Network tab's third row

- A `ChainConnection` for health/status display, simpler than
  `createStoaChainConnection`'s own shape: no signing seam this round (reads
  bypass stoa-core entirely, so there's no global to redirect via
  `applyNodeConfig`).

### New: the actual switch — `ChainwebPanel`'s "Network: Stoa | Kadena" control

- A plain, always-visible segmented control on the Accounts category
  (deliberately NOT built on the existing `SplitSeamMedallion` seam-
  straddling system — that already carries the Codex/Watched + Stoa/UrStoa
  pair plus mobile pagination; a third entry there risked the exact
  pixel-perfect positioning invariants those took many rounds to land).
- Threaded into `StoaAccountsTab` as a new `activeNetwork` prop: swaps the
  balance DATA SOURCE from `useStoaChainBalances` to the new
  `useKadenaBalances` (real Kadena mainnet), morphs the Stoa/UrStoa pill's
  "Stoa" label to "Kadena" and disables its "UrStoa" side (UrStoa — the
  DALOS-wrapped vault token — has no Kadena-mainnet equivalent), and hides
  the "Send STOA" action — owner: "when doing transfer for kadena wed need
  to wire other functions" — signing/submitting against real Kadena mainnet
  is explicit, separate, not-yet-wired future work.

### New: the Network tab's third row

- `apps/codex-playground`'s `networkSettings.ts`/`App.tsx`: a new
  `kadenaNodeUrl` field (persisted, defaulting to the real public
  `https://api.chainweb.com`), a third `supportedChains` entry, and an
  effect pushing edits into `setActiveKadenaNodeUrl`.

### Deliberately NOT done this round (explicit scope, owner's own words)

- Signing/submitting against real Kadena mainnet ("when doing transfer for
  kadena wed need to wire other functions").
- Keeping Kadena's own SEPARATE data vs. reusing Stoa's (the "should we keep
  its own data" design question) — the owner's own answer ("keep the same
  data... switching... would simply switch the read point") describes THIS
  round's actual shape already: same seeds/accounts, only the balance
  read-point changes. Fully morphing the Stoa/UrStoa selector's data-sharing
  behavior beyond the pill-label/disable treatment already done here is the
  owner's own explicitly-named "next round of refinement."
- The per-chain expanded-detail grid (`STOA_CHAINS.map(...)` in both the
  desktop `AddressRow` and `MobileAddressFullScreen`) still iterates only
  10 chains — Kadena-mode balances on chains 10-19 are correctly READ
  (`useKadenaBalances` populates all 20) but not yet shown in that specific
  expanded view. A minor, documented completeness gap, not a correctness
  bug (chains 0-9 show accurate Kadena data).

New tests: `tests/kadena-reads.test.ts` (14 tests — the exact Pact-code
string + `networkId: "mainnet01"` every function builds, the active-URL
global, failure/empty-list handling), `src/connection/createKadenaConnection.test.ts`
(5 tests), plus new coverage in `ui-stoa-accounts-tab.test.tsx` (pill
morph/disable, Send-action hiding, Kadena-mode reads) and
`ui-chainweb-panel.test.tsx` (the switch control itself). Extended
`tx-gas-meta-surface.test.ts` with a `READ_ONLY_TX_SITES` category —
`kadenaReads.ts` builds a `.setMeta(...)` transaction but never signs or
submits it, so the gasPrice/creationTime contract that test file exists to
enforce genuinely does not apply.

## 0.15.0 — 2026-09-26

**MINOR — `CodexInfoCard` ("Identity & Backup" → Codex Info) gained a
"Codex Form" version row and a "Blockchains Supported" breakdown; the
Chainweb rail now displays as "Stoa-Chainweb". Owner ruling: "schema
version reads 0, now that we settled the form with foreign blockchain
integration on arweave, id say lets name it version 1.0.0... i think the
info needs now a breakdown on blockchains... Blockchain supported [3]:
Arweave, Stoa-Chainweb, and... Kadena-Chainweb."**

### "Codex Form" — a new, separate version row, not a repurposed one

- The "Schema Version" row the owner was looking at (`useCodex().schemaVersion`)
  is `CURRENT_SCHEMA_VERSION` (`state/migrations.ts`) — a plain integer
  migration-step counter the runner, the adapter interface, and ~40 tests
  do numeric arithmetic against. Converting it to a string like `"1.0.0"`
  would break that machinery for zero functional gain, and there are two
  OTHER unrelated fields already named "schema version" in this codebase
  (the foreign-keys wire block, each consumer's own settings) that make
  "just repurpose the existing field" actively risky to reason about.
- Instead: a new `CODEX_FORM_VERSION = "1.0.0"` constant
  (`@ancientpantheon/codex-core`, see that package's own CHANGELOG) shown as
  a NEW "Codex Form" row, alongside (not replacing) "Schema Version". Marks
  the milestone the owner is pointing at — the codex snapshot shape
  "settled" once Arweave (foreign-blockchain) integration landed alongside
  the native Ouronet/StoaChain side. A versioning policy for future bumps
  is documented on the constant itself: MINOR for additive capability
  (optional, coalesced-on-read fields only — never breaking an older
  reader), MAJOR reserved for a genuinely breaking shape change.

### "Blockchains Supported" breakdown (3: Arweave, Stoa-Chainweb, Kadena-Chainweb)

- New rows listing every blockchain this Codex build supports, by name.
  "Stoa-Chainweb" replaces the previously-unqualified "Chainweb" naming —
  it's specifically Stoa's chainweb, not upstream Kadena mainnet.
  "Kadena-Chainweb" is listed as a third supported chain per the owner's
  explicit ruling — a chain-IDENTITY-level claim (the same seeds/accounts
  are already cryptographically Kadena-compatible), NOT a claim that a
  functioning chain-switcher UI exists yet. The owner's own words: the
  actual switcher (repointing the Chainweb read-point at Kadena mainnet,
  morphing the Stoa/UrStoa selector to Kadena-named) is explicit FUTURE
  work — "that would be the next round of refinement."
- The Chainweb rail tab itself (Blockchain Accounts → the vertical rail)
  now DISPLAYS as "Stoa-Chainweb" too, via `ForeignChainsTab`'s new
  `chainLabels` override (see `@ancientpantheon/codex-ui`'s own CHANGELOG,
  v0.8.0) — threaded through `CodexTabs`' own new `chainLabels` prop. The
  underlying rail id (`"chainweb"`, `CHAINWEB_RAIL_ID` in
  `apps/codex-playground`) is UNCHANGED — only the displayed text moved.

## 0.14.1 — 2026-09-26

**PATCH — the Advanced settings page's "Experimental Curves" section
relabeled to reflect Apollo's graduation. Owner ruling: "the Apollo Curve
is always on because it represents both Pythia APIs and Codex halves. so
its graduated from experimental to in use. so the page at advanced must
reflect this."**

- `CodexSettingsSection.tsx`'s Advanced tab wrapped `ExperimentalCurvesCard`
  in a warning-colored box labeled "Experimental Curves" / "observational" —
  now "Apollo Curve" / "graduated" (success-colored), matching the card's
  own new static-status presentation (see `@ancientpantheon/codex-ui`'s own
  CHANGELOG, v0.7.1, for that half of the change).
- Fixed a stale, directly-contradictory doc comment in `SpawnAccountModal.tsx`
  that still said "APOLLO gated on the experimental-curves toggle" — the
  actual render logic a few lines below it already unconditionally offers
  both curves (confirmed unchanged this round; this was a comment-only fix).
- Regenerated `scripts/pact-signatures.full.json` /
  `src/constants/pactSignatures.generated.ts` — the drift guard
  (`tests/pact-signatures.test.ts`, new in 0.14.0) caught the committed
  manifest one function behind the live `.pact` source tree
  (`INFO-ONE.INFO_DPTF|ClearDispoForeign`, unrelated to this round's own
  change) and this is the regeneration that resolves it.

## 0.14.0 — 2026-09-26

**MINOR — cross-checked an incoming "16 of 20 chain calls are broken" handoff against
the 0.13.2 fixes (all 16 already fixed; one item in the handoff was itself factually
wrong, corrected with evidence below), then ported the handoff's own suggested
verification tooling: a Pact signature manifest generated from source, a live hover
`ExecutionTooltip` built on it, and an offline `dist/`-scanning checker. New capability,
no breaking changes.**

### Handoff cross-check

- Re-verified all 20 chain calls the handoff listed. All 16 it flagged as broken were
  already fixed in 0.13.2 (StoicTag INFO segment inversion, `INFO-ZERO`→`INFO-ONE`
  moves, `UR_AccountKadena`→`UR_AccountStoa`, `DPL-UR`→`P-UI-ONE`, the
  patron/executor write-call arity fixes, Release StoicTag's `executor` argument) —
  confirmed by grep (only doc-comment mentions of the old names remain, describing
  what was fixed) and by a live `describe-module` sweep (0 unresolved symbols).
- **One correction to the handoff itself**: it claimed
  `PYTHIA|INFO_LinkDualApiKey`/`PYTHIA|INFO_UnlinkDualApiKey` "have no counterpart
  under either naming... do not invent a name." Direct evidence says otherwise —
  `describe-module "ouronet-ns.PYTHIA"` (confirmed twice, once via live `/local` call
  and once by parsing the actual `.pact` source, see below) shows the real names are
  the SHORTER `INFO_PYTHIA|Link` (3-arg) and `INFO_PYTHIA|RevokeLink` (2-arg) —
  already restored in 0.13.2. Kept as-is; this changelog entry is the record of why.

### New: signature-manifest-driven execution verification (ported from `daimons/OuronetUI`)

- **`scripts/generate-pact-signatures.py`** — parses every `.pact` source file's
  `defun` parameter list directly (not a live network call), emitting two artifacts:
  `scripts/pact-signatures.full.json` (~5,600 signatures, not bundled — the offline
  checker) and `src/constants/pactSignatures.generated.ts` (850 signatures trimmed to
  `|C_`/`INFO_` entries — the bundled tooltip manifest). Repointed at this workspace's
  own sibling-repo layout; every fact this script produces was independently
  cross-checked against this round's own live `describe-module` findings and matches
  exactly.
- **`ExecutionTooltip.tsx`** (`zbom/cfm/`) — hover a button, see what it will actually
  execute: the function + parameter list from the manifest (a dead name shows "not on
  chain" instead of failing on click), the arguments positionally aligned against
  those parameters (catches two same-typed args swapped — the one class no static
  arity check sees), and a live INFO preview run against the real values. Desktop
  only (`useIsMobile`); built on this package's own `ActionTooltip` (Radix
  `Tooltip.Root`/`Portal`) rather than hand-rolled hover positioning, so it inherits
  the same clipping/z-index handling every other hover explainer here already has.
  New `infoArgs` field (not present in the OuronetUI original) handles the case —
  common in this package — where EXEC and INFO calls have different arity/order for
  the same operation (e.g. Release StoicTag: EXEC is `(patron executor tag-name)`,
  INFO is `(patron tag-name)`).
- **Wired in two places**: `Zone2Wrapper`'s existing `functionName` label (universal —
  every ZBOM modal already passes this, so every modal gets a baseline "does this
  function exist" hover check for free) and a new optional `executionSpec` prop on
  `ZbomLayout`'s `executeButton` (full args-aligned + live-INFO tooltip on the actual
  Execute button), wired into `ReleaseStoicTagModal` and `RegisterStoicTagModal` as
  the flagship demonstration — the two modals the original bug report and this
  session's whole audit thread started from.
- **`scripts/check-call-sites.py`** — offline, scans `dist/` (not `src/`, per the
  handoff's own instruction: a bundled package ships calls as built output) plus
  `node_modules/@ouronet/ouronet-core/dist` against the full signature manifest.
  Confirms zero missing symbols in this package's own `dist/`; the 97 findings in the
  external dependency are all for DEX/collectables/movie-booster/kpay features this
  package's UI never calls into.
- New tests: `tests/pact-signatures.test.ts` (regression lock for every fact this
  round confirmed, plus a drift guard that regenerates and diffs against committed
  output — skips gracefully when the sibling `.pact` source tree isn't on disk) and
  `tests/execution-tooltip.test.tsx` (renders `ExecutionTooltipCard` against a mocked
  reader, covering the dead-function/missing-argument/differing-INFO-arity/
  chain-refusal cases). `tests/ouronet-execute-wiring.test.ts` extended with the
  `stoicTagExecOps.ts`/`rotatePaymentKeyLive.ts`/restored-INFO-read coverage the
  0.13.2 round hadn't gotten to yet.

## 0.13.2 — 2026-09-26

**PATCH — the "complete rehaul of all Ouronet code" round. Owner report:
"i clicked Release Stoic tag execution button... still not working" AFTER
the 0.13.1 guard-resolution fix, plus the explicit instruction to re-verify
every executed function's wiring directly against the live chain (`describe-
module`), not against source-tree greps or prior handoffs, because
`@ouronet/ouronet-core`'s deployed Pact contracts underwent a full
"patron/executor canon 2.2" rehaul (2026-09-22) that source-tree audits
could not see. Confirmed AND fixed 9 distinct broken/disabled execute paths,
all independently verified against mainnet chain 0 via `describe-module`
before being touched — no renamed symbol in this release was guessed.**

### Root fix — the StoicTag execute crash itself

- **`ReleaseStoicTagModal` / `RegisterStoicTagModal`**: `@ouronet/ouronet-core`'s
  `buildReleaseStoicTagPactCode` (2 args) / `buildRegisterStoicTagPactCode`
  (account-address LAST) both still emit the PRE-rehaul call shape.
  `describe-module "ouronet-ns.TS01-C4"` confirms the deployed
  `CODEX|C_ReleaseStoicTag` / `C_RegisterStoicTag` are now BOTH 3-arg
  `(patron executor tag-name)` — `executor` is the same account this
  package already had, just moved/renamed. Reproduced the owner's exact
  error live: `(…C_ReleaseStoicTag "k:test" "testtag")` (the old 2-arg
  shape) returns `"Program encountered an unhandled error: Evaluation did
  not reduce to a value"` — the precise text from the report. New local
  `stoicTagExecOps.ts` builds the correct 3-arg shape for both.

### 5 more execute/INFO paths, found applying the same live-chain check everywhere else this package calls out to `@ouronet/ouronet-core`

- **`getWrapperPaymentKey`** (patron payment-key lookup) called the retired
  `DALOS.UR_AccountKadena` ("no such member" on mainnet; renamed
  `DALOS.UR_AccountStoa`, confirmed live) — broke `RegisterStoicTagModal`,
  `RenameDualLaneModal`, and `ActivateApolloPythiaKeyModal` simultaneously
  (all three share this one external function). Fixed via new
  `getWrapperPaymentKeyLive` in `ouroSelectorReads.ts`.
- **`RotateGuardModal`**: `getRotateGuardInfo` called the tombstoned
  `INFO-ZERO.DALOS-INFO|URC_RotateGuard` (`INFO-ZERO`'s own on-chain doc
  comment: "OBSOLETE TOMBSTONE... moved to INFO-ONE") — `canExecute` gated
  on this resolving, so "Rotate Guard" was PERMANENTLY DISABLED. Fixed via
  new `getRotateGuardInfoLive` reading the confirmed `INFO-ONE.INFO_DALOS|RotateGuard`.
- **`RotatePaymentKeyModal`**: BOTH broken. INFO (`getRotateKadenaInfo`) hit
  the same `INFO-ZERO` tombstone — permanently disabled the Execute button,
  which had been MASKING the EXECUTE bug underneath: `rotateKadenaPaymentKey`
  builds `TS01-C1.DALOS|C_RotateKadena`, confirmed "no such member" — renamed
  `C_RotateStoa` in the same rehaul (arg order/count unchanged). Fixed via
  new `getRotateStoaChainInfoLive` + a new local `rotatePaymentKeyLive.ts`
  (a byte-for-byte mirror of the external function's entire dirtyRead→sign→
  submit pipeline, with only the one Pact call fixed).

### Dual-link INFO reads restored — previously deleted for lack of a confirmed name, now confirmed and reconnected

- **`LinkDualApiKeyModal`** and **`RevokeDualLinkModal`**: an earlier round
  (0.12.1) had removed their INFO previews entirely after neither of two
  guessed names resolved on chain, per this project's "never guess a
  chain-symbol rename" rule. `describe-module "ouronet-ns.PYTHIA"` now
  confirms the real names — `INFO_PYTHIA|Link` (3-arg, Link) and
  `INFO_PYTHIA|RevokeLink` (2-arg, Revoke) — same args already being sent,
  just under the wrong function name. Both previews are restored: Link's
  (informational, no fee, not gating) and Revoke's (now shows the real IGNIS
  fee instead of an honest "≤1 IGNIS (est.)" placeholder, and gates
  `canExecute` on it loading, matching every sibling modal's convention).
  Also newly CONFIRMED, not merely re-verified: the `executor` value these
  two plus `RenameDualLaneModal` pass (the Standard half's owner) — each of
  `PythiaV5.C_LinkDualApiKey` / `C_RevokeDualLink` / `C_UpdateDualConsumerLane`'s
  own on-chain doc comments states `executor` is proven by
  `UEV_ExecutorIsHalfOwner`, "a DISJUNCTION" over either half-owner — so this
  was a correct choice all along, not a guess as previously documented.

### Full re-audit result

- A source-scan-plus-live-`describe-module` sweep of every `ouronet-ns.*`
  call this package's `src/` makes now returns **zero** unresolved symbols
  (previously 3, all now fixed above) — the first time this has been
  independently confirmed against the ACTUAL DEPLOYED byte-code, not a
  source-tree grep or a prior handoff's table.
- Deliberately NOT touched: `RotateGuardModal`'s own EXECUTE call
  (`TS01-C1.DALOS|C_RotateGuard`) and `RotateSovereignModal`/
  `RotateGovernorModal`'s EXECUTE + INFO calls — all independently
  re-verified against the same `describe-module` dumps and found already
  correct (this rehaul renamed/reshaped some functions, not all of them).
- Deliberately NOT touched: `RotateGuardModal`/`RotatePaymentKeyModal`'s own
  `account.guard`/`patronAccount.guard` → `analyzeGuard(...)` calls (a
  DIFFERENT, unrelated potential bug class — `analyzeGuard` degrades an
  unresolved guard to a vacuously-"satisfied" empty guard rather than
  crashing, and today it's unreachable in `RotatePaymentKeyModal` because
  `canExecute` was gated closed anyway) — no concrete evidence of a live
  failure from this specific class yet; flagged for a future pass, not
  guessed at here.

New tests: `tests/tx-gas-meta-surface.test.ts` extended with a
`SELF_CONTAINED_TX_SITES` category for `rotatePaymentKeyLive.ts` (a
self-contained delegate predating `CodexSigningStrategy.execute()`'s
ctx-injection contract, exactly like the external function it replaces) —
locks in that it still puts `gasPrice`/`creationTime` on the wire via its
own single `stoaGasMeta(safeCreationTime())` read.

## 0.13.1 — 2026-09-25

**PATCH — fixes a second, previously-masked bug in the same execute flow the
0.13.0 z-index fix unblocked. Owner report: "i clicked Release Stoic tag
execution button, program encountered an unhandled error, can you check,
seems its still not working" — a NEW failure mode (a crash, not a hang),
surfacing only once 0.13.0 let the flow actually reach the signing step.**

### Fixed — unresolved keyset-ref guards crashed `CodexSigningStrategy.execute()`

- **Root cause**: both `ReleaseStoicTagModal` and `RegisterStoicTagModal`
  read `patronAccount.guard` / `account.guard` directly off the codex and
  passed them straight into the signing `guards:` array. But that value is
  an UNRESOLVED keyset-ref object, not a plain keyset — confirmed via
  `OuronetAccountsTab.tsx`'s `hydrate()`, which overwrites `account.guard`
  with the live, untyped chain `ouronet-account-guard` field whenever chain
  data is present. `CodexSigningStrategy.execute()`
  (`@stoachain/stoa-core/dist/signing/codexStrategy.js`) assumes every
  element of `guards:` already satisfies `IKeyset` — a required, non-optional
  `.keys: string[]` plus `.pred` — and performs no keyset-ref resolution of
  its own; a raw unresolved guard crashes inside its guard-analysis step
  with an unhandled error. `ReleaseStoicTagModal` additionally only resolved
  the ACCOUNT guard (not the patron guard) and only for Smart accounts, for
  `AuthPathZone`'s display purposes — never for the actual signing path, and
  never for Standard accounts at all. `RegisterStoicTagModal` had the
  identical pattern.
- **Fix**: both modals now resolve BOTH the patron's and the account's guard
  via `getStoaChainAccountGuard(address)` — the same proven pattern already
  used correctly by `RevokeDualLinkModal`, `RenameDualLaneModal`, and
  `LinkDualApiKeyModal` — for every patron mode and both Standard and Smart
  account types, and `canExecute` now gates on both resolved guards being
  loaded and non-empty before allowing a sign. Confirmed via
  `codexStrategy.js`'s source that the strategy already dedupes guards
  internally by pubkey, ruling out "same guard passed twice" as a
  contributing factor — this was purely an unresolved-shape bug.
- Deliberately NOT extended to `RotateGuardModal`/`RotatePaymentKeyModal`,
  which read `account.guard`/`patronAccount.guard` the same raw way but
  delegate their actual execute logic to external `@ouronet/ouronet-core`
  functions whose internal guard handling is unverified — extending the fix
  there without evidence would be a guess, not a confirmed finding.

## 0.13.0 — 2026-09-25

**MINOR — a full wiring audit of every Ouronet execute (write) flow, prompted
by an owner-reported real failure: "i tested an execution from the codex,
and it doesnt seem to be working... we need to take all the functions that
are being executed on Ouronet and test them if their wiring are firing
correctly." Found and fixed a cross-cutting bug affecting ALL 12 ZBOM
action modals, plus 3 more modal-specific ones, and added direct unit
coverage for every Pact-code builder this session touched (previously zero
— see the new test file's own doc comment).**

### Fixed — the dominant bug: a signed action on a locked codex hung forever

- **Root cause**: `ZbomModalFrame` deliberately sits at z-index 10050 (round
  29 — so it always stacks above a `CodexModalShell` popup already open
  underneath it). But `ensureCodexUnlocked()` / `requestPassword()` — called
  from EVERY ONE of the 12 ZBOM action modals before their execute step —
  opens `CodexPasswordPrompt`, ALSO a `CodexModalShell`, at the shared
  default z-index of 9999. Opened from inside an already-open ZBOM modal (a
  locked codex + any signed action does exactly this), the prompt rendered
  INVISIBLY BEHIND the ZBOM card: `handleExecute`'s `await
  ensureCodexUnlocked()` could never resolve because the user could never
  see or reach the password input it was waiting on. Observed as: the
  reported screenshot — a `🔒 Locked` codex, "Release StoicTag" stuck on
  "Processing…" indefinitely, no visible unlock dialog.
- **Fix**: `CodexModalShell` (this package's own copy; `codex-ui`'s sibling
  copy got the same fix) gained an optional `zIndex` prop, defaulting to
  9999 (every existing caller stays byte-identical). `CodexPasswordPrompt`
  now passes `zIndex={2147483647}` — the same "always topmost, no matter
  what" sentinel `OuronetAccountsTab.tsx`'s own `StoicTagPillar` hover card
  already uses — so it always wins the stack regardless of what else is
  open. This is a ONE-shared-component fix, so it applies to every signed
  action in the app at once, the same way the mobile full-screen flip did.

### Fixed — 2 more modals with a permanently-disabled execute button

- **`RevokeDualLinkModal`**: 0.12.1 removed the confirmed-broken
  `PYTHIA|INFO_UnlinkDualApiKey` read (deleted, not guess-renamed) but
  missed removing the `blockerReason` gate that checked `info !== null` —
  since `info` now stays permanently `null` by design, the "Revoke" button
  was permanently disabled. Removed the stale gate; the IGNIS-fee display
  now shows an honest "≤1 IGNIS (est.)" instead of an eternal loading
  ellipsis or a confidently-wrong "free".
- **`RegisterStoicTagModal`**: its INFO read delegates to
  `@ouronet/ouronet-core`'s own `getRegisterStoicTagInfo`, confirmed STILL
  building the wrong `CODEX.CODEX|INFO_RegisterStoicTag` (name-order swap)
  and the retired `DALOS.UR_AccountKadena` internally at that package's
  latest published version (4.6.0) — never fixed upstream. Since `info`
  never resolved and `blockerReason` gates on it, "Register StoicTag" was
  permanently disabled. New package-local `getRegisterStoicTagInfoLive`
  (`zbom/ouroSelectorReads.ts`) reads the correct names directly.

### Fixed — 2 modals with a silently-wrong (not blocking) cost estimate

- **`ActivateStandardAccountModal` / `ActivateSmartAccountModal`**: same
  root cause as RegisterStoicTag — `@ouronet/ouronet-core`'s
  `getDeployStandardAccountInfo(Only)` / `getDeploySmartAccountInfo(Only)`
  still build the retired `INFO-ZERO.DALOS-INFO|URC_Deploy*Account` +
  `DALOS.UR_AccountKadena` internally. Unlike RegisterStoicTag this did NOT
  disable "Activate" (their `canExecute` derives from form state, not this
  read) but silently showed a "free"/`0` STOA cost instead of the real
  activation price. New local `getDeployStandardAccountInfo(Only)Live` /
  `getDeploySmartAccountInfo(Only)Live` (`zbom/ouroSelectorReads.ts`) fix
  the display.

### Added — direct unit coverage for every Ouronet Pact-code builder

- **New `tests/ouronet-execute-wiring.test.ts`** (16 tests): asserts the
  EXACT Pact code string every builder/reader in `deployApiKey.ts`,
  `dualLinkOps.ts`, `linkDualApiKey.ts`, and `ouroSelectorReads.ts` emits —
  function name AND argument order — using `setPactReader` to capture the
  call without a real network read. This is the FIRST direct test coverage
  any of these functions have ever had; every prior bug in this audit
  thread (the `INFO_` name-order swaps, the Kadena→Stoa renames, the arity
  fixes, the DPL-UR migration) would have been caught immediately by this
  suite had it existed before. Locks in all of them as regression tests
  now.
- Re-verified via full sweep: every OTHER Ouronet execute modal
  (`RotateGuardModal`, `RotatePaymentKeyModal`, `RotateGovernorModal`,
  `RotateSovereignModal`, `ReleaseStoicTagModal`, `ActivateApolloPythiaKeyModal`,
  `RenameDualLaneModal`) already resolves/rejects its INFO fetch safely
  (`.catch`/`.finally` present, no hang risk) and reads the already-fixed,
  correct Pact names.

## 0.12.4 — 2026-09-25

**PATCH — the last 3 `DPL-UR.URC_00*` reads switched to their `P-UI-ONE`
replacements, now that deployment is confirmed. Owner follow-up handoff:
"v0.12.3 standalone is calling a function that was deleted" — live mainnet
evidence: `ouronet-ns.P-UI-ONE.URC_01|ApiKeys […]` returns real registered
rows while the old `DPL-UR.URC_0031` errors with "no such member," and the
standalone UI was rendering that failure as `0 deployed` / `Dual API (0)`
against twelve live keys and six live links.**

- **`getApiKeySelectorData`** (`DPL-UR.URC_0031` → `P-UI-ONE.URC_01|ApiKeys`),
  **`getDualApiKeySelectorData`** (`DPL-UR.URC_0033_DualApiKeyMapper` →
  `P-UI-ONE.URC_02|DualLinks`), **`getPythiaPrices`**
  (`DPL-UR.URC_0034_PythiaPrices` → `P-UI-ONE.URC_03|Prices`) — all three in
  `zbom/pythia/deployApiKey.ts` — now read the confirmed-deployed
  `P-UI-ONE` module directly. Same arg-list/key-shape as before ("change
  the name, change nothing else"); no type changes needed. This is the
  actual fix for the Single API / Dual API tabs, which were silently
  rendering the archived read's failure as "not deployed" / "0" against
  real on-chain data.
- **`getPythiaPrices` keeps a separate caveat**: `DALOS|PricesTable` had no
  `stoa|price` row as of the original audit (an owner-side init gap
  `PYTHIA::UR_DeployPrice` depends on) — this rename does not by itself fix
  that; there is no independent confirmation the gap has closed.
- **Re-verified**: the `INFO_` name-order swaps, Kadena→Stoa renames,
  `INFO-ZERO`→`INFO-ONE` moves, the two removed unresolvable INFO reads,
  and the three arity-fixed write calls from 0.12.1 are all still correctly
  in place — this handoff's "also broken in the same build" section
  restated them, but none had regressed.

## 0.12.3 — 2026-09-25

**PATCH — genuine functional fix: 4 of the 7 `DPL-UR.URC_00*` reads are now
read LIVE from `O-UI-SEVEN` directly, bypassing the still-unpatched
external `@ouronet/ouronet-core` dependency. Owner follow-up handoff:
"your DPL-UR reads are gone. Here is where they moved" — confirmed
object-for-object against mainnet, for a real account and a non-existent
one.**

- **New `zbom/ouroSelectorReads.ts`** — package-LOCAL, interim
  implementations of `getAccountSelectorDataLive`, `getStoicTagSelectorDataLive`,
  `getStoicTagInfoLive`, `getStoaAccountSelectorDataLive`, reading
  `O-UI-SEVEN.URC_01|Accounts`, `URC_03|StoicTags`, `URC_04|StoicTag`,
  `URC_05|StoaAccounts` respectively via a direct `pactRead` — byte-for-byte
  the same implementation as `@ouronet/ouronet-core`'s equivalents (same
  tiers, same "no data ⇒ `[]`/`null`" shape, same reused result types), only
  the Pact module/function name changed. Mirrors the `deployApiKey.ts`
  "interim; upstream to ouronet-core" pattern already established for
  `URC_0031`. Delete this file (and revert the 3 call sites below) the day
  `@ouronet/ouronet-core` ships an O-UI-SEVEN-compatible release — it's
  still on the archived `DPL-UR.*` names internally as of its latest
  published version (4.6.0).
- **`useAccountChainData.ts`, `useStoaChainBalances.ts`, `AddressBookTab.tsx`**
  now import from the new local module instead of `@ouronet/ouronet-core`
  — this is the actual fix: Ouronet Accounts tab hydration, the Stoa
  Accounts "Stoa Balance" summary line, and Address Book StoicTag status
  resolution all read live chain data again.
- **Sentinel values changed shape but not type** (`iz-smart` can now be the
  number `-1` instead of `false` for "account does not exist",
  `payment-key-balance` as `-1.0` instead of `0.0`, `payment-key` as the
  literal `"|"` BAR sentinel instead of `""`) — the reused
  `AccountSelectorData` type already accommodated all three; no type
  changes were needed. `StoicTagSelectorData`'s three-state shape
  (never-registered / active / released) was likewise already a distinct
  field per state.
- **The remaining 3** (`URC_0031`, `URC_0033_DualApiKeyMapper`,
  `URC_0034_PythiaPrices` — Pythia registration/dual-link/pricing, all
  LOCAL to `deployApiKey.ts` unlike the 4 above) are now NAMED
  (`P-UI-ONE.URC_01|ApiKeys` / `URC_02|DualLinks` / `URC_03|Prices`) but
  deliberately NOT switched yet — they ship in `PureV2/19`, not confirmed
  deployed as of this handoff. Flip-the-switch TODOs are documented inline
  at each of the three call sites. Separately, `URC_03|Prices` (ex-`URC_0034`)
  is expected to keep failing even once switched — `DALOS|PricesTable` has
  no `stoa|price` row, an owner-side init gap, not a bug in this package.

## 0.12.2 — 2026-09-25

**PATCH — corrects 0.12.1's own characterization of the seven `DPL-UR.URC_00*`
reads: DPL-UR is archived and these do NOT resolve on mainnet at all (not
merely "fragile behind a host shim," as 0.12.1 described them). Owner
correction: "all those reads in DPL-UR dont exist anymore, you have to pull
the reads from the new module architecture." Documentation/metadata-only —
no runtime behavior changes.**

- **4 of 7 have a confirmed `O-UI-SEVEN` replacement**, now reflected in
  `readRegistry.ts`'s `canonical` strings (the Settings → Read Functions
  page) and every doc comment naming them: `URC_0027_AccountSelectorMapper`
  → `O-UI-SEVEN.URC_01|Accounts`, `URC_0027b_StoicTagSelectorMapper` →
  `O-UI-SEVEN.URC_03|StoicTags`, `URC_0027c_StoicTagSelectorSingle` →
  `O-UI-SEVEN.URC_04|StoicTag`, `URC_0028_StoaAccountSelectorMapper` →
  `O-UI-SEVEN.URC_05|StoaAccounts`. **This does NOT fix the live read** —
  all four are invoked through EXTERNAL `@ouronet/ouronet-core` helpers
  (`getAccountSelectorData`, `getStoicTagSelectorData`, `getStoicTagInfo`,
  `getStoaAccountSelectorData`), confirmed still on the OLD `DPL-UR.*` names
  internally as of its latest published version (4.6.0, checked against
  npm 2026-09-25) — the real fix needs an O-UI-SEVEN-compatible
  `@ouronet/ouronet-core` release this package can pin to.
- **3 of 7 have NO confirmed replacement** (`URC_0031`, batch Pythia
  registration; `URC_0033_DualApiKeyMapper`, batch dual-link rows;
  `URC_0034_PythiaPrices`, deploy/rename pricing — all local to this
  package, in `zbom/pythia/deployApiKey.ts`, unlike the 4 above). Flagged
  CONFIRMED BROKEN in code comments rather than guess-renamed:
  `O-UI-SEVEN`'s own name implies seven functions, and only 4 slots
  (`URC_01`/`URC_03`/`URC_04`/`URC_05`) are accounted for — whichever of the
  remaining ones (e.g. `URC_02`/`URC_06`/`URC_07`) might carry this data is
  genuinely unknown without independent chain verification. If you have the
  real names, they're a straightforward drop-in at the three call sites
  named above.

## 0.12.1 — 2026-09-25

**PATCH — critical on-chain call-site fixes: several ZBOM reads/writes were
calling functions that no longer exist (or never existed) on mainnet. Found
via an external chain-symbol audit against mainnet (measured 2026-09-25,
against package v0.11.0). No public API shape changes.**

- **`INFO_` cost-preview reads had their two name segments swapped**
  (`MODULE|INFO_Action` sent; chain wants `INFO_MODULE|Action`) — fixed for
  `CODEX|INFO_RegisterStoicTag`, `CODEX|INFO_ReleaseStoicTag`,
  `PYTHIA|INFO_DeployApiKey`, `PYTHIA|INFO_UpdateDualConsumerLane` (both the
  live executed reads where this package builds the Pact string itself, and
  the display-only `pactCall=`/`label=` strings shown in each ZBOM modal's
  Function Info panel, everywhere both occur).
- **Kadena→Stoa renames + a retired module**: `DALOS.UR_AccountKadena` /
  `DALOS.UR_AccountStoaChain` → `DALOS.UR_AccountStoa`;
  `TS01-C1.DALOS|C_RotateStoaChain` → `TS01-C1.DALOS|C_RotateStoa`; every
  `INFO-ZERO.DALOS-INFO|URC_*` cost preview (DeploySmartAccount,
  DeployStandardAccount, RotateGovernor, RotateGuard, RotateSovereign,
  RotateStoaChain) → the corresponding `INFO-ONE.INFO_DALOS|*` function —
  `INFO-ZERO` is deployed but now defines nothing else.
- **Three EXECUTE (write) calls were one argument short of their declared
  arity** (`patron, executor, executee` per `StoicSyntax-Prefixes.md` §2.2):
  `PYTHIA|C_RevokeLink`, `PYTHIA|C_UpdateDualConsumerLane` (missing
  `executor`, 2nd position), and `PYTHIA|C_Link` (missing `executor`, 1st
  position — its one deliberately fee-free operation, not patron-paid).
  These failed closed (`CAP_EnforceAccountOwnership` finding no account in
  the missing slot) rather than executing with wrong authorization — but
  they never executed at all. **The exact account passed as `executor` is a
  best-justified placeholder (the Standard half's DALOS owner), NOT
  independently chain-verified** — arity tooling can confirm the argument
  COUNT is now right but not that the VALUE is; verify against the actual
  Pact contract source before this executes a real mainnet transaction. See
  the doc comments on `buildLinkDualApiKeyPactCode`, `buildRenameDualLanePactCode`,
  and `buildRevokeDualLinkPactCode`.
- **Two INFO reads could not be verified to exist under ANY name**
  (`PYTHIA|INFO_LinkDualApiKey`, `PYTHIA|INFO_UnlinkDualApiKey`) — removed
  entirely (the audit's own guidance: delete rather than guess-rename).
  Removing the Link preview also fixed an independent, more severe bug it
  was silently causing: `LinkDualApiKeyModal`'s "Link halves" button gated
  on `info !== null`, and since that read always failed, the button could
  **never become clickable at all** in production — not a fallback/display
  issue, a fully non-functional feature.
- **Not changed in this pass**: the seven `DPL-UR.URC_00*` selector/pricing
  reads work today only because a HOST-installed transport shim
  (OuronetUI's own) rewrites them to their `O-UI-SEVEN`/AppReads
  replacements — fragile in any OTHER host, but not itself broken, and out
  of scope here. Anything delegated to the external `@ouronet/ouronet-core`
  package (e.g. the real EXECUTE+INFO for Rotate Payment Key, Rotate Guard,
  Activate Standard/Smart, Register/Release StoicTag) is outside this
  repo — only their display-only strings shown to the user were fixed here;
  the actual on-chain call construction for those lives upstream.

## 0.12.0 — 2026-09-24

**MINOR — Pantheonic-mobile compliance for every packaged tab/modal, plus a
`wordsSecret` persistence field. No breaking changes.**

- **Mobile layouts for `SeedWordsTab`, `PureKeypairsTab`, `OuronetAccountsTab`,
  `AddressBookTab`.** Icon-only sticky sub-tab bars (fixed while entries
  scroll beneath them), slimmed/height-matched collapsed rows, responsive
  seed-word grids (8→6→4→2→1 columns with per-word marquee for anything
  still too wide to fit), and a genuine full-screen detail view: tapping a
  row now portals its expanded content into a full-screen `CodexModalShell`
  instead of expanding inline within a small on-screen zone. This applies to
  `SeedRow`, `KeypairRow`, and `AccountRow` alike; `OuronetAccountsTab`
  specifically had this re-added after an earlier round shipped
  `expandable={false}` as a stopgap and never wired the real replacement.
- **`ZbomModalFrame`** (the shared chrome for every Rotate/Activate/etc.
  ZBOM action modal) now stacks above `CodexModalShell`'s mobile full-screen
  popups (z-index raised past 9999) and goes edge-to-edge full-screen on
  mobile itself, instead of rendering invisibly behind the account-detail
  view it was opened from and staying a fixed-width desktop card regardless
  of viewport.
- **`CodexDebouncerPanel`**: per-tier hover tooltips now portal to
  `document.body` with viewport-relative positioning instead of clipping
  inside whatever bounded host rectangle the panel is mounted in. Added a
  new `DebouncerInfoModal` (exported) — a full-screen "What is this?"
  explainer, matching OuronetUI's own debouncer info page, wired to the
  panel's existing `onInfo` trigger (now a labeled pill instead of a small
  icon).
- **`IStoaChainSeed.wordsSecret` / `IArweaveSeed.wordsSecret`** (new optional
  field, mirrors the existing `secret`/`backup` dual-encrypted-field
  pattern): when a seed is genuinely created from typed/generated words,
  those words are now separately encrypted and persisted, so later reveal
  can show the real words back instead of only ever reconstructing the raw
  derived bitstring. `useEnsureCodexUnlockedOptional()` / provider
  `useCodexStoreOptional()` added to support gating this in components that
  must remain mountable without a `CodexProvider`.
- **New**: `StoaAddressHighlight`, `ActionTooltip` (shared address-truncation
  and tooltip primitives used across the new mobile rows).

## 0.10.0 — 2026-08-10

**MINOR — fixes `meta.gasPrice` on every signed transaction; raises peer floors.**

- **All 13 transaction-building sites now set `gasPrice`.** They previously
  omitted it, so Pact's `1e-8` default shipped instead of the live Yin Engine
  floor. Each `build(ctx)` closure now destructures `gasPrice` + `creationTime`
  from the strategy-injected ctx (`@stoachain/stoa-core >=4.4.0`
  `CodexSigningStrategy.execute()` does one `stoaGasMeta()` read per call) and
  spreads both into `.setMeta({...})`:
  - `components/`: `RotateGuardModal`, `RotatePaymentKeyModal`, `RotateSovereignModal`
  - `zbom/modals/`: `ActivateApolloPythiaKeyModal`, `ActivateSmartAccountModal`,
    `ActivateStandardAccountModal`, `LinkDualApiKeyModal`, `RegisterStoicTagModal`,
    `ReleaseStoicTagModal`, `RenameDualLaneModal`, `RevokeDualLinkModal`,
    `RotateGovernorModal`, `RotateSovereignModal`
- **Dropped the per-call `safeCreationTime()`** from those closures. `build()` is
  invoked twice (simulation + real); a fresh clock read per invocation yielded a
  different `creationTime`, and therefore a different command hash, between the
  two passes. `creationTime` now comes from the injected ctx.
- **No change needed** for the delegating `zbom/modals/RotateGuardModal` /
  `RotatePaymentKeyModal` — they call `rotateGuard()` /
  `rotateKadenaPaymentKey()` in `@ouronet/ouronet-core`, fixed upstream.
- **Added `tests/tx-gas-meta-surface.test.ts`** — locks the transaction-site
  inventory and the `gasPrice`/`creationTime`-from-ctx contract.
- **Peer floors raised**: `@stoachain/stoa-core` and
  `@stoachain/kadena-stoic-legacy` to `>=4.4.0`, `@ouronet/ouronet-core` to
  `>=4.6.0`.

## 0.9.1 — 2026-08-10

**PATCH — Address Book display fixes, no API changes.**

- **`AddressBookTab`** — the entry list grid now uses
  `grid-template-columns: minmax(0, 1fr)` so a long unbreakable address can no
  longer blow the card (and the page) out past the viewport width; rows truncate
  instead of overflowing. Fixes all three sub-tabs (Ouronet, StoaChain™,
  StoicTags). Ouronet entries now render via `OuronetAddressHighlight` (matching
  the Ouronet Accounts tab). Removes the erroneous `KADENA:MAINNET` chain chip.
- **`MiddleEllipsis`** — balanced, width-filling, centered `start … end`
  middle-truncation measured against the container; kept hidden until the width
  settles so it renders directly in its final form (no "retract" flash).
- **`OuronetAddressHighlight`** — same settle-until-stable rendering; no visible
  shrink on mount.

## 0.9.0 — 2026-08-08

**MINOR — additive, no breaking changes.** Pythia consumer-API-key management in
the Ouronet accounts view.

- **Two new account sub-tabs** (after Standard/Smart):
  - **Single API** — two columns of the codex's Apollo halves (Standard ₱. left,
    Smart Π. right), each with search + pagination and a live UNLINKED / LINKED /
    not-deployed status (read from `DPL-UR.URC_0031`). Pick one unlinked half from
    each side and **Link** them into a dual API key.
  - **Dual API** — the codex's mutually-linked ₱.|Π. composite keys, read via the
    new `DPL-UR.URC_0033_DualApiKeyMapper` (`UR_DualLinkRowOrNull` per composite)
    with Pythia deploy/rename prices from `DPL-UR.URC_0034_PythiaPrices`. Shows
    consumer-lane, active/revoked status, and per-key **Rename lane** / **Revoke**.
- **Three ZBOM transaction modals**, authorized by BOTH half-owners (`P|TS`):
  **Link** (no fee), **Rename lane** (100 STOA, undiscounted, 4-way split derived
  from INFO), **Revoke** (1 IGNIS kill-switch). Costs + split receivers come from
  the on-chain INFO, so they never drift when prices change. Both half-owners'
  ownership guards are resolved from chain, deduped when shared, and any owner key
  the Codex doesn't hold is requested via the standard manual-key input.
- **Post-transaction UI refresh** — a `usePostTxRefresh` hook subscribes to the
  `onTxConfirmed` event (which nothing consumed before), so `URC_0027` account
  state, `URC_0031` API-key status, and the dual-link/price reads all re-fetch
  automatically once any Codex transaction confirms — no manual reload.
- New read helpers on the `./zbom`-adjacent pythia seam:
  `getDualApiKeySelectorData`, `getPythiaPrices`, `isApiKeyLinked`, `buildDualKey`
  / `splitDualKey`, and the Link/Rename/Revoke builders. `isApiKeyRegistered` now
  reads the mapper's explicit `is-registered` flag (owner-account fallback), and
  linkage is detected by "counterpart is an Apollo account" rather than a sentinel
  string (fixes registered-but-unlinked halves reading as linked). Also fixes
  `SigningZone` showing a permanent "Waiting for account data…" spinner for
  owner-only (no-patron) transactions.

## 0.8.1 — 2026-08-03

**PATCH — bug fix.** The Ouronet account card no longer hides an account's
Payment Key when that payment-key address has never held STOA. Every registered
Ouronet account is assigned a payment key at activation; the chain's
`payment-key-existance` flag reports only whether that address has ever held
STOA (a coin-table row) — virgin (never funded) vs funded — not whether a
payment key exists. The card wrongly gated the whole Payment Key section on that
flag, so a virgin payment key vanished entirely. It now surfaces the payment-key
address whenever the chain returns one (regardless of funding) and shows a
subtle "virgin · never funded" marker instead of dropping the section; the
funding flag drives only the balance/marker. (`OuronetAccountsTab`.)

## 0.8.0 — 2026-08-03

**MINOR — additive, no breaking changes.** Adds `createHeadlessKadenaResolver`
(exported from the `./resolver` subpath) — a server-safe, pre-bound Kadena
`KeyResolver` for headless Khronoton automatons. A consumer supplies a
`loadSnapshot` + `getPassword` thunk pair and binds NO `@stoachain` crypto
itself; all seedType-aware derivation (koala / chainweaver / eckowallet /
pure-foreign, with the wrong-key refusal guard) delegates to codex-core's one
canonical `createHeadlessCodexResolver`. The real `@stoachain` deps binding
(previously private inside `InternalCodexResolver.ts`) is extracted into a shared
server-safe `headlessKadenaDeps.ts` that both the browser and headless resolvers
consume — one derivation path, no duplication. `InternalCodexResolver` behaviour
is unchanged.

## 0.7.0 — 2026-07-30

**MINOR — additive, no breaking changes.** Adds `autoSignApolloChallenge` — the
headless, fully autonomous counterpart to `signApolloOwnership`
(docs/HANDOFF-pythia-autonomous-connector.md). Lets a server-side Automaton
(Pythia first) prove ₱./Π. Apollo-account ownership on a recurring timer with
zero browser and zero human prompt: given an already-decrypted Codex snapshot
+ codex password (per the `automaton/02` master-key auto-unlock standard), it
locates the matching account, `smartDecrypt`s its secret, and signs the same
canonical challenge message the existing browser `/apollo-verify` flow uses —
so its output verifies against Pythia's existing verifier unchanged. Throws a
clear, named error if the account isn't in the snapshot, never a silent no-op.

New `./apollo-verify` subpath export — React-free, so a headless consumer can
import `signApolloOwnership` / `buildApolloOwnershipMessage` /
`autoSignApolloChallenge` without pulling React through the module graph (the
existing `./ui` subpath keeps re-exporting the same 3 pre-existing names too,
byte-for-byte unchanged).

## 0.0.1 — 2026-07-04

- Initial package skeleton.
