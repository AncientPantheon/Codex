# Arweave Upload Wizard — Design

Sibling topic to `arweave-upload-library` (native bundle, categories,
encryption — all built and verified). Consumes all three: real encrypted
mode, mandatory categories, native multi-file bundling. This topic replaces
the Upload category's current flat, unstyled form with a real guided flow.

## Problem

Today's `UploadArea.tsx` is a single flat form — every control (file input,
folder input, category select, asset-type select, app-id/version fields,
metadata attachment, tag preview, upload button) rendered at once with no
visual hierarchy and none of the rest of Codex's design system
(`CodexModalShell`, the card/button styling every other panel area already
uses). There's also no cost-before-you-commit step — a user can't see how
much an upload will actually cost, or its total size, before signing.
Account selection isn't even part of this UI at all today — it's inherited
silently from whatever the panel happens to have active.

## Approach

**Entry point, not always-visible content.** The Upload category's content
becomes two buttons: "Start Upload" (this wizard) and "Back Up Codex to
Arweave" (a link out to the separate Codex Upload wizard, which primarily
lives on the new Codex ID page — a later topic; this topic only needs the
link to exist, not build that destination). Clicking "Start Upload" opens
this wizard inside `CodexModalShell` (`@ancientpantheon/codex-ouronet/ui`,
already the established modal chrome this package already reuses elsewhere,
e.g. `PureKeysArea.tsx`) — a real popup with the actual Codex look, not a
bare form embedded in the tab.

**Five steps, linear but always revisitable.** A single internal step index
plus one "draft" object holding every selection so far — Back never
discards a prior choice, only changes which step is shown.

1. **Account** — pick which Arweave account pays for and owns this upload.
   A list of this codex's own Arweave accounts (reuse whatever seam already
   enumerates them for `ArweaveAccountsArea`/`ArweaveSeedsArea` — do not
   build a second address-listing mechanism).
2. **Mode** — Public or Encrypted. Choosing Encrypted reveals a second
   picker, in the SAME step: which Ouronet account encrypts (default:
   Prime; any other Ouronet account in the codex selectable instead) —
   this is a sub-choice of step 2, not its own step.
3. **Files** — the existing file / multiple-files / folder pickers,
   unchanged in behavior, restyled.
4. **Category** — the existing mandatory category picker, conditional NFT
   asset-type picker, optional app-id/version fields, and (when category is
   `nft-data`) the optional metadata-attachment input and its disclaimer —
   all existing logic from `UploadArea.tsx`, moved into this step
   unchanged, restyled.
5. **Review & Cost** — a summary of every choice made so far (account,
   mode/encryptor, file count, total byte size, category), a REAL live AR
   cost estimate (`estimateFee`, already exported from `arweave-core` —
   never a guess or a placeholder number), and the existing tag preview.
   This step also folds in the existing mandatory permanence warning — this
   IS the "are you sure, there's no turning back" moment, not a second,
   separate confirm popup layered on top of it. A single "Confirm & Upload"
   button here is what actually triggers the upload.

**Execute** reuses `uploadAndTrack`/`uploadFilesAndTrack` exactly as they
exist today (no new upload logic) — in progress/success/error states,
already built, just restyled to match the wizard's chrome.

**No new business logic beyond the cost estimate.** Every piece of
validation, tagging, encryption-selection, and upload composition already
exists (built across the three prior topics) — this topic is a real UI
rewrite around existing, already-tested logic, plus one genuinely new
wiring: a live price quote.

## Acceptance criteria

- [ ] The Upload category shows two buttons (Start Upload; a link out to
      the Codex Upload wizard) instead of an always-visible flat form.
- [ ] "Start Upload" opens a `CodexModalShell`-based wizard with the 5 steps
      above, in order; Back always returns to the previous step with every
      prior selection intact, never reset.
- [ ] Step 2 reveals the Ouronet-account-to-encrypt picker only when
      "Encrypted" is chosen, defaulting to the Prime account.
