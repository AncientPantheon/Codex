# Arweave Non-Removable Account Invariant — Design

Topic 1 of `docs/work/arweave-account-safety/design.md`. Builds on
`arweave-upload-encryption` (built — `library/flow.ts` already calls
`onAccountUsedForEncryption(accountId)` after a successful encrypted
upload, but nothing in the real app is wired to it yet) and
`arweave-tag-schema-spec` (built — `Codex-Encryptor`/`Codex-Encryption-Version`
are the tags the chain-query fallback searches for).

## Problem

An Ouronet account that has ever encrypted a confirmed Arweave upload must
never be deletable — doing so would orphan permanent on-chain ciphertext
forever. Today this is a dead letter: the trigger exists and fires, but
nothing stores the fact, nothing checks it, and `deleteOuroAccount` has no
guard beyond the existing Prime-account protection.

**Real, load-bearing scoping fact, confirmed by grep before designing
anything further:** no UI anywhere in this codebase currently calls
`deleteOuroAccount` at all — only `codex-ui`'s `useOuroAccounts` hook
exposes it, unused by any component. This topic is not retrofitting a
working delete flow; it's building the guard correctly so that whenever a
delete UI *does* get built, it's correct by construction rather than by
remembering to call the right thing.

## Approach

**Where the local flag lives.** A new optional field on `IOuroAccount`
(`codex-ouronet/src/types/entities.ts`), e.g.
`hasEncryptedArweaveUpload?: boolean` — additive, backward compatible,
following this exact field-addition discipline every tag/schema change in
this whole project has already used.

**Closing the dead-letter gap.** `ArweavePanelDeps` gains
`onAccountUsedForEncryption?: (accountId: string) => void` (mirrors
`getBalance`/`revealAccountSecret`'s existing injection shape exactly),
threaded from `ArweavePanel.tsx` into the `UploadWizard` mount, which
already receives `library/flow.ts`'s real callback-carrying functions. The
HOST APP (wherever it composes `ArweavePanelDeps`, same layer that already
bridges Prime-Arweave-seed-installation and codex-backup wiring in this
project) is responsible for pointing this at a real `codex-ouronet` store
action that flips the new field — `codex-arweave` itself never imports
`codex-ouronet`, preserving the isolation this whole project has
maintained throughout.

**`deleteOuroAccount`'s own guard is LOCAL-FLAG-ONLY — this is a hard
architectural boundary, not an oversight.** The store action lives in
`codex-ouronet`, which has and must keep zero dependency on
`codex-arweave`/network access. It cannot itself run the chain-query
fallback. So: `deleteOuroAccount` checks `hasEncryptedArweaveUpload` and
throws a new typed error (mirroring `CodexPrimeProtectedError`'s exact
shape) when true — fast, synchronous, offline, exactly the "primary gate"
the parent design calls for. The chain-query safety net is a SEPARATE,
exported, documented pre-flight function
(`checkAccountEncryptedArweaveUploads(pool, address): Promise<boolean>` in
`codex-arweave`) that a future delete-account UI is responsible for calling
*before* invoking `deleteOuroAccount` when the local flag is absent — this
boundary gets written down explicitly (in this topic's own doc-comments,
not left implicit) specifically because this project has twice now seen a
host app silently skip a sanctioned integration point it didn't know
existed (the OuronetUI incidents earlier this session). The override
setting only ever suppresses the CHAIN-QUERY step, never the local-flag
check — a known-true local flag blocks deletion unconditionally, no
override possible; the override exists only for the "can't verify, don't
want to be blocked by network" case.

**The chain-query fallback.** `checkAccountEncryptedArweaveUploads` queries
for any confirmed upload tagged `Codex-Encryptor: <address>` — note this
needs a NEW query capability: `queryOwnerUploads` filters by `owners`
(the uploading/paying account), not by an arbitrary tag value like
`Codex-Encryptor` — confirmed by reading `rebuild/query.ts`'s actual
GraphQL query shape. A tag-only (no owner filter) query is needed.

**The override setting.** A new field on `UiSettings`
(`codex-ouronet/src/types/entities.ts`), off by default, strongly worded
(mirrors the parent design's exact language: "allow deleting Ouronet
accounts without the Arweave safety check").

## Acceptance criteria

- [ ] A successful encrypted upload through the real wizard actually flips
      `hasEncryptedArweaveUpload` on the encrypting account — traced end to
      end from `library/flow.ts`'s existing callback through to a real
      `codex-ouronet` store mutation, not just type-compatible.
- [ ] `deleteOuroAccount` throws a new typed error (same shape as
      `CodexPrimeProtectedError`) when `hasEncryptedArweaveUpload` is true
      — synchronously, with zero network access attempted.
- [ ] A new, exported, documented `checkAccountEncryptedArweaveUploads`
      function correctly finds (or doesn't find) a confirmed encrypted
      upload for a given address via chain query, independent of whether
      the local flag is set.
- [ ] The override setting exists on `UiSettings`, defaults to off, and
      when off, an absent local flag with no confirmed way to check the
      chain still blocks deletion (fail-safe, never fail-open).
- [ ] The full existing test suites for `codex-ouronet`, `codex-arweave`,
      and `arweave-core` still pass; typecheck stays clean across all
      three.

## Out of scope

- Building an actual "delete this Ouronet account" UI/button — none
  exists today; this topic builds the guard correctly so a future one is
  correct by construction, it doesn't invent the UI itself.
- `codex-session-lifecycle` (Topic 2 of the parent project) — the
  save-reminder/`beforeunload`/`requestLogout` layer.
- Extending this same invariant to the separate Arweave "foreign keys"
  (pure-key RSA) system — already flagged as a related, explicitly
  out-of-scope sibling gap in the original project design.
