/**
 * <RotatePaymentKeyModal> (src/components — the PUBLICLY EXPORTED headless
 * copy, `src/components/index.ts:47`) — Pact-code regression lock.
 *
 * WHY THIS FILE EXISTS. This component had no spec of its own, and under that
 * blind spot it kept emitting a Pact member that no longer exists on chain:
 * it imported `buildRotateKadenaPactCode as buildRotateStoaChainPactCode`
 * from `@ouronet/ouronet-core/pact`, whose body emits
 * `(ouronet-ns.TS01-C1.DALOS|C_RotateKadena …)`. That member was RENAMED to
 * `DALOS|C_RotateStoa`; the full mainnet `describe-module` evidence and the
 * literal `"Module ouronet-ns.TS01-C1 has no such member: DALOS|C_RotateKadena"`
 * error string are recorded in `src/zbom/rotatePaymentKeyLive.ts:1-32`. Every
 * submit from this component therefore failed as a RESOLUTION error at the
 * `dirtyRead` step, before signing. The `zbom/modals` copy was fixed in
 * 2026-09; this one was not (migration-execute design.md §7 defect 1).
 *
 * The ALIAS is what hid it — a wrong name read as a right one for months — so
 * these specs assert the EMITTED STRING, not the identity of a builder, and
 * additionally lock out the `@ouronet/ouronet-core/pact` import edge that
 * carried the stale name in.
 *
 * NO MAINNET RISK: `useSignTransaction`'s `execute` is mocked (its `build`
 * closure is invoked locally with a fake ctx), `useActiveWallet` is mocked, and
 * nothing in this file reads the chain. Mirrors the mocking shape of
 * `tests/ui-send-stoa-modal.test.tsx:20-30`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { IOuroAccount } from "../src/types/entities.js";

const executeMock = vi.fn();
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSignTransaction: () => ({ execute: executeMock, sign: vi.fn(), strategy: {} as any }),
    // The component falls back to the active wallet when no `account` prop is
    // given; every spec here passes accounts explicitly, so this only needs to
    // not require a mounted store.
    useActiveWallet: () => ({ activeOuroAccount: null }),
  };
});

const ensureCodexUnlockedMock = vi.fn(async () => true);
vi.mock("../src/zbom/hooks/useEnsureCodexUnlocked", () => ({
  useEnsureCodexUnlocked: () => ensureCodexUnlockedMock,
}));

import { RotatePaymentKeyModal } from "../src/components/RotatePaymentKeyModal";

const PATRON_GUARD_KEY = "a".repeat(64);
const ACCOUNT_GUARD_KEY = "b".repeat(64);
const NEW_PAYMENT_KEY = "c".repeat(64);

function acct(over: Partial<IOuroAccount> & { address: string }): IOuroAccount {
  return {
    id: over.address,
    name: over.address,
    version: "1.0.0",
    isSmart: false,
    guard: { pred: "keys-all", keys: [PATRON_GUARD_KEY] },
    stoaChainLedger: null,
    publicKey: PATRON_GUARD_KEY,
    secret: "s",
    backup: "b",
    ...over,
  } as IOuroAccount;
}

const PATRON = acct({ address: "Ѻ.PATRON", guard: { pred: "keys-all", keys: [PATRON_GUARD_KEY] } });
const ACCOUNT = acct({ address: "Ѻ.TARGET", guard: { pred: "keys-any", keys: [ACCOUNT_GUARD_KEY] } });

/** Fake `build()` ctx — mirrors what CodexSigningStrategy.execute passes the
 *  closure at runtime (`tests/ui-send-stoa-modal.test.tsx:116-122`). Arbitrary
 *  placeholders; the builder never touches the network. */
const FAKE_BUILD_CTX = {
  gasLimit: 500_000,
  capsKeyPub: "gas-station-pub".padEnd(64, "0"),
  guardPubs: [PATRON_GUARD_KEY],
  gasPrice: 1e-8,
  creationTime: 1_770_000_000,
};

function extractPactCode(tx: { cmd: string }): {
  code: string;
  data: Record<string, unknown>;
} {
  const parsed = JSON.parse(tx.cmd);
  return { code: parsed.payload.exec.code, data: parsed.payload.exec.data };
}

