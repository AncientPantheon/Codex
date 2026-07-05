/**
 * Store action tests — buildRegisterCodexIdentityTx (v0.3.0+ PLACEHOLDER).
 *
 * The action is a PURE READ + builder: it reads the codex's double-Apollo
 * identity and the active CodexGuard public key, then constructs an unsigned
 * Pact tx envelope targeting ouronet-ns.CODEX.register-codex-identity. It does
 * NOT mutate state, call the adapter, or touch the network.
 *
 * The exact Pact arg order is owner-TBD — these specs pin only the WELL-SHAPED
 * placeholder contract the Mnemosyne backend signs against: module + function
 * targets, the Standard/Smart pubkeys at the documented placeholder positions,
 * and the single-key keys-all CodexGuard keyset. When the owner confirms the
 * real signature, the arg-order assertions here change in lockstep with the
 * implementation.
 *
 * Covers:
 *   - happy path: a fully-formed codexIdentity + an active CodexGuard yields the
 *     correctly-targeted envelope with identity pubkeys + guard keyset.
 *   - missing-identity rejection: no codexIdentity throws CodexIdentityError
 *     with reason "missing-codex-identity".
 *   - missing-CodexGuard rejection: a codexIdentity but no active CodexGuard
 *     throws CodexGuardError with reason "missing-codex-guard".
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
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

async function storeWith(opts: {
  codexIdentity?: ICodexIdentity;
  pureKeypairs?: IPureKeypair[];
}) {
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({
    ...emptySnapshot("dev"),
    pureKeypairs: opts.pureKeypairs ?? [],
    codexIdentity: opts.codexIdentity,
  });
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  return store;
}

describe("buildRegisterCodexIdentityTx (placeholder)", () => {
  it("builds a well-shaped envelope targeting ouronet-ns.CODEX.register-codex-identity with identity pubkeys + guard keyset", async () => {
    const store = await storeWith({
      codexIdentity: fullIdentity(),
      pureKeypairs: [activeGuard()],
    });

    const tx = store.getState().actions.buildRegisterCodexIdentityTx();

    // Module + function pin the on-chain target the Mnemosyne backend submits to.
    expect(tx.module).toBe("ouronet-ns.CODEX");
    expect(tx.function).toBe("register-codex-identity");

    // Placeholder arg order: Standard pubkey, Smart pubkey, CodexGuard keyset.
    expect(tx.args.length).toBeGreaterThanOrEqual(3);
    expect(tx.args[0]).toBe(STANDARD_PUB);
    expect(tx.args[1]).toBe(SMART_PUB);

    // CodexGuard keyset is a single-key keys-all keyset over the active guard.
    const keyset = tx.args[2] as { keys: string[]; pred: string };
    expect(keyset.pred).toBe("keys-all");
    expect(keyset.keys).toEqual([GUARD_PUB]);
  });

  it("appends registeredBy as a trailing arg when opts.registeredBy is supplied", async () => {
    const store = await storeWith({
      codexIdentity: fullIdentity(),
      pureKeypairs: [activeGuard()],
    });

    const withBy = store
      .getState()
      .actions.buildRegisterCodexIdentityTx({ registeredBy: "alice" });
    const withoutBy = store
      .getState()
      .actions.buildRegisterCodexIdentityTx();

    // registeredBy is optional — present only when supplied, as the final arg.
    expect(withBy.args.length).toBe(withoutBy.args.length + 1);
    expect(withBy.args[withBy.args.length - 1]).toBe("alice");
  });

  it("throws CodexIdentityError('missing-codex-identity') when the codex has no identity", async () => {
    const store = await storeWith({
      codexIdentity: undefined,
      pureKeypairs: [activeGuard()],
    });
    const actions = store.getState().actions;

    expect(() => actions.buildRegisterCodexIdentityTx()).toThrow(
      CodexIdentityError
    );
    try {
      actions.buildRegisterCodexIdentityTx();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CodexIdentityError).reason).toBe("missing-codex-identity");
    }
  });

  it("throws CodexGuardError('missing-codex-guard') when the codex has an identity but no active CodexGuard", async () => {
    const store = await storeWith({
      codexIdentity: fullIdentity(),
      // identity present, but no entry carries isCodexGuard: true
      pureKeypairs: [
        {
          ...activeGuard(),
          id: "not-a-guard",
          isCodexGuard: false,
        },
      ],
    });
    const actions = store.getState().actions;

    expect(() => actions.buildRegisterCodexIdentityTx()).toThrow(
      CodexGuardError
    );
    try {
      actions.buildRegisterCodexIdentityTx();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CodexGuardError).reason).toBe("missing-codex-guard");
    }
  });
});
