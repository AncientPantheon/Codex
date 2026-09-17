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
  ArweaveSeedEntry,
  CodexExportV1_2,
  CodexExportV1_3,
  PlaintextCodex,
  WatchListEntry,
} from "./types.js";
import { isForeignKeyEntry, type ForeignKeysBlock } from "./foreignKeys.js";
import { isPureKeypairEntry } from "./pureKeypairs.js";
import { CodexError, CodexUnknownFieldError } from "./errors.js";

/**
 * Intra-block schema version the writer stamps onto every emitted
 * `foreignKeys` block. A codec-level constant: the in-memory source is a bare
 * `ForeignKeyEntry[]`, so a source that happened to carry its own
 * `schemaVersion` can never silently downgrade the stamped block version.
 *
 * History — WRITE the latest, READ every past stamp:
 *   1 — `{ id, label?, chainId, encryptedKeyfile }`.
 *   2 — adds OPTIONAL seed provenance (`seedId` / `index` / `address`) so a
 *       key can be grouped under the Arweave seed that produced it.
 * The bump is forward-stamp only. Because the new fields are OPTIONAL, a
 * block stamped 1 is still a VALID block: the reader accepts ANY numeric
 * `schemaVersion` and never refuses an older one, so codexes exported before
 * provenance existed keep deserializing unchanged.
 */
const FOREIGN_KEYS_BLOCK_SCHEMA_VERSION = 2;

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
 *
 * `pureKeypairs` (FIX-2 — the D2 revisit) is EMITTED only when the source codex
 * carries pure keypairs, as a BARE ARRAY passed through UNCHANGED (it is NOT
 * block-wrapped like `foreignKeys` — it was already a bare array in the old
 * `BackupFileV12Plus` hook format the `useCodexBackup` rewire replaces). When
 * the source has no pure keypairs the property is OMITTED — matching the
 * foreignKeys omission discipline so a keypair-free codex stays clean.
 *
 * `arweaveSeeds` (the fix for the reported Prime-Arweave-Seed-vanishes
 * incident) is EMITTED only when the OPTIONAL source field is present AND
 * non-empty, as a BARE ARRAY passed through UNCHANGED — matching the
 * pureKeypairs/foreignKeys omission discipline. Before this fix the codec had
 * no `arweaveSeeds` awareness at all, so a seed silently dropped out of every
 * export regardless of the source.
 */
export function buildCodexExport<
  KS, OA, PK, AB, UI, AS, WL,
>(
  codex: PlaintextCodex<KS, OA, PK, AB, UI, AS, WL>,
): CodexExportV1_2<KS, OA, AB, UI> | CodexExportV1_3<KS, OA, AB, UI, PK, AS, WL> {
  const base: CodexExportV1_3<KS, OA, AB, UI, PK, AS, WL> = {
    version: "1.3",
    exportedAt: new Date().toISOString(),
    kadenaWallets: codex.kadenaWallets,
    ouronetWallets: codex.ouronetWallets,
    addressBook: codex.addressBook,
    uiSettings: codex.uiSettings,
  };
  const withKeyrings: CodexExportV1_3<KS, OA, AB, UI, PK, AS, WL> = {
    ...base,
    ...(codex.foreignKeys !== undefined
      ? {
          foreignKeys: {
            schemaVersion: FOREIGN_KEYS_BLOCK_SCHEMA_VERSION,
            keys: codex.foreignKeys,
          } satisfies ForeignKeysBlock,
        }
      : {}),
    ...(codex.pureKeypairs.length > 0 ? { pureKeypairs: codex.pureKeypairs } : {}),
    ...(codex.arweaveSeeds !== undefined && codex.arweaveSeeds.length > 0
      ? { arweaveSeeds: codex.arweaveSeeds }
      : {}),
    ...(codex.watchList !== undefined && codex.watchList.length > 0
      ? { watchList: codex.watchList }
      : {}),
  };
  return withKeyrings;
}

/**
 * Stringify a PlaintextCodex into the `"1.3"` backup JSON format. Pretty-prints
 * with 2-space indent because the file lands on disk and a human occasionally
 * opens it to sanity-check account addresses.
 */
export function serializeCodex<
  KS, OA, PK, AB, UI, AS, WL,
>(
  codex: PlaintextCodex<KS, OA, PK, AB, UI, AS, WL>,
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
  // FIX-2 (the D2 revisit): the `useCodexBackup` rewire routes a backup carrying
  // `pureKeypairs` through this reader. It is allow-listed alongside
  // `foreignKeys` so a fresh 1.3 backup is RESTORABLE — a genuinely-unknown
  // field still throws below. The set is widened for these two keyrings ONLY,
  // never wide-open.
  "pureKeypairs",
  // Funds-critical fix for the reported incident: a Prime Arweave Seed
  // vanished across a save+reload because this reader had no `arweaveSeeds`
  // allow-list entry at all — a backup carrying the field would throw
  // `CodexUnknownFieldError`, and the writer never emitted it in the first
  // place. Allow-listed alongside `pureKeypairs`/`foreignKeys` ONLY, never
  // wide-open.
  "arweaveSeeds",
  // A watched address (no key, purely observed) silently vanished across a
  // codex export+reimport because this reader had no `watchList` allow-list
  // entry at all. Allow-listed alongside the other keyrings ONLY, never
  // wide-open.
  "watchList",
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
 * Structurally validate a present `pureKeypairs` array — SHAPE only, never
 * decrypts. Unlike `foreignKeys` (a `{ schemaVersion, keys }` block), this is a
 * BARE ARRAY on the wire, so the validator asserts array-ness at the top level
 * and entry shape per element. Throws a `CodexError` naming the offending PATH
 * (`pureKeypairs[0]`) but never echoing any entry value, because a malformed
 * entry could carry the user's only copy of a pure-key ciphertext.
 */
function validatePureKeypairs(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new CodexError("deserializeCodex: pureKeypairs must be an array");
  }
  value.forEach((entry, i) => {
    if (!isPureKeypairEntry(entry)) {
      throw new CodexError(
        `deserializeCodex: pureKeypairs[${i}] is not a valid pure-keypair entry`,
      );
    }
  });
}

