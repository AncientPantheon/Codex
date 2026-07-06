/**
 * Throwaway fixtures for the generic-tab genericity matrix.
 *
 * These are the STUB second/third chains the E-09 zero-generic-change gate
 * registers to prove `ForeignChainsTab` dispatches PURELY off the injected
 * `foreignChains` list + `foreignChainPanels` map — with NO chain-specific
 * branch. They carry NO Arweave, NO real protocol logic: the adapter methods
 * are inert (the generic tab never calls them; it only reads `id`), and the
 * panels render a single marker text node so a test can assert WHICH slot is
 * mounted.
 */

import { createElement, type ReactElement } from "react";
import type { ForeignChainAdapter } from "@ancientpantheon/codex-core";

// The tab is id-blind: it reads `adapter.id` and nothing else. Every driver
// method is a never-called inert stub so the fixture stays free of real logic.
function makeStubAdapter(id: string): ForeignChainAdapter {
  const unused = async (): Promise<never> => {
    throw new Error(`stub adapter "${id}" has no driver behaviour`);
  };
  return {
    id,
    generateKey: unused,
    importKey: unused,
    addressOf: () => {
      throw new Error(`stub adapter "${id}" has no addressOf`);
    },
    getBalance: unused,
    buildSend: unused,
    sign: unused,
    post: unused,
  };
}

export const stubAdapterA: ForeignChainAdapter = makeStubAdapter("stub-a");
export const stubAdapterB: ForeignChainAdapter = makeStubAdapter("stub-b");
export const stubAdapterC: ForeignChainAdapter = makeStubAdapter("stub-c");

/**
 * The generic panel-slot contract the injected panels must satisfy. Kept in the
 * fixture (not imported from src) so the RED file can pin the intended shape
 * BEFORE `ForeignChainsTab`/its `PanelProps` export exists — T14.6 must export a
 * `PanelProps` structurally compatible with this.
 */
export type StubPanelProps = {
  /** The selected adapter id the generic shell dispatched to this slot. */
  id: string;
  /** Opaque, chain-agnostic context. NO Arweave-specific props ever appear. */
  ctx?: unknown;
};

/** A slot panel that renders a marker plus the id it was handed. */
function makeStubPanel(marker: string) {
  return function StubPanel(props: StubPanelProps): ReactElement {
    return createElement(
      "div",
      { "data-testid": marker },
      `${marker}:${props.id}`,
    );
  };
}

export const StubPanelA = makeStubPanel("stub-panel-a");
export const StubPanelB = makeStubPanel("stub-panel-b");
export const StubPanelC = makeStubPanel("stub-panel-c");
