## Wave 1

- [x] T1: Add a one-shot account-keyed cipher helper — DONE. Built as an
      injected-`CryptoSeam` wrapper (not a direct `@stoachain/stoa-core`
      import — that package isn't and shouldn't be a `codex-arweave`
      dependency; mirrors `keyring/foreignKeys.ts`'s existing injection
      pattern instead). Signatures:
      `encryptWithAccountKey(plaintext, bitstring, seam: CryptoSeam)` /
      `decryptWithAccountKey(ciphertext, bitstring, seam: CryptoSeam)`.
      `encryptWithAccountKey(plaintext: string, bitstring: string):
      Promise<string>` / `decryptWithAccountKey(ciphertext: string,
      bitstring: string): Promise<string>` — thin wrappers over
      `encryptStringV2`/`smartDecrypt` (`@stoachain/stoa-core/crypto`; read
      `packages/codex-arweave/src/keyring/foreignKeys.ts` first for this
      package's existing crypto-import style). `bitstring` MUST be the raw
      1600-bit `"0"`/`"1"` string form — document this as the one canonical
      form, never validate/re-derive it (that's `resolveSeedBitString.ts`'s
      job upstream). This is for SINGLE, one-off string encryptions
      (small values — a password, a single short field) — NOT for file
      content, which needs T3's derive-once treatment for performance. If
      `docs/work/codex-recovery-backup-tagging/design.md`'s own T1 has
      already been built by the time this runs, this task becomes a no-op
      confirmation that it already exists with this exact signature —
      do not build a second, duplicate implementation. Follow TDD: write
      the failing round-trip test first, confirm it fails, then implement.

      Done when: encrypt-then-decrypt round-trips a plaintext string
      exactly with the same bitstring; decrypting with a DIFFERENT
      bitstring than the one used to encrypt throws (propagate the
      underlying wrong-key failure, never swallow it).
  - files: `packages/codex-arweave/src/crypto/accountKeyCipher.ts` (new,
    or confirm-only if already built), `packages/codex-arweave/tests/
    crypto-account-key-cipher.test.ts` (new, or confirm-only)

- [x] T2: Extend the tag schema with `Codex-Encrypted`/`Codex-Encryptor`,
      OPTIONAL at the `buildUploadTags` layer (mirroring exactly how
      `category`/`assetType` were added in the `arweave-upload-categories`
      plan — read `packages/arweave-core/src/upload/tags.ts` in full
      first, including its existing `category`/`assetType` two-way
      validation, and match that pattern precisely rather than inventing a
      new one). Add `TAG_CODEX_ENCRYPTED = "Codex-Encrypted"` and
      `TAG_CODEX_ENCRYPTOR = "Codex-Encryptor"` constants. Add two new
      optional `BuildUploadTagsParams` fields: `encrypted?: boolean` and
      `encryptorAddress?: string`. Validation (same
      `InvalidUploadParamsError` field/reason shape used throughout this
      file): `encryptorAddress`, when present, REQUIRES `encrypted ===
      true` (else throws, reason e.g. `"requires-encrypted-true"`), and
      `encrypted === true` REQUIRES `encryptorAddress` to be present and a
      valid canonical 43-char Arweave address (use `isCanonicalAddress`,
      already imported in this file) — the same two-way implication
      shape as `category`/`assetType`. When `encrypted` is provided (true
      or false) but `encryptorAddress` isn't required for the `false` case,
      no tag validation beyond the boolean itself. Emit `Codex-Encrypted`
      as the literal string `"true"`/`"false"` (never omitted once
      `encrypted` is explicitly provided — unlike `category`, this one IS
      always emitted when explicitly set, since "was this encrypted" should
      never be ambiguous/absent on a real upload; still omitted entirely
      when `encrypted` isn't provided at all, for backward compatibility
      with every existing caller). Emit `Codex-Encryptor` only when
      `encrypted === true`. Both new names join `RESERVED_NAMES`. Follow
      TDD: write the failing tests first, confirm they fail, then
      implement.

      Done when: `encrypted: true, encryptorAddress: "<43-char>"` emits
      both tags correctly; `encrypted: true` alone (no address) throws;
      `encryptorAddress` alone (no `encrypted: true`) throws; `encrypted:
      false` alone emits `Codex-Encrypted: "false"` and no
      `Codex-Encryptor` tag; omitting both fields entirely still returns
      exactly what `buildUploadTags` returned before this task (regression
      guard, mirroring the exact no-regression test style used for
      `category`).
  - files: `packages/arweave-core/src/upload/tags.ts`,
    `packages/arweave-core/tests/upload-tags.test.ts`

- [x] T3: Add a factored, derive-once symmetric cipher for multi-file
      encryption — separate from T1, because T1's underlying
      `encryptStringV2` re-runs its full 600k-iteration PBKDF2 derivation
      on every call, which would be real, avoidable per-file delay for a
      folder upload. New module exporting: `deriveAccountAesKey(bitstring:
      string): Promise<CryptoKey>` (PBKDF2-SHA512, 600,000 iterations,
      AES-256-GCM key usages `["encrypt","decrypt"]` — same algorithm
      parameters as `@stoachain/stoa-core/crypto`'s V2 cipher, confirmed by
      reading its actual source at
      `node_modules/@stoachain/stoa-core/dist/crypto/v2.js` before
      implementing — but this module does NOT need byte-compatibility
      with V2's on-wire envelope format, since nothing outside this
      feature ever needs to decrypt these uploads with the generic V2
      path; design its own minimal envelope), `encryptWithDerivedKey(key:
      CryptoKey, data: Uint8Array): Promise<{ ciphertext: Uint8Array; iv:
      Uint8Array }>` (fresh random 12-byte IV per call — reusing a key
      across many files is fine for AES-GCM as long as the IV is fresh
      each time, which `crypto.getRandomValues` guarantees with negligible
      collision probability at any realistic file count), and
      `decryptWithDerivedKey(key: CryptoKey, ciphertext: Uint8Array, iv:
      Uint8Array): Promise<Uint8Array>`. A salt must be derived
      deterministically and consistently from the bitstring itself (e.g. a
      fixed, documented salt derivation — since `deriveAccountAesKey`
      needs to reproduce the IDENTICAL key both when encrypting and later
      when decrypting, given only the bitstring, with no separately-stored
      salt) — document this choice explicitly and follow TDD: write the
      failing round-trip test first, confirm it fails, then implement.

      Done when: `deriveAccountAesKey` called twice with the SAME bitstring
      produces a key that successfully decrypts data encrypted under the
      first call's key (proving the salt derivation is deterministic, not
      randomly regenerated per call); a different bitstring's derived key
      fails to decrypt (wrong-key failure surfaces, not silently garbage
      output); encrypting the same data twice with the same key produces
      DIFFERENT ciphertext (proving the IV really is fresh per call, not
      reused).
  - files: `packages/codex-arweave/src/crypto/fileEncryption.ts` (new),
    `packages/codex-arweave/tests/crypto-file-encryption.test.ts` (new)

