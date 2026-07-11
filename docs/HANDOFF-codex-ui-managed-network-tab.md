# HANDOFF — Codex UI: managed (consumer) Network tab — read-only Pythia + consumer-key display, editable local nodes

**Target packages:** `@ancientpantheon/codex-ui` (`PythiaConnectorCard`,
`NetworkSettingsCard`) and `@ancientpantheon/codex-ouronet`
(`CodexSettingsSection` → `CodexNetworkTabConfig`).
**Requested by:** the Mnemosyne consumer integration (a Daimon/Automaton hosting the
Codex). **Date:** 2026-07-11. **Status:** design specified here; implementation
pending in the Codex repo.

**Read first:** `CONSUMER-INTEGRATION.md` (the two-tier global⊕local model + the
`locked` semantics this doc implements correctly) and
`DUAL-APOLLO-CONSUMER-IDENTITY.md` (what the consumer key **C** is).

---

## 1. Why (the consumer requirement)

A **managed consumer** (Mnemosyne — but this is generic to any multi-user consumer,
incl. OuronetUI) mounts the Codex for regular end-users. Its Network tab must show:

1. **Pythia connector = read-only status the user cannot set.** The user only *sees*
   whether the consumer has wired in a Pythia connection, and — when wired — the
   **consumer's bound Apollo (C) public-key string** the connection proves ownership
   of (per `DUAL-APOLLO-CONSUMER-IDENTITY.md`). When not wired, it reads
   **"Not wired in yet."** Setting Pythia is the operator's job (behind the admin
   gate, `CONSUMER-INTEGRATION.md` §2.1), never the end-user's.
2. **Per-chain node fields the user CAN set (his local layer).** For chains the
   global/Pythia does **not** cover (Arweave today; StoaChain when no global is set),
   the user may enter **his own** node/gateway URL — persisted to his browser only.

