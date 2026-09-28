# Changelog

All notable changes to `@ancientpantheon/codex`.

## 1.0.0 — 2026-09-28

**MAJOR — first stable release. Real Kadena mainnet sends now work end to
end (same-chain and cross-chain), a critical StoaChain signing bug that
would have failed every native Send on-chain is fixed, and both chains'
cross-chain flows now show real progress instead of going silent for
minutes at a time. See `@ancientpantheon/codex-ouronet`'s own changelog
for the full root-cause detail on each fix — `codex-ouronet` release
only (`codex-ui`/`codex-core`/`arweave-core`/`codex-arweave`
unchanged).**

## 0.19.0 — 2026-09-27

**MINOR — the pre-ZBOM tooltip: hover any button that opens a ZBOM to see
the function it will call, its live-registry-resolved preview parameters,
and a real cost preview, before the modal opens. Also covers the 5 native
STOA (`coin.*`) launchers with a distinct gold-bordered card (no fabricated
cost preview — natives are never priced by the registry), and a cycling
tooltip for a launcher that fronts a runtime choice between several
possible calls (Send, Transfer UrStoa), instead of naming only one. Plus a
new optional `consumerName` prop on `CodexProvider` (default `"Codex"`) so
an embedding app can identify itself to the per-consumer settings registry.
See `@ancientpantheon/codex-ouronet`'s and `@ancientpantheon/codex-ui`'s
own changelogs for the full detail — no hand-built Pact string anywhere in
this feature, talos-registry-native throughout except where `coin` itself
is root-namespace and was never in the registry to begin with.**

## 0.18.0 — 2026-09-27

**MINOR — fixes a bug that broke every Pythia (and any other headless
automaton) deploy consuming `@ancientpantheon/codex@latest` whenever the
codex held a Stoa Dalos ("stoic") seed: a stale internal type mirror
(`StoaChainSeedType`) hadn't been updated when this package's `SeedType`
gained the "stoic" member, so a real snapshot with a stoic seed failed to
typecheck against the headless resolver's own advertised input type. See
`@ancientpantheon/codex-ouronet`'s and `@ancientpantheon/codex-core`'s own
changelogs for the full root-cause and fix. No behavior change for any
existing seed type or resolver path — this closes a compile-time gap, with
a compiler-enforced guard against the wrong-key-derivation failure mode a
naive fix would have risked, plus a new test that fails the build if the
two seed-type unions ever diverge again.**

## 0.17.0 — 2026-09-27

