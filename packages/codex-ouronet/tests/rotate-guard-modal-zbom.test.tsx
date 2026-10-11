/**
 * RotateGuardModal (zbom CFM modal) — guard-resolution regression test.
 *
 * WHY THIS FILE IS SEPARATE FROM `rotation-modals.test.tsx`: that file's own
 * `<RotateGuardModal>` describe block imports the HEADLESS component at
 * `src/components/RotateGuardModal.tsx` (a differently-shaped, unrelated
 * component that happens to share the same display name and sits behind the
 * `@ancientpantheon/codex-ouronet/components` barrel). The modal fixed here is
 * the CFM/ZBOM modal at `src/zbom/modals/RotateGuardModal.tsx` — a distinct
 * file with a distinct props API (`open`/`account`/`accounts`/`kadenaSeeds`/
 * `stoaChainAccounts`, no `isOpen`/`render`). Extending the existing describe
 * block would silently test the wrong component; a new file with its own
 * mocks also avoids `vi.mock` collisions (file-scoped/hoisted) with any
 * parallel work touching the sibling `RotatePaymentKeyModal` fix in that file.
 *
 * Bug under test (root-caused, see docs/work for the sibling
 * RotatePaymentKeyModal investigation): `RotateGuardModal` fed the LOCAL,
 * UNRESOLVED `IOuroAccount.guard` field (an opaque keyset-reference object in
 * this app's local account state, not the real `{pred,keys}` shape) directly
 * into `analyzeGuard()` for both the patron and the target account, and into
 * the signing-key collection in `handleExecute`. `computeThreshold` treats a
 * guard with no `.keys` array as threshold-0/trivially-satisfied, so the
 * button was clickable but `collectKeys` gathered ZERO real signing keys —
 * the built tx carried no real ownership signer and on-chain `enforce-guard`
 * (which reads the REAL guard fresh from chain) rejected it.
 *
 * This test deliberately asserts submit-side signer data (the `rotateGuard`
 * call args) — a deviation from `rotation-modals.test.tsx`'s own stated
 * convention of not asserting submit-side mechanics — because that mechanism
 * (empty vs. real signing keys reaching the execute call) IS the bug; a
 * render/gating-only assertion could not distinguish fixed from broken.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "../src/provider/index.js";
import { MemoryCodexAdapter } from "../src/adapters/index.js";
import type { IOuroAccount, IStoaChainSeed } from "../src/types/entities.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PATRON_RESOLVED_KEY = "1".repeat(64);
const ACCOUNT_RESOLVED_KEY = "2".repeat(64);
const NEW_GUARD_KEY = "3".repeat(64);
// A codex key NOT used by either guard — leaves `selectCapsSigningKey` a free
// key for the Gas Station CAPS signer (otherwise every codex key is consumed
// by pure guard signing and `gasStationPub` comes back `null`).
const GAS_STATION_KEY = "4".repeat(64);

// Deliberately unresolved/malformed local `.guard` shape — an opaque
// keyset-reference, NOT the real `{pred, keys}` shape `analyzeGuard` expects.
// This is exactly what the local account store carries before resolution.
const RAW_UNRESOLVED_GUARD = { keysetref: { ns: "ouronet-ns", ksn: "some-keyset" } } as any;

const patronAccountFx: IOuroAccount = {
  id: "patron-1",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ.PATRON-TEST",
  guard: RAW_UNRESOLVED_GUARD,
  stoaChainLedger: null,
  publicKey: "p".repeat(64),
  secret: "s",
  backup: "b",
};

const targetAccountFx: IOuroAccount = {
  id: "account-1",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ.ACCOUNT-TEST",
  guard: RAW_UNRESOLVED_GUARD,
  stoaChainLedger: null,
  publicKey: "a".repeat(64),
  secret: "s",
  backup: "b",
};

// Codex-local seed carrying the SAME public keys the mocked on-chain guards
// resolve to, so `buildCodexPubSet` classifies them as codex (not foreign)
// keys and `analyzeGuard`'s `satisfied` gate can pass once resolution wires
// in the real guard.
const kadenaSeedsFx: IStoaChainSeed[] = [
  {
    id: "seed-1",
    seedType: "bip44" as IStoaChainSeed["seedType"],
    version: "1",
    index: 0,
    secret: "enc-secret",
    main: "m",
    createdAt: "2026-01-01T00:00:00.000Z",
    accounts: [
      { index: 0, publicKey: PATRON_RESOLVED_KEY, derivationPath: "m/0" },
      { index: 1, publicKey: ACCOUNT_RESOLVED_KEY, derivationPath: "m/1" },
      { index: 2, publicKey: GAS_STATION_KEY, derivationPath: "m/2" },
      // The new guard's key must also sign (chain proves new-owner consent)
      // — in the realistic case the user is rotating to a key they already
      // hold in this same Codex.
      { index: 3, publicKey: NEW_GUARD_KEY, derivationPath: "m/3" },
    ],
  },
];

// ── Mocks ────────────────────────────────────────────────────────────────────

const getStoaChainAccountGuardMock = vi.fn(async (address: string) => {
  if (address === patronAccountFx.address) return { pred: "keys-all", keys: [PATRON_RESOLVED_KEY] };
  if (address === targetAccountFx.address) return { pred: "keys-all", keys: [ACCOUNT_RESOLVED_KEY] };
  return null;
});
const getIgnisBalanceMock = vi.fn(async (_address: string) => "1000");

vi.mock("../src/zbom/debouncer/monitoredReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getIgnisBalance: (address: string) => getIgnisBalanceMock(address),
    getStoaChainAccountGuard: (address: string) => getStoaChainAccountGuardMock(address),
  };
});

vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getRotateGuardInfoLive: vi.fn(async () => ({ ignis: { "ignis-need": "0" } })),
  };
});

const rotateGuardMock = vi.fn(async (_opts: unknown) => ({ requestKey: "req-test-123" }));
vi.mock("@ouronet/ouronet-core/interactions/guardFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    rotateGuard: (opts: unknown) => rotateGuardMock(opts),
  };
});

vi.mock("../src/hooks/index.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetKeypair: () => (publicKey: string) =>
      Promise.resolve({ publicKey, privateKey: `priv-${publicKey}` }),
  };
});

vi.mock("../src/zbom/hooks/useEnsureCodexUnlocked.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useEnsureCodexUnlocked: () => () => Promise.resolve(true),
  };
});

vi.mock("../src/zbom/patron/usePatronSelectionDefaults.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePatronSelectionDefaults: () => ({
      initialPatronMode: "prime",
      autoSelectBestPatron: false,
      setting: "prime",
    }),
  };
});

// Imported AFTER the mocks above so the mocked modules are in effect.
const { default: RotateGuardModal } = await import("../src/zbom/modals/RotateGuardModal.js");

function renderModal() {
  const adapter = new MemoryCodexAdapter("dev");
  return render(
    <CodexProvider adapter={adapter}>
      <RotateGuardModal
        open
        onClose={() => {}}
        account={targetAccountFx}
        accounts={[patronAccountFx, targetAccountFx]}
        kadenaSeeds={kadenaSeedsFx}
        stoaChainAccounts={[]}
      />
    </CodexProvider>,
  );
}

describe("<RotateGuardModal> (zbom CFM modal) — guard resolution", () => {
  beforeEach(() => {
    getStoaChainAccountGuardMock.mockClear();
    getIgnisBalanceMock.mockClear();
    rotateGuardMock.mockClear();
  });

  it("calls rotateGuard with the RESOLVED patron/account guard keys, not the raw unresolved guard", async () => {
    renderModal();

    // Drive Zone 2's GuardEntryInput into "define" mode with a single valid
    // 64-hex key — the minimal input needed to make `guardValid` true.
    const keyInput = await screen.findByPlaceholderText(/public key hex \(64 chars\)/i);
    fireEvent.change(keyInput, { target: { value: NEW_GUARD_KEY } });

    // Wait for the guard resolution effects (getStoaChainAccountGuard for
    // both patron + account) to have been called and for the Execute button
    // to become clickable.
    await waitFor(() => {
      expect(getStoaChainAccountGuardMock).toHaveBeenCalledWith(patronAccountFx.address);
      expect(getStoaChainAccountGuardMock).toHaveBeenCalledWith(targetAccountFx.address);
    });

    const executeButton = await screen.findByRole("button", { name: /rotate guard/i });
    await waitFor(() => expect((executeButton as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(executeButton);
    });

    await waitFor(() => expect(rotateGuardMock).toHaveBeenCalledTimes(1));
    const call = rotateGuardMock.mock.calls[0][0] as {
      patronGuardKeys: Array<{ publicKey: string }>;
      accountGuardKeys: Array<{ publicKey: string }>;
    };

    // The RESOLVED guard's real key must be the one that reached the execute
    // call — not an empty array (what the raw unresolved `{keysetref}` guard
    // trivially-satisfies-with-zero-keys bug produces).
    expect(call.patronGuardKeys.map((k) => k.publicKey)).toEqual([PATRON_RESOLVED_KEY]);
    expect(call.accountGuardKeys.map((k) => k.publicKey)).toEqual([ACCOUNT_RESOLVED_KEY]);
  });
});
