/**
 * OuronetAccountsTab specs — updated for the v0.3.x "1:1 My Codex clone"
 * rewrite of the tab.
 *
 * The tab is now self-contained: it reads live chain state (URC_0027) via the
 * package's own `useAccountChainData`, derives StoicTag / sovereign / governor
 * from that chain overlay, and self-hosts every action modal. The earlier
 * injected-StoicTag contract (`stoicTagFor` / `onClaimStoicTag` /
 * `onReleaseStoicTag`) is gone — props are now `{ className? }` only — so the
 * old claim/release specs are retired here. StoicTag Add/Release + Activate +
 * Rotate-Governor are deferred clone stubs (v0.3.2 / ZBOM Wave 8) and are not
 * asserted yet.
 *
 * What these specs pin about the new contract:
 *   - the empty state ("No standard accounts in Codex", default Standard tab);
 *   - the CodexPrime invariant (index 0 always displays as "CodexPrime", locked);
 *   - non-prime accounts display their own name + Standard/Smart counts;
 *   - a collapsed row expands to reveal the on-chain breakdown (Ouronet Account
 *     section), and an activated, guarded account exposes "Rotate Guard" which
 *     opens the self-hosted rotate dialog;
 *   - CodexPrime delete is blocked (disabled control), non-prime is deletable.
 */

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// The tab reads live URC_0027 chain state via getAccountSelectorData, which
// hits a real Stoa node. In jsdom there is no node, so each render would fire a
// hanging network read; left in-flight, those reads race across tests and make
// the modal-open spec flaky. Stub it to return no rows — the codex-only view
// these specs assert is exactly what the tab renders when chain data is absent.
vi.mock("@stoachain/ouronet-core/interactions/ouroAccountFunctions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorData: async () => [] };
});

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useOuroAccounts } from "@ancientpantheon/codex-ouronet/hooks";
import { OuronetAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

const KEY = "a".repeat(64);

const ouroFx = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: over.id ?? "o1",
  name: over.name ?? "My Account",
  version: "1.0.0",
  isSmart: over.isSmart ?? false,
  address: over.address ?? "Ѻ.my-account",
  guard: over.guard ?? null,
  stoaChainLedger: null,
  publicKey: over.publicKey ?? "p".repeat(64),
  secret: "s",
  backup: "b",
  ...over,
});

function Seeder({ accounts }: { accounts: IOuroAccount[] }) {
  const { addAccount } = useOuroAccounts();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) accounts.forEach((a) => void addAccount(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(
  accounts: IOuroAccount[] = [],
  props: React.ComponentProps<typeof OuronetAccountsTab> = {},
) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder accounts={accounts} />
      <OuronetAccountsTab {...props} />
    </CodexProvider>,
  );
  if (accounts.length > 0) {
    // index 0 always displays as CodexPrime; later rows show their own name.
    await screen.findByText(accounts.length === 1 ? "CodexPrime" : (accounts[1].name as string));
  } else {
    await screen.findByText(/No standard accounts in Codex/i);
  }
  return utils;
}

/** Expand a collapsed account row by clicking its header button. */
function expandRow(card: HTMLElement) {
  // The expand toggle is the header row (a `role="button"` div). Do NOT use
  // `querySelector("button")` — the first real <button> is now the Atom
  // account-selector (it stops propagation and selects rather than expands).
  const header = card.querySelector('[role="button"]') as HTMLElement;
  fireEvent.click(header);
}

describe("<OuronetAccountsTab>", () => {
  it("renders the empty state when the codex holds no ouro accounts", async () => {
    await renderTab([]);
    expect(screen.getByText(/No standard accounts in Codex/i)).toBeTruthy();
  });

  it("displays the first account as the locked CodexPrime regardless of its name", async () => {
    await renderTab([ouroFx({ id: "prime", name: "Some Name", address: "Ѻ.prime-acct" })]);
    expect(screen.getByText("CodexPrime")).toBeTruthy();
    // Prime entities share a unified "🔒 Prime" badge (distinct from the name).
    expect(screen.getByText(/🔒\s*Prime/)).toBeTruthy();
    // The seeded name is intentionally overridden for the prime slot.
    expect(screen.queryByText("Some Name")).toBeNull();
  });

  it("renders a non-prime account by its own name and counts it under Standard", async () => {
    await renderTab([
      ouroFx({ id: "prime", name: "Prime" }),
      ouroFx({ id: "o2", name: "Second", address: "Ѻ.second-acct" }),
    ]);
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("Standard (2)")).toBeTruthy();
  });

  it("expands a row to reveal the on-chain Ouronet Account breakdown", async () => {
    await renderTab([ouroFx({ id: "prime", name: "Prime", address: "Ѻ.prime-acct" })]);
    const card = (await screen.findByText("CodexPrime")).closest("[data-account-id]") as HTMLElement;
    expandRow(card);
    expect(await within(card).findByText(/Ouronet Account/i)).toBeTruthy();
  });

  it("opens the self-hosted rotate-guard dialog for an activated, guarded account", async () => {
    await renderTab([
      ouroFx({
        id: "prime",
        name: "Prime",
        isActive: true,
        guard: { pred: "keys-all", keys: [KEY] },
      }),
    ]);
    const card = (await screen.findByText("CodexPrime")).closest("[data-account-id]") as HTMLElement;
    expandRow(card);
    const btn = await within(card).findByRole("button", { name: /rotate guard/i });
    fireEvent.click(btn);
    // The verbatim-cloned RotateGuardModal opens with an <h2>Rotate Guard</h2>
    // heading (the row's trigger is a button, so the heading role is unique).
    expect(await screen.findByRole("heading", { name: /rotate guard/i })).toBeTruthy();
  });

  it("blocks deleting the CodexPrime account but allows deleting a non-prime one", async () => {
    await renderTab([
      ouroFx({ id: "prime", name: "Prime", isActive: true }),
      ouroFx({ id: "o2", name: "Second", address: "Ѻ.second-acct", isActive: true }),
    ]);

    const prime = (await screen.findByText("CodexPrime")).closest("[data-account-id]") as HTMLElement;
    expandRow(prime);
    // The prime exposes only a disabled delete control.
    expect(within(prime).getByRole("button", { name: /cannot be removed/i })).toBeTruthy();
    expect(within(prime).queryByRole("button", { name: /^delete$/i })).toBeNull();

    const second = (await screen.findByText("Second")).closest("[data-account-id]") as HTMLElement;
    expandRow(second);
    expect(within(second).getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });
});
