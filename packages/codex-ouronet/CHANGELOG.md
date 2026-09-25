# Changelog

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
