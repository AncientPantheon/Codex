## Wave 1

- [x] T1: Second correction round on `UploadWizard.tsx` — read
      `docs/work/arweave-upload-wizard/design.md`'s "Addendum 2" section in
      full first (the complete spec; item 1 there, the tag-preview
      separator bug, is ALREADY FIXED directly — confirm it, do not redo
      it). Read the current `packages/codex-arweave/src/panel/
      UploadWizard.tsx` in full before changing anything.

      1. Restyle EVERY remaining native form control — the category
         `<select>`, the asset-type `<select>`, and the native "Choose
         file" button for metadata attachment (if not already removed by
         item 3 below) — to the same `ACCENT` pill/row convention already
         applied to the Public/Encrypted toggle and every button. After
         this task, explicitly verify (grep your own diff) that zero bare
         `<select>` or default-chrome file-input buttons remain anywhere
         in this component, and say so in your report.
      2. Remove App-Id/App-Version as an always-shown field. Show the two
         inputs ONLY when the selected category is `software-code` or
         `website-dapp-hosting`; hidden (and therefore `undefined` in the
         draft, never an empty string) for every other category.
      3. Delete the dedicated "Attach metadata (optional)" file input and
         its disclaimer text from the Category+Mode step entirely. Do not
         replace it with anything — the existing Files step (Add File, up
         to 10) already covers "add a second file for metadata" with no
         special framing needed. Remove any now-dead code/types this
         deletion leaves behind (e.g. a separate `metadataFile` draft
         field, if the Files step doesn't already generalize to cover it —
         check whether Files step's existing multi-file list already
         subsumes this, and if so just delete the special-cased field).
      4. No new chain-selector — confirm the existing 7-way asset-type
         picker is unchanged. Add a small clarifying label near it when
         category is `nft-data`, e.g. "Ouronet Collectables — SFTs & NFTs"
         (exact wording your judgment).
      5. Add "(Recommended)"/"(Not recommended)" text next to
         Public/Encrypted specifically when category is `nft-data` (for
         every other category, no such label — just the existing
         recommended pre-selection with no extra text, unless you judge
         it's cleanly reusable for all categories, in which case say so
         and do it consistently). When `nft-data` + Encrypted is chosen,
         show an explicit warning: this content won't be viewable anywhere
         that expects a public asset URL without decrypting it through
         this codex first (exact wording your judgment, but the warning
         must be specific to this case, not the generic permanence
         warning).
      6. Add an extension-mismatch warning: when an asset-type is selected
         and an added file's extension doesn't match a reasonable
         recognized set for that type (pick sensible common extensions per
         type — e.g. image: png/jpg/jpeg/gif/webp/svg/bmp; your judgment
         for the other 6 types, document your chosen lists in a code
         comment), show a non-blocking inline warning per mismatched file
         ("this doesn't look like a typical `<type>` file — proceed
         anyway?") that does NOT prevent proceeding — it's advisory only,
         never a hard gate.

      Follow TDD: extend the failing tests first for every behavior above,
      confirm they fail, then implement, then refactor.

      Done when: every item above is covered by a passing test (no native
      `<select>`/default file-input-button remains — assert this via
      querying for the absence of a raw `<select>` element, not just
      visual inspection; App-Id/App-Version absent for `nft-data`, present
      for `software-code`; the metadata-specific input/disclaimer is gone
      entirely; the nft-data recommended/not-recommended labels and the
      encrypted-NFT warning render correctly; a mismatched-extension file
      under a chosen asset-type shows the warning but does NOT block
      proceeding). The full `codex-arweave` test suite passes (unscoped —
      check for and fix any gap outside this task's own file list, flagging
      explicitly if found, matching every prior task in this project).
      `npx tsc -b packages/codex-arweave --force` is clean.
  - files: `packages/codex-arweave/src/panel/UploadWizard.tsx`,
    `packages/codex-arweave/tests/e4-panel-upload-wizard.test.tsx`
