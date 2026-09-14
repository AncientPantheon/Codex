/**
 * Seeds SUBPATH barrel for @ancientpantheon/codex-arweave (E5).
 *
 * The Arweave seed layer: the single seed-input gate every define-seed source
 * passes through. EXPLICIT NAMED exports only (PAT-001) so a future internal
 * helper cannot silently leak into the package's API.
 */

export { resolveSeedBitString, SEED_BIT_LENGTH } from "./resolveSeedBitString.js";
export type { SeedSourceInput, ResolvedSeedBitString } from "./resolveSeedBitString.js";
