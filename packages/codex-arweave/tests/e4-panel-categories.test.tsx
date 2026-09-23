/**
 * The Arweave panel's CATEGORY menu (Class IA restructure).
 *
 * Pins the five-category vocabulary the Class 2 shell presents for Arweave —
 * Seeds · Pure Keys · Accounts · Upload · Library — and the fact that every one
 * of them is currently an EXPLICIT EMPTY placeholder.
 *
 * The categories previously mounted demo/mock surfaces (KeyringArea, BalanceArea,
 * SendArea, UploadArea, LibraryArea). Those were removed deliberately: they are
 * being replaced with real wiring one category at a time, Seeds first. The area
 * components still exist and keep their own direct specs, so this file does NOT
 * assert them — it asserts the menu and that no category ever renders blank or
 * throws while it waits its turn.
 *
 * Each case guards a user-visible regression: a category vanishing from the menu
 * makes it unreachable; a blank body reads as a bug rather than as "pending".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import { ArweavePanel } from "../src/panel/ArweavePanel";
import { ArweavePanelProvider, type ArweavePanelDeps } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import type { LibraryEntry, LibraryStore } from "../src/library/types";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;
const fakePool = { pick: () => ARWEAVE_ADDRESS } as unknown as GatewayPool;

/** The five categories in display order, with the labels the rail renders. */
const CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ["seeds", "Seeds"],
  ["pure-keys", "Pure Keys"],
  ["accounts", "Accounts"],
  ["upload", "Upload"],
  ["library", "Library"],
];

function makeEntry(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: ARWEAVE_ADDRESS,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: "CIPHERTEXT-NOT-A-JWK",
    label: "My Arweave key",
    ...overrides,
  };
}

function makeLibraryStore(): LibraryStore {
  return {
    append: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    updateStatus: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  } as unknown as LibraryStore;
}

/** The injected E1-E3 seam bundle — fakes throughout. */
function makeDeps(overrides: Partial<ArweavePanelDeps> = {}): ArweavePanelDeps {
  const libraryRows: LibraryEntry[] = [];
  return {
    address: ARWEAVE_ADDRESS,

    foreignKeys: [makeEntry()],
    keygenRunner: {
      runKeygen: vi.fn(async () => fixtureJwk),
    },
    generateArweaveKey: vi.fn(async () => makeEntry()),
    importArweaveKey: vi.fn(async () => makeEntry()),
    decryptArweaveKey: vi.fn(async () => fixtureJwk),
    addForeignKey: vi.fn(async () => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),

    getBalance: vi.fn(async () => 1_500_000_000_000n),
    send: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 1_000_000n })),
    sendFrom: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 1_000_000n })),
    estimateFee: vi.fn(async () => 100_000_000n),
    pollStatus: vi.fn(async () => "final" as const),

    uploadAndTrack: vi.fn(async () => ({
      id: "uploaded-item-id-000000000000000000000000000",
      itemId: "codex-item-1",
      ownerAddress: ARWEAVE_ADDRESS,
      tags: [],
    })),
    listLibrary: vi.fn(async () => libraryRows),
    openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
    rebuildLibrary: vi.fn(async () => {}),
    libraryStore: makeLibraryStore(),
    pool: fakePool,

    addressBook: [
      { id: "ab-1", name: "Alice (AR)", address: ARWEAVE_ADDRESS, chainId: ARWEAVE_CHAIN_ID },
    ],

    ...overrides,
  };
}