This is exactly `CONSUMER-INTEGRATION.md` §1 (resolution rule), §2.4 ("read-only for
users; only the per-chain fields for chains the global doesn't cover are editable")
and §3.4. **The model is already blessed; the code and the key-display are the gap.**

## 2. Current state (why it can't be done from the consumer today)

### 2a. `NetworkSettingsCard` — `locked` kills ALL fields (contradicts the spec)
`codex-ui/src/ui/settings/NetworkSettingsCard.tsx`:
```
const readOnly = Boolean(locked) || model.locked;
...
const fieldEnabled = chain.manualFieldEnabled && !readOnly;   // ← locked overrides per-chain editability
```
So a managed consumer passing `locked=true` (to make Pythia read-only) also **freezes
every per-chain node field** — directly contradicting `CONSUMER-INTEGRATION.md`
§2.4/§3.4, which require the non-covered-chain fields to stay editable for regular
users. There is currently **no way** to get "Pythia read-only + local node fields
editable" at once.

### 2b. `PythiaConnectorCard` — shows a URL, never a key
`codex-ui/src/ui/settings/PythiaConnectorCard.tsx` props today:
```
{ url, onSetUrl, coveredChains, locked?, className? }
```
It renders an (editable-unless-`locked`) URL input + a status dot
(Live / Set-no-coverage / Not-connected). It has **no concept of a consumer key** and
**no read-only "managed" mode** (locked only makes the input read-only; it still
renders a URL field, not a key/identity display).

### 2c. `CodexSettingsSection` — one shared `locked` for both cards
`codex-ouronet/src/ui/settings/CodexSettingsSection.tsx`, `CodexNetworkTabConfig`:
```
{ model, urls, onSetChainUrl, pythiaUrl, onSetPythiaUrl, locked? }
```
and it passes the **same** `locked={network.locked}` to BOTH `PythiaConnectorCard`
and `NetworkSettingsCard`. So the two cards cannot be locked independently.

## 3. The change

Keep the standalone/playground behavior 100% backward-compatible (it passes no new
fields → current behavior). Add a **managed** path.

### 3a. `PythiaConnectorCard` — add a managed (read-only + key) mode
Extend props:
```
managed?: boolean;        // read-only consumer view: NO url input at all
consumerKey?: string;     // the bound consumer Apollo (C) public string, e.g. "₱.…" / "Π.…"
```
Behavior when `managed` is true:
- **Do not render the editable URL input.** Render a read-only status block instead.
- Status text:
  - `consumerKey` present **and** covering ≥1 chain → **"Wired in via Pythia"** + the
    covered chains + the **consumer key** shown truncated + copy-to-clipboard (reuse
    the codex-ui copy affordance / `ObservationalCodexIdDisplay` styling for the key).
  - `consumerKey` present but no coverage advertised → **"Wired in — no coverage yet"**
    + the key.
  - no `consumerKey` (and/or no url) → **"Not wired in yet"** (grey dot), no key.
- `managed` implies read-only regardless of `locked`; ignore `onSetUrl` in this mode.
- When `managed` is false → **unchanged** (today's editable-URL card).

### 3b. `NetworkSettingsCard` — decouple the per-chain field lock
The per-chain **LOCAL** node field editability must follow `chain.manualFieldEnabled`
**even for a managed/read-only consumer** — that is the whole point of the local layer.
Introduce an explicit, narrow lock for the local fields instead of the broad `locked`:
```
lockLocalFields?: boolean;   // default false. When false, per-chain LOCAL fields
                             // follow chain.manualFieldEnabled (editable for
                             // not-globally-covered chains) regardless of the
                             // Pythia/global read-only state.
```
Change the field-enable logic to:
```
const fieldEnabled = chain.manualFieldEnabled && !lockLocalFields && !model.locked;
```
i.e. the per-chain field is editable when the chain is not globally covered AND the
consumer hasn't explicitly frozen local editing. The old blanket `locked` prop should
either be removed in favor of `lockLocalFields`, or retained as a deprecated alias
that maps to `lockLocalFields` (pick one; note it in the changelog). **Do not** let the
Pythia/global read-only state freeze the local fields.

### 3c. `CodexSettingsSection` — extend `CodexNetworkTabConfig`, wire independently
Extend the config the consumer passes:
```
pythia?: {
  managed?: boolean;       // read-only consumer view (default false = editable, playground)
  consumerKey?: string;    // bound consumer Apollo C public string (undefined = not wired)
  url?: string;            // still used in non-managed mode
  onSetUrl?: (url: string) => void;  // non-managed only
};
lockLocalFields?: boolean; // forwarded to NetworkSettingsCard (default false)
```
(Keep the existing flat `pythiaUrl`/`onSetPythiaUrl`/`locked` working as a
deprecated alias so the playground and any current consumer don't break.) Then:
- pass `managed`/`consumerKey` (+ `url`/`onSetUrl` in non-managed) to `PythiaConnectorCard`;
- pass `lockLocalFields` (NOT a blanket `locked`) to `NetworkSettingsCard`.

## 4. Behavior matrix (acceptance)

| Consumer | Pythia card | Per-chain node fields |
|---|---|---|
| **Managed, wired** (Mnemosyne, Pythia set + C key present) | read-only "Wired in via Pythia" + shows consumer key `₱.…` | editable for chains Pythia doesn't cover (e.g. Arweave); StoaChain shows "Live via Pythia", field disabled |
| **Managed, not wired** (Mnemosyne today — no operator Pythia, no C key yet) | read-only **"Not wired in yet"**, no key | StoaChain + Arweave editable (user's local nodes) |
| **Standalone** (codex-playground, `managed` absent) | **unchanged** — editable Pythia URL | unchanged |

## 5. Acceptance criteria
- [ ] A managed consumer can render: read-only Pythia connector (with or without a
      consumer key) **AND** editable per-chain LOCAL fields for not-globally-covered
      chains, simultaneously. (This is impossible today.)
- [ ] `PythiaConnectorCard` in `managed` mode shows no URL input; shows the consumer
      Apollo key (truncated + copyable) when provided, "Not wired in yet" otherwise.
- [ ] The playground (`apps/codex-playground`) is byte-for-byte unaffected (still
      editable Pythia + nodes) — verify its Network tab still works.
- [ ] Backward-compat: existing `pythiaUrl`/`onSetPythiaUrl`/`locked` consumers keep
      working (deprecated alias path).
- [ ] `codex-ui` + `codex-ouronet` rebuild green; `dist` updated (Mnemosyne consumes
      via `file:` link, so a rebuild flows the change in with no import changes).

## 6. Notes for the consumer (Mnemosyne) side — NOT this handoff's work
- Mnemosyne passes `pythia.managed = true`. `pythia.consumerKey` = its bound consumer
  Apollo **C** public key (from its own sealed identity-codex — Mnemosyne Phase 4;
  `undefined` until then → "Not wired in yet"). The operator Pythia URL is set behind
  Mnemosyne's admin gate (Mnemosyne Phase 3) and injected as the Codex `global`.
- Mnemosyne leaves `lockLocalFields` false so users can wire their own StoaChain node
  now (Arweave later).

## 7. Cross-reference / doc gap to fix
`CONSUMER-INTEGRATION.md` §2.4/§3.4 describe the read-only-Pythia + editable-local-fields
behavior but (a) the shipped `NetworkSettingsCard` code does not implement it (see §2a),
and (b) neither it nor any doc specs the **consumer-key display** in the connector.
When this lands, add a line to `CONSUMER-INTEGRATION.md` §2.4 noting the managed Pythia
card shows the bound consumer key, and that `lockLocalFields` (not a blanket `locked`)
governs local editability.

## 8. Open questions (confirm with owner)
- Exact glyph/prefix + truncation format for the consumer-key display (`₱.…N.…Π.…`?
  full CodexID vs just C?). Mnemosyne calls it the "consumer Smart Apollo string" —
  confirm whether the card shows C alone or the S↔C pair.
- Whether to hard-remove the old `locked` prop or keep it as a deprecated alias.
