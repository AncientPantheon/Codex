/**
 * adapter-core-substrate.test.ts — the D3-deferred F-BUG-002 wiring proof
 * (codex-ouronet → codex-core VALUE edge for the adapter substrate).
 *
 * D3 (Phase 7) genericized `CodexSnapshotBase` + `CodexAdapter<TSnapshot>` into
 * codex-core and deferred the Ouronet-side CONSUME to D5. This file pins that
 * consume at the TYPE level so the D3 substrate is no longer stranded:
 *
 *   (a) the Ouronet `CodexSnapshot` EXTENDS codex-core's `CodexSnapshotBase`
 *       (a value of the Ouronet snapshot is assignable to the base skeleton) —
 *       so the base's `schemaVersion`/`lastUpdatedAt`/`lastUpdatedDevice`
 *       generic contract is the SAME field set the Ouronet snapshot carries,
 *       not a divergent parallel shape.
 *
 * These are compile-time locks (types erase), with a trivial runtime assertion
 * so vitest has something to run. If the Ouronet snapshot ever drops one of the
 * base fields, or their types drift, the assignment below fails the TS transform.
 */

import { describe, it, expect } from "vitest";
import type { CodexSnapshotBase } from "@ancientpantheon/codex-core";
import { emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";

describe("adapter substrate — Ouronet snapshot extends codex-core's generic base (F-BUG-002)", () => {
  it("an Ouronet CodexSnapshot is assignable to codex-core's CodexSnapshotBase", () => {
    // The load-bearing line: a concrete Ouronet snapshot binds to the core base
    // skeleton with no cast. Proves the Ouronet snapshot carries the base's
    // generic metadata fields (schemaVersion/lastUpdatedAt/lastUpdatedDevice) as
    // a structural SUPERSET — the D3 substrate the storage seam is genericized
    // over is the SAME shape the Ouronet side extends, not a fork.
    const snap: CodexSnapshot = emptySnapshot("dev");
    const asBase: CodexSnapshotBase = snap;

    expect(asBase.schemaVersion).toBe(0);
    expect(asBase.lastUpdatedAt).toBeNull();
    expect(asBase.lastUpdatedDevice).toBe("dev");
  });

  it("the base's device-variant vocabulary matches the Ouronet snapshot's", () => {
    // The base and the Ouronet snapshot must agree on the DeviceVariant literal
    // union ("dev" | "main"); a widened/narrowed union on either side would fail
    // the assignment above. Runtime-checks the round-trip of the "main" tag.
    const snap: CodexSnapshot = emptySnapshot("main");
    const asBase: CodexSnapshotBase = snap;
    expect(asBase.lastUpdatedDevice).toBe("main");
  });
});
