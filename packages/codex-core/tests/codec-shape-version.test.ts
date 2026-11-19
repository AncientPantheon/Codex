/**
 * codec `Codex_Shape_Version` emit/accept — foundation for the
 * `codex-shape-version-stamp` topic (Topic 1 of `docs/work/codex-versioning`).
 *
 * `Codex_Shape_Version` is a per-codex-instance semver STRING that travels in
 * the export (unlike `schemaVersion`, which is device-local and explicitly
 * does NOT travel). This suite pins the codec's own emit/accept discipline,
 * mirroring `codec-watchlist-allowlist.test.ts`'s structure adapted for a
 * scalar optional field instead of a bare array:
 *
 *   - `buildCodexExport` EMITS `Codex_Shape_Version` only when the source
 *     carries it, and OMITS the key entirely (not `undefined`-valued) when
 *     the source does not;
 *   - `deserializeCodex` round-trips a `Codex_Shape_Version`-bearing envelope
 *     WITHOUT throwing `CodexUnknownFieldError` (the exact failure mode a
 *     missing allow-list entry produces — see this repo's own
 *     `arweaveSeeds`/`watchList`/`codexIdentity` incidents);
 *   - an envelope WITHOUT the field deserializes successfully with
 *     `Codex_Shape_Version === undefined` on the result — never silently
 *     defaulted/stamped by the reader;
 *   - a genuinely-unknown field still throws (the allow-list stays narrow,
 *     not wide-open);
 *   - the historical 1.2 path is untouched.
 *
 * Pure unit tests — no WebCrypto, no fs, no network.
 */

import { describe, it, expect } from "vitest";
import {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
  CodexUnknownFieldError,
  type PlaintextCodex,
} from "../src";

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

describe("codec — Codex_Shape_Version emit/accept", () => {
  it("(a) WRITER emits Codex_Shape_Version when the source carries it", () => {
    const codex = baseCodex({ Codex_Shape_Version: "1.0.0" });
    const envelope = buildCodexExport(codex) as any;
    expect(envelope.Codex_Shape_Version).toBe("1.0.0");
  });

  it("(b) WRITER OMITS the Codex_Shape_Version key entirely when the source field is absent", () => {
    const codex = baseCodex();
    const envelope = buildCodexExport(codex) as any;
    expect("Codex_Shape_Version" in envelope).toBe(false);
  });

  it("(c) READER round-trips a Codex_Shape_Version-bearing envelope WITHOUT CodexUnknownFieldError", () => {
    const codex = baseCodex({ Codex_Shape_Version: "1.0.0" });
    const json = serializeCodex(codex);
    expect(() => deserializeCodex(json)).not.toThrow(CodexUnknownFieldError);
    const parsed = deserializeCodex(json) as any;
    expect(parsed.Codex_Shape_Version).toBe("1.0.0");
  });

  it("(d) an envelope WITHOUT the field deserializes with Codex_Shape_Version === undefined", () => {
    const codex = baseCodex();
    const json = serializeCodex(codex);
    const parsed = deserializeCodex(json) as any;
    expect(parsed.Codex_Shape_Version).toBeUndefined();
  });

  it("(e) a genuinely-unknown third field still throws (allow-list stays narrow)", () => {
    const json = JSON.stringify({
      version: "1.3",
      exportedAt: new Date().toISOString(),
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
      Codex_Shape_Version: "1.0.0",
      totallyUnknownField: 1,
    });
    expect(() => deserializeCodex(json)).toThrow(CodexUnknownFieldError);
  });

  it("(f) a historical 1.2 file (no Codex_Shape_Version) still round-trips, field absent", () => {
    const json = JSON.stringify({
      version: "1.2",
      exportedAt: new Date().toISOString(),
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
    });
    const parsed = deserializeCodex(json) as any;
    expect(parsed.Codex_Shape_Version).toBeUndefined();
  });
});
