/**
 * Pure-keypair wire model — the structural guard the codec applies to each
 * `pureKeypairs` entry riding a "1.3" export envelope.
 *
 * A pure keypair is a raw Pact `-g` keypair stored directly in the codex (NOT
 * derived from a seed). Its `encryptedPrivateKey` is ciphertext encrypted at the
 * codex password — the same "codec wraps ciphertext, never plaintext" discipline
 * as a kadena seed's `secret` or a `foreignKeys` entry's `encryptedKeyfile`.
 *
 * WIRE-SHAPE DIVERGENCE (deliberate): unlike `foreignKeys` — which the writer
 * wraps into a `{ schemaVersion, keys }` block — `pureKeypairs` rides the
 * envelope as a BARE ARRAY. It was already a bare array in the old
 * `BackupFileV12Plus` hook format the `useCodexBackup` rewire replaces, and it
 * carries no per-block schema version, so wrapping it would break the historical
 * shape for no gain. The codec keeps the entries pass-through verbatim.
 *
 * At-rest secrecy: `encryptedPrivateKey` is ALWAYS ciphertext — it must NEVER be
 * logged, transmitted in cleartext, or echoed in an error message; it is the
 * only copy of the user's pure-key material inside the backup.
 */

/**
 * The wire shape of one pure keypair inside a "1.3" export envelope — the
 * required core fields of the consumer's `IPureKeypair` (marker flags and other
 * additive-optional fields ride through UNCHANGED and are NOT re-validated here;
 * the codec cares only about the load-bearing core).
 */
export type PureKeypairEntry = {
  /** Stable identifier for this keypair (addresses it on restore). */
  id: string;
  /** Optional human label; a labelless entry is valid. */
  label?: string;
  /** Public half (hex). */
  publicKey: string;
  /** Encrypted private half — ciphertext at rest. NEVER plaintext; NEVER logged
   *  or echoed in an error message. */
  encryptedPrivateKey: string;
  /** ISO timestamp the keypair was created. */
  createdAt: string;
};

/**
 * Structural guard for a single pure-keypair entry — validates SHAPE, never
 * decrypts. Mirrors the precision of `isForeignKeyEntry`: the load-bearing core
 * fields (`id`, `publicKey`, `encryptedPrivateKey`, `createdAt`) must be strings;
 * `label` is accepted when absent but rejected when present with a non-string
 * type. Additive marker flags on the consumer's `IPureKeypair` are NOT inspected
 * (they ride through the codec untouched).
 */
export function isPureKeypairEntry(x: unknown): x is PureKeypairEntry {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const entry = x as Record<string, unknown>;
  if (typeof entry.id !== "string") return false;
  if (typeof entry.publicKey !== "string") return false;
  if (typeof entry.encryptedPrivateKey !== "string") return false;
  if (typeof entry.createdAt !== "string") return false;
  if ("label" in entry && entry.label !== undefined && typeof entry.label !== "string") {
    return false;
  }
  return true;
}
