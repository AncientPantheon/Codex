/**
 * Adapter SUBPATH barrel for @ancientpantheon/codex-arweave.
 *
 * Exposes the Arweave `ForeignChainAdapter` factory, its registry helper, the
 * chain id constant, and the stubbed-signer error — with EXPLICIT NAMED exports
 * only (never `export *`), so the public surface is auditable. The root
 * `src/index.ts` aggregation is owned by a later task; this barrel is the
 * import site for the adapter today.
 */

export {
  createArweaveAdapter,
  registerArweave,
  ARWEAVE_CHAIN_ID,
} from "./arweaveAdapter.js";
export type {
  ArweaveAdapterDeps,
  BuildSendParams,
  BuiltArweaveSend,
  PostOptions,
} from "./arweaveAdapter.js";
export {
  arweaveBalanceAsAr,
  arweaveTransactionStatus,
} from "./status.js";
export type {
  ArweaveBalanceAsArOptions,
  ArweaveTransactionStatusOptions,
} from "./status.js";
export { NotImplementedError } from "./errors.js";
