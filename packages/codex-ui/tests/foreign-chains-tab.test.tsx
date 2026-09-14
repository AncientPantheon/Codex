/**
 * The GENERIC Foreign Chains tab genericity matrix (E-09, N-05).
 *
 * `ForeignChainsTab` (codex-ui) renders a subtab strip + a dispatched panel
 * PURELY off two injected props — `foreignChains` (the id list, the consumer's
 * `createForeignChainRegistry().list()`) and `foreignChainPanels` (an
 * id → component slot map). It carries NO chain-specific branch: no
 * `if (id === "arweave")`, no concrete-chain import. This suite is the
 * load-bearing proof of that genericity:
 *
 *   - the subtab strip === the injected id list, in that order;
 *   - selecting a subtab renders that id's injected panel;
 *   - an id with no panel entry renders a graceful fallback (never a crash);
 *   - an empty list renders an empty-state;
 *   - registering a THIRD stub adapter + re-rendering grows the strip with ZERO
 *     generic-layer edits (the zero-generic-change gate);
 *   - the generic source is id-blind (no chain-id literal — grep-asserted);
 *   - the injected panel receives a well-typed, chain-agnostic `PanelProps`.
 *
 * All chains here are THROWAWAY stubs (`stub-a`/`stub-b`/`stub-c`) — no Arweave.
 * The registry is built via the D3 FACTORY `createForeignChainRegistry()`
 * (F-001: an instance `{register, get, list}`; D3 exports no module-global
 * `listForeignChains`/`registerForeignChain` free functions).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { createForeignChainRegistry } from "@ancientpantheon/codex-core";

// PINNED import path (matches T14.6's file + the package `exports`/tsconfig path
// `@ancientpantheon/codex-ui/ui/foreign-chains`). Relative to `src/` because the
// codex-ui vitest self-reference alias resolves only the bare package root; the
// sibling codex-ui `.tsx` tests import their subject the same relative way.
import {
  ForeignChainsTab,
  type PanelProps,
} from "../src/ui/foreign-chains/index.js";

import {
  stubAdapterA,
  stubAdapterB,
  stubAdapterC,
  StubPanelA,
  StubPanelB,
  StubPanelC,
} from "./fixtures/stub-foreign-chain.js";

/** The rail renders each id Capitalised for display ("stub-a" -> "Stub-a") and
 *  reserves a square brand-mark slot before it. The id remains the contract —
 *  these helpers assert the DISPLAY form without hardcoding it twice. */
const shown = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const railTab = (id: string) => new RegExp(`^${id}$`, "i");


afterEach(cleanup);

// ---------------------------------------------------------------------------
// PRECONDITION-B RE-ASSERT (FIX-4) — codex-ui's jsdom/RTL runtime harness
// ---------------------------------------------------------------------------

describe("PRECONDITION B — codex-ui jsdom/RTL runtime harness", () => {
  it("runs in a DOM environment so the generic-tab render tests can mount", () => {
    // If codex-ui's vitest env were still `node` (D5 T9.11 harness not landed),
    // `document` is undefined and every `render()` below would fail to mount —
    // fail LOUD here with the D5 precondition message rather than as a cryptic
    // downstream RTL crash.
    expect(
      typeof document !== "undefined" && typeof window !== "undefined",
    ).toBe(true); // codex-ui jsdom/RTL runtime harness (D5 T9.11) absent — the generic-tab .tsx test cannot run; execute Phase 9 first.
  });
});

// ---------------------------------------------------------------------------
// Registry-driven dispatch (E-09) — subtab list, panel selection, fallback
// ---------------------------------------------------------------------------

