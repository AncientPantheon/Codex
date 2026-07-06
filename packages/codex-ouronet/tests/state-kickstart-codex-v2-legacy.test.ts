/**
 * v0.2 legacy kickstartCodex backward-compat tests — Phase 7 T7.4 (REQ-07).
 *
 * F-004 LOCKED — pure-passthrough: a v0.2 caller passing `{ seed, primeOuroAccount }`
 * installs ONLY the pre-formed seed + ouro account; `codexIdentity` stays
 * undefined and NO CodexGuard is auto-created. PAT-003 — the legacy path also
 * defensively rejects a codex that already carries a v0.3 identity / CodexGuard
 * (tampered/imported state). The public `kickstartCodex` dispatches v0.2 vs v0.3
 * by shape; a mixed object (both v0.2 and v0.3 fields) is rejected up front.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexKickstartError,
  CodexIdentityError,
  CodexGuardError,
} from "@ancientpantheon/codex-ouronet/errors";
import type { IStoaChainSeed, IOuroAccount } from "@ancientpantheon/codex-ouronet/types";
import type { KickstartArgsV3 } from "@ancientpantheon/codex-ouronet/codex-identity";

const T = { timeout: 120_000 };

let adapter: CodexAdapter;
let store: ReturnType<typeof createCodexStore>;

beforeEach(async () => {
  adapter = new MemoryCodexAdapter("dev");
  store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
});

function v2Seed(id = "s1"): Omit<IStoaChainSeed, "isPrime"> {
  return {
    id, name: "Seed", seedType: "koala", version: "2", index: 0,
    secret: "enc-mnemonic", main: "k:" + "0".repeat(64),
    createdAt: "2026-05-31T00:00:00.000Z",
    accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/44'/626'/0'/0/0" }],
  };
}

function v2Ouro(id = "o1", isSmart = false): Omit<IOuroAccount, "isPrime" | "parentSeedId"> {
  return {
    id, name: "Ouro", version: "2", isSmart, address: "Ѻ." + id,
    guard: null, stoaChainLedger: null, publicKey: "pk-" + id,
    secret: "enc-secret", backup: "",
  };
}

const v3Args: KickstartArgsV3 = {
  codexIdSeed: { mode: "words", value: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima" },
  codexPrimeSeed: { source: "reuse-codexid-whole" },
  duoPrime: { mode: "auto-pure-keys" },
};

describe("kickstartCodex v0.2 legacy passthrough", () => {
  it("installs only the pre-formed seed + ouro; no codexIdentity, no CodexGuard", async () => {
    const r = (await store.getState().actions.kickstartCodex({
      seed: v2Seed("s1"),
      primeOuroAccount: v2Ouro("o1"),
    })) as { seed: IStoaChainSeed; primeOuro: IOuroAccount };

    expect(r.seed.isPrime).toBe(true);
    expect(r.primeOuro.isPrime).toBe(true);
    expect(r.primeOuro.parentSeedId).toBe("s1");

    const s = store.getState();
    expect(s.kadenaSeeds).toHaveLength(1);
    expect(s.ouroAccounts).toHaveLength(1);
    expect(s.codexIdentity).toBeUndefined();
    expect(s.pureKeypairs).toHaveLength(0);
  });

  it("rejects a smart prime ouro (smart-account-not-allowed)", async () => {
    await expect(
      store.getState().actions.kickstartCodex({
        seed: v2Seed(), primeOuroAccount: v2Ouro("o1", true),
      }),
    ).rejects.toMatchObject({ reason: "smart-account-not-allowed" });
  });

  it("rejects when the codex already has a kadena seed (already-kickstarted)", async () => {
    await adapter.saveStoaChainSeeds([{ ...v2Seed("pre"), isPrime: true }]);
    await store.getState().actions.init(adapter, "dev");
    await expect(
      store.getState().actions.kickstartCodex({ seed: v2Seed("s1"), primeOuroAccount: v2Ouro() }),
    ).rejects.toMatchObject({ reason: "already-kickstarted" });
  });
});

describe("kickstartCodex dispatch boundary", () => {
  it("rejects a mixed v0.2+v0.3 args object (invalid-args)", async () => {
    store.getState().actions.authenticate("pw", 60);
    await expect(
      store.getState().actions.kickstartCodex({
        seed: v2Seed(), primeOuroAccount: v2Ouro(), ...v3Args,
      } as unknown as KickstartArgsV3),
    ).rejects.toMatchObject({ reason: "invalid-args" });
  });

  it("routes a clean v0.3 shape to the v0.3 path (codexIdentity populated)", T, async () => {
    store.getState().actions.authenticate("pw", 60);
    const r = (await store.getState().actions.kickstartCodex(v3Args)) as {
      codexIdentity?: unknown;
    };
    expect(r.codexIdentity).toBeDefined();
    expect(store.getState().codexIdentity).toBeDefined();
  });

  it("routes a clean v0.2 shape to the v0.2 path (returns {seed, primeOuro})", async () => {
    const r = (await store.getState().actions.kickstartCodex({
      seed: v2Seed(), primeOuroAccount: v2Ouro(),
    })) as { seed: IStoaChainSeed; primeOuro: IOuroAccount };
    expect(r.seed).toBeDefined();
    expect(r.primeOuro).toBeDefined();
    expect((r as { codexIdentity?: unknown }).codexIdentity).toBeUndefined();
  });

  it("rejects an args object matching neither shape (invalid-args)", async () => {
    await expect(
      store.getState().actions.kickstartCodex({} as unknown as KickstartArgsV3),
    ).rejects.toMatchObject({ reason: "invalid-args" });
    await expect(
      store.getState().actions.kickstartCodex(null as unknown as KickstartArgsV3),
    ).rejects.toBeInstanceOf(CodexKickstartError);
  });
});

describe("kickstartCodex legacy defensive v0.3-state detection (PAT-003)", () => {
  it("rejects a v0.2 call on a codex that already has a v0.3 codexIdentity", async () => {
    await adapter.saveCodexIdentity({
      formatted: "x", standardPublicKey: "x", smartPublicKey: "x",
      encryptedSeedWords: "x", encryptedStandardBitstring: "x", encryptedSmartBitstring: "x",
      encryptedStandardBase10: "x", encryptedSmartBase10: "x",
      encryptedStandardBase49: "x", encryptedSmartBase49: "x",
      totalWordCount: 12, splitIndex: 6, createdAt: "t",
    });
    await store.getState().actions.init(adapter, "dev");

    const saveStoaChainSeeds = vi.spyOn(adapter, "saveStoaChainSeeds");
    await expect(
      store.getState().actions.kickstartCodex({ seed: v2Seed(), primeOuroAccount: v2Ouro() }),
    ).rejects.toBeInstanceOf(CodexIdentityError);
    expect(saveStoaChainSeeds).not.toHaveBeenCalled();
  });

  it("rejects a v0.2 call on a codex that already has a CodexGuard", async () => {
    await adapter.savePureKeypairs([
      { id: "g1", label: "CodexGuard", publicKey: "f".repeat(64), encryptedPrivateKey: "e", createdAt: "t", isCodexGuard: true },
    ]);
    await store.getState().actions.init(adapter, "dev");

    const saveStoaChainSeeds = vi.spyOn(adapter, "saveStoaChainSeeds");
    await expect(
      store.getState().actions.kickstartCodex({ seed: v2Seed(), primeOuroAccount: v2Ouro() }),
    ).rejects.toBeInstanceOf(CodexGuardError);
    expect(saveStoaChainSeeds).not.toHaveBeenCalled();
  });
});
