/**
 * Chains SUBPATH barrel for @ancientpantheon/codex-core.
 *
 * Exposes the ForeignChainAdapter registry seam: the contract type, the
 * instance-scoped registry factory, and the typed registry error. The root
 * `src/index.ts` re-exports these named symbols (single-owner root barrel).
 */

export type { ForeignChainAdapter } from "./ForeignChainAdapter.js";
export {
  createForeignChainRegistry,
  type ForeignChainRegistry,
} from "./registry.js";
export { ForeignChainError } from "./ForeignChainError.js";
