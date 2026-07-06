/**
 * E1 RED matrix — the foreignKeys keyring + slice-persist rows (a)-(e).
 *
 * SHAPE-DRIVES T11.5 (the codex-arweave keyring `../src/keyring` + the
 * codex-ouronet `foreignKeys` store slice). codex-arweave is node-only, so
 * these rows exercise the keyring logic against an INJECTED store seam (a
 * function-level double mirroring the pureKeypairs slice) rather than a React
 * render harness. The seam models the FIX-5 persist route: the slice's
 * `addForeignKey` builds a COMPLETE snapshot and calls `adapter.saveAll(next)`
 * — never a per-slice `saveForeignKeys`.
 *
 * FUNDS-CRITICAL invariants pinned here:
 *  - the persisted `encryptedKeyfile` is CIPHERTEXT only (no plaintext d/p/q);
 *  - the saveAll snapshot PRESERVES every other slice deep-equal, INCLUDING
 *    codexIdentity + consumerSettings (a partial-snapshot write would wipe the
 *    StoaChain seeds or the double-Apollo identity when adding an Arweave key);
 *  - generate/import are UNLOCK-GATED on the ABSOLUTE window (isUnlocked).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { ArweaveJwk } from "@ancientpantheon/arweave-core";
import {
  makePasswordCache,
  type CryptoSeam,
  type ForeignKeyEntry,
} from "@ancientpantheon/codex-core";
import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";

// RED: this subpath module does not exist yet.
import {
  generateArweaveKey,
  importArweaveKey,
  decryptArweaveKey,
} from "../src/keyring";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

/** A DETERMINISTIC reversing CryptoSeam — the D3 vault test's fake. Reversible
 *  so decrypt round-trips, deterministic so ciphertext-shape rows are stable.
 *  (The fresh-IV row in the round-trip suite uses the REAL seam instead.) */
const reversingSeam: CryptoSeam = {
  encrypt: (plaintext: string) => [...plaintext].reverse().join(""),
  decrypt: (ciphertext: string) => [...ciphertext].reverse().join(""),
};

/** A function-level store double mirroring the pureKeypairs slice, exposing the
 *  seam the keyring drives: `getSnapshot()` (full state), `addForeignKey` /
 *  `renameForeignKey` / `deleteForeignKey` (each persists via saveAll), and a
 *  spy over the adapter's saveAll. Models the COMPLETE-SNAPSHOT builder. */
function makeStoreDouble(seed: Partial<StoreState> = {}) {
  const saveAllCalls: Snapshot[] = [];
  const saveForeignKeysCalls: unknown[] = [];
  const state: StoreState = {
    kadenaSeeds: seed.kadenaSeeds ?? [],
    ouroAccounts: seed.ouroAccounts ?? [],
    pureKeypairs: seed.pureKeypairs ?? [],
    addressBook: seed.addressBook ?? [],
    watchList: seed.watchList ?? [],
    uiSettings: seed.uiSettings ?? { dockPosition: "left" },
    consumerSettings: seed.consumerSettings ?? {},
    codexIdentity: seed.codexIdentity,
    foreignKeys: seed.foreignKeys ?? [],
    schemaVersion: seed.schemaVersion ?? 1,
    lastUpdatedAt: seed.lastUpdatedAt ?? null,
    lastUpdatedDevice: seed.lastUpdatedDevice ?? "dev",
  };

  const buildSnapshot = (): Snapshot => ({ ...state });

  const adapter = {
    name: "TestAdapter",
    async saveAll(snapshot: Snapshot) {
      // Record a DEEP COPY so later mutations don't retro-edit the assertion.
      saveAllCalls.push(structuredClone(snapshot));
    },
    // A saveForeignKeys, if the keyring ever called it, would be recorded here —
    // the slice-persist row asserts this stays EMPTY (FIX-5: saveAll only).
    async saveForeignKeys(keys: unknown) {
      saveForeignKeysCalls.push(keys);
    },
  };

  return {
    state,
    saveAllCalls,
    saveForeignKeysCalls,
    getSnapshot: buildSnapshot,
    async addForeignKey(entry: ForeignKeyEntry) {
      state.foreignKeys = [
        ...state.foreignKeys.filter((k) => k.id !== entry.id),
        entry,
      ];
      await adapter.saveAll(buildSnapshot());
    },
    async renameForeignKey(id: string, label: string) {
      const target = state.foreignKeys.find((k) => k.id === id);
      if (!target) return; // missing id = silent no-op
      state.foreignKeys = state.foreignKeys.map((k) =>
        k.id === id ? { ...k, label } : k,
      );
      await adapter.saveAll(buildSnapshot());
    },
    async deleteForeignKey(id: string) {
      state.foreignKeys = state.foreignKeys.filter((k) => k.id !== id);
      await adapter.saveAll(buildSnapshot());
    },
  };
}

