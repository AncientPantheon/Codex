/**
 * <RotatePaymentKeyModal> (zbom/modals) — guard-resolution regression.
 *
 * SCOPE-DEVIATION NOTICE (justified, see below): `tests/rotation-modals.test.tsx`
 * documents this package's established convention of NOT asserting the
 * submit-side signer/guard mechanics for CFM modals — that file tests a
 * DIFFERENT, older headless component also named `RotatePaymentKeyModal`
 * (`src/components/RotatePaymentKeyModal.tsx`, props `isOpen`/`account`/
 * `patron`), not the ZBOM CFM modal this file covers
 * (`src/zbom/modals/RotatePaymentKeyModal.tsx`, props `open`/`account`/
 * `accounts`/`kadenaSeeds`/`stoaChainAccounts`) — so this is a NEW adjacent
 * file, not an extension of that one, keeping the two components' specs
 * separate the way their implementations already are.
 *
 * The deviation itself: this spec DOES assert submit-side guard-resolution
 * mechanics, deliberately breaking the "integrate at Phase 9" convention
 * `rotation-modals.test.tsx` states for the sibling component. That's
 * correct here because the reported bug ("Keyset failure" toast on every
 * real click) IS the submit-side guard-resolution mechanism itself:
 *   - the modal fed the RAW `account.guard`/`patronAccount.guard` (an
 *     unresolved keyset-ref shape, `{ keysetref: { ns, ksn } }`, carrying no
 *     `.keys`) straight into `analyzeGuard()` and into the final
 *     `rotateStoaChainPaymentKeyLive(...)` call's `patronGuard`/
 *     `accountGuard` arguments
 *   - `analyzeGuard()` on a keyless guard returns `threshold: 0,
 *     satisfied: true` (trivially — see `computeThreshold`'s
 *     `keyCount === 0` short-circuit), which is WHY the Execute button was
 *     ever clickable at all despite zero real signers being collected
 *   - a render/validation-only spec (this package's normal convention)
 *     cannot see any of that — only asserting what the final chain call
 *     actually received proves the fix. Hence the deliberate deviation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import type { IOuroAccount, IStoaChainWallet } from "../src/types/entities.js";

// ── Hook mocks ────────────────────────────────────────────────────────────
// Only `useGetKeypair` is overridden — every other hook (useCodex,
// useOuroAccounts, useStoaChainSeeds, usePureKeypairs, …) stays REAL so the
// real <CodexProvider>/<MemoryCodexAdapter> store backs <ZbomLayout>'s
// useUiSetting + <SigningZone>'s useWallet() the same way it does for every
// consumer of this component — no reimplementation of that plumbing here.
const getKeypairMock = vi.fn(async (pub: string) => ({ publicKey: pub, privateKey: `priv-${pub}` }));
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetKeypair: () => getKeypairMock,
  };
});

const ensureCodexUnlockedMock = vi.fn(async () => true);
vi.mock("../src/zbom/hooks/useEnsureCodexUnlocked.js", () => ({
  useEnsureCodexUnlocked: () => ensureCodexUnlockedMock,
}));

// Guard-resolution mechanism under test: `getStoaChainAccountGuard` resolves
// an address straight to its REAL on-chain `{ pred, keys }` keyset — the
// shape the sibling modals (RevokeDualLinkModal etc.) already resolve
// through before signing. `getIgnisBalance` is mocked purely to keep the
// patron IGNIS read hermetic (no real network call).
const getStoaChainAccountGuardMock = vi.fn();
const getIgnisBalanceMock = vi.fn(async (..._args: unknown[]) => "1000");
vi.mock("../src/zbom/debouncer/monitoredReads.js", () => ({
  getStoaChainAccountGuard: (...args: unknown[]) => getStoaChainAccountGuardMock(...args),
  getIgnisBalance: (...args: unknown[]) => getIgnisBalanceMock(...args),
}));

// INFO read — mocked to resolve immediately with a free (0 IGNIS) rotation
// so `canExecute`'s `infoData !== null` + `hasEnoughIgnis` gates clear
// without needing to drive the IGNIS-balance race.
const getRotateStoaChainInfoLiveMock = vi.fn(async (..._args: unknown[]) => ({ ignis: { "ignis-need": "0" } }));
vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getRotateStoaChainInfoLive: (...args: unknown[]) => getRotateStoaChainInfoLiveMock(...args),
  };
});

// The EXECUTE call itself — spied so the test can inspect exactly what guard
// objects reached it (the regression's actual assertion surface).
const rotateStoaChainPaymentKeyLiveMock = vi.fn(async (..._args: unknown[]) => ({ requestKey: "req-rotate-1" }));
vi.mock("../src/zbom/rotatePaymentKeyLive.js", () => ({
  rotateStoaChainPaymentKeyLive: (...args: unknown[]) => rotateStoaChainPaymentKeyLiveMock(...args),
}));

import RotatePaymentKeyModal from "../src/zbom/modals/RotatePaymentKeyModal.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const PATRON_PUB = "1".repeat(64);
const TARGET_PUB = "2".repeat(64);
const GAS_PUB    = "3".repeat(64);
const NEW_PAYMENT_KEY = "9".repeat(64);

// Deliberately malformed/unresolved raw guard shapes — matches the real
// shape RevokeDualLinkModal's own comments describe for an un-resolved
// keyset-ref read straight off an IOuroAccount's `.guard` field: NOT
// `{ pred, keys }`, so `analyzeGuard` sees zero keys.
const UNRESOLVED_PATRON_GUARD = { keysetref: { ns: "patron-ns", ksn: "patron-ks" } } as any;
const UNRESOLVED_TARGET_GUARD = { keysetref: { ns: "target-ns", ksn: "target-ks" } } as any;

const RESOLVED_PATRON_GUARD = { pred: "keys-all", keys: [PATRON_PUB] };
const RESOLVED_TARGET_GUARD = { pred: "keys-all", keys: [TARGET_PUB] };

const patronAccountFx: IOuroAccount = {
  id: "patron-1",
  name: "Patron",
  version: "1.0.0",
  isSmart: false,
  address: `k:${PATRON_PUB}`,
  guard: UNRESOLVED_PATRON_GUARD,
  stoaChainLedger: null,
  publicKey: PATRON_PUB,
  secret: "s",
  backup: "b",
};

const targetAccountFx: IOuroAccount = {
  id: "target-1",
  name: "Target",
  version: "1.0.0",
  isSmart: false,
  address: `k:${TARGET_PUB}`,
  guard: UNRESOLVED_TARGET_GUARD,
  stoaChainLedger: null,
  publicKey: TARGET_PUB,
  secret: "s",
  backup: "b",
};

// The gas-station candidate pub — present in the Codex's own pub set but
// NOT a signer on either guard, so `selectCapsSigningKey` has a real
// third option once the two real guards are resolved and excluded.
const stoaChainAccountsFx = [
  { publicKey: PATRON_PUB } as unknown as IStoaChainWallet,
  { publicKey: TARGET_PUB } as unknown as IStoaChainWallet,
  { publicKey: GAS_PUB } as unknown as IStoaChainWallet,
];

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

async function renderModal() {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <RotatePaymentKeyModal
        open
        onClose={() => {}}
        account={targetAccountFx}
        accounts={[patronAccountFx]}
        kadenaSeeds={[]}
        stoaChainAccounts={stoaChainAccountsFx}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
  return utils;
}

describe("<RotatePaymentKeyModal> (zbom) — guard resolution regression", () => {
  beforeEach(() => {
    getKeypairMock.mockClear();
    ensureCodexUnlockedMock.mockClear();
    getStoaChainAccountGuardMock.mockReset();
    getStoaChainAccountGuardMock.mockImplementation(async (addr: string) => {
      if (addr === patronAccountFx.address) return RESOLVED_PATRON_GUARD;
      if (addr === targetAccountFx.address) return RESOLVED_TARGET_GUARD;
      return null;
    });
    getIgnisBalanceMock.mockClear();
    getRotateStoaChainInfoLiveMock.mockClear();
    rotateStoaChainPaymentKeyLiveMock.mockClear();
  });

  it("submits the RESOLVED {pred, keys} guards (never the raw unresolved keyset-ref) for both patron and account, with real signing keys collected for each", async () => {
    await renderModal();

    await screen.findByRole("heading", { name: /rotate payment key/i });

    const input = screen.getByPlaceholderText(/k:, c:, u:, w:, or custom account/i);
    fireEvent.change(input, { target: { value: NEW_PAYMENT_KEY } });

    const button = await screen.findByRole("button", { name: /rotate payment key/i });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(button);

    await waitFor(() => expect(rotateStoaChainPaymentKeyLiveMock).toHaveBeenCalledTimes(1));
    const [
      patronAddress,
      accountAddress,
      newPaymentKey,
      _gasStationKey,
      patronSignKeys,
      accountSignKeys,
      patronGuardArg,
      accountGuardArg,
    ] = rotateStoaChainPaymentKeyLiveMock.mock.calls[0];

    expect(patronAddress).toBe(patronAccountFx.address);
    expect(accountAddress).toBe(targetAccountFx.address);
    expect(newPaymentKey).toBe(NEW_PAYMENT_KEY);

    // The actual regression lock: the RESOLVED keysets reached the chain
    // call, not the raw unresolved keyset-ref the account/patron objects
    // carried.
    expect(patronGuardArg).toEqual(RESOLVED_PATRON_GUARD);
    expect(accountGuardArg).toEqual(RESOLVED_TARGET_GUARD);
    expect(patronGuardArg).not.toEqual(UNRESOLVED_PATRON_GUARD);
    expect(accountGuardArg).not.toEqual(UNRESOLVED_TARGET_GUARD);

    // Mechanism-level proof, not just the final argument: real signing keys
    // were actually collected for both sides (the bug's "zero real signers"
    // symptom — `collectKeys` iterating an empty `codexKeys` because the raw
    // guard had no `.keys` — is what this closes).
    expect(patronSignKeys).toEqual([{ publicKey: PATRON_PUB, privateKey: `priv-${PATRON_PUB}` }]);
    expect(accountSignKeys).toEqual([{ publicKey: TARGET_PUB, privateKey: `priv-${TARGET_PUB}` }]);
    expect(getKeypairMock).toHaveBeenCalledWith(PATRON_PUB);
    expect(getKeypairMock).toHaveBeenCalledWith(TARGET_PUB);

    // Both addresses were actually resolved on-chain (not just the raw
    // object reused) — confirms the fix calls the sibling-modal pattern's
    // `getStoaChainAccountGuard`, not a no-op.
    expect(getStoaChainAccountGuardMock).toHaveBeenCalledWith(patronAccountFx.address);
    expect(getStoaChainAccountGuardMock).toHaveBeenCalledWith(targetAccountFx.address);
  });
});
