/**
 * `createConnectionResolver` (CL-04) + the network-settings status model (CL-05).
 *
 * The resolver merges a GLOBAL base connection (operator-injected) with LOCAL
 * per-chain overrides (user-set) plus a `locked` flag, and derives — per
 * supported chain — the active `ChainConnection`, a display `status`, and whether
 * the manual node-URL field is enabled.
 *
 * PRECEDENCE (per chain):
 *   1. global — if its dynamic coverage (`health().coveredChains`) includes the
 *      chain, the global wins (a local override for a covered chain is IGNORED).
 *   2. local override — only for a chain the global does NOT cover.
 *   3. none.
 *
 * STATUS derivation:
 *   - `live-global`   — the global covers the chain.
 *   - `live-local`    — the global does not cover it, but a local override is set.
 *   - `missing`       — the global is live (covers ≥1 chain) but not this one, and
 *                       there is no local override (the user may add one).
 *   - `not-connected` — no live global coverage at all (dead/absent) and no local.
 *
 * `manualFieldEnabled` = true IFF the chain is NOT globally covered — the field is
 * disabled only when the site already provides the chain.
 *
 * COVERAGE is DYNAMIC — resolved from `global.health()`, never hardcoded. The day
 * Pythia advertises a chain, its row flips to `live-global` and the field
 * auto-disables with zero code change. `locked` is carried verbatim on the model;
 * it is a UI concern (read-only field editing) and does NOT change the derived
 * status or `manualFieldEnabled`.
 */

import type { ChainConnection } from "./types.js";

/** The per-chain display status the Network tab binds to. */
export type ChainConnectionStatus =
  | "live-global"
  | "live-local"
  | "missing"
  | "not-connected";

/** One resolved per-chain row of the network-settings model. */
export interface ChainConnectionRow {
  chainId: string;
  status: ChainConnectionStatus;
  /** The active connection for this chain, or `undefined` when none resolved. */
  connection?: ChainConnection;
  /** True IFF the chain is not globally covered (the user may set a local override). */
  manualFieldEnabled: boolean;
}

/** The full, serialisable-shaped network-settings model. */
export interface NetworkSettingsModel {
  /** The global base connection in force (if any). */
  global?: ChainConnection;
  /** The per-chain resolved rows, one per supported chain. */
  chains: ChainConnectionRow[];
  /** Consumer-supplied read-only flag, carried verbatim (UI concern). */
  locked: boolean;
}

/** Options for {@link createConnectionResolver}. */
export interface ConnectionResolverOptions {
  /** The chains the Network tab renders a row for. */
  supportedChains: string[];
  /** The operator-injected global base connection (a Pythia gateway or a node). */
  global?: ChainConnection;
  /** User-set per-chain override connections, keyed by chainId. */
  local: Record<string, ChainConnection | undefined>;
  /** Read-only flag from the consumer (UI concern; carried verbatim). */
  locked: boolean;
}

/** The resolver: derive the whole model, or a single chain's row. */
export interface ConnectionResolver {
  /** Resolve the full per-chain network-settings model. */
  resolve(): Promise<NetworkSettingsModel>;
  /** Resolve a single chain's row (targeted lookup). */
  resolveChain(chainId: string): Promise<ChainConnectionRow>;
}

/**
 * Create a two-tier (global ⊕ local) per-chain connection resolver. Coverage is
 * read dynamically from `global.health()`.
 */
export function createConnectionResolver(
  options: ConnectionResolverOptions,
): ConnectionResolver {
  const { supportedChains, global, local, locked } = options;

  async function globalCoverage(): Promise<string[]> {
    if (!global) return [];
    const health = await global.health();
    return health.reachable ? health.coveredChains : [];
  }

  function deriveRow(
    chainId: string,
    coveredChains: string[],
  ): ChainConnectionRow {
    const globallyCovered = coveredChains.includes(chainId);
    const localOverride = local[chainId];
    const globalIsLive = coveredChains.length > 0;

    if (globallyCovered) {
      return {
        chainId,
        status: "live-global",
        connection: global,
        manualFieldEnabled: false,
      };
    }
    if (localOverride) {
      return {
        chainId,
        status: "live-local",
        connection: localOverride,
        manualFieldEnabled: true,
      };
    }
    return {
      chainId,
      status: globalIsLive ? "missing" : "not-connected",
      connection: undefined,
      manualFieldEnabled: true,
    };
  }

  return {
    async resolve(): Promise<NetworkSettingsModel> {
      const coveredChains = await globalCoverage();
      return {
        global,
        locked,
        chains: supportedChains.map((chainId) =>
          deriveRow(chainId, coveredChains),
        ),
      };
    },

    async resolveChain(chainId: string): Promise<ChainConnectionRow> {
      const coveredChains = await globalCoverage();
      return deriveRow(chainId, coveredChains);
    },
  };
}
