/**
 * Contract tests for the GENERICIZED CodexAdapter storage seam.
 *
 * This is the shape-driving RED for the generic substrate: it pins the
 * Ouronet-FREE skeleton (`CodexSnapshotBase` + `emptySnapshotBase`), the
 * generic `CodexAdapter<TSnapshot>` method surface, and the structured
 * `assertCodexAdapter` runtime guard — the three seams codex-core must own
 * so a headless, non-Ouronet consumer can import core without dragging in
 * Kadena/Ouronet entity types.
 *
 * The source `CodexAdapter`/`CodexSnapshot` (ouronet-codex) is deeply
 * Ouronet-coupled — it names `kadenaSeeds`/`ouroAccounts`/`codexIdentity`
 * arrays and carries per-Ouronet-entity convenience writes. The generic core
 * seam MUST strip all of that: the base is a chain-agnostic skeleton, and the
 * Ouronet arrays + per-entity writes live in the D5 Ouronet extension, NOT
 * here. These assertions fail-closed if genericization regresses back toward
 * the coupled source shape.
 *
 * Imports resolve from the ADAPTERS SUBPATH barrel (`../src/adapters`), which
 * does not exist yet — so this file is fully RED until T7.4 lands the seam.
 */

import { describe, it, expect, expectTypeOf } from "vitest";
import {
  emptySnapshotBase,
  assertCodexAdapter,
  type CodexSnapshotBase,
  type CodexAdapter,
} from "../src/adapters/index.js";
import { CodexError, CodexAdapterError } from "../src/codex/errors.js";

// ---------------------------------------------------------------------------
// A minimal consumer snapshot: `CodexSnapshotBase` plus one opaque array. This
// stands in for the D5 Ouronet extension WITHOUT importing any Ouronet type —
// proving the generic adapter is parameterizable over an arbitrary snapshot
// that carries chain-specific payload the core layer never names.
// ---------------------------------------------------------------------------
interface TestSnapshot extends CodexSnapshotBase {
  widgets: string[];
}

interface TestUiSettings {
  theme: string;
}

/**
 * A conforming adapter double built against `TestSnapshot`. It implements the
 * ENTIRE generic surface and NOTHING Ouronet-specific — if a `CodexAdapter`
 * double that omits `saveKadenaSeeds`/`saveOuroAccounts`/etc. still typechecks,
 * those writes are (correctly) NOT on the generic interface.
 */
function makeConformingDouble(
  device: CodexSnapshotBase["lastUpdatedDevice"]
): CodexAdapter<TestSnapshot, TestUiSettings> {
  let snapshot: TestSnapshot = { ...emptySnapshotBase(device), widgets: [] };
  return {
    name: "test-double",
    async loadAll() {
      return snapshot;
    },
    async saveAll(next) {
      snapshot = next;
    },
    async touch(deviceVariant) {
      const lastUpdatedAt = "2026-07-05T00:00:00.000Z";
      snapshot = { ...snapshot, lastUpdatedAt, lastUpdatedDevice: deviceVariant };
      return { lastUpdatedAt, lastUpdatedDevice: deviceVariant };
    },
    async getSchemaVersion() {
      return snapshot.schemaVersion;
    },
    async setSchemaVersion(v) {
      snapshot = { ...snapshot, schemaVersion: v };
    },
    async loadUiSettingsEncrypted() {
      return null;
    },
    async saveUiSettingsEncrypted() {
      /* no-op sidecar for the double */
    },
    async clearAll() {
      snapshot = { ...emptySnapshotBase(device), widgets: [] };
    },
  };
}

describe("emptySnapshotBase — the Ouronet-free skeleton", () => {
  it("seeds schemaVersion 0 and a null lastUpdatedAt (a fresh codex has never been persisted)", () => {
    const snap = emptySnapshotBase("main");
    expect(snap.schemaVersion).toBe(0);
    expect(snap.lastUpdatedAt).toBeNull();
  });

  it("stamps lastUpdatedDevice with the passed variant (the device tag drives multi-device conflict metadata)", () => {
    expect(emptySnapshotBase("dev").lastUpdatedDevice).toBe("dev");
    expect(emptySnapshotBase("main").lastUpdatedDevice).toBe("main");
  });

  it("omits foreignKeys when empty (parity with the D2 codec's 'empty keyring ⇒ field absent' convention)", () => {
    expect(emptySnapshotBase("main")).not.toHaveProperty("foreignKeys");
  });

  it("carries NO Ouronet entity arrays — the base is chain-agnostic, Ouronet arrays live in the D5 extension", () => {
    const snap = emptySnapshotBase("main");
    expect(snap).not.toHaveProperty("kadenaSeeds");
    expect(snap).not.toHaveProperty("ouroAccounts");
    expect(snap).not.toHaveProperty("codexIdentity");
    expect(snap).not.toHaveProperty("pureKeypairs");
    expect(snap).not.toHaveProperty("uiSettings");
  });
});

