## Wave 1

- [x] T1: Build the Structural Migration Engine — detects and fixes a legacy
      `"stoic"` seed's `secret` field when it holds raw DALOS words instead
      of the pre-converted 1600/1024-char bitstring, across both
      `kadenaSeeds` (only entries with `seedType === "stoic"`) and
      `arweaveSeeds` (every entry — `IArweaveSeed` has no `seedType`, all of
      them use the DALOS bitstring convention). Mirrors `rekeyCodex`'s
      proven shape (`src/rekey/index.ts`): pure w.r.t. its snapshot
      argument (works on a `structuredClone`, caller's object is never
      mutated), skip-not-drop on anything unresolvable.
      Create `packages/codex-ouronet/src/structural-migration/index.ts`
      exporting:
      - `export const STRUCTURAL_SHAPE_TARGET_VERSION = "1.0.0" as const;`
      - `export interface StructuralMigrationNeedsInput { slice: "kadenaSeeds" | "arweaveSeeds"; id: string; reason: string; }`
      - `export interface StructuralMigrationSkip { slice: "kadenaSeeds" | "arweaveSeeds"; id: string; reason: string; }`
      - `export interface StructuralMigrationOptions { requestMissingData?: (need: StructuralMigrationNeedsInput) => Promise<string | undefined>; }`
      - `export interface StructuralMigrationResult { snapshot: CodexSnapshot; fixedSeedIds: string[]; skipped: StructuralMigrationSkip[]; }`
      - `export async function runStructuralMigration(snapshot: CodexSnapshot, password: string, options?: StructuralMigrationOptions): Promise<StructuralMigrationResult>`

      Algorithm per checked entry (a kadenaSeeds entry with
      `seedType === "stoic"`, or any arweaveSeeds entry), using
      `smartDecrypt`/`encryptStringV2` from `@stoachain/stoa-core/crypto`,
      `validateSeedWords`/`seedWordsToBitString` from
      `@ouronet/dalos-crypto/gen1`:
      1. If `entry.secret` is empty/undefined, skip silently (nothing to
         migrate).
      2. Decrypt `entry.secret` with `password`. If decryption throws for
         any reason, record `{ slice, id: entry.id, reason: "<error message>" }`
         in `skipped` (via the reconciliation step below first — see 4/5)
         and leave `entry.secret` untouched — never abort the whole run
         over one bad entry.
      3. If the decrypted plaintext matches `/^[01]+$/` and has length 1024
         or 1600, it's already the current bitstring shape — no change,
         not counted in `fixedSeedIds` or `skipped`.
      4. Else if `validateSeedWords(plaintext)` (imported from
         `@ouronet/dalos-crypto/gen1`) returns `null` (i.e. it's a valid
         DALOS word list), this is the legacy-shape bug: if
         `entry.wordsSecret` is not already set, set it to
         `await encryptStringV2(plaintext, password)` (never overwrite an
         existing `wordsSecret`); then set `entry.secret =
         await encryptStringV2(seedWordsToBitString(plaintext), password)`.
         Push `entry.id` to `fixedSeedIds`.
      5. Else (decrypt failed, or plaintext is neither a valid bitstring
         nor valid words): this entry is unresolvable automatically. Build
         `need: StructuralMigrationNeedsInput = { slice, id: entry.id, reason: "<describe what's wrong, e.g. decrypted value is neither a valid bitstring nor a valid DALOS word list>" }`.
         If `options?.requestMissingData` is provided, call
         `await options.requestMissingData(need)`. If it resolves to a
         non-empty string, treat that string as the real words: validate
         it with `validateSeedWords`; if valid, repeat step 4's fix logic
         using the supplied words (do NOT re-call `requestMissingData` a
         second time for this entry, even if the supplied value is
         invalid — if the supplied value is also invalid, or
         `requestMissingData` resolves to `undefined`/rejects, or no
         `requestMissingData` was given at all, push
         `{ slice, id: entry.id, reason: need.reason }` to `skipped` and
         leave `entry.secret`/`entry.wordsSecret` untouched (original
         ciphertext preserved verbatim, never dropped).
      6. After walking every checked entry, stamp
         `result.snapshot.Codex_Shape_Version = STRUCTURAL_SHAPE_TARGET_VERSION`
         on the cloned snapshot. Enforce as a postcondition: if, after the
         walk, `result.snapshot.Codex_Shape_Version !== STRUCTURAL_SHAPE_TARGET_VERSION`,
         throw `CodexStructuralMigrationError("post-condition-failed", ...)`
         (this should be unreachable by construction — the check exists so
         a future refactor that breaks the stamp fails loudly, matching
         `applyMigrations`'s existing enforcement discipline in
         `migrations.ts`).

      Add `CodexStructuralMigrationError` to
      `packages/codex-ouronet/src/errors/types.ts` (new class, same shape
      as `CodexMigrationError` immediately above it in that file: extends
      `CodexError`, `name = "CodexStructuralMigrationError"`, single
      `reason: "post-condition-failed"` with its own message map entry,
      constructor `(reason, detail?, cause?)`), and export it from
      `packages/codex-ouronet/src/errors/index.ts` alongside the existing
      `CodexMigrationError` export.

      Add the self-ref vitest alias (mirrors the existing `/rekey` line
      immediately above it) to
      `packages/codex-ouronet/vitest.config.ts`:
      `{ find: /^@ancientpantheon\/codex-ouronet\/structural-migration$/, replacement: \`${codexOuronetSrc}/structural-migration/index.ts\` },`

      Add the real publish-time export entry (mirrors the existing
      `"./rekey"` entry) to `packages/codex-ouronet/package.json`'s
      `"exports"` map:
      `"./structural-migration": { "types": "./dist/structural-migration/index.d.ts", "import": "./dist/structural-migration/index.js" }`

      done when:
      - A test reads the real file
        `/home/ancientbox/ClaudeWS/Miscellaneous/_Codices/Foreign/Ionut_OuronetCodex_2026-10-11_13-22-23.json`
        via `fs.readFileSync` (absolute path, no repo-relative resolution),
        extracts its single `kadenaWallets[0]` entry (the one with
        `seedType: "stoic"`), builds a minimal `CodexSnapshot`-shaped
        fixture whose `kadenaSeeds[0]` carries that entry's REAL `secret`
        ciphertext verbatim (same pattern `rekey.test.ts`'s own
        `makeSnapshot` uses for shape, but with real extracted ciphertext
        instead of freshly-encrypted fixture text), and calls
        `runStructuralMigration(snapshot, "<redacted-rotated-credential>")`. The
        result's `fixedSeedIds` contains that seed's id, and
        `await smartDecrypt(result.snapshot.kadenaSeeds[0].secret, "<redacted-rotated-credential>")`
        matches `/^[01]{1600}$/` (DALOS Genesis length). Separately,
        `await smartDecrypt(result.snapshot.kadenaSeeds[0].wordsSecret!, "<redacted-rotated-credential>")`
        equals the exact words string that was decrypted from the
        ORIGINAL `secret` ciphertext at the start of the test (captured via
        a direct `smartDecrypt` call on the raw extracted ciphertext before
        running the engine, so the test proves no data was lost, not just
        that SOME wordsSecret exists).
      - The identical test, run against
        `/home/ancientbox/ClaudeWS/Miscellaneous/_Codices/Foreign/Iounut-Latests_OuronetCodex_2026-10-11_13-22-23.json`
        with the same password, passes the same two assertions.
      - A test builds a snapshot whose single `kadenaSeeds[0]` entry
        (`seedType: "stoic"`) already has `secret` encrypted from a real
        1600-char `"0"`/`"1"` bitstring (already-current shape) and asserts:
        `fixedSeedIds` is `[]`, `skipped` is `[]`,
        `result.snapshot.kadenaSeeds[0].secret` decrypts to the EXACT SAME
        bitstring as before (byte-for-byte, i.e. genuinely untouched — not
        just "still valid"), and `result.snapshot.Codex_Shape_Version === "1.0.0"`.
      - A test builds a snapshot whose `kadenaSeeds[0]` (`seedType: "stoic"`)
        decrypts to garbage (e.g. encrypt the literal string `"not words or bits"`
        — not a valid bitstring, not valid DALOS words) and calls
        `runStructuralMigration` with NO `requestMissingData` option:
        `skipped` contains exactly one entry with
        `{ slice: "kadenaSeeds", id: "<that seed's id>" }`, and
        `result.snapshot.kadenaSeeds[0].secret` is byte-identical to the
        original ciphertext (never dropped/overwritten).
      - The identical garbage-plaintext case, but WITH a
        `requestMissingData` option supplied that resolves to a real,
        valid DALOS word string: `skipped` is `[]`, `fixedSeedIds` contains
        that seed's id, and the resulting `secret` decrypts to the
        bitstring derived from the SUPPLIED words (via
        `seedWordsToBitString` on the supplied string), not from the
        original garbage plaintext.
      - A test with an `arweaveSeeds[0]` entry (no `seedType` field at
        all — matches `IArweaveSeed`'s real shape) whose `secret` decrypts
        to valid DALOS words behaves identically to the `kadenaSeeds`
        words-case above (fixed, `wordsSecret` populated, `secret` becomes
        the derived bitstring).
      - A test with a `kadenaSeeds[0]` entry whose `seedType` is `"koala"`
        (a real mnemonic seed type) and whose `secret` decrypts to a BIP39
        mnemonic (NOT words-shaped per DALOS rules, NOT bitstring-shaped)
        is left completely untouched by the engine — not checked at all
        (since only `seedType === "stoic"` kadenaSeeds entries are walked),
        confirmed by `fixedSeedIds: []`, `skipped: []`, and the entry's
        `secret` byte-identical to its input.
      - A test asserts purity: calling `runStructuralMigration(snap, pw)`
        does not mutate `snap` — `expect(snap).toEqual(structuredClone-of-snap-taken-before-the-call)`,
        mirroring `rekey.test.ts`'s own existing purity assertion style.
      - `npx vitest run tests/structural-migration.test.ts` passes (all
        cases above) and `npx tsc --noEmit` is clean.
      - files: `packages/codex-ouronet/src/structural-migration/index.ts`,
        `packages/codex-ouronet/src/errors/types.ts`,
        `packages/codex-ouronet/src/errors/index.ts`,
        `packages/codex-ouronet/vitest.config.ts`,
        `packages/codex-ouronet/package.json`,
        `packages/codex-ouronet/tests/structural-migration.test.ts`

- [x] T2: Fix `KeyFieldsHalves.tsx`'s 4 blind catch sites (lines 114-115,
      121-122, 131-132, 141-142 in the current file) so a genuinely-locked
      codex still shows "Unlock the codex to view/copy the private key."
      but any OTHER thrown error shows its own real message instead. Both
      of this component's real callers (`SeedWordsTab.tsx`'s
      `revealPrivateKey`, `PureKeypairsTab.tsx`'s `decryptFor`) already
      throw exactly `new Error("locked")` for the lock case (confirmed —
      neither throws any other sentinel for that case) — use that as the
      discriminator, not a new error type. Add one internal helper near the
      top of the component body (not exported):
      ```ts
      function describeKeyError(err: unknown, action: "view" | "copy"): string {
        if (err instanceof Error && err.message === "locked") {
          return `Unlock the codex to ${action} the private key.`;
        }
        const detail = err instanceof Error ? err.message : String(err);
        return `Could not ${action} the private key: ${detail}`;
      }
      ```
      Replace each of the 4 `catch { setErr("Unlock the codex to view/copy the private key."); }`
      bodies with `catch (err) { setErr(describeKeyError(err, "view" | "copy")); }`
      (using "view" for the two show/reveal sites — `toggleShow`,
      `toggleSwitch` — and "copy" for the two copy sites — `copyPriv`,
      `copyCurrentMobile`), preserving every other existing statement in
      each catch block (e.g. `toggleSwitch`'s catch also has `return;`
      after setting the error — keep it).
      done when:
      - A new test file renders `<KeyFieldsHalves>` with a `decryptPrivate`
        prop that rejects with `new Error("locked")`; clicking the
        show/reveal control renders the text "Unlock the codex to view the
        private key." (existing behavior, unchanged).
      - The same component rendered with a `decryptPrivate` prop that
        rejects with `new Error("seed bitstring must be exactly 1024 or 1600 characters")`
        renders the text "Could not view the private key: seed bitstring
        must be exactly 1024 or 1600 characters." (NOT the "Unlock the
        codex..." text) after clicking the show/reveal control.
      - The same two cases repeated for the copy action (clicking the copy
        control) produce "Unlock the codex to copy the private key." for
        the locked case and "Could not copy the private key: <message>"
        for any other thrown error.
      - `npx vitest run tests/ui-key-fields-halves.test.tsx` passes and
        `npx tsc --noEmit` is clean.
      - files: `packages/codex-ouronet/src/ui/internal/KeyFieldsHalves.tsx`,
        `packages/codex-ouronet/tests/ui-key-fields-halves.test.tsx` (new)

- [x] T3: Fix `SeedWordsTab.tsx`'s remaining 2 mislabeled-error sites.
      (a) `copyCurrentKey`'s catch at line 606
      (`catch { setRowError("Unlock the codex to copy the private key."); return; }`,
      wrapping a direct call to `revealPrivateKey(selectedAccount)()`,
      which — like `KeyFieldsHalves.tsx`'s callers — throws exactly
      `new Error("locked")` for the lock case): change to
      `catch (err) { setRowError(err instanceof Error && err.message === "locked" ? "Unlock the codex to copy the private key." : \`Could not copy the private key: ${err instanceof Error ? err.message : String(err)}\`); return; }`.
      (b) `handleView`'s catch at lines 649-651
      (`catch { setRowError("Unlock the codex to view this seed phrase."); }`,
      wrapping `smartDecrypt(seed.secret, getCurrentPassword())` at line
      629): this one is DIFFERENT — `ensureUnlocked()` is already checked
      and confirmed `true` at line 627, several lines before this try
      block, so ANY error reaching this specific catch is structurally
      guaranteed NOT to be a lock issue. Change the message unconditionally
      (no instanceof check needed here) to
      `catch (err) { setRowError(\`Could not decrypt this seed phrase: ${err instanceof Error ? err.message : String(err)}\`); }`.
      Leave the inner try/catch at lines 641-645 (the `wordsSecret`
      decrypt, already-intentional silent fallback) completely untouched —
      not part of this bug.
      done when:
      - In `tests/ui-seed-words-tab.test.tsx`, a new test confirms that
        when the private-key copy action's underlying decrypt/derive call
        rejects with `new Error("locked")`, the row shows "Unlock the codex
        to copy the private key." (existing behavior, unchanged).
      - A new test confirms that when that same call rejects with a
        DIFFERENT error (e.g. `new Error("seed bitstring must be exactly 1024 or 1600 characters")`),
        the row shows "Could not copy the private key: seed bitstring must
        be exactly 1024 or 1600 characters." — not the locked message.
      - A new test confirms that when `handleView`'s `smartDecrypt(seed.secret, ...)`
        call rejects (any reason, e.g. corrupt ciphertext), after
        `ensureUnlocked` has already resolved `true`, the row shows "Could
        not decrypt this seed phrase: <the real error message>" — not
        "Unlock the codex to view this seed phrase."
      - All pre-existing tests in `tests/ui-seed-words-tab.test.tsx` that
        assert the ORIGINAL "Unlock the codex to view this seed phrase."
        message for an actually-locked codex (i.e. `ensureUnlocked()`
        resolves `false`) still pass unmodified — that path (line 627) is
        untouched by this task.
      - `npx vitest run tests/ui-seed-words-tab.test.tsx` passes and
        `npx tsc --noEmit` is clean.
      - files: `packages/codex-ouronet/src/ui/tabs/SeedWordsTab.tsx`,
        `packages/codex-ouronet/tests/ui-seed-words-tab.test.tsx`
