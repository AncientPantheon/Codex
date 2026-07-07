// ============================================================================
// Network settings wiring (CL-13, N-03, N-04) — the working-localhost deliverable.
//
// The playground surfaces an EDITABLE, UNLOCKED default network config: the
// StoaChain node URL (default STOACHAIN_DEFAULT_NODE_URL) + the Arweave gateway URL
// (default DEFAULT_GATEWAY_URL = http://localhost:1984), persisted to
// localStorage. It builds a `NetworkSettingsModel` via `createConnectionResolver`
// (standalone → no global → both chains local → both rows editable + "Live
// (local)") and renders the codex-ui `NetworkSettingsCard` in the loaded
// dashboard shell.
//
// These tests pin: (a) the surfaced defaults are REAL, editable values (N-03) —
// the card shows a StoaChain + Arweave row with their default URLs; (b) the
// Arweave default is localhost:1984, never mainnet arweave.net (N-04); and (c)
// the persistence + model-build helper resolves an unlocked, two-row, live-local
// model off the surfaced state.
// ============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { STOACHAIN_DEFAULT_NODE_URL } from "@ancientpantheon/codex-ouronet/connection";

import { Dashboard } from "../src/App";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { DEFAULT_GATEWAY_URL } from "../src/ArweaveModeToggle";
import { populatedStoaChainSnapshot } from "../fixtures";
import {
  NETWORK_SETTINGS_STORAGE_KEY,
  loadNetworkSettings,
  saveNetworkSettings,
  resolveNetworkModel,
  STOACHAIN_CHAIN_ID,
  ARWEAVE_CHAIN_ID,
} from "../src/networkSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("networkSettings — surfaced editable defaults (N-03/N-04)", () => {
  it("defaults the StoaChain node to STOACHAIN_DEFAULT_NODE_URL and the Arweave gateway to the local testnet gateway", () => {
    const settings = loadNetworkSettings();
    // Surfaced as REAL default values (not hidden): the StoaChain node is the
    // explicit node2-host default, the Arweave gateway is the local testnet one.
    expect(settings.stoaChainNodeUrl).toBe(STOACHAIN_DEFAULT_NODE_URL);
    expect(settings.arweaveGatewayUrl).toBe(DEFAULT_GATEWAY_URL);
  });

  it("never defaults the Arweave gateway to mainnet arweave.net (funds-safety N-04)", () => {
    const settings = loadNetworkSettings();
    expect(settings.arweaveGatewayUrl).toContain("localhost:1984");
    expect(settings.arweaveGatewayUrl).not.toContain("arweave.net");
  });

  it("round-trips edited settings through localStorage so the surfaced config persists", () => {
    saveNetworkSettings({
      pythiaUrl: "",
      stoaChainNodeUrl: "https://my-node.example:8080",
      arweaveGatewayUrl: "http://localhost:1984",
    });
    const raw = window.localStorage.getItem(NETWORK_SETTINGS_STORAGE_KEY);
    expect(raw).not.toBeNull();

    const reloaded = loadNetworkSettings();
    // The edited node survives a reload — the persisted value wins over the default.
    expect(reloaded.stoaChainNodeUrl).toBe("https://my-node.example:8080");
  });
});

describe("networkSettings — resolveNetworkModel (standalone unlocked two-tier)", () => {
  it("builds an UNLOCKED two-row model — stoachain + arweave, both live-local + editable (no global)", async () => {
    const model = await resolveNetworkModel({
      pythiaUrl: "",
      stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
      arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
    });

    // Standalone: no operator global, both chains are surfaced as LOCAL — so
    // both rows are editable (manualFieldEnabled) and status is live-local.
    expect(model.locked).toBe(false);
    expect(model.chains.map((c) => c.chainId)).toEqual([
      STOACHAIN_CHAIN_ID,
      ARWEAVE_CHAIN_ID,
    ]);
    for (const row of model.chains) {
      expect(row.status).toBe("live-local");
      expect(row.manualFieldEnabled).toBe(true);
    }
  });
});

