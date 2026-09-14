// @ancientpantheon/codex-ouronet/codex-identity — pure identity-derivation helpers.
//
// Groups stateless Codex-identity logic that is NOT part of the Zustand store
// (which lives in src/state/). Phase 4 ships `deriveDoubleApollo`; Phase 7's
// kickstart logic will be added here alongside it.

export {
  deriveDoubleApollo,
} from "./derivation.js";
export type {
  ApolloHalfDerivation,
  DoubleApolloDerivation,
  DeriveSeedMode,
} from "./derivation.js";

// Phase 7 — v0.3 kickstart input/output shapes + runtime validator.
export {
  validateKickstartArgs,
} from "./kickstart-types.js";
export type {
  CodexIdSeedMode,
  CodexIdSeedInput,
  CodexPrimeSeedSource,
  DuoPrimeMode,
  KickstartArgsV3,
  KickstartResultV3,
} from "./kickstart-types.js";

// Phase 7 — internal identity-encryption helper (T7.2).
export {
  buildCodexIdentityFromDerivation,
} from "./encryption.js";

// Arweave seeds (T1) — reusable re-derivation of an account's DALOS FullKey /
// bitstring from its decrypted `secret` plaintext. Lifted out of
// src/ui/internal/DalosSecretReveal.tsx, which now imports it from here.
export {
  rebuildFullKey,
  bitStringOf,
  curveOf,
} from "./rebuildFullKey.js";
export type {
  BitStringAccount,
} from "./rebuildFullKey.js";
