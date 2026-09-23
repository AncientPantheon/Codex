/**
 * AddressBookTab specs (Phase 14, T14.1; Tier 1/Tier 2 rehaul —
 * docs/work/codex-ui-mobile/design.md §9).
 *
 * Token-styled, Redux-free port of OuronetUI's AddressBookPage. State flows
 * strictly through `useAddressBook` over a mounted <CodexProvider>. These
 * specs pin the CRUD the tab exists for (add an entry, edit its name, delete
 * it, filter by kind) AND the Tier 1 (Ouronet / Foreign Blockchains) → Tier 2
 * (Accounts+StoicTags / Chainweb+Arweave) navigation on top of it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { AddressBookTab } from "@ancientpantheon/codex-ouronet/ui";
import { setPactReader } from "@stoachain/stoa-core/reads";

// Stub the read seam so the StoicTags on-chain resolution never hits the network.
beforeEach(() => {
  setPactReader(async () => ({ result: { data: [] } }) as never);
});

// Surfaces the provider's async hydration so a test can wait for it before
// mutating — adapter.loadAll() runs in an effect and overwrites slices on
// resolve, so writes fired before ready would be clobbered.
function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

async function renderTab() {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <AddressBookTab />
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

describe("<AddressBookTab>", () => {
  it("renders the empty state for the default ouronet tab so a fresh codex shows the add affordance", async () => {
    await renderTab();
    // Empty-state copy is keyed off the active tab; default is ouronet.
    expect(screen.getByText(/No Ouronet Accounts/i)).toBeTruthy();
  });

  it("adds an entry through the form and shows it in the list (add → list round-trip)", async () => {
    await renderTab();
    // Open the add form.
    fireEvent.click(screen.getByRole("button", { name: /add accounts/i }));

    fireEvent.change(screen.getByLabelText(/^name/i), {
      target: { value: "Alice" },
    });
    fireEvent.change(screen.getByLabelText(/^address/i), {
      target: { value: "Ѻ.alice-account" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    // The new entry's name surfaces in the list — proves addEntry persisted
    // and the list re-derived from the store.
    expect(await screen.findByText("Alice")).toBeTruthy();
    // The address is rendered via <MiddleEllipsis>, which splits it across a
    // head/tail span pair for CSS middle-truncation — so the full string is not
    // in a single text node. It IS the element's `title` (hover-to-read).
    expect(screen.getByTitle("Ѻ.alice-account")).toBeTruthy();
  });

  it("edits an entry's name in place so updateEntry is wired to the rename control", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: /add accounts/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Bob" } });
    fireEvent.change(screen.getByLabelText(/^address/i), {
      target: { value: "Ѻ.bob-account" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByText("Bob");

    // Start rename, change to "Bobby", confirm.
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const renameInput = screen.getByDisplayValue("Bob");
    fireEvent.change(renameInput, { target: { value: "Bobby" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(await screen.findByText("Bobby")).toBeTruthy();
    expect(screen.queryByText("Bob")).toBeNull();
  });

  it("deletes an entry so deleteEntry drops it from the list", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: /add accounts/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Carol" } });
    fireEvent.change(screen.getByLabelText(/^address/i), {
      target: { value: "Ѻ.carol-account" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    const card = (await screen.findByText("Carol")).closest("[data-entry-id]") as HTMLElement;

    fireEvent.click(within(card).getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(screen.queryByText("Carol")).toBeNull());
  });

  it("filters entries by type when switching to the Chainweb tab (under Foreign Blockchains)", async () => {
    await renderTab();
    // Add an ouronet entry on the default tab.
    fireEvent.click(screen.getByRole("button", { name: /add accounts/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "OuroOne" } });
    fireEvent.change(screen.getByLabelText(/^address/i), {
      target: { value: "Ѻ.ouro-one" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByText("OuroOne");

    // Switch to the Foreign Blockchains tier 1, then its Chainweb tier 2 —
    // the ouronet entry must not appear there.
    fireEvent.click(screen.getByRole("tab", { name: /foreign blockchains/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^chainweb$/i }));
    await waitFor(() => expect(screen.queryByText("OuroOne")).toBeNull());
    // And the Chainweb empty state shows.
    expect(screen.getByText(/No Chainweb Addresses/i)).toBeTruthy();
  });

  it("switching Tier 1 lands on that group's first Tier 2 kind by default", async () => {
    await renderTab();
    // Default is Ouronet / Accounts (the "ouronet" kind).
    expect(screen.getByText(/No Ouronet Accounts/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /foreign blockchains/i }));
    // Foreign Blockchains' first tier 2 kind is Chainweb.
    expect(screen.getByText(/No Chainweb Addresses/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /^ouronet$/i }));
    // Back to Ouronet lands on Accounts again (its first tier 2 kind).
    expect(screen.getByText(/No Ouronet Accounts/i)).toBeTruthy();
  });

  it("only shows the active Tier 1's two Tier 2 kinds at once — never all four flat", async () => {
    await renderTab();
    // Default Tier 1 (Ouronet): exactly Accounts + StoicTags as tier-2 tabs,
    // plus the two Tier 1 tabs themselves — 4 tabs total, not the old flat 4
    // AddressKinds directly (Chainweb/Arweave aren't reachable without first
    // switching Tier 1).
    let tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Ouronet", "Foreign Blockchains", "Accounts", "StoicTags"]);

    fireEvent.click(screen.getByRole("tab", { name: /foreign blockchains/i }));
    tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Ouronet", "Foreign Blockchains", "Chainweb", "Arweave"]);
  });

  it("adds a StoicTag entry, storing the bare name but displaying the § sigil", async () => {
    await renderTab();
    // StoicTags is the Ouronet tier 1's second tier 2 kind — already the
    // active tier 1 by default, no tier-1 switch needed.
    fireEvent.click(screen.getByRole("tab", { name: /stoictags/i }));
    expect(screen.getByText(/No StoicTags/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /add stoictags/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "My Tag" } });
    // User types with a leading § — it must be stripped to the bare name on save.
    fireEvent.change(screen.getByLabelText(/tag name/i), { target: { value: "§mytag" } });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    expect(await screen.findByText("My Tag")).toBeTruthy();
    // Displayed WITH the sigil…
    expect(screen.getByText("§mytag")).toBeTruthy();
    // …but the empty-state for the OTHER tabs is unaffected (bare name stored
    // under stoic-tag). Still under the Ouronet tier 1 — switch to its OTHER
    // tier 2 kind, "Accounts" (the "ouronet" kind's tab label, per design.md §9).
    fireEvent.click(screen.getByRole("tab", { name: /^accounts$/i }));
    expect(screen.queryByText("§mytag")).toBeNull();
  });
});

/**
 * Arweave sub-tab (Class IA, T4). Arweave recipients have no home in the book
 * without this fourth sub-tab, so the Send flow's recipient picker can never be
 * fed one. The address gate matters for funds: an Arweave address is exactly 43
 * base64url chars, and a malformed string saved here would be offered as a
 * transfer target.
 */
