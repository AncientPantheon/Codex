/**
 * useCodexIdentity — thin hook over the v0.3.0 codexIdentity slice +
 * buildRegisterCodexIdentityTx action.
 *
 * Strategy mirrors hooks.test.tsx: renderHook + MemoryCodexAdapter under a
 * fresh CodexProvider. The provider's init effect loads whatever snapshot the
 * adapter holds, so tests seed identity/guard into the adapter BEFORE mounting
 * (via saveAll on emptySnapshot) and assert the hook surfaces it. The hook is a
 * pure pass-through — it adds NO logic, so these specs pin delegation +
 * re-render-on-change, not crypto (covered in the state-level tx tests).
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import { useCodexIdentity } from "@ancientpantheon/codex-ouronet/hooks";
import {
  CodexIdentityError,
  CodexGuardError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  ICodexIdentity,
  IPureKeypair,
} from "@ancientpantheon/codex-ouronet/types";

const STANDARD_PUB = "STANDARD-160-glyph-payload";
const SMART_PUB = "SMART-160-glyph-payload";
const GUARD_PUB = "g".repeat(64);

const fullIdentity = (): ICodexIdentity => ({
  formatted: `₱.${STANDARD_PUB}:Π.${SMART_PUB}`,
  standardPublicKey: STANDARD_PUB,
  smartPublicKey: SMART_PUB,
  encryptedSeedWords: "enc-seed-words",
  encryptedStandardBitstring: "enc-std-bits",
  encryptedSmartBitstring: "enc-smart-bits",
  encryptedStandardBase10: "enc-std-b10",
  encryptedSmartBase10: "enc-smart-b10",
  encryptedStandardBase49: "enc-std-b49",
  encryptedSmartBase49: "enc-smart-b49",
  totalWordCount: 6,
  splitIndex: 3,
  createdAt: "2026-05-29T00:00:00.000Z",
});

const activeGuard = (): IPureKeypair => ({
  id: "guard-1",
  label: "CodexGuard",
  publicKey: GUARD_PUB,
  encryptedPrivateKey: "guard-enc-priv",
  createdAt: "2026-05-29T00:00:00.000Z",
  isCodexGuard: true,
});

async function seededAdapter(opts: {
  codexIdentity?: ICodexIdentity;
  pureKeypairs?: IPureKeypair[];
}): Promise<MemoryCodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({
    ...emptySnapshot("dev"),
    pureKeypairs: opts.pureKeypairs ?? [],
    codexIdentity: opts.codexIdentity,
  });
  return adapter;
}

function mkWrapper(adapter: MemoryCodexAdapter) {
  return ({ children }: { children: React.ReactNode }) => (
    <CodexProvider adapter={adapter}>{children}</CodexProvider>
  );
}

describe("useCodexIdentity", () => {
  it("identity is null on a fresh codex (no identity in the snapshot)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { result } = renderHook(() => useCodexIdentity(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.identity).toBeNull());
  });

  it("identity reflects the ICodexIdentity loaded from the adapter snapshot", async () => {
    const adapter = await seededAdapter({
      codexIdentity: fullIdentity(),
      pureKeypairs: [activeGuard()],
    });
    const { result } = renderHook(() => useCodexIdentity(), {
      wrapper: mkWrapper(adapter),
    });
    // init loads the seeded identity; the hook subscribes to the slice so the
    // ready state surfaces the full entity, not the getter's coalesced null.
    await waitFor(() =>
      expect(result.current.identity?.standardPublicKey).toBe(STANDARD_PUB)
    );
    expect(result.current.identity?.smartPublicKey).toBe(SMART_PUB);
    expect(result.current.identity?.formatted).toBe(
      `₱.${STANDARD_PUB}:Π.${SMART_PUB}`
    );
  });

  it("buildRegisterTx delegates to the store action — well-shaped envelope with identity pubkeys + guard keyset", async () => {
    const adapter = await seededAdapter({
      codexIdentity: fullIdentity(),
      pureKeypairs: [activeGuard()],
    });
    const { result } = renderHook(() => useCodexIdentity(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.identity).not.toBeNull());

    const tx = result.current.buildRegisterTx();
    expect(tx.module).toBe("ouronet-ns.CODEX");
    expect(tx.function).toBe("register-codex-identity");
    expect(tx.args[0]).toBe(STANDARD_PUB);
    expect(tx.args[1]).toBe(SMART_PUB);
    const keyset = tx.args[2] as { keys: string[]; pred: string };
    expect(keyset.pred).toBe("keys-all");
    expect(keyset.keys).toEqual([GUARD_PUB]);
  });

  it("buildRegisterTx propagates the action's CodexIdentityError when no identity exists", async () => {
    // Guard present but no identity — the action throws missing-codex-identity,
    // and the hook must surface it verbatim (no swallowing).
    const adapter = await seededAdapter({
      codexIdentity: undefined,
      pureKeypairs: [activeGuard()],
    });
    const { result } = renderHook(() => useCodexIdentity(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.identity).toBeNull());
    expect(() => result.current.buildRegisterTx()).toThrow(CodexIdentityError);
  });

  it("buildRegisterTx propagates the action's CodexGuardError when identity exists but no active guard", async () => {
    const adapter = await seededAdapter({
      codexIdentity: fullIdentity(),
      pureKeypairs: [{ ...activeGuard(), id: "not-a-guard", isCodexGuard: false }],
    });
    const { result } = renderHook(() => useCodexIdentity(), {
      wrapper: mkWrapper(adapter),
    });
    await waitFor(() => expect(result.current.identity).not.toBeNull());
    let thrown: unknown;
    act(() => {
      try {
        result.current.buildRegisterTx();
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(CodexGuardError);
  });
});
