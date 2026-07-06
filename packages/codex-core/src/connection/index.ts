/**
 * Connection SUBPATH barrel for @ancientpantheon/codex-core.
 *
 * The headless connection layer (Phase 1): the keyless `ChainConnection` seam
 * (CL-01), the two implementations — `createPythiaConnection` (CL-02) and
 * `createDirectNodeConnection` (CL-03) — the two-tier `createConnectionResolver`
 * (CL-04), and the network-settings status model (CL-05). No consumer wiring; no
 * key ever touches this layer (N-01).
 *
 * The root `src/index.ts` re-exports these named symbols (single-owner root
 * barrel); never `export *`.
 */

export type {
  ChainConnection,
  ConnectionHealth,
  ConnectionPollResult,
  FetchLike,
} from "./types.js";

export {
  createPythiaConnection,
  type PythiaConnectionOptions,
} from "./pythiaConnection.js";

export {
  createDirectNodeConnection,
  type DirectNodeConnectionOptions,
  type DirectNodeTransport,
} from "./directNodeConnection.js";

export {
  createConnectionResolver,
  type ConnectionResolver,
  type ConnectionResolverOptions,
  type NetworkSettingsModel,
  type ChainConnectionRow,
  type ChainConnectionStatus,
} from "./resolver.js";
