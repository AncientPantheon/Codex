/**
 * Canonical codex serialization / deserialization — the shared codec between
 * every consumer that writes or reads the portable backup JSON (the wallet's
 * "Export Codex" flow, HUB's codex-import, CLI recovery tools).
 *
 * The written format is `CodexExportV1_3` (the `"version": "1.3"` string). This
 * was an INTENTIONAL 1.2→1.3 bump made under strict reader-before-writer
 * discipline: `deserializeCodex` accepts BOTH "1.2" and "1.3" (and allow-lists
 * the optional `foreignKeys` block) so every previously downloaded "1.2" backup
 * keeps importing and every new "1.3" export deserializes through the same
 * reader. Do NOT revert the writer to "1.2" in isolation and do NOT narrow the
 * reader back to "1.2"-only: emitting a version the reader rejects (or rejecting
 * the version the writer emits) is a funds-loss inversion — a user's own fresh
 * backup would fail to restore.
 *
 * All pure. No password handling here — the BYTES INSIDE the JSON are already
 * encrypted at the codex-entry level (each wallet's `secret` and each
 * `foreignKeys` entry's `encryptedKeyfile` is a ciphertext blob). Serializing
 * the codex never touches those blobs; it wraps them in the portable envelope.
 */

import type {
  CodexExportV1_2,
  CodexExportV1_3,
  PlaintextCodex,
} from "./types.js";
import { isForeignKeyEntry, type ForeignKeysBlock } from "./foreignKeys.js";
import { CodexError, CodexUnknownFieldError } from "./errors.js";

/**
 * Intra-block schema version the writer stamps onto every emitted
 * `foreignKeys` block. A codec-level constant: the in-memory source is a bare
 * `ForeignKeyEntry[]`, so a source that happened to carry its own
 * `schemaVersion` can never silently downgrade the stamped block version.
 */
const FOREIGN_KEYS_BLOCK_SCHEMA_VERSION = 1;

/**
 * Build a codex-export payload from a PlaintextCodex. Stamps the current
 * `"1.3"` envelope version and `exportedAt` with the current ISO time. Returns
 * the object — the caller stringifies it (so a memory-constrained caller can
 * stream it out instead of holding the whole string in RAM).
 *
 * The return type is the `CodexExportV1_2 | CodexExportV1_3` union so consumers
 * written against the historical 1.2 shape still type-check against the widened
 * output; the runtime value is always a 1.3 envelope.
 *
 * The `foreignKeys` block is EMITTED only when the source codex carries foreign
 * keys — the bare `ForeignKeyEntry[]` source is wrapped into
 * `{ schemaVersion, keys }` with the entries passed through UNCHANGED (the
 * writer wraps pre-encrypted blobs, exactly like `kadenaWallets[i].secret`; it
 * never encrypts). When the source has no foreign keys the property is OMITTED
 * entirely — no mandatory empty block.
 */
export function buildCodexExport<
  KS, OA, PK, AB, UI,
>(
  codex: PlaintextCodex<KS, OA, PK, AB, UI>,
): CodexExportV1_2<KS, OA, AB, UI> | CodexExportV1_3<KS, OA, AB, UI> {
  const base: CodexExportV1_3<KS, OA, AB, UI> = {
    version: "1.3",
    exportedAt: new Date().toISOString(),
    kadenaWallets: codex.kadenaWallets,
    ouronetWallets: codex.ouronetWallets,
    addressBook: codex.addressBook,
    uiSettings: codex.uiSettings,
  };
  if (codex.foreignKeys === undefined) {
    return base;
  }
  const foreignKeys: ForeignKeysBlock = {
    schemaVersion: FOREIGN_KEYS_BLOCK_SCHEMA_VERSION,
    keys: codex.foreignKeys,
  };
  return { ...base, foreignKeys };
}

/**
 * Stringify a PlaintextCodex into the `"1.3"` backup JSON format. Pretty-prints
 * with 2-space indent because the file lands on disk and a human occasionally
 * opens it to sanity-check account addresses.
 */
export function serializeCodex<
  KS, OA, PK, AB, UI,
>(
  codex: PlaintextCodex<KS, OA, PK, AB, UI>,
): string {
  return JSON.stringify(buildCodexExport(codex), null, 2);
}