function renderPanel(overrides: Partial<ArweavePanelDeps> = {}) {
  const deps = makeDeps(overrides);
  // `SendArweaveModal` (Accounts category) calls `useEnsureCodexUnlocked`
  // (`codex-ouronet/zbom`), which requires a `<CodexProvider>` ancestor —
  // the SAME one `apps/codex-playground` always wraps `ArweavePanel` in
  // (`ForeignChainsWiring.tsx`: "Must be mounted INSIDE <CodexProvider>").
  const utils = render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <ArweavePanelProvider deps={deps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>
    </CodexProvider>,
  );
  return { deps, ...utils };
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

function renderPanelMobile(overrides: Partial<ArweavePanelDeps> = {}) {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const deps = makeDeps(overrides);
  const utils = render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <ArweavePanelProvider deps={deps}>
        <CodexUiRoot>
          <ArweavePanel id={ARWEAVE_CHAIN_ID} />
        </CodexUiRoot>
      </ArweavePanelProvider>
    </CodexProvider>,
  );
  return { deps, ...utils };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ArweavePanel — the five-category menu", () => {
  beforeEach(() => cleanup());

  it("renders all five categories, in display order, with their labels", () => {
    renderPanel();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(
      CATEGORIES.map(([, label]) => label),
    );
  });

  it("lands on `accounts` so the panel opens on the category a user reaches for first", () => {
    renderPanel();
    expect(screen.getByTestId("arweave-subtab-accounts")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // Seeds, Pure Keys and Accounts are WIRED now (ArweaveSeedsArea /
  // PureKeysArea / ArweaveAccountsArea), so only the two still-unwired
  // categories keep the placeholder body. The wired trio's own coverage lives
  // in tests/e5-seeds-area.test.tsx and tests/e4-panel-pure-keys.test.tsx.
  const UNWIRED = CATEGORIES.filter(
    ([id]) => id !== "seeds" && id !== "accounts" && id !== "pure-keys",
  );

  it.each(UNWIRED)(
    "renders a visible 'not wired yet' body for `%s` — never blank, never a throw",
    (id, label) => {
      renderPanel();
      fireEvent.click(screen.getByTestId(`arweave-subtab-${id}`));
      const body = screen.getByTestId(`arweave-category-empty-${id}`);
      // Visible copy, naming the category, so the state reads as pending work
      // rather than as a broken panel.
      expect(body.textContent).toContain(label);
      expect(body.textContent).toMatch(/not wired yet/i);
    },
  );

  it("threads deps all the way to Accounts so its Send button is actually reachable (not just present on the component)", () => {
    // Regression guard: ArweaveAccountsArea's `deps` prop can exist and be
    // fully tested in isolation while ArweavePanel simply never passes it
    // down — the Send button then silently never renders in the real app.
    // This mounts the real ArweavePanel (not ArweaveAccountsArea directly)
    // with real deps and checks the button is actually there.
    renderPanel();
    expect(
      screen.getByTestId(`arweave-account-send-${ARWEAVE_ADDRESS}`),
    ).toBeInTheDocument();
  });

  it("shows exactly one category body at a time (switching away unmounts the last)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.getByTestId("arweave-category-empty-upload")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    expect(screen.queryByTestId("arweave-category-empty-upload")).toBeNull();
    expect(screen.getByTestId("arweave-category-empty-library")).toBeInTheDocument();
  });
});

describe("ArweavePanel — mobile: icon-only, centered, single-line category row (design.md §8, the 'Blockchain Accounts' cleanup round)", () => {
  beforeEach(() => cleanup());

  it("renders all five categories as icon-only buttons, not text-pill tabs", () => {
    renderPanelMobile();
    for (const [, label] of CATEGORIES) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("centers the category row", () => {
    renderPanelMobile();
    // Round 9's "standard pagination controls zone" reserved left/right
    // slots (a seed/address count, a refresh button) on the OUTER tablist
    // row — the actual centered icon group now lives in an inner wrapper
    // (`flex: 1, justifyContent: center`) so those reserved slots don't
    // skew the centering.
    const keysBtn = screen.getByRole("button", { name: "Seeds" });
    const row = keysBtn.parentElement as HTMLElement;
    expect(row.style.justifyContent).toBe("center");
  });

  it("still switches categories via the SAME generation-guard-aware requestCategory path — e.g. lands on an unwired category's empty body", () => {
    renderPanelMobile();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByTestId("arweave-category-empty-upload")).toBeInTheDocument();
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — still the wrapping text-pill tablist", () => {
    renderPanel();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });
});

// Round 20 owner correction: "add arweave seed must be similar to how
// chainwebs seed is added wit ha plus button in the upper line aligned
// right" — mirrors `ChainwebPanel.tsx`'s own "+" in the same tablist
// right-slot, wired from `ArweaveSeedsArea`'s reported `openDefine` handle.
describe("ArweavePanel — mobile: the relocated Seeds '+' add-seed button (round 20)", () => {
  beforeEach(() => cleanup());

  it("shows a '+' add-seed button only while the Seeds category is active", () => {
    renderPanelMobile();
    // Default category is Accounts — no add-seed button yet.
    expect(screen.queryByTestId("arweave-mobile-add-seed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(screen.getByTestId("arweave-mobile-add-seed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.queryByTestId("arweave-mobile-add-seed")).toBeNull();
  });

  it("clicking it opens the SAME define-seed form the (desktop-only, on mobile) bottom button opens", () => {
    renderPanelMobile();
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    fireEvent.click(screen.getByTestId("arweave-mobile-add-seed"));
    expect(screen.getByTestId("arweave-seed-define-form")).toBeInTheDocument();
  });

  it("desktop shows no such button in the tablist — it keeps its own bottom 'Add Arweave Seed' button instead", () => {
    // A Prime seed must already exist, or `ArweaveSeedsArea` shows its
    // "define your first seed" state instead of the normal list + bottom
    // button — orthogonal to this test's concern (mobile-vs-desktop).
    // `arweaveSeeds` is a real runtime seam (`ArweavePanel.tsx`'s own
    // `ArweaveSeedStoreSeams`, read via a cast) that isn't part of the
    // narrower `ArweavePanelDeps` type this file's `makeDeps` is typed
    // against — cast through a local so the excess-property check doesn't
    // block a field the component genuinely reads.
    const overrides = { arweaveSeeds: [{ id: "prime", label: "Prime Arweave Seed", bits: "1".repeat(1600), isPrime: true }] };
    renderPanel(overrides as Partial<ArweavePanelDeps>);
    fireEvent.click(screen.getByRole("tab", { name: /seeds/i }));
    expect(screen.queryByTestId("arweave-mobile-add-seed")).toBeNull();
    expect(screen.getByTestId("arweave-add-seed")).toBeTruthy();
  });
});

describe("ArweavePanel — mobile: the shared 'standard pagination controls zone' (round 9 — owner correction: 'we also need to agree on a standard pagination controls zone. If no expand collapse medallion exists at the middle of the bottom page... that's where the pagination controls should be in their own medallion with prev and next buttons, which should be simple square and with arrows, instead of the name'). Mirrors ChainwebPanel's own identical round-9 correction.", () => {
  beforeEach(() => cleanup());

  /** `n` distinct Arweave keys, all under the SAME (single, implicit
   *  "Unassigned") group — a single group means no Collapse-All medallion. */
  function manyKeys(n: number): ForeignKeyEntry[] {
    return Array.from({ length: n }, (_, i) => makeEntry({
      id: `key-${i}`,
      address: `ADDR-${String(i).padStart(4, "0")}`,
    }));
  }

  it("a single-group Accounts view (no Collapse-All medallion) shows the pagination medallion in the shared bottom-center slot, with square Prev/Next arrow buttons — and Next actually advances", async () => {
    renderPanelMobile({ foreignKeys: manyKeys(6) });
    // No Collapse-All medallion — a single (Unassigned) group has nothing
    // to collapse.
    expect(screen.queryByText("Collapse")).toBeNull();
    const prevBtn = await screen.findByRole("button", { name: "Previous page" });
    const nextBtn = screen.getByRole("button", { name: "Next page" });
    expect(prevBtn.textContent).toBe("");
    expect(nextBtn.textContent).toBe("");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.click(nextBtn);
    expect(await screen.findByText("2 / 2")).toBeTruthy();
  });

  it("past 10 pages, the medallion's center number becomes a clickable jump control", async () => {
    renderPanelMobile({ foreignKeys: manyKeys(44) });
    // Round 11 — flat entries, no header cost anymore: 44 entries / 4 per
    // page = 11 pages.
    const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
    fireEvent.click(jumpBtn);
    const input = screen.getByLabelText(/jump to page/i);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("9 / 11")).toBeTruthy();
  });

  it("portals the pagination medallion into a supplied zone3AnchorTarget, landing on that target's OWN bottom border", async () => {
    const railTarget = document.createElement("div");
    document.body.appendChild(railTarget);
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const deps = makeDeps({ foreignKeys: manyKeys(6) });
    const { container } = render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <ArweavePanelProvider deps={deps}>
          <CodexUiRoot>
            <ArweavePanel id={ARWEAVE_CHAIN_ID} zone3AnchorTarget={railTarget} />
          </CodexUiRoot>
        </ArweavePanelProvider>
      </CodexProvider>,
    );
    const nextBtn = await screen.findByRole("button", { name: "Next page" });
    expect(railTarget.contains(nextBtn)).toBe(true);
    expect(container.contains(nextBtn)).toBe(false);

    document.body.removeChild(railTarget);
  });

  // Round 15 owner correction (ported from `ChainwebPanel.tsx`'s identical
  // change): "i noticed the pages are swapable, but there are no swap
  // bullets displayed, did you miss them?" — round 11 added the swipe
  // GESTURE but never its visual position indicator.
  describe("swipe bullets — the pagination medallion's own page-position dots", () => {
    it("shows one dot per page (no ellipsis) when the page count fits within the window", async () => {
      renderPanelMobile({ foreignKeys: manyKeys(6) });
      // 6 keys / 4 per page = 2 pages — well within the 7-dot window.
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByRole("tab").length).toBe(2);
      expect(within(tablist).getByRole("tab", { name: "Go to page 1" }).getAttribute("aria-selected")).toBe("true");
      expect(within(tablist).queryByText("…")).toBeNull();

      fireEvent.click(within(tablist).getByRole("tab", { name: "Go to page 2" }));
      await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
      expect(within(tablist).getByRole("tab", { name: "Go to page 2" }).getAttribute("aria-selected")).toBe("true");
    });

    it("truncates with a TRAILING ellipsis when starting near the first page of a long list", async () => {
      renderPanelMobile({ foreignKeys: manyKeys(44) });
      // 44 / 4 = 11 pages — past the 7-dot window. Starting on page 1, the
      // window can't reach backward at all, so only a TRAILING "…" shows.
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByRole("tab").length).toBe(7);
      expect(within(tablist).getAllByText("…").length).toBe(1);
      expect(within(tablist).getByRole("tab", { name: "Go to page 1" }).getAttribute("aria-selected")).toBe("true");
    });

    it("shows BOTH a leading and a trailing ellipsis once the window sits in the middle of a long list", async () => {
      renderPanelMobile({ foreignKeys: manyKeys(44) });
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
      const deps = makeDeps({ foreignKeys: manyKeys(6) });
      render(
        <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
          <ArweavePanelProvider deps={deps}>
            <CodexUiRoot>
              <ArweavePanel id={ARWEAVE_CHAIN_ID} zone3AnchorTarget={railTarget} />
            </CodexUiRoot>
          </ArweavePanelProvider>
        </CodexProvider>,
      );
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(railTarget.contains(tablist)).toBe(true);
      expect(tablist.style.position).toBe("absolute");
      expect(tablist.style.bottom).toBe("0px");

      document.body.removeChild(railTarget);
    });
  });
});
