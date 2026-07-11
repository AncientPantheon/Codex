/**
 * signApolloOwnership — the Codex's Apollo-ownership signing seam for the
 * generic `/apollo-verify` verifier (docs/HANDOFF-apollo-ownership-verifier.md).
 *
 * A relying party (Pythia first; any consumer via its own `rp`) asks the user to
 * prove control of an Apollo (₱./Π.) account by signing a canonical challenge.
 * This lives in codex-ouronet — NOT codex-ui — because the Apollo derivation +
 * `Apollo.sign` are a VALUE `@stoachain/*` edge (the D5 carve forbids that in the
 * chain-generic codex-ui). The private key never leaves the browser; only the
 * signature is returned. Curve: `dalos-apollo` (Schnorr v2).
 *
 * The canonical message is byte-exact with Pythia's `buildChallengeMessage`
 * (apps/pythia/src/connectors/verify/canonicalMessage.ts) — a single differing
 * byte fails `Apollo.verify` on the RP side (the #1 integration bug).
 */

import {
  Apollo,
  createDefaultRegistry,
  createOuronetAccount,
  parseAsciiBitmap,
  type CreateAccountOptions,
  type FullKey,
} from "@stoachain/stoa-core/dalos";
import type { IOuroAccount, OuroOriginMode, OuronetOriginCurve } from "../types/entities.js";
import { detectOriginCurve } from "../ui/internal/originCurve.js";

/** One returned ownership proof: the account + its signature. */
export interface ApolloProof {
  apollo: string;
  sig: string;
}

/**
 * The canonical Apollo-ownership message — sign EXACTLY this (byte-for-byte).
 * Four lines, `\n`-joined, UTF-8, no trailing newline.
 */
export function buildApolloOwnershipMessage(account: string, nonce: string, rp: string): string {
  return [
    "Apollo ownership proof",
    `apollo: ${account}`,
    `nonce: ${nonce}`,
    `rp: ${rp}`,
  ].join("\n");
}

/**
 * Re-derive an Apollo account's FullKey from its DECRYPTED secret. Mirrors
 * `rebuildFullKey` in DalosSecretReveal.tsx (esp. the Apollo bitmap nuance: an
 * apollo `bitmap` secret is comma-joined ASCII rows re-derived via `bitString`).
 * Returns null on any derivation failure.
 */
function rebuildApolloFullKey(
  plaintext: string,
  originMode: OuroOriginMode,
  originCurve: OuronetOriginCurve,
): FullKey | null {
  try {
    const primitiveId = originCurve === "apollo" ? "dalos-apollo" : "dalos-gen-1";
    const registry = createDefaultRegistry();
    if (originCurve === "apollo") registry.register(Apollo);

    let options: CreateAccountOptions;
    switch (originMode) {
      case "seedWords": {
        const words = plaintext.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return null;
        options = { mode: "seedWords", data: words, primitiveId };
        break;
      }
      case "bitmap": {
        const lines = plaintext.split(",");
        if (originCurve === "apollo") {
          let bits = "";
          for (const row of lines) for (const ch of row) bits += (ch === "#" || ch === "1") ? "1" : "0";
          options = { mode: "bitString", data: bits, primitiveId };
        } else {
          options = { mode: "bitmap", data: parseAsciiBitmap(lines), primitiveId };
        }
        break;
      }
      case "bitString":     options = { mode: "bitString", data: plaintext, primitiveId }; break;
      case "integerBase10": options = { mode: "integerBase10", data: plaintext, primitiveId }; break;
      case "integerBase49": options = { mode: "integerBase49", data: plaintext, primitiveId }; break;
      default: {
        const words = plaintext.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return null;
        options = { mode: "seedWords", data: words, primitiveId };
      }
    }
    return createOuronetAccount(registry, options);
  } catch {
    return null;
  }
}

/**
 * Prove ownership of one Apollo account: re-derive its keypair from the decrypted
 * secret, VERIFY the derived ₱./Π. address matches the account (guards against
 * the wrong Codex/password producing a valid-but-unrelated key), then sign the
 * canonical message. Throws on mismatch or if the Apollo primitive lacks signing.
 */
export function signApolloOwnership(
  account: IOuroAccount,
  secretPlaintext: string,
  nonce: string,
  rp: string,
): ApolloProof {
  const originCurve = account.originCurve ?? detectOriginCurve(account);
  const originMode = account.originMode ?? "seedWords";
  const full = rebuildApolloFullKey(secretPlaintext, originMode, originCurve);
  if (!full) throw new Error("Could not derive the Apollo key from the Codex secret.");

  // A single Apollo keypair renders as BOTH ₱. (standard) and Π. (smart); pick
  // the form the account is stored as and require it to match exactly.
  const derivedAddress = account.isSmart ? full.smartAddress : full.standardAddress;
  if (derivedAddress !== account.address) {
    throw new Error(
      "The recovered key doesn't match this Apollo account — make sure the correct Codex is unlocked.",
    );
  }
  if (!Apollo.sign) throw new Error("Apollo signing primitive unavailable in this build.");

  const sig = Apollo.sign(full.keyPair, buildApolloOwnershipMessage(account.address, nonce, rp));
  return { apollo: account.address, sig };
}