const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "version",
  "exportedAt",
  "kadenaWallets",
  "ouronetWallets",
  "addressBook",
  "uiSettings",
  "foreignKeys",
]);

// Strict-equality membership only. No trim/normalize/prefix matching: a version
// string that merely LOOKS like an accepted one (" 1.3 ", "1.3.0", "1.3\n")
// must fail closed, so the reader never silently mis-decodes a format it does
// not actually understand.
const ACCEPTED_VERSIONS = new Set(["1.2", "1.3"]);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Structurally validate a present `foreignKeys` block — SHAPE only, never
 * decrypts. Throws a `CodexError` naming the offending PATH
 * (`foreignKeys.keys[0].encryptedKeyfile`) but never echoing any value, because
 * a malformed entry could carry the user's only copy of a foreign-chain key.
 */
function validateForeignKeysBlock(block: unknown): void {
  if (!isPlainObject(block)) {
    throw new CodexError("deserializeCodex: foreignKeys must be an object");
  }
  if (typeof block.schemaVersion !== "number") {
    throw new CodexError("deserializeCodex: foreignKeys.schemaVersion must be a number");
  }
  if (!Array.isArray(block.keys)) {
    throw new CodexError("deserializeCodex: foreignKeys.keys must be an array");
  }
  block.keys.forEach((entry, i) => {
    if (!isForeignKeyEntry(entry)) {
      throw new CodexError(
        `deserializeCodex: foreignKeys.keys[${i}] is not a valid foreign-key entry`,
      );
    }
  });
}

/**
 * Parse a codex-export JSON string. Does NOT decrypt any enclosed blobs — the
 * returned object's `kadenaWallets[i].secret` and `foreignKeys.keys[i].encryptedKeyfile`
 * are still ciphertext. Caller decrypts them with the codex password once the
 * parse validates.
 *
 * Throws on: invalid JSON, non-object payload, unsupported `version` (anything
 * but exact "1.2" / "1.3"), an unknown top-level field, a non-array collection,
 * a non-object `uiSettings`, or a malformed `foreignKeys` block. A "1.2" file
 * round-trips with `foreignKeys` ABSENT — no default is injected.
 *
 * Shape-validation errors NAME the offending field/path but never echo its
 * value — a codex envelope carries encrypted secrets and account addresses, and
 * surfacing those into telemetry/logs would breach the information-disclosure
 * boundary.
 */
export function deserializeCodex<
  KS = unknown,
  OA = unknown,
  AB = unknown,
  UI = unknown,
>(
  json: string,
): CodexExportV1_2<KS, OA, AB, UI> | CodexExportV1_3<KS, OA, AB, UI> {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") {
    throw new CodexError("deserializeCodex: not an object");
  }
  if (!ACCEPTED_VERSIONS.has(parsed.version)) {
    throw new CodexError(
      `deserializeCodex: unsupported version ${String(parsed.version)} — expected "1.2" or "1.3"`,
    );
  }
  const unknownFields = Object.keys(parsed).filter((k) => !KNOWN_TOP_LEVEL_FIELDS.has(k));
  if (unknownFields.length > 0) {
    throw new CodexUnknownFieldError(
      `Codex envelope contains unknown top-level field(s): ${unknownFields.join(", ")}`,
    );
  }
  if (!Array.isArray(parsed.kadenaWallets)) {
    throw new CodexError("deserializeCodex: kadenaWallets must be an array");
  }
  if (!Array.isArray(parsed.ouronetWallets)) {
    throw new CodexError("deserializeCodex: ouronetWallets must be an array");
  }
  if (!Array.isArray(parsed.addressBook)) {
    throw new CodexError("deserializeCodex: addressBook must be an array");
  }
  if (
    typeof parsed.uiSettings !== "object" ||
    parsed.uiSettings === null ||
    Array.isArray(parsed.uiSettings)
  ) {
    throw new CodexError("deserializeCodex: uiSettings must be an object");
  }
  if (parsed.foreignKeys !== undefined) {
    validateForeignKeysBlock(parsed.foreignKeys);
  }
  return parsed as
    | CodexExportV1_2<KS, OA, AB, UI>
    | CodexExportV1_3<KS, OA, AB, UI>;
}
