/**
 * stoa-core network shim (Phase 3).
 *
 * A thin, Ouronet-side re-export of `@stoachain/stoa-core`'s node-failover
 * module + the StoaChain chain constant. The StoaChain node URL is a module-level
 * GLOBAL inside stoa-core's `nodeFailover`: `getActivePactUrl(chainId)` (and so
 * the balance reads in the Accounts tab + the resolver's lazy `createClient`
 * default) all read the same active host that `setNodeConfig(selected, url)`
 * mutates. Redirecting the node URL therefore means calling `setNodeConfig`
 * ONCE — it redirects BOTH reads and signing, not per-call.
 *
 * This re-export keeps the concrete `@stoachain/*` value edge local to the
 * connection helper (mirroring `resolverProvider.ts`), so the helper and its
 * tests import the setter/getter through one Ouronet-owned module rather than
 * scattering the stoa-core specifier.
 */

export {
  setNodeConfig,
  resetNodeFailover,
  getActivePactUrl,
  getActiveHost,
  getNodeConfig,
} from "@stoachain/stoa-core/network";

export { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID } from "@stoachain/stoa-core/constants";