**MINOR — real Kadena balances, made reliable, plus the first slice of the
`@ouronet/talos-registry` migration. Kadena balance reads went from "spins
forever, then shows empty for accounts confirmed funded" to working, via
four distinct real bugs found and fixed in sequence (no timeout on the raw
Pact read, exception details being discarded, a widely-cited "official"
Kadena endpoint that turns out not to exist, and a hairpin-NAT limitation on
our own node) — resolved by adding a pluggable balance-source seam that
defaults to a REST gateway (HTTPS, stable DNS, CORS-open, no LAN dependency)
while keeping the direct Pact-node path available as a selectable
alternative. The Kadena-mode explorer link now actually points at the
Kadena explorer (denascan) instead of silently staying on Stoa's, and
balance totals say "KDA" instead of a hardcoded "STOA". Separately, this
release adds `@ouronet/talos-registry` as a `^1.1.0` peer dependency and
migrates the Pythia dual-link/link/deploy-API-key call builders onto its
`buildCall`/`buildPreviewCall` — call construction that renders from the
real deployed contract surface and throws loudly on any name/arity mismatch,
closing a real bug class (3 of the 4 migrated entrypoints have a preview
whose declared parameters differ from their execution's). **Consumers must
add `@ouronet/talos-registry` `^1.1.0`** alongside the existing
`@ouronet/ouronet-core`/`@ouronet/dalos-crypto`/`@stoachain/*` peers — see
`@ancientpantheon/codex-ouronet`'s own CHANGELOG for the full technical
account, including the two remaining topics of the talos-registry migration
not yet shipped. New capability + bug fixes, no breaking changes beyond the
new required peer. `codex-ouronet` release only (`codex-ui`/`codex-core`/
`arweave-core`/`codex-arweave` unchanged).**

## 0.16.0 — 2026-09-26

**MINOR — the Kadena switch + read functions. Owner directive: "how do i
switch to kadena when i have chainweb as selected blockchain?... lets wire
first the kadena switch, and read functions." A new "Network: Stoa | Kadena"
control on the Blockchain Accounts panel switches the Accounts balance data
source to REAL Kadena mainnet, read via hand-built Pact constructors
(`coin.get-balance`/`coin.details`) that bypass `@stoachain/stoa-core`'s
`pactRead` entirely — confirmed that package hardcodes every transaction's
Pact `networkId` to `"stoa"` with no override seam, which a real Kadena
mainnet node would reject regardless of host. Signing/writes against Kadena
are explicit, separate future work — this round is reads only. New
capability, no breaking changes. `codex-ouronet` release only (`codex-ui`/
`codex-core`/`arweave-core`/`codex-arweave` unchanged). See
`@ancientpantheon/codex-ouronet`'s own CHANGELOG for the full technical
account.**

- New `kadena/kadenaReads.ts`, `connection/createKadenaConnection.ts`.
- `ChainwebPanel` gained the Network switch; `StoaAccountsTab` gained an
  `activeNetwork` prop that swaps the balance source, morphs the Stoa/UrStoa
  pill to Kadena naming (disabling UrStoa, which has no Kadena equivalent),
  and hides the not-yet-wired Send action in Kadena mode.
- The Network settings tab gained a third row for the Kadena node URL,
  defaulting to the real public `https://api.chainweb.com`.

## 0.15.0 — 2026-09-26

**MINOR — the Codex Info panel gained a "Codex Form" product version
("1.0.0") and a "Blockchains Supported" breakdown (Arweave, Stoa-Chainweb,
Kadena-Chainweb); the Chainweb rail tab now displays as "Stoa-Chainweb".
Owner ruling: "schema version reads 0, now that we settled the form with
foreign blockchain integration on arweave, id say lets name it version
1.0.0... i think the info needs now a breakdown on blockchains." New
capability, no breaking changes. `codex-core` + `codex-ui` + `codex-ouronet`
release (`arweave-core`/`codex-arweave` unchanged). See each member
package's own CHANGELOG for the full technical account.**

- `codex-core`: new `CODEX_FORM_VERSION` export ("1.0.0") — deliberately
  separate from the at-rest schema-migration counter, not a repurposing of
  it.
- `codex-ui`: `ForeignChainsTab` gained an optional `chainLabels` prop (id →
  display-label override), fully backward compatible.
- `codex-ouronet`: `CodexInfoCard` shows the new "Codex Form" row + the
  3-chain breakdown; `CodexTabs` threads the new `chainLabels` prop through
  to relabel the Chainweb rail as "Stoa-Chainweb" (the underlying rail id
  is unchanged). Kadena-Chainweb is listed as a supported chain-identity
  now; the actual chain-switcher mechanics are explicit future work.

## 0.14.1 — 2026-09-26

**PATCH — the Advanced settings page's Apollo Curve section retired as a
misleading toggle. Owner ruling: Apollo (₱./Π.) has graduated from
experimental to always-on — it represents both Pythia API keys and Codex
halves — so the settings page must stop presenting it as something the
user can enable/disable. `ExperimentalCurvesCard` (`codex-ui`) is now a
static "Graduated · Always On" status display instead of a live toggle
button; the Advanced tab's wrapping section (`codex-ouronet`) relabeled
from "Experimental Curves"/"observational" to "Apollo Curve"/"graduated".
No behavior change to account creation itself — Apollo was already
unconditionally offered in Spawn Account before this release, only the
settings-page COPY was still implying otherwise. `codex-ui` +
`codex-ouronet` release (`arweave-core`/`codex-arweave` unchanged).**

## 0.14.0 — 2026-09-26

**MINOR — cross-checked an incoming "16 of 20 chain calls are broken" handoff against
`codex-ouronet`'s 0.13.2 fixes (all 16 already fixed; one handoff claim was itself
wrong, corrected with live-chain evidence), then ported the handoff's own suggested
verification tooling into `codex-ouronet`: a Pact signature manifest generated
straight from the `.pact` sources, a live hover `ExecutionTooltip` built on it (shows
a button's real on-chain function + parameters + live cost preview before it's
pressed — desktop only), and an offline `dist/`-scanning checker. New capability, no
breaking changes. `codex-ouronet` release only (`codex-ui`/`arweave-core`/
`codex-arweave` unchanged). See `@ancientpantheon/codex-ouronet`'s own CHANGELOG for
the full technical account.**

- `ExecutionTooltip` wired into `Zone2Wrapper` (universal baseline coverage across
  every ZBOM modal) and, with full argument-alignment + live preview, into Release
  and Register StoicTag's Execute buttons as the flagship demonstration.
