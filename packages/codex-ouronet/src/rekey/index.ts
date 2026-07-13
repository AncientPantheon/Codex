/**
 * `rekeyCodex` — the codex password-rotation primitive (Handoff 07).
 *
 * A pure, isomorphic (Node + browser) `snapshot → snapshot` transform that
 * re-encrypts EVERY codex-password-encrypted secret from an old password to a
 * new one. No store, no DOM, no persistence — the caller owns `saveAll`.
 *
 * Why this lives in the package (the load-bearing reason): the secret-field
 * inventory is package-owned and it GROWS (the CodexID's 9 encrypted fields
 * landed in 0.3.0). A consumer-inline field-walk silently misses any new secret
 * field a future codex adds → that secret stays under the OLD password → it is
 * permanently unusable after rotation. Only the package, which owns the snapshot
 * shape, can keep the walk correct as the shape evolves. The `ui/settings`
 * `collectCodexSecrets` helper predates this and covered only 3 slices — this is
 * now the single source of truth (it also serves the V1/V2 read).
 *
 * Algorithm (mirrors OuronetUI's proven `upgradeCodexEncryption`, but
 * old→new instead of same-password V1→V2):
 *   - PRE-FLIGHT verify `oldPassword` against a known ciphertext — a
 *     `WrongPasswordError` aborts BEFORE anything is mutated (we work on a clone
 *     regardless, so the input snapshot is never touched).
 *   - RE-KEY every ciphertext field: `smartDecrypt(blob, old)` (handles V1+V2)
 *     then `encryptStringV2(plain, new)` — output is always V2 (a re-key is the
 *     moment to upgrade any lingering V1 envelope).
 *   - SKIP-NOT-DROP: a field that cannot be decrypted with `oldPassword` keeps
 *     its ORIGINAL ciphertext and is recorded in `skipped` — never silently
 *     dropped (OuronetUI's safety pattern).
 *   - Non-secret fields (public keys, uiSettings, addressBook, ids, timestamps)
 *     are left untouched.
 *
 * NOTE on the `uiSettings_enc` sidecar: that is an ADAPTER-owned CK slot, not a
 * field on the snapshot object, so it is out of scope for this snapshot→snapshot
 * transform. A server adapter (e.g. Mnemosyne, master-key sealed) re-seals it on
 * `saveAll`; a browser adapter that stores a CK-encrypted uiSettings sidecar
 * must re-key that slot itself. Documented, deliberately not walked here.
 */

import { smartDecrypt, encryptStringV2, WrongPasswordError } from "@stoachain/stoa-core/crypto";
import type { CodexSnapshot } from "../adapters/types.js";
import type { ICodexIdentity } from "../types/entities.js";

/**
 * Every codex-password-encrypted field on `ICodexIdentity`, in one place. The
 * `rekey-inventory` guard test asserts this list stays in lockstep with the
 * type — add an `encrypted*` field to the identity and the test fails until it
 * is listed here (the correctness guarantee the primitive exists to provide).
 */
export const CODEX_IDENTITY_SECRET_FIELDS = [
  "encryptedSeedWords",
  "encryptedStandardBitstring",
  "encryptedSmartBitstring",
  "encryptedStandardBase10",
  "encryptedSmartBase10",
  "encryptedStandardBase49",
  "encryptedSmartBase49",
  "encryptedStandardPrivateKey", // optional
  "encryptedSmartPrivateKey", // optional
] as const satisfies readonly (keyof ICodexIdentity)[];

/** A locator for one ciphertext blob in a snapshot: read it, write it back. */
interface SecretRef {
  slice: string;
  id?: string;
  field: string;
  read(): string | undefined;
  write(value: string): void;
}

/**
 * Walk EVERY codex-password ciphertext in a snapshot. The single inventory both
 * `rekeyCodex` and `collectCodexPasswordSecrets` iterate — add a new secret
 * slice/field here and both stay correct automatically.
 */
