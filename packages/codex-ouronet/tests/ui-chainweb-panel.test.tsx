/**
 * ChainwebPanel specs — the Chainweb chain panel contributed into codex-ui's
 * generic `ForeignChainsTab` slot.
 *
 * The panel RE-PARENTS the three existing Chainweb tabs under three categories
 * (Seeds / Pure Keys / Accounts) and owns nothing else: each category must mount
 * the REAL `SeedWordsTab` / `PureKeypairsTab` / `StoaAccountsTab`, not a copy.
 * The specs therefore assert on each concrete tab's own empty-state text — a
 * re-parenting that duplicated logic, dropped a mount, or silently rendered a
 * blank panel would fail here. `accounts` is the landing category, so a default
 * regression (landing on Seeds) is pinned too.
 *
 * Balances flow through the `pactRead` seam (StoaAccountsTab), stubbed so the
 * specs stay hermetic.
 */

import * as React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { setPactReader } from "@stoachain/stoa-core/reads";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useStoaChainSeeds } from "@ancientpantheon/codex-ouronet/hooks";
import { ChainwebPanel } from "@ancientpantheon/codex-ouronet/ui";
import type { IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

// 2026-09-26 — Kadena mode's reads bypass `pactRead` entirely (see
// `kadenaReads.ts`'s own doc comment); mock its `createClient` seam the
// same way `kadena-reads.test.ts`/`ui-stoa-accounts-tab.test.tsx` do so a
// click into Kadena mode never attempts a real network call here.
const { kadenaDirtyRead } = vi.hoisted(() => ({ kadenaDirtyRead: vi.fn() }));
vi.mock("@stoachain/kadena-stoic-legacy/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoachain/kadena-stoic-legacy/client")>();
  return { ...actual, createClient: () => ({ dirtyRead: kadenaDirtyRead }) };
});

