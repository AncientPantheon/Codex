// The per-address BALANCE area. The rendered numeric token equals
// `winstonToAr(w)` EXACTLY (the bare string — no `" AR"` suffix, no scientific
// notation); the `AR` unit label is a SEPARATE adjacent element. Balance is read
// through the injected E2 `getBalance` seam (winston bigint); a rejection surfaces
// a clear non-crash error state instead of the numeric token.

import * as React from "react";

import { winstonToAr } from "@ancientpantheon/arweave-core";

export interface BalanceAreaProps {
  /** The selected Arweave address the balance is scoped to. */
  address: string;
  /** E2 balance read: resolves the winston bigint for an address. */
  getBalance: (address: string) => Promise<bigint>;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; amount: string }
  | { status: "error" };

export function BalanceArea({ address, getBalance }: BalanceAreaProps): React.ReactElement {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  React.useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    getBalance(address)
      .then((winston) => {
        if (active) setState({ status: "ready", amount: winstonToAr(winston) });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [address, getBalance]);

  const copyAddress = React.useCallback(() => {
    void navigator.clipboard?.writeText(address);
  }, [address]);

  return (
    <div data-testid="balance-area">
      {state.status === "error" ? (
        <div data-testid="balance-error">Could not load the balance. Please try again.</div>
      ) : state.status === "ready" ? (
        <div>
          {/* Numeric token stays bare (=== winstonToAr); the unit label is its own node. */}
          <span data-testid="balance-amount">{state.amount}</span>{" "}
          <span data-testid="balance-unit">AR</span>
        </div>
      ) : (
        <div>Loading balance…</div>
      )}

      <button type="button" data-testid="balance-copy-address" onClick={copyAddress}>
        Copy address
      </button>

      <div data-testid="balance-receive">Receive to {address}</div>
    </div>
  );
}

export default BalanceArea;
