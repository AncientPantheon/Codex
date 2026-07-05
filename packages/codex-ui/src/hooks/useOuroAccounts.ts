/**
 * useOuroAccounts — CRUD over ouro (Ѻ./Σ.) accounts.
 *
 * CodexPrime protection (spec §B2) is enforced inside the store's
 * deleteOuroAccount action — throws CodexPrimeProtectedError when
 * called on the isPrime: true account. Consumers don't need a
 * separate guard here; the action handles it.
 *
 * isPrime auto-flagging on the first added account also happens in
 * the store action (so a fresh codex's CodexPrime is wired up
 * regardless of how the account was created — onboarding, restore,
 * etc.).
 */

import { useCodexStore } from "../provider/index.js";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

export interface OuroAccountsView {
  accounts: IOuroAccount[];
  addAccount: (account: IOuroAccount) => Promise<void>;
  updateAccount: (account: IOuroAccount) => Promise<void>;
  /** Throws CodexPrimeProtectedError if called on the CodexPrime account. */
  deleteAccount: (id: string) => Promise<void>;
}

export function useOuroAccounts(): OuroAccountsView {
  const store = useCodexStore();
  const accounts = store((s) => s.ouroAccounts);
  const actions = store((s) => s.actions);

  return {
    accounts,
    addAccount: actions.addOuroAccount,
    updateAccount: actions.updateOuroAccount,
    deleteAccount: actions.deleteOuroAccount,
  };
}
