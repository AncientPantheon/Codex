/**
 * <SingleApiPanel> — canon rule 7 proof: the Link launcher's `executor` fill
 * actually reaches `PreZbomHint`'s own `values=` prop with the REAL selected
 * Standard half's owner account, not a hand-reconstructed stand-in (closes
 * the test-coverage gap a nectar review round flagged: the pure-function
 * unit tests in `zbom-prezbom-fill-map.test.ts` prove the shared helper's
 * own correctness, but never that THIS component calls it with the right
 * argument).
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IOuroAccount } from "../src/types/entities.js";
import type { ApiKeyRow } from "../src/zbom/pythia/deployApiKey.js";

const capturedValues: Array<Record<string, string> | undefined> = [];
vi.mock("../src/zbom/cfm/PreZbomHint.js", () => ({
  default: ({ values, children }: { values?: Record<string, string>; children: React.ReactNode }) => {
    capturedValues.push(values);
    return <>{children}</>;
  },
}));

import { SingleApiPanel } from "../src/ui/tabs/SingleApiPanel.js";

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

const STD_ADDR = "Σ.standardhalf";
const STD_OWNER = "Σ.standardowner";
const SMT_ADDR = "Ψ.smarthalf";

describe("<SingleApiPanel> — Link launcher's executor fill", () => {
  it("fills executor with the SELECTED Standard half's real owner-account once both halves are picked, not a placeholder", () => {
    capturedValues.length = 0;
    const apiKeyMap = new Map<string, ApiKeyRow>([
      [STD_ADDR, { public: STD_ADDR, counterpart: "", "owner-account": STD_OWNER, "registered-at": 0, "updated-at": 0, "apollo-account": STD_ADDR, "is-registered": true }],
      [SMT_ADDR, { public: SMT_ADDR, counterpart: "", "owner-account": "Ψ.smartowner", "registered-at": 0, "updated-at": 0, "apollo-account": SMT_ADDR, "is-registered": true }],
    ]);

    render(
      <SingleApiPanel
        standardApollo={[acct({ address: STD_ADDR })]}
        smartApollo={[acct({ address: SMT_ADDR, isSmart: true })]}
        apiKeyMap={apiKeyMap}
        accounts={[]}
      />,
    );

    // The Standard column renders first in the JSX, Smart second — each has
    // exactly one selectable half in this fixture, and selecting one does
    // NOT remove it from the "selectable" set (only its API-key status
    // does), so both buttons stay queryable by the same title throughout —
    // index order alone picks the right one deterministically.
    const pickButtons = screen.getAllByTitle("Pick this half to link");
    expect(pickButtons).toHaveLength(2);
    fireEvent.click(pickButtons[0]); // Standard half
    fireEvent.click(pickButtons[1]); // Smart half

    const last = capturedValues[capturedValues.length - 1];
    expect(last?.executor).toBe(STD_OWNER);
    // ouronetAccountFillValues' other aliases come along too (harmless —
    // C_Link declares none of them, so they're simply unused) — the point
    // proven here is specifically that `executor` carries the REAL owner.
    expect(last?.account).toBe(STD_OWNER);
  });

  it("omits executor entirely (never a placeholder guess) until a Standard half is actually selected", () => {
    capturedValues.length = 0;
    render(
      <SingleApiPanel
        standardApollo={[acct({ address: STD_ADDR })]}
        smartApollo={[acct({ address: SMT_ADDR, isSmart: true })]}
        apiKeyMap={new Map()}
        accounts={[]}
      />,
    );
    const last = capturedValues[capturedValues.length - 1];
    expect(last?.executor).toBeUndefined();
  });
});
