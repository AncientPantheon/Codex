/**
 * useAddressBook — CRUD over the codex address book.
 *
 * Address book entries are the "send to" autocomplete source for
 * Transfer / CFM modals (vs. watchlist which is "observe balance of").
 * Round-trips with the v1.2 codex backup file (spec §D2).
 *
 * updateEntry refreshes updatedAt automatically in the store action;
 * consumers don't need to pass it.
 */

import { useCodexStore } from "../provider/index.js";
import type { AddressBookEntry } from "@ancientpantheon/codex-ouronet/types";

export interface AddressBookView {
  entries: AddressBookEntry[];
  addEntry: (entry: AddressBookEntry) => Promise<void>;
  updateEntry: (
    id: string,
    updates: Partial<Omit<AddressBookEntry, "id" | "createdAt">>
  ) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
}

export function useAddressBook(): AddressBookView {
  const store = useCodexStore();
  const entries = store((s) => s.addressBook);
  const actions = store((s) => s.actions);

  return {
    entries,
    addEntry: actions.addAddressBookEntry,
    updateEntry: actions.updateAddressBookEntry,
    deleteEntry: actions.deleteAddressBookEntry,
  };
}
