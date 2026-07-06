// ============================================================================
// ForeignChainsWiring — the playground's app-side wiring of the E4 generic
// Foreign Chains tab to the concrete Arweave panel (the wiring E4 scope-fenced
// out to E5).
//
// `buildArweaveWiring({ mode })` builds a fresh `createForeignChainRegistry()`
// INSTANCE, registers the mode's adapter (mock in mock mode), and returns:
//   - `foreignChains`      — `registry.list()` (the injected id list the generic
//                            tab dispatches off; NO module-global accessor, D3 F-001)
//   - `foreignChainPanels` — `{ [ARWEAVE_CHAIN_ID]: ArweavePanel }` (the app wires
//                            the panel; codex-ui stays Arweave-free — no edge)
//   - `panelDeps`          — the E4 `ArweavePanelDeps` bundle fed into the panel
//                            context provider
//
// The `mode` param keeps the wiring MODE-SWAPPABLE for the real toggle (T15.6
// adds `ARWEAVE_WIRING_MODE_REAL` + the real adapter/seams; this file owns the
// switch). The `ForeignChainsWiring` component mounts the wired tab wrapped in
// the `ArweavePanelProvider` so the panel + its 5 areas read their fake seams.
// ============================================================================

import type { ReactElement } from "react";

import { createForeignChainRegistry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import {
  ArweavePanel,
  ArweavePanelProvider,
  type ArweavePanelDeps,
} from "@ancientpantheon/codex-arweave/panel";
import { ForeignChainsTab } from "@ancientpantheon/codex-ui/ui/foreign-chains";
import type { ForeignChainPanels } from "@ancientpantheon/codex-ui/ui/foreign-chains";

import type { GatewayPool } from "@ancientpantheon/arweave-core";
import type { ForeignChainAdapter } from "@ancientpantheon/codex-core";

import { buildMockPanelDeps, createMockArweaveAdapter } from "./mockArweaveAdapter";
import {
  buildRealPanelDeps,
  createRealArweaveAdapter,
} from "./realArweaveAdapter";
import { DEFAULT_GATEWAY_URL } from "./ArweaveModeToggle";

/** The mock wiring mode — the default, funds-safe, offline path. */
export const ARWEAVE_WIRING_MODE_MOCK = "mock" as const;

/** The real wiring mode — OPT-IN. Constructs the E1-E3 stack against a gateway. */
export const ARWEAVE_WIRING_MODE_REAL = "real" as const;

/** The set of Arweave wiring modes: the default mock and the opt-in real path. */
export type ArweaveWiringMode =
  | typeof ARWEAVE_WIRING_MODE_MOCK
  | typeof ARWEAVE_WIRING_MODE_REAL;

/** The assembled wiring the tab + the panel context consume. */
export interface ArweaveWiring {
  /** The injected id list — `registry.list()`, in registration order. */
  foreignChains: string[];
  /** The id → panel-component slot map the generic tab dispatches through. */
  foreignChainPanels: ForeignChainPanels;
  /** The E4 injected-seam bundle fed into the panel context provider. */
  panelDeps: ArweavePanelDeps;
}

export interface BuildArweaveWiringOptions {
  /** The wiring mode. Mock is the funds-safe default; real is opt-in. */
  mode: ArweaveWiringMode;
  /** The user-configured gateway URL fed to `createGatewayPool` in real mode.
   *  Defaults to the testnet/local `DEFAULT_GATEWAY_URL` (never mainnet). */
  gatewayUrl?: string;
  /** An injected gateway pool for real mode — automated tests pass a FAKE pool
   *  so the "real" path is exercised with ZERO live network. */
  pool?: GatewayPool;
}

/**
 * Build the mode's Arweave wiring: a fresh registry with the mode's adapter
 * registered, the `foreignChains` id list, the `foreignChainPanels` slot map,
 * and the panel-context deps. Mode-swappable — `mode === "real"` swaps the mock
 * adapter + fake seams for the real E1-E3 stack against the configured gateway.
 *
 * FUNDS-SAFETY: the real adapter/pool is constructed ONLY in the `mode === "real"`
 * branch. The default mock path never reaches `createRealArweaveAdapter`, so
 * building the default wiring opens no network connection.
 */
export function buildArweaveWiring({
  mode,
  gatewayUrl = DEFAULT_GATEWAY_URL,
  pool,
}: BuildArweaveWiringOptions): ArweaveWiring {
  const registry = createForeignChainRegistry();

  let adapter: ForeignChainAdapter;
  let panelDeps: ArweaveWiring["panelDeps"];

  if (mode === ARWEAVE_WIRING_MODE_REAL) {
    // OPT-IN real path — constructs the E1 adapter + E3 seams against the
    // configured gateway (or the injected fake pool in tests). Reached ONLY here.
    adapter = createRealArweaveAdapter({ gatewayUrl, pool });
    panelDeps = buildRealPanelDeps({ gatewayUrl, pool, adapter });
  } else {
    // The mock path (the default, funds-safe, offline). No network, no real keys.
    adapter = createMockArweaveAdapter();
    panelDeps = buildMockPanelDeps();
  }

  registry.register(adapter);

  // The app (never codex-ui) maps the concrete Arweave panel into the id slot.
  const foreignChainPanels: ForeignChainPanels = {
    [ARWEAVE_CHAIN_ID]: ArweavePanel,
  };

  return {
    foreignChains: registry.list(),
    foreignChainPanels,
    panelDeps,
  };
}

export interface ForeignChainsWiringProps {
  /** The wiring mode; defaults to mock+offline (funds-safety). */
  mode?: ArweaveWiringMode;
  /** The gateway URL fed to the real wiring (ignored in mock mode). */
  gatewayUrl?: string;
  /** An injected gateway pool for real mode (tests pass a fake — no live network). */
  pool?: GatewayPool;
}

/**
 * The wired Foreign Chains tab: the generic `ForeignChainsTab` fed the injected
 * id list + panel slot map, wrapped in the `ArweavePanelProvider` so the mounted
 * `ArweavePanel` + its 5 areas read their (fake, in mock mode) E1-E3 seams.
 */
export function ForeignChainsWiring({
  mode = ARWEAVE_WIRING_MODE_MOCK,
  gatewayUrl,
  pool,
}: ForeignChainsWiringProps = {}): ReactElement {
  const { foreignChains, foreignChainPanels, panelDeps } = buildArweaveWiring({
    mode,
    gatewayUrl,
    pool,
  });

  return (
    <ArweavePanelProvider deps={panelDeps}>
      <ForeignChainsTab
        foreignChains={foreignChains}
        foreignChainPanels={foreignChainPanels}
      />
    </ArweavePanelProvider>
  );
}

export default ForeignChainsWiring;