// Stub the read seam so StoaAccountsTab's live-balance effect never hits network.
beforeEach(() => {
  setPactReader(async () => ({ result: { data: [] } }) as never);
  kadenaDirtyRead.mockReset().mockResolvedValue({ result: { status: "success", data: [] } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

/** Mounts the panel exactly as `ForeignChainsTab` does: the chain-agnostic
 *  `PanelProps` pair, both of which the panel ignores. */
async function renderPanel() {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

class FakeResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ contentRect: { width: FakeResizeObserver.nextWidth } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
    void target;
  }
  unobserve() {}
  disconnect() {}
  static nextWidth = 1024;
}

async function renderPanelMobile() {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <CodexUiRoot>
        <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
      </CodexUiRoot>
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

/** Seeds one Chainweb seed (with a single account) into the codex before the
 *  panel mounts — used only by the accounts-count relocation specs below,
 *  which need a non-zero `StoaAccountsTab` total to assert on. */
function Seeder({ seeds }: { seeds: IStoaChainSeed[] }) {
  const { addSeed } = useStoaChainSeeds();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (!isReady) return;
    seeds.forEach((s) => void addSeed(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderPanelMobileWithSeed() {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");
  const seeds: IStoaChainSeed[] = [
    {
      id: "s1",
      name: "My Seed",
      seedType: "koala",
      version: "1.0.0",
      index: 0,
      secret: "enc",
      main: "k:" + "0".repeat(64),
      createdAt: "2026-05-25T10:00:00.000Z",
      accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }],
    },
  ];
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <Seeder seeds={seeds} />
      <CodexUiRoot>
        <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
      </CodexUiRoot>
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

describe("<ChainwebPanel>", () => {
  it("renders the three Chainweb categories", async () => {
    await renderPanel();
    expect(screen.getByRole("tab", { name: "Seeds" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Pure Keys" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Accounts" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("lands on Accounts, mounting the Stoa accounts surface", async () => {
    await renderPanel();
    expect(screen.getByRole("tab", { name: "Accounts" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/total addresses/i)).toBeTruthy();
    // Neither of the other two surfaces is mounted.
    expect(screen.queryByText(/no seeds in the codex/i)).toBeNull();
    expect(screen.queryByText(/no pure keypairs yet/i)).toBeNull();
  });

  it("mounts the seed-words surface when Seeds is selected", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Seeds" }));
    expect(await screen.findByText(/no seeds in the codex/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Seeds" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText(/total addresses/i)).toBeNull();
  });

  it("mounts the pure-keypairs surface when Pure Keys is selected", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Seeds" }));
    fireEvent.click(screen.getByRole("tab", { name: "Pure Keys" }));
    expect(await screen.findByText(/no pure keypairs yet/i)).toBeTruthy();
    expect(screen.queryByText(/no seeds in the codex/i)).toBeNull();
  });
});

describe("<ChainwebPanel> — mobile: icon-only, centered, single-line category row (design.md §8, the 'Blockchain Accounts' cleanup round)", () => {
  it("renders the three categories as icon-only buttons, not text-pill tabs", async () => {
    await renderPanelMobile();
    expect(screen.getByRole("button", { name: "Seeds" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pure Keys" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accounts" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("centers the category icon row (nested inside the tablist, which also reserves fixed-width flanks for the Seeds count/+ button)", async () => {
    await renderPanelMobile();
    const seedsBtn = screen.getByRole("button", { name: "Seeds" });
    const iconRow = seedsBtn.parentElement as HTMLElement;
    expect(iconRow.style.justifyContent).toBe("center");
  });

  it("still lands on Accounts by default, and switching categories still mounts the real underlying surfaces", async () => {
    await renderPanelMobile();
    // StoaAccountsTab's own inline Codex/Watched pill is now hidden when
    // driven externally (design.md §8, the "further optimize round 7") —
    // the seam medallion this row renders instead is the thing to assert
    // on ("Codex" by default).
    expect(screen.getByTitle(/^Codex \d+$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(await screen.findByText(/no seeds in the codex/i)).toBeTruthy();
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — still the wrapping text-pill tablist", async () => {
    await renderPanel();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});

describe("<ChainwebPanel> — mobile: seed count + add-seed relocated onto the category row, Seeds-only (design.md §8, the 'optimize each blockchain and tab' round)", () => {
  it("shows the seed count + '+' trigger only while Seeds is the active category", async () => {
    await renderPanelMobile();
    // Lands on Accounts by default — neither the count nor the trigger show.
    expect(screen.queryByLabelText(/create new seed/i)).toBeNull();
    expect(screen.queryByLabelText(/0 seeds/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(screen.getByLabelText(/create new seed/i)).toBeTruthy();
    expect(screen.getByLabelText(/0 seeds/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.queryByLabelText(/create new seed/i)).toBeNull();
  });

  it("the relocated '+' button opens SeedWordsTab's OWN create-seed modal (controlled prop wiring actually works, not just a decorative button)", async () => {
    await renderPanelMobile();
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    fireEvent.click(screen.getByLabelText(/create new seed/i));
    // CreateStoaChainSeedModal renders once `createOpen` flips true — assert
    // via its dialog role rather than any Arweave/Chainweb-specific text, so
    // this stays robust to that modal's own internal copy.
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("SeedWordsTab's own mobile header (the 'Total N Seeds' text row) is gone — it moved here", async () => {
    await renderPanelMobile();
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(screen.queryByText(/Total \d+ Seeds?/i)).toBeNull();
  });
});

describe("<ChainwebPanel> — mobile: accounts count relocated onto the category row, Accounts-only (design.md §8, the 'further optimize' round)", () => {
  it("shows '0' on landing (Accounts is default, codex starts empty)", async () => {
    await renderPanelMobile();
    expect(screen.getByLabelText(/0 addresses/i)).toBeTruthy();
  });

  it("reflects StoaAccountsTab's real (deduped Codex+Watched) total once the codex has an account — not a duplicated/independent count", async () => {
    await renderPanelMobileWithSeed();
    expect(await screen.findByLabelText(/1 address\b/i)).toBeTruthy();
  });

  it("disappears when switching away from Accounts, and reappears switching back", async () => {
    await renderPanelMobileWithSeed();
    expect(await screen.findByLabelText(/1 address\b/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(screen.queryByLabelText(/address/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(await screen.findByLabelText(/1 address\b/i)).toBeTruthy();
  });

  it("shows the composition as 'm/n+x' (m = accounts from seeds, n = seed count, x = direct/pure-keypair accounts) — owner correction: 'my codex already holds 60 accounts over 12 seeds, which... we should be displaying as m/n+x... instead of simply 60'", async () => {
    // renderPanelMobileWithSeed's fixture: 1 seed, 1 account on it, 0 pure
    // keypairs → m=1 (1 account from that seed), n=1 (1 seed), x=0 (no
    // direct/pure-keypair accounts).
    await renderPanelMobileWithSeed();
    const badge = await screen.findByLabelText(/1 address\b/i);
    expect(badge.textContent).toBe("1/1+0");
  });
});

describe("<ChainwebPanel> — mobile: refresh button relocated onto the category row, Accounts-only (design.md §8, the 'further optimize round 2' — owner correction: 'move the refresh button' up here)", () => {
  it("shows the refresh button only while Accounts is the active category", async () => {
    await renderPanelMobile();
    // Lands on Accounts by default.
    expect(await screen.findByLabelText(/refresh balances/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(screen.queryByLabelText(/refresh balances/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(await screen.findByLabelText(/refresh balances/i)).toBeTruthy();
  });

  it("StoaAccountsTab's OWN mobile summary row no longer has a refresh button — it moved here", async () => {
    await renderPanelMobile();
    // The relocated button (this row) exists exactly once — not duplicated
    // between here and the summary row below it.
    expect(await screen.findAllByLabelText(/refresh balances/i)).toHaveLength(1);
  });

  it("clicking it calls the REAL active-hook refresh (controlled-prop wiring actually works, not a decorative button)", async () => {
    let coinReadCount = 0;
    setPactReader(async (code: string) => {
      if (code.includes("coin.get-balance")) coinReadCount++;
      return { result: { data: [] } } as never;
    });
    // Needs at least one address, or `useStoaChainBalances` never issues a
    // read at all (its own empty-address-list guard) — nothing to refresh.
    await renderPanelMobileWithSeed();
    await waitFor(() => expect(coinReadCount).toBeGreaterThan(0));
    const before = coinReadCount;
    fireEvent.click(await screen.findByLabelText(/refresh balances/i));
    await waitFor(() => expect(coinReadCount).toBeGreaterThan(before));
  });
});

describe("<ChainwebPanel> — mobile: forwards fullScreenPortalTarget to BOTH SeedWordsTab and StoaAccountsTab (design.md §8, the 'further optimize round 3')", () => {
  it("a seed's full-screen detail portals into the supplied target when Seeds is active", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const seeds: IStoaChainSeed[] = [
      {
        id: "s1",
        name: "My Seed",
        seedType: "koala",
        version: "1.0.0",
        index: 0,
        secret: "enc",
        main: "k:" + "0".repeat(64),
        createdAt: "2026-05-25T10:00:00.000Z",
        accounts: [],
      },
    ];
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} fullScreenPortalTarget={target} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    const card = (await screen.findByText("Prime Codex Seed")).closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    expect(target.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);

    document.body.removeChild(target);
  });
});

describe("<ChainwebPanel> — mobile: scroll-snap on the category content wrapper (design.md §8, the 'further optimize round 5' — owner correction: 'we show only full entry pieces')", () => {
  it("the scrollable content wrapper has scroll-snap enabled (inert unless a category's own rows opt in via scrollSnapAlign)", async () => {
    const { container } = await renderPanelMobile();
    const tabpanel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    const scroller = tabpanel.parentElement as HTMLElement;
    expect(scroller.style.scrollSnapType).toBe("y mandatory");
  });
});

describe("<ChainwebPanel> — mobile: seam medallions (design.md §8, the 'further optimize round 7' — owner correction: 'we have two stripe double button medallions, the codex/watched and stoa urstoa... i would place this on top the upper border of the zone, half in half out')", () => {
  it("shows the Codex/Watched medallion top-left and the Stoa/UrStoa medallion top-right, Accounts-only, as a real two-segment pill (both options always visible)", async () => {
    await renderPanelMobile();
    // Not portaled here (no zone3AnchorTarget supplied) — the local
    // fallback anchors to the bar's own top border directly.
    const codexPill = screen.getByTitle(/^Codex \d+$/).parentElement as HTMLElement;
    const stoaPill = screen.getByTitle("Stoa").parentElement as HTMLElement;
    expect(codexPill.style.position).toBe("absolute");
    expect(codexPill.style.top).toBe("0px");
    expect(codexPill.style.left).toBe("20px");
    expect(stoaPill.style.position).toBe("absolute");
    expect(stoaPill.style.top).toBe("0px");
    expect(stoaPill.style.right).toBe("20px");
    // Both segments of BOTH pills coexist — owner correction: "they must be
    // like before split in two parts... not like they are now [a single
    // cycling label], which is a regression of what we had before."
    expect(screen.getByTitle("Stoa")).toBeTruthy();
    expect(screen.getByTitle("UrStoa")).toBeTruthy();

    // Gone entirely when Seeds is active.
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(screen.queryByTitle(/^Codex \d+$/)).toBeNull();
    expect(screen.queryByTitle("Stoa")).toBeNull();
  });

  it("both pills stay pointer-events: auto even though they portal into the pointer-events: none zone3AnchorTarget — owner correction: 'the upper medalions are also not working, when i click them nothing happens'", async () => {
    const railTarget = document.createElement("div");
    railTarget.style.pointerEvents = "none";
    document.body.appendChild(railTarget);
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} zone3AnchorTarget={railTarget} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

    const codexPill = screen.getByTitle(/^Codex \d+$/).parentElement as HTMLElement;
    const stoaPill = screen.getByTitle("Stoa").parentElement as HTMLElement;
    expect(codexPill.style.pointerEvents).toBe("auto");
    expect(stoaPill.style.pointerEvents).toBe("auto");

    document.body.removeChild(railTarget);
  });

  it("tapping the Watched segment directly selects it and drives StoaAccountsTab's own subtab (a real two-button pick, not a cycling toggle)", async () => {
    await renderPanelMobileWithSeed();
    fireEvent.click(screen.getByTitle(/^Watched \d+$/));
    // Both segments are still there afterwards — nothing disappears.
    expect(screen.getByTitle(/^Codex \d+$/)).toBeTruthy();
    expect(screen.getByTitle(/^Watched \d+$/)).toBeTruthy();
    // StoaAccountsTab's own list now shows the Watched empty state.
    expect(await screen.findByText(/no watched addresses/i)).toBeTruthy();
  });

  it("the Codex/Watched pill's two segments carry the exact same count designation as before — owner correction: 'it must contain the exact designation as before, you shortened them'", async () => {
    await renderPanelMobileWithSeed();
    expect(await screen.findByTitle("Codex 1")).toBeTruthy();
    expect(screen.getByTitle("Watched 0")).toBeTruthy();
  });

  it("tapping the UrStoa segment directly selects it (active segment fills solid)", async () => {
    await renderPanelMobile();
    const stoaBtn = screen.getByTitle("Stoa");
    const urstoaBtn = await screen.findByTitle("UrStoa");
    expect(stoaBtn.style.backgroundColor).toBe("rgb(206, 172, 95)"); // #ceac5f, initially active
    expect(urstoaBtn.style.backgroundColor).toBe("transparent");
    fireEvent.click(urstoaBtn);
    expect(urstoaBtn.style.backgroundColor).toBe("rgb(206, 172, 95)");
    expect(stoaBtn.style.backgroundColor).toBe("transparent");
  });

  it("portals the top two medallions into a supplied zone3AnchorTarget (design.md §8, the medallion-clipping fix) — they must poke above Zone 3's own scroll boundary, which clips anything positioned locally, and land on that target's OWN top border exactly (owner correction: 'you placed them one level to high' — Zone 2's own bottom, used before, sits a notch too high)", async () => {
    const railTarget = document.createElement("div");
    document.body.appendChild(railTarget);
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} zone3AnchorTarget={railTarget} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

    const codexMedallion = screen.getByTitle(/^Codex \d+$/);
    const stoaMedallion = screen.getByTitle("Stoa");
    expect(railTarget.contains(codexMedallion)).toBe(true);
    expect(railTarget.contains(stoaMedallion)).toBe(true);
    expect(container.contains(codexMedallion)).toBe(false);
    expect(container.contains(stoaMedallion)).toBe(false);

    const codexPill = codexMedallion.parentElement as HTMLElement;
    const stoaPill = stoaMedallion.parentElement as HTMLElement;
    expect(codexPill.style.top).toBe("0px");
    expect(codexPill.style.bottom).toBe("");
    expect(stoaPill.style.top).toBe("0px");

    document.body.removeChild(railTarget);
  });

  // Round 11 owner correction removed Collapse-All from mobile entirely
  // (the Codex Accounts list is now a flat, fixed-height, seed-badged list
  // — see `StoaAccountsTab`'s own `codexFlatEntries` doc comment — so
  // there's nothing left to collapse). The bottom-seam medallion slot this
  // used to contend with pagination for is now UNCONDITIONALLY
  // pagination's — see the "standard pagination controls zone" describe
  // block below, including its own zone3AnchorTarget-portaling coverage
  // (which subsumes what a Collapse-All-specific portaling test used to
  // check here).
  it("no Collapse-All-ish control (by title or text) ever renders, regardless of group count", async () => {
    const seeds: IStoaChainSeed[] = [
      {
        id: "s1", name: "Seed A", seedType: "koala", version: "1.0.0", index: 0, secret: "enc",
        main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z",
        accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }],
      },
      {
        id: "s2", name: "Seed B", seedType: "koala", version: "1.0.0", index: 0, secret: "enc",
        main: "k:" + "1".repeat(64), createdAt: "2026-05-25T10:00:00.000Z",
        accounts: [{ index: 0, publicKey: "b".repeat(64), derivationPath: "m/0" }],
      },
    ];
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
    await waitFor(() => expect(screen.getAllByText("Key #0").length).toBe(2));
    expect(screen.queryByText("Collapse")).toBeNull();
    expect(screen.queryByText("Expand")).toBeNull();
    expect(screen.queryByTitle(/collapse all|expand all/i)).toBeNull();
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — no medallions at all", async () => {
    await renderPanel();
    expect(screen.queryByTitle("Codex")).toBeNull();
    expect(screen.queryByTitle("Stoa")).toBeNull();
  });
});

describe("<ChainwebPanel> — mobile: the shared 'standard pagination controls zone' (round 9 — owner correction: 'we also need to agree on a standard pagination controls zone. If no expand collapse medallion exists at the middle of the bottom page... that's where the pagination controls should be in their own medallion with prev and next buttons, which should be simple square and with arrows, instead of the name')", () => {
  /** `n` accounts on one seed. */
  const nAccounts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ index: i, publicKey: String.fromCharCode(97 + i).repeat(64), derivationPath: `m/${i}` }));

  it("a SINGLE-group Accounts view (no Collapse-All medallion) shows the pagination medallion in the SAME bottom-center slot instead, with square Prev/Next arrow buttons — and Next actually advances", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const seeds: IStoaChainSeed[] = [
      {
        id: "s1", name: "Big Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc",
        main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z",
        accounts: nAccounts(6),
      },
    ];
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

    // No Collapse-All medallion — a single group has nothing to collapse.
    expect(screen.queryByText("Collapse")).toBeNull();
    // The pagination medallion takes the shared slot instead — square
    // arrow buttons (no "Prev"/"Next" text), a clickable "N / M" center.
    const prevBtn = await screen.findByRole("button", { name: "Previous page" });
    const nextBtn = screen.getByRole("button", { name: "Next page" });
    expect(prevBtn.textContent).toBe("");
    expect(nextBtn.textContent).toBe("");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.click(nextBtn);
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
  });

  it("a MULTI-group Accounts view ALSO shows the pagination medallion in the shared slot (round 11 — no more Collapse-All to contend for it)", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const seeds: IStoaChainSeed[] = [
      { id: "s1", name: "Seed A", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(4) },
      { id: "s2", name: "Seed B", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "1".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(4) },
    ];
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

    // 8 flat entries (no header cost anymore) / 4 per page = 2 pages —
    // the medallion-style square Prev/Next shows here now, same as a
    // single-group view would.
    expect(screen.queryByText("Collapse")).toBeNull();
    await screen.findByRole("button", { name: "Previous page" });
    const nextBtn = screen.getByRole("button", { name: "Next page" });
    expect(screen.getByText("1 / 2")).toBeTruthy();
    fireEvent.click(nextBtn);
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
  });

  it("the Seeds view NEVER has a Collapse-All medallion — its own pagination always takes the shared slot when it has more than one page", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const seeds: IStoaChainSeed[] = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i}`, name: `Seed ${i}`, seedType: "koala" as const, version: "1.0.0", index: 0, secret: "enc",
      main: `k:${String(i).padStart(64, "0")}`, createdAt: "2026-05-25T10:00:00.000Z", accounts: [],
    }));
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
    fireEvent.click(screen.getByRole("button", { name: /seeds/i }));

    const prevBtn = await screen.findByRole("button", { name: "Previous page" });
    const nextBtn = screen.getByRole("button", { name: "Next page" });
    expect(prevBtn.textContent).toBe("");
    expect(nextBtn.textContent).toBe("");
    fireEvent.click(nextBtn);
    await waitFor(() => expect(document.querySelectorAll("[data-seed-id]").length).toBe(4));
  });

  it("past 10 pages, the medallion's center number becomes a clickable jump control", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const seeds: IStoaChainSeed[] = [
      { id: "s1", name: "Big Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(44) },
    ];
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

    // Round 11 — flat entries, no header cost: 44 accounts / 4 per page = 11 pages.
    const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
    fireEvent.click(jumpBtn);
    const input = screen.getByLabelText(/jump to page/i);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("9 / 11")).toBeTruthy());
  });

  it("portals the pagination medallion into a supplied zone3AnchorTarget, landing on that target's OWN bottom border, same as the Collapse-All medallion", async () => {
    const railTarget = document.createElement("div");
    document.body.appendChild(railTarget);
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const seeds: IStoaChainSeed[] = [
      { id: "s1", name: "Big Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(6) },
    ];
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <ChainwebPanel id="chainweb" ctx={{ opaque: true }} zone3AnchorTarget={railTarget} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

    const nextBtn = await screen.findByRole("button", { name: "Next page" });
    expect(railTarget.contains(nextBtn)).toBe(true);
    expect(container.contains(nextBtn)).toBe(false);
    const pill = nextBtn.closest("div[style*='border-radius: 9999px']") as HTMLElement;
    expect(pill.style.position).toBe("absolute");
    expect(pill.style.bottom).toBe("0px");

    document.body.removeChild(railTarget);
  });

  // Round 15 owner correction: "i noticed the pages are swapable, but
  // there are no swap bullets displayed, did you miss them?" — round 11
  // added the swipe GESTURE but never its visual position indicator.
  describe("swipe bullets — the pagination medallion's own page-position dots", () => {
    it("shows one dot per page (no ellipsis) when the page count fits within the window", async () => {
      FakeResizeObserver.nextWidth = 390;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      const adapter = new MemoryCodexAdapter("dev");
      const seeds: IStoaChainSeed[] = [
        { id: "s1", name: "Big Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(6) },
      ];
      render(
        <CodexProvider adapter={adapter}>
          <ReadyGate />
          <Seeder seeds={seeds} />
          <CodexUiRoot>
            <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
          </CodexUiRoot>
        </CodexProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

      // 6 accounts / 4 per page = 2 pages — well within the 7-dot window.
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByRole("tab").length).toBe(2);
      expect(within(tablist).getByRole("tab", { name: "Go to page 1" }).getAttribute("aria-selected")).toBe("true");
      expect(within(tablist).queryByText("…")).toBeNull();

      fireEvent.click(within(tablist).getByRole("tab", { name: "Go to page 2" }));
      await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
      expect(within(tablist).getByRole("tab", { name: "Go to page 2" }).getAttribute("aria-selected")).toBe("true");
    });

    it("truncates with a TRAILING ellipsis when starting near the first page of a long list", async () => {
      FakeResizeObserver.nextWidth = 390;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      const adapter = new MemoryCodexAdapter("dev");
      const seeds: IStoaChainSeed[] = [
        { id: "s1", name: "Big Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(44) },
      ];
      render(
        <CodexProvider adapter={adapter}>
          <ReadyGate />
          <Seeder seeds={seeds} />
          <CodexUiRoot>
            <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
          </CodexUiRoot>
        </CodexProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

      // 44 / 4 = 11 pages — past the 7-dot window. Starting on page 1, the
      // window can't reach backward at all, so only a TRAILING "…" shows.
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByRole("tab").length).toBe(7);
      expect(within(tablist).getAllByText("…").length).toBe(1);
      expect(within(tablist).getByRole("tab", { name: "Go to page 1" }).getAttribute("aria-selected")).toBe("true");
    });

    it("shows BOTH a leading and a trailing ellipsis once the window sits in the middle of a long list", async () => {
      FakeResizeObserver.nextWidth = 390;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      const adapter = new MemoryCodexAdapter("dev");
      const seeds: IStoaChainSeed[] = [
        { id: "s1", name: "Big Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(44) },
      ];
      render(
        <CodexProvider adapter={adapter}>
          <ReadyGate />
          <Seeder seeds={seeds} />
          <CodexUiRoot>
            <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
          </CodexUiRoot>
        </CodexProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

      const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
      fireEvent.click(jumpBtn);
      fireEvent.change(screen.getByLabelText(/jump to page/i), { target: { value: "6" } });
      fireEvent.keyDown(screen.getByLabelText(/jump to page/i), { key: "Enter" });
      await waitFor(() => expect(screen.getByText("6 / 11")).toBeTruthy());

      const tablist = screen.getByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByText("…").length).toBe(2);
      expect(within(tablist).getByRole("tab", { name: "Go to page 6" }).getAttribute("aria-selected")).toBe("true");
    });

    it("portals alongside the arrows/jump pill, straddling the SAME border a step further down", async () => {
      const railTarget = document.createElement("div");
      document.body.appendChild(railTarget);
      FakeResizeObserver.nextWidth = 390;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      const adapter = new MemoryCodexAdapter("dev");
      const seeds: IStoaChainSeed[] = [
        { id: "s1", name: "Big Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc", main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z", accounts: nAccounts(6) },
      ];
      render(
        <CodexProvider adapter={adapter}>
          <ReadyGate />
          <Seeder seeds={seeds} />
          <CodexUiRoot>
            <ChainwebPanel id="chainweb" ctx={{ opaque: true }} zone3AnchorTarget={railTarget} />
          </CodexUiRoot>
        </CodexProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));

      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(railTarget.contains(tablist)).toBe(true);
      expect(tablist.style.position).toBe("absolute");
      expect(tablist.style.bottom).toBe("0px");

      document.body.removeChild(railTarget);
    });
  });
});

describe("ChainwebPanel — the Network switch (2026-09-26, owner: 'how do i switch to kadena when i have chainweb as selected blockchain')", () => {
  /** Scopes to THIS panel's own Network switch specifically — StoaAccountsTab
   *  mounts its OWN, separate "Stoa"/"Kadena"(-morphed) pill at the same
   *  time, so a bare `screen.getByRole("button", {name: "Stoa"})` matches
   *  both. The switch is the one preceded by the "Network" label text. */
  function getNetworkSwitch() {
    const label = screen.getByText("Network");
    return within(label.parentElement as HTMLElement);
  }

  it("shows a Stoa/Kadena network switch on the landing Accounts category, defaulting to Stoa", async () => {
    await renderPanel();
    const netSwitch = getNetworkSwitch();
    expect(netSwitch.getByRole("button", { name: "Stoa" })).toBeTruthy();
    expect(netSwitch.getByRole("button", { name: "Kadena" })).toBeTruthy();
    expect(netSwitch.getByRole("button", { name: "Stoa" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking Kadena flips the switch and morphs StoaAccountsTab's own Stoa/UrStoa pill", async () => {
    await renderPanel();
    fireEvent.click(getNetworkSwitch().getByRole("button", { name: "Kadena" }));

    await waitFor(() =>
      expect(getNetworkSwitch().getByRole("button", { name: "Kadena" }).getAttribute("aria-pressed")).toBe("true"),
    );
    // StoaAccountsTab's OWN balance-source pill (a separate control) morphs
    // its "Stoa" segment to "Kadena" naming too — see that component's own
    // `activeNetwork` prop doc comment. Two "Kadena" buttons now exist:
    // this panel's own switch, plus the morphed pill.
    const kadenaButtons = screen.getAllByRole("button", { name: "Kadena" });
    expect(kadenaButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("switching to Kadena issues reads through kadenaReads' own client, never stoa-core's pactRead", async () => {
    // useKadenaBalances (like useStoaChainBalances) short-circuits to no
    // network call at all for an empty address list — seed one account so
    // there's something to actually read.
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <Seeder
          seeds={[{
            id: "s1", name: "My Seed", seedType: "koala", version: "1.0.0", index: 0, secret: "enc",
            main: "k:" + "0".repeat(64), createdAt: "2026-05-25T10:00:00.000Z",
            accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }],
          }]}
        />
        <ChainwebPanel id="chainweb" ctx={{ opaque: true }} />
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
    fireEvent.click(getNetworkSwitch().getByRole("button", { name: "Kadena" }));
    await waitFor(() => expect(kadenaDirtyRead).toHaveBeenCalled());
  });
});
