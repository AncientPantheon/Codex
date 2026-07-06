/**
 * Cross-envelope wire-compatibility — codex-core (canonical) ↔ ouronet-core (peer).
 *
 * FUNDS-CRITICAL. The "1.3" codex envelope is INTENTIONALLY duplicated across two
 * repos with NO cross-org runtime edge: codex-core owns the canonical codec, and
 * ouronet-core keeps an independent peer. The safety of that no-edge decision
 * rests on one invariant — the two writers emit BYTE-IDENTICAL wire output for the
 * same StoaChain-only codex (modulo the `exportedAt` timestamp each stamps live).
 *
 * ouronet-core cannot be imported here (different repo, no cross-org dependency),
 * so its expected output is encoded as a FIXTURE STRING and codex-core's normalized
 * output is asserted equal to it. Fixture strings — not a runtime import — are the
 * only sound way to cross-check two deliberately-separated envelopes.
 *
 * Three checks:
 *   (a) cross-parse: codex-core deserializes both its own 1.3 output AND an
 *       ouronet-core-shaped 1.3 literal (empty + populated foreignKeys) clean.
 *   (b) byte-identity (modulo exportedAt) of the two WRITERS on the empty/omitted
 *       foreignKeys fixture — the load-bearing no-cross-org-edge invariant.
 *   (c) populated case is NOT a two-writer byte-identity check — ouronet-core's
 *       PlaintextCodex has no foreignKeys source, so it OMITS by design (not drift).
 *       The populated writer path is proven INTERNALLY in codex-core; ouronet's
 *       omission is asserted as deliberate. A convergence note defers the
 *       populated two-writer byte-identity to E1.
 *
 * Pure unit tests — no WebCrypto, no fs, no network.
 */

import { describe, it, expect } from "vitest";
import {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
  type CodexExportV1_3,
  type ForeignKeyEntry,
  type PlaintextCodex,
} from "../src";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A StoaChain-only PlaintextCodex with NO foreign keys — the shared cross-writer
// fixture. Both codex-core and ouronet-core writers must emit the identical 1.3
// envelope for this (each writer wraps the same four collections + uiSettings and
// omits foreignKeys). Field values are chosen to be exactly what BOTH writers
// pass through unchanged.
function makeKadenaOnlyCodex(): PlaintextCodex {
  return {
    kadenaWallets: [
      { id: "seed-a", name: "Main seed", seedType: "koala", secret: "enc:v2:seed-blob", main: "k:abc", accounts: [] },
    ],
    ouronetWallets: [
      { id: "acct-1", name: "Resident", address: "ouro:AB-XYZ", guard: { pred: "keys-all", keys: ["pub1"] }, secret: "enc:acct" },
    ],
    addressBook: [{ id: "ab-1", label: "Friend", address: "ouro:FRIEND" }],
    pureKeypairs: [],
    uiSettings: { infoZoneOpen: true, zbomExecutePosition: "top" },
    schemaVersion: 1,
    lastUpdatedAt: "2026-04-22T00:00:00Z",
    lastUpdatedDevice: "dev",
  };
}