/**
 * Structural guard for a single Arweave-seed wire entry — validates SHAPE,
 * never decrypts. There is no dedicated `ArweaveSeedEntry` model file (unlike
 * `ForeignKeyEntry`/`PureKeypairEntry`), so this mirrors `isPureKeypairEntry`'s
 * rigor inline: the load-bearing core fields (`id`, `secret`, `createdAt`) must
 * be strings; `name` and `isPrime` are accepted when absent but rejected when
 * present with the wrong type.
 */
function isArweaveSeedEntry(x: unknown): x is ArweaveSeedEntry {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const entry = x as Record<string, unknown>;
  if (typeof entry.id !== "string") return false;
  if (typeof entry.secret !== "string") return false;
  if (typeof entry.createdAt !== "string") return false;
  if ("name" in entry && entry.name !== undefined && typeof entry.name !== "string") {
    return false;
  }
  if ("isPrime" in entry && entry.isPrime !== undefined && typeof entry.isPrime !== "boolean") {
    return false;
  }
  return true;
}

/**
 * Structurally validate a present `arweaveSeeds` array — SHAPE only, never
 * decrypts. Like `pureKeypairs` (and unlike `foreignKeys`), this is a BARE
 * ARRAY on the wire, so the validator asserts array-ness at the top level and
 * entry shape per element. Throws a `CodexError` naming the offending PATH
 * (`arweaveSeeds[0]`) but never echoing any entry value, because a malformed
 * entry could carry the user's only copy of an Arweave seed's ciphertext.
 */
function validateArweaveSeeds(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new CodexError("deserializeCodex: arweaveSeeds must be an array");
  }
  value.forEach((entry, i) => {
    if (!isArweaveSeedEntry(entry)) {
      throw new CodexError(
        `deserializeCodex: arweaveSeeds[${i}] is not a valid Arweave-seed entry`,
      );
    }
  });
}

/**
 * Structural guard for a single watch-list wire entry — SHAPE only. Unlike
 * `ArweaveSeedEntry`/`ForeignKeyEntry` there is no ciphertext field to protect
 * here (a watch entry never carries a secret), but the shape is still
 * validated so a malformed entry fails closed rather than corrupting the
 * store on restore.
 */
function isWatchListEntry(x: unknown): x is WatchListEntry {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const entry = x as Record<string, unknown>;
  if (typeof entry.id !== "string") return false;
  if (typeof entry.label !== "string") return false;
  if (typeof entry.address !== "string") return false;
  if (typeof entry.createdAt !== "string") return false;
  if (entry.type !== "ouronet" && entry.type !== "stoa" && entry.type !== "arweave") {
    return false;
  }
  return true;
}

/**
 * Structurally validate a present `watchList` array — SHAPE only. Like
 * `pureKeypairs`/`arweaveSeeds`, this is a BARE ARRAY on the wire, so the
 * validator asserts array-ness at the top level and entry shape per element.
 * Throws a `CodexError` naming the offending PATH (`watchList[0]`).
 */
function validateWatchList(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new CodexError("deserializeCodex: watchList must be an array");
  }
  value.forEach((entry, i) => {
    if (!isWatchListEntry(entry)) {
      throw new CodexError(
        `deserializeCodex: watchList[${i}] is not a valid watch-list entry`,
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
 * a non-object `uiSettings`, a malformed `foreignKeys` block, a malformed
 * `pureKeypairs` array, or a malformed `arweaveSeeds` array. A "1.2" file
 * round-trips with `foreignKeys`, `pureKeypairs`, and `arweaveSeeds` all
 * ABSENT — no default is injected. `pureKeypairs` and `arweaveSeeds` are both
 * validated as BARE ARRAYS of entries (neither is block-wrapped like
 * `foreignKeys`).
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
  if (parsed.pureKeypairs !== undefined) {
    validatePureKeypairs(parsed.pureKeypairs);
  }
  if (parsed.arweaveSeeds !== undefined) {
    validateArweaveSeeds(parsed.arweaveSeeds);
  }
  if (parsed.watchList !== undefined) {
    validateWatchList(parsed.watchList);
  }
  return parsed as
    | CodexExportV1_2<KS, OA, AB, UI>
    | CodexExportV1_3<KS, OA, AB, UI>;
}
