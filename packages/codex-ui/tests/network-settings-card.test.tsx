/**
 * NetworkSettingsCard (CL-11) — the chain-generic Network settings card.
 *
 * The card takes a resolved `NetworkSettingsModel` + edit callbacks and renders
 * ONE ROW PER CHAIN: the chain id, a human status label (Live via Pythia /
 * Live (local) / Missing / Not connected), a health dot, and a manual
 * node/gateway URL field. The field is DISABLED when the chain is globally
 * covered (`manualFieldEnabled === false`) and editable otherwise. When
 * `model.locked` every field is read-only. Editing an enabled field calls
 * `onSetChainUrl(chainId, url)`.
 *
 * The card is chain-BLIND: it carries no `if (chainId === "arweave")` branch —
 * every row is derived purely from the injected model rows. These tests drive
 * that contract off hand-built `NetworkSettingsModel` fixtures (no resolver, no
 * network) so each assertion pins a user-visible behaviour of the card itself.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import type {
  ChainConnection,
  NetworkSettingsModel,
  ChainConnectionRow,
} from "@ancientpantheon/codex-core";

import { NetworkSettingsCard } from "../src/ui/settings/NetworkSettingsCard.js";

afterEach(cleanup);

// A throwaway ChainConnection stand-in — the card never calls its methods, it
// only reads the row metadata, so a minimal shape suffices.
function stubConnection(chainId: string): ChainConnection {
  return {
    chainId,
    read: async () => undefined,
    send: async () => undefined,
    poll: async () => ({ status: "final" as const }),
    health: async () => ({ reachable: true, coveredChains: [chainId] }),
  };
}

function row(partial: Partial<ChainConnectionRow> & { chainId: string }): ChainConnectionRow {
  return {
    status: "live-local",
    connection: stubConnection(partial.chainId),
    manualFieldEnabled: true,
    ...partial,
  };
}

function model(partial: Partial<NetworkSettingsModel> & { chains: ChainConnectionRow[] }): NetworkSettingsModel {
  return { global: undefined, locked: false, ...partial };
}

describe("NetworkSettingsCard — per-chain rows", () => {
  it("renders one row per chain in the injected model order, naming each chain id", () => {
    render(
      <NetworkSettingsCard
        model={model({
          chains: [
            row({ chainId: "stoachain", status: "live-local" }),
            row({ chainId: "arweave", status: "live-local" }),
          ],
        })}
        onSetChainUrl={vi.fn()}
      />,
    );

    // A stable per-chain testid lets us pin the row set + order without coupling
    // to layout. Both supported chains surface a row.
    const rows = screen.getAllByTestId(/^network-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "network-row-stoachain",
      "network-row-arweave",
    ]);
  });

  it("maps each status to its human label so the operator reads the connection state, not the enum", () => {
    render(
      <NetworkSettingsCard
        model={model({
          chains: [
            row({ chainId: "a", status: "live-global" }),
            row({ chainId: "b", status: "live-local" }),
            row({ chainId: "c", status: "missing", connection: undefined }),
            row({ chainId: "d", status: "not-connected", connection: undefined }),
          ],
        })}
        onSetChainUrl={vi.fn()}
      />,
    );

    expect(screen.getByTestId("network-status-a").textContent).toMatch(/live via pythia/i);
    expect(screen.getByTestId("network-status-b").textContent).toMatch(/live \(local\)/i);
    expect(screen.getByTestId("network-status-c").textContent).toMatch(/missing/i);
    expect(screen.getByTestId("network-status-d").textContent).toMatch(/not connected/i);
  });
});

describe("NetworkSettingsCard — manual field enable/disable", () => {
  it("disables the URL field for a globally-covered chain (manualFieldEnabled === false)", () => {
    render(
      <NetworkSettingsCard
        model={model({
          chains: [row({ chainId: "stoachain", status: "live-global", manualFieldEnabled: false })],
        })}
        onSetChainUrl={vi.fn()}
      />,
    );

    const field = screen.getByTestId("network-url-stoachain") as HTMLInputElement;
    // Globally covered → the operator cannot override; the field is disabled.
    expect(field.disabled).toBe(true);
  });

  it("enables the URL field for a chain the global does not cover (manualFieldEnabled === true)", () => {
    render(
      <NetworkSettingsCard
        model={model({
          chains: [row({ chainId: "arweave", status: "live-local", manualFieldEnabled: true })],
        })}
        onSetChainUrl={vi.fn()}
      />,
    );

    const field = screen.getByTestId("network-url-arweave") as HTMLInputElement;
    expect(field.disabled).toBe(false);
  });

  it("seeds each field with the injected per-chain URL so the operator sees the live endpoint", () => {
    render(
      <NetworkSettingsCard
        model={model({
          chains: [row({ chainId: "arweave", status: "live-local", manualFieldEnabled: true })],
        })}
        urls={{ arweave: "http://localhost:1984" }}
        onSetChainUrl={vi.fn()}
      />,
    );

    const field = screen.getByTestId("network-url-arweave") as HTMLInputElement;
    // The surfaced default flows in via `urls` (the connection seam is
    // URL-opaque), so the field shows it — not an empty box.
    expect(field.value).toBe("http://localhost:1984");
  });

  it("calls onSetChainUrl(chainId, newValue) when an enabled field is edited", () => {
    const onSetChainUrl = vi.fn();
    render(
      <NetworkSettingsCard
        model={model({
          chains: [row({ chainId: "arweave", status: "live-local", manualFieldEnabled: true })],
        })}
        onSetChainUrl={onSetChainUrl}
      />,
    );

    const field = screen.getByTestId("network-url-arweave") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "http://localhost:1984" } });

    // The card reports the edit with the chain id and the exact typed value —
    // this is the write contract the playground wires its state to.
    expect(onSetChainUrl).toHaveBeenCalledWith("arweave", "http://localhost:1984");
  });
});

describe("NetworkSettingsCard — locked read-only", () => {
  it("renders every field read-only when the model is locked, even for otherwise-editable chains", () => {
    render(
      <NetworkSettingsCard
        model={model({
          locked: true,
          chains: [row({ chainId: "arweave", status: "live-local", manualFieldEnabled: true })],
        })}
        onSetChainUrl={vi.fn()}
      />,
    );

    const field = screen.getByTestId("network-url-arweave") as HTMLInputElement;
    // Locked is a UI concern layered ON TOP of manualFieldEnabled: an editable
    // chain still cannot be edited while the codex is locked.
    expect(field.readOnly || field.disabled).toBe(true);
  });

  it("does not call onSetChainUrl when a locked field receives input", () => {
    const onSetChainUrl = vi.fn();
    render(
      <NetworkSettingsCard
        model={model({
          locked: true,
          chains: [row({ chainId: "arweave", status: "live-local", manualFieldEnabled: true })],
        })}
        onSetChainUrl={onSetChainUrl}
      />,
    );

    const field = screen.getByTestId("network-url-arweave") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "http://evil" } });

    expect(onSetChainUrl).not.toHaveBeenCalled();
  });
});

describe("NetworkSettingsCard — chain-blind source (N-05 genericity)", () => {
  it("names no concrete chain id in its source — every row is model-driven", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/ui/settings/NetworkSettingsCard.tsx"),
      "utf8",
    );
    // The card must not branch on a specific chain: no "arweave"/"stoachain"
    // literal. If one appears, the row rendering is no longer purely model-driven.
    for (const literal of ["arweave", "stoachain"]) {
      expect(source.includes(literal)).toBe(false);
    }
  });
});
