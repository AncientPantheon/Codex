/**
 * Store codex-guard action tests — the read-only getCodexGuardPublic() and
 * getCodexGuardEncryptedPrivate() getters.
 *
 * Covers:
 *   - both getters return null (NOT undefined) on a fresh codex and on a codex
 *     with pure keypairs but none flagged isCodexGuard — the `?? null` coalesce
 *     at the getter boundary.
 *   - both getters surface the active CodexGuard's publicKey / encryptedPrivateKey
 *     when exactly one entry is flagged isCodexGuard: true.
 *   - strict `=== true` equality rejects an explicit `false` flag.
 *   - F-001 defensive integrity check: >1 active CodexGuard throws
 *     CodexGuardError("integrity-violated").
 *   - F-002 mutual-exclusion: an entry with BOTH isCodexGuard and wasCodexGuard
 *     is treated as retired (skipped), not active.
 *   - F-004 lowest-layer JSON serialization preserves the flags.
 *
 * Read-only: the getters never mutate state nor call the adapter. Phase 5 ships
 * NO setter — Phase 7/8 atomic actions are the only writers.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { CodexGuardError } from "@ancientpantheon/codex-ouronet/errors";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

const baseKeypair = (id: string): IPureKeypair => ({
  id,
  label: "regular",
  publicKey: `${id}-pub`,
  encryptedPrivateKey: `${id}-enc`,
  createdAt: "2026-05-29T00:00:00.000Z",
});

async function storeWithKeypairs(keypairs: IPureKeypair[]) {
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({ ...emptySnapshot("dev"), pureKeypairs: keypairs });
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  return store;
}

describe("getCodexGuard getters", () => {
  let freshStore: ReturnType<typeof createCodexStore>;

  beforeEach(async () => {
    const adapter = new MemoryCodexAdapter("dev");
    freshStore = createCodexStore();
    await freshStore.getState().actions.init(adapter, "dev");
  });

  it("getCodexGuardPublic returns null on a fresh codex (empty pureKeypairs)", () => {
    // Fresh codex has no CodexGuard; the contract is null, NOT undefined.
    expect(freshStore.getState().actions.getCodexGuardPublic()).toBe(null);
  });

  it("getCodexGuardEncryptedPrivate returns null on a fresh codex", () => {
    expect(
      freshStore.getState().actions.getCodexGuardEncryptedPrivate()
    ).toBe(null);
  });

  it("getCodexGuardPublic returns null when entries exist but none is flagged", async () => {
    const store = await storeWithKeypairs([baseKeypair("k1"), baseKeypair("k2")]);
    // No entry carries isCodexGuard: true, so the active filter is empty and
    // the getter coalesces to null.
    expect(store.getState().actions.getCodexGuardPublic()).toBe(null);
  });

  it("getCodexGuardPublic returns the active CodexGuard's publicKey", async () => {
    const store = await storeWithKeypairs([
      {
        ...baseKeypair("guard"),
        publicKey: "guard-pub-key",
        isCodexGuard: true,
      },
      { ...baseKeypair("other"), publicKey: "other-key" },
    ]);
    expect(store.getState().actions.getCodexGuardPublic()).toBe("guard-pub-key");
  });

  it("getCodexGuardEncryptedPrivate returns the active CodexGuard's encryptedPrivateKey", async () => {
    const store = await storeWithKeypairs([
      {
        ...baseKeypair("guard"),
        encryptedPrivateKey: "guard-enc-priv",
        isCodexGuard: true,
      },
      { ...baseKeypair("other"), encryptedPrivateKey: "other-enc" },
    ]);
    expect(
      store.getState().actions.getCodexGuardEncryptedPrivate()
    ).toBe("guard-enc-priv");
  });

  it("strict === true: an explicit isCodexGuard: false entry is not matched", async () => {
    const store = await storeWithKeypairs([
      { ...baseKeypair("f"), publicKey: "false-flag", isCodexGuard: false },
    ]);
    // `=== true` must reject the explicit `false` — proves the getter does not
    // treat a falsy-but-present flag as a match.
    expect(store.getState().actions.getCodexGuardPublic()).toBe(null);
  });

  it("F-001: throws integrity-violated when >1 active CodexGuard exists", async () => {
    const store = await storeWithKeypairs([
      { ...baseKeypair("g1"), publicKey: "pub1", isCodexGuard: true },
      { ...baseKeypair("g2"), publicKey: "pub2", isCodexGuard: true },
    ]);
    const actions = store.getState().actions;

    // Loud failure on a corrupted codex beats silently picking the first match.
    expect(() => actions.getCodexGuardPublic()).toThrow(CodexGuardError);
    try {
      actions.getCodexGuardPublic();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CodexGuardError).reason).toBe("integrity-violated");
      expect((e as CodexGuardError).message).toMatch(/2 active CodexGuards/);
    }

    expect(() => actions.getCodexGuardEncryptedPrivate()).toThrow(
      CodexGuardError
    );
    try {
      actions.getCodexGuardEncryptedPrivate();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CodexGuardError).reason).toBe("integrity-violated");
    }
  });

  it("F-002: a hybrid (both flags) entry is skipped; the genuine active is returned", async () => {
    const store = await storeWithKeypairs([
      {
        ...baseKeypair("hybrid"),
        publicKey: "hybrid",
        isCodexGuard: true,
        wasCodexGuard: true,
      },
      { ...baseKeypair("real"), publicKey: "real-active", isCodexGuard: true },
    ]);
    // The hybrid entry (mid-rotation corruption) is treated as retired-not-active
    // and skipped; the single genuine active CodexGuard is returned. Without the
    // wasCodexGuard !== true filter this would trip the >1-active integrity throw.
    expect(store.getState().actions.getCodexGuardPublic()).toBe("real-active");
  });

  it("F-002: a lone hybrid (both flags) entry yields null (treated as retired)", async () => {
    const store = await storeWithKeypairs([
      {
        ...baseKeypair("hybrid"),
        publicKey: "hybrid-only",
        isCodexGuard: true,
        wasCodexGuard: true,
      },
    ]);
    // A single hybrid entry is ignored entirely — this is the Phase-8
    // mid-rotation-crash scenario, which must read as "no active guard" (null),
    // not as the active guard.
    expect(store.getState().actions.getCodexGuardPublic()).toBe(null);
  });

  it("F-004: marker flags survive a pure JSON serialization round-trip", () => {
    const snap = {
      ...emptySnapshot("dev"),
      pureKeypairs: [
        {
          id: "k1",
          label: "CodexGuard",
          publicKey: "a".repeat(64),
          encryptedPrivateKey: "enc",
          createdAt: "2026-05-29T00:00:00.000Z",
          isCodexGuard: true,
          isDuoPurePrime: true,
          duoPurePrimeRole: "payment" as const,
        },
      ],
    };
    const out = JSON.parse(JSON.stringify(snap));
    // The lowest serialization layer (which Phase 11's wire codec ultimately
    // delegates to) must preserve the flags — complements T5.2's adapter-level
    // round-trips with the minimal JSON contract.
    expect(out.pureKeypairs[0].isCodexGuard).toBe(true);
    expect(out.pureKeypairs[0].isDuoPurePrime).toBe(true);
    expect(out.pureKeypairs[0].duoPurePrimeRole).toBe("payment");
  });
});