describe("ForeignChainsTab — registry-driven subtab dispatch", () => {
  it("lists a subtab for every injected id in registry.list() order", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubAdapterA);
    registry.register(stubAdapterB);
    const panels: Record<string, React.ComponentType<PanelProps>> = {
      "stub-a": StubPanelA,
      "stub-b": StubPanelB,
    };

    render(
      <ForeignChainsTab
        foreignChains={registry.list()}
        foreignChainPanels={panels}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    // The strip is derived SOLELY from the injected list — same ids, same order.
    expect(tabs.map((t) => t.textContent)).toEqual(registry.list().map(shown));
    expect(registry.list()).toEqual(["stub-a", "stub-b"]);
  });

  it("renders the selected id's panel and only that panel (selecting stub-b shows B, not A)", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubAdapterA);
    registry.register(stubAdapterB);
    const panels: Record<string, React.ComponentType<PanelProps>> = {
      "stub-a": StubPanelA,
      "stub-b": StubPanelB,
    };

    render(
      <ForeignChainsTab
        foreignChains={registry.list()}
        foreignChainPanels={panels}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: railTab("stub-b") }));

    expect(screen.getByTestId("stub-panel-b")).toBeTruthy();
    expect(screen.queryByTestId("stub-panel-a")).toBeNull();
  });

  it("renders a graceful 'no panel contributed' fallback for a registered id with no panel entry (never crashes/blanks)", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubAdapterA);
    registry.register(stubAdapterB);
    // stub-b is registered but has NO panel in the slot map.
    const panels: Record<string, React.ComponentType<PanelProps>> = {
      "stub-a": StubPanelA,
    };

    render(
      <ForeignChainsTab
        foreignChains={registry.list()}
        foreignChainPanels={panels}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: railTab("stub-b") }));

    // A missing slot is a graceful, id-naming fallback — not a crash, not blank.
    expect(screen.getByText(/no panel contributed for stub-b/i)).toBeTruthy();
    expect(screen.queryByTestId("stub-panel-a")).toBeNull();
  });

  it("renders an empty-state (no crash) when the injected chain list is empty", () => {
    render(<ForeignChainsTab foreignChains={[]} foreignChainPanels={{}} />);

    // No tabs, and a visible empty-state rather than a blank/crashed tree.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText(/no foreign chains/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The zero-generic-change gate (E-09, N-05) — the load-bearing genericity proof
// ---------------------------------------------------------------------------

describe("ForeignChainsTab — stub-adapter zero-generic-change gate", () => {
  it("grows the subtab strip when a THIRD stub adapter registers, purely from the re-passed list", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubAdapterA);
    registry.register(stubAdapterB);
    const panels: Record<string, React.ComponentType<PanelProps>> = {
      "stub-a": StubPanelA,
      "stub-b": StubPanelB,
      "stub-c": StubPanelC,
    };

    const { rerender } = render(
      <ForeignChainsTab
        foreignChains={registry.list()}
        foreignChainPanels={panels}
      />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    // Register a third chain and re-render with the fresh list — no generic-layer
    // edit, the third subtab appears solely because the injected list grew.
    registry.register(stubAdapterC);
    rerender(
      <ForeignChainsTab
        foreignChains={registry.list()}
        foreignChainPanels={panels}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["stub-a", "stub-b", "stub-c"].map(shown));
  });

  it("keeps the generic source id-blind — no chain-id literal in src/ui/foreign-chains/**", () => {
    // The whole point of the seam: the generic layer NEVER names a chain. If a
    // concrete id ("arweave") or a fixture id ("stub-a"/"stub-b") appears in the
    // source, dispatch is no longer purely list-driven. Read the source tree and
    // assert none of those literals are present. This FAILS at RED because the
    // dir does not exist yet (readFileSync throws) — the expected RED signal.
    const dir = resolve(__dirname, "../src/ui/foreign-chains");
    const sources = [
      readFileSync(resolve(dir, "ForeignChainsTab.tsx"), "utf8"),
      readFileSync(resolve(dir, "index.ts"), "utf8"),
    ].join("\n");

    for (const literal of ["arweave", "stub-a", "stub-b", "stub-c"]) {
      expect(sources.includes(literal)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// PanelProps contract — the injected panel gets chain-agnostic props only
// ---------------------------------------------------------------------------

describe("ForeignChainsTab — PanelProps contract", () => {
  it("hands the selected adapter id to the injected panel as generic PanelProps (no chain-specific props)", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubAdapterA);

    let received: PanelProps | undefined;
    const CapturingPanel = (props: PanelProps): React.ReactElement => {
      received = props;
      return <div data-testid="capturing-panel">captured</div>;
    };
    const panels: Record<string, React.ComponentType<PanelProps>> = {
      "stub-a": CapturingPanel,
    };

    render(
      <ForeignChainsTab
        foreignChains={registry.list()}
        foreignChainPanels={panels}
      />,
    );

    // The panel receives the selected id and nothing Arweave-specific — the slot
    // contract is chain-blind. The panel obtains its own chain seams internally.
    expect(received?.id).toBe("stub-a");
    expect(received).not.toHaveProperty("keyring");
    expect(received).not.toHaveProperty("adapter");
    expect(received).not.toHaveProperty("jwk");
  });
});

// ---------------------------------------------------------------------------
// Vertical rail layout + count-gated search (Class 2 relayout)
// ---------------------------------------------------------------------------
//
// The chain list is a VERTICAL left rail, not a horizontal strip, so it scales
// past a handful of chains. The search field earns its space: it renders only
// once the injected list exceeds the threshold, so a 2-chain deployment is not
// taxed with a filter box it does not need. These cases catch (a) a silent
// regression back to a horizontal strip, (b) an off-by-one in the count gate,
// and (c) a filter that either fails to narrow the rail or unmounts the active
// panel when nothing matches — leaving the user staring at a blank page.

/** Seven throwaway ids — one over the gate — chosen so a needle can select a
 *  strict subset and a different needle can select nothing at all. */
const SEVEN_CHAIN_IDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "omega",
];

describe("ForeignChainsTab — vertical rail layout", () => {
  it("marks the chain list as a vertically oriented tablist (a rail, not a horizontal strip)", () => {
    render(
      <ForeignChainsTab
        foreignChains={[stubAdapterA.id, stubAdapterB.id]}
        foreignChainPanels={{ [stubAdapterA.id]: StubPanelA }}
      />,
    );

    // Assistive tech (and arrow-key conventions) distinguish a rail from a strip
    // solely by this attribute — a relayout back to horizontal would drop it.
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe(
      "vertical",
    );
  });
});

describe("ForeignChainsTab — count-gated rail search", () => {
  it("renders NO search field for a short chain list (2 chains, and at the 6-chain gate boundary)", () => {
    const { container, rerender } = render(
      <ForeignChainsTab
        foreignChains={[stubAdapterA.id, stubAdapterB.id]}
        foreignChainPanels={{ [stubAdapterA.id]: StubPanelA }}
      />,
    );
    expect(container.querySelector("input")).toBeNull();

    // Boundary: the gate is "more than 6", so exactly 6 still shows no field.
    rerender(
      <ForeignChainsTab
        foreignChains={SEVEN_CHAIN_IDS.slice(0, 6)}
        foreignChainPanels={{ alpha: StubPanelA }}
      />,
    );
    expect(container.querySelector("input")).toBeNull();
  });

  it("renders a search field once the chain list exceeds the gate (7 chains)", () => {
    const { container } = render(
      <ForeignChainsTab
        foreignChains={SEVEN_CHAIN_IDS}
        foreignChainPanels={{ alpha: StubPanelA }}
      />,
    );

    expect(container.querySelector("input")).not.toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(SEVEN_CHAIN_IDS.length);
  });

  it("narrows the rail to the case-insensitively matching ids as the user types", () => {
    const { container } = render(
      <ForeignChainsTab
        foreignChains={SEVEN_CHAIN_IDS}
        foreignChainPanels={{ alpha: StubPanelA }}
      />,
    );

    const search = container.querySelector("input") as HTMLInputElement;
    // Uppercase needle against lowercase ids — the match must be case-blind, or
    // a user typing naturally sees an empty rail.
    fireEvent.change(search, { target: { value: "GA" } });

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(
      ["gamma", "omega"].map(shown),
    );
  });

  it("shows 'No matching chains' but KEEPS the active panel mounted when the filter matches nothing", () => {
    const { container } = render(
      <ForeignChainsTab
        foreignChains={SEVEN_CHAIN_IDS}
        foreignChainPanels={{ alpha: StubPanelA }}
      />,
    );
    expect(screen.getByTestId("stub-panel-a")).toBeTruthy();

    const search = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zzzz" } });

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText(/no matching chains/i)).toBeTruthy();
    // Filtering the RAIL must never unmount the panel the user is working in.
    expect(screen.getByTestId("stub-panel-a")).toBeTruthy();
  });
});
