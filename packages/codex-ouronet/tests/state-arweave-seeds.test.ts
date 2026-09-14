/**
 * Arweave-seed slice — the store actions + the persistence shard.
 *
 * WHY THIS EXISTS (the reported bug): the Arweave seeds used to live in
 * `ArweavePanel`'s React state, so switching the Class-2 chain rail unmounted
 * the panel and DESTROYED the seed — while the RSA keys it produced survived in
 * the `foreignKeys` slice and orphaned under "Unassigned". A seed is the only
 * thing that can reproduce its keys, so losing it is data loss. These specs pin
 * the seed to the codex store, exactly like the StoaChain seeds.
 *
 * Mirrors the StoaChain seed pattern (`addStoaChainSeed`/`deleteStoaChainSeed`)
 * and the `foreignKeys` persistence precedent:
 *   - the `secret` is CIPHERTEXT at rest (never the 1600-bit plaintext),
 *   - the first seed ever added is the Prime Arweave Seed (exactly one),
 *   - the slice is a real snapshot shard, so it survives a remount/re-init,
 *   - a foreign-key write (full-snapshot `saveAll`) must NOT wipe it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createCodexStore,
  type CodexStoreState,
} from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
} from "@ancientpantheon/codex-ouronet/adapters";
import { CodexKickstartError } from "@ancientpantheon/codex-ouronet/errors";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";

/** The seed entity, reached through the store state rather than the `/types`
 *  barrel: `IArweaveSeed` is declared in `types/entities.ts` but the barrel
 *  that re-exports the entity names is owned elsewhere (see the report). */
type IArweaveSeed = CodexStoreState["arweaveSeeds"][number];

/** A 1600-bit DALOS bitstring — the PLAINTEXT a seed must never persist. */
const PLAINTEXT_BITS = "1011".repeat(400);

const seed = (overrides: Partial<IArweaveSeed> = {}): IArweaveSeed => ({
  id: "aws-1",
  name: "Prime Arweave Seed",
  // Pre-encrypted at the codex password by the caller (same seam the StoaChain
  // seed `secret` and the foreign-key `encryptedKeyfile` use).
  secret: "ENC(v2:bitstring-ciphertext)",
  createdAt: "2026-09-12T10:00:00.000Z",
  ...overrides,
});

/** A Map-backed `localStorage` stand-in — the real sharding adapter is driven
 *  against this so the shard is proven WRITTEN and READ BACK (a
 *  MemoryCodexAdapter would false-pass via its whole-snapshot clone). */
