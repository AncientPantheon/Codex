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
