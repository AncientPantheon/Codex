/**
 * The in-memory `LibraryStore` reference impl (node/test default).
 *
 * Map-backed, keyed by entry id. This is the impl the Library-flow tests and the
 * node conformance suite use — no real IndexedDB/SQLite. It shares the ordering
 * and reconcile-merge helpers with the IndexedDB impl so both seams behave
 * identically.
 */

import {
  type LibraryEntry,
  type LibraryStatus,
  type LibraryStore,
  mergeReconciled,
  sortNewestFirst,
} from "./types.js";

export class MemoryLibraryStore implements LibraryStore {
  private readonly entries = new Map<string, LibraryEntry>();

  async append(entry: LibraryEntry): Promise<void> {
    this.entries.set(entry.id, { ...entry });
  }

  async get(id: string): Promise<LibraryEntry | undefined> {
    const found = this.entries.get(id);
    return found ? { ...found } : undefined;
  }

  async updateStatus(id: string, status: LibraryStatus): Promise<void> {
    const found = this.entries.get(id);
    if (!found) {
      return;
    }
    this.entries.set(id, { ...found, status });
  }

  async list(owner: string): Promise<LibraryEntry[]> {
    const owned = [...this.entries.values()].filter((e) => e.owner === owner);
    return sortNewestFirst(owned).map((e) => ({ ...e }));
  }

  async reconcile(_owner: string, incoming: LibraryEntry[]): Promise<void> {
    for (const entry of incoming) {
      const local = this.entries.get(entry.id);
      this.entries.set(
        entry.id,
        local ? mergeReconciled(local, entry) : { ...entry },
      );
    }
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}
