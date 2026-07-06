/**
 * @ancientpantheon/codex-ouronet/connection (Phase 3).
 *
 * The Kadena-side wiring of the codex-core connection layer: `createKadenaConnection`
 * resolves a serialisable `KadenaConnectionDescriptor` into the resolver seam's
 * signing inputs (`clientOverride` / surfaced `selectedNode`), the `setNodeConfig`
 * side-effect that redirects stoa-core's global READ path, and a Phase-1
 * `ChainConnection` over the node URL. This removes the hidden `node2` default
 * (CL-09) by making the node URL a first-class connection value.
 */

export {
  createKadenaConnection,
  KADENA_DEFAULT_NODE_URL,
  KADENA_NODE1_URL,
  KADENA_NODE2_URL,
  KADENA_CONNECTION_CHAIN_ID,
  type KadenaConnectionDescriptor,
  type KadenaConnection,
  type KadenaSigningOptions,
  type CreateKadenaConnectionOptions,
} from "./createKadenaConnection.js";