function* iterateCodexSecretRefs(snapshot: CodexSnapshot): Generator<SecretRef> {
  for (const s of snapshot.kadenaSeeds ?? []) {
    yield { slice: "kadenaSeeds", id: s.id, field: "secret", read: () => s.secret, write: (v) => { s.secret = v; } };
  }
  for (const a of snapshot.ouroAccounts ?? []) {
    yield { slice: "ouroAccounts", id: a.id, field: "secret", read: () => a.secret, write: (v) => { a.secret = v; } };
    yield { slice: "ouroAccounts", id: a.id, field: "backup", read: () => a.backup, write: (v) => { a.backup = v; } };
  }
  for (const k of snapshot.pureKeypairs ?? []) {
    yield { slice: "pureKeypairs", id: k.id, field: "encryptedPrivateKey", read: () => k.encryptedPrivateKey, write: (v) => { k.encryptedPrivateKey = v; } };
  }
  for (const f of snapshot.foreignKeys ?? []) {
    yield { slice: "foreignKeys", id: f.id, field: "encryptedKeyfile", read: () => f.encryptedKeyfile, write: (v) => { f.encryptedKeyfile = v; } };
  }
  const identity = snapshot.codexIdentity;
  if (identity) {
    for (const field of CODEX_IDENTITY_SECRET_FIELDS) {
      yield {
        slice: "codexIdentity",
        field,
        read: () => identity[field] as string | undefined,
        write: (v) => { (identity as unknown as Record<string, unknown>)[field] = v; },
      };
    }
  }
}

/**
 * Collect every non-empty codex-password ciphertext across the WHOLE inventory
 * (kadenaSeeds, ouroAccounts.secret+backup, pureKeypairs, foreignKeys, and all
 * CodexID `encrypted*` fields). The complete, drift-proof superset of the older
 * `ui/settings` `collectCodexSecrets` — reuse this for the V1/V2 level read.
 */
export function collectCodexPasswordSecrets(snapshot: CodexSnapshot): string[] {
  const out: string[] = [];
  for (const ref of iterateCodexSecretRefs(snapshot)) {
    const blob = ref.read();
    if (typeof blob === "string" && blob.length > 0) out.push(blob);
  }
  return out;
}

/** One secret that could not be re-keyed (kept verbatim under the old password). */
export interface RekeySkip {
  slice: string;
  id?: string;
  field: string;
  reason: string;
}

/** The result of a re-key: the new snapshot + any skipped (non-dropped) fields. */
export interface RekeyResult {
  snapshot: CodexSnapshot;
  skipped: RekeySkip[];
}

/**
 * Re-encrypt every codex-password secret in `snapshot` from `oldPassword` to
 * `newPassword`. Pure: returns a NEW snapshot; the input is never mutated.
 *
 * @throws {WrongPasswordError} if `oldPassword` does not decrypt the codex
 *   (verified pre-flight, before any field is re-keyed).
 */
export async function rekeyCodex(
  snapshot: CodexSnapshot,
  oldPassword: string,
  newPassword: string,
): Promise<RekeyResult> {
  // Work on a deep clone so the caller's snapshot is never touched, even on a
  // mid-way throw. structuredClone is isomorphic (Node 17+ / browsers) and the
  // snapshot is pure data.
  const next = structuredClone(snapshot);
  const refs = [...iterateCodexSecretRefs(next)];

  // ── Pre-flight: verify oldPassword against a real ciphertext. A
  //    WrongPasswordError here aborts before we re-key anything. Corrupt probes
  //    (a different error) are skipped so a single bad blob can't mask a
  //    good password — we look for the first blob that either decrypts or
  //    definitively reports the wrong password.
  let verified = false;
  for (const ref of refs) {
    const blob = ref.read();
    if (!blob) continue;
    try {
      await smartDecrypt(blob, oldPassword);
      verified = true;
      break;
    } catch (err) {
      if (err instanceof WrongPasswordError) throw err;
      // else: this blob is corrupt/foreign — keep probing.
    }
  }
  // No decryptable secrets at all (empty codex, or every blob corrupt): nothing
  // to verify against and nothing to lose — return the clone unchanged.
  if (!verified) return { snapshot: next, skipped: [] };

  // ── Re-key pass: decrypt-old → encrypt-new-V2 per field; skip-not-drop.
  const skipped: RekeySkip[] = [];
  for (const ref of refs) {
    const blob = ref.read();
    if (!blob) continue;
    try {
      const plain = await smartDecrypt(blob, oldPassword);
      ref.write(await encryptStringV2(plain, newPassword));
    } catch (err) {
      // oldPassword is verified, so this is a genuinely un-decryptable field
      // (corrupt, or encrypted under a different key). Keep the original blob.
      skipped.push({
        slice: ref.slice,
        id: ref.id,
        field: ref.field,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { snapshot: next, skipped };
}
