/**
 * v0.3 (schemaVersion 2) -> v0.5 (schemaVersion 3) migration — ZBOM port D2/D5.
 *
 * Exercises the real SCHEMA_MIGRATIONS[{2->3}] entry through the pure
 * applyMigrations runner: patronSelectionMode reconcile (active-wallet->prime,
 * manual->resident), ZBOM settings seeding, current-value pass-through,
 * schemaVersion advance to 3, purity, idempotency, and field preservation.
 */

import { describe, it, expect } from "vitest";
import { emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import {
  applyMigrations,
  SCHEMA_MIGRATIONS,
} from "@ancientpantheon/codex-ouronet/state";

/** A v0.3 (schemaVersion 2) snapshot whose uiSettings is the given partial,
 *  with the new v0.5 ZBOM keys stripped so we can prove seeding. */
function v03Snapshot(ui: Record<string, unknown> = {}): CodexSnapshot {
  const base = emptySnapshot("dev");
  const stripped = { ...(base.uiSettings as Record<string, unknown>) };
  for (const k of [
    "zbomProfile",
    "zbomZone0",
    "zbomZone1",
    "zbomZone2",
    "zbomZone3",
    "zbomExecutePosition",
  ]) {
    delete stripped[k];
  }
  return {
    ...base,
    schemaVersion: 2,
    uiSettings: { ...stripped, ...ui } as CodexSnapshot["uiSettings"],
  };
}

// Isolate the 2->3 step by targeting schemaVersion 3 explicitly.
const run = (snap: CodexSnapshot) =>
  applyMigrations(snap, SCHEMA_MIGRATIONS, 3);

describe("v0.3 -> v0.5 schema migration", () => {
  it("advances schemaVersion to 3", () => {
    expect(run(v03Snapshot()).schemaVersion).toBe(3);
  });

  it("remaps legacy patronSelectionMode 'active-wallet' -> 'prime'", () => {
    const out = run(v03Snapshot({ patronSelectionMode: "active-wallet" }));
    expect(out.uiSettings.patronSelectionMode).toBe("prime");
  });

  it("remaps legacy patronSelectionMode 'manual' -> 'resident'", () => {
    const out = run(v03Snapshot({ patronSelectionMode: "manual" }));
    expect(out.uiSettings.patronSelectionMode).toBe("resident");
  });

  it("passes through already-current patron values unchanged", () => {
    for (const mode of ["wealthiest", "prime", "resident"] as const) {
      const out = run(v03Snapshot({ patronSelectionMode: mode }));
      expect(out.uiSettings.patronSelectionMode).toBe(mode);
    }
  });

  it("falls back to the default for an unrecognized patron value", () => {
    const out = run(v03Snapshot({ patronSelectionMode: "garbage" }));
    expect(out.uiSettings.patronSelectionMode).toBe("wealthiest");
  });

  it("seeds the ZBOM settings defaults when absent", () => {
    const out = run(v03Snapshot());
    expect(out.uiSettings.zbomProfile).toBe("basic");
    expect(out.uiSettings.zbomZone0).toBe(true);
    expect(out.uiSettings.zbomZone1).toBe(false);
    expect(out.uiSettings.zbomZone2).toBe(false);
    expect(out.uiSettings.zbomZone3).toBe(false);
    expect(out.uiSettings.zbomExecutePosition).toBe("top");
  });

  it("preserves a persisted ZBOM setting instead of overwriting with the default", () => {
    const out = run(
      v03Snapshot({
        zbomProfile: "advanced",
        zbomZone3: true,
        zbomExecutePosition: "bottom",
      })
    );
    expect(out.uiSettings.zbomProfile).toBe("advanced");
    expect(out.uiSettings.zbomZone3).toBe(true);
    expect(out.uiSettings.zbomExecutePosition).toBe("bottom");
    // unset ones still seeded
    expect(out.uiSettings.zbomZone0).toBe(true);
  });

  it("preserves other canonical uiSettings keys untouched", () => {
    const out = run(
      v03Snapshot({ passwordCacheMinutes: 7, selectedNode: "node1" })
    );
    expect(out.uiSettings.passwordCacheMinutes).toBe(7);
    expect(out.uiSettings.selectedNode).toBe("node1");
  });

  it("does not mutate the input snapshot", () => {
    const input = v03Snapshot({ patronSelectionMode: "manual" });
    const clone = structuredClone(input);
    run(input);
    expect(input).toEqual(clone);
  });

  it("is idempotent through the runner: an already-v0.5 snapshot is returned unchanged", () => {
    const v05 = run(v03Snapshot({ patronSelectionMode: "active-wallet" }));
    const again = run(v05);
    expect(again).toBe(v05); // runner short-circuits when schemaVersion === target
  });

  it("chains a v0.2 codex 1->2->3 to the current version", () => {
    const v01 = { ...v03Snapshot({ patronSelectionMode: "manual" }), schemaVersion: 1 };
    const out = run(v01);
    expect(out.schemaVersion).toBe(3);
    expect(out.uiSettings.patronSelectionMode).toBe("resident");
    expect(out.uiSettings.zbomProfile).toBe("basic");
  });
});
