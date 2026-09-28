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
import { STOACHAIN_DEFAULT_NODE_URL, KADENA_MAINNET_DEFAULT_NODE_URL, KADENA_DIRECT_NODE_URL } from "@ancientpantheon/codex-ouronet/connection";

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
  KADENA_CHAIN_ID,
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
      kadenaNodeUrl: KADENA_MAINNET_DEFAULT_NODE_URL,
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

  it("migrates a persisted kadenaNodeUrl that is EXACTLY the documented LAN dev escape hatch (http://localhost:31849) back to the real mainnet default", () => {
    // Live bug report: a real tester's Send KDA failed with "Failed to fetch
    // http://localhost:31849" — nothing was running on that port. That value
    // only ever gets persisted via the documented VITE_KADENA_NODE_URL escape
    // hatch (this file's own doc comment above KADENA_NODE_URL_OVERRIDE) for a
    // dev genuinely on the node's own LAN, or a deliberate Network-tab edit —
    // but once whichever caused it stops being true (`.env.local` removed, a
    // different tester loads the same browser profile), the value silently
    // outlives its own reason and points every Kadena send at a node that
    // isn't there. Same class of fix as the Arweave gateway migration above:
    // correct EXACTLY this one literal, once.
    window.localStorage.setItem(
      NETWORK_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        pythiaUrl: "",
        stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
        arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
        kadenaNodeUrl: "http://localhost:31849",
      }),
    );
    const settings = loadNetworkSettings();
    expect(settings.kadenaNodeUrl).toBe(KADENA_MAINNET_DEFAULT_NODE_URL);
  });

  it("migrates a persisted kadenaNodeUrl that is EXACTLY the OLD default (the direct duckdns node, KADENA_DIRECT_NODE_URL) to the current gateway default — live bug report: a tester still got 'Kadena simulation timed out' after the gateway rollout, with no way to tell from that message which node was actually active", () => {
    window.localStorage.setItem(
      NETWORK_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        pythiaUrl: "",
        stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
        arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
        kadenaNodeUrl: KADENA_DIRECT_NODE_URL,
      }),
    );
    const settings = loadNetworkSettings();
    expect(settings.kadenaNodeUrl).toBe(KADENA_MAINNET_DEFAULT_NODE_URL);
    expect(settings.kadenaNodeUrl).not.toBe(KADENA_DIRECT_NODE_URL);
  });

  it("does NOT migrate a deliberately-chosen custom Kadena node URL, even if it also happens to be a localhost address on a DIFFERENT port", () => {
    window.localStorage.setItem(
      NETWORK_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        pythiaUrl: "",
        stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
        arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
        kadenaNodeUrl: "http://localhost:31850",
      }),
    );
    const settings = loadNetworkSettings();
    expect(settings.kadenaNodeUrl).toBe("http://localhost:31850");
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
      kadenaNodeUrl: KADENA_MAINNET_DEFAULT_NODE_URL,
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
      kadenaNodeUrl: KADENA_MAINNET_DEFAULT_NODE_URL,
    });
    const reloaded = loadNetworkSettings();
    expect(reloaded.arweaveMode).toBe("mock");
  });
});

describe("networkSettings — resolveNetworkModel (standalone unlocked three-tier)", () => {
  it("builds an UNLOCKED three-row model — stoachain + arweave + kadena, all live-local + editable (no global) — 2026-09-26, owner: 'we also need an entry here for the kadena connection'", async () => {
    const model = await resolveNetworkModel({
      pythiaUrl: "",
      stoaChainNodeUrl: STOACHAIN_DEFAULT_NODE_URL,
      arweaveGatewayUrl: DEFAULT_GATEWAY_URL,
      kadenaNodeUrl: KADENA_MAINNET_DEFAULT_NODE_URL,
    });

    // Standalone: no operator global, all three chains are surfaced as
    // LOCAL — so every row is editable (manualFieldEnabled) and status is
    // live-local.
    expect(model.locked).toBe(false);
    expect(model.chains.map((c) => c.chainId)).toEqual([
      STOACHAIN_CHAIN_ID,
      ARWEAVE_CHAIN_ID,
      KADENA_CHAIN_ID,
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

  it("renders the Network tab with the real node2.stoachain.com StoaChain default + the Arweave mainnet gateway + the Kadena mainnet default (2026-09-26)", async () => {
    await mountDashboard();

    const stoaUrl = (await screen.findByTestId(
      `network-url-${STOACHAIN_CHAIN_ID}`,
    )) as HTMLInputElement;
    const arweaveUrl = screen.getByTestId(
      `network-url-${ARWEAVE_CHAIN_ID}`,
    ) as HTMLInputElement;
    const kadenaUrl = screen.getByTestId(
      `network-url-${KADENA_CHAIN_ID}`,
    ) as HTMLInputElement;

    // Standalone now ships wired to the real node2 gateway (still editable);
    // the Arweave gateway now ships wired to the real mainnet gateway too.
    expect(stoaUrl.value).toBe(STOACHAIN_DEFAULT_NODE_URL);
    expect(arweaveUrl.value).toBe(DEFAULT_GATEWAY_URL);
    expect(arweaveUrl.value).toContain("arweave.net");
    // The third row (owner directive: "we also need an entry here for the
    // kadena connection") ships wired to the real, public Kadena mainnet
    // node — still editable, same convention as the other two.
    expect(kadenaUrl.value).toBe(KADENA_MAINNET_DEFAULT_NODE_URL);
  });

  it("persists an edited Kadena node URL so the dashboard's Kadena-mode reads follow it — the actual switch mechanism, not just a display field", async () => {
    await mountDashboard();

    const kadenaUrl = (await screen.findByTestId(
      `network-url-${KADENA_CHAIN_ID}`,
    )) as HTMLInputElement;
    fireEvent.change(kadenaUrl, { target: { value: "https://my-own-kadena-node.example" } });

    expect(loadNetworkSettings().kadenaNodeUrl).toBe("https://my-own-kadena-node.example");
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
      kadenaNodeUrl: KADENA_MAINNET_DEFAULT_NODE_URL,
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
      kadenaNodeUrl: KADENA_MAINNET_DEFAULT_NODE_URL,
    });
    for (const row of model.chains) {
      expect(row.status).toBe("live-local");
      expect(row.manualFieldEnabled).toBe(true);
    }
  });
});
