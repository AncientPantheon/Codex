/**
 * Seed provenance on a foreign-key entry — guard + wire round-trip.
 *
 * FUNDS-CRITICAL wire-format change. Each Arweave SEED owns its OWN index
 * space, so a stored key is addressed by `(seedId, index)` — `#0` is per-seed,
 * never global. `ForeignKeyEntry` therefore grows three OPTIONAL fields
 * (`seedId` / `index` / `address`); without them the Accounts view cannot
 * group a key under the seed that produced it.
 *
 * The two regressions these cases exist to catch:
 *   - BACKWARD BREAK: a codex exported BEFORE this change carries entries with
 *     none of the new fields. If the widened guard rejected one, the whole
 *     envelope would throw on deserialize and the user's only copy of that
 *     foreign-chain key would be unrestorable.
 *   - UNADDRESSABLE PROVENANCE: an entry whose `index` is negative, fractional,
 *     or carries no owning `seedId` cannot be placed in any seed's index space.
 *     Admitting one would let a key land under the wrong seed — or silently
 *     collide with another key at the "same" position.
 *
 * SHAPE only — nothing here decrypts, and no `encryptedKeyfile` value is ever
 * asserted against beyond its own round-trip identity.
 *
 * Pure unit tests — no WebCrypto, no fs, no network.
 */

import { describe, it, expect } from "vitest";
import {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
  isForeignKeyEntry,
  type CodexExportV1_3,
  type ForeignKeyEntry,
  type PlaintextCodex,
} from "../src";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** An entry written BEFORE this change: no seedId / index / address at all. */
const LEGACY_ENTRY: ForeignKeyEntry = {
  id: "fk-legacy",
  label: "Arweave main",
  chainId: "arweave:mainnet",
  encryptedKeyfile: "enc:AR-legacy-blob",
};

/** An entry written AFTER this change, carrying full seed provenance. */
const PROVENANCE_ENTRY: ForeignKeyEntry = {
  id: "fk-seeded",
  chainId: "arweave:mainnet",
  encryptedKeyfile: "enc:AR-seeded-blob",
  seedId: "seed-prime",
  index: 0,
  address: "AR-PLAINTEXT-ADDRESS-0",
};

/** A PlaintextCodex carrying the given entries as its bare foreignKeys source. */
function makeCodex(entries: ForeignKeyEntry[]): PlaintextCodex {
  return {
    kadenaWallets: [{ id: "seed-a", secret: "enc-seed" }],
    ouronetWallets: [],
    addressBook: [],
    pureKeypairs: [],
    uiSettings: { infoZoneOpen: true },
    schemaVersion: 1,
    lastUpdatedAt: "2026-09-12T00:00:00Z",
    lastUpdatedDevice: "dev",
    foreignKeys: entries,
  };
}

/** Serialize → deserialize a codex and return the parsed keyring entries. */
function roundTripKeys(entries: ForeignKeyEntry[]): ForeignKeyEntry[] {
  const parsed = deserializeCodex(serializeCodex(makeCodex(entries))) as CodexExportV1_3;
  return parsed.foreignKeys!.keys;
}

// ─── (a) LEGACY entries stay valid — the backward-compat guarantee ─────────────

describe("(a) LEGACY entry — an export written before seed provenance still restores", () => {
  it("accepts a legacy entry {id,chainId,encryptedKeyfile} with none of the new fields", () => {
    expect(isForeignKeyEntry({ id: "fk-1", chainId: "arweave:mainnet", encryptedKeyfile: "enc:blob" })).toBe(true);
  });

  it("round-trips a legacy entry UNCHANGED — no dropped field, no injected seedId/index/address", () => {
    const [key] = roundTripKeys([LEGACY_ENTRY]);
    expect(key).toEqual(LEGACY_ENTRY);
    expect(key).not.toHaveProperty("seedId");
    expect(key).not.toHaveProperty("index");
    expect(key).not.toHaveProperty("address");
  });

  it("deserializes a previously-exported envelope stamped with the OLD block schemaVersion 1", () => {
    // The wire version bumped, but the READER must never refuse an older stamp:
    // every codex downloaded before this change carries schemaVersion 1.
    const wire = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-07-04T00:00:00.000Z",
      kadenaWallets: [{ id: "seed-a", secret: "enc-seed" }],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
      foreignKeys: { schemaVersion: 1, keys: [LEGACY_ENTRY] },
    });
    const parsed = deserializeCodex(wire) as CodexExportV1_3;
    expect(parsed.foreignKeys?.schemaVersion).toBe(1);
    expect(parsed.foreignKeys?.keys[0]).toEqual(LEGACY_ENTRY);
  });
});

