# Pure Keys refinements — design

Follow-up to the Pure Keys category build. Four requests from live testing.

## 1. Same RSA details as deterministic keys

`ArweaveSeedsArea.tsx`'s `ArweaveKeyRow` already has the exact UI wanted: an
"RSA parameters" disclosure toggle, the 8-field `LabField` table (n/e/p/q/d/dp/
dq/qi) with per-field reveal + a panel-wide reveal, and the three download
buttons (keyfile/priv/pub). Everything except the address header line and the
outer row chrome is already self-contained state (`open`/`revealAll`/
`revealedRows`/`decrypted`/`decrypting`/`panelError`/`decimals`/`download`).

**Decision:** extract that self-contained part into a new exported
`RsaParamsSection` component inside `ArweaveSeedsArea.tsx`:

```ts
export interface RsaParamsSectionProps {
  /** Namespaces every test id inside the section. */
  prefix: string;
  /** Any stable per-row identifier — a seed's numeric position for
   *  `ArweaveKeyRow`, or a pure key's `entry.id` (its address) for the new
   *  caller. Only ever interpolated into test ids / display strings. */
  index: string | number;
  /** Present for a key produced this session — already in memory. */
  jwk?: ArweaveJwk;
  /** Decrypts a STORED key on demand, when the panel is opened. */
  loadJwk?: () => Promise<ArweaveJwk>;
}
```

`ArweaveKeyRow` keeps its address `LabField` line and renders
`<RsaParamsSection prefix={prefix} index={index} jwk={providedJwk}
loadJwk={loadJwk} />` right after it — a pure extraction, zero behavior change
for every existing `e5-seeds-area.test.tsx` assertion (same test ids, same
`prefix`/`index` interpolation).

`PureKeysArea.tsx`'s `PureKeyRow` imports `RsaParamsSection` via a relative
import (`./ArweaveSeedsArea.js`, same directory — no package-barrel change
needed) and mounts it below its own header line, passing
`loadJwk={() => decryptArweaveKey(entry)}` (same on-demand-decrypt discipline
the seed rows already use — the plaintext JWK is never eagerly decrypted just
because a row exists).

## 2. Distinct default names

