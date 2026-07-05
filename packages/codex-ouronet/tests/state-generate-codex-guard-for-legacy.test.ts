/**
 * Phase 8 (REQ-08) — `generateCodexGuardForLegacy()` one-shot action.
 *
 * For v0.2-migrated codices that lack a CodexGuard: generates a fresh random
 * ED25519 keypair, encrypts the private half at CK, flags `isCodexGuard: true`
 * with label `"CodexGuard"`, and PREPENDS it to `pureKeypairs[]`. Rejects when
 * an active CodexGuard already exists (`already-exists`) or when the codex is
 * corrupted with multiple active guards (`integrity-violated`). Auth pre-flight
 * runs FIRST so a locked codex propagates `CodexLockedError` without consuming
 * entropy on a wasted keypair.
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexLockedError,
} from "@ancientpantheon/codex-ouronet/errors";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";
import { decryptStringV2 } from "@stoachain/stoa-core/crypto";

const CK = "codex-password-123";

const pure = (
  id: string,
  overrides: Partial<IPureKeypair> = {}
): IPureKeypair => ({
  id,
  label: "user-key",
  publicKey: `${id}-pub`,
  encryptedPrivateKey: `${id}-enc`,
  createdAt: "2026-05-24T10:01:00.000Z",
  ...overrides,
});

const HEX64 = /^[0-9a-f]{64}$/;
const UUIDISH = /^[0-9a-f-]{8,}$/i;

/** Build a store with pre-populated pureKeypairs, authenticated by default so
 *  the auth pre-flight passes. Pass `lock: true` to leave it locked. */
async function storeWith(
  keypairs: IPureKeypair[],
  opts: { lock?: boolean } = {}
) {
  const adapter = new MemoryCodexAdapter("dev");
  const snap: CodexSnapshot = {
    ...emptySnapshot("dev"),
    pureKeypairs: keypairs,
  };
  await adapter.saveAll(snap);
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  if (!opts.lock) {
    store.getState().actions.authenticate(CK, 60);
  }
  return store;
}

describe("generateCodexGuardForLegacy — Phase 8", () => {
  it("happy path on empty codex: builds a CodexGuard and prepends it", async () => {
    const store = await storeWith([]);
    const out = await store.getState().actions.generateCodexGuardForLegacy();

    // The returned entity is a well-formed active CodexGuard.
    expect(out.isCodexGuard).toBe(true);
    expect(out.label).toBe("CodexGuard");
    expect(out.publicKey).toMatch(HEX64);
    expect(out.encryptedPrivateKey.length).toBeGreaterThan(0);
    expect(out.id).toMatch(UUIDISH);
    // createdAt is a recent, parseable ISO-8601 timestamp.
    expect(Number.isNaN(Date.parse(out.createdAt))).toBe(false);

    // State now holds exactly the new guard at position 0.
    const keys = store.getState().pureKeypairs;
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual(out);

    // Phase 5 getter sees the freshly-generated guard.
    expect(store.getState().actions.getCodexGuardPublic()).toBe(out.publicKey);
  });

  it("round-trip: the encrypted private key decrypts at CK to a 64-char hex secret", async () => {
    const store = await storeWith([]);
    const out = await store.getState().actions.generateCodexGuardForLegacy();

    // CK-binding proof: decrypting with the codex password recovers the raw
    // ED25519 secret key. A wrong CK would throw / return garbage.
    const secret = await decryptStringV2(out.encryptedPrivateKey, CK);
    expect(secret).toMatch(HEX64);
  });

  it("prepends ahead of existing non-CodexGuard keys (position 0, not append)", async () => {
    const store = await storeWith([pure("k1", { label: "user-key" })]);
    await store.getState().actions.generateCodexGuardForLegacy();

    const keys = store.getState().pureKeypairs;
    expect(keys).toHaveLength(2);
    expect(keys[0].isCodexGuard).toBe(true);
    // The original user key is pushed to position 1 — proves prepend semantics.
    expect(keys[1].id).toBe("k1");
  });

  it("rejects with already-exists when an active CodexGuard is present", async () => {
    const store = await storeWith([
      pure("g", { label: "CodexGuard", isCodexGuard: true }),
    ]);
    await expect(
      store.getState().actions.generateCodexGuardForLegacy()
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "already-exists",
    });
    // No second entry leaked into state.
    expect(store.getState().pureKeypairs).toHaveLength(1);
  });

  it("rejects with integrity-violated on a corrupted multi-active codex", async () => {
    const store = await storeWith([
      pure("g1", { isCodexGuard: true }),
      pure("g2", { isCodexGuard: true }),
    ]);
    await expect(
      store.getState().actions.generateCodexGuardForLegacy()
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "integrity-violated",
    });
    // detail names the offending count so a corrupted codex is diagnosable.
    await expect(
      store.getState().actions.generateCodexGuardForLegacy()
    ).rejects.toThrow(/2 active CodexGuards/);
    expect(store.getState().pureKeypairs).toHaveLength(2);
  });

  it("propagates CodexLockedError on a locked codex without leaking a keypair", async () => {
    const store = await storeWith([], { lock: true });
    await expect(
      store.getState().actions.generateCodexGuardForLegacy()
    ).rejects.toBeInstanceOf(CodexLockedError);
    // Auth pre-flight runs BEFORE generation — no wasted keypair committed.
    expect(store.getState().pureKeypairs).toHaveLength(0);
  });

  it("a wasCodexGuard (retired) entry does NOT count as active; generation succeeds", async () => {
    const store = await storeWith([
      pure("retired", {
        label: "CodexGuard (retired #1)",
        isCodexGuard: false,
        wasCodexGuard: true,
      }),
    ]);
    const out = await store.getState().actions.generateCodexGuardForLegacy();

    const keys = store.getState().pureKeypairs;
    expect(keys).toHaveLength(2);
    expect(keys[0].id).toBe(out.id);
    expect(keys[0].isCodexGuard).toBe(true);
    // The retired entry is preserved (now at position 1).
    expect(keys[1].wasCodexGuard).toBe(true);
  });
});
