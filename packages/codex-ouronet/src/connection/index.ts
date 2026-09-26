/**
 * @ancientpantheon/codex-ouronet/connection (Phase 3).
 *
 * The StoaChain-side wiring of the codex-core connection layer: `createStoaChainConnection`
 * resolves a serialisable `StoaChainConnectionDescriptor` into the resolver seam's
 * signing inputs (`clientOverride` / surfaced `selectedNode`), the `setNodeConfig`
 * side-effect that redirects stoa-core's global READ path, and a Phase-1
 * `ChainConnection` over the node URL. This removes the hidden `node2` default
 * (CL-09) by making the node URL a first-class connection value.
 */

export {
  createStoaChainConnection,
  STOACHAIN_DEFAULT_NODE_URL,
  STOACHAIN_NODE1_URL,
  STOACHAIN_NODE2_URL,
  STOACHAIN_CONNECTION_CHAIN_ID,
  type StoaChainConnectionDescriptor,
  type StoaChainConnection,
  type StoaChainSigningOptions,
  type CreateStoaChainConnectionOptions,
} from "./createStoaChainConnection.js";

/**
 * The Kadena-mainnet side (2026-09-26): a `ChainConnection` for the Network
 * tab's third row, entirely independent of stoa-core's StoaChain global —
 * see `createKadenaConnection.ts`'s own doc comment for why it's simpler
 * than the StoaChain helper (no signing seam this round; reads bypass
 * stoa-core entirely, see `../kadena/kadenaReads.ts`).
 */
export {
  createKadenaConnection,
  KADENA_CONNECTION_CHAIN_ID,
  KADENA_MAINNET_DEFAULT_NODE_URL,
  type CreateKadenaConnectionOptions,
} from "./createKadenaConnection.js";

/**
 * Re-exported so a consumer wiring the Network tab's Kadena row can push an
 * edited node URL into the module-level global every `kadenaReads.ts` read
 * defaults to, without a second import path — mirrors how `setNodeConfig`
 * (StoaChain's own equivalent lever) is consumed from this same barrel.
 */
export { setActiveKadenaNodeUrl, getActiveKadenaNodeUrl } from "../kadena/kadenaReads.js";
