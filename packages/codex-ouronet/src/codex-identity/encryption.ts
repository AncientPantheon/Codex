/**
 * Pure helper that turns Phase 4's `DoubleApolloDerivation` into a fully-shaped,
 * fully-encrypted `ICodexIdentity` — the entity Phase 7's `kickstartCodex` drops
 * into state.
 *
 * Every secret representation is encrypted at the codex password (CK) via
 * `encryptStringV2` (PBKDF2-SHA512/600k AES-GCM v2 envelope — V1 is explicitly
 * NOT used; it would be a silent KDF downgrade). The function is PURE apart from
 * the WebCrypto/node-crypto calls inside `encryptStringV2`: no store, no adapter,
 * no I/O. Determinism is intentionally NOT a property — `encryptStringV2` draws a
 * fresh random salt+nonce per call, so repeated builds of the same derivation
 * produce different ciphertext but identical plaintext on decrypt.
 */

import type { DoubleApolloDerivation } from "./derivation.js";
import type { CodexIdSeedInput } from "./kickstart-types.js";
import type { ICodexIdentity } from "../types/entities.js";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";

/** Build the `encryptedSeedWords` payload BEFORE encryption.
 *
 * For `words` mode the payload is the raw space-separated UTF-8 words (matches
 * the design doc §3.1 field description literally). For every other mode we wrap
 * `{mode, value}` as JSON so a future decrypt can re-derive via
 * `deriveDoubleApollo(value, mode)` — a Phase 7 forward-compat decision: the
 * design doc only specifies the words-mode shape, and storing the original
 * non-words encoding preserves input fidelity for export/re-derivation. */
function seedWordsPayload(input: CodexIdSeedInput): string {
  if (input.mode === "words") return input.value;
  return JSON.stringify({ mode: input.mode, value: input.value });
}

export async function buildCodexIdentityFromDerivation(
  derivation: DoubleApolloDerivation,
  codexKey: string,
  opts: {
    codexIdSeed: CodexIdSeedInput;
    createdByUsername?: string;
  },
): Promise<ICodexIdentity> {
  const enc = (plaintext: string): Promise<string> => encryptStringV2(plaintext, codexKey);

  // Encrypt all secret representations in parallel — independent of each other.
  const [
    encryptedSeedWords,
    encryptedStandardBitstring,
    encryptedSmartBitstring,
    encryptedStandardBase10,
    encryptedSmartBase10,
    encryptedStandardBase49,
    encryptedSmartBase49,
    encryptedStandardPrivateKey,
    encryptedSmartPrivateKey,
  ] = await Promise.all([
    enc(seedWordsPayload(opts.codexIdSeed)),
    enc(derivation.standard.formats.bitstring),
    enc(derivation.smart.formats.bitstring),
    enc(derivation.standard.formats.base10),
    enc(derivation.smart.formats.base10),
    enc(derivation.standard.formats.base49),
    enc(derivation.smart.formats.base49),
    enc(derivation.standard.privateKey),
    enc(derivation.smart.privateKey),
  ]);

  return {
    formatted: derivation.formatted,
    standardPublicKey: derivation.standard.publicKey,
    smartPublicKey: derivation.smart.publicKey,
    encryptedSeedWords,
    encryptedStandardBitstring,
    encryptedSmartBitstring,
    encryptedStandardBase10,
    encryptedSmartBase10,
    encryptedStandardBase49,
    encryptedSmartBase49,
    // Always populated (re-derivable from the bitstrings, but cached to avoid
    // re-running the Apollo curve on every sign — locked Phase 7 policy).
    encryptedStandardPrivateKey,
    encryptedSmartPrivateKey,
    totalWordCount: derivation.totalWordCount,
    splitIndex: derivation.splitIndex,
    createdAt: new Date().toISOString(),
    createdBy: opts.createdByUsername,
  };
}
