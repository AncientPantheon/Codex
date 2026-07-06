// The LIBRARY area of the Arweave panel (E-10).
//
// Presentation over E3's Library seam: lists the owner's entries NEWEST-FIRST
// (distinguishable pending/final badges); opens each via a HEALTHY gateway
// (the injected `openUrl(id, { pool })` composes the URL from the pool's healthy
// endpoint — never a hardcoded arweave.net); renders a manifest entry as a SINGLE
// link; and offers rebuild-from-chain, which re-reads the list after the injected
// `rebuildLibrary` reconciles the store.
//
// Holds ONLY public on-chain metadata (N-07) — no key material ever reaches here.

import * as React from "react";
import { useCallback, useEffect, useState } from "react";

import type { GatewayPool } from "@ancientpantheon/arweave-core";

import type { LibraryEntry } from "../library/types.js";

export interface LibraryAreaProps {
  /** The owner address the Library is scoped to. */
  owner: string;
  /** The gateway pool the open/rebuild paths run through. */
  pool: GatewayPool;
  /** E3 list: the owner's Library entries (the store returns them newest-first). */
  listLibrary: (owner: string) => Promise<LibraryEntry[]>;
  /** E3 openUrl: composes a healthy-gateway URL for an id. */
  openUrl: (id: string, opts: { pool: GatewayPool }) => string;
  /** E3 rebuild-from-chain: reconciles the Library for an owner. */
  rebuildLibrary: (owner: string, opts: { pool: GatewayPool }) => Promise<void>;
}

/** Newest-first by `createdAt` DESC, with a stable `id` DESC tiebreak. */
function sortNewestFirst(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });
}

export function LibraryArea(props: LibraryAreaProps): React.ReactElement {
  const { owner, pool, listLibrary, openUrl, rebuildLibrary } = props;

  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const rows = await listLibrary(owner);
    setEntries(sortNewestFirst(rows));
    setLoaded(true);
  }, [listLibrary, owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onRebuild(): Promise<void> {
    await rebuildLibrary(owner, { pool });
    await refresh();
  }

  return (
    <div data-testid="library-area">
      <button
        type="button"
        data-testid="library-rebuild"
        onClick={() => {
          void onRebuild();
        }}
      >
        Rebuild from chain
      </button>

      {loaded && entries.length === 0 ? (
        <div data-testid="library-empty">
          No uploads yet. Rebuild from chain to recover any existing entries.
        </div>
      ) : null}

      <ul>
        {entries.map((entry) => (
          <li key={entry.id} data-testid="library-entry">
            <span>{entry.id}</span>
            <span>{entry.status === "pending" ? "pending" : "final"}</span>
            {entry.manifest?.isManifest ? (
              <span data-testid="library-manifest-badge">manifest</span>
            ) : null}
            <a
              data-testid="library-open-link"
              href={openUrl(entry.id, { pool })}
            >
              Open
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default LibraryArea;
