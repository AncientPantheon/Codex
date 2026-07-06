/**
 * createStoaChainConnection (CL-08/CL-09) — routing the StoaChain Pact node URL through
 * the network-settings connection descriptor instead of stoa-core's hidden
 * `node2` default.
 *
 * These assertions pin the seam contract Phase 4 will wire:
 *   - a `direct` descriptor produces the resolver inputs (`clientOverride` built
 *     from the descriptor's nodeUrl + the `selectedNode:"custom"`/`customNodeUrl`
 *     pair the existing mechanism expects) so BOTH signing and reads follow the
 *     user's node;
 *   - a `preset` descriptor maps to the surfaced `selectedNode:"node1"/"node2"`
 *     value (the previously-implicit default becomes explicit — CL-09);
 *   - `applyNodeConfig()` redirects stoa-core's global read path (the reads in
 *     the Accounts tab go through `getPactUrl`, which reads that global), which
 *     is why a direct URL must redirect reads too, not just signing;
 *   - a `ChainConnection` is produced (Phase 1 seam) so the network-settings
 *     model + health work over the same node URL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getActivePactUrl,
  resetNodeFailover,
  STOACHAIN_CHAIN_ID,
} from "./stoaNetwork.js";
import {
  createStoaChainConnection,
  STOACHAIN_DEFAULT_NODE_URL,
  type StoaChainConnectionDescriptor,
} from "./index.js";

const CUSTOM_URL = "https://my-node.example.com";

describe("createStoaChainConnection", () => {
  beforeEach(() => {
    resetNodeFailover();
  });
  afterEach(() => {
    resetNodeFailover();
    vi.restoreAllMocks();
  });

  it("builds a clientOverride for a direct node URL so signing bypasses the hardcoded node2 default", () => {
    const desc: StoaChainConnectionDescriptor = {
      kind: "direct",
      nodeUrl: CUSTOM_URL,
    };
    const built = createStoaChainConnection(desc);

    // A direct node URL must yield a concrete client override — the resolver
    // seam prefers `clientOverride` over its lazy `createClient(getPactUrl(...))`
    // default, so signing follows the user's node without touching stoa-core.
    expect(built.signingOptions.clientOverride).toBeDefined();
    expect(built.signingOptions.selectedNode).toBe("custom");
    expect(built.signingOptions.customNodeUrl).toBe(CUSTOM_URL);
  });

  it("redirects stoa-core's global read path to the direct node URL when applied", () => {
    const desc: StoaChainConnectionDescriptor = {
      kind: "direct",
      nodeUrl: CUSTOM_URL,
    };
    const built = createStoaChainConnection(desc);

    // Reads (Accounts-tab balances) resolve their URL via getActivePactUrl, which
    // reads stoa-core's module-global active host. Applying must move that global
    // onto the user's origin so reads AND signing agree on the node.
    built.applyNodeConfig();
    expect(getActivePactUrl(STOACHAIN_CHAIN_ID)).toContain("my-node.example.com");
  });

  it("maps a preset descriptor to the surfaced selectedNode value (no clientOverride)", () => {
    const desc: StoaChainConnectionDescriptor = { kind: "preset", preset: "node1" };
    const built = createStoaChainConnection(desc);

    // A preset routes through the existing selectedNode mechanism — the resolver
    // then builds its own client for that node. No override is fabricated.
    expect(built.signingOptions.clientOverride).toBeUndefined();
    expect(built.signingOptions.selectedNode).toBe("node1");
  });

  it("redirects the read path to node1's host for a node1 preset when applied", () => {
    const built = createStoaChainConnection({ kind: "preset", preset: "node1" });
    built.applyNodeConfig();
    // node1 preset moves the active host to node1.stoachain.com — an EXPLICIT,
    // surfaced selection rather than the implicit node2 assumption (CL-09).
    expect(getActivePactUrl(STOACHAIN_CHAIN_ID)).toContain("node1.stoachain.com");
  });

  it("exposes the current node2 default as an explicit descriptor value, not a hidden assumption", () => {
    // CL-09: the previously-implicit node2 default is surfaced as a real URL a
    // Network tab can display and edit. Behaviour identical (same URL).
    expect(STOACHAIN_DEFAULT_NODE_URL).toContain("node2.stoachain.com");
    const built = createStoaChainConnection({ kind: "preset", preset: "node2" });
    built.applyNodeConfig();
    expect(getActivePactUrl(STOACHAIN_CHAIN_ID)).toContain("node2.stoachain.com");
  });

  it("produces a ChainConnection whose health covers only the kadena chain over the given node URL", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    const built = createStoaChainConnection(
      { kind: "direct", nodeUrl: CUSTOM_URL },
      { fetchFn }
    );

    const health = await built.connection.health();
    expect(health.reachable).toBe(true);
    expect(health.coveredChains).toEqual([built.connection.chainId]);
    // Probe hit the descriptor's node URL, not the hardcoded default.
    expect(fetchFn).toHaveBeenCalledWith(
      CUSTOM_URL,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("defers signing for a pythia descriptor (no override, no read redirect) while still producing a ChainConnection", () => {
    const built = createStoaChainConnection({
      kind: "pythia",
      baseUrl: "https://pythia.example.com",
    });

    // CL-10 is deferred: a pythia descriptor must NOT fabricate a signing
    // clientOverride (that shim is the follow-up) and must NOT redirect
    // stoa-core's chainweb read global — applying it leaves the default node2 in
    // place so the live signing path is never endangered.
    expect(built.signingOptions.clientOverride).toBeUndefined();
    expect(built.signingOptions.selectedNode).toBeUndefined();
    built.applyNodeConfig();
    expect(getActivePactUrl(STOACHAIN_CHAIN_ID)).toContain("node2.stoachain.com");
    // The ChainConnection still exists (over the pythia base) so the
    // network-settings model + health can operate on the row.
    expect(built.connection.chainId).toBe("stoachain");
  });

  it("relays a read through the ChainConnection transport to the direct node URL", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { status: "success", data: 42 } }),
    }));
    const built = createStoaChainConnection(
      { kind: "direct", nodeUrl: CUSTOM_URL },
      { fetchFn }
    );

    const out = await built.connection.read({ pactCode: "(+ 1 1)" });
    // The transport POSTs the opaque read query to the node's /api/v1/local
    // endpoint under the given URL — proving reads follow the descriptor.
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("my-node.example.com"),
      expect.objectContaining({ method: "POST" })
    );
    expect(out).toEqual({ result: { status: "success", data: 42 } });
  });
});
