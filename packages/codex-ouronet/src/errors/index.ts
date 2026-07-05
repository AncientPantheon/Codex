// @ancientpantheon/codex-ouronet/errors
//
// Typed error classes. See ./types.ts for the per-class docs.
//
// All extend the base CodexError so `e instanceof CodexError` is the
// catch-all discriminator. Each subclass adds structured fields relevant
// to its failure mode (e.g. CodexKeyMissingError carries publicKey +
// pureKeypairCount + derivedAccountCount).

export {
  CodexError,
  CodexLockedError,
  CodexKeyMissingError,
  CodexPrimeProtectedError,
  CodexPrimeSeedProtectedError,
  CodexKickstartError,
  CodexAdapterError,
  CodexPasswordError,
  CodexMigrationError,
  CodexConsumerSettingsError,
  CodexIdentityError,
  CodexGuardError,
} from "./types.js";

// `CodexImportError` is thrown by the backup hook, which moved to codex-ui in
// the D5 carve (codex-ui owns the throw site; it cannot value-import Ouronet's
// error class — a forbidden reverse edge). Re-export codex-ui's canonical class
// so a consumer catching `CodexImportError` from this barrel still
// `instanceof`-matches the class the hook actually throws (N-04 byte-stable).
export { CodexImportError } from "@ancientpantheon/codex-ui";

