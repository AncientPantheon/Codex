/**
 * Seeds SUBPATH barrel for @ancientpantheon/codex-arweave (E5).
 *
 * The Arweave seed layer: the single seed-input gate every define-seed source
 * passes through. EXPLICIT NAMED exports only (PAT-001) so a future internal
 * helper cannot silently leak into the package's API.
 *
 * `deriveArweaveSeedAtPositionZero` (T3/T4 of
 * `docs/work/codex-recovery-backup-tagging/plan.md`) is re-exported here so
 * the HOST APP layer (e.g. `apps/codex-playground`) can reach the Prime
 * Arweave seed auto-derivation primitive without an internal relative import —
 * it was deliberately left off this barrel when first built (T3); this is the
 * "add it here for the host app to reach it" step T3's own doc comment
 * anticipated. A corresponding `"./seeds"` entry was added to this package's
 * `package.json` `exports` map so the subpath actually resolves externally.
 *
 * `checkArweaveRestoreEligibility` (T1 of
 * `docs/work/codex-seed-restore-activation/plan.md`) is re-exported here for
 * the same reason: a later sibling task in that topic wires it up from the
 * HOST APP layer.
 */

export { resolveSeedBitString, SEED_BIT_LENGTH } from "./resolveSeedBitString.js";
export type { SeedSourceInput, ResolvedSeedBitString } from "./resolveSeedBitString.js";

export { deriveArweaveSeedAtPositionZero } from "./derivePrimeSeed.js";
export type {
  DeriveArweaveSeedAtPositionZeroOptions,
  KeygenProgress,
} from "./derivePrimeSeed.js";

export { checkArweaveRestoreEligibility } from "./checkRestoreEligibility.js";
export type { CheckArweaveRestoreEligibilityOptions } from "./checkRestoreEligibility.js";