// The SAME codex plus a populated foreignKeys source. Only codex-core can emit
// the populated block — ouronet-core has no foreignKeys source field, so this
// fixture is codex-core-internal (used to prove the populated writer path and to
// produce a populated 1.3 wire literal for the cross-parse check).
function makeCodexWithForeignKeys(): PlaintextCodex {
  const entries: ForeignKeyEntry[] = [
    { id: "fk-ar-1", label: "Arweave main", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-keyfile-blob-1" },
    { id: "fk-ar-2", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-keyfile-blob-2" },
  ];
  return { ...makeKadenaOnlyCodex(), foreignKeys: entries };
}

// exportedAt is the ONLY field that differs run-to-run (buildCodexExport stamps
// `new Date().toISOString()`). Normalize it out before any two-writer comparison,
// because byte-identity holds only modulo this live timestamp.
function stripExportedAt(json: string): string {
  const obj = JSON.parse(json) as Record<string, unknown>;
  delete obj.exportedAt;
  return JSON.stringify(obj);
}

// ouronet-core's EXPECTED empty-1.3 output for the StoaChain-only fixture, encoded as
// a fixture string (its writer omits foreignKeys, stamps "1.3", and carries the
// exact same field set as codex-core: version, exportedAt, kadenaWallets,
// ouronetWallets, addressBook, uiSettings). This mirrors ouronet-core's
// buildCodexExport in codec.ts — field order and values match its emission for
// makeKadenaOnlyCodex(). exportedAt is present but stripped before comparison.
const OURONET_EMPTY_13_WIRE = JSON.stringify({
  version: "1.3",
  exportedAt: "2026-01-01T00:00:00.000Z",
  kadenaWallets: [
    { id: "seed-a", name: "Main seed", seedType: "koala", secret: "enc:v2:seed-blob", main: "k:abc", accounts: [] },
  ],
  ouronetWallets: [
    { id: "acct-1", name: "Resident", address: "ouro:AB-XYZ", guard: { pred: "keys-all", keys: ["pub1"] }, secret: "enc:acct" },
  ],
  addressBook: [{ id: "ab-1", label: "Friend", address: "ouro:FRIEND" }],
  uiSettings: { infoZoneOpen: true, zbomExecutePosition: "top" },
});

// A populated 1.3 envelope shaped like a codex-core emission (only codex-core can
// produce a populated block). Used as the "populated" cross-parse literal.
const POPULATED_13_WIRE = JSON.stringify({
  version: "1.3",
  exportedAt: "2026-07-04T00:00:00.000Z",
  kadenaWallets: [{ id: "seed-a", secret: "enc:seed" }],
  ouronetWallets: [{ id: "acct-1", secret: "enc:acct" }],
  addressBook: [],
  uiSettings: { infoZoneOpen: true },
  foreignKeys: {
    schemaVersion: 1,
    keys: [
      { id: "fk-ar-1", label: "Arweave main", chainId: "arweave:mainnet", encryptedKeyfile: "enc:AR-keyfile-blob-1" },
    ],
  },
});

// An empty-block 1.3 literal (distinct from omission) for the cross-parse check.
const EMPTY_BLOCK_13_WIRE = JSON.stringify({
  version: "1.3",
  exportedAt: "2026-07-04T00:00:00.000Z",
  kadenaWallets: [{ id: "seed-a", secret: "enc:seed" }],
  ouronetWallets: [],
  addressBook: [],
  uiSettings: {},
  foreignKeys: { schemaVersion: 1, keys: [] },
});

// ─── (a) CROSS-PARSE ──────────────────────────────────────────────────────────

describe("(a) CROSS-PARSE — codex-core deserializes both self-written and ouronet-shaped 1.3 envelopes clean", () => {
  it("deserializes codex-core's OWN serialized 1.3 output (self round-trip, no foreign keys)", () => {
    const json = serializeCodex(makeKadenaOnlyCodex());
    const parsed = deserializeCodex(json) as CodexExportV1_3;
    expect(parsed.version).toBe("1.3");
    expect(parsed.kadenaWallets).toEqual(makeKadenaOnlyCodex().kadenaWallets);
    expect(parsed).not.toHaveProperty("foreignKeys");
  });

  it("deserializes an ouronet-core-shaped EMPTY-block 1.3 literal clean (empty distinct from omitted)", () => {
    const parsed = deserializeCodex(EMPTY_BLOCK_13_WIRE) as CodexExportV1_3;
    expect(parsed.version).toBe("1.3");
    expect(parsed.foreignKeys?.keys).toEqual([]);
  });

  it("deserializes a POPULATED 1.3 literal clean with the entry byte-identical (no drop/blank)", () => {
    const parsed = deserializeCodex(POPULATED_13_WIRE) as CodexExportV1_3;
    expect(parsed.foreignKeys?.keys).toHaveLength(1);
    expect(parsed.foreignKeys?.keys[0]).toEqual({
      id: "fk-ar-1",
      label: "Arweave main",
      chainId: "arweave:mainnet",
      encryptedKeyfile: "enc:AR-keyfile-blob-1",
    });
  });
});

// ─── (b) BYTE-IDENTITY (modulo exportedAt) — the no-cross-org-edge invariant ────

describe("(b) BYTE-IDENTITY — the two writers emit identical empty-1.3 wire (modulo exportedAt)", () => {
  it("codex-core's normalized empty-1.3 output equals ouronet-core's expected empty-1.3 fixture", () => {
    // The load-bearing invariant: for the SAME StoaChain-only codex, the two writers'
    // serialize output is byte-identical once the live exportedAt is stripped. If
    // this drifts, the two deliberately-duplicated envelopes have diverged and the
    // no-cross-org-edge decision is no longer safe.
    const codexCoreOut = stripExportedAt(serializeCodex(makeKadenaOnlyCodex()));
    const ouronetExpected = stripExportedAt(OURONET_EMPTY_13_WIRE);
    expect(codexCoreOut).toBe(ouronetExpected);
  });

  it("both writers stamp exactly version 1.3 and OMIT foreignKeys on the empty fixture", () => {
    const codexCoreExp = buildCodexExport(makeKadenaOnlyCodex());
    const ouronetExpected = JSON.parse(OURONET_EMPTY_13_WIRE) as Record<string, unknown>;
    expect(codexCoreExp.version).toBe("1.3");
    expect(ouronetExpected.version).toBe("1.3");
    expect(codexCoreExp).not.toHaveProperty("foreignKeys");
    expect(ouronetExpected).not.toHaveProperty("foreignKeys");
  });
});

// ─── (c) POPULATED — NOT a two-writer byte-identity check (CI-103) ─────────────

describe("(c) POPULATED — codex-core emits the block; ouronet-core omits by design (not drift)", () => {
  it("codex-core's populated writer emits foreignKeys.keys deep-equal to the input entries (funds-critical path)", () => {
    // Proven internally: only codex-core has a foreignKeys source, so the populated
    // block is a codex-core-only writer path. No drop/reorder/blank of any keyfile.
    const codex = makeCodexWithForeignKeys();
    const inputEntries = codex.foreignKeys as ForeignKeyEntry[];
    const exp = buildCodexExport(codex) as CodexExportV1_3;
    expect(exp.foreignKeys?.schemaVersion).toBe(1);
    expect(exp.foreignKeys?.keys).toEqual(inputEntries);
  });

  it("ouronet-core's expected empty-1.3 fixture OMITS foreignKeys — a deliberate divergence, not a CRITICAL drift", () => {
    // CI-103: ouronet-core's PlaintextCodex has NO foreignKeys source, so it CANNOT
    // emit a populated block — it omits, by design. This is NOT a two-writer
    // byte-identity failure; asserting codex-core's populated output equalled
    // ouronet's would be a FALSE CRITICAL. The populated two-writer byte-identity is
    // a DEFERRED E1/convergence item, recorded here — not a regression.
    const ouronetExpected = JSON.parse(OURONET_EMPTY_13_WIRE) as Record<string, unknown>;
    expect(ouronetExpected).not.toHaveProperty("foreignKeys");
    // codex-core CAN emit the block for the same base codex + a foreignKeys source —
    // the capability gap is the deliberate divergence, not a serialization bug.
    const codexCorePopulated = buildCodexExport(makeCodexWithForeignKeys()) as CodexExportV1_3;
    expect(codexCorePopulated).toHaveProperty("foreignKeys");
  });
});