/** Mounts the modal, types a valid new payment key, submits, and returns the
 *  transaction the component's own `build` closure produced. */
async function submitAndCaptureTx(args: {
  account: IOuroAccount;
  patron: IOuroAccount;
  newPaymentKey?: string;
}): Promise<{ cmd: string }> {
  let captured: { cmd: string } | null = null;
  executeMock.mockImplementation(async ({ build }: any) => {
    captured = build(FAKE_BUILD_CTX);
    return { requestKey: "req-rotate" };
  });

  render(
    <RotatePaymentKeyModal
      isOpen
      onClose={() => {}}
      account={args.account}
      patron={args.patron}
    />
  );
  fireEvent.change(screen.getByLabelText(/new payment key/i), {
    target: { value: args.newPaymentKey ?? NEW_PAYMENT_KEY },
  });
  fireEvent.click(screen.getByRole("button", { name: /rotate payment key/i }));

  await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
  expect(captured).toBeTruthy();
  return captured as unknown as { cmd: string };
}

describe("<RotatePaymentKeyModal> (components) — Pact code", () => {
  beforeEach(() => {
    executeMock.mockReset();
    ensureCodexUnlockedMock.mockClear();
    ensureCodexUnlockedMock.mockResolvedValue(true);
  });

  it("emits the LIVE DALOS|C_RotateStoa member with (patron, account, newPaymentKey) in that order", async () => {
    const tx = await submitAndCaptureTx({ account: ACCOUNT, patron: PATRON });
    const { code } = extractPactCode(tx);

    // Arg ORDER is observable because patron ≠ account here. Matches
    // `src/constants/pactSignatures.generated.ts:474`'s
    // `"TS01-C1.DALOS|C_RotateStoa": ["patron", "executor", "stoa"]`.
    expect(code).toBe(
      `(ouronet-ns.TS01-C1.DALOS|C_RotateStoa "${PATRON.address}" "${ACCOUNT.address}" "${NEW_PAYMENT_KEY}")`
    );
  });

  it("never emits the renamed-away C_RotateKadena member anywhere in the command", async () => {
    const tx = await submitAndCaptureTx({ account: ACCOUNT, patron: PATRON });
    // Whole serialized command, not just the code field: the dead name must
    // not survive anywhere a node would resolve it.
    expect(tx.cmd).not.toContain("C_RotateKadena");
  });

  it("does not import a Pact-code builder from @ouronet/ouronet-core/pact", async () => {
    // The defect's real cause was the IMPORT EDGE, not one bad character: an
    // alias over `@ouronet/ouronet-core/pact`'s stale builder. That package
    // still ships `C_RotateKadena` (confirmed at its latest published
    // version), so any value import from it here can re-introduce a dead
    // member without any emitted-string test noticing a NEW call site.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(__dirname, "../src/components/RotatePaymentKeyModal.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+"@ouronet\/ouronet-core\/pact"/);
  });

  it('attaches the patron guard as "ks" and the target account guard as "ks-account" when patron ≠ account', async () => {
    const tx = await submitAndCaptureTx({ account: ACCOUNT, patron: PATRON });
    const { data } = extractPactCode(tx);

    // The live contract's enforce-guard reads both slots; a missing one is an
    // on-chain failure, so this existing behaviour is pinned here so the
    // pact-code edit cannot disturb it.
    expect(data.ks).toEqual({ keys: [PATRON_GUARD_KEY], pred: "keys-all" });
    expect(data["ks-account"]).toEqual({ keys: [ACCOUNT_GUARD_KEY], pred: "keys-any" });
  });

  it('attaches only "ks" when the patron IS the account (self-rotation)', async () => {
    const tx = await submitAndCaptureTx({ account: PATRON, patron: PATRON });
    const { code, data } = extractPactCode(tx);

    expect(code).toBe(
      `(ouronet-ns.TS01-C1.DALOS|C_RotateStoa "${PATRON.address}" "${PATRON.address}" "${NEW_PAYMENT_KEY}")`
    );
    expect(data.ks).toEqual({ keys: [PATRON_GUARD_KEY], pred: "keys-all" });
    expect(data["ks-account"]).toBeUndefined();
  });
});
