/**
 * Phase 5 T5.2 — IPureKeypair CodexGuard / DuoPurePrime flag preservation.
 *
 * Scope: prove that the four new optional marker flags (`isCodexGuard`,
 * `wasCodexGuard`, `isDuoPurePrime`, `duoPurePrimeRole`) survive the THREE
 * round-trip surfaces owned by this package:
 *   (a) MemoryCodexAdapter.saveAll/loadAll          (structuredClone)
 *   (b) MemoryCodexAdapter.savePureKeypairs/loadAll (per-slice)
 *   (c) LocalStorageCodexAdapter.savePureKeypairs/loadAll (JSON per-slice)
 *
 * OUT OF SCOPE (deferred to Phase 11 — G-001):
 *   - @stoachain/ouronet-core wire-format codec (v1.2) — cross-device
 *     export/restore via the on-disk backup file. The codec lives in
 *     ouronet-core (frozen at "1.2"); v0.3.0 flag preservation across
 *     Google Drive backups is handled by Phase 11's atomic ouronet-core
 *     bump (precedent: v0.1.0 Phase 6b.1).
 *
 * Test strategy: build a fixture IPureKeypair with all four flags
 * populated (mix of true/false to catch destructure-then-rebuild bugs);
 * round-trip; assert all flags survive byte-identically.
 *
 * This task adds NO production code — the existing serialization paths
 * (structuredClone / JSON.stringify the whole entry) must already preserve
 * the flags. A failing spec here means a production bug (an unexpected
 * field destructure in the adapter chain), which is surfaced to the
 * conductor rather than patched inside Phase 5.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

const buildFlaggedKeypair = (id: string): IPureKeypair => ({
  id,
  label: "CodexGuard",
  publicKey: "a".repeat(64),
  encryptedPrivateKey: "enc-priv-blob",
  createdAt: "2026-05-29T00:00:00.000Z",
  isCodexGuard: true,
  wasCodexGuard: false,
  isDuoPurePrime: true,
  duoPurePrimeRole: "guard",
});

describe("MemoryCodexAdapter flag preservation", () => {
  it("saveAll/loadAll preserves all four marker flags (structuredClone path)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const snap = {
      ...emptySnapshot("dev"),
      pureKeypairs: [buildFlaggedKeypair("k1")],
    };
    await adapter.saveAll(snap);
    const loaded = await adapter.loadAll();

    const kp = loaded.pureKeypairs[0];
    // structuredClone enumerates own properties, so each explicitly-set flag
    // must survive verbatim — including the explicit `false` (which a naive
    // destructure-with-defaults would silently flip).
    expect(kp.isCodexGuard).toBe(true);
    expect(kp.wasCodexGuard).toBe(false);
    expect(kp.isDuoPurePrime).toBe(true);
    expect(kp.duoPurePrimeRole).toBe("guard");
    expect(kp).toEqual(buildFlaggedKeypair("k1"));
  });

  it("savePureKeypairs/loadAll preserves all four flags (per-slice path)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    await adapter.savePureKeypairs([buildFlaggedKeypair("k2")]);
    const loaded = await adapter.loadAll();

    const kp = loaded.pureKeypairs[0];
    expect(kp.isCodexGuard).toBe(true);
    expect(kp.wasCodexGuard).toBe(false);
    expect(kp.isDuoPurePrime).toBe(true);
    expect(kp.duoPurePrimeRole).toBe("guard");
    expect(kp).toEqual(buildFlaggedKeypair("k2"));
  });

  it("savePureKeypairs preserves a mixed-flag array (omitted vs explicit distinction)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const active: IPureKeypair = {
      id: "active",
      label: "CodexGuard",
      publicKey: "c".repeat(64),
      encryptedPrivateKey: "enc-a",
      createdAt: "2026-05-29T00:00:00.000Z",
      isCodexGuard: true,
      isDuoPurePrime: false,
      // duoPurePrimeRole intentionally omitted
    };
    const retired: IPureKeypair = {
      id: "retired",
      label: "CodexGuard (retired #1)",
      publicKey: "d".repeat(64),
      encryptedPrivateKey: "enc-b",
      createdAt: "2026-05-29T00:00:00.000Z",
      wasCodexGuard: true,
      isDuoPurePrime: true,
      duoPurePrimeRole: "payment",
    };
    await adapter.savePureKeypairs([active, retired]);
    const loaded = await adapter.loadAll();

    // Omitted-vs-explicit must round-trip exactly: the omitted role stays
    // omitted (undefined), the explicit `false` stays `false`. A rebuild that
    // coerced both to a default would fail one of these.
    expect(loaded.pureKeypairs[0]).toEqual(active);
    expect(loaded.pureKeypairs[0].duoPurePrimeRole).toBeUndefined();
    expect(loaded.pureKeypairs[0].isDuoPurePrime).toBe(false);
    expect(loaded.pureKeypairs[1]).toEqual(retired);
    expect(loaded.pureKeypairs[1].duoPurePrimeRole).toBe("payment");
  });

  it("saveAll preserves the duoPurePrimeRole discriminated-union literal (no widening to string)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const payment: IPureKeypair = {
      ...buildFlaggedKeypair("pay"),
      duoPurePrimeRole: "payment",
    };
    const guard: IPureKeypair = {
      ...buildFlaggedKeypair("grd"),
      duoPurePrimeRole: "guard",
    };
    await adapter.saveAll({
      ...emptySnapshot("dev"),
      pureKeypairs: [payment, guard],
    });
    const loaded = await adapter.loadAll();

    // Both literal members of the union survive as the exact string values.
    expect(loaded.pureKeypairs[0].duoPurePrimeRole).toBe("payment");
    expect(loaded.pureKeypairs[1].duoPurePrimeRole).toBe("guard");
  });
});

describe("LocalStorageCodexAdapter flag preservation", () => {
  function makeLocalStorageMock(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      get length() {
        return m.size;
      },
    } as Storage;
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorageMock());
    vi.stubGlobal("window", { localStorage: globalThis.localStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("savePureKeypairs JSON-stringifies the whole entry; loadAll reads flags back", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const arr = [buildFlaggedKeypair("k3")];
    await adapter.savePureKeypairs(arr);

    // The per-slice write stores the JSON-stringified array verbatim — proves
    // the additive-optional flags reach localStorage (JSON.stringify enumerates
    // own enumerable props, so explicit-set flags including `false` survive).
    expect(window.localStorage.getItem("pureKeypairs")).toBe(
      JSON.stringify(arr)
    );

    const loaded = await adapter.loadAll();
    const kp = loaded.pureKeypairs[0];
    expect(kp.isCodexGuard).toBe(true);
    expect(kp.wasCodexGuard).toBe(false);
    expect(kp.isDuoPurePrime).toBe(true);
    expect(kp.duoPurePrimeRole).toBe("guard");
    expect(kp).toEqual(buildFlaggedKeypair("k3"));
  });

  it("legacy v0.2 entry (no flags) round-trips untouched (additive-optional back-compat)", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    const legacy: IPureKeypair = {
      id: "legacy",
      label: "old key",
      publicKey: "e".repeat(64),
      encryptedPrivateKey: "enc-legacy",
      createdAt: "2026-05-29T00:00:00.000Z",
    };
    await adapter.savePureKeypairs([legacy]);
    const loaded = await adapter.loadAll();

    const kp = loaded.pureKeypairs[0];
    // The four new flag fields stay undefined — existing user codices keep
    // loading without a runtime migration.
    expect(kp).toEqual(legacy);
    expect(kp.isCodexGuard).toBeUndefined();
    expect(kp.wasCodexGuard).toBeUndefined();
    expect(kp.isDuoPurePrime).toBeUndefined();
    expect(kp.duoPurePrimeRole).toBeUndefined();
  });
});