- `scripts/generate-pact-signatures.py` / `scripts/check-call-sites.py` — new
  developer tooling, not part of the runtime bundle.

## 0.13.2 — 2026-09-26

**PATCH — the "complete rehaul of all Ouronet code" round: confirmed AND
fixed 9 distinct broken/disabled execute paths in `codex-ouronet`, each
independently re-verified against LIVE mainnet chain state
(`describe-module`) rather than source-tree greps or prior handoffs — the
deployed Ouronet Pact contracts underwent a full "patron/executor canon
2.2" rehaul (2026-09-22) that no static check could see. Triggered by an
owner report that Release StoicTag's execute STILL failed after the 0.13.1
guard-resolution fix. `codex-ouronet` release only (`codex-ui`/
`arweave-core`/`codex-arweave` unchanged). See
`@ancientpantheon/codex-ouronet`'s own CHANGELOG for the full technical
account.**

- Fixed the StoicTag execute crash itself (Release/Register both sent a
  stale, pre-rehaul argument shape to the now-deployed contract — reproduced
  the owner's exact error text live before fixing).
- Fixed `RegisterStoicTagModal`/`RenameDualLaneModal`/`ActivateApolloPythiaKeyModal`'s
  shared patron payment-key lookup (a retired chain function).
- Fixed `RotateGuardModal` (was permanently disabled) and `RotatePaymentKeyModal`
  (was permanently disabled, masking a second EXECUTE-level bug underneath).
- Restored the Link / Revoke Dual API Key INFO previews, previously removed
  for lack of a confirmed on-chain name — now confirmed and reconnected,
  with Revoke's real IGNIS fee showing again instead of an estimate.
- A full re-scan of every on-chain call this package's `src/` makes now
  resolves cleanly against mainnet — zero unresolved symbols, down from 3.

## 0.13.1 — 2026-09-25

**PATCH — fixes a second bug in the Release/Register StoicTag execute flow
that the 0.13.0 z-index fix had been masking: an owner-reported "unhandled
error" once the codex-unlock step could actually be reached. Root cause was
an unresolved keyset-ref guard object passed directly into the signing
step. `codex-ouronet` release only (`codex-ui`/`arweave-core`/`codex-arweave`
unchanged). See `@ancientpantheon/codex-ouronet`'s own CHANGELOG for the
full technical account.**

- `ReleaseStoicTagModal` and `RegisterStoicTagModal` now resolve both the
  patron's and the account's guard via `getStoaChainAccountGuard` before
  signing (previously only the account guard was resolved, only for Smart
  accounts, and only for display) — the same pattern already proven correct
  in `RevokeDualLinkModal`/`RenameDualLaneModal`/`LinkDualApiKeyModal`.

## 0.13.0 — 2026-09-25

**MINOR — a full wiring audit of every Ouronet execute flow, prompted by a
real reported failure: a signed action on a locked codex hung forever on
"Processing…" with no visible way to unlock. Found and fixed the root
cause (affecting ALL 12 ZBOM action modals at once) plus 4 more
modal-specific bugs, and added the first-ever direct test coverage for
every Ouronet Pact-code builder. `codex-ouronet` + `codex-ui` release
(`arweave-core`/`codex-arweave` unchanged).**

- **The dominant bug**: `CodexPasswordPrompt` (the global "Unlock Codex"
  dialog) could render invisibly BEHIND an already-open ZBOM action modal
  when a signed action triggered it on a locked codex — the modal-shell
  component both share gained an always-topmost override, fixing every
  signed action in the app at once.
- **2 modals with a permanently-disabled execute button**: `RevokeDualLinkModal`
  (a stale blocker left over from a prior fix) and `RegisterStoicTagModal`
  (an external dependency still building a broken Pact call) — both fixed.
- **2 modals with a silently-wrong cost estimate** (not blocking, but
  showing "free"/`0` instead of the real price): `ActivateStandardAccountModal`
  / `ActivateSmartAccountModal` — fixed with new local read overrides.
- **New direct unit test suite** (16 tests) locking in the exact Pact call
  every builder in `codex-ouronet` emits — the first test coverage any of
  these ever had. See `@ancientpantheon/codex-ouronet`'s own CHANGELOG for
  the full account.

## 0.12.4 — 2026-09-25

**PATCH — the last 3 `DPL-UR.URC_00*` reads in `codex-ouronet` switched to
their `P-UI-ONE` replacements, now confirmed deployed on mainnet. Fixes the
Single API / Dual API tabs, which were silently rendering the archived
read's failure as "not deployed" / "0" against real on-chain data (live
mainnet evidence: twelve registered keys and six active dual links). `codex`
-only release (`arweave-core` unchanged).**

