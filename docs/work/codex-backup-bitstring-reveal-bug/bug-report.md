# Bug report: real codex backup fails — "seed bitstring must be exactly 1024/1600 characters"

## Discovered by

A real-browser verification while wiring the Codex ID page's "Back up this
codex" button (2026-10-08) — found while confirming the now-complete
`codex-backup-envelope-encryption` engine actually works end-to-end
through the real app, not just at the unit-test level (where every test
injects a fake, pre-formed, correctly-sized bitstring directly — never
exercising the real reveal chain).

## Symptom

Clicking "Back up codex to Arweave" (either the new Codex ID page mount
or the pre-existing Library-tab mount — BOTH reproduce the identical
error, confirmed directly, so this is not specific to either UI) reaches
real network calls (a price quote against the gateway succeeds), then
fails with:

```
generateFromBitStringAtRangesAsync: failed at index 0 (0 of 1 completed
before this): seed bitstring must be exactly 1024 (APOLLO) or 1600 (DALOS
Genesis) characters
```

## What this means

Somewhere in the real chain — kickstart a codex → reveal the Prime
Arweave seed's bitstring (`revealArweaveSeedSecret`) and/or the Codex
Identity's Standard-half bitstring (`createRevealStandardApolloBitstring`,
built in the host-adapter compile-break fix earlier this session) →
derive an RSA-4096 keypair at a PIN/default position from that bitstring
— the bitstring actually being handed to
`generateFromBitStringAtRangesAsync` is NOT exactly 1024 or 1600
characters. Either the decrypt step is producing a malformed/wrong-length
string, or the wrong field is being read, or the stored ciphertext itself
encodes something other than the raw `"0"`/`"1"` bitstring these
functions expect.

## What's already confirmed (don't re-litigate, start the investigation
from here)

- **Not caused by the Codex ID page wiring task** — reproduced byte-
  identically by clicking the PRE-EXISTING Library-tab `CodexBackupArea`
  mount, in the same session, same codex. This is a real, standalone,
  pre-existing bug in the reveal/derive chain itself.
- **No existing test exercises this real integration path.**
  `apps/codex-playground/tests/codex-backup-wiring.test.ts` and
  `real-arweave-adapter-panel-deps.test.ts` both inject a fake, already-
  correctly-sized 1600-char bitstring directly — neither test ever drives
  a real kickstart → real encrypt → real reveal/decrypt → real derive
  round trip. This bug has likely existed since whichever task built the
  reveal chain, invisible to the test suite by construction.
- **Reproduction recipe** (used once already, can be rebuilt): fresh
  codex via "Create a new Codex" with default seed words (`fresh-dalos`
  kickstart — eligible by construction, auto-installs a Prime Arweave
  Seed sharing origin words with the new Prime Ouronet account) → Settings
  → Network → point the Arweave gateway URL at a local throwaway fake
  gateway (a minimal `http.createServer` answering `GET /tx_anchor`,
  `GET /price/:byteSize`, `POST /tx` with CORS headers — the only 3
  endpoints a single-chunk upload needs) → Blockchain Accounts → Arweave
  → Seeds → generate the Prime Arweave Seed's key #0 → Codex ID (or
  Library) tab → click the backup button → confirm the permanence dialog
  → observe the error.

## Where to start looking (not a diagnosis — a starting point)

- `apps/codex-playground/src/ForeignChainsWiring.tsx` — `
  createRevealArweaveSeedSecret`/`createRevealStandardApolloBitstring`
  (the latter built in a recent session task) — confirm exactly what
  ciphertext field each decrypts and what the decrypted plaintext is
  actually expected to look like at each step.
- How a Prime Arweave seed's `secret` field is actually encrypted at
  kickstart time (`apps/codex-playground/src/kickstartPrimeArweaveSeed.ts`)
  vs. how it's decrypted on reveal — confirm the SAME transform is
  inverted correctly (e.g. is there an encoding step — base64, JSON
  wrapping, a words↔bitstring conversion — on one side that isn't
  correctly mirrored on the other?).
- `ICodexIdentity.encryptedStandardBitstring`'s real stored shape
  (`packages/codex-ouronet/src/codex-identity/encryption.ts`) vs. how
  `createRevealStandardApolloBitstring` decrypts and hands it off.
- `generateFromBitStringAtRangesAsync`'s own real input validation (confirm
  exactly what "exactly 1024 or 1600 characters" is checking against —
  is it checking character COUNT of a `"0"`/`"1"` string, or something
  that could be confused by e.g. the string still being JSON-wrapped, or
  double-encoded, or truncated by an encoding round-trip).

## Severity

This blocks the entire codex-backup-to-Arweave feature from working for
a real user, in both its old (pre-this-session) and new UI surfaces. The
underlying envelope-encryption engine (`backupCodexToLibrary` et al.) is
itself correct and fully tested — this bug is specifically in the
bitstring-reveal step that feeds it, upstream of the part this session
built.
