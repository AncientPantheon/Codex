/**
 * The Arweave foreign-key keyring logic — generate / import / decrypt-for-use.
 *
 * FUNDS-CRITICAL. The Arweave JWK IS the private key. Every path here treats it
 * as secret material:
 *   - the plaintext JWK exists ONLY transiently inside these functions; it is
 *     NEVER handed to the store/adapter (only the pre-encrypted `encryptedKeyfile`
 *     ciphertext is persisted, via `store.addForeignKey`);
 *   - it is NEVER logged, serialized to an error, or echoed — a failing operation
 *     names the FIELD (e.g. arweave-core's `importKeyfile` throws naming the bad
 *     field), never the value;
 *   - each entry is INDEPENDENTLY encrypted at the codex password (no shared
 *     seed, N-07).
 *
 * Every mutating/decrypting path is UNLOCK-GATED on the ABSOLUTE (non-sliding)
 * unlock window (`isUnlocked`): a locked or expired codex throws
 * `CodexLockedError` BEFORE any keygen or crypto runs.
 *
 * codex-core owns the at-rest crypto CONTRACT (the injectable `CryptoSeam`) but
 * holds no real cipher — the caller injects the live `smartEncrypt`/`smartDecrypt`
 * seam. This module only delegates to the injected seam.
 */

import { generateKey, importKeyfile, addressOf } from "@ancientpantheon/arweave-core";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";
import {
  isUnlocked,
  type CryptoSeam,
  type PasswordCacheEntry,
  type ForeignKeyEntry,
} from "@ancientpantheon/codex-core";
import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";

import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";

/**
 * The narrow store seam the keyring drives. The `foreignKeys` slice lives in the
 * codex-ouronet store; the keyring only needs to READ the current snapshot (for
 * context) and APPEND a pre-encrypted entry. The slice's `addForeignKey`
 * internally persists via the complete-snapshot `saveAll` route (FIX-5) — the
 * keyring never touches the adapter directly.
 */
export interface ForeignKeyStoreSeam {
  /** Read the current full snapshot (unused by the append flow but part of the
   *  T11.1-pinned seam so callers can inspect existing keys). */
  getSnapshot: () => unknown;
  /** Append a PRE-ENCRYPTED entry; the slice persists it via `saveAll`. */
  addForeignKey: (entry: ForeignKeyEntry) => Promise<void>;
}

/** Fresh entry id — a stable identifier addressing the entry on restore. */
function newEntryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `fk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Throw `CodexLockedError` unless the codex is unlocked at the current instant.
 *  Runs BEFORE any keygen/crypto so a locked codex never wastes entropy nor
 *  reaches the injected cipher. */
function assertUnlocked(
  passwordCache: PasswordCacheEntry | null,
  operation: string,
): void {
  if (!isUnlocked(passwordCache, Date.now())) {
    throw new CodexLockedError(operation);
  }
}

/**
 * Encrypt a JWK at the codex password and build its keyring entry. Shared by the
 * generate and import flows — the plaintext JWK enters here and leaves only as
 * ciphertext on the returned entry.
 */
async function toEncryptedEntry(
  jwk: ArweaveJwk,
  cryptoSeam: CryptoSeam,
  password: string,
  label?: string,
): Promise<ForeignKeyEntry> {
  // The canonical 43-char address doubles as the stable entry id so the same
  // key restores to the same identity; a corrupt modulus throws here rather
  // than yielding a silent wrong address.
  const address = await addressOf(jwk);
  const encryptedKeyfile = await cryptoSeam.encrypt(JSON.stringify(jwk), password);
  const entry: ForeignKeyEntry = {
    id: address || newEntryId(),
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile,
  };
  if (label !== undefined) {
    entry.label = label;
  }
  return entry;
}

/** Arguments for {@link generateArweaveKey}. */
export interface GenerateArweaveKeyArgs {
  store: ForeignKeyStoreSeam;
  cryptoSeam: CryptoSeam;
  password: string;
  passwordCache: PasswordCacheEntry | null;
  label?: string;
}

/**
 * Generate a fresh Arweave key, encrypt it at rest, and append it to the
 * foreign-key slice. Unlock-gated. Returns the persisted (ciphertext-only)
 * entry — never the plaintext JWK.
 */
export async function generateArweaveKey(
  args: GenerateArweaveKeyArgs,
): Promise<ForeignKeyEntry> {
  const { store, cryptoSeam, password, passwordCache, label } = args;
  assertUnlocked(passwordCache, "generateArweaveKey");

  const jwk = await generateKey();
  const entry = await toEncryptedEntry(jwk, cryptoSeam, password, label);
  await store.addForeignKey(entry);
  return entry;
}

/** Arguments for {@link importArweaveKey}. */
export interface ImportArweaveKeyArgs {
  raw: unknown;
  store: ForeignKeyStoreSeam;
  cryptoSeam: CryptoSeam;
  password: string;
  passwordCache: PasswordCacheEntry | null;
  label?: string;
}

/**
 * Import a raw Arweave keyfile (validated by arweave-core's `importKeyfile`,
 * which throws `InvalidKeyfileError` NAMING the offending field, never echoing
 * its value), encrypt it at rest, and append it to the slice. Unlock-gated.
 */
export async function importArweaveKey(
  args: ImportArweaveKeyArgs,
): Promise<ForeignKeyEntry> {
  const { raw, store, cryptoSeam, password, passwordCache, label } = args;
  assertUnlocked(passwordCache, "importArweaveKey");

  const jwk = importKeyfile(raw);
  const entry = await toEncryptedEntry(jwk, cryptoSeam, password, label);
  await store.addForeignKey(entry);
  return entry;
}

/** Arguments for {@link decryptArweaveKey}. */
export interface DecryptArweaveKeyArgs {
  entry: ForeignKeyEntry;
  cryptoSeam: CryptoSeam;
  password: string;
  passwordCache: PasswordCacheEntry | null;
}

/**
 * Decrypt an entry's `encryptedKeyfile` back to its Arweave JWK for transient
 * in-memory use (the E2 signer / the E-03 round-trip proof). Unlock-gated: a
 * locked codex throws `CodexLockedError` before any decrypt runs. The returned
 * JWK is plaintext secret material — the caller must never persist or log it.
 */
export async function decryptArweaveKey(
  args: DecryptArweaveKeyArgs,
): Promise<ArweaveJwk> {
  const { entry, cryptoSeam, password, passwordCache } = args;
  assertUnlocked(passwordCache, "decryptArweaveKey");

  const plaintext = await cryptoSeam.decrypt(entry.encryptedKeyfile, password);
  // Re-validate the decrypted material through arweave-core's structural guard
  // so a corrupted ciphertext fails closed (naming the field) rather than
  // returning a malformed JWK to the signer.
  return importKeyfile(JSON.parse(plaintext));
}
