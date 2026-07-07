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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";

import { App, Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { DEFAULT_GATEWAY_URL } from "../src/ArweaveModeToggle";
import { populatedStoaChainSnapshot } from "../fixtures";

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
    // The REAL dashboard mounted (a shipped STAY tab is present).
    await screen.findByRole("tab", { name: /seed words/i });
  }

  it("renders the real codex dashboard, the export affordance, the Foreign Chains section, and the Arweave subtab together (no error)", async () => {
    await mountDashboard();

    // view/edit/export: the real export-to-JSON affordance is present.
    expect(
      screen.getByRole("button", { name: /export.*json/i }),
    ).toBeInTheDocument();

    // The Foreign Chains section composes the wired tab; its Arweave subtab is
    // dispatched from the injected foreignChains (mock adapter's id reached the
    // list) — proving the T15.4 tab mount is composed into the standalone shell.
    const foreignChains = screen.getByRole("region", { name: /foreign chains/i });
    expect(
      await within(foreignChains).findByRole("tab", { name: ARWEAVE_CHAIN_ID }),
    ).toBeInTheDocument();
  });

  it("mounts the mock/real Arweave mode toggle defaulting to mock+offline, gateway seeded to the testnet/local default (funds-safety)", async () => {
    await mountDashboard();

    // The mode toggle (T15.6) is composed next to the Foreign Chains tab: it
    // boots in mock+offline (default), so NO real-mode funds warning is shown,
    // and its gateway input is seeded to the testnet/local default (never mainnet).
    const modeSection = screen.getByRole("region", { name: /arweave mode/i });
    const gatewayInput = within(modeSection).getByLabelText(
      /gateway/i,
    ) as HTMLInputElement;
    expect(gatewayInput.value).toBe(DEFAULT_GATEWAY_URL);
    expect(gatewayInput.value).not.toContain("arweave.net");
    // Default is mock+offline — no funds-safety alert until the user opts into real.
    expect(within(modeSection).queryByRole("alert")).toBeNull();
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
