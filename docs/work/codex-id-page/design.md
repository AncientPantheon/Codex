# Codex ID Page — Project Design

## Problem

Today, nothing in the real app surfaces the things a user needs in one
place to understand and act on their codex's permaweb posture: whether
their codex is eligible for seed-words-only restore (built,
`codex-seed-restore-activation`, but only shown deep inside the Arweave
panel's Library tab), a path to fix it when not eligible (the
`legacy-prime-migration` wizard — designed in full, not yet built), and a
genuinely safe way to back up the *whole running codex* itself to Arweave
(the encryption engine for this — `codex-backup-envelope-encryption` — is
being built in parallel, not yet complete).

## Sequencing (owner decision, 2026-10-08 — supersedes this doc's earlier
draft, which had the order reversed)

**Build the page first, the engines after**, in three stages:

1. **This topic (`codex-id-page`)** — the actual page: status display
   (eligibility, reusing the already-built detector), the informatics
   tab/section (written now, describing the full target architecture —
   dual restore paths, PIN, the backup mechanism — even though parts of
   it aren't live yet), and entry points for "back up this codex" and
   "make this codex eligible" that are honestly disabled/"coming soon"
   (mirroring `ArweavePanel.tsx`'s own existing disabled-button
   convention, e.g. its current "Back Up Codex to Arweave (coming soon)"
   button) until their respective engines land. **No fake/dead buttons
   without honest state** — an owner-stated standing preference from
   earlier in this project ("no more era-90 webpage buttons"): every
   affordance either works or visibly, honestly says it doesn't yet.
2. **`codex-backup-envelope-encryption`** (in progress, separate plan) —
   the dual-DEK envelope engine, now INCLUDING the Arweave-PIN wrap path
   in this same round (moved in from the design's own "out of scope v2"
   section — owner decision, same date). Once complete, this page's
   "back up this codex" action goes live.
3. **`legacy-prime-migration`** (design complete, 0 of 3 sub-topics
   built) — the fund-sweep migration wizard. The fund-moving sub-topic
   (`stoachain-migration-sweep`) has a standing gate in its own design
   doc requiring explicit confirmation before being built, independent of
   this page's own build. Once complete, this page's "make eligible"
   button opens the real wizard instead of a "coming soon" state.

This page is therefore built to be genuinely useful and informative from
day one (status is real today; the explanatory content is accurate and
complete) while being honest about which actions aren't wired yet.

## What the page contains

A new, dedicated area (not buried in the Library tab) — exact navigation
placement decided at build time, grounded against how this app's other
top-level areas are already reached (mirror the existing pattern, don't
invent a new one):

1. **Eligibility status** — live today. Reuses
   `checkArweaveRestoreEligibility`/`ArweavePanelDeps.
   checkArweaveRestoreEligibility` (already built,
   `codex-seed-restore-activation`) to show, plainly: is this codex
   eligible for seed-words-only restore right now, and if not, why not
   (same underlying reason `ArweaveRestoreEligibilityStatus.tsx` already
   surfaces in the Library tab — this page gives it a proper, prominent
   home, not a second implementation).
2. **"Make this codex eligible" entry point** — when not eligible: a
   button opening the `legacy-prime-migration` wizard. Until that wizard
   exists, this button is disabled with honest "coming soon" messaging
   (mirror the existing `ArweavePanel.tsx` disabled-button convention
   exactly), NOT hidden entirely — the user should know the path exists
   and is coming, not wonder if it's been forgotten.
3. **"Back up this codex to Arweave" entry point** — the actual backup
   action. Until `codex-backup-envelope-encryption` lands, disabled with
   the same honest "coming soon" convention.
4. **The informatics section** — plain-language, written for the owner/
   end user (not internal type/function names), covering:
   - **What gets backed up and how.** The whole running codex (every
     keyring: Ouronet accounts, Arweave seeds, pure keypairs, foreign
     keys, watch list, UI settings) as one Arweave upload — distinct from
     backing up individual *files* uploaded through the regular Upload
     Wizard.
   - **The encryption**, in plain terms: every secret gets re-encrypted
     under a fresh, random, one-time key generated just for that backup;
     that key itself gets locked (wrapped) under your own real secrets,
     never stored anywhere in a recoverable form on its own; the whole
     backup is then sealed again as one single opaque blob, so nobody
     looking at the public, permanent Arweave record can tell how many
     accounts or seeds you have, let alone read any of them.
   - **The two ways in** (both work independently — losing access to one
     doesn't lock you out if you still have the other): your **Master
     Seed words**, and your **Codex Identity** (the "Standard Apollo"
     half specifically — not the combined identity, not the "Smart"
     half) saved on StoaChain. Either one alone unlocks the backup.
   - **The PIN** (once `codex-backup-envelope-encryption`'s PIN work
     lands): an OPTIONAL extra lock you can add to either of the two
     paths above — a 6-to-15-digit number only you know. Explicit,
     plain-language warning: a PIN is exactly as unrecoverable as the
     seed words themselves if forgotten — there is no "forgot PIN" reset,
     ever. Never presented as default-on or recommended-by-default; it's
     an opt-in tradeoff the user makes with full awareness.
   - **What migration does and why you might need it** — see below.
5. **Migration-process informatics** (written now, from the already-
   complete `legacy-prime-migration` design, even though the wizard
   itself isn't built yet): explains, plainly, why some codexes aren't
   eligible yet (their Ouronet identity and their Arweave recovery seed
   don't share the same origin words — most often because the codex was
   originally set up with a wallet-imported phrase rather than Codex's
   own word generation), the three choices migration will offer (write
   brand-new words / promote an existing already-custom-worded account if
   one exists / keep current words and just re-derive properly), and that
   migration **moves real on-chain balances** (native STOA and urSTOA)
   from old keys to new ones as a necessary, explicit, multi-step part of
   the process — never described as instant or a single click, and always
   requiring explicit confirmation at each fund-moving step once built.

## Acceptance criteria

- [ ] A real codex's eligibility status renders correctly and matches
      `checkArweaveRestoreEligibility`'s real result (both eligible and
      not-eligible cases).
- [ ] The "make eligible" and "back up this codex" actions are present,
      visibly and honestly disabled with clear "coming soon" messaging,
      never silently missing and never a dead, unexplained button.
- [ ] The informatics content is accurate against the real, complete
      design docs it describes (`codex-backup-envelope-encryption`,
      `legacy-prime-migration`) — reviewed for correctness against those
      documents, not freehand-written.
- [ ] Once `codex-backup-envelope-encryption` ships, this page's backup
      action is wired to it with no further page-level redesign needed
      (the disabled-state scaffolding becomes the real action in place).
- [ ] Once `legacy-prime-migration` ships, this page's migration entry
      point opens the real wizard with no further page-level redesign
      needed.

## Out of scope

- The actual encryption engine (`codex-backup-envelope-encryption`,
  separate, parallel plan) and the actual migration wizard
  (`legacy-prime-migration`, not yet planned) — this topic builds the
  page and its honest scaffolding for both, not the engines themselves.
