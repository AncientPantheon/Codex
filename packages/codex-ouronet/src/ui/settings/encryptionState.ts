/**
 * Read-only encryption-state helpers shared by CodexInfoCard + EncryptionCard.
 *
 * The package itself owns no password-rotation / re-encryption action (that
 * lives in the consumer, wired via the cards' callback seams). What the
 * package CAN do without new state is *read* the V1/V2 level off the codex's
 * existing ciphertext envelopes via stoa-core's `allEncryptedV2` predicate.
 * These helpers stay pure so both cards derive the same status the same way.
 */

import { allEncryptedV2 } from "@stoachain/stoa-core/crypto";
import type {
  IKadenaSeed,
  IOuroAccount,
  IPureKeypair,
} from "../../types/entities.js";

export type EncryptionLevel = "none" | "v1" | "v2";

/** Collect every encrypted-at-codex-password envelope across the slices that
 *  carry one. Empty strings / absent secrets are dropped so a codex with no
 *  secrets reads as "none" rather than a false legacy. */
export function collectCodexSecrets(slices: {
  kadenaSeeds: IKadenaSeed[];
  ouroAccounts: IOuroAccount[];
  pureKeypairs: IPureKeypair[];
}): string[] {
  return [
    ...slices.kadenaSeeds.map((s) => s.secret),
    ...slices.ouroAccounts.map((a) => a.secret),
    ...slices.pureKeypairs.map((k) => k.encryptedPrivateKey),
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Classify the codex's encryption level from its collected secrets.
 *  `none`  — no secrets to classify.
 *  `v2`    — every secret is in the V2 (PBKDF2 600k SHA-512) envelope.
 *  `v1`    — at least one secret is still in the legacy V1 envelope. */
export function encryptionLevel(secrets: string[]): EncryptionLevel {
  if (secrets.length === 0) return "none";
  return allEncryptedV2(secrets) ? "v2" : "v1";
}