describe("<AddressBookTab> — Arweave sub-tab", () => {
  it("offers Arweave as a Foreign Blockchains tier 2 kind, with its own empty state", async () => {
    await renderTab();
    // Foreign Blockchains tier 1 → Arweave tier 2 (design.md §9).
    fireEvent.click(screen.getByRole("tab", { name: /foreign blockchains/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^arweave$/i }));
    expect(screen.getByText(/No Arweave Addresses/i)).toBeTruthy();
  });

  it("saves a canonical 43-character Arweave address and lists it", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("tab", { name: /foreign blockchains/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^arweave$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add arweave/i }));

    const address = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 43 chars
    expect(address).toHaveLength(43);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "AR Vault" } });
    fireEvent.change(screen.getByLabelText(/^address/i), { target: { value: address } });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    expect(await screen.findByText("AR Vault")).toBeTruthy();
    // Rendered through the existing non-Ouronet <MiddleEllipsis> path, which
    // splits the string across head/tail spans — the full value is the `title`.
    expect(screen.getByTitle(address)).toBeTruthy();
  });

  it("rejects a malformed Arweave address instead of saving it", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("tab", { name: /foreign blockchains/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^arweave$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add arweave/i }));

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Typo" } });
    fireEvent.change(screen.getByLabelText(/^address/i), {
      target: { value: "not-an-address" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    // The form stays open with the hint surfaced as the error…
    expect(screen.getByRole("alert").textContent).toMatch(/43-character base64url/i);
    // …and nothing was persisted: the empty state is still what the list shows.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText(/No Arweave Addresses/i)).toBeTruthy();
    expect(screen.queryByText("Typo")).toBeNull();
  });
});