describe("CodexAdapter<TSnapshot> — the generic method surface (compile-time contract)", () => {
  it("a double implementing only the generic surface satisfies CodexAdapter (per-Ouronet-entity writes are NOT required)", () => {
    const adapter = makeConformingDouble("main");
    // A double with NO saveKadenaSeeds/saveOuroAccounts/etc. still typechecks
    // as a CodexAdapter — the type parameter below asserts this at compile time.
    expectTypeOf(adapter).toMatchTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>();
    expect(adapter.name).toBe("test-double");
  });

  it("exposes a readonly name plus the generic read/write/metadata/sidecar/destructive methods (typed against TSnapshot)", () => {
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().toHaveProperty("name");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>["loadAll"]>().returns.resolves.toEqualTypeOf<TestSnapshot>();
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>["saveAll"]>().parameter(0).toEqualTypeOf<TestSnapshot>();
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().toHaveProperty("touch");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().toHaveProperty("getSchemaVersion");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().toHaveProperty("setSchemaVersion");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().toHaveProperty("loadUiSettingsEncrypted");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().toHaveProperty("saveUiSettingsEncrypted");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().toHaveProperty("clearAll");
  });

  it("does NOT declare per-Ouronet-entity writes on the generic interface (saveKadenaSeeds etc. moved to the D5 extension)", () => {
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().not.toHaveProperty("saveKadenaSeeds");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().not.toHaveProperty("saveOuroAccounts");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().not.toHaveProperty("savePureKeypairs");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().not.toHaveProperty("saveCodexIdentity");
    expectTypeOf<CodexAdapter<TestSnapshot, TestUiSettings>>().not.toHaveProperty("saveConsumerSettings");
  });

  it("round-trips a TSnapshot through the double (the generic loadAll/saveAll contract is snapshot-preserving)", async () => {
    const adapter = makeConformingDouble("main");
    const next: TestSnapshot = { ...emptySnapshotBase("dev"), widgets: ["a", "b"] };
    await adapter.saveAll(next);
    expect(await adapter.loadAll()).toEqual(next);
  });
});

describe("assertCodexAdapter — the runtime guard (branching logic)", () => {
  it("throws CodexAdapterError when loadAll/saveAll are missing (a plain object is not an adapter)", () => {
    expect(() => assertCodexAdapter({})).toThrow(CodexAdapterError);
  });

  it("throws when only one of the two required methods is present (both loadAll AND saveAll are required)", () => {
    expect(() => assertCodexAdapter({ loadAll: () => {} })).toThrow(CodexAdapterError);
    expect(() => assertCodexAdapter({ saveAll: () => {} })).toThrow(CodexAdapterError);
    expect(() => assertCodexAdapter(null)).toThrow(CodexAdapterError);
  });

  it("passes for a conforming double (a real adapter with loadAll/saveAll functions is accepted)", () => {
    const adapter = makeConformingDouble("main");
    expect(() => assertCodexAdapter(adapter)).not.toThrow();
  });

  it("throws a structured error: instanceof CodexError with adapter='unknown' and operation='assertCodexAdapter'", () => {
    let caught: unknown;
    try {
      assertCodexAdapter({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodexError);
    expect(caught).toBeInstanceOf(CodexAdapterError);
    const err = caught as CodexAdapterError;
    expect(err.adapter).toBe("unknown");
    expect(err.operation).toBe("assertCodexAdapter");
  });

  it("keeps the error message secret-free — it names the operation but echoes no snapshot/keyfile value", () => {
    let message = "";
    try {
      assertCodexAdapter({ loadAll: "not-a-fn", secret: "SUPER-SECRET-KEYFILE" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("SUPER-SECRET-KEYFILE");
  });
});
