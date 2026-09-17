// ============================================================================
// Network settings wiring (CL-13, N-03, N-04) — the working-localhost deliverable.
//
// The playground surfaces an EDITABLE, UNLOCKED default network config: the
// StoaChain node URL (default STOACHAIN_DEFAULT_NODE_URL) + the Arweave gateway URL
// (default DEFAULT_GATEWAY_URL = https://arweave.net, the real mainnet reference
// gateway), persisted to localStorage. It builds a `NetworkSettingsModel` via
// `createConnectionResolver` (standalone → no global → both chains local → both
// rows editable + "Live (local)") and renders the codex-ui `NetworkSettingsCard`
// in the loaded dashboard shell.
//
// These tests pin: (a) the surfaced defaults are REAL, editable values (N-03) —
// the card shows a StoaChain + Arweave row with their default URLs; (b) the
// Arweave default is the real mainnet gateway `arweave.net`, deliberately (N-04,
// superseded — real mainnet reads are now the intended default, with the
// gateway field remaining the escape hatch to point at a testnet/alternate
// gateway during development); and (c) the persistence + model-build helper
// resolves an unlocked, two-row, live-local model off the surfaced state.
// ============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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
  it("ships wired to the real node2.stoachain.com gateway by default (owner directive, updated) — a standalone Codex can read/send on Chainweb immediately", () => {
    const settings = loadNetworkSettings();
    // The StoaChain node now defaults to the real, public node2 host (still
    // fully editable in the Network tab); the Arweave gateway now defaults to
    // the real mainnet reference gateway too (see below).
    expect(settings.stoaChainNodeUrl).toBe(STOACHAIN_DEFAULT_NODE_URL);
    expect(settings.arweaveGatewayUrl).toBe(DEFAULT_GATEWAY_URL);
  });

  it("defaults the Arweave gateway to the real mainnet arweave.net gateway (funds-safety N-04, superseded — deliberate default)", () => {
    const settings = loadNetworkSettings();
    expect(settings.arweaveGatewayUrl).toContain("arweave.net");
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

  it("migrates a persisted arweaveGatewayUrl that is EXACTLY the old testnet-only default (localhost:1984) to the current real mainnet default", () => {
    // WHY: DEFAULT_GATEWAY_URL was localhost:1984 before this session flipped
    // it to https://arweave.net. Any browser that had ALREADY loaded this app
    // before that change got "http://localhost:1984" WRITTEN to localStorage
    // as its persisted value — not because anyone deliberately typed it, but
    // because it was simply the code's own default at the time. Since nothing
    // is ever listening on localhost:1984 in a real deployment, that stale
    // value permanently breaks "real" mode for that browser (it shows a
    // misleading green "Live (local)" status for an endpoint that never
    // answers) until manually edited — this migration corrects EXACTLY that
    // one legacy literal, once, without touching any OTHER value a user
    // might have deliberately typed (including a DIFFERENT custom localhost
    // URL, which is left completely alone).
    window.localStorage.setItem(
      NETWORK_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        pythiaUrl: "",
        stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
        arweaveGatewayUrl: "http://localhost:1984",
      }),
    );
    const settings = loadNetworkSettings();
    expect(settings.arweaveGatewayUrl).toBe(DEFAULT_GATEWAY_URL);
  });

  it("does NOT migrate a deliberately-chosen custom gateway URL, even if it also happens to be a localhost address", () => {
    window.localStorage.setItem(
      NETWORK_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        pythiaUrl: "",
        stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
        arweaveGatewayUrl: "http://localhost:1985",
      }),
    );
    const settings = loadNetworkSettings();
    expect(settings.arweaveGatewayUrl).toBe("http://localhost:1985");
  });

  it("defaults arweaveMode to real when nothing is persisted yet (owner directive: real balances out of the box, no manual step)", () => {
    const settings = loadNetworkSettings();
    expect(settings.arweaveMode).toBe("real");
  });

  it("round-trips an edited arweaveMode through localStorage — flipping to real survives a reload", () => {
    // WHY: arweaveMode used to live in a plain (non-persisted) useState in
    // App.tsx, defaulting to mock on every mount. A page reload or a dev-server
    // restart silently reset a user's "real" choice back to mock with zero
    // indication — every subsequent balance read then quietly used the mock
    // adapter's fixed fake balance instead of the real chain, which is exactly
    // the reported symptom (a real, funded address reading as a fixed 1.5 AR).
    saveNetworkSettings({
      pythiaUrl: "",
      stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
      arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
      arweaveMode: "real",
    });
    const reloaded = loadNetworkSettings();
    expect(reloaded.arweaveMode).toBe("real");
  });

  it("falls back to the default (real) for a corrupt/unknown persisted arweaveMode value", () => {
    window.localStorage.setItem(
      NETWORK_SETTINGS_STORAGE_KEY,
      JSON.stringify({ arweaveMode: "not-a-real-mode" }),
    );
    const settings = loadNetworkSettings();
    expect(settings.arweaveMode).toBe("real");
  });

  it("still honors a deliberately-persisted 'mock' choice (real is only the default, not forced)", () => {
    saveNetworkSettings({
      pythiaUrl: "",
      stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
      arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
      arweaveMode: "mock",
    });
    const reloaded = loadNetworkSettings();
    expect(reloaded.arweaveMode).toBe("mock");
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
    // Pin the mounted dashboard on a Class IA top-level tab: T5 removed the
    // Seed Words tab this used to wait for (Chainweb seeds now live at Class 2 →
    // chainweb → Seeds), and this test only needs the shell to be up before it
    // switches to the settings view.
    await screen.findByRole("tab", { name: /blockchain accounts/i });
    // The network connectors now live in the packaged settings: switch to the
    // "Codex UI Settings" view, then open the injected "Network" subtab.
    fireEvent.click(screen.getByRole("tab", { name: /codex ui settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^network$/i }));
    await screen.findByTestId(`network-url-${STOACHAIN_CHAIN_ID}`);
  }

  it("renders the Network tab with the real node2.stoachain.com StoaChain default + the Arweave mainnet gateway", async () => {
    await mountDashboard();

    const stoaUrl = (await screen.findByTestId(
      `network-url-${STOACHAIN_CHAIN_ID}`,
    )) as HTMLInputElement;
    const arweaveUrl = screen.getByTestId(
      `network-url-${ARWEAVE_CHAIN_ID}`,
    ) as HTMLInputElement;

    // Standalone now ships wired to the real node2 gateway (still editable);
    // the Arweave gateway now ships wired to the real mainnet gateway too.
    expect(stoaUrl.value).toBe(STOACHAIN_DEFAULT_NODE_URL);
    expect(arweaveUrl.value).toBe(DEFAULT_GATEWAY_URL);
    expect(arweaveUrl.value).toContain("arweave.net");
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