Every "Create Random Key" / "Import Keyfile" call currently lands with no
`label`, so every row shows the same fallback ("Untitled key"). Neither
`generateArweaveKey`/`importArweaveKey` can pick a name (they run before the
resulting address exists in the random-generate case is available; in the
import case there's no natural human name at all).

**Decision:** `PureKeysArea` fills in a default label CLIENT-SIDE on the
entry it hands to `addForeignKey`, only when the returned entry has none:

- random generate → `` `Random Key ${last6(entry.address ?? entry.id)}` ``
- import → `` `Imported Key ${last6(entry.address ?? entry.id)}` ``

`last6` = the final 6 characters of the canonical address — always present
and unique per entry, so two keys never collide. This never overwrites a
label the seam itself supplied (defensive; today it never does).

## 3. Balance-aware delete guard

Today `getBalance: (address: string) => Promise<bigint>` already exists on
`ArweavePanelDeps` and already accepts an arbitrary address (`BalanceArea`
uses it for the connected address, but nothing about it is scoped to that
one address). Both `ArweaveAccountsArea` and `PureKeysArea` gain an
**optional** `getBalance` prop, threaded from `ArweavePanel.tsx`
(`deps?.getBalance`). Optional and additive: a caller that omits it gets
today's plain confirm-delete behavior, unchanged — no existing test breaks.

**Tiers** (per the user's own framing: recoverability, not key type, is
what decides the severity):

- **Unprotected** (funds at that address can never be recovered if the key
  is lost — nothing to fall back on): every `PureKeysArea` row (seedless, by
  definition), AND every `ArweaveAccountsArea` row whose owning seed has no
  recorded seed words — a Direct/bitstring-sourced seed, OR an "Unassigned"
  entry (unknown/legacy `seedId`), OR a seed whose `words` are absent because
  the session reloaded (conservative: unprovable recoverability is treated as
  none, never the other way round).
- **Protected** (a human can retype the seed words and regenerate the exact
  same key): an `ArweaveAccountsArea` row whose owning seed has
  `words !== undefined && words.length > 0`.

**Behavior on Delete click**, per row, when `getBalance` is wired:
1. Show a "Checking balance…" state (no confirm/cancel yet other than
   dismiss) while the read is in flight.
2. Balance `=== 0n`, or the read fails: fall back to the EXISTING plain
   confirm-then-delete panel (a network hiccup must never permanently block
   deleting an empty key — it only affects the funded-key gate).
3. Balance `> 0n`, tier Protected: show a stronger warning ("This address
   holds N AR — deleting it is possible but not reversible without the
   seed") with the SAME confirm-then-delete action as today, just with the
   sharper copy.
4. Balance `> 0n`, tier Unprotected: show a BLOCKING panel — no delete
   button at all, only "Cancel". Copy: "This address holds N AR and has no
   seed behind it — it can never be regenerated. Deletion is disabled to
   prevent irreversible fund loss."

`N AR` is `winstonToAr(balance)` (already exported by `@ancientpantheon/
arweave-core`, already used by `BalanceArea.tsx` for the identical format).

`ArweaveAccountsSeed` (the seed summary `ArweaveAccountsArea` groups by)
gains `hasWords?: boolean`; `ArweavePanel.tsx`'s `accountsSeeds` useMemo sets
it from `seed.words !== undefined && seed.words.length > 0`. Missing/absent
`hasWords` (an older caller that never sets it) defaults to **Protected**
inside `ArweaveAccountsArea` — the conservative direction for a caller that
predates this feature (never silently downgrades something that used to
delete with a plain confirm into a hard block).

## 4. Progress affordance for random keygen

The seed-based `RunProgress` bar is driven by the SEEDED worker's rich
`batch-progress` events (position/attempts/percent from an actual prime
search) — there is no equivalent signal for a single WebCrypto
`generateKey()` call (the browser gives no progress callback for it at all,
and its duration is not the seeded path's ~6.7s/key average).

**Decision:** do not fabricate fake position/attempt numbers. Replace
`PureKeysArea`'s plain "Generating key…" text with a small self-contained
elapsed-time progress bar, visually matching `RunProgress`'s bar (same
height/radius/ACCENT fill/track color): starts at 0%, ramps toward a 92% cap
over ~4s of elapsed wall-clock time (ticking on a `setInterval`), holds at
92% for as long as generation is still running past that, and jumps to 100%
the instant `creating` turns false. Status line below it: "Generating a
random RSA-4096 key… this can take several seconds." (no specific ETA claim,
since real WebCrypto timing varies by machine). Test ids:
`arweave-pure-key-progress-bar` (`data-percent` attribute) and
`arweave-pure-key-progress-status`.

## 5. Generate/Save flow must match Chainweb's Pure Keypairs pattern

The user has asked for this multiple times: random-key creation on every
other chain (`packages/codex-ouronet/src/ui/tabs/PureKeypairsTab.tsx`'s
`GenerateSubtab`) is a two-STEP flow — Generate (repeatable, no
persistence), then a separate Save-with-a-name step — not one click that
generates AND persists atop an auto-assigned name. Today's
`PureKeysArea.handleCreate` (one click → `runKeygen` → `generateArweaveKey`
→ `addForeignKey`, all in one action) must be replaced to match that shape.

Reference flow (Chainweb, `GenerateSubtab`): `pair` state holds the freshly
minted, NOT-YET-PERSISTED key material. "Generate Keypair" (no key yet) /
"Generate Another" (one exists) both call the same generator and simply
overwrite `pair` — free, repeatable, no gate. Once `pair` exists, the key is
shown, plus a label `<input>` (optional, blank allowed) and a "Save to
Codex" button, which encrypts + persists using whatever `pair` currently
holds and whatever label is currently typed, then clears `pair`/`label` and
navigates back to the list.

**Arweave adaptation** (`PureKeysArea.tsx` has no persistent subtab strip
the way Chainweb's `PureKeypairsTab` does — "Create Random Key" is a button
that currently sits beside "Import Keyfile" above the list):

- Clicking "Create Random Key" opens an inline generate panel BELOW the
  button row (replacing the list temporarily — mirrors Chainweb switching
  its whole subtab away from List), in an EMPTY state: description text +
  a "Generate Random Key" button, no key yet. This is the literal two-click
  match to Chainweb's "switch to Generate subtab" (click 1) then "Generate
  Keypair" (click 2) — do not collapse these into one click.
- Clicking "Generate Random Key" runs `keygenRunner.runKeygen(...)` (showing
  `RandomKeygenProgress`, already built), then derives the address via
  `addressOf(jwk)` (a PURE, local, no-network, no-injection-needed function
  — import it directly from `@ancientpantheon/arweave-core`, exactly the
  same way this file already imports `winstonToAr` directly rather than
  through an injected seam) and stores `{ jwk, address }` in local
  `pendingKey` state. The plaintext JWK living in `pendingKey` until Save is
  the Arweave analogue of Chainweb's `pair.secretKey` — unavoidable (the key
  must exist in memory somewhere to be rerollable before encryption), but it
  must NEVER be handed to `generateArweaveKey`/`addForeignKey` more than
  once and must NEVER be logged.
- Once `pendingKey` is set, the button becomes "Generate Another" (same
  handler, discards the current `pendingKey` and generates a fresh one —
  free, repeatable, exactly like Chainweb). Below it: the derived address
  (plaintext, public data — fine to show unmasked, exactly like every other
  address in this panel), then `<RsaParamsSection prefix=
  "arweave-pure-key-generate" index={pendingKey.address} jwk={pendingKey.jwk}
  />` so the user can inspect the actual RSA parameters before committing —
  reusing the EXISTING reveal-gated component rather than Chainweb's
  immediate-plaintext display, since an RSA-4096 private key is
  substantially more sensitive than Chainweb's key and this whole project
  has an established, tested convention (`RsaParamsSection`'s own per-field
  reveal) for never printing raw private numbers unmasked without an
  explicit click. This is the one deliberate deviation from Chainweb's exact
  display behavior; the STRUCTURAL flow (generate → reroll freely → name →
  save as two separate actions) matches exactly.
