# Arweave Tag Schema — Versioning & Spec — Design

Sibling topic to `arweave-upload-library`. Closes a real gap found during
owner review: `Codex-Tag-Schema-Version` versions *which tags exist*, but
nothing versions *the procedure that produced a tag's value* — specifically
the encryption scheme. Since Arweave data is permanent, this has to be
right before more real uploads exist under the current (unversioned)
encryption procedure.

## Problem

If the encryption scheme in `fileEncryption.ts` (PBKDF2-SHA512/600k,
AES-256-GCM, deterministic salt from the account's bitstring) ever needs to
change — a parameter bump, a byte-layout fix, a different cipher — nothing
on an already-posted upload says which scheme produced it. A future decrypt
path would have no way to know whether to run today's logic or some older
logic, and old data cannot be migrated to a new format after the fact.
Separately: the Review step's tag preview currently shows a different set
of rows depending on what was chosen (no `Codex-Encryptor` row at all for a
public upload, etc.) rather than a stable, always-the-same-shape layout —
and there's no single canonical reference, anywhere, of what every tag
means, in what order, by schema version.

## Approach

**A new tag, `Codex-Encryption-Version`**, present only on encrypted
uploads (same conditional-presence rule as `Codex-Encryptor` — both appear
together or not at all). Value `"1"` today, identifying the exact scheme
`fileEncryption.ts` implements right now. A future scheme change gets `"2"`
and its own decrypt path; version `"1"`'s decrypt logic is never removed,
specifically because real data may depend on it forever.

**A durable, versioned spec document** — `ARWEAVE_TAG_SCHEMA.md`, shipped
inside the published npm package exactly like `IMPORT_EXPORT_CONTRACT.md`
already is (same `files` array entry, same README pointer convention).
Contents: every tag this project has ever defined, in canonical order,
grouped by which `Codex-Tag-Schema-Version` introduced it; for
`Codex-Encryption-Version` specifically, a per-version subsection recording
the exact algorithm, parameters, and byte layout — the thing a human (or a
future agent) reads *before* ever touching the encryption code again,
not a comment buried in one file.

**The preview UI gets a fixed, canonical row order.** Read from the same
spec doc's tag list — every possible Codex tag always rendered in the same
position, regardless of what was chosen. A tag that doesn't apply (e.g.
`Codex-Encryptor`/`Codex-Encryption-Version` on a public upload) still
shows its row, with "— does not apply (public upload)" instead of either a
value or silently vanishing. This is presentation-only — it changes nothing
about what actually gets posted on chain; a public upload still omits
these tags entirely, exactly as today.

**Audit the rebuild/parsing path directly**, not just assert it's fine —
confirm `queryOwnerUploads`/`queryUploadById`/`rebuild.ts`'s tag-reading
code genuinely tolerates an absent optional tag everywhere (never crashes,
never misinterprets absence), fixing any gap found rather than assuming the
existing discipline holds everywhere it needs to.

## Acceptance criteria

- [ ] Every encrypted upload carries `Codex-Encryption-Version: "1"`
      alongside `Codex-Encryptor`; a public upload carries neither.
- [ ] `ARWEAVE_TAG_SCHEMA.md` ships inside the published `codex` package,
      lists every tag this project has ever defined in canonical order, and
      documents version `1` of the encryption procedure in enough detail
      that it could be reimplemented from the document alone.
- [ ] The Review step's tag preview shows a fixed set of rows in a fixed
      order regardless of the upload's choices, with an explicit
      "does not apply" placeholder for inapplicable rows — never a row that
      appears or disappears based on what was picked.
- [ ] The rebuild/parsing path is confirmed (by direct code reading, not
      assumption) to handle every currently-optional tag's absence
      gracefully; any gap found is fixed as part of this topic.
- [ ] The full existing test suites for `arweave-core` and `codex-arweave`
      still pass; typecheck stays clean.

## Out of scope

- An actual second encryption scheme (version `"2"`) — this topic only
  builds the versioning machinery and documents version `1`; there is
  nothing to migrate to yet.
- Versioning the bundling/manifest procedure separately — already
  adequately covered by `Codex-Tag-Schema-Version` plus Arweave's own
  `Bundle-Format`/`Bundle-Version` tags; no second procedure-version axis
  needed there.
