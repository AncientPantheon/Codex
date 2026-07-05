/**
 * v0.2 (schemaVersion 1) -> v0.3 (schemaVersion 2) migration — REQ-10.
 *
 * Exercises the real SCHEMA_MIGRATIONS[{1->2}] entry through the pure
 * applyMigrations runner: consumerSettings seeding, OuronetUI extras relocation,
 * uiSettings stripping, codexIdentity stays unset, schemaVersion advances to 2,
 * purity, idempotency, and cross-version field preservation.
 */

import { describe, it, expect } from "vitest";
import { emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import {
  applyMigrations,
  SCHEMA_MIGRATIONS,
} from "@ancientpantheon/codex-ouronet/state";

function v02Snapshot(uiExtras: Record<string, unknown> = {}): CodexSnapshot {
  const base = emptySnapshot("dev");
  return {
    ...base,
    schemaVersion: 1,
    uiSettings: { ...base.uiSettings, ...uiExtras },
  };
}

// This file isolates the 1->2 step, so it targets schemaVersion 2 explicitly
// (NOT CURRENT_SCHEMA_VERSION, which advances as later migrations are added).
const run = (snap: CodexSnapshot) =>
  applyMigrations(snap, SCHEMA_MIGRATIONS, 2);

describe("v0.2 -> v0.3 schema migration", () => {
  it("migrates an empty v0.2 codex: schemaVersion 2, consumerSettings {}, no OuronetUI slot", () => {
    const out = run(v02Snapshot());
    expect(out.schemaVersion).toBe(2);
    expect(out.consumerSettings).toEqual({});
    expect(out.consumerSettings?.OuronetUI).toBeUndefined();
  });

  it("relocates non-canonical uiSettings extras into consumerSettings['OuronetUI'] and strips them", () => {
    const out = run(
      v02Snapshot({ legacyDexPref: "fast", poolFeeUnit: "KDA", simStoicTagEnabled: true })
    );
    expect(out.consumerSettings?.OuronetUI?.settings).toEqual({
      legacyDexPref: "fast",
      poolFeeUnit: "KDA",
      simStoicTagEnabled: true,
    });
    // extras stripped from uiSettings
    expect((out.uiSettings as Record<string, unknown>).legacyDexPref).toBeUndefined();
    expect((out.uiSettings as Record<string, unknown>).poolFeeUnit).toBeUndefined();
    expect((out.uiSettings as Record<string, unknown>).simStoicTagEnabled).toBeUndefined();
    // canonical keys retained with original values
    expect(out.uiSettings.passwordCacheMinutes).toBe(1);
    expect(out.uiSettings.selectedNode).toBe("node2");
  });

  it("OuronetUI slot: consumerVersion 'unknown', schemaVersion 1, valid ISO lastUpdatedAt", () => {
    const out = run(v02Snapshot({ x: 1 }));
    const slot = out.consumerSettings!.OuronetUI;
    expect(slot.consumerName).toBe("OuronetUI");
    expect(slot.consumerVersion).toBe("unknown");
    expect(slot.schemaVersion).toBe(1);
    expect(Number.isNaN(Date.parse(slot.lastUpdatedAt))).toBe(false);
  });

  it("leaves codexIdentity undefined (passive migration)", () => {
    const out = run(v02Snapshot({ x: 1 }));
    expect(out.codexIdentity).toBeUndefined();
  });

  it("preserves seeds / ouroAccounts / pureKeypairs / addressBook / watchList unchanged", () => {
    const base = v02Snapshot();
    const input: CodexSnapshot = {
      ...base,
      kadenaSeeds: [
        { id: "s1", seedType: "koala", version: 1, index: 0, secret: "enc", main: true, accounts: [] } as never,
      ],
      ouroAccounts: [
        { id: "o1", version: 1, isSmart: false, address: "k:abc", guard: null, kadenaLedger: "k:abc", publicKey: "abc", secret: "enc", backup: "bk" } as never,
      ],
      pureKeypairs: [
        { id: "p1", publicKey: "pub", encryptedPrivateKey: "enc", createdAt: "2026-01-01T00:00:00.000Z" } as never,
      ],
      addressBook: [
        { id: "a1", name: "Bob", address: "k:bob", type: "stoa", createdAt: "x", updatedAt: "y" } as never,
      ],
      watchList: [
        { id: "w1", label: "watch", address: "k:w", type: "ouronet", createdAt: "x" } as never,
      ],
    };
    const out = run(input);
    expect(out.kadenaSeeds).toEqual(input.kadenaSeeds);
    expect(out.ouroAccounts).toEqual(input.ouroAccounts);
    expect(out.pureKeypairs).toEqual(input.pureKeypairs);
    expect(out.addressBook).toEqual(input.addressBook);
    expect(out.watchList).toEqual(input.watchList);
  });

  it("does not mutate the input snapshot", () => {
    const input = v02Snapshot({ legacyDexPref: "fast" });
    const clone = structuredClone(input);
    run(input);
    expect(input).toEqual(clone);
  });

  it("is idempotent through the runner: an already-v0.3 snapshot is returned unchanged", () => {
    const v03 = run(v02Snapshot({ legacyDexPref: "fast" }));
    const again = run(v03);
    expect(again).toBe(v03); // runner short-circuits when schemaVersion === target
  });

  it("merges the OuronetUI slot on top of pre-existing consumerSettings", () => {
    const base = v02Snapshot({ legacyDexPref: "fast" });
    const input: CodexSnapshot = {
      ...base,
      consumerSettings: {
        Mnemosyne: {
          consumerName: "Mnemosyne",
          consumerVersion: "0.1",
          schemaVersion: 1,
          settings: { theme: "dark" },
          lastUpdatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    const out = run(input);
    expect(out.consumerSettings?.Mnemosyne?.settings).toEqual({ theme: "dark" });
    expect(out.consumerSettings?.OuronetUI?.settings).toEqual({ legacyDexPref: "fast" });
  });
});
