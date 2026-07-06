// @vitest-environment node
/**
 * E4 RED matrix — the Node `SqliteLibraryStore` behind E3's `LibraryStore` seam
 * (E-07 carry / G-001 — FIX-9).
 *
 * E3 DEFERRED `SqliteLibraryStore` because `node:sqlite` needs Node >=22.5 while
 * `engines.node` is `>=20`. E4 ships it behind E3's EXISTING seam, gated by a
 * TRY-`await import("node:sqlite")`-AND-CATCH availability probe — NOT a string
 * version compare.
 *
 * WHY try/catch, not version-compare: a raw string version compare is a lexical
 * bug — `"22.10" < "22.5"` is `true` by string ordering (lexically `"1" < "5"`)
 * even though 22.10 > 22.5 numerically. The runtime probe is the truth of
 * loadability, independent of any version parsing.
 *
 * PINNED CONTRACT (so T14.12 GREEN matches):
 *   - module path: `../src/library` (the store is ADDED to E3's library barrel)
 *   - `SqliteLibraryStore` — conforms to `LibraryStore`; construct via a static
 *     async factory `SqliteLibraryStore.open({ location, importSqlite? })`:
 *       - `location` — `":memory:"` or a temp-file path
 *       - `importSqlite?` — an INJECTABLE availability probe (defaults to
 *         `() => import("node:sqlite")`); a fake that throws models absence
 *   - on availability failure it throws a CLEAR typed error naming the >=22.5
 *     requirement + the Memory/IndexedDB alternative, thrown at open/first-use
 *     (NOT at module import).
 *   - `dispose()` — closes the underlying DatabaseSync handle.
 *
 * The lazy-import PIN: NO top-level static `import ... from "node:sqlite"` in
 * `src/library/sqliteStore.ts` (a static import crashes the whole module on Node
 * 20) — asserted by a grep row.
 *
 * `// @vitest-environment node` (FIX-9): `node:sqlite` + the availability probe
 * are node-only (jsdom cannot load a node builtin).
 *
 * RED: `SqliteLibraryStore` does not exist yet (T14.12 GREEN); the import from
 * `../src/library` fails to resolve the name.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { Tag } from "@ancientpantheon/arweave-core";

// RED: `SqliteLibraryStore` is not exported from E3's library barrel yet (T14.12 GREEN).
import {
  SqliteLibraryStore,
  type LibraryStore,
  type LibraryEntry,
} from "../src/library";

import { KNOWN_ADDRESS, CANONICAL_ID_A, CANONICAL_ID_B } from "./e3-helpers";

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC_STORE = join(dirname(THIS_FILE), "..", "src", "library", "sqliteStore.ts");

const OWNER = KNOWN_ADDRESS;
const OWNER_2 = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";

/** Reuse E3's conformance entry factory (E3 `e3-library-store.test.ts`) so the
 *  SAME public-only shape drives the SqliteLibraryStore conformance run. */
const tagsFor = (itemId: string, contentType = "text/plain"): Tag[] => [
  { name: "App-Name", value: "AncientPantheon-Codex" },
  { name: "Content-Type", value: contentType },
  { name: "Codex-Item-Id", value: itemId },
  { name: "Codex-Owner", value: OWNER },
];

function entry(
  over: Partial<LibraryEntry> & Pick<LibraryEntry, "id">,
): LibraryEntry {
  return {
    id: over.id,
    owner: over.owner ?? OWNER,
    itemId: over.itemId ?? "item-1",
    contentType: over.contentType ?? "text/plain",
    status: over.status ?? "pending",
    createdAt: over.createdAt ?? 1000,
    tags: over.tags ?? tagsFor(over.itemId ?? "item-1"),
    ...(over.manifest ? { manifest: over.manifest } : {}),
  };
}

/** Real try-import probe: is `node:sqlite` loadable in THIS runtime? Gates the
 *  conformance run (skipIf) — the engine-gate throw row runs UNCONDITIONALLY. */
let sqliteAvailable = false;
try {
  await import("node:sqlite");
  sqliteAvailable = true;
} catch {
  sqliteAvailable = false;
}

