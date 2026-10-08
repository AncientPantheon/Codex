Grounding refinement, found while planning (not in the original design.md — read this before
starting): `exportJson`'s three secret-ciphertext fields (`arweaveSeeds[].secret`,
`foreignKeys.keys[].encryptedKeyfile`, `pureKeypairs[].encryptedPrivateKey`) are documented,
stable, and load-bearing per `packages/codex/IMPORT_EXPORT_CONTRACT.md` §2 — but that same
document's §1 "MUST NOT" rule (never hand-parse the wire shape outside the sanctioned codec)
means the "decrypt every field under the local password, re-encrypt under the IDEK" step
CANNOT live as ad-hoc JSON-walking code inside `arweave-core`/`codex-arweave` (neither of
which import `codex-core` at all today — a real, load-bearing boundary elsewhere in this
monorepo). It must be a new, deliberate, SANCTIONED function added to `codex-core` itself,
touching exactly the files `IMPORT_EXPORT_CONTRACT.md` §5's "Extension protocol" already
anticipates for shape-aware changes — and that document's own §5 list must be followed when
adding it (this plan's T1 includes updating `IMPORT_EXPORT_CONTRACT.md` itself as part of the
task, not a follow-up).

## Wave 1

- [x] T1: The core envelope crypto primitives — package-boundary-clean, no
      `codex-core` dependency, fully independent of Wave 2. Read
      `docs/work/codex-backup-envelope-encryption/design.md` in full first
      (the whole "Approach" section), plus
      `packages/codex-arweave/src/crypto/accountKeyCipher.ts` (the existing
      `CryptoSeam`-injection convention for V2-cipher operations — the
      SAME convention this task reuses, never a direct `@stoachain/stoa-core`
      import) and `packages/codex-arweave/src/crypto/fileEncryption.ts`
      (the existing raw-AES-key derive/encrypt/decrypt convention — IDEK/EDEK
      are each a already-raw 256-bit key, generated directly via
      `crypto.getRandomValues`, NOT PBKDF2-derived from a password the way
      `fileEncryption.ts`'s own key is — so this task's wrap/unwrap of the
      DEKS THEMSELVES uses the V2 password-shaped cipher via `CryptoSeam`,
      but encrypting codex CONTENT under an already-raw DEK is a plain
      AES-GCM operation with no derivation step — ground this distinction
      precisely, the two are genuinely different operations in this design,
      don't conflate them).

      Build, in a new file `packages/codex-arweave/src/crypto/
      backupEnvelope.ts` (exact name your call, keep consistent with
      sibling crypto modules in that directory):
      - `generateDek(): CryptoKey` — a fresh random AES-256-GCM key (mirror
        `fileEncryption.ts`'s own key-generation pattern, e.g.
        `crypto.subtle.generateKey`), used identically for BOTH the IDEK
        and the EDEK (two independent calls, two independent keys — never
        the same key reused for both roles).
      - `encryptWithDek(key: CryptoKey, data: Uint8Array):
        Promise<{ciphertext, iv}>` / `decryptWithDek(key, ciphertext, iv):
        Promise<Uint8Array>` — plain AES-GCM under an already-raw key, no
        PBKDF2 step (reuse `fileEncryption.ts`'s own
        `encryptWithDerivedKey`/`decryptWithDerivedKey` DIRECTLY if their
        signature already fits — they operate on an already-resolved
        `CryptoKey` regardless of how it was derived, so they may need NO
        new code at all here; confirm this by reading that file's real
        signature before writing a duplicate).
      - `wrapDekWithScalar(dek: CryptoKey, scalarString: string, seam:
        CryptoSeam): Promise<string>` / `unwrapDekWithScalar(wrapped:
        string, scalarString: string, seam: CryptoSeam): Promise<CryptoKey>`
        — exports the raw DEK bytes (`crypto.subtle.exportKey("raw", dek)`),
        encrypts/decrypts them as a V2-cipher string payload keyed by
        `scalarString` (the base49 or base10 spelling, per the design doc's
        exact source/layer pairing — base49(scalar) wraps IDEK, base10
        (scalar) wraps EDEK, for EACH of the two default sources), via the
        injected `CryptoSeam` (mirror `accountKeyCipher.ts`'s own
        `encryptWithAccountKey`/`decryptWithAccountKey` call shape exactly
        — this task's wrap functions are structurally the same operation,
        just wrapping raw key bytes instead of a password string),
        re-importing the raw bytes back into a `CryptoKey` on unwrap.

      Follow TDD: write failing tests first in `packages/codex-arweave/
      tests/crypto-backup-envelope.test.ts` covering: `generateDek()`
      produces a usable AES-GCM key, two calls never produce the same raw
      key bytes; `encryptWithDek`/`decryptWithDek` round-trip real content
      byte-exact; `wrapDekWithScalar`/`unwrapDekWithScalar` round-trip a
      real generated DEK's raw bytes exactly (export → wrap → unwrap →
      re-import → use it to decrypt something the original DEK encrypted
      — a REAL functional proof, not just byte-equality of the exported
      bytes alone); wrapping the SAME dek under base49 vs base10 of the
      SAME scalar produces DIFFERENT wrapped strings (confirms the two
      spellings are genuinely different cipher inputs, not accidentally
      identical); unwrapping with the WRONG scalar fails loudly (the V2
      cipher's own wrong-key behavior propagates unmodified). Use a real,
      fixed test `CryptoSeam` — check `accountKeyCipher.ts`'s own test
      file for how it fakes/reals this seam, mirror that convention
      exactly (a REAL `encryptStringV2`/`smartDecrypt` pair if that's
      what the existing tests use, not a hand-rolled fake cipher).

      Done when: every primitive above round-trips correctly against REAL
      WebCrypto and a REAL (or realistically-shaped) `CryptoSeam`, proven
      by actually using an unwrapped DEK to decrypt real content, not just
      comparing exported key bytes.
  - files: `packages/codex-arweave/src/crypto/backupEnvelope.ts` (new),
    `packages/codex-arweave/tests/crypto-backup-envelope.test.ts` (new)

- [x] T2 (parallel with T1 — independent package, independent file scope):
      The NEW sanctioned codex-core field-transform function. Read
      `packages/codex/IMPORT_EXPORT_CONTRACT.md` in FULL first — especially
      §1 (why hand-parsing is forbidden), §2's exact wire shape table and
      per-entry shapes (the three secret fields:
      `arweaveSeeds[].secret`, `foreignKeys.keys[].encryptedKeyfile`,
      `pureKeypairs[].encryptedPrivateKey`), and §5's "Extension protocol"
      (the list of files that change together for a shape-aware change —
      this task is exactly that kind of change, even though it transforms
      ciphertext rather than adding a field, because it reaches into the
      same known secret-field paths that document owns). Read
      `packages/codex-core/src/codex/codec.ts` and `types.ts` in full to
      confirm the exact real current field names/paths (do not trust this
      plan's paraphrase over the real source).

      Build a new exported function from `codex-core` (exact module
      location your call — likely a new file,
      `packages/codex-core/src/codex/backupReencryption.ts`, exported from
      `codex-core`'s public barrel): something like
      `reencryptBackupSecretFields(exportJson: string, opts: {
      decryptField: (ciphertext: string) => Promise<string>; encryptField:
      (plaintext: string) => Promise<string>; }): Promise<string>` —
      parses `exportJson` via the EXISTING sanctioned codec path (reuse
      `deserializeCodex`/whatever internal parse step `codec.ts` already
      exposes — do NOT hand-roll a second parser; if the existing codec
      functions aren't structured to expose an intermediate parsed-but-
      not-yet-typed form this function can reuse, read `codec.ts` closely
      enough to find the right seam or extend it minimally), walks EXACTLY
      the three documented secret-field paths (never a fourth, never
      fewer — if a new secret field is ever added per §5's protocol, THIS
      function's own list is now part of that protocol too, note this in
      the function's own doc comment), calls `opts.decryptField` on each
      value found, then `opts.encryptField` on the result, writes the
      transformed value back in place, and re-serializes via the EXISTING
      sanctioned writer path (reuse `buildCodexExport`/`serializeCodex` or
      whatever the codec's real writer entry point is — confirm the exact
      real function name, do not guess) so the output is still a fully
      valid, version-correct, codec-round-trippable export — just with
      different ciphertext in the three known positions, nothing else
      changed, shape and every other field byte-for-byte identical.

      Also fix the version-tag gap named in the parent design doc: find
      wherever `Codex-App-Version` is currently derived from `exportJson`'s
      `lastUpdatedAt` for a codex-backup upload (grep for it — likely
      `deriveBackupLineage` in `packages/codex-arweave/src/library/
      flow.ts`, OUTSIDE this task's own file scope) and confirm (don't
      fix it here, just confirm and report) that `codex-core`'s
      `CODEX_FORM_VERSION` constant (`packages/codex-core/src/
      codexFormVersion.ts`) is now cleanly importable/reachable for THAT
      future task to use — if it already is, nothing to do; if some
      export/barrel gap blocks it, note that precisely in your report
      (Wave 2's T3 will do the actual fix, this task just confirms the
      path is clear).

      Follow TDD: write failing tests first in `packages/codex-core/tests/
      backup-reencryption.test.ts` (confirm this package's real test file
      naming convention first — mirror it) covering: a real, full,
      multi-keyring export JSON (built via the SAME `buildCodexExport`/
      codec path this function itself uses — never a hand-typed JSON
      literal that could silently drift from the real wire shape) has all
      three secret-field TYPES transformed (at least one
      `arweaveSeeds[].secret`, one `foreignKeys.keys[].encryptedKeyfile`,
      one `pureKeypairs[].encryptedPrivateKey` entry, each actually
      present in the fixture); every OTHER field (ids, labels, addresses,
      timestamps, `version`, non-secret structure) is byte-for-byte
      unchanged; the output re-parses successfully through the EXISTING
      sanctioned reader (`deserializeCodex`) with no shape errors;
      `decryptField`/`encryptField` are called EXACTLY once per secret
      field found (never zero for a present field, never duplicated); a
      backup with ZERO entries in one or more of the three keyrings (e.g.
      no `pureKeypairs` at all) is handled without error (confirms the
      omitted-field case from IMPORT_EXPORT_CONTRACT.md §4 doesn't break
      this new function). Confirm red-for-missing-module first, then
      implement.

      Done when: a real multi-keyring export, round-tripped through this
      function with REAL (not faked) encrypt/decrypt callbacks, has every
      secret field transformed and every other byte unchanged, re-parses
      cleanly through the existing sanctioned codec reader, and
      `IMPORT_EXPORT_CONTRACT.md` itself is updated (§5-style: this new
      function is now part of "what changes together" for any future new
      secret field) to document this function's existence, its exact
      contract (which three fields, in what order, idempotent or not on a
      second application — state this explicitly), and why it's exempt
      from the "don't hand-parse" rule (it reuses the sanctioned codec
      internally, it doesn't reimplement it).
  - files: `packages/codex-core/src/codex/backupReencryption.ts` (new,
    exact path your call), `packages/codex-core/tests/
    backup-reencryption.test.ts` (new, exact path matching this package's
    real convention), `packages/codex-core/src/index.ts` (barrel export,
    if this package's convention requires one — confirm),
    `packages/codex/IMPORT_EXPORT_CONTRACT.md` (the extension-protocol
    update)

## Wave 2 (depends on Wave 1: T1 + T2)

- [x] T3: Wire the envelope into `backupCodexToLibrary`, fix the version
      tag, remove the old recovery-key mechanism. Read
      `packages/codex-arweave/src/library/flow.ts` in FULL first —
      specifically `backupCodexToLibrary`, `BackupCodexToLibraryOptions`,
      `deriveBackupLineage`, and the existing `Codex-Backup-Recovery-Key`
      mechanism (the `appMetadata`/`TAG_CODEX_BACKUP_RECOVERY_KEY` block)
      this task REMOVES entirely (confirmed via the owner: no real backup
      has ever been made under the old scheme — this is a replacement,
      not an additive parallel path). Also read
      `packages/arweave-core/src/upload/codexBackup.ts`
      (`uploadCodexBackup`'s real params) and `packages/arweave-core/src/
      upload/tags.ts` (to add the new wrapped-key tags and the
      `Codex-Backup-Encryption-Version`/`Codex-Form-Version` tags — ground
      the exact real tag-list-building function before adding to it).

      Rebuild `backupCodexToLibrary`'s real flow:
      1. Generate IDEK and EDEK (T1).
      2. Call T2's `reencryptBackupSecretFields(exportJson, {decryptField,
         encryptField})` — `decryptField` uses the codex's current
         password (same `smartDecrypt`-under-password convention the
         fields are already encrypted with today — ground the real
         function); `encryptField` uses T1's `encryptWithDek(idek, ...)`.
      3. Encrypt the WHOLE resulting (IDEK-reencrypted) JSON string, as
         one opaque blob, under the EDEK (T1's `encryptWithDek(edek,
         ...)` again, over the full string's bytes this time).
      4. Wrap IDEK and EDEK under BOTH default sources (Master Seed's
         bitstring, Standard Apollo's bitstring — ground exactly how this
         function currently receives/would receive each source's
         bitstring; `primeArweaveSeedBitstring` already exists as an
         option, Standard Apollo's bitstring needs to be added as a new
         option, mirroring the SAME shape) — 4 wrapped-key tags total.
      5. Post the opaque EDEK-encrypted blob (NOT the plaintext-shaped
         JSON) as `uploadCodexBackup`'s `exportJson`/data payload, with
         the 4 wrapped-key tags plus a new `Codex-Backup-Encryption-Version`
         tag (a fresh version axis, independent of the per-file
         `Codex-Encryption-Version`) attached via `appMetadata`.
      6. Remove `codexPassword`/`cryptoSeam`-for-the-old-recovery-tag from
         `BackupCodexToLibraryOptions` entirely (replaced by whatever new
         options this function now needs: the password for step 2's
         decrypt, the Master Seed bitstring, the Standard Apollo bitstring,
         a `CryptoSeam` for the wrap step — ground the minimal real set).
      7. Fix the version tag: `Codex-Form-Version` (or your settled exact
         name) carries the real `CODEX_FORM_VERSION` constant, confirmed
         reachable per T2's own confirmation step — NOT derived from
         `lastUpdatedAt`. Keep a clearly-named timestamp tag separately if
         still wanted (your call, state the choice).
      8. Confirm (and if needed, ground/implement) the explicitly-required
         degrade path: what happens when the codex is NOT eligible (no
         Prime Arweave seed/Standard Apollo available) — per the parent
         design doc's acceptance criteria, this must not silently produce
         a broken or wrong-but-claimed-successful upload. State and
         implement the real behavior (e.g. the backup action is simply
         unavailable/blocked upstream of this function for an ineligible
         codex — confirm this is ALREADY how eligibility gates the UI
         today via `checkArweaveRestoreEligibility`, so this function may
         legitimately assume eligibility as a precondition rather than
         re-checking it itself — ground this, don't assume).

      Follow TDD: write failing tests first in whichever existing test
      file covers `backupCodexToLibrary` today (find it — likely
      `tests/e3-library-flow.test.ts` or a dedicated backup test file,
      confirm the real name) covering: a real backup upload posts an
      OPAQUE blob (not parseable as the original JSON shape — assert
      `JSON.parse` on the posted bytes throws, or at minimum that none of
      the original field names/array lengths are recoverable from it
      directly); exactly 4 wrapped-key tags are posted, correctly named;
      `Codex-Form-Version` carries the real constant; the OLD
      `Codex-Backup-Recovery-Key` tag is NEVER posted, under any
      input (positive regression guard — grep the posted tags, assert
      absence); omitting the Standard Apollo bitstring (if that's a
      legitimately-optional input in your final design) still posts the
      Master Seed wrap pair at minimum, or if BOTH are required
      preconditions per step 8's eligibility-precondition conclusion, a
      test proving the function is simply never called without them
      (matching the real upstream gating). Confirm red-for-the-right-
      reason first, then implement.

      Done when: a real backup upload (fake-gateway-backed, at the test
      level) posts a genuinely opaque blob with exactly 4 correctly-named
      wrapped-key tags and the correct version tag, the old recovery-key
      mechanism is completely gone (not a dead/unused parallel path left
      in the code — actually removed), and the full existing
      `codex-arweave` test suite passes (unscoped) beyond the one known
      pre-existing `node:sqlite` failure.
  - files: `packages/codex-arweave/src/library/flow.ts`,
    `packages/arweave-core/src/upload/tags.ts`, whichever existing test
    file(s) cover `backupCodexToLibrary` (identify the real name, don't
    guess)

## Wave 3 (depends on Wave 2's T3)

- [x] T4: The Arweave-PIN wrap path (owner decision 2026-10-08: moved
      into THIS construction round, no longer deferred — see
      `docs/work/codex-backup-envelope-encryption/design.md`'s "The
      Arweave-PIN wrap path" section, read it in full first; it has the
      settled restore-routing mechanic already worked out, don't re-derive
      it). Read `packages/codex-arweave/src/seeds/derivePrimeSeed.ts`
      (`deriveArweaveSeedAtPositionZero` — the existing "RSA-4096 keypair
      at a chosen position from a bitstring" primitive) and
      `packages/codex-arweave/src/keygen/worker.ts`/`KeygenRunner.ts`
      (the existing `generateFromBitStringAtRangesAsync`-from-
      `@ouronet/dalos-crypto/rsa4096` Worker-wrapped call pattern — the
      REAL underlying keygen-at-an-arbitrary-index primitive this task
      needs, already proven, already Worker-wrapped for off-main-thread
      use; reuse this pattern, do not call the heavy RSA keygen surface
      on the main thread) in full first.

      Build the PIN-wrap extension to T3's envelope-building step: given
      a source's bitstring AND a user-supplied PIN (6-15 digit string,
      validate the range, reject 16 digits per the design doc's own
      stated reason), derive an RSA-4096 keypair at the PIN-chosen
      position (reuse the existing keygen-at-position machinery — ground
      exactly how "PIN digits" become "the position/index" argument that
      machinery expects, this is a real design decision not fully pinned
      in the parent doc — state and justify your choice), use the
      keypair's `p` to wrap the IDEK and `q` to wrap the EDEK (plain
      value-wrap, not the V2-cipher-string-wrap T1 built for the default
      path — ground whether T1's `wrapDekWithScalar` can be reused as-is
      with `p`/`q` treated as the "scalar" input, or whether a distinct
      wrap function is needed because `p`/`q` are raw bigints, not
      password-shaped strings; this is exactly the kind of place T1's own
      functions might already fit, or might need a small additive
      sibling — check before writing new code).

      Wire this into `backupCodexToLibrary` (extending T3's work,
      additively — the no-PIN path must be completely unaffected when no
      PIN is supplied for a given source): accept an optional PIN per
      source (Master Seed PIN, Standard Apollo PIN — independently
      optional, a user may PIN one, both, or neither). When a source has
      a PIN: post ONLY that source's `...-Pin` tag pair (IDEK+EDEK), NEVER
      also its `...-Default` pair — verify this mutual exclusivity
      directly in a test, it is the single most safety-critical property
      of this task (a stray default tag sitting alongside a PIN'd one
      defeats the PIN entirely). When a source has no PIN: unchanged,
      exactly T3's existing default-pair behavior for that source.

      Follow TDD: write failing tests first (extending T3's own test
      file) covering: a source with a PIN posts ONLY `...-Pin` tags for
      IDEK+EDEK, never `...-Default`, for that source; the OTHER source
      (no PIN) still posts its normal `...-Default` pair, unaffected;
      restoring (test-level, direct function calls — the full restore UX
      is T5) with the correct PIN successfully unwraps; the WRONG PIN
      fails loudly (never silently wrong — the RSA keypair at the wrong
      position simply won't unwrap the real ciphertext, confirm this
      produces a clear decrypt failure, not a plausible-looking garbage
      success); a 5-digit or 16-digit PIN is rejected before any keygen
      is even attempted (cheap validation first, don't burn a ~6.7s
      keygen on an input that was already invalid). Confirm
      red-for-the-right-reason first, then implement.

      Done when: PIN-protected and default-protected sources coexist
      correctly on the same upload (one of each, mixed), mutual
      exclusivity is proven per-source, wrong-PIN fails loudly, and the
      keygen-at-position step runs off the main thread (reusing the
      existing Worker-wrapped pattern, not a new main-thread call). Full
      `codex-arweave` suite passes (unscoped, the one known pre-existing
      `node:sqlite` failure allowed); clean typecheck.
  - files: `packages/codex-arweave/src/library/flow.ts` (extending T3's
    work), `packages/codex-arweave/src/crypto/backupEnvelope.ts` (ONLY
    if a new wrap-with-raw-bigint sibling function is genuinely needed —
    flag clearly), corresponding test file(s)

## Wave 4 (depends on Wave 3)

- [x] T5: The restore path — unwrap via EITHER default source, AND the
      PIN path when present, replacing the old recovery-tag-based
      restore step. Read `docs/work/arweave-seed-restore/design.md` and
      whatever real source file currently implements that restore flow
      (find it — this plan doesn't name it with certainty; search for
      wherever `Codex-Backup-Recovery-Key` is currently READ, as opposed
      to T3/T4's write side) in full first.

      Rebuild the restore step: given an upload's tags, determine, PER
      SOURCE, whether `...-Default` or `...-Pin` is present (per the
      design doc's settled routing mechanic — `...-Default` present →
      unwrap directly, no PIN ever asked; absent + `...-Pin` present →
      prompt for the PIN now, known to be needed, never guessed blind;
      neither present → this source wasn't used for this upload, tell
      the user plainly). Accept EITHER source's bitstring (Master Seed OR
      Standard Apollo) as the unlock input, resolve that source's actual
      wrap path per the routing mechanic above, unwrap the corresponding
      EDEK, decrypt the opaque blob, unwrap the corresponding IDEK, call
      T2's inverse direction (decrypt each of the 3 known secret fields
      back — they stay IDEK-decrypted in memory, no password involved
      until the NEW password prompt at the very end, per the design
      doc's own restore-order note) to get the fully plaintext codex,
      then hand off to the existing "prompt for a new password, encrypt
      locally, inject into the browser" tail (already built — confirm
      and reuse it, don't rebuild it).

      Follow TDD: write failing tests first proving: restoring via the
      Master Seed's bitstring ALONE (default path) succeeds with zero
      password consulted before the final new-password prompt; restoring
      via the Standard Apollo bitstring ALONE (default path, independent
      of Master Seed) succeeds identically; the two DEFAULT restore
      paths, given the SAME uploaded backup, produce the SAME final
      plaintext codex; restoring a PIN'd source with the correct PIN
      succeeds, with the WRONG PIN fails loudly; restoring with a WRONG
      bitstring (neither source at all) fails loudly and clearly; the
      restore flow correctly determines PIN-needed-or-not from tag
      presence BEFORE prompting, never discovers it via a failed blind
      attempt. Confirm red-for-the-right-reason first, then implement.

      Then: full round-trip verification — upload via T3+T4's real
      (fake-gateway-backed) path with a mixed configuration (one source
      default, one source PIN'd), restore via ALL applicable paths
      independently, confirm the restored codex matches the original
      exactly (every keyring, every entry, byte-for-byte after
      decryption) for each.

      Finally: the documentation acceptance criterion from the parent
      design doc — write the full procedure (both DEKs, both default wrap
      sources, the Arweave-PIN path and its routing-tag mechanic, the
      exact wrap/unwrap order, the base49/base10 convention, the new
      `Codex-Backup-Encryption-Version` axis) into
      `packages/codex/ARWEAVE_TAG_SCHEMA.md`'s existing "Encryption
      procedure versions" section (or create an equivalent dedicated
      section if none fits), in enough detail to reimplement from the
      document alone — mirror that document's own existing rigor/detail
      level for the per-file encryption procedure already documented
      there.

      Done when: every restore path (2 default + up to 2 PIN) is proven
      correct via a real upload→restore round trip, every wrong-key/
      wrong-PIN case fails loudly, and the full procedure (including PIN)
      is documented to reimplementable detail. Full `codex-arweave`/
      `codex-core` suites pass; clean typecheck both.
  - files: whichever real restore-flow source file(s) currently implement
    this (identify precisely, don't guess), corresponding test file(s),
    `packages/codex/ARWEAVE_TAG_SCHEMA.md`
