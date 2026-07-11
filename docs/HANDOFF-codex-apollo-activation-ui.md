# HANDOFF → Codex agent: Apollo Accounts + "Activate as Pythia API Key" (the account-management UI)

**Audience:** an agent working in the **Codex** repo (`D:\_Claude\AncientPantheon\Codex`).
**From:** OuronetUI-side investigation (2026-07-08). **Status:** spec-ready, NOT implemented.
**Owner has confirmed the on-chain module is LIVE** — this is UI + TS-wrapper work only.

## Relationship to the other docs (read this first)

- **Complements** [`docs/HANDOFF-codex-pythia-key.md`](HANDOFF-codex-pythia-key.md). That doc covers the
  **connection header** (`createPythiaConnection` + `X-Pythia-Key`) and the **`signChallenge`**
  primitive. This doc covers the **account-management UI**: un-gating Apollo creation, the
  observational→activated state model, the "Activate as Pythia API Key" modal, and copy-public-key.
- **⚠ CORRECTION to that doc's §3.** It states *"the Activate UI + un-gate Apollo creation lives in
  OuronetUI, not the Codex library."* **That is wrong.** The account-spawn modal, the account list, the
  Activate modals, and the observational styling all live **in this repo** (`@ancientpantheon/codex-ouronet`),
  which OuronetUI mounts wholesale via `<CodexUiRoot>`. So D1–D4 below are **codex-ouronet work**. Only the
  **redirect-sign page/route** (the browser page that receives Pythia's nonce) is a consumer-app concern —
  and even that just calls the `signChallenge` primitive this repo exposes (see §8).
- **The ICD's `APIARY` names are DEAD.** [`Pythia/docs/HANDOFF-consumer-key-INTERFACES.md`] proposed a
  placeholder module `APIARY` / `C_DeployApolloPythiaApiKey` / `UR_IsActivated`. The owner has since
  given the **real deployed surface** — use **only** the §2 names below. Ignore `APIARY` everywhere.

---

## 0. The model in one paragraph

A **Pythia API key IS an Apollo Account** — its `₱./Π.` Apollo **public** key. Today Apollo accounts are
gated behind an "experimental curves" toggle and hard-labelled *"observational — cannot activate or sign."*
The new model: **anyone can create an Apollo account** (un-gate), it sits **observational while not
activated** (the "not-activated" tag), and its per-row **Activate** button — currently disabled for Apollo —
is **enabled and relabelled "Activate as Pythia API Key."** Activating calls an on-chain deploy that charges
STOA and registers the key row `activated=false`; ownership is later proven off-chain (the `signChallenge`
handshake) and the hub Cronoton flips it live. Once activated, the account is **no longer observational** —
it's an on-chain entity the Codex stores. The Apollo **seed never leaves the Codex**; only the public key and
the signature ever travel.

---

## 1. Ground truth — exact files in THIS repo

All under `packages/codex-ouronet/src/` unless noted:

| File | Role |
| --- | --- |
| `ui/internal/SpawnAccountModal.tsx` | **D1** — the account-spawn modal. Line ~110 `const experimentalCurvesEnabled = uiSettings.experimentalCurvesEnabled === true;`; line ~396 branches on it (OFF → DALOS-only fixed badge; ON → the `["dalos","apollo"]` curve picker). Line ~424 renders the "APOLLO is observational… cannot be activated or used to sign" warn banner. Line ~172 `if (curve === "apollo") registry.register(Apollo);` + `primitiveId = "dalos-apollo"`. |
| `ui/internal/originCurve.ts` | **D2** — `detectOriginCurve(account)` + `isExperimentalAccount(account)`. Header comment asserts Apollo "can't be activated on chain" — the model changes. |
| `ui/tabs/OuronetAccountsTab.tsx` | **D2/D3/D4** — the account list. Renders the Apollo `"observational"` pill, the Active/Inactive/Observational badge, the row-level **Activate** button, and imports `ActivateStandardAccountModal` / `ActivateSmartAccountModal` from `../../zbom/modals/`. This is where the button is relabelled + wired and where the public-key copy lives. |
| `zbom/modals/ActivateStandardAccountModal.tsx` | Reference (patronless activate). |
| `zbom/modals/RegisterStoicTagModal.tsx` | **THE template for D3** — patron-bearing CFM modal, INFO-driven cost, owner-account ownership guard, Smart-account `AuthPathZone`, `ns.TS01-C4.CODEX\|C_RegisterStoicTag`. The Pythia deploy maps ~1:1 (see §5). |
| `types/entities.ts` | `OuronetOriginCurve = "dalos" \| "apollo"`; `IOuroAccount` (`publicKey`, `originCurve`, `isActive`, `isSmart`); `uiSettings.experimentalCurvesEnabled`. Add the Pythia-activation status field here (§4). |
| `ui/internal/dalosGlyphs.ts` | `filterToDalosGlyphs` + `MAX_STOIC_TAG_GLYPHS` — the StoicTag input rules = the `consumer-lane` rules (owner said "consumer-lane follows the same rules as StoicTags"). |
| `codex-ui` pkg: `src/ui/settings/ExperimentalCurvesCard.tsx` | The settings toggle. See D1 for how far to retire it. |

`SpawnAccountModal` derives the Apollo key from the registry (`registry.register(Apollo)` from
`@stoachain/stoa-core/dalos` / `@stoachain/dalos-crypto`) — the Apollo primitive exposes its own
`sign`/`verify`/`generateFromSeedWords` (Gen-1 Schnorr v2 on Apollo's 1024-bit ellipse). **Apollo CAN sign** —
the "cannot sign" copy is now false for the Pythia lane.

---

## 2. The real on-chain surface (owner-provided — authoritative)

Namespace `ouronet-ns`. **Execution** functions live in the **`TS01-C4` (Talos)** module; the **INFO**
function lives in the **`PYTHIA`** module. All three take the same 5 args.

```lisp
;; Standard Apollo account (₱.)  — user-callable, no admin gate
(defun PYTHIA|C_DeployApiKey:string
  ( patron:string owner-account:string apollo-account:string public:string consumer-lane:string ) ...)

;; Smart Apollo account (Π.)      — ADMIN-ONLY: enforces GOV|PYTHIA_ADMIN → ouronet-ns.dh_master-keyset
(defun PYTHIA|A_DeploySmartApiKey:string
  ( patron:string owner-account:string apollo-account:string public:string consumer-lane:string ) ...)

;; Shared INFO (cost + receivers), returns object{OuronetInfoV1.ClientInfo}
(defun PYTHIA|INFO_DeployApiKey:object{OuronetInfoV1.ClientInfo}
  ( patron:string owner-account:string apollo-account:string public:string consumer-lane:string ) ...)
```

**Likely fully-qualified names** (confirm exact module path against the deployed contract / the ouronet-core
builder — mirror how StoicTag resolves to `ouronet-ns.TS01-C4.CODEX|C_RegisterStoicTag` +
`ouronet-ns.CODEX.CODEX|INFO_RegisterStoicTag`):
- Execute (standard): `ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey`
- Execute (smart): `ouronet-ns.TS01-C4.PYTHIA|A_DeploySmartApiKey`
- INFO: `ouronet-ns.PYTHIA.PYTHIA|INFO_DeployApiKey`

**Arg semantics:**
- `patron` — pays gas, exactly like every other Ouronet function on the UI (PatronZone → payment key → `GAS_PAYER` + `coin.TRANSFER` splits from INFO).
- `owner-account` — the currently-selected **active Ouronet (DALOS) account**; **its ownership is enforced** on-chain → its guard must sign (mirror StoicTag's tagged-account guard).
- `apollo-account` — the **Apollo account being activated** (the row the button hangs off). Standard ₱. → `C_DeployApiKey`; Smart Π. → `A_DeploySmartApiKey`.
- `public` — the Apollo account's **public key**, derived the same way DALOS activation derives it (`ouroAccount.publicKey` = the base-49 `{len}.{xy}`; for Apollo this IS the `₱./Π.` key). Autonomous, read-only.
- `consumer-lane` — operator-typed label (e.g. `OuronetUI`), **validated by StoicTag rules** (`filterToDalosGlyphs` + `MAX_STOIC_TAG_GLYPHS`).

**Admin gate (smart variant only):** `A_DeploySmartApiKey` enforces `GOV|PYTHIA_ADMIN`, which resolves to
**`ouronet-ns.dh_master-keyset`**. The modal must, for the smart variant, **read that keyset from chain**,
verify the Codex holds its key(s), add them as required signers, and **block with a clear "admin-only"
message** if absent. Standard users can only register **standard** Apollo keys.

---

## 3. Deliverable 1 — un-gate Apollo creation

**Goal:** any user can spawn an Apollo account without flipping an experimental toggle.

In `SpawnAccountModal.tsx`: make the curve picker (`["dalos","apollo"]` grid, currently the
`experimentalCurvesEnabled ? …` branch at line ~396) **always render**. Drop the OFF-state DALOS-only badge,
or keep it only as the visual when a future non-Apollo curve needs gating.

**"Take the option out" — owner's open choice (confirm before coding):**
- **(a) Recommended:** stop gating Apollo on `experimentalCurvesEnabled` (always show the dalos/apollo
  picker); **leave** `ExperimentalCurvesCard` + the `uiSettings.experimentalCurvesEnabled` field in place as
  an inert seam for future curves. Smaller blast radius.
- **(b)** Fully remove the toggle/card + the flag reads. Larger sweep (touches `codex-ui`
  `ExperimentalCurvesCard`, `types/entities.ts`, any `isExperimentalAccount` callers, the OuronetUI-side
  `useAutoEnableExperimentalCurves` when reinserted).

**Copy fix:** the Apollo warn banner (line ~424) and the spawn subtitle (line ~387, *"OBSERVATIONAL — APOLLO
accounts cannot be activated on StoaChain™"*) must change. Apollo accounts **can** now be activated (as Pythia
keys) and **can** sign. Keep the accurate nuance: an Apollo account is **not** a general transacting Ouronet
account (no token ops / it's not an Ѻ./Σ. account) — it exists to become a Pythia API key.

---

## 4. Deliverable 2 — the observational→activated state model

Today "observational" is treated as a **permanent property of the Apollo curve**
(`isExperimentalAccount = curve !== "dalos"`; `OuronetAccountsTab` hard-codes `isApollo → "Observational"`).
The new model: **observational = "not yet activated as a Pythia key."** It is a **status**, not a curve trait.

- Unactivated Apollo account → **Observational** badge (the "not-activated tag"). Still usable as the Codex
  Key mockup, still shows key material for export/copy.
- Activated Apollo account (Pythia key live on-chain) → **not** observational; render it as an active
  on-chain entity (an "Active · Pythia API Key" badge), the same way DALOS accounts flip Inactive→Active.

**Implement:**
1. Add a Pythia-activation status to the account entity in `types/entities.ts` (e.g.
   `pythiaActivated?: boolean` / a small `pythiaKey?: { activated, consumerLane, … }`), populated from a
   **chain read**. The owner gave the write (`C_/A_`) + INFO funcs but **not the read** — you need a
   `PYTHIA` read (a `UR_`-style "is this apollo-public activated / row lookup") wired into the periodic sync
   (the same ~80s account-refresh path DALOS accounts use). **Flag this read as a dependency** to confirm
   with the Pythia/hub owner (name + shape).
2. In `originCurve.ts` / `OuronetAccountsTab.tsx`: gate the "Observational" rendering on
   `isApollo && !pythiaActivated`. When `pythiaActivated`, show the active-key styling + surface the
   `consumer-lane` and status. Do not let "Observational" and "Active" both apply.

---

## 5. Deliverable 3 — "Activate as Pythia API Key" modal

**Build `zbom/modals/ActivateApolloPythiaKeyModal.tsx` by cloning `RegisterStoicTagModal.tsx`** — it is the
closest existing pattern (patron + owner-account ownership + StoicTag-validated lane + INFO-driven cost +
Smart `AuthPathZone`). Keep the exact CFM plumbing:

- **INFO (Zone 0):** `getDeployApiKeyInfo(patron, ownerAccount, apolloAccount, publicKey, consumerLane)` →
  `{ info, receivers }`. Cost = `info.kadena["kadena-full"]`; splits = `info.kadena["kadena-split"]`; never a
  UI literal (governance knob stays live). (New interaction — see §7.)
- **Patron (Zone 1):** `PatronZonePattern2` + `getWrapperPaymentKey` / `getPaymentKeyBalance` — unchanged
  from StoicTag.
- **Inputs (Zone 2):**
  - `patron` (autonomous, from PatronZone).
  - `owner-account` (autonomous) — the selected active **Ouronet DALOS** account whose ownership is enforced.
    Decide the UX: default to CodexPrime / the active account; allow selecting another owned account. Its
    guard signs (StoicTag's `account` role) — Smart owner-account → `AuthPathZone` enforce-one branch.
  - `apollo-account` (autonomous) — the Apollo row the modal was opened from.
  - `public` (autonomous, read-only) — `apolloAccount.publicKey`.
  - `consumer-lane` (free input) — validate via `filterToDalosGlyphs` + `MAX_STOIC_TAG_GLYPHS`.
- **Execute:** build via `buildDeployApiKeyPactCode(...)` (standard) or `buildDeploySmartApiKeyPactCode(...)`
  (smart), selected by whether `apollo-account` is `isSmart`. Signer structure mirrors StoicTag: patron's
  payment key signs `GAS_PAYER` + one `coin.TRANSFER` per receiver; `guards: [patronGuard, ownerAuthGuard]`;
  `paymentKey` + `extraSigners: [paymentKP]`. Route through `useSignTransaction().execute` and gate with
  `useEnsureCodexUnlocked()` (already the pattern).
- **Smart-variant admin gate:** if `apollo-account.isSmart`, additionally load `ouronet-ns.dh_master-keyset`,
  add its keys as required signers, and add a signer-readiness row + blocker (`"Admin keyset (dh_master)
  not in Codex — smart-Apollo activation is admin-only"`). Standard variant skips this entirely.
- **Copy:** make it explicit the key is registered **inactive** and needs the ownership-proof handshake to go
  live (it is NOT usable until the hub flips it).
- **`Zone2Wrapper.functionName`** = `ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey` (or `A_DeploySmartApiKey`);
  set `functionMeta.addedInVersion` to the release that ships this.

**Wire the trigger in `OuronetAccountsTab.tsx`:** for `isApollo` rows, enable the (currently disabled)
Activate button, relabel to **"Activate as Pythia API Key"**, and open this modal. Show
"Register (cost from INFO)" when no on-chain row exists vs "Registered · awaiting activation" once it does.

**Hard rule:** this modal only **registers + pays**; it must **never** set `activated=true`. Activation is
hub-Cronoton-only (see §8). No self-activation path.

---

## 6. Deliverable 4 — surface + copy the Apollo public key

In the Apollo row (`OuronetAccountsTab.tsx`) add a labelled copy-to-clipboard field for
`account.publicKey` (the `₱./Π.` key) with hint copy: *"Bake this Apollo PUBLIC key into your consumer build;
the Codex forwards it as the Pythia key header. Never ship the seed."* Public-safe because Pythia is keyless
(a leaked public key can only burn that lane's rate budget). Show activation status next to it (Observational →
Registered → Active) once §4's read lands. Much of the row scaffolding (public-key display, copy button) is
already present — this is mostly adding the "bake this" affordance + wiring the status.

---

## 7. ⚠ Upstream blocker — the ouronet-core TS builders don't exist yet

The modal imports its INFO + Pact builders from **`@stoachain/ouronet-core`** (in the **stoa-js** monorepo,
`https://github.com/StoaChain/stoa-js`), same as `ActivateStandardAccountModal` /
`RegisterStoicTagModal` do. As of 2026-07-08 the installed `@stoachain/ouronet-core` (4.3.6) has **only**
standard-account + StoicTag builders. The Pythia ones **must be authored upstream, published, then pinned
here**:

- `interactions/` — `getDeployApiKeyInfo(patron, ownerAccount, apolloAccount, publicKey, consumerLane)`
  (calls `PYTHIA|INFO_DeployApiKey`, returns the `ClientInfo` shape with `receivers` + `kadena-full` /
  `kadena-split`). Model it on `getRegisterStoicTagInfo` (`interactions/ouroAccountFunctions`).
- `pact/` — `buildDeployApiKeyPactCode({ patron, ownerAccount, apolloAccount, publicKey, consumerLane })`
  → `ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey ...`, and `buildDeploySmartApiKeyPactCode(...)` →
  `A_DeploySmartApiKey`. Model on `buildRegisterStoicTagPactCode`.
- A **read** (`interactions/`) for §4's activation status.

**The on-chain module is live, but these wrappers are not.** Do not inline Pact strings in the modal (house
rule: one builder + one test per Pact function upstream). Coordinate with the ouronet-core / hub owner, or
own that upstream change first. This is the one true cross-repo dependency.

---

## 8. The sign side (already speced — do NOT rebuild here)

The ownership-proof signing is `signChallenge(nonce, apolloPublicKey)` — fully speced in
[`HANDOFF-codex-pythia-key.md`](HANDOFF-codex-pythia-key.md) §2 (locate the seed in the vault by derived
Apollo public key, derive via `deriveDoubleApollo`, call the Apollo primitive's `sign`, return **only** the
signature). Apollo `sign`/`verify` are **optional** on the registry primitive — assert at runtime that the
registered Apollo primitive implements them and that `generateFromSeedWords → sign → verify` round-trips
before shipping. The **redirect page** that receives Pythia's nonce and calls `signChallenge` is the
**consumer app's** (OuronetUI's `verify-*` route family) — not this repo. This repo's job is to **expose the
`signChallenge` primitive** through the package barrel. Field names for that handshake are fixed by the ICD:
inbound `apolloPublic` + `nonce` + `returnUrl`, outbound `returnUrl?apolloPublic=&nonce=&signature=`.

---

## 9. Hard rules + open questions

**Hard rules (non-negotiable):**
1. Apollo **seed never leaves the Codex** — only `publicKey` + signature travel.
2. This UI **never** sets `activated=true` — deploy registers + pays only; the hub Cronoton flips it.
3. Only the **PUBLIC** key is baked/copied/sent.
4. Cost comes from **INFO**, never a UI literal. No per-account key limit (the STOA charge is the paywall).
5. Smart-Apollo activation is **admin-only** (`dh_master-keyset`); standard-Apollo is open.

**Open questions to confirm with the owner / Pythia+hub agents:**
1. Exact fully-qualified module paths for the three funcs (§2) — confirm against the deployed contract.
2. The **activation-status read** function name + shape (§4) — not yet provided.
3. `owner-account` UX: fixed to the active/CodexPrime account, or a selector over owned accounts?
4. Does `A_DeploySmartApiKey`'s `dh_master-keyset` sign in addition to the owner-account guard, or replace the
   ownership requirement? (Assume **in addition** unless told otherwise.)
5. D1 scope: retire the experimental toggle fully, or just un-gate Apollo (§3 (a) vs (b))?

---

## 10. Checklist + ship path

**Create:** `packages/codex-ouronet/src/zbom/modals/ActivateApolloPythiaKeyModal.tsx` (+ test).
**Change:** `SpawnAccountModal.tsx` (un-gate + copy), `originCurve.ts` + `OuronetAccountsTab.tsx`
(observational→activated model, button relabel/enable, copy-public-key), `types/entities.ts`
(pythia-activation status), optionally `codex-ui` `ExperimentalCurvesCard.tsx` (if D1(b)).
**Upstream (stoa-js `@stoachain/ouronet-core`):** the INFO + pact + read builders (§7) — publish + bump the
pin here.
**Ship:** bump `@ancientpantheon/codex-ouronet` (from 0.5.7), run the repo's build/typecheck/test workspace
suite, then the normal Codex publish/cross-pollinate. **Reinsertion into OuronetUI is a LATER step** — the
owner has explicitly deferred it ("leave OuronetUI as-is for now; the new Codex gets reinserted later").