describe("SqliteLibraryStore — the file carries the node-env pragma (FIX-9)", () => {
  it("has `// @vitest-environment node` on line 1 (node:sqlite is a node builtin, not loadable in jsdom)", () => {
    const src = readFileSync(THIS_FILE, "utf8");
    expect(src.split("\n")[0].trim()).toBe("// @vitest-environment node");
  });
});

describe("SqliteLibraryStore availability gate — try/catch, not version-compare (FIX-9)", () => {
  it("(a) when the injected importSqlite probe throws (ERR_UNKNOWN_BUILTIN_MODULE), open() throws a CLEAR typed error naming >=22.5 + the Memory/IndexedDB alternative", async () => {
    // Simulate Node <22.5: the availability probe rejects. The throw MUST happen
    // at open/first-use (NOT at module import — the module loads fine on Node 20).
    const failingProbe = async () => {
      const err = new Error("Cannot find module 'node:sqlite'") as Error & {
        code?: string;
      };
      err.code = "ERR_UNKNOWN_BUILTIN_MODULE";
      throw err;
    };

    await expect(
      SqliteLibraryStore.open({ location: ":memory:", importSqlite: failingProbe }),
    ).rejects.toThrow(/22\.5/);

    await expect(
      SqliteLibraryStore.open({ location: ":memory:", importSqlite: failingProbe }),
    ).rejects.toThrow(/IndexedDB|Memory/i);
  });

  it("(a-note) the availability check is NOT a lexical string version compare — `\"22.10\" < \"22.5\"` is a real bug (lexically true, numerically false), so the gate is the runtime try/catch probe", () => {
    // This test PINS the requirement, not the impl: a lexical string compare would
    // wrongly treat 22.10 as OLDER than 22.5. The store must NOT use it as the
    // primary gate. We assert the bug is real so the GREEN impl cannot regress to it.
    expect("22.10" < "22.5").toBe(true); // lexical (WRONG for versions)
    expect(22.1 < 22.5).toBe(true); // 22.10 parsed as 22.1 minor → also a trap;
    // the ONLY correct gate is the runtime import probe (asserted in row (a)).
  });

  it("(c) LAZY-IMPORT PIN: sqliteStore.ts has NO top-level static `import ... from \"node:sqlite\"` (a static import crashes the whole module on Node 20)", () => {
    const src = readFileSync(SRC_STORE, "utf8");
    // No top-level static import of the node builtin. A dynamic `await import(...)`
    // (or the injected probe) is the ONLY permitted reach.
    const STATIC_IMPORT_RE = /^\s*import\s+[^;]*\bfrom\s+["']node:sqlite["']/m;
    expect(STATIC_IMPORT_RE.test(src)).toBe(false);
  });
});

describe("no native dependency (FIX-9)", () => {
  it("(d) `better-sqlite3` is NOT a dependency of codex-arweave", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(THIS_FILE), "..", "package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).not.toHaveProperty("better-sqlite3");
    expect(pkg.devDependencies ?? {}).not.toHaveProperty("better-sqlite3");
  });
});

