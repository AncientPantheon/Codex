/**
 * useActiveWallet — read + switch the active kadena seed / ouro account.
 *
 * "Active" is runtime-only state (not persisted to the adapter) — it's
 * the consumer's notion of "which wallet is the user currently working
 * with" used by Transfer / CFM modal default sender, etc.
 *
 * Returns the active IDs + resolved entity objects (for convenience),
 * plus the two setter actions.
 */

import { useCodexStore } from "../provider/index.js";
import type { IKadenaSeed, IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

export interface ActiveWalletView {
  activeKadenaWalletId: string | null;
  activeKadenaWallet: IKadenaSeed | null;
  activeOuroAccountId: string | null;
  activeOuroAccount: IOuroAccount | null;
  setActiveKadenaWallet: (id: string | null) => void;
  setActiveOuroAccount: (id: string | null) => void;
}

export function useActiveWallet(): ActiveWalletView {
  const store = useCodexStore();
  const activeKadenaWalletId = store((s) => s.activeKadenaWalletId);
  const activeOuroAccountId = store((s) => s.activeOuroAccountId);
  const kadenaSeeds = store((s) => s.kadenaSeeds);
  const ouroAccounts = store((s) => s.ouroAccounts);
  const actions = store((s) => s.actions);

  return {
    activeKadenaWalletId,
    activeKadenaWallet:
      kadenaSeeds.find((s) => s.id === activeKadenaWalletId) ?? null,
    activeOuroAccountId,
    activeOuroAccount:
      ouroAccounts.find((a) => a.id === activeOuroAccountId) ?? null,
    setActiveKadenaWallet: actions.setActiveKadenaWallet,
    setActiveOuroAccount: actions.setActiveOuroAccount,
  };
}
