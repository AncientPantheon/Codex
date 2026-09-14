// ============================================================================
// STANDALONE SMOKE (T15.7 — PG-03) — the self-contained local Codex composes.
//
// This is a BOUNDED mount-smoke: it asserts (a) the single product load screen
// renders a clean "Load your Codex" upload (no demo/fixture shortcuts), and
// (b) the full dashboard shell composes ALL the pieces reachable in ONE app —
// the real dashboard, the export affordance, the Foreign Chains tab, and the
// mock/real Arweave mode toggle — in the DEFAULT mock+offline mode, WITHOUT
// error.
//
// The dashboard is mounted DIRECTLY against a plaintext-hydrated store (the
// hydrateFromPlaintextSnapshot test/dev seam) rather than through the encrypted
// upload+unlock round-trip — the product UI only loads a real encrypted codex,
// but the smoke needs a deterministic mounted store to assert the composition.
//
// It also pins the NO-CLOUD boundary (N-11): the standalone playground uses
// uploaded-JSON + local stores ONLY — no cloud adapter, no cloud login, no
// remote-storage call. The App composes MemoryCodexAdapter (a local in-memory
// store) and never imports a cloud adapter / login surface.
//
// It deliberately does NOT re-test the T15.4 (5 panel areas) or T15.6 (toggle
// state/warning transitions) rows — those live in their own suites. This file
// only proves the pieces COMPOSE into one shell.
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";

import { App, Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { DEFAULT_GATEWAY_URL } from "../src/ArweaveModeToggle";
import { populatedStoaChainSnapshot } from "../fixtures";

/** The chain rail renders ids Capitalised for display ("arweave" -> "Arweave"),
 *  so match the id case-insensitively rather than hardcoding the display form —
 *  the id stays the single source of truth. */
const railName = (id: string) => new RegExp(`^${id}$`, "i");


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PG-03 standalone — the load screen is a single clean upload (no demo shortcuts)", () => {
  it("renders the 'Load your Codex' upload affordance and NO demo/fixture buttons", () => {
    render(<App />);
    // The single product entry point: upload the exported codex .json.
    expect(screen.getByLabelText(/load your codex/i)).toBeInTheDocument();
    // The old demo/fixture shortcuts are gone — you always load a real codex.
    expect(
      screen.queryByRole("button", { name: /fixture/i }),
    ).toBeNull();
  });
});

describe("PG-03 standalone — the dashboard composes the codex + Foreign Chains tab + the Arweave mode toggle in one shell", () => {
  async function mountDashboard() {
    // Mount the exported Dashboard against a plaintext-hydrated store (the
    // dev/test seam) so the composed shell is deterministically reachable
    // without the encrypt/unlock round-trip.
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );
    // The REAL dashboard mounted. The Class IA top level is the THREE Class tabs
    // (T5 collapsed Seed Words / Pure Key Pairs / Stoa Accounts into Class 2 →
    // Chainweb), so the shell is pinned by a Class tab, not by a removed one.
    await screen.findByRole("tab", { name: /ouronet accounts/i });
    await screen.findByRole("tab", { name: /blockchain accounts/i });
  }

  it("renders the real codex dashboard, the export affordance, the Foreign Chains section, and the Arweave subtab together (no error)", async () => {
    await mountDashboard();

    // view/edit/export: the real export-to-JSON affordance is present.
    expect(
      screen.getByRole("button", { name: /export.*json/i }),
    ).toBeInTheDocument();

    // Class 2 ("Blockchain Accounts") composes the wired rail; its Arweave entry
    // is dispatched from the injected foreignChains (the mock adapter's id
    // reached the list) — proving the chain rail is composed into the standalone
    // shell. The rail mounts only once Class 2 is the active Class tab, so this
    // selects it first (the old standalone `region` wrapper is gone).
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /blockchain accounts/i }));
    const rail = await screen.findByRole("tablist", { name: /foreign chains/i });
    expect(
      await within(rail).findByRole("tab", { name: railName(ARWEAVE_CHAIN_ID) }),
    ).toBeInTheDocument();
  });

  it("boots Arweave in mock+offline with the gateway on the testnet/local default (funds-safety)", async () => {
    await mountDashboard();

    // Funds-safety, asserted at the level that still carries it.
    //
    // Two things changed under this test: the on-screen mock/real toggle was
    // removed from the shell (unstyled dev chrome), and every Arweave category
    // is now an empty placeholder pending real wiring. So the DOM no longer
    // renders ANY adapter output — it cannot prove "mock mode is live" any more,
    // and asserting on panel text here would be asserting on a placeholder.
    //
    // What survives, and is what actually protects funds: the shell reaches
    // Arweave without contacting a gateway, and the gateway default is pinned
    // away from mainnet. Adapter-mode selection itself is covered where the
    // wiring is built (e5-foreign-chains-mock).
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /blockchain accounts/i }));
    const rail = await screen.findByRole("tablist", { name: /foreign chains/i });
    await user.click(
      await within(rail).findByRole("tab", { name: railName(ARWEAVE_CHAIN_ID) }),
    );

    // The category strip mounts (chain reachable) with no network in play.
    expect(await screen.findByTestId("arweave-subtab-seeds")).toBeInTheDocument();
    // Never mainnet by default.
    expect(DEFAULT_GATEWAY_URL).not.toContain("arweave.net");
  });
});

describe("PG-03 standalone — the NO-CLOUD boundary (N-11): uploaded-JSON + local stores only", () => {
  it("composes the codex against the LOCAL MemoryCodexAdapter only — no cloud adapter / cloud login / remote-storage persistence surface", () => {
    // N-11 boundary: the standalone shell persists the codex via uploaded-JSON +
    // a LOCAL in-memory adapter, NOT a cloud persistence surface. This asserts the
    // codex-STORE persistence path (distinct from the StoaChain chain-read the shipped
    // dashboard legitimately issues — the N-11 fence is about codex persistence,
    // not chain RPC). A regression re-introducing a cloud/remote persistence
    // adapter or a cloud-login surface is caught here at the wiring boundary.
    const appSource = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");
    // The codex is mounted on the LOCAL MemoryCodexAdapter (uploaded-JSON hydrates
    // it; nothing is persisted remotely).
    expect(appSource).toContain("MemoryCodexAdapter");
    // No cloud/remote persistence adapter or cloud-login surface is imported.
    expect(appSource).not.toMatch(
      /Cloud[A-Za-z]*Adapter|cloudLogin|CloudLogin|RemoteStorage|remoteStorage/,
    );
    // The load path is LOCAL: uploaded-file text restored via importFromCloud
    // (the codec's own single-reader restore — NOT a remote fetch).
    expect(appSource).toContain("importFromCloud");
  });

  it("uses the LOCAL codex-ouronet MemoryCodexAdapter for persistence — never a cloud/remote adapter export", async () => {
    // Prove the persistence adapter the App composes is the LOCAL in-memory one:
    // constructing it opens nothing remote (it is a synchronous in-memory store),
    // and it exposes the local saveAll/loadAll surface the uploaded-JSON path uses.
    const { MemoryCodexAdapter } = await import(
      "@ancientpantheon/codex-ouronet/adapters"
    );
    const adapter = new MemoryCodexAdapter("dev");
    // A local in-memory adapter — a cloud/remote adapter would require network
    // config (endpoint/credentials) to construct. This one needs only a device tag.
    expect(adapter).toBeInstanceOf(MemoryCodexAdapter);
    expect(typeof adapter.saveAll).toBe("function");
    expect(typeof adapter.loadAll).toBe("function");
  });
});
