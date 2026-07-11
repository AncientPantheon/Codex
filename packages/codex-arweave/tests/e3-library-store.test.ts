/**
 * E3 RED matrix — the `LibraryStore` seam CONFORMANCE suite (E-07, N-07).
 *
 * ONE conformance suite runs against BOTH reference impls behind the seam:
 *   - `MemoryLibraryStore` (node/test, Map-backed) — the Library-LOGIC impl;
 *   - `IndexedDBLibraryStore` (browser) under `fake-indexeddb` — asserts async
 *     correctness (a write is observable only after `transaction.oncomplete`, not
 *     `request.onsuccess`).
 *
 * The seam is `LibraryStore { append, get, updateStatus, list, reconcile, clear }`.
 * The pinned contracts:
 *   - append → get round-trips a public-only `LibraryEntry`;
 *   - updateStatus flips pending→final (missing-id semantics pinned);
 *   - list(owner) is NEWEST-FIRST by createdAt DESC + SECONDARY id tiebreak,
 *     owner-scoped, deterministic under EQUAL createdAt;
 *   - reconcile is a FIELD-LEVEL upsert-by-id (keep local createdAt+manifest, set
 *     status:final, refresh tags, no dup, do NOT delete absent locals);
 *   - a LibraryEntry is PUBLIC-ONLY — no key/ciphertext/password field.
 *
 * RED: `src/library` does not exist → the imports fail.
 */

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";

import type { Tag } from "@ancientpantheon/arweave-core";

// RED: none of these exist yet (T13.5 GREEN).
import {
  MemoryLibraryStore,
  IndexedDBLibraryStore,
  type LibraryStore,
  type LibraryEntry,
} from "../src/library";
import type { IdbFactoryLike } from "../src/library/types";

import { KNOWN_ADDRESS, CANONICAL_ID_A, CANONICAL_ID_B } from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;
const OWNER_2 = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";

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

/** Each impl is exercised by the SAME conformance suite. IndexedDB uses a fresh
 *  db name per suite run so `fake-indexeddb/auto`'s global store is isolated. */
const impls: Array<{ name: string; make: () => Promise<LibraryStore> }> = [
  { name: "MemoryLibraryStore", make: async () => new MemoryLibraryStore() },
  {
    name: "IndexedDBLibraryStore",
    make: async () =>
      IndexedDBLibraryStore.open({
        indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
        databaseName: `codex-library-${Math.random().toString(36).slice(2)}`,
      }),
  },
];

