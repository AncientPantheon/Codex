/**
 * resolverProvider node-config wiring (CL-08).
 *
 * Before Phase 3 the seam declared `selectedNode`/`customNodeUrl` in its options
 * but NEVER read them — the balance READS (`getActivePactUrl`) and the signing
 * default both stayed pinned to stoa-core's `node2` global no matter what the
 * user selected. These assertions pin the fix: `createSigningStrategy` now APPLIES
 * the selected node to stoa-core's global (via `setNodeConfig`), so a custom node
 * redirects reads too — while the default `node2` case stays byte-identical
 * (behaviour preserved given an equivalent node).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getActivePactUrl,
  resetNodeFailover,
  KADENA_CHAIN_ID,
} from "../connection/stoaNetwork.js";
import { createOuronetResolverProvider } from "./resolverProvider.js";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";

const CUSTOM_URL = "https://custom-node.example.com";

describe("createSigningStrategy — node-config application", () => {
  beforeEach(() => {
    resetNodeFailover();
  });
  afterEach(() => {
    resetNodeFailover();
  });

  it("redirects the read path to a custom node URL when selectedNode is 'custom'", () => {
    const store = createCodexStore();
    const provider = createOuronetResolverProvider(store);

    provider.createSigningStrategy(store, {
      selectedNode: "custom",
      customNodeUrl: CUSTOM_URL,
    });

    // The Accounts-tab reads resolve their URL from stoa-core's global active
    // host; applying 'custom' must move that global onto the user's origin.
    expect(getActivePactUrl(KADENA_CHAIN_ID)).toContain("custom-node.example.com");
  });

  it("moves the read path to node1's host when selectedNode is 'node1'", () => {
    const store = createCodexStore();
    const provider = createOuronetResolverProvider(store);

    provider.createSigningStrategy(store, { selectedNode: "node1" });

    expect(getActivePactUrl(KADENA_CHAIN_ID)).toContain("node1.stoachain.com");
  });

  it("keeps the read path on node2 for the default selection (behaviour identical)", () => {
    const store = createCodexStore();
    const provider = createOuronetResolverProvider(store);

    // The pre-Phase-3 behaviour: default node2. Passing node2 explicitly (or
    // nothing) must leave the read URL exactly where it was.
    provider.createSigningStrategy(store, { selectedNode: "node2" });

    expect(getActivePactUrl(KADENA_CHAIN_ID)).toContain("node2.stoachain.com");
  });

  it("does not throw (and stays on node2) when 'custom' is selected with an empty URL", () => {
    const store = createCodexStore();
    const provider = createOuronetResolverProvider(store);

    // The default uiSettings ship selectedNode may flip to "custom" in the UI
    // before the user types a URL (customNodeUrl: ""). setNodeConfig throws a
    // TypeError on an empty custom URL, which would crash strategy construction
    // and break the signing modal. The seam must treat an empty custom URL as
    // "no custom node yet" and leave the default node2 global in place.
    expect(() =>
      provider.createSigningStrategy(store, {
        selectedNode: "custom",
        customNodeUrl: "",
      }),
    ).not.toThrow();
    expect(getActivePactUrl(KADENA_CHAIN_ID)).toContain("node2.stoachain.com");
  });

  it("leaves the global untouched when no selectedNode is supplied (no dead-param regression)", () => {
    const store = createCodexStore();
    const provider = createOuronetResolverProvider(store);

    provider.createSigningStrategy(store, {});

    // Omitting selectedNode entirely must not throw and must keep the default
    // node2 host — the seam stays backward-compatible with callers that never
    // forwarded the node fields.
    expect(getActivePactUrl(KADENA_CHAIN_ID)).toContain("node2.stoachain.com");
  });
});
