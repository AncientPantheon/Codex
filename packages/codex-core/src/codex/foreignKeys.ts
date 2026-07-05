/**
 * Seedless foreign-key keyring model.
 *
 * A foreign key is cryptographic material for a NON-Kadena chain (e.g. an
 * Arweave JWK) that rides inside a codex backup. This model is SEEDLESS BY
 * CONSTRUCTION: there is NO shared seed and NO derivation field anywhere in
 * the shape. Each entry's `encryptedKeyfile` is a self-contained,
 * INDEPENDENTLY-encrypted blob — the keyring is a flat list of unrelated
 * ciphertexts, never a set of keys derived from one root. Restoring one entry
 * never depends on any other.
 *
 * At-rest secrecy: `encryptedKeyfile` is ALWAYS ciphertext — the same
 * "codec wraps ciphertext, never plaintext" discipline as a kadena seed's
 * `secret`. It must NEVER be logged, transmitted in cleartext, or echoed in
 * an error message; it is the only copy of the user's foreign-chain key
 * material inside the backup.
 *
 * Version layering (three independent counters — do NOT conflate):
 *   - the on-disk export wire `version` ("1.2" / "1.3") — the envelope format;
 *   - `PlaintextCodex.schemaVersion` — the AT-REST ENCRYPTION schema of the
 *     secret blobs (device-local, does not travel in the export);
 *   - `ForeignKeysBlock.schemaVersion` (below) — the INTRA-BLOCK version of
 *     this keyring block alone, independent of both of the above.
 *
 * POPULATION of `encryptedKeyfile` from a real Arweave JWK (arweave-core
 * keygen encrypted under the existing at-rest crypto) is a later phase; this
 * module defines the SHAPE and its structural guard only — it never decrypts.
 *
 * Naming: bare `ForeignKeyEntry` / `ForeignKeysBlock` (no `I`-prefix). This is
 * a fresh package with no prior interface-naming precedent; the bare style is
 * a deliberate divergence from the sibling `codex-ouronet` package's
 * `I`-prefixed crypto-material entities.
 */

/**
 * One foreign-chain key in the seedless keyring.
 *
 * `label` is OPTIONAL — matching the established keyring-entity convention
 * (`IPureKeypair.label?` / `IKadenaSeed.name?`), so a key generated without a
 * human-supplied name (E1's Arweave keygen) is a VALID entry, not a rejected
 * one. `encryptedKeyfile` is ciphertext at rest (see module JSDoc).
 */
export type ForeignKeyEntry = {
  /** Stable identifier for this keyring entry (addresses it on restore). */
  id: string;
  /** Optional human label; a labelless entry is valid. */
  label?: string;
  /** Chain the key belongs to (e.g. `"arweave:mainnet"`). Kept generic — not
   *  Arweave-specific — so other foreign chains reuse the same entry shape. */
  chainId: string;
  /** Already-encrypted keyfile ciphertext. NEVER plaintext; NEVER logged or
   *  transmitted in cleartext; NEVER echoed in an error message. */
  encryptedKeyfile: string;
};

/**
 * The keyring block as it travels inside a "1.3" export envelope.
 *
 * `schemaVersion` is the INTRA-BLOCK version of this block only — independent
 * of the wire `version` and of `PlaintextCodex.schemaVersion` (see module
 * JSDoc). The in-memory SOURCE on `PlaintextCodex` is a bare
 * `ForeignKeyEntry[]`; the writer wraps it into this block on emit.
 */
export type ForeignKeysBlock = {
  schemaVersion: number;
  keys: ForeignKeyEntry[];
};

/**
 * Structural guard for a single keyring entry — validates SHAPE, never
 * decrypts. Used by the codec's deserialize path to fail closed on a
 * malformed entry before it reaches a restore. `label` is accepted when
 * absent (optional) but rejected when present with a non-string type.
 */
export function isForeignKeyEntry(x: unknown): x is ForeignKeyEntry {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const entry = x as Record<string, unknown>;
  if (typeof entry.id !== "string") return false;
  if (typeof entry.chainId !== "string") return false;
  if (typeof entry.encryptedKeyfile !== "string") return false;
  if ("label" in entry && entry.label !== undefined && typeof entry.label !== "string") {
    return false;
  }
  return true;
}