describe("Network card in the dashboard shell (CL-13)", () => {
  async function mountDashboard() {
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );
    await screen.findByRole("tab", { name: /seed words/i });
    // The network connectors now live in the packaged settings: switch to the
    // "Codex UI Settings" view, then open the injected "Network" subtab.
    fireEvent.click(screen.getByRole("tab", { name: /codex ui settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^network$/i }));
    await screen.findByTestId(`network-url-${STOACHAIN_CHAIN_ID}`);
  }

  it("renders the NetworkSettingsCard with a StoaChain row and an Arweave row seeded to their default URLs", async () => {
    await mountDashboard();

    const stoaUrl = (await screen.findByTestId(
      `network-url-${STOACHAIN_CHAIN_ID}`,
    )) as HTMLInputElement;
    const arweaveUrl = screen.getByTestId(
      `network-url-${ARWEAVE_CHAIN_ID}`,
    ) as HTMLInputElement;

    // The surfaced defaults are visible + real (N-03): the operator sees the
    // live node + gateway, not an empty/hidden field.
    expect(stoaUrl.value).toBe(STOACHAIN_DEFAULT_NODE_URL);
    expect(arweaveUrl.value).toBe(DEFAULT_GATEWAY_URL);
    expect(arweaveUrl.value).not.toContain("arweave.net");
  });

  it("persists an edited StoaChain node URL so the dashboard reads against the surfaced state", async () => {
    await mountDashboard();

    const stoaUrl = (await screen.findByTestId(
      `network-url-${STOACHAIN_CHAIN_ID}`,
    )) as HTMLInputElement;
    fireEvent.change(stoaUrl, { target: { value: "https://edited-node.example:9090" } });

    // The edit flows into the persisted network state.
    expect(loadNetworkSettings().stoaChainNodeUrl).toBe(
      "https://edited-node.example:9090",
    );
  });
});

describe("no hidden hardcoded mainnet default in the wiring source (N-03/N-04)", () => {
  it("names no arweave.net literal in the network-settings wiring", () => {
    const source = readFileSync(resolve(__dirname, "../src/networkSettings.ts"), "utf8");
    expect(source).not.toContain("arweave.net");
  });
});

describe("networkSettings — Pythia promoted to GLOBAL (two-tier global⊕local)", () => {
  it("a reachable Pythia covering stoachain → stoachain live-global (field disabled), arweave live-local", async () => {
    // Mock a reachable Pythia whose /healthz advertises stoachain coverage.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).endsWith("/healthz")
          ? ({ ok: true, json: async () => ({ coveredChains: ["stoachain"] }) } as Response)
          : ({ ok: true, json: async () => ({}) } as Response),
      ),
    );

    const model = await resolveNetworkModel({
      pythiaUrl: "https://pythia.example",
      stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
      arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
    });

    const stoa = model.chains.find((c) => c.chainId === STOACHAIN_CHAIN_ID)!;
    const arweave = model.chains.find((c) => c.chainId === ARWEAVE_CHAIN_ID)!;
    // StoaChain is covered by Pythia (global) → its LOCAL field auto-disables.
    expect(stoa.status).toBe("live-global");
    expect(stoa.manualFieldEnabled).toBe(false);
    // Arweave is NOT covered by Pythia today → falls back to its LOCAL endpoint.
    expect(arweave.status).toBe("live-local");
    expect(arweave.manualFieldEnabled).toBe(true);
  });

  it("an unreachable Pythia advertises nothing → all chains gracefully fall back to LOCAL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response));
    const model = await resolveNetworkModel({
      pythiaUrl: "https://pythia.down",
      stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
      arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
    });
    for (const row of model.chains) {
      expect(row.status).toBe("live-local");
      expect(row.manualFieldEnabled).toBe(true);
    }
  });
});
