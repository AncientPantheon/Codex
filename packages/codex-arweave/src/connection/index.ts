/**
 * Connection subpath barrel for `@ancientpantheon/codex-arweave`.
 *
 * The Codex-path bridge (Phase 2): `createArweaveConnection` binds an EXPLICIT
 * Arweave gateway URL to the Phase-1 `ChainConnection` seam, so Arweave reads /
 * broadcast / poll run against an injected endpoint (never a hidden arweave.net
 * default) and the network-settings model + health work uniformly. EXPLICIT
 * NAMED exports only (PAT-001); never `export *`.
 */

export {
  createArweaveConnection,
  type ArweaveConnectionOptions,
  type ArweaveReadQuery,
  type ArweavePollRef,
} from "./createArweaveConnection.js";
