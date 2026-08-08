# Design: Single API + Dual API tabs (Ouronet accounts)

Iterative, local-first feature. Build → user inspects in the standalone Codex on :3007 →
feedback → iterate → version + publish only once approved. **No publish until the user says so.**

## Outcome (iteration 1)

Two new sub-tabs on the Ouronet accounts view (`OuronetAccountsTab`), after Standard/Smart:

- **3rd — Single API.** Two columns of the codex's own Apollo halves: Standard (₱., left) and Smart
  (Π., right), each with its own search box + pagination. Each half shows its API-key status —
  *not deployed* / **UNLINKED** / **LINKED** — derived from the existing `DPL-UR.URC_0031` read
  (`ApiKeyRow.counterpart === "BAR"` ⇒ unlinked). The user picks one **UNLINKED** Standard + one
  **UNLINKED** Smart (click a selected half again to deselect); a selection bar shows the pending
  pair with **Verify ownership** + **Link** buttons. Mirrors Pythia's Connectors panel. Buttons are
  **visual + selection only in iteration 1** — the actual verify/link functions are wired later.

- **4th — Dual API.** Lists the codex's mutually-linked ₱.|Π. composite keys (`<standard>|<smart>`,
  standard first, pipe-joined — matches the on-chain `PYTHIA|T|DualLinks` key). Each is read via the
  user's new `DPL-UR.URC_0033_DualApiKeyMapper` (→ `PYTHIA.UR_DualLinkRowOrNull` per composite), and
  the tab shows the Pythia deploy/rename prices from the user's new `DPL-UR.URC_0034_PythiaPrices`.
  Per dual key: the composite, the row fields (**defensive render** — known fields
  `standard-apollo`/`smart-apollo`/`consumer-lane`/`iz-active` plus a dump of any other keys, since
  the exact `UR_DualLinkRowOrNull` shape is only confirmable against the live node), a status pill
  (active / pending / revoked from `iz-active`), and stubbed buttons.

## Decisions

- **Read wrappers added locally** in `packages/codex-ouronet/src/zbom/pythia/deployApiKey.ts`,
  following the exact `getApiKeySelectorData` (URC_0031) pattern — direct `pactRead` against the live
  PYTHIA surface, no dependency on `@ouronet/ouronet-core` shipping them:
  - `getDualApiKeySelectorData(dualKeys: string[]): Promise<Array<DualLinkRow | null>>` →
    `(ouronet-ns.DPL-UR.URC_0033_DualApiKeyMapper [ "std|smt" … ])`, index-aligned.
  - `getPythiaPrices(): Promise<PythiaPrices | null>` → `(ouronet-ns.DPL-UR.URC_0034_PythiaPrices)`.
  - Helpers: `DUAL_LINK_BAR = "|"`, `buildDualKey(standard, smart)`, `isApiKeyLinked(row)`
    (`counterpart !== "BAR"` and non-empty), `dualKeyStatus(row)`.
  - The user's pasted Pact source is authoritative (these functions are newer than the repo docs,
    which still describe `UR_ActiveDualLinkSet`/`UR_Counterpart`).
- **New panels are separate components** (`SingleApiPanel.tsx`, `DualApiPanel.tsx`) imported into
  `OuronetAccountsTab`, to keep that file readable and the diff reviewable. They receive the already-
  computed Apollo account lists + `apiKeyMap` as props (the URC_0031 batch read stays in the tab —
  one read serves the pills AND both new tabs); `DualApiPanel` additionally does the URC_0033/0034
  reads itself.
- **Apollo accounts stay visible in Standard/Smart too** (non-destructive for iteration 1). Flagged
  to the user: they can ask to split Apollo out of Standard/Smart later.
- **Tab plumbing is purely local** to `OuronetAccountsTab`: widen `activeTab` union, add two tab
  buttons, branch the render. No CodexTabs / playground / surface-test change. Default tab stays
  `"standard"` and the `Standard (N)`/`Smart (N)` labels are preserved (two existing tab tests depend
  on them).

## Data model (confirmed)

- `ApiKeyRow` (URC_0031, per half): `public`, `counterpart` (`"BAR"` until linked, else the other
  half's Apollo id), `owner-account`, `registered-at`, `updated-at`, `apollo-account`.
  Registered = non-empty `owner-account` (`isApiKeyRegistered`). Linked = `counterpart !== "BAR"`.
- Composite dual key: `` `${standard}|${smart}` `` (standard first).
- `DualLinkRow` (URC_0033 → `UR_DualLinkRowOrNull`, per the organ doc — verify live):
  `standard-apollo`, `smart-apollo`, `consumer-lane`, `iz-active` (bool kill-switch). Rendered
  defensively so the real shape surfaces on inspection.
- `PythiaPrices` (URC_0034): `deploy-price`, `rename-price`, `deploy-price-text`, `rename-price-text`.

## Verify locally (:3007)

`cd apps/codex-playground && npm run dev` → pinned to :3007 (LocalHost registry, strictPort). The new
sub-tabs appear automatically inside the Ouronet Accounts tab. Reads hit the live StoaChain node the
user has configured in the Network settings — so URC_0031/0033/0034 resolve against real data.

## Acceptance (iteration 1 — for user inspection, not publish)

- [ ] Single API + Dual API tabs appear after Standard/Smart; Standard/Smart unchanged.
- [ ] Single API: two columns, per-column search + pagination, per-half status pill, pick one
      unlinked each side, selection bar + stubbed Verify/Link.
- [ ] Dual API: lists codex's linked composites, reads URC_0033 rows + URC_0034 prices, defensive
      row render, status pill, stubbed buttons.
- [ ] Full workspace typecheck + build green; codex-ouronet tests green (incl. the two tab-label
      tests); runs on :3007 for inspection.

## Out of scope (iteration 1)

- Wiring the actual verify-ownership + link transactions (buttons are stubs).
- Rename-lane / kill-switch actions (shown, not wired).
- Splitting Apollo out of the Standard/Smart tabs (pending user call).
- Versioning / publishing (only after user approves the UX).