// ─── (b) PROVENANCE entries survive the wire with all three fields ────────────

describe("(b) PROVENANCE entry — seedId / index / address survive a serialize→deserialize", () => {
  it("preserves seedId, index and address verbatim through the round-trip", () => {
    const [key] = roundTripKeys([PROVENANCE_ENTRY]);
    expect(key).toEqual(PROVENANCE_ENTRY);
    expect(key.seedId).toBe("seed-prime");
    expect(key.index).toBe(0);
    expect(key.address).toBe("AR-PLAINTEXT-ADDRESS-0");
  });

  it("carries a mixed keyring (legacy + provenance) through the wire without dropping either", () => {
    // The realistic post-upgrade codex: old keys and newly-derived ones side by
    // side. A guard that admitted only one shape would lose half the keyring.
    expect(roundTripKeys([LEGACY_ENTRY, PROVENANCE_ENTRY])).toEqual([LEGACY_ENTRY, PROVENANCE_ENTRY]);
  });

  it("accepts index 0 — per-seed position zero is a real key, not a missing value", () => {
    expect(isForeignKeyEntry({ ...PROVENANCE_ENTRY, index: 0 })).toBe(true);
  });

  it("stamps a block schemaVersion HIGHER than the legacy 1 on newly-written exports", () => {
    // Forward-stamp / backward-read: consumers key off the block version to know
    // whether provenance fields can be expected, so the writer must advance it.
    const exp = buildCodexExport(makeCodex([PROVENANCE_ENTRY])) as CodexExportV1_3;
    expect(exp.foreignKeys!.schemaVersion).toBeGreaterThan(1);
    expect(exp.foreignKeys!.keys).toEqual([PROVENANCE_ENTRY]);
  });
});

// ─── (c)/(d) MALFORMED provenance is refused — an unplaceable key never lands ──

describe("(c) MALFORMED index — a position outside a seed's index space is rejected", () => {
  it("rejects index -1 (no seed has a negative position)", () => {
    expect(isForeignKeyEntry({ ...PROVENANCE_ENTRY, index: -1 })).toBe(false);
  });

  it("rejects a fractional index 1.5 (positions are integers)", () => {
    expect(isForeignKeyEntry({ ...PROVENANCE_ENTRY, index: 1.5 })).toBe(false);
  });

  it("rejects a non-number index (a stringified position would sort and compare wrong)", () => {
    expect(isForeignKeyEntry({ ...PROVENANCE_ENTRY, index: "0" })).toBe(false);
  });

  it("fails the whole deserialize closed when an envelope carries a negative index", () => {
    // Fail-closed at the envelope: a bad entry must never slip into a restore.
    const wire = JSON.stringify({
      version: "1.3",
      exportedAt: "2026-07-04T00:00:00.000Z",
      kadenaWallets: [{ id: "seed-a", secret: "enc-seed" }],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
      foreignKeys: { schemaVersion: 2, keys: [{ ...PROVENANCE_ENTRY, index: -1 }] },
    });
    expect(() => deserializeCodex(wire)).toThrow(/foreignKeys\.keys\[0\]/);
  });
});

describe("(d) ORPHAN index — an index with no owning seed is rejected", () => {
  it("rejects an entry carrying index but no seedId (the index space it names is unknown)", () => {
    const { seedId: _seedId, ...orphan } = PROVENANCE_ENTRY;
    expect(isForeignKeyEntry(orphan)).toBe(false);
  });

  it("rejects an entry whose seedId is an empty string (empty names no seed)", () => {
    expect(isForeignKeyEntry({ ...PROVENANCE_ENTRY, seedId: "" })).toBe(false);
  });

  it("accepts a seedId WITHOUT an index — a seed-tagged key not yet positioned is valid", () => {
    const { index: _index, ...noIndex } = PROVENANCE_ENTRY;
    expect(isForeignKeyEntry(noIndex)).toBe(true);
  });

  it("rejects a non-string address while accepting its absence", () => {
    expect(isForeignKeyEntry({ ...PROVENANCE_ENTRY, address: 42 })).toBe(false);
    const { address: _address, ...noAddress } = PROVENANCE_ENTRY;
    expect(isForeignKeyEntry(noAddress)).toBe(true);
  });
});
