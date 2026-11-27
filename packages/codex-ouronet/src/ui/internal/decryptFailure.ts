/**
 * Classifying a decrypt failure into something a user can act on
 * (docs/work/honest-failure-reporting/design.md §5, acceptance criterion 7).
 *
 * `SeedWordsTab`'s reveal catch used to print `err.message` verbatim, so the
 * owner read `AES-GCM auth-tag failure` — a crypto primitive's internal
 * string — and had to decode it himself over a long exchange. Five failures
 * that demand five DIFFERENT responses all rendered as that one opaque line:
 *
 *   `WrongPasswordError`      → retry with another password; the bytes are fine
 *   `CorruptEnvelopeError`    → stop retrying, no password opens this
 *   `UnsupportedFormatError`  → the build is behind, the data is not damaged
 *   a dynamic-import failure  → nothing was decrypted at all; reload
 *   `CodexLockedError`        → unlock and retry; nothing is wrong with the seed
 *
 * The first three are typed classes exported by `@stoachain/stoa-core/crypto`,
 * so they are matched by `instanceof` — never by parsing their messages, which
 * is exactly the coupling that produced the defect.
 *
 * ## Why this is a shared module rather than a method on either surface
 *
 * `LegacyPrimeMigrationWizard.tsx` ~`:1367` already carries a local
 * `classifyDecryptError` over the same three classes, and `SeedWordsTab` did
 * not reuse it (§5). This module is the lifted LOGIC, parameterized by
 * `subject` so each caller names its own thing — "This seed phrase" versus
 * "This account's secret" — with one taxonomy behind both. It sits in
 * `ui/internal/` beside the package's other pure, test-first UI helpers
 * (`keySource.ts`, `seedNames.ts`, `migrationResume.ts`, `seedDashboard.ts`)
 * because both consumers are UI surfaces under `src/ui/`, and it is
 * deliberately NOT re-exported from the `./ui` barrel (whose inventory is
 * locked by `ui-surface-stability.test.ts`) — it is an internal helper, not
 * public surface.
 *
 * ## What it refuses to claim
 *
 * `WrongPasswordError` means the KDF produced a key and the AES-GCM
 * authentication tag did not verify. That is consistent with a typo AND with
 * a blob genuinely encrypted under a different password (the owner's second
 * codex: the codex unlocks, private keys reveal, and BOTH seeds fail the auth
 * tag — intact bytes, wrong key). We cannot tell those apart from here, so
 * the wording commits only to what is knowable: the password that opened the
 * codex is not the password this blob was encrypted with, and the data is
 * intact. The library's own doc notes a truncated ciphertext can also land
 * here; "the data is intact" is about this failure not DAMAGING anything —
 * it is a key mismatch, not a destructive event.
 */

import {
  WrongPasswordError,
  CorruptEnvelopeError,
  UnsupportedFormatError,
} from "@stoachain/stoa-core/crypto";

import { CodexLockedError } from "../../errors/index.js";

/**
 * Which of the five failure modes occurred. Callers branch on this when the
 * treatment differs beyond the sentence (e.g. offering an unlock control for
 * `"locked"`); `message` alone is enough to render honestly.
 */
export type DecryptFailureKind =
  | "wrong-password"
  | "corrupt-envelope"
  | "unsupported-format"
  | "locked"
  | "infrastructure"
  | "unknown";

export interface DecryptFailure {
  kind: DecryptFailureKind;
  /** A complete, user-facing sentence. Render verbatim — do NOT prefix it
   *  with "Could not decrypt …": `"locked"` and `"infrastructure"` are not
   *  decryption failures at all, and saying they are is the §5 defect in a
   *  new costume. */
  message: string;
}

/**
 * Did the module loader fail, rather than the crypto?
 *
 * `smartDecrypt` reaches its V1 branch via `await import("./v1")`, so a
 * loader failure surfaces from the same `try` as a real decrypt failure —
 * while meaning something categorically different: no decrypt was ever
 * attempted. There is no typed class for this (the loader throws a plain
 * `TypeError` in browsers and an `ERR_MODULE_NOT_FOUND` `Error` in Node), so
 * this is the one match that must go by shape. It is kept narrow —
 * `code === "ERR_MODULE_NOT_FOUND"` plus the two loader-owned message forms —
 * so a crypto error can never fall through here; anything unrecognized lands
 * in `"unknown"`, which keeps its message.
 */
function isModuleLoadFailure(err: Error): boolean {
  if ((err as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND") return true;
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|cannot find module/i
    .test(err.message);
}

/**
 * Turn a caught `unknown` into a typed reason plus a sentence worth showing.
 *
 * @param err     whatever the decrypt path threw.
 * @param subject a capitalized, sentence-leading noun phrase naming what
 *                failed to decrypt — "This seed phrase", "This account's
 *                secret". Only ever used at the start of a sentence, so
 *                callers never have to think about casing.
 */
export function classifyDecryptFailure(err: unknown, subject: string): DecryptFailure {
  if (err instanceof WrongPasswordError) {
    return {
      kind: "wrong-password",
      message:
        `${subject} was encrypted with a different password than the one this ` +
        `codex is unlocked with. The data is intact — it needs the password it ` +
        `was encrypted with.`,
    };
  }
  if (err instanceof CorruptEnvelopeError) {
    return {
      kind: "corrupt-envelope",
      message: `${subject} is not readable as an encrypted envelope — no password will open it.`,
    };
  }
  if (err instanceof UnsupportedFormatError) {
    return {
      kind: "unsupported-format",
      message: `${subject} uses an encryption format this build does not support.`,
    };
  }
  // A lock between the unlock check and `getCurrentPassword()` — the seed is
  // untouched, so this must not read as a failure OF the seed.
  if (err instanceof CodexLockedError) {
    return {
      kind: "locked",
      message: "The codex locked before this could be decrypted. Unlock it and try again.",
    };
  }
  if (err instanceof Error && isModuleLoadFailure(err)) {
    return {
      kind: "infrastructure",
      message:
        "The decryption module could not be loaded, so nothing was decrypted. " +
        "This is a loading failure, not a problem with your data — reload and try again.",
    };
  }
  // Last resort. Unrecognized does NOT mean undiagnosable: the underlying
  // message is kept rather than flattened into a generic line (the mistake
  // §4 documents in `rebuildFullKey`), it is just labelled as unclassified.
  return {
    kind: "unknown",
    message: `${subject} could not be decrypted: ${err instanceof Error ? err.message : String(err)}`,
  };
}
