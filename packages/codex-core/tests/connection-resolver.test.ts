/**
 * RED contract tests for `createConnectionResolver` (CL-04) + the network-
 * settings status model (CL-05).
 *
 * The resolver merges a GLOBAL base (operator-injected: a Pythia base URL and/or
 * per-chain node URLs) with LOCAL per-chain overrides (user-set), plus a `locked`
 * flag. Per supported chain it derives:
 *   - the active `ChainConnection` with precedence:
 *       local override (ONLY for a chain the global does NOT cover)
 *       → global (if it covers the chain)
 *       → none ("not connected").
 *   - a `status`: "live-global" | "live-local" | "missing" | "not-connected".
 *   - `manualFieldEnabled`: true IFF the chain is NOT globally covered (so the
 *     user may set a local override for it).
 *
 * COVERAGE is DYNAMIC — it comes from the global connection's
 * `health().coveredChains`, never hardcoded. Pythia covers `stoachain` today,
 * NOT arweave; the resolver flips a row to live-global with zero code change the
 * day Pythia advertises the chain.
 *
 * These are PURE derivations over injected fakes — the load-bearing testable
 * core. RED: imports from `../src/connection/index.js`, which does not exist yet.
 */

import { describe, it, expect } from "vitest";
import {
  createConnectionResolver,
  type ChainConnection,
  type ConnectionHealth,
} from "../src/connection/index.js";

/** A fake ChainConnection stamped with the chains its health() advertises. */
function fakeConnection(chainId: string, coveredChains: string[]): ChainConnection {
  return {
    chainId,
    read: async () => ({}),
    send: async () => ({}),
    poll: async () => ({ status: "final" }),
    health: async (): Promise<ConnectionHealth> => ({
      reachable: coveredChains.length > 0,
      coveredChains,
    }),
  };
}

const SUPPORTED = ["stoachain", "arweave"];

describe("createConnectionResolver + status model (CL-04, CL-05)", () => {
  it("global Pythia covers stoachain → live-global with the manual field disabled; arweave (uncovered, no local) → missing with the field enabled", async () => {
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: fakeConnection("pythia", ["stoachain"]),
      local: {},
      locked: false,
    });

    const model = await resolver.resolve();

    const stoa = model.chains.find((c) => c.chainId === "stoachain");
    const arweave = model.chains.find((c) => c.chainId === "arweave");

    expect(stoa?.status).toBe("live-global");
    expect(stoa?.manualFieldEnabled).toBe(false);
    expect(stoa?.connection).toBe(model.global);

    expect(arweave?.status).toBe("missing");
    expect(arweave?.manualFieldEnabled).toBe(true);
    expect(arweave?.connection).toBeUndefined();
  });

  it("a local arweave gateway override (uncovered chain) resolves that chain to live-local", async () => {
    const localArweave = fakeConnection("arweave", ["arweave"]);
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: fakeConnection("pythia", ["stoachain"]),
      local: { arweave: localArweave },
      locked: false,
    });

    const model = await resolver.resolve();
    const arweave = model.chains.find((c) => c.chainId === "arweave");

    expect(arweave?.status).toBe("live-local");
    expect(arweave?.connection).toBe(localArweave);
    // The field stays enabled — it is the user's own override surface.
    expect(arweave?.manualFieldEnabled).toBe(true);
  });

  it("a local override for a GLOBALLY-COVERED chain is IGNORED — global wins and the field stays disabled", async () => {
    const localStoa = fakeConnection("stoachain-local", ["stoachain"]);
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: fakeConnection("pythia", ["stoachain"]),
      local: { stoachain: localStoa },
      locked: false,
    });

    const model = await resolver.resolve();
    const stoa = model.chains.find((c) => c.chainId === "stoachain");

    expect(stoa?.status).toBe("live-global");
    expect(stoa?.connection).toBe(model.global);
    expect(stoa?.connection).not.toBe(localStoa);
    expect(stoa?.manualFieldEnabled).toBe(false);
  });

  it("no global and no local for a chain → not-connected with an enabled field", async () => {
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: undefined,
      local: {},
      locked: false,
    });

    const model = await resolver.resolve();
    const stoa = model.chains.find((c) => c.chainId === "stoachain");
    const arweave = model.chains.find((c) => c.chainId === "arweave");

    expect(stoa?.status).toBe("not-connected");
    expect(stoa?.manualFieldEnabled).toBe(true);
    expect(arweave?.status).toBe("not-connected");
  });

  it("coverage is dynamic: the day Pythia advertises arweave, that row flips to live-global with the field auto-disabled, no code change", async () => {
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: fakeConnection("pythia", ["stoachain", "arweave"]),
      local: { arweave: fakeConnection("arweave", ["arweave"]) },
      locked: false,
    });

    const model = await resolver.resolve();
    const arweave = model.chains.find((c) => c.chainId === "arweave");

    // Now globally covered → global wins over the stale local override.
    expect(arweave?.status).toBe("live-global");
    expect(arweave?.manualFieldEnabled).toBe(false);
    expect(arweave?.connection).toBe(model.global);
  });

  it("the model carries the locked flag verbatim — field-edit is a UI concern, status derivation is unaffected", async () => {
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: fakeConnection("pythia", ["stoachain"]),
      local: {},
      locked: true,
    });

    const model = await resolver.resolve();
    expect(model.locked).toBe(true);
    // locked does NOT change the derived status/enablement — it is UI-only.
    expect(model.chains.find((c) => c.chainId === "arweave")?.manualFieldEnabled).toBe(true);
  });

  it("resolveChain(chainId) returns the single per-chain row for a targeted lookup", async () => {
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: fakeConnection("pythia", ["stoachain"]),
      local: {},
      locked: false,
    });

    const row = await resolver.resolveChain("stoachain");
    expect(row.chainId).toBe("stoachain");
    expect(row.status).toBe("live-global");
  });

  it("an unreachable global (empty coverage) leaves an uncovered chain missing rather than falsely live", async () => {
    const resolver = createConnectionResolver({
      supportedChains: SUPPORTED,
      global: fakeConnection("pythia", []),
      local: {},
      locked: false,
    });

    const model = await resolver.resolve();
    // Global present but covers nothing → each chain is not-connected (no local either).
    expect(model.chains.find((c) => c.chainId === "stoachain")?.status).toBe("not-connected");
  });
});
