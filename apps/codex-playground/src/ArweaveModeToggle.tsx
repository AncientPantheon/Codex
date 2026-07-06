// ============================================================================
// ArweaveModeToggle — the PG-02 mock ⇄ real Arweave toggle (funds-safety UI).
//
// DEFAULT is MOCK+OFFLINE (funds-safety): the app boots mock; the real adapter
// is NOT constructed until the user explicitly flips to real. The toggle carries:
//   - a gateway URL text input (labeled /gateway/i) defaulting to a TESTNET/LOCAL
//     endpoint (`DEFAULT_GATEWAY_URL` — NEVER mainnet `arweave.net`), fed to
//     `createGatewayPool` by the real wiring when real mode is active;
//   - a button flipping mock ⇄ real;
//   - a VISIBLE `role="alert"` funds-safety warning shown ONLY in real mode
//     (real mode transacts against the configured gateway — do not point it at
//     mainnet with real funds).
//
// The toggle owns only the mode + gateway-URL UI state and reports it upward via
// `onModeChange`/`onGatewayUrlChange`; the mode-aware adapter construction lives
// in `ForeignChainsWiring.buildArweaveWiring` (which stays lazy — the real
// adapter/pool is built only when mode === "real").
// ============================================================================

import { useCallback, useState, type ReactElement } from "react";

import {
  ARWEAVE_WIRING_MODE_MOCK,
  ARWEAVE_WIRING_MODE_REAL,
  type ArweaveWiringMode,
} from "./ForeignChainsWiring";

/**
 * The DEFAULT gateway URL the toggle's input seeds. A LOCAL/testnet endpoint
 * (the arlocal/localhost dev gateway) — deliberately NOT the arweave.net
 * mainnet gateway. Pointing the default at mainnet would let a real-mode
 * transaction spend real funds by accident; the funds-safety invariant is that
 * this default NEVER contains "arweave.net".
 */
export const DEFAULT_GATEWAY_URL = "http://localhost:1984" as const;

export interface ArweaveModeToggleProps {
  /** The initial mode; defaults to mock+offline (funds-safety). */
  initialMode?: ArweaveWiringMode;
  /** The initial gateway URL; defaults to the testnet/local `DEFAULT_GATEWAY_URL`. */
  initialGatewayUrl?: string;
  /** Reports mode flips so the app can rebuild the (mode-aware) wiring. */
  onModeChange?: (mode: ArweaveWiringMode) => void;
  /** Reports gateway-URL edits so the real wiring rebuilds its pool. */
  onGatewayUrlChange?: (url: string) => void;
}

/**
 * The mock ⇄ real toggle + the configurable gateway URL input + the real-mode
 * funds-safety warning. Boots in MOCK mode (default) — the real path is opt-in.
 */
export function ArweaveModeToggle({
  initialMode = ARWEAVE_WIRING_MODE_MOCK,
  initialGatewayUrl = DEFAULT_GATEWAY_URL,
  onModeChange,
  onGatewayUrlChange,
}: ArweaveModeToggleProps = {}): ReactElement {
  const [mode, setMode] = useState<ArweaveWiringMode>(initialMode);
  const [gatewayUrl, setGatewayUrl] = useState<string>(initialGatewayUrl);

  const isReal = mode === ARWEAVE_WIRING_MODE_REAL;

  const toggleMode = useCallback(() => {
    const next: ArweaveWiringMode = isReal
      ? ARWEAVE_WIRING_MODE_MOCK
      : ARWEAVE_WIRING_MODE_REAL;
    setMode(next);
    onModeChange?.(next);
  }, [isReal, onModeChange]);

  const onGatewayInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setGatewayUrl(value);
      onGatewayUrlChange?.(value);
    },
    [onGatewayUrlChange],
  );

  return (
    <section aria-label="Arweave mode">
      <p>
        Current mode: <strong>{isReal ? "real" : "mock (offline)"}</strong>
      </p>

      <label>
        Gateway URL
        <input
          type="text"
          name="arweave-gateway-url"
          value={gatewayUrl}
          onChange={onGatewayInput}
        />
      </label>

      <button type="button" onClick={toggleMode}>
        {isReal ? "Switch to mock (offline)" : "Switch to real Arweave"}
      </button>

      {isReal ? (
        <p role="alert">
          Real mode transacts against the configured gateway. Do NOT point it at
          Arweave mainnet with real funds — use a testnet/local gateway and a
          throwaway keyfile only.
        </p>
      ) : null}
    </section>
  );
}

export default ArweaveModeToggle;