- A label `<input>` (test id `arweave-pure-key-generate-label`), starts
  empty, placeholder `"e.g. Cold Arweave key…"` — blank is allowed while
  typing/generating, exactly like Chainweb.
- "Save to Codex" (test id `arweave-pure-key-generate-save`): calls
  `generateArweaveKey({ jwk: pendingKey.jwk, label: finalLabel })` then
  `addForeignKey(entry)`, where `finalLabel` is the trimmed label input, OR —
  UNLIKE Chainweb's bare `undefined` fallback — `` `Random Key
  ${last6(pendingKey.address)}` `` when left blank, preserving this
  project's own already-shipped "distinct default names" requirement (§2)
  as a safety net for a user who saves without typing anything. On success:
  clear `pendingKey`/label, close the generate panel, back to the list
  (mirrors `onSaved()` → subtab "list"). On failure: keep `pendingKey` and
  the typed label, show an error, let the user retry Save without
  regenerating (test id `arweave-pure-key-generate-save-error`).
- "Cancel" (test id `arweave-pure-key-generate-cancel`): discards
  `pendingKey`/label, closes the panel, back to the list, with NO save. Not
  present in Chainweb's tab-strip shape (there, navigating to another subtab
  IS the cancel) but a natural, harmless fit for Arweave's button-triggered
  panel shape.
- Generation failure (the `keygenRunner.runKeygen` step itself, not Save):
  reuse the existing `arweave-pure-key-create-error` test id/copy, shown
  inside the still-open panel; the panel stays open so the user can retry
  "Generate Random Key" again.
- Import Keyfile is UNCHANGED by this section (already a distinct, separate
  action from random-generate; not what the user is asking to rework here).

## 6. Same 3-tab structure as Chainweb: List / Generate / Import

Follow-up: the user wants the STRUCTURE, not just the generate mechanics, to
match `PureKeypairsTab.tsx` — a persistent 3-pill subtab bar (its own
`TABS = [{key:"list",label:"Keys"}, {key:"generate"}, {key:"import"}]`,
rendered as pill buttons, active one highlighted, body swapped by a `sub`
state), not today's "button row that opens an inline overlay panel" shape
built for T4.

**Decision:** restructure `PureKeysArea`'s top level around
`const [subTab, setSubTab] = useState<"list" | "generate" | "import">
("list")`, three pill buttons (test ids `arweave-pure-keys-subtab-list`,
`-generate`, `-import` — matches this file's/`ArweaveAccountsArea`'s own
`arweave-accounts-subtab-${key}` naming convention), each rendering ONE of:

- **`list`**: today's entries list (`PureKeyRow` per entry) / empty state,
  UNCHANGED — except the empty state's copy can additionally offer a
  "Generate Your First Key" button that does `setSubTab("generate")`
  (Chainweb's empty-state parity; optional nice-to-have, not required).
  Pill label: `` `Keys (${entries.length})` ``.
- **`generate`**: EXACTLY the panel built in §5/T4 (`pendingKey`/`label`/
  `creating`/`saving` state, "Generate Random Key" / "Generate Another",
  `RsaParamsSection`, Save/Cancel) — but now as the SUBTAB BODY, not an
  overlay toggled by a separate "Create Random Key" trigger button (that
  button goes away; entering the Generate pill IS the trigger, exactly like
  Chainweb has no separate "open" step beyond clicking the pill). Implement
  this as a genuinely separate child component that MOUNTS only while
  `subTab === "generate"` (conditional render, not `display:none`) so its
  `pendingKey`/`label` state is discarded by React on unmount the instant
  the user navigates away — this is exactly what `GenerateSubtab` gets for
  free from `{sub === "generate" && <GenerateSubtab .../>}`, and is
  actually the SAFER behavior here (no unsaved plaintext JWK lingering in a
  hidden component). "Cancel" and a successful "Save to Codex" both call
  `setSubTab("list")` (mirrors `onSaved()`).
- **`import`**: today's import flow (hidden `<input type="file">` +
  invalid-JSON/rejected-import error states), relocated to be the subtab
  body — always visible once this pill is active, no more separate
  `importOpen` gate needed (the subtab itself now serves that role). Keep
  the FILE-UPLOAD mechanism exactly as today (do not switch to Chainweb's
  paste-two-hex-strings form — an Arweave JSON keyfile is a large blob, not
  two short hex strings; file upload is the right mechanism for this
  chain's key shape, already deliberately chosen over paste-into-textarea
  for secret hygiene per this file's module JSDoc). Pill label: `"Import"`.

Visual note: reuse THIS panel's existing single gold `ACCENT` and pill
shape/active-state styling (already established across `ArweaveAccountsArea`'s
Codex/Watched subtab pills) rather than copying Chainweb's per-tab distinct
colors (indigo/green/gold) — the ask is the STRUCTURE (3 persistent,
pill-navigated subtabs), not Chainweb's specific color scheme, and Arweave's
panel has its own consistent one-accent visual language throughout Seeds/
Accounts/Pure Keys already.
