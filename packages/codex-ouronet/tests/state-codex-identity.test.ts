/**
 * Store codex-identity action tests — the read-only getCodexIdentity() getter.
 *
 * Covers (no vi.mock — real empty-for-codexIdentity SCHEMA_MIGRATIONS):
 *   - getCodexIdentity returns null (NOT undefined) on a fresh codex.
 *   - getCodexIdentity returns null on a v0.2-shaped codex (no codexIdentity
 *     field) — proving the `?? null` coalesce at the getter boundary.
 *   - getCodexIdentity returns the populated identity when init reads one
 *     through to state.
 *   - getCodexIdentity is a non-cloning read: consecutive calls return the
 *     same object reference (the `?? null` short-circuits to the state slot).
 *
 * The three CI-001/CI-002 migration-cascade specs live in
 * state-codex-identity.migration.test.ts because they need a module-level
 * vi.mock of SCHEMA_MIGRATIONS (mirrors Phase 2's split).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { ICodexIdentity } from "@ancientpantheon/codex-ouronet/types";

const populatedIdentity = (): ICodexIdentity => ({
  formatted: "₱.STANDARD:Π.SMART",
  standardPublicKey: "S".repeat(160),
  smartPublicKey: "Z".repeat(160),
  encryptedSeedWords: "enc-seed-words",
  encryptedStandardBitstring: "enc-std-bits",
  encryptedSmartBitstring: "enc-smart-bits",
  encryptedStandardBase10: "enc-std-b10",
  encryptedSmartBase10: "enc-smart-b10",
  encryptedStandardBase49: "enc-std-b49",
  encryptedSmartBase49: "enc-smart-b49",
  totalWordCount: 12,
  splitIndex: 6,
  createdAt: "2026-05-29T00:00:00.000Z",
});

describe("getCodexIdentity", () => {
  let adapter: MemoryCodexAdapter;
  let store: ReturnType<typeof createCodexStore>;

  beforeEach(async () => {
    adapter = new MemoryCodexAdapter("dev");
    store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
  });

  it("returns null on a fresh codex (no identity present)", () => {
    // A fresh codex has codexIdentity undefined in state; the getter coalesces
    // that to null at the public boundary (the discriminated empty-state).
    expect(store.getState().actions.getCodexIdentity()).toBeNull();
  });

  it("returns strictly null (not undefined) on a v0.2-shaped codex", async () => {
    const v02 = new MemoryCodexAdapter("dev");
    const snap = {
      ...emptySnapshot("dev"),
      codexIdentity: undefined,
    } as CodexSnapshot;
    await v02.saveAll(snap);

    const s2 = createCodexStore();
    await s2.getState().actions.init(v02, "dev");
    // strict === null proves the `?? null` coalesce: a raw read would surface
    // undefined, which fails this assertion.
    expect(s2.getState().actions.getCodexIdentity()).toBe(null);
  });

  it("returns the populated identity when init reads one through to state", async () => {
    const identity = populatedIdentity();
    const seeded = new MemoryCodexAdapter("dev");
    await seeded.saveAll({ ...emptySnapshot("dev"), codexIdentity: identity });

    const s2 = createCodexStore();
    await s2.getState().actions.init(seeded, "dev");
    // init must thread codexIdentity from the loaded snapshot through to state
    // so the getter surfaces the full immutable identity.
    expect(s2.getState().actions.getCodexIdentity()).toEqual(identity);
  });

  it("is a non-cloning read: consecutive calls return the same reference when populated", async () => {
    const identity = populatedIdentity();
    const seeded = new MemoryCodexAdapter("dev");
    await seeded.saveAll({ ...emptySnapshot("dev"), codexIdentity: identity });

    const s2 = createCodexStore();
    await s2.getState().actions.init(seeded, "dev");

    const a = s2.getState().actions.getCodexIdentity();
    const b = s2.getState().actions.getCodexIdentity();
    // `?? null` short-circuits to the underlying state slot — no clone per call.
    // Referential stability over the codex lifetime follows from the no-setter
    // immutability invariant (Phase 3 exposes no API that writes codexIdentity).
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });
});
