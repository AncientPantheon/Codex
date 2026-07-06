/**
 * <ActiveWalletPicker> — switch the active kadena seed and/or ouro account.
 *
 * Renders two dropdowns by default: one for kadena seeds, one for ouro
 * accounts. Consumers can override either or both via render-prop slots,
 * or take full control with the `render` prop.
 *
 * Reads from useActiveWallet (for the current selections) + useCodex
 * (for the lists). Mutations go through useActiveWallet's setters,
 * which are non-persistent (active selection is runtime-only).
 */

import * as React from "react";
import { useActiveWallet } from "../hooks/useActiveWallet.js";
import { useCodex } from "../hooks/useCodex.js";
import type { IStoaChainSeed, IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

export interface ActiveWalletPickerRenderArgs {
  kadenaSeeds: IStoaChainSeed[];
  ouroAccounts: IOuroAccount[];
  activeStoaChainWalletId: string | null;
  activeOuroAccountId: string | null;
  setActiveStoaChainWallet: (id: string | null) => void;
  setActiveOuroAccount: (id: string | null) => void;
}

export interface ActiveWalletPickerProps {
  className?: string;
  render?: (args: ActiveWalletPickerRenderArgs) => React.ReactNode;
  /** Override individual kadena-seed option rendering. */
  renderStoaChainSeedOption?: (seed: IStoaChainSeed) => React.ReactNode;
  /** Override individual ouro-account option rendering. */
  renderOuroAccountOption?: (account: IOuroAccount) => React.ReactNode;
  /** Hide the kadena seed picker (e.g. consumer doesn't surface it). */
  hideStoaChainSeedPicker?: boolean;
  /** Hide the ouro account picker. */
  hideOuroAccountPicker?: boolean;
}

export function ActiveWalletPicker({
  className,
  render,
  renderStoaChainSeedOption,
  renderOuroAccountOption,
  hideStoaChainSeedPicker,
  hideOuroAccountPicker,
}: ActiveWalletPickerProps): React.JSX.Element {
  const codex = useCodex();
  const active = useActiveWallet();

  const renderArgs: ActiveWalletPickerRenderArgs = {
    kadenaSeeds: codex.kadenaSeeds,
    ouroAccounts: codex.ouroAccounts,
    activeStoaChainWalletId: active.activeStoaChainWalletId,
    activeOuroAccountId: active.activeOuroAccountId,
    setActiveStoaChainWallet: active.setActiveStoaChainWallet,
    setActiveOuroAccount: active.setActiveOuroAccount,
  };

  if (render) {
    return <>{render(renderArgs)}</>;
  }

  return (
    <div className={className}>
      {!hideStoaChainSeedPicker && (
        <label>
          StoaChain seed
          <select
            value={active.activeStoaChainWalletId ?? ""}
            onChange={(e) =>
              active.setActiveStoaChainWallet(e.target.value || null)
            }
          >
            <option value="">— none —</option>
            {codex.kadenaSeeds.map((seed) =>
              renderStoaChainSeedOption ? (
                <React.Fragment key={seed.id}>
                  {renderStoaChainSeedOption(seed)}
                </React.Fragment>
              ) : (
                <option key={seed.id} value={seed.id}>
                  {seed.name ?? seed.id} ({seed.seedType})
                </option>
              )
            )}
          </select>
        </label>
      )}
      {!hideOuroAccountPicker && (
        <label>
          Ouro account
          <select
            value={active.activeOuroAccountId ?? ""}
            onChange={(e) =>
              active.setActiveOuroAccount(e.target.value || null)
            }
          >
            <option value="">— none —</option>
            {codex.ouroAccounts.map((acc) =>
              renderOuroAccountOption ? (
                <React.Fragment key={acc.id}>
                  {renderOuroAccountOption(acc)}
                </React.Fragment>
              ) : (
                <option key={acc.id} value={acc.id}>
                  {acc.name ?? acc.address}
                  {acc.isPrime ? " ★" : ""}
                </option>
              )
            )}
          </select>
        </label>
      )}
    </div>
  );
}
