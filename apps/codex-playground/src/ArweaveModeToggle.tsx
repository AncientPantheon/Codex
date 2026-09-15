// ============================================================================
// ArweaveModeToggle — the PG-02 mock ⇄ real Arweave toggle.
//
// DEFAULT is MOCK+OFFLINE: the app boots mock; the real adapter is NOT
// constructed until the user explicitly flips to real. The toggle carries:
//   - a gateway URL text input (labeled /gateway/i) defaulting to the REAL
//     Arweave mainnet reference gateway (`DEFAULT_GATEWAY_URL` =
//     `https://arweave.net`), fed to `createGatewayPool` by the real wiring
//     when real mode is active — the deliberate default is real mainnet
//     reads, not a testnet placeholder, so balance/send behavior reflects
//     the real chain out of the box. The user-editable input is the escape
//     hatch: point it at a testnet/local gateway during development by
//     typing over the default;
//   - a button flipping mock ⇄ real;
//   - a VISIBLE `role="alert"` funds-safety warning shown ONLY in real mode
//     (real mode transacts against the configured gateway with real funds —
//     the warning exists so a user flipping to real understands that before
//     signing anything).
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
 * The DEFAULT gateway URL the toggle's input seeds. The REAL Arweave mainnet
 * reference gateway — deliberately `https://arweave.net`, not a testnet/local
 * placeholder, so real-mode balance reads and sends reflect the actual chain
 * by default. The user-editable "Gateway URL" input on this same component
 * remains the escape hatch for pointing at a testnet/alternate gateway during
 * development.
 */
export const DEFAULT_GATEWAY_URL = "https://arweave.net" as const;

export interface ArweaveModeToggleProps {
  /** The initial mode; defaults to mock+offline (funds-safety). */
  initialMode?: ArweaveWiringMode;
  /** The initial gateway URL; defaults to the real mainnet `DEFAULT_GATEWAY_URL`. */
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
          Real mode transacts against the configured gateway using REAL funds.
          The default gateway is Arweave mainnet — any send you confirm here
          executes for real. Point the Gateway URL above at a testnet/local
          gateway instead if you want to test without real funds.
        </p>
      ) : null}
    </section>
  );
}

export default ArweaveModeToggle;