- [ ] Step 5 shows a real, live AR cost estimate for the exact selected
      files (not a placeholder, not a static guess) and the total byte
      size, before any signing occurs.
- [ ] Every existing category/encryption/NFT-metadata behavior from
      `UploadArea.tsx` still works identically inside the new step
      structure — this is a UI restructuring, not a behavior change.
- [ ] The wizard uses `CodexModalShell` and this package's existing
      button/card styling conventions — no bare native `<select>`/`<input>`
      dumped with no visual treatment.
- [ ] The full existing test suites for `codex-arweave` still pass;
      typecheck stays clean.

## Addendum — owner correction pass (post-build, before first real-world test)

The first built version got the mechanics right but not the UX or the step
order. This addendum is the owner's own detailed correction, captured in
full so nothing gets lost. Urgent driver: the owner needs a working
multi-image NFT folder upload through this wizard NOW, to use immediately
afterward in a Pact set-definition transaction — everything here is
prioritized toward that working end to end.

**1. Account step shows live AR balance.** Each account row displays its
current AR balance (via the existing `getBalance` seam), not just
address/label.

**2. Real button styling, not bare HTML buttons.** Next/Prev/every other
control must match this package's own established visual language — the
gold `ACCENT` (`#ceac5f`) pill/row styling already used throughout
`ArweaveAccountsArea.tsx`/`PureKeysArea.tsx` (accent-tinted background +
border when selected/active), not default browser button chrome.

**3. Step order changes — Category+Mode merge into one step, right after
Account.** New order: **Account → Category+Mode (combined) → Files →
Review & Cost.** On the Category+Mode step: picking a category drives a
*recommended* (not forced) default for Public vs. Encrypted — e.g.
`nft-data` recommends Public by default, since Ouronet's own NFTs store
their metadata on StoaChain and don't need Arweave-side privacy. If
Encrypted is chosen (by recommendation or override), the Ouronet-account
encryptor sub-picker appears in this SAME step, exactly as before.

**NFT default behavior, stated explicitly:** for `nft-data`, the default
assumption is a plain Ouronet NFT — just an image, no metadata file needed
at all (metadata lives on StoaChain). All variants stay available: a single
image alone; a single image plus an optional metadata file (existing,
already built); or, for multiple NFTs in one action, a **folder** of
images — each becomes its own individually-linkable asset.

**4. The file chooser is rebuilt.** Two explicit modes:
- **Individual files** — an "Add File" button, repeatable, each click adds
  one file to a running list, capped at **10 files**. Attempting to exceed
  10 shows a clear message directing the user to use folder mode instead
  (never silently truncates, never silently refuses with no explanation).
- **Folder** — an "Add Folder" button. **Multiple folder adds in one
  upload action should work** — each additional folder pick appends its
  files to the running selection, with that folder's own name prefixed
  onto its files' relative paths so two different folders' files can never
  collide on path (e.g. `folder-a/img1.png`, `folder-b/img1.png` stay
  distinct). No file-count cap for folder mode.
- Every added file shows its own size; a running total size sits above the
  whole list, updating as files are added/removed.
- Files (and whole folders) can be removed individually after being added.

**5. Review & Cost step, expanded.** Must show, all together, before the
user can commit:
- The chosen account's address and its live AR balance.
- Total upload size and the real cost estimate (already built).
- **Estimated remaining balance after the upload** (balance − cost).
- The full tag/versioning set this upload will carry (already built as a
  preview) — with explicit reassurance in the UI copy that tags are
  transaction *metadata*, entirely separate from the payload bytes, so
  attaching them can never corrupt or alter the uploaded file itself.
- Plain-language explanation of what's about to happen: this posts as one
  transaction (or one bundle transaction for multiple files) — not a
  multi-step build process the user needs to babysit; it appears in the
  Library immediately as "pending" (the existing local-cache behavior);
  Arweave's own block time is roughly two minutes, so full on-chain
  confirmation takes a little while after that.
