/**
 * The Node `SqliteLibraryStore` — the concrete `node:sqlite` impl behind E3's
 * `LibraryStore` seam (E-07 carry / G-001).
 *
 * `node:sqlite` (`DatabaseSync`) requires Node >=22.5 while `engines.node` is
 * `>=20`, so the backend is reached ONLY through a LAZY `await importSqlite()`
 * inside `open` — there is deliberately NO top-level static
 * `import ... from "node:sqlite"` (a static import would crash the whole module
 * on Node 20, where the builtin does not exist).
 *
 * The availability gate is a TRY/CATCH on the injected probe, NOT a string
 * version compare: a lexical compare is a real bug (`"22.10" < "22.5"` is `true`
 * by string ordering even though 22.10 > 22.5), so the runtime loadability of
 * `node:sqlite` is the only truth. On failure `open` throws a clear typed error
 * naming the >=22.5 requirement and the Memory/IndexedDB alternative.
 *
 * Persistence is PUBLIC-ONLY (N-07): the row columns mirror the `LibraryEntry`
 * public shape exactly — there is no column that could carry a JWK, ciphertext,
 * or password. Ordering and reconcile-merge reuse the shared `sortNewestFirst`
 * and `mergeReconciled` helpers so behaviour is byte-for-behaviour identical to
 * the Memory and IndexedDB impls.
 */

import {
  type LibraryEntry,
  type LibraryStatus,
  type LibraryStore,
  mergeReconciled,
  sortNewestFirst,
} from "./types.js";

/** The narrow structural surface of `node:sqlite`'s `DatabaseSync` this store
 *  uses — typed locally so the module never statically references the builtin. */
interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  close(): void;
}

interface StatementLike {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** The `node:sqlite` module shape (only `DatabaseSync` is needed). */
interface NodeSqliteModuleLike {
  DatabaseSync: new (location: string) => DatabaseSyncLike;
}

/** The raw row shape persisted in the `entries` table (public columns only). */
interface EntryRow {
  id: string;
  owner: string;
  itemId: string;
  contentType: string;
  status: string;
  createdAt: number;
  tags: string;
  manifest: number;
}

/** Options for {@link SqliteLibraryStore.open}. */
export interface OpenSqliteLibraryStoreOptions {
  /** `":memory:"` for an ephemeral DB or a filesystem path for persistence. */
  location: ":memory:" | string;
  /**
   * The availability probe — resolves the `node:sqlite` module when loadable,
   * rejects otherwise. Injectable so a test can model absence (Node <22.5)
   * without changing the runtime. Defaults to `() => import("node:sqlite")`.
   */
  importSqlite?: () => Promise<unknown>;
}

const AVAILABILITY_MESSAGE =
  "SqliteLibraryStore requires Node >=22.5 (node:sqlite); " +
  "use IndexedDBLibraryStore or MemoryLibraryStore on older Node.";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    itemId TEXT NOT NULL,
    contentType TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    tags TEXT NOT NULL,
    manifest INTEGER NOT NULL DEFAULT 0
  )
`;

function rowToEntry(row: EntryRow): LibraryEntry {
  const base: LibraryEntry = {
    id: row.id,
    owner: row.owner,
    itemId: row.itemId,
    contentType: row.contentType,
    status: row.status as LibraryStatus,
    createdAt: row.createdAt,
    tags: JSON.parse(row.tags) as LibraryEntry["tags"],
  };
  return row.manifest ? { ...base, manifest: { isManifest: true } } : base;
}

export class SqliteLibraryStore implements LibraryStore {
  private constructor(private readonly db: DatabaseSyncLike) {}

  /**
   * Opens a SQLite-backed Library store. Runs the availability probe FIRST — on
   * rejection (e.g. `ERR_UNKNOWN_BUILTIN_MODULE` on Node <22.5) it throws the
   * clear typed error rather than surfacing an opaque module-load failure.
   */
  static async open(
    opts: OpenSqliteLibraryStoreOptions,
  ): Promise<SqliteLibraryStore> {
    const probe = opts.importSqlite ?? (() => import("node:sqlite"));

    let mod: NodeSqliteModuleLike;
    try {
      mod = (await probe()) as NodeSqliteModuleLike;
    } catch (cause) {
      throw new Error(AVAILABILITY_MESSAGE, { cause });
    }

    const db = new mod.DatabaseSync(opts.location);
    db.exec(CREATE_TABLE_SQL);
    return new SqliteLibraryStore(db);
  }

  async append(entry: LibraryEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO entries (id, owner, itemId, contentType, status, createdAt, tags, manifest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           owner = excluded.owner,
           itemId = excluded.itemId,
           contentType = excluded.contentType,
           status = excluded.status,
           createdAt = excluded.createdAt,
           tags = excluded.tags,
           manifest = excluded.manifest`,
      )
      .run(
        entry.id,
        entry.owner,
        entry.itemId,
        entry.contentType,
        entry.status,
        entry.createdAt,
        JSON.stringify(entry.tags),
        entry.manifest ? 1 : 0,
      );
  }

  async get(id: string): Promise<LibraryEntry | undefined> {
    const row = this.db
      .prepare("SELECT * FROM entries WHERE id = ?")
      .get(id) as EntryRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  async updateStatus(id: string, status: LibraryStatus): Promise<void> {
    this.db
      .prepare("UPDATE entries SET status = ? WHERE id = ?")
      .run(status, id);
  }

  async list(owner: string): Promise<LibraryEntry[]> {
    const rows = this.db
      .prepare("SELECT * FROM entries WHERE owner = ?")
      .all(owner) as EntryRow[];
    return sortNewestFirst(rows.map(rowToEntry));
  }

  async reconcile(_owner: string, incoming: LibraryEntry[]): Promise<void> {
    for (const entry of incoming) {
      const local = await this.get(entry.id);
      await this.append(local ? mergeReconciled(local, entry) : entry);
    }
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM entries");
  }

  /** Closes the underlying `DatabaseSync` handle. */
  dispose(): void {
    this.db.close();
  }
}