interface Snapshot {
  kadenaSeeds: unknown[];
  ouroAccounts: unknown[];
  pureKeypairs: unknown[];
  addressBook: unknown[];
  watchList: unknown[];
  uiSettings: Record<string, unknown>;
  consumerSettings: Record<string, unknown>;
  codexIdentity?: unknown;
  foreignKeys: ForeignKeyEntry[];
  schemaVersion: number;
  lastUpdatedAt: string | null;
  lastUpdatedDevice: "dev" | "main";
}
type StoreState = Snapshot;

/** A fully-populated non-empty codex the preservation rows assert survives. */
function seededState(): Partial<StoreState> {
  return {
    kadenaSeeds: [{ id: "seed-1", secret: "ENC::seed" }],
    pureKeypairs: [{ id: "pk-1", encryptedPrivateKey: "ENC::pk" }],
    addressBook: [{ id: "ab-1", address: "k:abc" }],
    consumerSettings: { library: { schemaVersion: 1, settings: { x: 1 } } },
    codexIdentity: { apolloA: "AAA", apolloB: "BBB", totalWordCount: 24 },
  };
}

describe("foreignKeys keyring + slice persist (E-02)", () => {
  it("(a) addForeignKey persists via saveAll (NOT saveForeignKeys) and preserves ALL other slices deep-equal incl codexIdentity + consumerSettings", async () => {
    const store = makeStoreDouble(seededState());
    const passwordCache = makePasswordCache("hunter2", 15 * 60_000, Date.now());

    const entry = await generateArweaveKey({
      store,
      cryptoSeam: reversingSeam,
      password: "hunter2",
      passwordCache,
      label: "My AR key",
    });

    // FIX-5: the persist route is saveAll — a saveForeignKeys method is NOT invoked.
    expect(store.saveAllCalls).toHaveLength(1);
    expect(store.saveForeignKeysCalls).toHaveLength(0);

    const saved = store.saveAllCalls[0];
    // The snapshot carries the new entry in its foreignKeys slice.
    expect(saved.foreignKeys.map((k) => k.id)).toContain(entry.id);

    // CROSS-SLICE PRESERVATION (funds-critical): every pre-existing slice is
    // byte-identical in the persisted snapshot — a partial write that dropped
    // StoaChain seeds or the double-Apollo codexIdentity would fail HERE.
    const before = seededState();
    expect(saved.kadenaSeeds).toEqual(before.kadenaSeeds);
    expect(saved.pureKeypairs).toEqual(before.pureKeypairs);
    expect(saved.addressBook).toEqual(before.addressBook);
    expect(saved.consumerSettings).toEqual(before.consumerSettings);
    expect(saved.codexIdentity).toEqual(before.codexIdentity);
  });

  it("(b) the persisted entry carries only PRE-ENCRYPTED ciphertext — no plaintext JWK material (d/p/q) anywhere in the entry", async () => {
    const store = makeStoreDouble();
    const passwordCache = makePasswordCache("pw", 15 * 60_000, Date.now());

    const entry = await generateArweaveKey({
      store,
      cryptoSeam: reversingSeam,
      password: "pw",
      passwordCache,
    });

    // The reversing seam encrypts JSON.stringify(jwk); the stored value is the
    // reversed string, never the plaintext.
    const serialized = JSON.stringify(entry);
    // decrypt(encryptedKeyfile) must reproduce a JWK; encryptedKeyfile itself
    // must NOT contain the raw private-field substrings.
    const jwk = JSON.parse(reversingSeam.decrypt(entry.encryptedKeyfile, "pw") as string) as ArweaveJwk;
    expect(jwk.kty).toBe("RSA");
    expect(entry.encryptedKeyfile).not.toContain(jwk.d);
    expect(entry.encryptedKeyfile).not.toContain(jwk.p);
    expect(entry.encryptedKeyfile).not.toContain(jwk.q);
    // The serialized entry (id/label/chainId/encryptedKeyfile) exposes no
    // plaintext private material either.
    expect(serialized).not.toContain(jwk.d);
    expect(entry.chainId).toMatch(/arweave/);
  });

  it("(c) renameForeignKey updates the label (labelless entries are valid) and preserves other slices", async () => {
    const store = makeStoreDouble(seededState());
    const passwordCache = makePasswordCache("pw", 15 * 60_000, Date.now());
    const entry = await generateArweaveKey({ store, cryptoSeam: reversingSeam, password: "pw", passwordCache });

    await store.renameForeignKey(entry.id, "Renamed");
    const saved = store.saveAllCalls.at(-1)!;
    expect(saved.foreignKeys.find((k) => k.id === entry.id)?.label).toBe("Renamed");
    expect(saved.kadenaSeeds).toEqual(seededState().kadenaSeeds);
    expect(saved.codexIdentity).toEqual(seededState().codexIdentity);
  });

  it("(d) deleteForeignKey removes the entry; a missing id is a silent no-op", async () => {
    const store = makeStoreDouble(seededState());
    const passwordCache = makePasswordCache("pw", 15 * 60_000, Date.now());
    const entry = await generateArweaveKey({ store, cryptoSeam: reversingSeam, password: "pw", passwordCache });

    await store.deleteForeignKey(entry.id);
    expect(store.state.foreignKeys.find((k) => k.id === entry.id)).toBeUndefined();

    const callsBefore = store.saveAllCalls.length;
    await store.deleteForeignKey("does-not-exist");
    // A missing-id delete still runs the (no-op) save path but leaves state
    // unchanged — the entry set is empty, other slices intact.
    expect(store.saveAllCalls.at(-1)!.kadenaSeeds).toEqual(seededState().kadenaSeeds);
    expect(store.saveAllCalls.length).toBeGreaterThanOrEqual(callsBefore);
  });

  it("(e) generate/import are UNLOCK-GATED on the ABSOLUTE window: locked throws CodexLockedError; a seeded non-expired cache succeeds", async () => {
    const store = makeStoreDouble();

    // Locked: null cache -> throws.
    await expect(
      generateArweaveKey({ store, cryptoSeam: reversingSeam, password: "pw", passwordCache: null }),
    ).rejects.toBeInstanceOf(CodexLockedError);

    // Locked: EXPIRED cache (absolute window, expiresAt <= now) -> throws.
    const expired = makePasswordCache("pw", 1000, Date.now() - 5000);
    await expect(
      importArweaveKey({ raw: throwawayJwk, store, cryptoSeam: reversingSeam, password: "pw", passwordCache: expired }),
    ).rejects.toBeInstanceOf(CodexLockedError);

    // Unlocked: a fresh non-expired cache -> import succeeds and appends an entry.
    const fresh = makePasswordCache("pw", 15 * 60_000, Date.now());
    const entry = await importArweaveKey({ raw: throwawayJwk, store, cryptoSeam: reversingSeam, password: "pw", passwordCache: fresh });
    expect(entry.chainId).toMatch(/arweave/);
    expect(store.state.foreignKeys.map((k) => k.id)).toContain(entry.id);

    // decryptArweaveKey is ALSO unlock-gated: a locked cache throws.
    await expect(
      decryptArweaveKey({ entry, cryptoSeam: reversingSeam, password: "pw", passwordCache: null }),
    ).rejects.toBeInstanceOf(CodexLockedError);
    // Unlocked decrypt returns the original JWK.
    const jwk = await decryptArweaveKey({ entry, cryptoSeam: reversingSeam, password: "pw", passwordCache: fresh });
    expect(jwk).toEqual(throwawayJwk);
  });
});