- `getApiKeySelectorData`, `getDualApiKeySelectorData`, `getPythiaPrices`
  now read `P-UI-ONE.URC_01|ApiKeys` / `URC_02|DualLinks` / `URC_03|Prices`
  directly — same shape as before, only the module/function name changed.
- `getPythiaPrices` keeps a separate, still-unconfirmed caveat: an
  owner-side pricing-table init gap may still make it fail even with the
  correct name. See `@ancientpantheon/codex-ouronet`'s own CHANGELOG.

## 0.12.3 — 2026-09-25

**PATCH — genuine functional fix in `codex-ouronet`: 4 of the 7
`DPL-UR.URC_00*` reads are now read LIVE from `O-UI-SEVEN` directly,
bypassing the still-unpatched external `@ouronet/ouronet-core` dependency.
Ouronet Accounts tab hydration, the Stoa Accounts balance summary, and
Address Book StoicTag status resolution all read live chain data again.
`codex`-only release (`arweave-core` unchanged).**

- New package-local interim read implementations (`zbom/ouroSelectorReads.ts`)
  replace the 4 external `@ouronet/ouronet-core` calls that were still
  constructing the archived `DPL-UR.*` Pact names internally.
- The remaining 3 (Pythia registration/dual-link/pricing) are now named
  but deliberately not switched — they ship in a not-yet-confirmed-deployed
  chain release. See `@ancientpantheon/codex-ouronet`'s own CHANGELOG for
  the exact target names and flip-the-switch TODOs.

## 0.12.2 — 2026-09-25

**PATCH — corrects 0.12.1's own characterization of the seven `DPL-UR.URC_00*`
reads in `codex-ouronet`: DPL-UR is archived and these do NOT resolve on
mainnet at all. Documentation/metadata-only — no runtime behavior changes.
`codex`-only release (`arweave-core` unchanged).**

- 4 of 7 reads have a confirmed `O-UI-SEVEN` replacement, now reflected in
  this package's read registry and doc comments — but the live read stays
  broken until the external `@ouronet/ouronet-core` dependency (confirmed
  still unpatched at its latest published version, 4.6.0) ships a compatible
  release.
- 3 of 7 (Pythia registration, dual-link rows, pricing) have no confirmed
  replacement and are flagged CONFIRMED BROKEN rather than guess-renamed —
  see `@ancientpantheon/codex-ouronet`'s own CHANGELOG for exactly which.

## 0.12.1 — 2026-09-25

**PATCH — critical on-chain call-site fixes in `codex-ouronet`. Several ZBOM
reads/writes were calling functions that no longer exist (or never existed)
on mainnet, found via an external chain-symbol audit against mainnet
(measured 2026-09-25, against package v0.11.0). No public API shape
changes. `codex`-only release (`arweave-core` unchanged).**

- **`INFO_` cost-preview reads had their two name segments swapped**
  (`MODULE|INFO_Action` sent, chain wants `INFO_MODULE|Action`) — fixed for
  RegisterStoicTag, ReleaseStoicTag, DeployApiKey, and UpdateDualConsumerLane's
  cost previews.
- **Kadena→Stoa renames + a retired module**: `UR_AccountKadena`/
  `UR_AccountStoaChain` → `UR_AccountStoa`, `C_RotateStoaChain` →
  `C_RotateStoa`, and every `INFO-ZERO`-hosted cost preview (Deploy Smart/
  Standard Account, Rotate Governor/Guard/Sovereign/Payment Key) moved to
  `INFO-ONE` — `INFO-ZERO` no longer defines them.
- **Three write calls were one argument short of their declared arity**
  (Revoke Dual API Key, Rename Dual Consumer Lane, Link Dual API Key) — all
  three failed closed rather than executing with wrong authorization, but
  none executed at all. Fixed with a best-justified `executor` argument that
  is **not independently chain-verified** — see `@ancientpantheon/codex-ouronet`'s
  own CHANGELOG for the full caveat before shipping a mainnet transaction
  through these three flows.
- **Removed** two cost-preview reads that could not be verified to exist
  under any name (Link/Unlink Dual API Key) rather than guess-renaming them.
  Removing the Link preview also fixed an independent bug: the "Link
  halves" button could never become clickable at all in production, since
  it waited on that same always-failing read.
