/**
 * useWatchList — CRUD over the codex watchlist.
 *
 * Watchlist entries are read-only observation targets: address + label
 * + type, no keys. Distinct from address book (which is for transfer
 * recipients). Spec §C5 / §2.5.
 *
 * Note: spec §5.2 doesn't list useWatchList — Phase 5 codified its
 * inclusion (the store actions already exist, parity is the goal,
 * and watchlist management would otherwise be inaccessible through
 * the public hooks surface). See Phase 5 commit notes.
 *
 * Backup format: watchList does NOT round-trip via the v1.2 codex
 * backup (codec frozen at 1.2 excludes it). Cross-device sync via
 * Google Drive sub-export only.
 */

import { useCodexStore } from "../provider/index.js";
import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";

export interface WatchListView {
  entries: WatchListEntry[];
  addEntry: (entry: WatchListEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
}

export function useWatchList(): WatchListView {
  const store = useCodexStore();
  const entries = store((s) => s.watchList);
  const actions = store((s) => s.actions);

  return {
    entries,
    addEntry: actions.addWatchListEntry,
    deleteEntry: actions.deleteWatchListEntry,
  };
}
