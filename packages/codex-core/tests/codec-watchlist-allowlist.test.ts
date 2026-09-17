/**
 * codec watchList allow-list — funds/data-critical.
 *
 * Reported incident this suite pins: a user watched an Arweave address (a
 * real, funded address they wanted to track), then a codex export+reimport
 * (`apps/codex-playground`'s "Export codex to JSON" / "Load your Codex",
 * backed by this codec via `useCodexBackup`) silently dropped the watch list
 * — `CodexExportV1_3` had NO `watchList` field at all: `buildCodexExport`
 * never emitted it, `KNOWN_TOP_LEVEL_FIELDS` never allow-listed it, and
 * `deserializeCodex` never validated/returned it.
 *
 * Mirrors `codec-arweaveseeds-allowlist.test.ts` exactly, adapted for
 * `watchList`:
 *
 *   - a `{watchList, foreignKeys}` 1.3 envelope round-trips WITHOUT throwing;
 *   - `watchList` travels as a BARE ARRAY (like `pureKeypairs`/`arweaveSeeds`);
 *   - `buildCodexExport` EMITS `watchList` when the source carries entries and
 *     OMITS the property when it does not;
 *   - a genuinely-unknown third field STILL throws;
 *   - a malformed `watchList` entry throws a shape error naming the path;
 *   - the historical 1.2 path is untouched (a 1.2 file still round-trips).
 *
 * Pure unit tests — no WebCrypto, no fs, no network.
 */

import { describe, it, expect } from "vitest";
import {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
  CodexError,
  CodexUnknownFieldError,
  type ForeignKeyEntry,
  type PlaintextCodex,
} from "../src";

const sampleWatchEntry = {
  id: "watch-1",
  label: "BigMoney",
  address: "kvxXYE6q7v6LrmQJLBEQZ2abWDdVyjQDERqM1YeMvf0",
  type: "arweave",
  createdAt: "2025-01-01T00:00:00.000Z",
};

const sampleForeignKey: ForeignKeyEntry = {
  id: "fk-1",
  label: "AR key",
  chainId: "arweave",
  encryptedKeyfile: "ENC::keyfile-ciphertext",
};

function baseCodex(overrides: Partial<PlaintextCodex> = {}): PlaintextCodex {
  return {
    kadenaWallets: [],
    ouronetWallets: [],
    addressBook: [],
    pureKeypairs: [],
    uiSettings: {},
    schemaVersion: 1,
    lastUpdatedAt: null,
    lastUpdatedDevice: "dev",
    ...overrides,
  };
}

describe("codec — watchList allow-list (FIX-watchlist)", () => {
  it("(a) round-trips a {watchList, foreignKeys} 1.3 envelope WITHOUT CodexUnknownFieldError", () => {
    const codex = baseCodex({
      foreignKeys: [sampleForeignKey],
      watchList: [sampleWatchEntry],
    });
    const json = serializeCodex(codex);
    const parsed = deserializeCodex(json) as any;
    expect(parsed.watchList).toEqual([sampleWatchEntry]);
  });

  it("(b) WRITER emits watchList as a bare array (not block-wrapped)", () => {
    const codex = baseCodex({ watchList: [sampleWatchEntry] });
    const envelope = buildCodexExport(codex) as any;
    expect(Array.isArray(envelope.watchList)).toBe(true);
    expect(envelope.watchList).toEqual([sampleWatchEntry]);
  });

  it("(c) WRITER OMITS watchList entirely when the source carries none", () => {
    const codex = baseCodex({ watchList: [] });
    const envelope = buildCodexExport(codex) as any;
    expect("watchList" in envelope).toBe(false);
  });

  it("(c2) WRITER OMITS watchList when the source field is undefined", () => {
    const codex = baseCodex();
    const envelope = buildCodexExport(codex) as any;
    expect("watchList" in envelope).toBe(false);
  });

  it("(d) READER throws a CodexError NAMING watchList[0] for a malformed entry", () => {
    const json = JSON.stringify({
      version: "1.3",
      exportedAt: new Date().toISOString(),
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
      watchList: [{ id: "bad" }], // missing label/address/type/createdAt
    });
    expect(() => deserializeCodex(json)).toThrow(CodexError);
    try {
      deserializeCodex(json);
      expect.fail("expected throw");
    } catch (e) {
      expect((e as Error).message).toMatch(/watchList\[0\]/);
    }
  });

  it("(e) a genuinely-unknown third field still throws (allow-list stays narrow)", () => {
    const json = JSON.stringify({
      version: "1.3",
      exportedAt: new Date().toISOString(),
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
      watchList: [sampleWatchEntry],
      totallyUnknownField: 1,
    });
    expect(() => deserializeCodex(json)).toThrow(CodexUnknownFieldError);
  });

  it("(f) a historical 1.2 file (no watchList) still round-trips, watchList absent", () => {
    const json = JSON.stringify({
      version: "1.2",
      exportedAt: new Date().toISOString(),
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
    });
    const parsed = deserializeCodex(json) as any;
    expect(parsed.watchList).toBeUndefined();
  });
});