- Everything delegated to the external `@ouronet/ouronet-core` package
  (Rotate Payment Key, Rotate Guard, Activate Standard/Smart Account,
  Register/Release StoicTag's actual on-chain execute+info calls) is outside
  this repo and unchanged here — only the display-only strings shown to the
  user for those were corrected.

## 0.12.0 — 2026-09-24

**MINOR — full Pantheonic-mobile compliance across the whole packaged UI
surface, plus a wallet-sweep addition to native Arweave send. No breaking
changes.**

### Added — mobile UI parity (embeddable inside a host like OuronetUI)

The entire `CodexUiRoot` surface (`codex-ui` + `codex-ouronet`'s UI +
`codex-arweave`'s panel) now degrades correctly when embedded in a
constrained host rectangle instead of owning the full viewport — matching
the Pantheonic Mobile UI spec's container-relative framing, not just
viewport-relative. New shared primitives in `codex-ui`: a container-relative
`useIsMobile`, `SwipeDeck` (paginated/gesture panes with snap-scroll
correction), the Controls riser/drawer pattern, `EdgeRail`, and
`CodexModalShell`'s full-screen-on-mobile flip (every zbom/UrStoa/Send modal
built on it inherits this for free).

- **Chainweb (Ouronet) side** — Seed Words, Pure Keypairs, Ouronet Accounts,
  and Address Book tabs all got mobile-specific layouts: icon-only sticky
  sub-tab bars, slimmed collapsed rows (matched heights across tabs),
  responsive word grids with marquee overflow for long seed words, and —
  the headline pattern — tapping a row now opens its full detail as a
  genuine full-screen page (a `CodexModalShell` portal) instead of an inline
  expand bounded to a small on-screen zone, for seed rows, pure-key rows,
  and Ouronet account rows alike. ZBOM action modals (Rotate/Activate/etc.)
  now stack correctly ON TOP of that full-screen detail view instead of
  rendering invisibly behind it, and also go edge-to-edge full-screen on
  mobile instead of the old fixed-width desktop card.
- **Arweave side** — Pure Keys, Seeds, and Accounts panels mirror the same
  mobile patterns: icon-only seed-source buttons, portaled triple-dot row
  menus (escaping the swipe carousel's transform-clipping), full-screen
  expand for Pure Key detail (single-line truncated address, action buttons,
  then the RSA-parameter disclosure, each its own row), and 2-line compact
  account/seed rows.
- **Seed-words persistence.** Stoa Dalos and Arweave seeds can now carry a
  separately-encrypted `wordsSecret` alongside their existing derived
  bitstring secret, so a seed genuinely created from typed/generated words
  can show those same words back on later reveal — previously only the raw
  bitstring was ever recoverable.
- **The header debouncer's "What is this?" explainer**, present in the
  original OuronetUI implementation, is now wired here too: a labeled pill
  (replacing an easy-to-miss icon) opens a full-screen page explaining the
  seven-tier read taxonomy, reusing the existing Settings → Debouncer
  content. Also fixed: the debouncer's per-tier hover tooltip no longer gets
  clipped when mounted inside a bounded host rectangle (it now portals to
  `document.body` with viewport-relative positioning).
- **Playground**: a new `OuronetShellMock` testing harness (mimics
  OuronetUI's real mobile shell — 7-icon bottom tab bar, constrained
  embedded rectangle) so the mobile experience is exercised the way it's
  actually consumed, not just full-viewport standalone.

### Added — Arweave: Super Max wallet sweep

- Send AR gained a "Super Max" mode that attempts a full wallet sweep using
  the exact live network fee (no safety buffer), for the case where a user
  wants to fully empty an account.

## 0.11.0 — 2026-09-17

**MINOR — two new chain capabilities: native Arweave (balance, send, keyring,
seeds) and direct native Stoa/UrStoa movement (vault actions + send). No
breaking changes. `codex`-only release** (`arweave-core` unchanged).

### Added — Arweave: keyring, seeds, live balance + native send

- **Pure Keys** category wired end-to-end: random RSA-4096 generation via a
  Generate/Save two-step flow (free reroll before commit), PEM keyfile
  import (private+public `.pem`, cross-validated via WebCrypto, discarded
  after save) alongside JSON-keyfile import, per-row RSA parameter details,
  a balance-aware delete guard (blocks deleting a funded seedless key, warns
  on a seed-protected one), and Chainweb-style collapsible rows.
- **Seeds**: Direct Deterministic RSA Generation (BitString/Bitmap/Base-10/
  Base-49, 1024/1600-bit) alongside Seed Words Deterministic RSA Generation;
  a unified 3-tile "enter your own seed" picker (Stoa Dalos / Dictionary
  12-word / Dictionary 24-word); unified seed reveal UI with DALOS-charset
  info and a worst-case entropy preview.
- **Live balances + native AR send**: every account row shows a real
  on-chain balance (with a manual refresh control) instead of a hardcoded
  placeholder. The Send AR modal offers a "Fee Included" (typed amount is
  the total debited) / "Fee On Top" (typed amount is exactly what the
  recipient gets) toggle with an estimated-arrival line, live balance-aware
  validation, and the codex-unlock gate now pops the real password prompt
  on a locked codex instead of dead-ending on a static error.
- **Real on-chain transaction confirmation.** The send toast now polls
  Arweave's own gateway (`getTransactionStatus`, the same primitive the
  Library's upload-confirmation flow already uses) every 15s for up to
  ~10 minutes instead of guessing "done" the instant the broadcast
  succeeds, and links "View on Explorer" at ViewBlock's Arweave tx page
  with a distinct violet accent (not StoaChain's explorer/gold — the old
  link pointed an Arweave tx id at StoaChain's explorer, a dead link). The
  settled toast stays visible 10x longer, and carries an honest caption
  about third-party explorer indexing lag.
- **Balance freshness.** The Accounts view now refreshes every visible
  balance on real transaction confirmation (not just at broadcast time,
  before a debit is final) and shows a live "Updated Xs ago" label next to
  "Live balances" so staleness is never a guess.
- **Watch-list persistence.** Watched addresses (and the Prime Arweave
  Seed) now round-trip through the codex JSON backup export/import — both
  were previously dropped silently on reload. "Real" gateway mode is now
  the default (mock mode moved to Codex UI Settings, no longer shown on the
  main Accounts view), with a one-time migration off a stale local gateway
  default and a fixed "Watch" button that previously threw on first use.

### Added — direct native Stoa / UrStoa movement

- **UrStoa vault actions** on the Chainweb Accounts tab: a Stoa/UrStoa
  toggle shows liquid + staked + claimable balances (bulk chain-0 read) and
  exposes **Transfer / Stake / Unstake / Collect** as icon buttons with
  live-data tooltips; Stoa mode keeps a single Send button. Every action
  shows the standard submit/confirming/confirmed toast, and the row
  highlight now accounts for staked/claimable balances, not just liquid.
- **Native Stoa send** (`coin.C_Transfer`/`coin.C_TransferAnew`) now shows
  which of the 10 braided chains the transfer actually executes on and the
  sender's balance ON that specific chain — a balance on chain 3 doesn't
  fund a send that runs on chain 0.
- **Locked-codex fix**, applied uniformly to all six modals above plus Send
  AR: a signed action attempted on a locked codex now pops the real
  password prompt and resumes automatically, instead of showing a static
  "Codex is locked" error and dead-ending. A cancelled prompt stops
  quietly — declining to unlock isn't a failure.

## 0.10.0 — 2026-08-10

**MINOR — fixes a real transaction bug on every signed transaction; raises two
peer floors. `codex`-only release** (`arweave-core` unchanged).

### Fixed — `meta.gasPrice` was never set

All **13** signed/submitted transaction-building sites omitted `gasPrice`
entirely, so Pact's client default (`1e-8`) went out on the wire instead of the
live Yin Engine floor — under-priced commands that chainweb can reject.

`@stoachain/stoa-core@4.4.0` exports the canonical Yin Engine gas formula
(`minGasPriceAnu`, `anuToStoaNumber`, `stoaGasMeta` from
`@stoachain/stoa-core/gas`), and `CodexSigningStrategy.execute()` now performs
**one** `stoaGasMeta()` clock read per call and injects `gasPrice` +
`creationTime` into every `build(ctx)` callback, alongside the `gasLimit` it
already injected. Every site now accepts both from that ctx and spreads them
into `.setMeta({...})`, consistently — no site calls `stoaGasMeta()` or
`safeCreationTime()` itself.

This also fixes a **latent request-key bug**: the strategy invokes `build()`
twice (a gas-measuring simulation pass, then the real pass). The old per-call
`safeCreationTime()` produced a *different* `creationTime` between the two
passes, changing the command hash. Taking `creationTime` from the injected ctx
guarantees both passes see identical values.

Two operations (`RotateGuard`, `RotatePaymentKey`) additionally exist as
delegating modals that call `rotateGuard()` / `rotateKadenaPaymentKey()` in
`@ouronet/ouronet-core`; those were fixed upstream and need no local change —
the re-pin alone corrects them.

### Added

- `tests/tx-gas-meta-surface.test.ts` — a shape guard locking the exact inventory
  of transaction sites and asserting every one passes `gasPrice` + `creationTime`
  from the injected ctx (and re-reads no clock). A new transaction site fails the
  suite until it satisfies the gas contract.

### Changed — peer floors (action required)

Consumers **must** provide:

- `@stoachain/stoa-core` **>=4.4.0** (was >=4.3.0)
- `@stoachain/kadena-stoic-legacy` **>=4.4.0** (was >=4.3.0)
- `@ouronet/ouronet-core` **>=4.6.0** (was >=4.3.0)

## 0.9.1 — 2026-08-10

**PATCH — Address Book display fixes, no API changes. `codex`-only release**
(`arweave-core` unchanged).

- **No more horizontal bulge.** Long, unbreakable Ouronet addresses in the
  Address Book no longer expand a card past the page width. The entry-list grid
  now uses `grid-template-columns: minmax(0, 1fr)` so the single column is clamped
  to the container and long rows truncate instead of overflowing. Fixes all three
  sub-tabs (Ouronet, StoaChain™, StoicTags) in one change.
- **Consistent address rendering.** Ouronet Address Book entries now use the same
  `OuronetAddressHighlight` component as the Ouronet Accounts tab — blue-bold
  first-3/last-3 highlight, fills the available width, centered `start … end`
  middle-truncation.
- **No display "retract".** `MiddleEllipsis` and `OuronetAddressHighlight` render
  directly in their final truncated form (kept hidden until the measured width
  settles) — no visible "long → shrink" flash on mount.
- **Removed the erroneous `KADENA:MAINNET` chain chip** from Address Book rows —
  everything sits on StoaChain, which is mainnet-only.

## 0.9.0 — 2026-08-08

**MINOR — additive, no breaking changes. `codex`-only release** (`arweave-core`
unchanged).

Pythia consumer-API-key management in the Ouronet accounts view. Two new account
sub-tabs — **Single API** (link Apollo ₱./Π. halves into a dual API key) and
**Dual API** (manage the linked composite keys) — plus three ZBOM transaction
modals authorized by both half-owners: **Link** (no fee), **Rename lane** (100
STOA, 4-way split), and **Revoke** (1 IGNIS kill-switch). Costs and split
receivers are read from the on-chain INFO so they never drift. Also adds a
**post-transaction refresh**: the whole accounts view now re-reads chain state
automatically once any Codex transaction confirms (activation, guard, payment
key, API-key status, dual links), instead of requiring a manual reload. Fixes
registered-but-unlinked API halves reading as linked, and a stale signing-zone
spinner on owner-only transactions.

## 0.8.1 — 2026-08-03

**PATCH — bug fix.** The Ouronet account card no longer hides an account's
Payment Key when that payment-key address has never held STOA. Every registered
Ouronet account is assigned a payment key at activation; the chain's
`payment-key-existance` flag reports only whether that address has ever held
STOA (virgin vs funded), not whether a payment key exists — but the card gated
the whole Payment Key section on it, so a virgin (never-funded) payment key
vanished entirely. It now shows the payment-key address whenever the chain
returns one, with a "virgin · never funded" marker instead of dropping the
section.

## 0.8.0 — 2026-08-03

**MINOR — additive, no breaking changes. `codex`-only release** (`arweave-core`
unchanged).

**`createHeadlessKadenaResolver`** — a new export from
`@ancientpantheon/codex/ouronet`: a server-safe, pre-bound Kadena `KeyResolver`
(`{ getKeyPairByPublicKey, listCodexPubs }`) for headless Khronoton automatons
(Pythia, Mnemosyne). A consumer supplies only a `loadSnapshot` + `getPassword`
thunk pair and binds **zero** `@stoachain` crypto itself — all seedType-aware
derivation (koala / chainweaver / eckowallet / pure-foreign, with the wrong-key
refusal guard) is delegated to Codex's one canonical headless resolver. This
replaces the per-consumer hand-rolled `KeyResolver` derivations that had drifted
koala-only and caused a live signing failure on non-koala operator seeds.
Importing it from `/ouronet` loads no React/DOM (headless Node-safe). The
existing browser `InternalCodexResolver` now shares the exact same derivation
binding (extracted, not duplicated).

## 0.7.0 — 2026-07-30

**MINOR — additive, no breaking changes. `codex`-only release** (`arweave-core`
is unchanged at this tag).

**`autoSignApolloChallenge`** — a new export from `@ancientpantheon/codex/ouronet`
letting a server-side Automaton (Pythia first) prove ₱./Π. Apollo-account
ownership autonomously, on a recurring timer, with zero browser and zero human
prompt (docs/HANDOFF-pythia-autonomous-connector.md). Given an already-decrypted
Codex snapshot + codex password, it reuses the exact canonical challenge
message and `dalos-apollo` Schnorr signing already proven by the existing
browser `/apollo-verify` flow, so a signature it produces verifies against
Pythia's existing verifier unchanged. Same precedent as `rekeyCodex` in
0.6.0 — a pure, server-callable primitive surfaced through this barrel for a
headless consumer.

## 0.6.1 — 2026-07-22

**PATCH — dependency rename, no behaviour change.**

The Ouronet libraries moved out of `StoaChain/stoa-js` into [`OuroborosNetwork/ouronet-libs`](https://github.com/OuroborosNetwork/ouronet-libs) in the Phase-4 reorganisation, so that published identity matches org ownership. The peer and dev dependencies follow:

| Was | Now |
|---|---|
| `@stoachain/ouronet-core` | `@ouronet/ouronet-core` |
| `@stoachain/dalos-crypto` | `@ouronet/dalos-crypto` |

The old names are deprecated on npm. The chain-level packages (`@stoachain/stoa-core`, `@stoachain/kadena-stoic-legacy`) are unchanged — they still ship from `stoa-js`.

**Codec version gate updated.** The published core's `deserializeCodex` now accepts BOTH `"1.2"` and `"1.3"` while `buildCodexExport` still stamps `"1.2"`. `guard-codec-version-gate` previously asserted that `"1.3"` must be *rejected*; that was correct while this scope pinned a 1.2-only dist, and wrong once the core widened its reader. The load-bearing assertion is the WRITER staying at `"1.2"` — a reader narrower than the writer is the funds-loss direction, never the reverse. The gate now asserts the writer pin and that the reader accepts 1.3 forward-compatibly.

Also fixes a Windows-only false positive in the `arweave.net` hardcoded-endpoint guard, whose comment-stripper missed `//` comments on a CRLF checkout.

**1570 specs pass.**

## 0.6.0 — 2026-07-12

Add codex password rotation — the transform was missing from the package (only the `ChangePasswordCard` form + a consumer seam existed; the actual re-encryption lived in OuronetUI's app).

- **`rekeyCodex(snapshot, oldPassword, newPassword)`** — a pure, isomorphic (Node + browser), store-free `snapshot → snapshot` transform exported from `@ancientpantheon/codex/ouronet`. Re-encrypts EVERY codex-password secret (kadenaSeeds, ouroAccounts secret+backup, pureKeypairs, foreignKeys, and all CodexID `encrypted*` fields — the full inventory, owned in one place so it can't drift) old→new (output V2). Pre-flight verifies the old password (`WrongPasswordError` before any mutation); un-decryptable fields are skip-not-dropped (kept verbatim + reported).
- **`changeCodexPassword(old, new)`** store action + default `onChangePassword` wiring — `ChangePasswordCard` now works out of the box (rekey + `saveAll` + re-cache the session). A consumer-supplied `onChangePassword` still wins.

Resolves Mnemosyne Handoff 07. Additive — no breaking changes.

## 0.5.1 — 2026-07-12

Fix the STOA fee mark in the zbom cost row (`StoaChainCostDisplay`): it pointed at `/images/coins/WSTOA.svg` from the host app's public root, which broke (missing image) in consumers that don't ship that asset — e.g. Mnemosyne consuming the bundled package. Now renders the gold ❖ glyph inline (OuronetUI's canonical Stoa glyph), self-contained in the bundle so it displays identically in every consumer. No API changes.

## 0.5.0 — 2026-07-11

First functional aggregate. The six subpath barrels (root + `./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`) are wired to the internal members, and the members (`codex-core`, `codex-ui`, `codex-ouronet`, `codex-arweave`) are **bundled** into `dist` via tsup — both the runtime JS and the `.d.ts` are self-contained, so a TypeScript consumer type-checks against only this package + `@ancientpantheon/arweave-core`. Added the merged `./ui.css` export, the `arweave`/`@ardrive/turbo-sdk` external deps, and an auto-generated bundled-member-versions table in the README.

## 0.0.1 — 2026-07-04

Initial package skeleton — the empty-but-buildable consumer-facing aggregator scaffold. Wires the root entry point plus the five subpath barrels (`./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`), each an empty `export {};` module. No aggregation content yet; publish-eligible but unpublished.
