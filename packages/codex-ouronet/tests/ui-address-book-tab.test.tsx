/**
 * AddressBookTab specs (Phase 14, T14.1).
 *
 * Token-styled, Redux-free port of OuronetUI's AddressBookPage. State flows
 * strictly through `useAddressBook` over a mounted <CodexProvider>. These
 * specs pin the CRUD the tab exists for: add an entry, edit its name, delete
 * it, and tab-filter ouronet vs stoa entries.
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
    fireEvent.click(screen.getByRole("button", { name: /add ouronet/i }));

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
    expect(screen.getByText("Ѻ.alice-account")).toBeTruthy();
  });

  it("edits an entry's name in place so updateEntry is wired to the rename control", async () => {
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: /add ouronet/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /add ouronet/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Carol" } });
    fireEvent.change(screen.getByLabelText(/^address/i), {
      target: { value: "Ѻ.carol-account" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    const card = (await screen.findByText("Carol")).closest("[data-entry-id]") as HTMLElement;

    fireEvent.click(within(card).getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(screen.queryByText("Carol")).toBeNull());
  });

  it("filters entries by type when switching to the StoaChain tab", async () => {
    await renderTab();
    // Add an ouronet entry on the default tab.
    fireEvent.click(screen.getByRole("button", { name: /add ouronet/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "OuroOne" } });
    fireEvent.change(screen.getByLabelText(/^address/i), {
      target: { value: "Ѻ.ouro-one" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await screen.findByText("OuroOne");

    // Switch to the stoa tab — the ouronet entry must not appear there.
    fireEvent.click(screen.getByRole("button", { name: /stoachain/i }));
    await waitFor(() => expect(screen.queryByText("OuroOne")).toBeNull());
    // And the stoa empty state shows.
    expect(screen.getByText(/No StoaChain.* Addresses/i)).toBeTruthy();
  });

  it("adds a StoicTag entry, storing the bare name but displaying the § sigil", async () => {
    await renderTab();
    // Switch to the StoicTags subsection.
    fireEvent.click(screen.getByRole("button", { name: /stoictags/i }));
    expect(screen.getByText(/No StoicTags/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /add stoictags/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "My Tag" } });
    // User types with a leading § — it must be stripped to the bare name on save.
    fireEvent.change(screen.getByLabelText(/tag name/i), { target: { value: "§mytag" } });
    fireEvent.click(screen.getByRole("button", { name: /^save/i }));

    expect(await screen.findByText("My Tag")).toBeTruthy();
    // Displayed WITH the sigil…
    expect(screen.getByText("§mytag")).toBeTruthy();
    // …but the empty-state for the OTHER tabs is unaffected (bare name stored under stoic-tag).
    fireEvent.click(screen.getByRole("button", { name: /^ouronet$/i }));
    expect(screen.queryByText("§mytag")).toBeNull();
  });
});