function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("arweaveSeeds slice — store actions", () => {
  let adapter: MemoryCodexAdapter;
  let store: ReturnType<typeof createCodexStore>;

  beforeEach(async () => {
    adapter = new MemoryCodexAdapter("dev");
    store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
  });

  it("starts empty on a fresh codex", () => {
    expect(store.getState().arweaveSeeds).toEqual([]);
  });

  it("survives a remount: a defined seed is still there after re-init over the same adapter", async () => {
    await store.getState().actions.addArweaveSeed(seed());

    // THE BUG: this is the chain-rail switch — the panel (and its React state)
    // is destroyed and a fresh store hydrates from the SAME persisted codex.
    const remounted = createCodexStore();
    await remounted.getState().actions.init(adapter, "dev");

    expect(remounted.getState().arweaveSeeds).toHaveLength(1);
    expect(remounted.getState().arweaveSeeds[0]?.id).toBe("aws-1");
    expect(remounted.getState().arweaveSeeds[0]?.secret).toBe(
      "ENC(v2:bitstring-ciphertext)",
    );
  });

  it("marks the FIRST seed prime and a later seed non-prime", async () => {
    await store.getState().actions.addArweaveSeed(seed());
    await store
      .getState()
      .actions.addArweaveSeed(seed({ id: "aws-2", name: "Second" }));

    const seeds = store.getState().arweaveSeeds;
    expect(seeds.map((s) => [s.id, s.isPrime === true])).toEqual([
      ["aws-1", true],
      ["aws-2", false],
    ]);
  });

  it("refuses a second explicitly-prime seed (exactly one prime per codex)", async () => {
    await store.getState().actions.addArweaveSeed(seed());
    await expect(
      store
        .getState()
        .actions.addArweaveSeed(seed({ id: "aws-2", isPrime: true })),
    ).rejects.toBeInstanceOf(CodexKickstartError);
    expect(store.getState().arweaveSeeds).toHaveLength(1);
  });

  it("REFUSES a plaintext bitstring as the secret — key material is ciphertext-only", async () => {
    await expect(
      store.getState().actions.addArweaveSeed(seed({ secret: PLAINTEXT_BITS })),
    ).rejects.toThrowError(/ciphertext/i);
    // And the refusal must not leak the material it refused.
    await store
      .getState()
      .actions.addArweaveSeed(seed({ secret: PLAINTEXT_BITS }))
      .catch((e: unknown) => {
        expect(String((e as Error).message)).not.toContain(PLAINTEXT_BITS);
      });
    expect(store.getState().arweaveSeeds).toEqual([]);
  });

  it("renames a seed through updateArweaveSeed", async () => {
    await store.getState().actions.addArweaveSeed(seed());
    const stored = store.getState().arweaveSeeds[0]!;
    await store
      .getState()
      .actions.updateArweaveSeed({ ...stored, name: "Renamed" });

    expect(store.getState().arweaveSeeds[0]?.name).toBe("Renamed");
    expect(store.getState().arweaveSeeds[0]?.isPrime).toBe(true);
  });

  it("deletes a seed, and it stays deleted across a re-init", async () => {
    await store.getState().actions.addArweaveSeed(seed());
    await store.getState().actions.addArweaveSeed(seed({ id: "aws-2" }));

    await store.getState().actions.deleteArweaveSeed("aws-2");
    expect(store.getState().arweaveSeeds.map((s) => s.id)).toEqual(["aws-1"]);

    const remounted = createCodexStore();
    await remounted.getState().actions.init(adapter, "dev");
    expect(remounted.getState().arweaveSeeds.map((s) => s.id)).toEqual(["aws-1"]);
  });

  it("deletes the Prime Arweave Seed too (design.md: deletable in development)", async () => {
    await store.getState().actions.addArweaveSeed(seed());
    await store.getState().actions.deleteArweaveSeed("aws-1");
    expect(store.getState().arweaveSeeds).toEqual([]);
  });

  it("a foreign-key write does not wipe the seeds (full-snapshot cascade rule)", async () => {
    await store.getState().actions.addArweaveSeed(seed());

    const key: ForeignKeyEntry = {
      id: "fk-1",
      chainId: "arweave:mainnet",
      encryptedKeyfile: "ENC(jwk)",
    };
    // addForeignKey persists via the FULL-snapshot saveAll — a builder that
    // forgot the seed slice would overwrite the on-disk shard with nothing.
    await store.getState().actions.addForeignKey(key);

    const remounted = createCodexStore();
    await remounted.getState().actions.init(adapter, "dev");
    expect(remounted.getState().arweaveSeeds.map((s) => s.id)).toEqual(["aws-1"]);
    expect(remounted.getState().foreignKeys.map((k) => k.id)).toEqual(["fk-1"]);
  });
});

describe("arweaveSeeds slice — localStorage shard", () => {
  const realWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as unknown as { window: { localStorage: Storage } }).window = {
      localStorage: makeFakeStorage(),
    };
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });

  it("round-trips the seed through the real sharding adapter", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
    await store.getState().actions.addArweaveSeed(seed());

    const reloaded = await adapter.loadAll();
    expect(reloaded.arweaveSeeds?.map((s) => s.id)).toEqual(["aws-1"]);
    expect(reloaded.arweaveSeeds?.[0]?.isPrime).toBe(true);
  });

  it("never writes the 1600-bit plaintext into storage", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
    await store
      .getState()
      .actions.addArweaveSeed(seed({ secret: `ENC(v2:${"ZZ".repeat(40)})` }));

    const dump = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: window.localStorage.length }, (_, i) => {
          const k = window.localStorage.key(i)!;
          return [k, window.localStorage.getItem(k)];
        }),
      ),
    );
    expect(dump).toContain("aws-1");
    expect(dump).not.toContain(PLAINTEXT_BITS);
  });
});
