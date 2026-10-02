# Codex Seed-Restore Activation — Design

A new topic under the `codex-seed-restore` project
(`docs/work/codex-seed-restore/design.md`), sitting between the now-built
`codex-recovery-backup-tagging` (the backend capability: a codex-backup
CAN carry an encrypted `Codex-Backup-Recovery-Key` tag, and a fresh
kickstart now auto-installs a Prime Arweave seed sharing origin words with
Prime Ouronet) and the not-yet-shaped `codex-seed-restore-flow` (the
actual "type your seed words to recover a lost codex" UI). This topic is
the missing middle: making the already-built mechanism actually fire in
the real app, and letting a user SEE whether it's active for them.

## Problem

Two real, confirmed-by-reading-the-code gaps, the same "dead letter"
pattern this project has hit and closed repeatedly (`onAccountUsedForEncryption`,
`getExportJson`, `onBackupSuccess`):

1. **The recovery-key tag never actually gets attached.** `backupCodexToLibrary`
   (`codex-arweave`) has accepted `codexPassword`/`primeArweaveSeedBitstring`/
   `cryptoSeam` since `codex-recovery-backup-tagging` T2 — but
   `apps/codex-playground/src/realArweaveAdapter.ts`'s real `backupCodex`
   call site (confirmed by direct read, ~line 528) passes NONE of them.
   Every real backup made through the running app today is still untagged
   — the restore mechanism is fully built and completely inert.
2. **No eligibility signal exists anywhere in the UI.** A user has no way
   to know whether their codex's Prime Arweave seed actually shares origin
   words with their Prime Ouronet account (true automatically for a codex
   created after this session's kickstart work; not necessarily true for
   an older codex, or one where the Prime Arweave seed was manually
   defined from different words before this feature existed).

## Approach

**The eligibility detector.** A new, pure function in `codex-arweave`,
`checkArweaveRestoreEligibility(params: { ouronetBitstring: string;
primeArweaveAddress: string; workerFactory: () => Worker }): Promise<boolean>`
— re-derives what the Prime Arweave seed's address WOULD be from the
Prime Ouronet account's bitstring (reusing the already-built
`deriveArweaveSeedAtPositionZero`) and compares it to the actual stored
Prime Arweave seed's address. Equal → eligible. This is the only reliable
check: `isPrime: true` alone is not proof of shared origin (a
pre-existing codex could have a manually-defined Prime Arweave seed from
unrelated words), but a matching re-derived address is. This re-derivation
is the same ~6.7s RSA-4096 keygen the kickstart path already pays, so the
UI must show real progress, never a silent freeze, and should not run on
every render — only on demand (e.g. a visible "check eligibility" status
area, cached for the session once computed).

**Making a real backup "activate" the restore point.** No separate
"activate" toggle is introduced — a toggle that could be left off serves
no one (there is no cost or downside to a backup being recovery-tagged
once the codex is genuinely eligible). Instead: `realArweaveAdapter.ts`'s
`backupCodex` is wired so that, whenever the eligibility check above
currently reads true, it also supplies `codexPassword` (sourced the same
way the rest of this call site already reaches the unlocked codex's
material) and `primeArweaveSeedBitstring` (decrypted via whichever
existing seam already reveals an Arweave seed's own plaintext bits on
demand — ground the exact one during planning; `ArweaveSeedsArea.tsx`'s
own "decrypt on demand" Chainweb-seed-words pattern and `ArweavePanelDeps`'s
existing `revealAccountSecret` seam are both real precedents to check
against, not guesses). When NOT eligible, `backupCodex` behaves exactly as
it does today — untagged, no error, no behavior change. The UI's
eligibility status area is therefore the complete, accurate "is this
restore point active" signal: true means the NEXT backup the user makes
will carry the recovery tag; false explains why (and — out of scope here,
belongs to `legacy-prime-migration` — what fixes it).

**Where the detector renders.** Alongside the existing Arweave Seeds area
(`ArweaveSeedsArea.tsx`) or the codex-backup area (`CodexBackupArea.tsx`)
— whichever already has access to both the Prime Ouronet account and
the Prime Arweave seed without new deps; ground the exact mount point
during planning.

## Acceptance criteria

- [ ] `checkArweaveRestoreEligibility` correctly reports true for a
      freshly kickstarted codex (Prime Arweave seed genuinely derived from
      the same words as Prime Ouronet) and false for a codex whose Prime
      Arweave seed was defined from unrelated words — verified against
      real derivation, not a stubbed comparison.
- [ ] The eligibility status is visible somewhere real in the Codex UI,
      with an honest in-progress state while the ~6.7s check runs — never
      a silent freeze.
- [ ] A real backup made through `apps/codex-playground` by an eligible
      codex carries a `Codex-Backup-Recovery-Key` tag that decrypts back
      to the exact codex password, end to end — not just type-compatible.
- [ ] A real backup made by a not-yet-eligible codex behaves exactly as
      today: no tag, no error, no behavior change.
- [ ] The full `codex-arweave`, `codex-ui`, `codex-ouronet`, and
      `codex-playground` test suites pass; `npx tsc -b`/each package's
      `typecheck` script stays clean.

## Out of scope

- The actual "type your seed words to recover a lost codex" restore UI —
  `codex-seed-restore-flow`, still unshaped.
- Making an ineligible codex eligible (aligning an existing Prime Arweave
  seed to Prime Ouronet's words, promoting a different account, starting
  fresh) — `legacy-prime-migration`, the user's explicitly next topic.
- Any change to `checkAccountEncryptedArweaveUploads`/
  `hasEncryptedArweaveUpload` (the separate, already-built
  non-removable-account invariant) — unrelated mechanism, not touched.
