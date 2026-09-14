/**
 * Self-contained foreign-key keyring model.
 *
 * A foreign key is cryptographic material for a NON-StoaChain chain (e.g. an
 * Arweave JWK) that rides inside a codex backup. Every entry is RESTORE-
 * INDEPENDENT: each `encryptedKeyfile` is a self-contained, INDEPENDENTLY-
 * encrypted blob, so restoring one entry never depends on any other and no
 * seed is ever needed to read one back.
 *
 * The OPTIONAL `seedId`/`index` pair below is PROVENANCE, not a derivation
 * dependency: an Arweave key IS derived from a 1600-bit seed, and the Accounts
 * view groups keys by the seed that produced them, but the stored blob remains
 * the whole key — the seed is never required to restore it. No seed material
 * ever appears in this shape.
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
 * (`IPureKeypair.label?` / `IStoaChainSeed.name?`), so a key generated without a
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
  /** OPTIONAL seed provenance — the Arweave seed this key was derived from.
   *  Absent on every entry written before seed provenance existed. */
  seedId?: string;
  /** OPTIONAL position within THAT seed's OWN index space (`#0` is per-seed,
   *  never global), so `(seedId, index)` addresses the key. A non-negative
   *  integer; meaningless — and rejected — without a `seedId`. */
  index?: number;
  /** OPTIONAL plaintext Arweave address, so a list renders without decrypting
   *  `encryptedKeyfile`. Public material only — never secret. */
  address?: string;
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
 *
 * BOTH shapes are valid, deliberately:
 *   - LEGACY — an entry with NONE of the seed-provenance fields. Every codex
 *     exported before provenance existed looks like this; rejecting one would
 *     make an old backup unrestorable, so it stays valid forever.
 *   - SEEDED — an entry carrying provenance. Because `index` is a position in
 *     one seed's OWN index space, an `index` is only meaningful alongside the
 *     `seedId` that names that space: a present `index` must be a NON-NEGATIVE
 *     INTEGER and `seedId` a NON-EMPTY string. An orphan index is refused
 *     rather than guessed at, since a key placed under the wrong seed collides
 *     with whatever already holds that position.
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
  if (entry.seedId !== undefined && (typeof entry.seedId !== "string" || entry.seedId === "")) {
    return false;
  }
  if (entry.address !== undefined && typeof entry.address !== "string") return false;
  if (entry.index !== undefined) {
    if (typeof entry.index !== "number" || !Number.isInteger(entry.index) || entry.index < 0) {
      return false;
    }
    if (typeof entry.seedId !== "string") return false;
  }
  return true;
}
