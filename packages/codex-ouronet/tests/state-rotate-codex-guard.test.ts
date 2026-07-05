/**
 * Phase 8 (REQ-08) — `rotateCodexGuard()` action.
 *
 * Atomically generates a NEW active CodexGuard (fresh ED25519, `isCodexGuard:
 * true`, label "CodexGuard", prepended) and demotes the previous active guard
 * to `wasCodexGuard: true` with a controlled retirement-suffix label
 * `"<oldLabel> (retired #N)"` (N = next available counter, scanning all labels).
 * Rejects when no active guard exists (`missing-codex-guard`) or when the codex
 * is corrupted with multiple active guards (`integrity-violated`). The demoted
 * key stays undeletable via Phase 6's wasCodexGuard protection.
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { RETIREMENT_SUFFIX_CAPTURE_REGEX } from "@ancientpantheon/codex-ouronet/state";
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
const HEX64 = /^[0-9a-f]{64}$/;

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

const activeGuard = (id = "g1", label = "CodexGuard") =>
  pure(id, {
    label,
    isCodexGuard: true,
    publicKey: "old-pub",
    encryptedPrivateKey: "old-enc",
  });

describe("rotateCodexGuard — Phase 8", () => {
  it("RETIREMENT_SUFFIX_CAPTURE_REGEX extracts the retirement integer", () => {
    const m = "x (retired #42)".match(RETIREMENT_SUFFIX_CAPTURE_REGEX);
    expect(m?.[1]).toBe("42");
    // Same anchors as the non-capture sibling: trailing text / no parens fail.
    expect("x (retired #42) extra".match(RETIREMENT_SUFFIX_CAPTURE_REGEX)).toBe(
      null
    );
    expect("x (retired #abc)".match(RETIREMENT_SUFFIX_CAPTURE_REGEX)).toBe(null);
  });

  it("happy path (first rotation): new guard prepended, old demoted to retired #1", async () => {
    const store = await storeWith([activeGuard("g1")]);
    const { newGuard, retired } = await store
      .getState()
      .actions.rotateCodexGuard();

    // New active guard is a fresh entity, NOT the old one.
    expect(newGuard.isCodexGuard).toBe(true);
    expect(newGuard.label).toBe("CodexGuard");
    expect(newGuard.publicKey).not.toBe("old-pub");
    expect(newGuard.publicKey).toMatch(HEX64);
    expect(newGuard.id).not.toBe("g1");

    // Old guard demoted in place, label suffixed, pubkey preserved.
    expect(retired.id).toBe("g1");
    expect(retired.isCodexGuard).toBe(false);
    expect(retired.wasCodexGuard).toBe(true);
    expect(retired.label).toBe("CodexGuard (retired #1)");
    expect(retired.publicKey).toBe("old-pub");

    // Array shape: new guard at 0 (prepended), old guard at 1 (in place).
    const keys = store.getState().pureKeypairs;
    expect(keys).toHaveLength(2);
    expect(keys[0].id).toBe(newGuard.id);
    expect(keys[1].id).toBe("g1");

    // Phase 5 getter now resolves to the NEW guard, proving the canonical
    // active-filter correctly excludes the demoted (wasCodexGuard) entry.
    expect(store.getState().actions.getCodexGuardPublic()).toBe(
      newGuard.publicKey
    );
  });

  it("the new guard's encrypted private key decrypts at CK to a 64-char hex secret", async () => {
    const store = await storeWith([activeGuard("g1")]);
    const { newGuard } = await store.getState().actions.rotateCodexGuard();
    const secret = await decryptStringV2(newGuard.encryptedPrivateKey, CK);
    expect(secret).toMatch(HEX64);
  });

  it("the retired key remains undeletable (Phase 6 wasCodexGuard protection)", async () => {
    const store = await storeWith([activeGuard("g1")]);
    await store.getState().actions.rotateCodexGuard();
    await expect(
      store.getState().actions.deletePureKeypair("g1")
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "delete-rejected",
    });
    await expect(
      store.getState().actions.deletePureKeypair("g1")
    ).rejects.toThrow(/flag=wasCodexGuard/);
  });

  it("retirement counter increments across successive rotations", async () => {
    const store = await storeWith([activeGuard("g1")]);
    const labels = () => store.getState().pureKeypairs.map((k) => k.label);

    await store.getState().actions.rotateCodexGuard();
    expect(store.getState().pureKeypairs).toHaveLength(2);
    expect(labels()).toContain("CodexGuard (retired #1)");

    await store.getState().actions.rotateCodexGuard();
    expect(store.getState().pureKeypairs).toHaveLength(3);
    expect(labels()).toEqual(
      expect.arrayContaining([
        "CodexGuard (retired #1)",
        "CodexGuard (retired #2)",
      ])
    );

    await store.getState().actions.rotateCodexGuard();
    expect(store.getState().pureKeypairs).toHaveLength(4);
    expect(labels()).toEqual(
      expect.arrayContaining([
        "CodexGuard (retired #1)",
        "CodexGuard (retired #2)",
        "CodexGuard (retired #3)",
      ])
    );
    // Exactly one active guard remains (the newest, at position 0).
    const active = store
      .getState()
      .pureKeypairs.filter((k) => k.isCodexGuard === true);
    expect(active).toHaveLength(1);
    expect(store.getState().pureKeypairs[0].isCodexGuard).toBe(true);
  });

  it("next counter is max(existing N) + 1, not count + 1 (non-monotonic gap)", async () => {
    // A pre-existing retired entry at #7 plus a fresh active guard: the next
    // retirement must be #8, proving max-scan rather than naive sequence.
    const store = await storeWith([
      pure("old", {
        label: "OldGuard (retired #7)",
        wasCodexGuard: true,
        isCodexGuard: false,
      }),
      activeGuard("g1"),
    ]);
    const { retired } = await store.getState().actions.rotateCodexGuard();
    expect(retired.label).toBe("CodexGuard (retired #8)");
  });

  it("rejects with missing-codex-guard when no active guard exists", async () => {
    const store = await storeWith([pure("u", { label: "user-key" })]);
    await expect(
      store.getState().actions.rotateCodexGuard()
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "missing-codex-guard",
    });
    // State untouched.
    expect(store.getState().pureKeypairs).toHaveLength(1);
    expect(store.getState().pureKeypairs[0].id).toBe("u");
  });

  it("rejects with integrity-violated on a corrupted multi-active codex", async () => {
    const store = await storeWith([
      pure("a", { isCodexGuard: true }),
      pure("b", { isCodexGuard: true }),
    ]);
    await expect(
      store.getState().actions.rotateCodexGuard()
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "integrity-violated",
    });
    await expect(
      store.getState().actions.rotateCodexGuard()
    ).rejects.toThrow(/2 active CodexGuards/);
    expect(store.getState().pureKeypairs).toHaveLength(2);
  });

  it("propagates CodexLockedError without leaking a keypair", async () => {
    const store = await storeWith([activeGuard("g1")], { lock: true });
    await expect(
      store.getState().actions.rotateCodexGuard()
    ).rejects.toBeInstanceOf(CodexLockedError);
    // Auth pre-flight first — no generation, old guard untouched.
    expect(store.getState().pureKeypairs).toHaveLength(1);
    expect(store.getState().pureKeypairs[0].isCodexGuard).toBe(true);
  });

  it("counter scan ignores malformed (#abc) labels and picks the max valid N", async () => {
    const store = await storeWith([
      pure("r1", { label: "random (retired #99)", wasCodexGuard: true }),
      activeGuard("active"),
      pure("plain", { label: "plain-key" }),
      pure("r2", { label: "another (retired #5)", wasCodexGuard: true }),
      pure("bad", { label: "weird (retired #abc)" }),
    ]);
    const { retired } = await store.getState().actions.rotateCodexGuard();
    // Max valid N across all labels is 99; #abc is non-digit and ignored.
    expect(retired.label).toBe("CodexGuard (retired #100)");
  });
});
