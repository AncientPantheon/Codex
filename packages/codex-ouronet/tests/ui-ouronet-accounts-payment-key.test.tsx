/**
 * OuronetAccountsTab — payment-key display vs. funding state (virgin vs funded).
 *
 * Bug: the account card gated the WHOLE payment-key section on the chain's
 * `payment-key-existance` flag. But per the on-chain model, every registered
 * Ouronet account ALWAYS has a payment key assigned at activation;
 * `payment-key-existance` only reports whether that payment-key ADDRESS has ever
 * held STOA (has a row in the coin table) — i.e. virgin (never funded) vs funded.
 * So a virgin payment key (`payment-key-existance: false`, but a real
 * `payment-key` address) made the entire section vanish, hiding a payment key
 * that genuinely exists.
 *
 * These specs pin the fix: the payment-key ADDRESS renders whenever the chain
 * returns one, regardless of funding; the funding flag only drives the
 * balance / a "virgin (never funded)" marker.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

// A per-test-configurable chain read. Each spec sets what URC_0027 returns.
const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("@ouronet/ouronet-core/interactions/ouroAccountFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorData: () => selectorRows() };
});

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useOuroAccounts } from "@ancientpantheon/codex-ouronet/hooks";
import { OuronetAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

const ADDR = "Ѻ.pk-acct";
const PAYMENT_KEY = "k:1111111111111111111111111111111111111111111111111111111111111111";

const ouroFx = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: "prime",
  name: "Prime",
  version: "1.0.0",
  isSmart: false,
  address: ADDR,
  guard: null,
  stoaChainLedger: null,
  publicKey: "p".repeat(64),
  secret: "s",
  backup: "b",
  ...over,
});

/** A full URC_0027 row for ADDR with the given payment-key funding state. */
function selectorRow(over: Partial<AccountSelectorData> = {}): AccountSelectorData {
  return {
    "iz-activated": true,
    "ouronet-account": ADDR,
    "ouronet-account-guard": { pred: "keys-all", keys: ["p".repeat(64)] },
    "iz-smart": false,
    "ouro-balance": 0,
    "ignis-balance": 0,
    "payment-key-existance": false,
    "payment-key": PAYMENT_KEY,
    "payment-key-balance": 0,
    "payment-key-guard": false,
    "ignis-discount": false,
    "stoa-discount": false,
    "public-key": "p".repeat(64),
    "sovereign": false,
    "governor": false,
    "stoic-tag-has": false,
    "stoic-tag": "No StoicTag yet",
    "stoic-tag-registered-at": false,
    ...over,
  } as AccountSelectorData;
}

function Seeder({ accounts }: { accounts: IOuroAccount[] }) {
  const { addAccount } = useOuroAccounts();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) accounts.forEach((a) => void addAccount(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTabExpanded() {
  const adapter = new MemoryCodexAdapter("dev");
  render(
    <CodexProvider adapter={adapter}>
      <Seeder accounts={[ouroFx()]} />
      <OuronetAccountsTab />
    </CodexProvider>,
  );
  const card = (await screen.findByText("CodexPrime")).closest("[data-account-id]") as HTMLElement;
  const header = card.querySelector('[role="button"]') as HTMLElement;
  fireEvent.click(header);
  return card;
}

describe("<OuronetAccountsTab> payment-key funding display", () => {
  beforeEach(() => selectorRows.mockReset());

  it("renders a VIRGIN payment key (never funded) instead of hiding the section", async () => {
    selectorRows.mockResolvedValue([selectorRow({ "payment-key-existance": false })]);
    const card = await renderTabExpanded();

    // The payment-key ADDRESS must be shown even though it has never held STOA.
    expect(await within(card).findByText(PAYMENT_KEY)).toBeTruthy();
    // The "Payment Key" section label is present (the section did not vanish).
    expect(within(card).getByText(/^Payment Key$/i)).toBeTruthy();
    // A virgin/never-funded marker communicates WHY there's no balance.
    expect(within(card).getByText(/virgin|never funded|unfunded/i)).toBeTruthy();
  });

  it("renders a FUNDED payment key with its balance and no virgin marker", async () => {
    selectorRows.mockResolvedValue([
      selectorRow({ "payment-key-existance": true, "payment-key-balance": 1341.66 }),
    ]);
    const card = await renderTabExpanded();

    expect(await within(card).findByText(PAYMENT_KEY)).toBeTruthy();
    expect(within(card).getByText(/1341\.66\s*STOA/i)).toBeTruthy();
    expect(within(card).queryByText(/virgin|never funded|unfunded/i)).toBeNull();
  });
});