describe.each(impls)("LibraryStore conformance — $name (E-07)", ({ make }) => {
  let store: LibraryStore;

  beforeEach(async () => {
    store = await make();
    await store.clear();
  });

  it("(a) append(entry) then get(id) round-trips the entry", async () => {
    const e = entry({ id: CANONICAL_ID_A, itemId: "item-a" });
    await store.append(e);
    const got = await store.get(CANONICAL_ID_A);
    expect(got).toBeDefined();
    expect(got!.id).toBe(CANONICAL_ID_A);
    expect(got!.owner).toBe(OWNER);
    expect(got!.itemId).toBe("item-a");
    expect(got!.status).toBe("pending");
  });

  it("(b) updateStatus flips pending→final; a missing id is a defined no-op (get stays undefined)", async () => {
    const e = entry({ id: CANONICAL_ID_A });
    await store.append(e);
    await store.updateStatus(CANONICAL_ID_A, "final");
    expect((await store.get(CANONICAL_ID_A))!.status).toBe("final");

    // Missing-id semantics: a no-op that does not create a phantom entry.
    await store.updateStatus("missing000000000000000000000000000000000000", "final");
    expect(await store.get("missing000000000000000000000000000000000000")).toBeUndefined();
  });

  it("(c) list(owner) is newest-first by createdAt DESC with a SECONDARY id tiebreak, owner-scoped", async () => {
    // Mixed timestamps + an EQUAL-createdAt pair (drives the id tiebreak) + a
    // second owner's entry (must be excluded).
    await store.append(entry({ id: CANONICAL_ID_A, createdAt: 100 }));
    await store.append(entry({ id: CANONICAL_ID_B, createdAt: 300 }));
    // Equal createdAt (300) pair with CANONICAL_ID_B → tiebreak by id asc.
    await store.append(
      entry({ id: "eq0000000000000000000000000000000000000EQ1", createdAt: 300 }),
    );
    await store.append(
      entry({ id: "own2000000000000000000000000000000000OWNER", owner: OWNER_2, createdAt: 999 }),
    );

    const list = await store.list(OWNER);
    // Owner-scoped: the second owner's entry is excluded.
    expect(list.map((e) => e.owner).every((o) => o === OWNER)).toBe(true);
    expect(list).toHaveLength(3);
    // createdAt DESC primary; the equal-300 pair ordered by id ascending
    // (deterministic tiebreak). "eq..." < "ZzYy..." lexicographically.
    expect(list.map((e) => e.id)).toEqual([
      "eq0000000000000000000000000000000000000EQ1",
      CANONICAL_ID_B,
      CANONICAL_ID_A,
    ]);
  });

  it("(d) reconcile field-level upserts: insert missing; for existing keep createdAt+manifest, set final, refresh tags; no dup; keep absent locals", async () => {
    // Seed a LOCAL entry for id X: pending, manifest-flagged, known createdAt,
    // stale tags. Plus a local pending Y absent from the reconcile input.
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

    // Reconcile: X refreshed (new tags), Z brand new.
    const refreshedX = entry({
      id: CANONICAL_ID_A,
      createdAt: 0,
      status: "final",
      itemId: "item-x",
      tags: tagsFor("fresh-item", "image/png"),
    });
    const newZ = entry({
      id: "zzz0000000000000000000000000000000000000ZZ",
      createdAt: 0,
      status: "final",
      itemId: "item-z",
    });
    await store.reconcile(OWNER, [refreshedX, newZ]);

    const merged = await store.get(CANONICAL_ID_A);
    // Local createdAt SURVIVES (the rebuild record has no better timestamp).
    expect(merged!.createdAt).toBe(4242);
    // Local manifest marker SURVIVES.
    expect(merged!.manifest).toEqual({ isManifest: true });
    // status is SET to final (chain is source of truth for finality).
    expect(merged!.status).toBe("final");
    // tags are REFRESHED from the reconcile record.
    expect(merged!.tags.find((t) => t.name === "Content-Type")!.value).toBe("image/png");

    // No duplicate for X.
    const listX = (await store.list(OWNER)).filter((e) => e.id === CANONICAL_ID_A);
    expect(listX).toHaveLength(1);

    // The brand-new Z was inserted.
    expect(await store.get("zzz0000000000000000000000000000000000000ZZ")).toBeDefined();

    // The local pending Y, ABSENT from the reconcile input, SURVIVES (non-destructive).
    const y = await store.get(CANONICAL_ID_B);
    expect(y).toBeDefined();
    expect(y!.status).toBe("pending");
  });

  it("(e) a LibraryEntry is PUBLIC-ONLY — no key/ciphertext/password field ever persists", async () => {
    const e = entry({ id: CANONICAL_ID_A });
    await store.append(e);
    const got = await store.get(CANONICAL_ID_A);

    // The persisted shape carries ONLY public metadata.
    const keys = Object.keys(got!);
    const FORBIDDEN = ["jwk", "d", "p", "q", "dp", "dq", "qi", "password", "ciphertext", "key", "secret"];
    for (const forbidden of FORBIDDEN) {
      expect(keys).not.toContain(forbidden);
    }
    // Positive shape: only the public LibraryEntry fields.
    expect(new Set(keys.filter((k) => k !== "manifest"))).toEqual(
      new Set(["id", "owner", "itemId", "contentType", "status", "createdAt", "tags"]),
    );
  });
});

describe("LibraryStore async-correctness — IndexedDBLibraryStore (E-07, FIX-9)", () => {
  it("(f) a write is observable only AFTER the transaction completes (append resolves post-oncomplete)", async () => {
    const store = await IndexedDBLibraryStore.open({
      indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
      databaseName: `codex-library-async-${Math.random().toString(36).slice(2)}`,
    });
    await store.clear();

    // The write PROMISE resolves only when the tx is committed — so an immediately
    // following read on the SAME store observes the write (no lost-write race).
    await store.append(entry({ id: CANONICAL_ID_A, itemId: "async-item" }));
    const got = await store.get(CANONICAL_ID_A);
    expect(got).toBeDefined();
    expect(got!.itemId).toBe("async-item");

    // A second store opened on the SAME db name also sees the committed write —
    // proves the append awaited tx.oncomplete, not merely request.onsuccess.
    // (Re-open via the same handle to avoid depending on fake-indexeddb cross-db
    // visibility timing.)
    await store.updateStatus(CANONICAL_ID_A, "final");
    expect((await store.get(CANONICAL_ID_A))!.status).toBe("final");
  });
});
