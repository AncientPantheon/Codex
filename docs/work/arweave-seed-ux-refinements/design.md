# Arweave Seed UX Refinements — Design

Fourth refinement round on the Arweave Seeds surface (`packages/codex-arweave/src/panel/ArweaveSeedsArea.tsx`), requested directly against the running build. Four asks, grounded against current code and the Chainweb reference (`packages/codex-ouronet/src/ui/tabs/SeedWordsTab.tsx`).

## Problem / Approach, per ask

**A — leaving the page mid-generation.** Grounded: `ArweaveSeedsArea` has no `useEffect` unmount cleanup at all. A running `Worker` + `runSeededBatch` promise is a plain JS async chain, independent of the React tree — unmounting `ArweaveSeedsArea` (category switch) or the whole `ArweavePanel` (chain-rail switch) does **not** stop it; `persistKey` keeps landing keys in the real store (its side effects are host-level, not component-state). What's lost is the visible progress bar and the ability to cancel — the run becomes invisible and uncancelable, though its output is safe. Fix: `ArweaveSeedsArea` reports its live run (and a cancel closure) up via a new optional prop; `ArweavePanel` uses that to intercept a category-tab click while a run is active with a confirm dialog ("Stop generation now" / "Continue in background"), and registers a `beforeunload` listener for tab close/refresh. Guarding the Class-2 chain-rail switch itself is out of scope — that control lives in codex-ui/the host app, outside this package.

**B — gold Prime + separator**, ported from `SeedWordsTab.tsx`'s exact pattern: prime row gets `border: #ceac5f40`, label color `#ceac5f`, a lock glyph in place of the chevron, a `🔒 Prime` badge; a `PrimeSeparator` ("Other Seeds") renders once, immediately after the prime row, only when more than one seed exists. Arweave's prime stays toggleable and dev-deletable (unchanged) — only the visual language is ported, not Chainweb's permanence.

**C — Seed-Based / Direct toggle, buttons only.** A segmented toggle in the define form's upper-right, defaulting to "Seed-Based Deterministic RSA Generation" (today's three sources: words/account/chainweb, unchanged). Switching to "Direct Deterministic RSA Generation" shows a visible placeholder (four labelled but disabled/stub tiles: BitString, Bitmap, Base-10, Base-49) — the full Direct generator (reusing the spawn-modal validators) is `deterministic-rsa-modes`, a separate, already-designed topic; this round only adds the switch and an honest "not wired yet" body, per the user's explicit "buttons only for now."

**D — Quick vs Custom Define.** Today's single "Define Prime Arweave Seed" button, shown only while `existingKeys.length === 0` (i.e., no Arweave account anywhere in the codex yet — the correct proxy for "hasn't onboarded"), becomes two buttons:
- **Quick Define** — reuses the existing Option-2 code path (`dalosAccounts.find(a => a.isDefault)`, `revealAccountSecret`, `bitStringOf`, `resolveSeedBitString`) against the CodexPrime account specifically, skips the form entirely, defines the seed, and immediately runs a position-0-only generate — one click, no dialog. Disabled (with a tooltip) when there is no default/CodexPrime account or the required seams (`revealAccountSecret`, `workerFactory`, `persistKey`) are absent, mirroring the existing disabled-option styling.
- **Custom Define Arweave Seed** — the renamed existing button, opens the full `DefineSeedForm` (which now carries the C toggle).

Once any Arweave account exists (`existingKeys.length > 0`), Quick Define disappears — the row is gone entirely at that point anyway (a real seed is defined), so this is naturally the same gate as today's `primeSeed === undefined` check plus the account count.

`startRun` gains an optional explicit-selection parameter so Quick Define can request `{kind:"default"}` (position 0 only — confirmed in `planIndexRanges.ts`) directly, rather than depending on the component's `mode` state, which would be a stale-closure hazard if set and read in the same handler.

## Acceptance criteria

- [ ] Switching category tabs away from Seeds while a run's `status === "running"` shows a confirm dialog with "Stop generation now" and "Continue in background"; "Stop" aborts the run (same effect as the existing Cancel button) before switching, "Continue" switches without stopping it.
- [ ] A native `beforeunload` prompt appears when closing/refreshing the tab while a run is active.
- [ ] The Prime Arweave Seed row renders with a gold (`#ceac5f`) border and label, a lock glyph, and a "🔒 Prime" badge; a labelled separator renders between it and the rest of the list, only when more than one seed exists.
- [ ] The define form shows a Seed-Based / Direct toggle in its upper-right; Direct shows a visible, non-throwing placeholder body naming the four input kinds; Seed-Based is unchanged and remains the default.
- [ ] With zero Arweave accounts in the codex, the entry point shows both "Quick Define" and "Custom Define Arweave Seed"; with one or more, only Custom's entry point exists (Quick's button is gone).
- [ ] Quick Define, with a CodexPrime account and all seams present, defines the Prime seed and generates exactly position 0 in one action, with no intermediate form.

## Out of scope

- The full Direct Deterministic RSA Generator (bitstring/bitmap/base10/base49 validators, curve selector) — tracked separately as `deterministic-rsa-modes`.
- Guarding the Class-2 chain-rail switch — owned by codex-ui/the host, not this package.
- Any change to Arweave prime-seed deletability (still dev-deletable, per existing decision).
