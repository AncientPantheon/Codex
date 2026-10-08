/**
 * Backup-upload secret-field re-encryption — the SANCTIONED seam for
 * swapping EVERY individual secret-ciphertext field inside a codex export
 * from one encryption key to another, without ever hand-parsing the export's
 * JSON shape.
 *
 * `codex-backup-envelope-encryption` T2: a whole-codex backup upload needs to
 * decrypt each secret field (today ciphertext under the user's local
 * password) and re-encrypt it under a per-upload DEK, before the whole
 * export is encrypted again as one opaque blob. `IMPORT_EXPORT_CONTRACT.md`
 * §1 forbids hand-parsing the export JSON against an invented idea of the
 * schema — exactly the shape of operation this module performs, which is
 * why it lives INSIDE codex-core (the codec's own package) instead of in a
 * consumer like `codex-arweave`/`arweave-core`.
 *
 * WHY THIS IS EXEMPT FROM THE "MUST NOT hand-parse" RULE: it is not a second
 * parser. The entire parse/validate step is `deserializeCodex` itself — the
 * real reader, enforcing the real version gate, the real unknown-top-level-
 * field rejection, and the real per-entry shape validation
 * (`IMPORT_EXPORT_CONTRACT.md` §3/§4). This function only walks the field
 * paths `deserializeCodex`'s own return type already proves exist:
 * `arweaveSeeds[].secret`, `foreignKeys.keys[].encryptedKeyfile`, and
 * `pureKeypairs[].encryptedPrivateKey` — EXACTLY the three secret-ciphertext
 * fields `IMPORT_EXPORT_CONTRACT.md` §2 documents, never a fourth, never
 * fewer. If a new secret field is ever added per §5's Extension protocol,
 * THIS function's own three-path list becomes part of that protocol too —
 * see `IMPORT_EXPORT_CONTRACT.md`'s "Backup-upload re-encryption" section.
 *
 * WHY THE WRITE SIDE DOES NOT CALL `buildCodexExport`/`serializeCodex`:
 * those functions build a FRESH export from a live, in-memory
 * `PlaintextCodex` source — `buildCodexExport` always stamps a brand-new
 * `exportedAt` (`new Date().toISOString()`) and always re-wraps `foreignKeys`
 * under the CURRENT `FOREIGN_KEYS_BLOCK_SCHEMA_VERSION`, regardless of what
 * the source carried. Routing this function's output back through them would
 * silently change `exportedAt` and could silently bump an older
 * `foreignKeys.schemaVersion` — exactly the kind of "changed a field nobody
 * asked to change" bug `IMPORT_EXPORT_CONTRACT.md` exists to prevent. Because
 * this function only ever mutates the three known ciphertext LEAVES in place
 * (never adding, removing, or renaming a field), the already-`deserializeCodex`
 * -validated structure is safe to re-serialize directly with `JSON.stringify`
 * — every other field, including `version` and `exportedAt`, rides through
 * completely untouched. As a self-check (not a substitute for the caller's
 * own verification), this function re-runs the transformed JSON through
 * `deserializeCodex` once more before returning, so a shape bug in this file
 * itself fails loudly here rather than at restore time.
 *
 * CONTRACT:
 *   - Exactly the three fields above are ever read or written. Order does
 *     NOT matter — each field is independent of the other two; this
 *     implementation processes `arweaveSeeds`, then `foreignKeys.keys`, then
 *     `pureKeypairs`, but a caller must not rely on that order.
 *   - `opts.decryptField` is called on a field's existing ciphertext, then
 *     `opts.encryptField` is called on the PLAINTEXT `decryptField` returned
 *     — never on the original ciphertext directly. Each is called EXACTLY
 *     once per secret field actually present in the input.
 *   - A "1.2" envelope (which predates all three fields — they do not exist
 *     on that shape) is returned completely unchanged, string-identical:
 *     `deserializeCodex` still validates it, but there is nothing to
 *     transform.
 *   - A "1.3" envelope that omits one or more of the three keyrings
 *     entirely (a valid, documented state — `IMPORT_EXPORT_CONTRACT.md` §2's
 *     "Omitted when" column) is handled with zero callback calls for the
 *     omitted keyring and no error.
 *   - NOT IDEMPOTENT. Calling this function twice with the same `opts`
 *     double-transforms: the second call's `decryptField` receives the
 *     FIRST call's `encryptField` output, not the original ciphertext, and
 *     will typically fail (or silently produce garbage) unless the caller's
 *     `decryptField` genuinely understands that shape. Callers call this
 *     exactly once per backup-upload operation, by design.
 */