- **Link preview — scoped honestly, not overpromised.** Arweave data-item
  ids ARE deterministic once signed (signing is a local, offline, free
  operation) — in principle the exact final links could be shown before
  posting. But today's upload composition (`uploadBundle`/`uploadData`)
  signs and posts as one atomic step; splitting "sign for preview" from
  "post on confirm" is a real pipeline change, not a UI tweak. **This pass
  ships without a true pre-upload link preview** — the summary instead
  shows the URL *pattern* (`https://<gateway>/<id>`) and explains exact
  links appear once the upload completes. A real pre-signed preview is a
  reasonable follow-up, not blocking this pass.

**6. Password handling at commit.** Clicking "Confirm & Upload" must gate
on `ensureCodexUnlocked()` (the same established pattern already used
throughout `codex-ouronet`'s own modals, e.g. `RotatePaymentKeyModal.tsx`,
`StakeUrStoaModal.tsx` — prompts for the password if the codex is locked,
resolves `false` on cancel) **before** attempting to sign anything — never
let a locked codex surface as a raw error at submit time.

## Addendum 2 — second owner correction round (live-tested, with screenshots)

The owner tested the built wizard live and sent screenshots. Found and
fixed immediately (trivial, certain): the tag preview rendered
`name`+`value` with no separator at all (e.g. literally
`App-NameAncientPantheon-Codex`) — fixed to `name: value` with real
styling. Everything else below still needs building.

1. **Native controls still leaked through.** The category `<select>` and
   asset-type `<select>` in the Category+Mode step, and the native "Choose
   file" button for metadata attachment, were never restyled — only the
   custom-built Public/Encrypted toggle was. Every remaining native
   form control in this component needs the same `ACCENT` pill treatment.

2. **Remove App-Id/App-Version as a blanket always-shown field.** Not
   something a user uploading an NFT image needs to type. Show them only
   for categories where app-version-lineage actually applies conceptually
   — `software-code` and `website-dapp-hosting` — hidden for everything
   else, `nft-data` included.

3. **Remove the dedicated "Attach metadata" special input entirely.**
   There's no need for a toggle or an upfront "does this have metadata"
   declaration — if the user wants an NFT to have metadata, they just add
   a second file in the normal Files step (already supports up to 10
   files); it gets bundled and gets its own separate link automatically,
   exactly like any other multi-file upload. Delete the special
   metadata-specific input/disclaimer from the Category+Mode step; the
   existing generic Files step already covers this with no new concept
   needed.

4. **Target chain for NFTs, for now: Ouronet only.** No chain selector
   needed (only one option exists) — just the existing 7-way asset-type
   picker, unchanged. A small clarifying label near it (e.g. "Ouronet
   Collectables — SFTs & NFTs") is a nice touch but not required. Other
   chains (which would bring real metadata-format validation) are future
   work, not this pass.

5. **Public/Encrypted get explicit "(Recommended)"/"(Not recommended)"
   labels for `nft-data`** — not just a silent pre-selection. Choosing
   Encrypted for `nft-data` specifically shows an explicit warning: the
   content won't be viewable anywhere that expects a public image/asset
   URL without first decrypting it through this codex.

6. **Extension-mismatch warning, generically across all 7 asset types.**
   When an asset-type is selected (`image`/`audio`/`video`/`document`/
   `archive`/`model`/`exotic`) and an added file's extension doesn't match
   a reasonable recognized set for that type, show a non-blocking warning
   ("this doesn't look like a typical `<type>` file — proceed anyway?")
   — never a hard block, the user can still proceed.

## Out of scope

- The Codex Upload (backup) wizard itself and the new Codex ID page it
  primarily lives on — separate, later topics.
- `arweave-seed-restore` sub-topic 2 and `legacy-prime-migration` — separate,
  later topics.
- Any new upload-pipeline behavior beyond the live cost estimate — every
  other piece of logic already exists and is reused as-is.
