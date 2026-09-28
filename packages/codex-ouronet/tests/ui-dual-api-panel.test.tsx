/**
 * <DualApiPanel> — canon rule 7 proof: the Rename/Revoke launchers'
 * `patron`+`executor` fill actually reaches `PreZbomHint`'s own `values=`
 * prop with REAL account addresses (the Standard half's owner for
 * `executor`, the prime account for `patron`), not a hand-reconstructed
 * stand-in — closes the same test-coverage gap `ui-single-api-panel.test.tsx`
 * closes for the Link launcher.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { IOuroAccount } from "../src/types/entities.js";
import type { ApiKeyRow, DualLinkRow } from "../src/zbom/pythia/deployApiKey.js";

const capturedValues: Record<string, Array<Record<string, string> | undefined>> = {};
vi.mock("../src/zbom/cfm/PreZbomHint.js", () => ({
  default: ({ entrypoint, values, children }: { entrypoint: string | readonly string[]; values?: Record<string, string>; children: React.ReactNode }) => {
    // `Array.isArray`'s type predicate is `arg is any[]`, and a `readonly
    // string[]` is not assignable to `any[]` (readonly -> mutable is
    // blocked), so TS can't narrow the false branch back to plain `string`
    // — the ternary's result stays `string | readonly string[]` without an
    // explicit annotation here, which then fails to index `capturedValues`.
    const key: string = Array.isArray(entrypoint) ? entrypoint.join(",") : (entrypoint as string);
    (capturedValues[key] ??= []).push(values);
    return <>{children}</>;
  },
}));

const getDualApiKeySelectorDataMock = vi.fn();
vi.mock("../src/zbom/pythia/deployApiKey.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDualApiKeySelectorData: (...args: unknown[]) => getDualApiKeySelectorDataMock(...args),
    getPythiaPrices: async () => null,
  };
});

vi.mock("../src/zbom/modals/RenameDualLaneModal.js", () => ({ default: () => null }));
vi.mock("../src/zbom/modals/RevokeDualLinkModal.js", () => ({ default: () => null }));

import { DualApiPanel } from "../src/ui/tabs/DualApiPanel.js";
import { RENAME_DUAL_LANE_KEY, REVOKE_DUAL_LINK_KEY } from "../src/zbom/pythia/dualLinkOps.js";

function acct(overrides: Partial<IOuroAccount>): IOuroAccount {
  return {
    id: overrides.address ?? "id",
    version: "1",
    isSmart: false,
    address: "Σ.default",
    guard: null,
    stoaChainLedger: null,
    publicKey: "pub",
    secret: "secret",
    backup: "backup",
    ...overrides,
  } as IOuroAccount;
}

const STD_ADDR = "₱.standardhalf";
const STD_OWNER = "Σ.standardowner";
const SMT_ADDR = "Π.smarthalf";
const PRIME_ADDR = "Σ.primeaccount";
const composite = `${STD_ADDR}|${SMT_ADDR}`;

describe("<DualApiPanel> — Rename/Revoke launchers' patron+executor fill", () => {
  it("fills executor with the pair's real Standard-half owner and patron with the prime account (accounts[0]) — never a placeholder or a wrong-context guess", async () => {
    Object.keys(capturedValues).forEach((k) => delete capturedValues[k]);
    getDualApiKeySelectorDataMock.mockResolvedValue([
      { "standard-apollo": STD_ADDR, "smart-apollo": SMT_ADDR, "consumer-lane": "SomeLane", "iz-active": true, "is-registered": true } satisfies DualLinkRow,
    ]);
    const apiKeyMap = new Map<string, ApiKeyRow>([
      [STD_ADDR, { public: STD_ADDR, counterpart: SMT_ADDR, "owner-account": STD_OWNER, "registered-at": 0, "updated-at": 0, "apollo-account": STD_ADDR, "is-registered": true }],
    ]);

    render(
      <DualApiPanel
        standardApollo={[acct({ address: STD_ADDR })]}
        smartApollo={[acct({ address: SMT_ADDR, isSmart: true })]}
        apiKeyMap={apiKeyMap}
        accounts={[acct({ address: PRIME_ADDR }), acct({ address: STD_OWNER })]}
      />,
    );

    await waitFor(() => expect(screen.getByText("Dual API Key")).toBeTruthy());

    for (const key of [RENAME_DUAL_LANE_KEY, REVOKE_DUAL_LINK_KEY]) {
      const calls = capturedValues[key];
      expect(calls, `${key} was never rendered`).toBeTruthy();
      const last = calls[calls.length - 1];
      expect(last?.executor, `${key}.executor`).toBe(STD_OWNER);
      expect(last?.patron, `${key}.patron`).toBe(PRIME_ADDR);
      expect(last?.["dual-link-key"], `${key}["dual-link-key"]`).toBe(composite);
    }
  });
});