import { deserializeCodex } from "./codec.js";
import type { ArweaveSeedEntry, CodexExportV1_3 } from "./types.js";
import type { ForeignKeyEntry, ForeignKeysBlock } from "./foreignKeys.js";
import type { PureKeypairEntry } from "./pureKeypairs.js";

export type ReencryptBackupSecretFieldsOptions = {
  /** Decrypts one secret field's existing ciphertext back to plaintext. */
  decryptField: (ciphertext: string) => Promise<string>;
  /** Encrypts a secret field's plaintext (`decryptField`'s own output)
   *  under the new key. */
  encryptField: (plaintext: string) => Promise<string>;
};

async function reencryptArweaveSeeds(
  entries: ArweaveSeedEntry[] | undefined,
  opts: ReencryptBackupSecretFieldsOptions,
): Promise<ArweaveSeedEntry[] | undefined> {
  if (entries === undefined) return undefined;
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      secret: await opts.encryptField(await opts.decryptField(entry.secret)),
    })),
  );
}

async function reencryptForeignKeys(
  block: ForeignKeysBlock | undefined,
  opts: ReencryptBackupSecretFieldsOptions,
): Promise<ForeignKeysBlock | undefined> {
  if (block === undefined) return undefined;
  const keys: ForeignKeyEntry[] = await Promise.all(
    block.keys.map(async (entry) => ({
      ...entry,
      encryptedKeyfile: await opts.encryptField(await opts.decryptField(entry.encryptedKeyfile)),
    })),
  );
  return { ...block, keys };
}

async function reencryptPureKeypairs(
  entries: PureKeypairEntry[] | undefined,
  opts: ReencryptBackupSecretFieldsOptions,
): Promise<PureKeypairEntry[] | undefined> {
  if (entries === undefined) return undefined;
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      encryptedPrivateKey: await opts.encryptField(await opts.decryptField(entry.encryptedPrivateKey)),
    })),
  );
}

/**
 * Re-encrypts every individual secret-ciphertext field inside a codex export
 * — `arweaveSeeds[].secret`, `foreignKeys.keys[].encryptedKeyfile`,
 * `pureKeypairs[].encryptedPrivateKey` — from whatever key `opts.decryptField`
 * understands to whatever key `opts.encryptField` produces. See this module's
 * own doc comment for the full contract (exemption rationale, field-path
 * list, ordering, idempotency).
 */
export async function reencryptBackupSecretFields(
  exportJson: string,
  opts: ReencryptBackupSecretFieldsOptions,
): Promise<string> {
  const parsed = deserializeCodex(exportJson);

  // "1.2" envelopes predate all three secret-field paths — nothing to do.
  if (parsed.version !== "1.3") {
    return exportJson;
  }

  const typed = parsed as CodexExportV1_3;

  const [arweaveSeeds, foreignKeys, pureKeypairs] = await Promise.all([
    reencryptArweaveSeeds(typed.arweaveSeeds, opts),
    reencryptForeignKeys(typed.foreignKeys, opts),
    reencryptPureKeypairs(typed.pureKeypairs, opts),
  ]);

  const next: CodexExportV1_3 = {
    ...typed,
    ...(arweaveSeeds !== undefined ? { arweaveSeeds } : {}),
    ...(foreignKeys !== undefined ? { foreignKeys } : {}),
    ...(pureKeypairs !== undefined ? { pureKeypairs } : {}),
  };

  const outputJson = JSON.stringify(next, null, 2);

  // Self-check: the transformed output must still be a codec-valid "1.3"
  // export. A shape bug here must fail loudly at the source, not silently
  // produce an unrestorable backup discovered only later.
  deserializeCodex(outputJson);

  return outputJson;
}