## Wave 2 (depends on Wave 1)

- [x] T4: Make `encrypted`/`encryptorAddress` real, validated fields on the
      actual upload entry points — mirroring exactly how `category` was
      made mandatory-at-this-layer in the `arweave-upload-categories`
      plan's T2/T3. Read `packages/arweave-core/src/upload/upload.ts`,
      `types.ts`, and `bundle.ts` in full first (their CURRENT shape,
      post-category-work). Add `encrypted: boolean` (REQUIRED — every
      upload must explicitly state whether it's encrypted, no silent
      default) plus optional `encryptorAddress?: string` to `UploadParams`
      and `UploadBundleParams`, forwarded verbatim to `buildUploadTags`.
      For the bundle path, `encrypted`/`encryptorAddress` apply identically
      to every file item AND the manifest item — BUT note the manifest's
      own established rule (`arweave-native-upload/design.md`'s original
      §4): folder/file *structure* stays public even for an encrypted
      upload, only file *contents* are encrypted — so the manifest ITEM
      itself should be tagged `Codex-Encrypted: false` even when its
      sibling file items are `true` (the manifest's DATA — the JSON
      path-mapping — must never itself be ciphertext, since gateways need
      to read it to resolve paths). Get this asymmetry right; it's easy to
      accidentally tag the manifest as encrypted too by treating
      `encrypted` as one flat parameter applied uniformly — it is NOT
      uniform across files vs. manifest. Rewrite existing test fixtures in
      `tests/upload.test.ts`/`tests/upload-bundle.test.ts` to include
      `encrypted: false` (the no-op, everything-public case) so they keep
      passing, then add new tests for the `encrypted: true` path
      (including, for the bundle case, asserting the manifest item
      specifically still carries `encrypted: false`/no `Codex-Encryptor`
      even when every file item carries `encrypted: true`).

      Note: this task does NOT do the actual encryption — `uploadData`/
      `uploadBundle` receive `data`/`files` that are ALREADY ciphertext
      bytes by the time they reach these functions (encryption happens one
      layer up, in T5's `library/flow.ts` composition) — this task only
      threads the boolean/address metadata and tags through correctly.

      Follow TDD: write/rewrite the failing tests first, confirm they
      fail, then implement.

      Done when: a single-file `encrypted: true` upload posts
      `Codex-Encrypted: "true"` + the correct `Codex-Encryptor`; a bundle
      `encrypted: true` upload posts the same on every FILE item but
      `Codex-Encrypted: "false"` (no `Codex-Encryptor`) on the MANIFEST
      item specifically; `encrypted: false` is fully backward-compatible
      with every existing test in both files.
  - files: `packages/arweave-core/src/upload/upload.ts`,
    `packages/arweave-core/src/upload/types.ts`,
    `packages/arweave-core/src/upload/bundle.ts`,
    `packages/arweave-core/tests/upload.test.ts`,
    `packages/arweave-core/tests/upload-bundle.test.ts`

- [x] T6: Add decrypt-on-download to the Library. Read
      `packages/codex-arweave/src/panel/LibraryArea.tsx` and `panel/
      context.tsx` in full first (current shape — no download affordance
      exists today, only an "Open" link to the raw gateway URL). Add a
      `downloadEntry` capability: for a public entry (`Codex-Encrypted`
      tag absent or `"false"`), behaves exactly like the existing Open
      link — no change needed there beyond making it available as an
      explicit "Download" action alongside "Open". For an encrypted entry
      (`Codex-Encrypted: "true"`): fetch the raw ciphertext bytes from a
      healthy gateway (reuse whatever fetch/gateway-pool seam this package
      already uses elsewhere for a read — do not invent a new HTTP client),
      read the `Codex-Encryptor` tag's address, resolve that account's
      plaintext secret via the injected `revealAccountSecret` prop
      (already exists on `ArweavePanelDeps`/gets threaded to
      `ArweaveSeedsArea` today — thread it to `LibraryArea` the same way),
      and if `revealAccountSecret` is undefined OR resolves `null` OR the
      resolved account isn't the one actually referenced by the tag,
      surface a clear, specific error ("this codex doesn't hold the
      account that encrypted this upload" or equivalent — never a generic
      failure) rather than attempting a decrypt with the wrong key.
      Decrypt via T3's `decryptWithDerivedKey`/`deriveAccountAesKey` (the
      SAME derive-once primitive used to encrypt — this download path
      derives the key fresh from the resolved bitstring, it does not need
      T1's helper). Hand the user the resulting plaintext via a download
      (object URL + `<a>` click + revoke, mirroring
      `useCodexBackup.ts`'s `downloadAsJson`'s exact browser-download
      idiom) using the original filename/content-type carried in the
      entry's existing tags.

      Follow TDD: write the failing tests first (inject fakes for the
      fetch/gateway seam and `revealAccountSecret`), confirm they fail,
      then implement.

      Done when: downloading a public entry behaves unchanged from today's
      Open link; downloading an encrypted entry with the correct account
      present and unlocked yields the exact original plaintext bytes under
      the original filename; downloading an encrypted entry when
      `revealAccountSecret` is absent, or resolves no matching account,
      surfaces the specific "can't decrypt" message rather than any
      generic error or a corrupted/garbage download.
  - files: `packages/codex-arweave/src/panel/LibraryArea.tsx`,
    `packages/codex-arweave/src/panel/context.tsx`,
    `packages/codex-arweave/tests/e4-panel-library.test.tsx`

- [x] T7: Retroactive add — a new function to look up a single upload by
      id from chain, plus a new small UI component to drive it. Read
      `packages/arweave-core/src/rebuild/query.ts` in full first (the
      existing `queryOwnerUploads` is owner-scoped/paginated — there is no
      single-id lookup today). Add `queryUploadById(pool: GatewayPool, id:
      string, opts?: { fetchFn?: typeof fetch }): Promise<OwnerUploadRecord
      | null>` — a GraphQL query by transaction id directly (Arweave's
      GraphQL schema supports a single-`id` `transaction(id: "...")`
      query, or an `ids: ["..."]` filter on `transactions` — use whichever
      this package's existing GraphQL query-building code in
      `queryOwnerUploads` already demonstrates the pattern for, don't
      invent a different query-construction style), resolving `null` when
      no matching transaction is found (never throwing for "not found" —
      only for a genuine network/gateway failure). Then a new component
      `panel/RetroactiveAddArea.tsx` (its own file, not folded into
      `LibraryArea.tsx`): an id/URL input + a button; on submit, calls
      `queryUploadById`, verifies the result's `Codex-Owner` tag matches
      one of the addresses this codex actually holds (inject the list of
      this codex's own Arweave addresses as a prop — do not verify against
      only the currently-active address, a user may be retroactively
      adding something that belongs to a DIFFERENT account they also
      hold), and on a match calls the injected `LibraryStore`'s `append`
      (or an equivalent injected callback — mirror how `UploadArea.tsx`/
      `CodexBackupArea.tsx` are already handed injected async
      functions rather than reaching into a store directly) to insert it.
      A non-matching owner, or a not-found id, shows a clear, specific
      message — never a silent no-op.

      Follow TDD: write the failing tests first, confirm they fail, then
      implement.

      Done when: a well-formed id belonging to an address this codex holds
      is found and inserted into that address's Library; an id belonging
      to an address NOT held by this codex is rejected with a clear
      "doesn't belong to any account in this codex" message, never
      inserted; a not-found id shows "not found," not a crash or a generic
      error; an inserted encrypted entry immediately works with T6's
      decrypt-on-download with no extra setup.
  - files: `packages/arweave-core/src/rebuild/query.ts`,
    `packages/arweave-core/tests/rebuild-query.test.ts`,
    `packages/codex-arweave/src/panel/RetroactiveAddArea.tsx` (new),
    `packages/codex-arweave/tests/e4-panel-retroactive-add.test.tsx` (new)

## Wave 3 (depends on Wave 2)

- [x] T5: Wire real file encryption into the upload composition. Read
      `packages/codex-arweave/src/library/flow.ts` in full first (current
      `uploadAndTrack`/`uploadFilesAndTrack` signatures, post-category
      work). Both gain an optional encryption selection: `encryptFor?: {
      accountId: string; revealAccountSecret: (accountId: string) =>
      Promise<string | null> | string | null }` (or thread these as
      separate params if that reads more consistently with this file's
      existing parameter style — match the file's own convention, your
      judgment). When provided: resolve the account's bitstring via
      `revealAccountSecret` (throw a clear, specific error — not a generic
      one — if it resolves `null`, mirroring this file's existing
      error-propagation style elsewhere), derive the AES key ONCE via T3's
      `deriveAccountAesKey`, then for each file: base64-encode its raw
      bytes, encrypt the base64 string's UTF-8 bytes via T3's
      `encryptWithDerivedKey`, and pass the resulting ciphertext bytes as
      that file's `data` into T4's now-`encrypted: true, encryptorAddress`-
      aware `uploadData`/`uploadBundle` call (the IV needs to travel with
      the ciphertext for later decryption — prepend it to the ciphertext
      bytes before upload, matching the handoff's original documented
      convention "prepend the IV to the ciphertext," and T6's
      decrypt-on-download must correspondingly strip the same IV length
      off the front before calling `decryptWithDerivedKey` — confirm T6's
      implementation does this consistently with whatever exact byte
      layout you choose here). When `encryptFor` is omitted, behavior is
      completely unchanged from today (`encrypted: false`, everything
      else identical) — regression guard.

      Also add: an optional `onAccountUsedForEncryption?: (accountId:
      string) => void` callback, invoked ONLY after a successful encrypted
      upload (upload-then-notify, matching this file's established
      upload-then-append discipline) — this is the non-removable-account
      trigger point for the later `arweave-account-safety` topic; this
      task's only obligation regarding it is calling it reliably at the
      right moment, with the right account id. This function must NOT
      itself touch `codex-ouronet` or know what "non-removable" means —
      matching this file's own documented cross-package isolation rule,
      confirm you've read and are preserving it before writing anything.

      Follow TDD: write the failing tests first, confirm they fail, then
      implement.

      Done when: given `encryptFor` and a fake `revealAccountSecret`, a
      single-file `uploadAndTrack` call results in `uploadData` being
      called with `encrypted: true` and ciphertext (not the original
      plaintext bytes) as `data`; the SAME derived-key behavior holds for
      `uploadFilesAndTrack` across a 3-file bundle, with the AES
      derivation happening exactly ONCE for the whole batch (assert this
      via a spy/call-count on `deriveAccountAesKey`, not just correctness
      of the output); omitting `encryptFor` entirely reproduces today's
      existing behavior byte-for-byte (regression guard); a successful
      encrypted upload calls `onAccountUsedForEncryption` with the correct
      account id exactly once; a failed upload never calls it at all.
      The full `arweave-core` and `codex-arweave` test suites pass
      (unscoped — check for the same class of gap several prior tasks in
      this project found: an existing caller/test outside this task's own
      file list left broken by the now-required `encrypted` field on
      `UploadParams`/`UploadBundleParams`, e.g.
      `src/adapter/arweaveAdapter.ts` or any test helper constructing
      those types directly — fix and flag explicitly if found, exactly
      like the prior tasks in this project did). `npx tsc -b
      packages/arweave-core --force` and `npx tsc -b packages/codex-arweave
      --force` are both clean.
  - files: `packages/codex-arweave/src/library/flow.ts`,
    `packages/codex-arweave/tests/e3-library-flow.test.ts`