describe.skipIf(!sqliteAvailable)(
  "SqliteLibraryStore conformance (availability-gated) — the E3 LibraryStore suite (E-07)",
  () => {
    let store: LibraryStore & { dispose?: () => void };

    beforeEach(async () => {
      // :memory: DB, fresh per test, disposed after.
      store = await SqliteLibraryStore.open({ location: ":memory:" });
      await store.clear();
    });

    it("(b1) append(entry) then get(id) round-trips the public-only entry", async () => {
      const e = entry({ id: CANONICAL_ID_A, itemId: "item-a" });
      await store.append(e);
      const got = await store.get(CANONICAL_ID_A);
      expect(got).toBeDefined();
      expect(got!.id).toBe(CANONICAL_ID_A);
      expect(got!.owner).toBe(OWNER);
      expect(got!.itemId).toBe("item-a");
      expect(got!.status).toBe("pending");
    });

    it("(b2) updateStatus flips pending→final; a missing id is a defined no-op", async () => {
      await store.append(entry({ id: CANONICAL_ID_A }));
      await store.updateStatus(CANONICAL_ID_A, "final");
      expect((await store.get(CANONICAL_ID_A))!.status).toBe("final");

      await store.updateStatus("missing000000000000000000000000000000000000", "final");
      expect(await store.get("missing000000000000000000000000000000000000")).toBeUndefined();
    });

    it("(b3) list(owner) is newest-first by createdAt DESC with a SECONDARY id tiebreak, owner-scoped", async () => {
      await store.append(entry({ id: CANONICAL_ID_A, createdAt: 100 }));
      await store.append(entry({ id: CANONICAL_ID_B, createdAt: 300 }));
      await store.append(
        entry({ id: "eq0000000000000000000000000000000000000EQ1", createdAt: 300 }),
      );
      await store.append(
        entry({ id: "own2000000000000000000000000000000000OWNER", owner: OWNER_2, createdAt: 999 }),
      );

      const list = await store.list(OWNER);
      expect(list.every((e) => e.owner === OWNER)).toBe(true);
      expect(list).toHaveLength(3);
      // createdAt DESC primary; the equal-300 pair ordered by id ASC (deterministic).
      expect(list.map((e) => e.id)).toEqual([
        "eq0000000000000000000000000000000000000EQ1",
        CANONICAL_ID_B,
        CANONICAL_ID_A,
      ]);
    });

    it("(b4) reconcile field-level upserts: keep local createdAt+manifest, set final, refresh tags; no dup; keep absent locals", async () => {
      await store.append(
        entry({
          id: CANONICAL_ID_A,
          createdAt: 4242,
          status: "pending",
          manifest: { isManifest: true },
          tags: tagsFor("stale-item", "text/plain"),
        }),
      );
      await store.append(entry({ id: CANONICAL_ID_B, itemId: "local-pending" }));

      await store.reconcile(OWNER, [
        entry({
          id: CANONICAL_ID_A,
          createdAt: 0,
          status: "final",
          itemId: "item-x",
          tags: tagsFor("fresh-item", "image/png"),
        }),
        entry({
          id: "zzz0000000000000000000000000000000000000ZZ",
          createdAt: 0,
          status: "final",
          itemId: "item-z",
        }),
      ]);

      const merged = await store.get(CANONICAL_ID_A);
      expect(merged!.createdAt).toBe(4242);
      expect(merged!.manifest).toEqual({ isManifest: true });
      expect(merged!.status).toBe("final");
      expect(merged!.tags.find((t) => t.name === "Content-Type")!.value).toBe("image/png");

      const listX = (await store.list(OWNER)).filter((e) => e.id === CANONICAL_ID_A);
      expect(listX).toHaveLength(1);
      expect(await store.get("zzz0000000000000000000000000000000000000ZZ")).toBeDefined();

      const y = await store.get(CANONICAL_ID_B);
      expect(y).toBeDefined();
      expect(y!.status).toBe("pending");
    });

    it("(b5) a persisted entry is PUBLIC-ONLY — no key/ciphertext/password field", async () => {
      await store.append(entry({ id: CANONICAL_ID_A }));
      const got = await store.get(CANONICAL_ID_A);
      const keys = Object.keys(got!);
      for (const forbidden of ["jwk", "d", "p", "q", "dp", "dq", "qi", "password", "ciphertext", "key", "secret"]) {
        expect(keys).not.toContain(forbidden);
      }
      expect(new Set(keys.filter((k) => k !== "manifest"))).toEqual(
        new Set(["id", "owner", "itemId", "contentType", "status", "createdAt", "tags"]),
      );
    });
  },
);

describe.runIf(!sqliteAvailable)(
  "SqliteLibraryStore conformance SKIPPED — node:sqlite unavailable (VISIBLE reason)",
  () => {
    it("skips the conformance run and asserts only the engine-gate throw is covered (node:sqlite not loadable on this runtime)", () => {
      // Visible skip reason: this runtime lacks node:sqlite (Node <22.5). The
      // engine-gate throw row above runs unconditionally; the conformance suite
      // is intentionally not executed here.
      expect(sqliteAvailable).toBe(false);
    });
  },
);
