// The CODEX BACKUPS HISTORY area of the Arweave panel
// (`arweave-upload-categories` addendum, Part 2).
//
// A dedicated, filtered view over the SAME Library data `LibraryArea` already
// lists — a distinct, small sibling component (not a sub-section grafted
// into `LibraryArea.tsx`) so `LibraryArea` stays the generic "every upload"
// list and this one stays the specific "just my codex backups" list, mirroring
// how `CodexBackupArea` is already its own dedicated component mounted
// alongside `LibraryArea` in the panel's Library category rather than folded
// into `UploadArea`. No `LibraryEntry` schema change and no new persistence
// seam: `Codex-Category` is already readable off each entry's existing `tags`
// array (`buildUploadTags`'s own optional `Codex-Category` tag), so this
// component filters CLIENT-SIDE over the SAME `listLibrary`/`openUrl` props
// `LibraryArea` is given — reusing those two injected seams verbatim rather
// than inventing a third "list codex backups" seam.
//
// Version label: the `Codex-App-Version` tag value when present (T1's real
// lineage tagging); falling back to a `createdAt`/status-derived label when
// absent — covers backups made before that tagging landed, or where the
// export JSON's `lastUpdatedAt` was missing/malformed (T1's own defensive
// derivation already tolerates that at upload time).
//
// Lineage: entries sharing the same `Codex-App-Id` tag value render the SAME
// lineage badge text next to each entry — genuinely legible (a reader can see
// which backups share an app identity at a glance) without collapsing the
// newest-first ordering into separate per-lineage lists.

import * as React from "react";
import { useCallback, useEffect, useState } from "react";

import type { GatewayPool } from "@ancientpantheon/arweave-core";

import type { LibraryEntry } from "../library/types.js";

const TAG_CODEX_CATEGORY = "Codex-Category";
const TAG_CODEX_APP_VERSION = "Codex-App-Version";
const TAG_CODEX_APP_ID = "Codex-App-Id";
const CODEX_BACKUP_CATEGORY = "codex-backup";

export interface CodexBackupHistoryAreaProps {
  /** The owner address the history is scoped to. */
  owner: string;
  /** The gateway pool the open-link path runs through. */
  pool: GatewayPool;
  /** The SAME E3 list seam `LibraryArea` uses — this component filters the
   *  result client-side rather than being given a pre-filtered list. */
  listLibrary: (owner: string) => Promise<LibraryEntry[]>;
  /** The SAME E3 openUrl seam `LibraryArea`/`UploadArea` already use. */
  openUrl: (id: string, opts: { pool: GatewayPool }) => string;
}

/** Newest-first by `createdAt` DESC, with a stable `id` DESC tiebreak —
 *  the SAME convention `LibraryArea`/`sortNewestFirst` (library/types.ts)
 *  already apply. */
function sortNewestFirst(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });
}

function tagValue(entry: LibraryEntry, name: string): string | undefined {
  return entry.tags.find((t) => t.name === name)?.value;
}

/** Only the entries tagged `Codex-Category: codex-backup`. */
function filterCodexBackups(entries: LibraryEntry[]): LibraryEntry[] {
  return entries.filter((e) => tagValue(e, TAG_CODEX_CATEGORY) === CODEX_BACKUP_CATEGORY);
}

/** The `Codex-App-Version` tag value when present; otherwise a legible
 *  fallback built from `createdAt` + `status` — covers backups made before
 *  T1's lineage tagging landed, or a source export whose `lastUpdatedAt` was
 *  missing/malformed. */
function versionLabel(entry: LibraryEntry): string {
  const version = tagValue(entry, TAG_CODEX_APP_VERSION);
  if (version !== undefined) return version;
  return `${new Date(entry.createdAt).toISOString()} (${entry.status})`;
}

export function CodexBackupHistoryArea(
  props: CodexBackupHistoryAreaProps,
): React.ReactElement {
  const { owner, pool, listLibrary, openUrl } = props;

  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const rows = await listLibrary(owner);
    setEntries(sortNewestFirst(filterCodexBackups(rows)));
    setLoaded(true);
  }, [listLibrary, owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div data-testid="codex-backup-history-area">
      <h4>Codex Backups</h4>

      {loaded && entries.length === 0 ? (
        <div data-testid="codex-backup-history-empty">No codex backups yet.</div>
      ) : null}

      <ul>
        {entries.map((entry) => {
          const appId = tagValue(entry, TAG_CODEX_APP_ID);
          return (
            <li key={entry.id} data-testid="codex-backup-history-entry">
              <span>{entry.id}</span>
              <span data-testid="codex-backup-history-version">{versionLabel(entry)}</span>
              {appId !== undefined ? (
                <span data-testid="codex-backup-history-lineage">{appId}</span>
              ) : null}
              <a
                data-testid="codex-backup-history-open-link"
                href={openUrl(entry.id, { pool })}
              >
                Open
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default CodexBackupHistoryArea;
