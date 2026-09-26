/**
 * StoaAccountsTab specs.
 *
 * Rebuilt tab: a "Total Addresses" header, a Codex/Watched sub-tab toggle, and
 * per-source collapsible groups whose rows each map a seed account / pure
 * keypair to its `k:<publicKey>` Stoa address (carried on a `data-stoa-address`
 * attribute; the visible code is truncated). The first seed is the
 * "Prime Codex Seed". Live per-chain balances flow through the `pactRead` seam,
 * which we stub here so the specs stay hermetic.
 */

import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useStoaChainSeeds, usePureKeypairs, useWatchList } from "@ancientpantheon/codex-ouronet/hooks";
import { StoaAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IStoaChainSeed, IPureKeypair } from "@ancientpantheon/codex-ouronet/types";
import { setPactReader } from "@stoachain/stoa-core/reads";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

// T2/T3 already exhaustively test each modal's own internals — this file only
// needs to know that the right one opens with the right props, so every modal
// is replaced with a minimal stand-in that renders when `isOpen` and exposes
// one button to fire its `onSuccess` callback (used to prove the active
// balance hook's `refresh()` gets called).
vi.mock("../src/ui/internal/TransferUrStoaModal", () => ({
  TransferUrStoaModal: (props: { isOpen: boolean; onClose: () => void; onSuccess?: (rk: string) => void }) =>
    props.isOpen ? (
      <div data-testid="mock-transfer-modal">
        <button data-testid="mock-transfer-success" onClick={() => { props.onSuccess?.("rk-transfer"); props.onClose(); }}>ok</button>
      </div>
    ) : null,
}));
vi.mock("../src/ui/internal/StakeUrStoaModal", () => ({
  StakeUrStoaModal: (props: { isOpen: boolean; onClose: () => void; onSuccess?: (rk: string) => void }) =>
    props.isOpen ? (
      <div data-testid="mock-stake-modal">
        <button data-testid="mock-stake-success" onClick={() => { props.onSuccess?.("rk-stake"); props.onClose(); }}>ok</button>
      </div>
    ) : null,
}));
vi.mock("../src/ui/internal/UnstakeUrStoaModal", () => ({
  UnstakeUrStoaModal: (props: { isOpen: boolean; onClose: () => void; onSuccess?: (rk: string) => void }) =>
    props.isOpen ? (
      <div data-testid="mock-unstake-modal">
        <button data-testid="mock-unstake-success" onClick={() => { props.onSuccess?.("rk-unstake"); props.onClose(); }}>ok</button>
      </div>
    ) : null,
}));
vi.mock("../src/ui/internal/CollectUrStoaModal", () => ({
  CollectUrStoaModal: (props: { isOpen: boolean; onClose: () => void; onSuccess?: (rk: string) => void }) =>
    props.isOpen ? (
      <div data-testid="mock-collect-modal">
        <button data-testid="mock-collect-success" onClick={() => { props.onSuccess?.("rk-collect"); props.onClose(); }}>ok</button>
      </div>
    ) : null,
}));
vi.mock("../src/ui/internal/SendStoaModal", () => ({
  SendStoaModal: (props: { isOpen: boolean; onClose: () => void; onSuccess?: (rk: string) => void }) =>
    props.isOpen ? (
      <div data-testid="mock-send-modal">
        <button data-testid="mock-send-success" onClick={() => { props.onSuccess?.("rk-send"); props.onClose(); }}>ok</button>
      </div>
    ) : null,
}));

// 2026-09-26 — Kadena mode's reads go through `kadenaReads.ts`'s own
// `createClient(url).dirtyRead(tx)` call, entirely independent of the
// `setPactReader` stub above (which only intercepts stoa-core's `pactRead`).
// Mocked here the same way `kadena-reads.test.ts` does, so the Kadena-mode
// describe block below stays hermetic.
const { kadenaDirtyRead } = vi.hoisted(() => ({ kadenaDirtyRead: vi.fn() }));
vi.mock("@stoachain/kadena-stoic-legacy/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoachain/kadena-stoic-legacy/client")>();
  return { ...actual, createClient: () => ({ dirtyRead: kadenaDirtyRead }) };
});

// Stub the read seam so the tab's live-balance effect never touches the network.
beforeEach(() => {
  setPactReader(async () => ({ result: { data: [] } }) as never);
  kadenaDirtyRead.mockReset().mockResolvedValue({ result: { status: "success", data: [] } });
});

const seedFx = (over: Partial<IStoaChainSeed> = {}): IStoaChainSeed => ({
  id: over.id ?? "s1",
  name: over.name ?? "My Seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: "enc",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-25T10:00:00.000Z",
  accounts: over.accounts ?? [],
  ...over,
});

const kpFx = (over: Partial<IPureKeypair> = {}): IPureKeypair => ({
  id: over.id ?? "kp1",
  label: over.label,
  publicKey: over.publicKey ?? "f".repeat(64),
  encryptedPrivateKey: "enc",
  createdAt: "2026-05-25T10:00:00.000Z",
  ...over,
});

function Seeder({ seeds, pairs }: { seeds: IStoaChainSeed[]; pairs: IPureKeypair[] }) {
  const { addSeed } = useStoaChainSeeds();
  const { addKeypair } = usePureKeypairs();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (!isReady) return;
    seeds.forEach((s) => void addSeed(s));
    pairs.forEach((p) => void addKeypair(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(seeds: IStoaChainSeed[] = [], pairs: IPureKeypair[] = []) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder seeds={seeds} pairs={pairs} />
      <StoaAccountsTab />
    </CodexProvider>,
  );
  // The "Total Addresses" header is always present once mounted.
  await waitFor(() => expect(screen.getByText(/Total Addresses/i)).toBeTruthy());
  return utils;
}

describe("<StoaAccountsTab>", () => {
  it("renders the empty state when the codex has no seeds or keys", async () => {
    await renderTab([], []);
    expect(screen.getByText(/No Stoa accounts in the codex/i)).toBeTruthy();
  });

  it("derives a k: address per seed account so the list mirrors useStoaChainSeeds", async () => {
    const { container } = await renderTab([
      seedFx({
        id: "s1",
        name: "Trading",
        accounts: [
          { index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" },
          { index: 1, publicKey: "b".repeat(64), derivationPath: "m/1" },
        ],
      }),
    ]);
    // First (and only) seed surfaces as the Prime Codex Seed group.
    expect(await screen.findByText("Prime Codex Seed")).toBeTruthy();
    // One row per account, each carrying its full k: address on the data attr.
    expect(container.querySelector(`[data-stoa-address="k:${"a".repeat(64)}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-stoa-address="k:${"b".repeat(64)}"]`)).toBeTruthy();
    // Per-account sublabels.
    expect(screen.getByText("Key #0")).toBeTruthy();
    expect(screen.getByText("Key #1")).toBeTruthy();
  });

  it("derives a k: address per pure keypair under a Pure Key Pairs group", async () => {
    const { container } = await renderTab([], [kpFx({ id: "kp1", publicKey: "f".repeat(64) })]);
    expect(await screen.findByText(/Pure Key Pairs/i)).toBeTruthy();
    expect(container.querySelector(`[data-stoa-address="k:${"f".repeat(64)}"]`)).toBeTruthy();
  });
});

describe("<StoaAccountsTab> — Stoa/UrStoa toggle + vault actions", () => {
  const PUBKEY = "a".repeat(64);
  const ADDR = `k:${PUBKEY}`;
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] })];

  it("defaults to Stoa and flips the active toggle button to UrStoa on click", async () => {
    await renderTab(oneSeed);
    const stoaBtn = screen.getByRole("button", { name: "Stoa" });
    const urBtn = screen.getByRole("button", { name: "UrStoa" });
    // Regression this catches: the toggle existing but never actually being
    // wired to the balance-mode state (both buttons would stay inert).
    expect(stoaBtn.getAttribute("aria-pressed")).toBe("true");
    expect(urBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(urBtn);
    await waitFor(() => expect(urBtn.getAttribute("aria-pressed")).toBe("true"));
    expect(stoaBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the UrStoa row as \"{wallet} [{staked}]\" using the same fixed-point formatting as Stoa", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("UR_UR|Balance")) {
        return { result: { data: [{ account: ADDR, balance: 12.5, staked: 3.25, earnings: 0, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTab(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    // Regression this catches: swapping the balance source but forgetting to
    // reuse `fmt12` (the SAME helper Stoa amounts use), or getting the
    // "{wallet} [{staked}]" shape wrong (wrong bracket, wrong field order).
    await waitFor(() => {
      const row = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(row?.textContent).toContain("12.500000000000 [3.250000000000]");
    });
  });

  it("hides the Stake/Unstake/Collect UrStoa vault-action buttons while in Stoa mode, and shows them after toggling", async () => {
    const { container } = await renderTab(oneSeed);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    // Regression this catches: the vault-action buttons showing up regardless
    // of mode (they only make sense once UrStoa balances are the thing shown).
    expect(within(row).queryByTitle("Transfer UrStoa")).toBeNull();
    expect(within(row).queryByTitle("Stake UrStoa")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    await waitFor(() => expect(within(row).getByTitle("Transfer UrStoa")).toBeTruthy());
    expect(within(row).getByTitle("Stake UrStoa")).toBeTruthy();
    expect(within(row).getByTitle("Unstake UrStoa")).toBeTruthy();
    expect(within(row).getByTitle("Collect UrStoa earnings")).toBeTruthy();
  });

  it("shows exactly 4 action buttons (merged Send/Transfer + Stake + Unstake + Collect) in UrStoa mode, and 1 (Send) in Stoa mode", async () => {
    const { container } = await renderTab(oneSeed);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    // Stoa mode: only the merged button, showing "Send".
    expect(within(row).getByTitle("Send STOA")).toBeTruthy();
    expect(within(row).queryByTitle("Transfer UrStoa")).toBeNull();
    expect(within(row).queryByTitle("Stake UrStoa")).toBeNull();
    expect(within(row).queryByTitle("Unstake UrStoa")).toBeNull();
    expect(within(row).queryByTitle("Collect UrStoa earnings")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    // UrStoa mode: the merged button now reads "Transfer", plus Stake/Unstake/Collect.
    await waitFor(() => expect(within(row).getByTitle("Transfer UrStoa")).toBeTruthy());
    expect(within(row).queryByTitle("Send STOA")).toBeNull();
    expect(within(row).getByTitle("Stake UrStoa")).toBeTruthy();
    expect(within(row).getByTitle("Unstake UrStoa")).toBeTruthy();
    expect(within(row).getByTitle("Collect UrStoa earnings")).toBeTruthy();
  });

  it("each of the four UrStoa buttons opens its own matching modal", async () => {
    const { container } = await renderTab(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;

    fireEvent.click(within(row).getByTitle("Transfer UrStoa"));
    expect(screen.getByTestId("mock-transfer-modal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mock-transfer-success"));
    await waitFor(() => expect(screen.queryByTestId("mock-transfer-modal")).toBeNull());

    fireEvent.click(within(row).getByTitle("Stake UrStoa"));
    expect(screen.getByTestId("mock-stake-modal")).toBeTruthy();

    fireEvent.click(within(row).getByTitle("Unstake UrStoa"));
    expect(screen.getByTestId("mock-unstake-modal")).toBeTruthy();

    fireEvent.click(within(row).getByTitle("Collect UrStoa earnings"));
    expect(screen.getByTestId("mock-collect-modal")).toBeTruthy();
  });

  it("the merged Send/Transfer button opens SendStoaModal in Stoa mode and TransferUrStoaModal in UrStoa mode", async () => {
    const { container } = await renderTab(oneSeed);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    // Stoa mode: "Send" opens the native SendStoaModal.
    fireEvent.click(within(row).getByTitle("Send STOA"));
    expect(screen.getByTestId("mock-send-modal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mock-send-success"));
    await waitFor(() => expect(screen.queryByTestId("mock-send-modal")).toBeNull());

    // UrStoa mode: the SAME button slot now reads "Transfer" and opens TransferUrStoaModal.
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    await waitFor(() => expect(within(row).getByTitle("Transfer UrStoa")).toBeTruthy());
    fireEvent.click(within(row).getByTitle("Transfer UrStoa"));
    expect(screen.getByTestId("mock-transfer-modal")).toBeTruthy();
  });

  it("highlights the UrStoa row gold when balance is zero but staked is nonzero (a staked-only account is NOT empty)", async () => {
    // Regression: the highlight color previously checked ONLY `balance > 0`,
    // so an account holding a large STAKED amount but zero currently-liquid
    // balance rendered gray ("looks empty") when it plainly isn't.
    setPactReader(async (code: string) => {
      if (code.includes("UR_UR|Balance")) {
        return { result: { data: [{ account: ADDR, balance: 0, staked: 62500, earnings: 0, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTab(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    await waitFor(() => {
      const row = container.querySelector(`[data-stoa-address="${ADDR}"]`) as HTMLElement;
      const label = within(row).getByText(/62500/);
      expect(label.style.color).toBe("rgb(206, 172, 95)"); // #ceac5f (gold)
    });
  });

  it("keeps the UrStoa row gray when balance AND staked are both zero", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("UR_UR|Balance")) {
        return { result: { data: [{ account: ADDR, balance: 0, staked: 0, earnings: 0, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTab(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    await waitFor(() => {
      const row = container.querySelector(`[data-stoa-address="${ADDR}"]`) as HTMLElement;
      const label = within(row).getByText(/0\.000000000000 \[0\.000000000000\]/);
      expect(label.style.color).toBe("rgb(85, 85, 85)"); // #555 (gray)
    });
  });

  it("the Collect button's tooltip shows the real pending earnings amount from the row's live balance data", async () => {
    // Radix's Tooltip.Trigger opens immediately (no hover-delay wait needed)
    // on focus — the same accessible path a keyboard user takes — per
    // @radix-ui/react-tooltip's TooltipTrigger onFocus handler.
    setPactReader(async (code: string) => {
      if (code.includes("UR_UR|Balance")) {
        return { result: { data: [{ account: ADDR, balance: 5, staked: 10, earnings: 3.25, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTab(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;

    const collectBtn = await waitFor(() => within(row).getByTitle("Collect UrStoa earnings"));
    fireEvent.focus(collectBtn);
    // Regression this catches: a static/generic tooltip string instead of the
    // REAL earnings figure sourced from the same useUrStoaBalances row data
    // already driving the row's own balance display.
    // (Radix renders the tooltip text twice — the visible bubble plus a
    // visually-hidden accessible copy — so assert at least one match exists.)
    await waitFor(() => {
      expect(screen.getAllByText(/3\.250000000000 STOA in earned vault rewards/i).length).toBeGreaterThan(0);
    });
  });

  it("a modal's success refreshes the currently-active (UrStoa) balance hook", async () => {
    let urReadCount = 0;
    setPactReader(async (code: string) => {
      if (code.includes("UR_UR|Balance")) urReadCount++;
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTab(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    await waitFor(() => expect(urReadCount).toBeGreaterThan(0));
    const before = urReadCount;
    const row = container.querySelector(`[data-stoa-address="${ADDR}"]`) as HTMLElement;
    fireEvent.click(within(row).getByTitle("Stake UrStoa"));
    fireEvent.click(screen.getByTestId("mock-stake-success"));
    // Regression this catches: a modal's onSuccess not calling the active
    // hook's refresh() at all, or calling the WRONG (Stoa) hook's refresh
    // while UrStoa is the active mode.
    await waitFor(() => expect(urReadCount).toBeGreaterThan(before));
  });
});

describe("<StoaAccountsTab> — mobile: the condensed summary bar (design.md §8, the 'optimize each blockchain and tab' round)", () => {
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "f".repeat(64), derivationPath: "m/0" }] })];

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

  async function renderTabMobile(seeds: IStoaChainSeed[] = [], pairs: IPureKeypair[] = []) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={pairs} />
        <CodexUiRoot>
          <StoaAccountsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  it("drops the 'Total Addresses' card AND its count entirely — the count relocated onto ChainwebPanel's own category row (design.md §8, the 'further optimize' round)", async () => {
    await renderTabMobile(oneSeed);
    expect(screen.queryByText(/Total Addresses/i)).toBeNull();
    // No bare "1" count rendered inline anywhere in THIS component anymore
    // — it's reported upward via `onTotalChange` instead (see the
    // dedicated describe block below), not rendered here at all.
    expect(screen.getByRole("button", { name: /codex 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /watched 0/i })).toBeTruthy();
    // Refresh is gone from THIS row too now (owner correction, round 2:
    // "move the refresh button" up onto ChainwebPanel's own icon row — see
    // the dedicated `onRefreshHandleChange` describe block below).
    expect(screen.queryByRole("button", { name: /refresh balances/i })).toBeNull();
  });

  it("Codex/Watched toggle is LEFT-aligned, Stoa/UrStoa toggle is RIGHT-aligned, on ONE shared line", async () => {
    await renderTabMobile(oneSeed);
    const codexBtn = screen.getByRole("button", { name: /codex 1/i });
    const stoaBtn = screen.getByRole("button", { name: "Stoa" });
    const row = codexBtn.closest('div[style*="align-items: center"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.contains(stoaBtn)).toBe(true);
    // Codex/Watched's own wrapper comes BEFORE the spacer/Stoa-UrStoa
    // wrapper in DOM order — i.e. actually left of it, not just visually
    // via a stray float.
    const children = Array.from(row.children);
    const codexWrapperIdx = children.findIndex((c) => c.contains(codexBtn));
    const stoaWrapperIdx = children.findIndex((c) => c.contains(stoaBtn));
    expect(codexWrapperIdx).toBeLessThan(stoaWrapperIdx);
  });

  it("reports the total (Codex + Watched, deduped) via onTotalChange — the value ChainwebPanel's icon row now shows", async () => {
    const onTotalChange = vi.fn();
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={oneSeed} pairs={[]} />
        <CodexUiRoot>
          <StoaAccountsTab onTotalChange={onTotalChange} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(onTotalChange).toHaveBeenCalledWith(1));
  });

  it("reports the account COMPOSITION (seed accounts / seed count + direct accounts) via onAccountsBreakdownChange — owner correction: 'm being the number of accounts from seeds, n the number of seeds, and x the number of direct accounts'", async () => {
    const onAccountsBreakdownChange = vi.fn();
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const twoAccountSeed = [
      seedFx({ id: "s1", accounts: [
        { index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" },
        { index: 1, publicKey: "b".repeat(64), derivationPath: "m/1" },
      ] }),
    ];
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={twoAccountSeed} pairs={[kpFx({ id: "kp1", publicKey: "c".repeat(64) })]} />
        <CodexUiRoot>
          <StoaAccountsTab onAccountsBreakdownChange={onAccountsBreakdownChange} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    // 1 seed carrying 2 accounts (m=2, n=1), plus 1 pure keypair (x=1) —
    // matching "56/12+3"'s shape, just smaller numbers.
    await waitFor(() => expect(onAccountsBreakdownChange).toHaveBeenCalledWith({ seedAccounts: 2, seedCount: 1, directAccounts: 1 }));
  });

  it("still exposes the Stoa/UrStoa balance-source toggle (not silently dropped)", async () => {
    await renderTabMobile(oneSeed);
    expect(screen.getByRole("button", { name: "Stoa" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "UrStoa" })).toBeTruthy();
  });

  it("the condensed toggle still switches between Codex and Watched accounts", async () => {
    await renderTabMobile(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: /watched 0/i }));
    expect(screen.getByText(/No watched addresses/i)).toBeTruthy();
  });

  it("the Codex/Watched and Stoa/UrStoa pill groups are the SAME (symmetric) width (design.md §8, round 6: 'too much space is wasted... let's make the medallions the same length')", async () => {
    await renderTabMobile(oneSeed);
    const codexBtn = screen.getByRole("button", { name: /codex 1/i });
    const stoaBtn = screen.getByRole("button", { name: "Stoa" });
    const codexGroup = codexBtn.parentElement as HTMLElement;
    const stoaGroup = stoaBtn.parentElement as HTMLElement;
    expect(codexGroup.style.flex).toBe("1 1 0%");
    expect(stoaGroup.style.flex).toBe("1 1 0%");
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — still the 'Total Addresses' card + the separate toggle row", async () => {
    await renderTab(oneSeed);
    expect(screen.getByText(/Total Addresses/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /codex accounts/i })).toBeTruthy();
  });
});

describe("<StoaAccountsTab> — the Watched list is independent PER CHAIN (owner-reported live bug: 'there is a watched account but on arweave, and it has leaked in the watch account on chainweb. these must be independent lists')", () => {
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "f".repeat(64), derivationPath: "m/0" }] })];

  /** Seeds the SHARED, codex-wide watch-list store slice directly with an
   *  entry of a given `type` — mirrors exactly how a real chain's own
   *  wiring writes a watch entry (e.g. `ForeignChainsWiring.tsx`'s Arweave
   *  `addWatchedAddress`), so the fixture reproduces the ACTUAL leak
   *  vector: one shared array, entries distinguished only by `type`. */
  function WatchSeeder({ address, type }: { address: string; type: "stoa" | "arweave" | "ouronet" }) {
    const { addEntry } = useWatchList();
    const { isReady } = useCodex();
    React.useEffect(() => {
      if (!isReady) return;
      void addEntry({ id: `w-${type}`, label: "", address, type, createdAt: new Date().toISOString() });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReady]);
    return null;
  }

  it("an Arweave-typed watch entry does NOT appear in Chainweb's Watched list", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={oneSeed} pairs={[]} />
        <WatchSeeder address="ar-leaked-address" type="arweave" />
        <StoaAccountsTab />
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Total Addresses/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /watched accounts/i }));
    expect(screen.queryByText("ar-leaked-address")).toBeNull();
    expect(screen.getByText(/No watched addresses/i)).toBeTruthy();
  });

  it("a Stoa-typed watch entry still shows up normally (the fix isn't over-broad)", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={oneSeed} pairs={[]} />
        <WatchSeeder address="k:watched-on-chainweb" type="stoa" />
        <StoaAccountsTab />
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Total Addresses/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /watched accounts/i }));
    expect(await screen.findByText("k:watched-on-chainweb")).toBeTruthy();
  });

  it("the reported total (onTotalChange) excludes an other-chain watch entry too", async () => {
    const onTotalChange = vi.fn();
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={oneSeed} pairs={[]} />
        <WatchSeeder address="ar-leaked-address" type="arweave" />
        <StoaAccountsTab onTotalChange={onTotalChange} />
      </CodexProvider>,
    );
    // 1 codex account, 0 Chainweb-typed watch entries — the leaked
    // Arweave entry must not inflate this.
    await waitFor(() => expect(onTotalChange).toHaveBeenCalledWith(1));
  });
});

describe("<StoaAccountsTab> — mobile: the flat fixed-row pagination engine (round 11 owner correction: 'instead of listing the entries as part of a seed, we should make the entry carry a medallion to see from which seed it belongs, thus making all entries having a fixed size... with a fixed size for all entries, we can perfectly say how many entries fit in a given space size')", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }

  type PaginationHandle = { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null;

  /**
   * Round 9's "standard pagination controls zone", simplified further by
   * round 11: since Collapse-All no longer exists on mobile at all (no more
   * grouped list to collapse — see `codexFlatEntries`'s own doc comment),
   * this shared slot is now UNCONDITIONALLY free for pagination whenever a
   * caller wires `onPaginationHandleChange` — `handleRef` captures the
   * LATEST reported handle so a spec can drive `onNext`/`onJump` directly,
   * the same way `ChainwebPanel` eventually would from its own medallion.
   */
  async function renderPaginated(seeds: IStoaChainSeed[] = [], pairs: IPureKeypair[] = [], handleRef?: { current: PaginationHandle }) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={pairs} />
        <CodexUiRoot>
          <StoaAccountsTab onPaginationHandleChange={handleRef ? (h) => { handleRef.current = h; } : undefined} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  /** `n` accounts on one seed, each with a unique valid-shaped public key. */
  const nAccounts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ index: i, publicKey: String.fromCharCode(97 + i).repeat(64), derivationPath: `m/${i}` }));

  // jsdom never resolves real layout (`clientHeight` stays 0), so the
  // engine's own measurement hook never gets a real reading and stays at
  // its safe DEFAULT of 4 slots throughout — the SAME "measurement is a
  // browser-only concern" precedent `OuronetAccountsTab`'s own
  // `useMobilePageSize` established (see that file's test suite). Every
  // spec below is written against this known, deterministic default. There
  // is no header cost anymore (round 11) — every entry is exactly 1 slot,
  // the SAME trivial formula the Watched list has always used.

  it("a flat list of exactly 4 entries (the default page size) needs no Prev/Next controls at all", async () => {
    await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(4) })]);
    expect(screen.getByText("Key #0")).toBeTruthy();
    expect(screen.getByText("Key #1")).toBeTruthy();
    expect(screen.getByText("Key #2")).toBeTruthy();
    expect(screen.getByText("Key #3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /prev/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
  });

  it("a left swipe on the entry area advances to the next page, a right swipe goes back — owner correction: 'we can add swiping mechanic to move page'", async () => {
    await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(5) })]);
    const surface = screen.getByTestId("stoa-accounts-page-surface");

    // Round 18 — the gesture must actually MOVE (a `touchmove`) past the
    // dead-zone to be recognised as a horizontal page-swipe at all (this is
    // what now drives the live drag feedback); a bare touchstart+touchend
    // with no move in between is exactly the "just a tap" case that must
    // NOT flip a page.
    const swipe = (fromX: number, toX: number) => {
      fireEvent.touchStart(surface, { touches: [{ clientX: fromX, clientY: 0 }] });
      fireEvent.touchMove(surface, { touches: [{ clientX: toX, clientY: 0 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: toX, clientY: 0 }] });
    };

    // Swipe left (finger moves left, past the threshold) → next page. Round
    // 20's two-pane carousel means "Key #4" becomes visible ALMOST
    // immediately (it's mounted as the peeking adjacent pane the instant
    // the drag direction locks in, well before release) — so it is no
    // longer a reliable signal that the page-INDEX swap itself has
    // actually completed (that still waits for the "animate off-screen"
    // settle timeout — see `onAccountsTouchEnd`'s own doc comment). Wait
    // for "Key #0" to actually disappear instead, which only happens once
    // the real swap lands.
    swipe(300, 200);
    await waitFor(() => expect(screen.queryByText("Key #0")).toBeNull());
    expect(screen.getByText("Key #4")).toBeTruthy();

    // Swipe right (finger moves right, past the threshold) → back to page 1.
    swipe(200, 300);
    await waitFor(() => expect(screen.queryByText("Key #4")).toBeNull());
    expect(screen.getByText("Key #0")).toBeTruthy();

    // A short drag under the threshold bounces back — no page change (this
    // branch never touches the settle-timeout at all, so no extra wait is
    // needed here).
    swipe(200, 190);
    expect(screen.getByText("Key #0")).toBeTruthy();
  });

  it("visually follows the finger WHILE dragging (round 18): the track transform tracks touchmove live, with no CSS transition applied until release", async () => {
    await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(5) })]);
    const surface = screen.getByTestId("stoa-accounts-page-surface");
    const track = screen.getByTestId("stoa-accounts-page-swipe-track");
    expect(track.style.transform).toBe("translateX(0px)");

    fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 0 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 260, clientY: 0 }] });
    // Still page 1's content — this is a LIVE drag, not a page change yet.
    expect(screen.getByText("Key #0")).toBeTruthy();
    expect(track.style.transform).toBe("translateX(-40px)");
    expect(track.style.transition).toBe("none");

    fireEvent.touchMove(surface, { touches: [{ clientX: 220, clientY: 0 }] });
    expect(track.style.transform).toBe("translateX(-80px)");

    // Releasing past the threshold now animates (a real CSS transition)
    // before the page actually changes.
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 220, clientY: 0 }] });
    expect(track.style.transition).not.toBe("none");
    // Round 20 — wait for the ACTUAL settle (the transform resets to 0 in
    // the same batched update as the real page-index swap) rather than
    // for "Key #4" to appear (it's already visible well before this,
    // mounted as the peeking pane).
    await waitFor(() => expect(track.style.transform).toBe("translateX(0px)"));
    expect(track.style.transition).toBe("none");
    expect(screen.getByText("Key #4")).toBeTruthy();
    expect(screen.queryByText("Key #0")).toBeNull();
  });

  it("round 20 — the ADJACENT page's real content mounts as a second pane and slides INTO view WHILE dragging, instead of the old blank gap ('the next page isnt there, it simply appears when the prev page is complelety gone')", async () => {
    await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(5) })]);
    const surface = screen.getByTestId("stoa-accounts-page-surface");

    // Before any gesture, only the current page's own content exists.
    expect(screen.queryByText("Key #4")).toBeNull();

    fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 0 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 260, clientY: 0 }] });
    // Still mid-drag (well under the commit threshold) — "Key #4" (page
    // 2's own real content) is ALREADY mounted, sliding in from the right
    // as page 1 slides left, not just empty space.
    expect(screen.getByText("Key #0")).toBeTruthy();
    expect(screen.getByText("Key #4")).toBeTruthy();

    // Releasing under the threshold bounces back — the peek was a real
    // preview, not a premature commit.
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 260, clientY: 0 }] });
    expect(screen.getByText("Key #0")).toBeTruthy();
  });

  it("resists (rubber-bands) a drag past the first/last page instead of moving 1:1 with the finger, and a vertical gesture never applies any transform at all", async () => {
    await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(5) })]);
    const surface = screen.getByTestId("stoa-accounts-page-surface");
    const track = screen.getByTestId("stoa-accounts-page-swipe-track");

    // Already on the FIRST page — dragging further RIGHT (revealing a
    // "previous" page that doesn't exist) resists rather than moving 1:1.
    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 0 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 300, clientY: 0 }] });
    expect(track.style.transform).toBe("translateX(35px)"); // 100 * 0.35
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 300, clientY: 0 }] });

    // A predominantly VERTICAL gesture (e.g. the user is just scrolling the
    // page around this area) must never move the track at all — this is
    // exactly what keeps normal vertical scrolling un-fought.
    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 210, clientY: 260 }] });
    expect(track.style.transform).toBe("translateX(0px)");
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 210, clientY: 260 }] });
    expect(screen.getByText("Key #0")).toBeTruthy();
  });

  it("a 5th entry (one over the default page size) splits into a 2nd page, with NO group header ever appearing at all", async () => {
    // A SINGLE group reports pagination upward (round 11: this is now
    // UNCONDITIONAL, not conditioned on group count) — advance via the
    // reported handle, same as `ChainwebPanel` would from its own
    // medallion button.
    const handleRef: { current: PaginationHandle } = { current: null };
    await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(5) })], [], handleRef);
    // The seed's own name never renders as a GROUP HEADER (a shared banner
    // sitting above several rows) on mobile anymore — round 12 put it back
    // as a thin per-ROW pill instead (alongside the colour-coded corner
    // dot for TYPE), so it legitimately appears once per row now.
    expect(screen.getAllByText("Prime Codex Seed").length).toBe(4);
    expect(screen.getByText("Key #0")).toBeTruthy();
    expect(screen.getByText("Key #3")).toBeTruthy();
    expect(screen.queryByText("Key #4")).toBeNull();

    act(() => handleRef.current?.onNext());
    expect(await screen.findByText("Key #4")).toBeTruthy();
    // The 4 earlier keys are gone (paginated, not just scrolled).
    expect(screen.queryByText("Key #0")).toBeNull();
  });

  it("entries from TWO different seeds pack onto the SAME page seamlessly, each carrying its own seed's colour as a small corner badge instead of a header row", async () => {
    // Seed A (the array's first — "Prime Codex Seed", koala colour #ec4899)
    // gets 3 entries, Seed B (also koala-typed here, but a DIFFERENT id) 1
    // more — 4 total, exactly the default page size, no header ever
    // separating them.
    await renderPaginated([
      seedFx({ id: "s1", accounts: nAccounts(3) }),
      seedFx({ id: "s2", name: "Seed B", accounts: nAccounts(1) }),
    ]);
    // No group HEADER (a banner spanning several rows) — but round 12's
    // thin per-row name pill legitimately shows each seed's name once per
    // ROW, so the text itself now appears (3 times for the 3-entry seed,
    // once for the 1-entry seed).
    expect(screen.getAllByText("Prime Codex Seed").length).toBe(3);
    expect(screen.getAllByText("Seed B").length).toBe(1);
    // "Key #0" is ambiguous across the two seeds (both start their own
    // index at 0) — assert the corner badge exists on every row instead.
    expect(screen.getAllByText("Key #0").length).toBe(2);
    expect(screen.getAllByLabelText(/^From /i).length).toBe(4);
    expect(screen.getAllByLabelText("From Prime Codex Seed").length).toBe(3);
    expect(screen.getAllByLabelText("From Seed B").length).toBe(1);
  });

  it("the Watched list paginates the same way — every entry costs exactly 1 slot, no seed badge (it isn't grouped at all)", async () => {
    const handleRef: { current: PaginationHandle } = { current: null };
    const seeds = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] })];
    await renderPaginated(seeds, [], handleRef);
    // Switch to Watched FIRST — the "Watch a k:/u:/c:/w: address…" input is
    // only rendered while that subtab is active.
    fireEvent.click(screen.getByRole("button", { name: /watched 0/i }));
    // Seed the watch-list with 5 entries directly via the real UI control.
    for (let i = 0; i < 5; i++) {
      fireEvent.change(screen.getByPlaceholderText(/watch a k/i), { target: { value: `k:${String.fromCharCode(98 + i).repeat(64)}` } });
      fireEvent.click(screen.getByRole("button", { name: /^watch$/i }));
    }
    // 4 slots available → 4 per page.
    await waitFor(() => expect(screen.getAllByText(/^k:/).length).toBe(4));
    expect(screen.queryByLabelText(/^From /i)).toBeNull();
    act(() => handleRef.current?.onNext());
    await waitFor(() => expect(screen.getAllByText(/^k:/).length).toBe(1));
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — grouped GroupRow list, no Prev/Next controls, every account renders unconditionally regardless of count", async () => {
    await renderTab([seedFx({ id: "s1", accounts: nAccounts(6) })]);
    for (let i = 0; i < 6; i++) expect(screen.getByText(`Key #${i}`)).toBeTruthy();
    expect(screen.getByText("Prime Codex Seed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /prev/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
  });

  // Owner-reported live bug (design.md §8, round 8 follow-up, still relevant
  // to DESKTOP's own unchanged `GroupRow`): "on a smaller screen, the seeds
  // view on accounts when collapsing, some weird shit is happening with the
  // entries that they are not displayed properly on their entry line."
  // Root cause: a `flex: 1` header-name span with no `minWidth: 0` refuses
  // to shrink below its own text width in a narrow flex row, which can push
  // the count badge off its own line instead of the name truncating. Round
  // 11 removed `GroupRow` from the MOBILE list entirely, but desktop still
  // renders it unconditionally — moved here to `renderTab` (desktop) to
  // keep covering that still-live code path.
  it("a long seed name in the (desktop) group header truncates (ellipsis) instead of overflowing its row — the count badge never gets pushed off its line", async () => {
    // The array's FIRST seed always renders as the locked "Prime Codex
    // Seed" regardless of its own `name` — use a SECOND (non-prime) seed
    // to actually exercise its own name text.
    await renderTab([
      seedFx({ id: "s0" }),
      seedFx({ id: "s1", name: "A".repeat(80), accounts: nAccounts(1) }),
    ]);
    const nameSpan = screen.getByText("A".repeat(80));
    expect(nameSpan.style.minWidth).toBe("0px");
    expect(nameSpan.style.overflow).toBe("hidden");
    expect(nameSpan.style.textOverflow).toBe("ellipsis");
    expect(nameSpan.style.whiteSpace).toBe("nowrap");
    // The count badge, its flex sibling, must never be squeezed.
    const badge = nameSpan.nextElementSibling as HTMLElement;
    expect(badge.style.flexShrink).toBe("0");
  });

  // Owner correction (design.md §8, round 8 follow-up): "when there are
  // more than 10 pages available the entry 15/24 when clicked needs to
  // allow the input of a given page, to jump directly to a wanted page."
  describe("the page-jump input (only appears past 10 pages)", () => {
    // Round 11 — pagination reports upward ONLY when a caller wires
    // `onPaginationHandleChange`; a standalone mount (none of these specs
    // supply a `handleRef`, mirroring the ORIGINAL "no external handler at
    // all" precedent) still falls back to its own inline Prev/Next +
    // `PageJumpIndicator`, which is exactly the UI these specs exercise.
    async function seedManyFlat(n: number) {
      await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(n) })]);
    }

    it("stays a plain, unclickable 'N / M' label when there are 10 or fewer pages", async () => {
      // 40 entries / 4 per page = 10 pages exactly.
      await seedManyFlat(40);
      await waitFor(() => expect(screen.getByText("1 / 10")).toBeTruthy());
      expect(screen.getByText("1 / 10").tagName).not.toBe("BUTTON");
    });

    it("becomes a clickable jump control once there are more than 10 pages, and jumping types+commits a page", async () => {
      // 44 entries / 4 per page = 11 pages.
      await seedManyFlat(44);
      const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
      fireEvent.click(jumpBtn);
      const input = screen.getByLabelText(/jump to page/i);
      fireEvent.change(input, { target: { value: "9" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("button", { name: "9 / 11" })).toBeTruthy());
    });

    it("clamps an out-of-range typed page to the last valid page", async () => {
      await seedManyFlat(44);
      const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
      fireEvent.click(jumpBtn);
      const input = screen.getByLabelText(/jump to page/i);
      fireEvent.change(input, { target: { value: "999" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("button", { name: "11 / 11" })).toBeTruthy());
    });

    it("Escape cancels the edit without changing the page", async () => {
      await seedManyFlat(44);
      const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
      fireEvent.click(jumpBtn);
      const input = screen.getByLabelText(/jump to page/i);
      fireEvent.change(input, { target: { value: "9" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(await screen.findByRole("button", { name: "1 / 11" })).toBeTruthy();
    });
  });

  // Round 11 — with Collapse-All gone entirely from mobile, this shared
  // slot is UNCONDITIONALLY pagination's; below covers every subTab/group
  // shape reporting the handle the same way and never rendering inline.
  describe("reports pagination upward unconditionally whenever a caller opts in", () => {
    it("Watched subtab: reports the handle, renders no inline Prev/Next", async () => {
      const handleRef: { current: PaginationHandle } = { current: null };
      const seeds = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] })];
      await renderPaginated(seeds, [], handleRef);
      fireEvent.click(screen.getByRole("button", { name: /watched 0/i }));
      for (let i = 0; i < 5; i++) {
        fireEvent.change(screen.getByPlaceholderText(/watch a k/i), { target: { value: `k:${String.fromCharCode(98 + i).repeat(64)}` } });
        fireEvent.click(screen.getByRole("button", { name: /^watch$/i }));
      }
      await waitFor(() => expect(handleRef.current).toEqual(expect.objectContaining({ page: 0, totalPages: 2 })));
      expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /prev/i })).toBeNull();
    });

    it("a single-group Codex subtab: reports the handle, renders no inline Prev/Next", async () => {
      const handleRef: { current: PaginationHandle } = { current: null };
      await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(6) })], [], handleRef);
      await waitFor(() => expect(handleRef.current).toEqual(expect.objectContaining({ totalPages: 2 })));
      expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /prev/i })).toBeNull();
    });

    it("a multi-group Codex subtab ALSO reports the handle (round 11 — no more Collapse-All to contend the slot with)", async () => {
      const handleRef: { current: PaginationHandle } = { current: null };
      await renderPaginated([
        seedFx({ id: "s1", accounts: nAccounts(4) }),
        seedFx({ id: "s2", name: "Seed B", accounts: nAccounts(2) }),
      ], [], handleRef);
      await waitFor(() => expect(handleRef.current).toEqual(expect.objectContaining({ totalPages: 2 })));
      expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /prev/i })).toBeNull();
    });

    it("reports null once everything fits on one page", async () => {
      const handleRef: { current: PaginationHandle } = { current: null };
      await renderPaginated([seedFx({ id: "s1", accounts: nAccounts(2) })], [], handleRef);
      await waitFor(() => expect(screen.getByText("Key #1")).toBeTruthy());
      expect(handleRef.current).toBeNull();
    });
  });
});

describe("<StoaAccountsTab> — mobile: the AddressRow 2×2 entry layout (design.md §8, the 'further optimize' round)", () => {
  const PUBKEY = "c".repeat(64);
  const ADDR = `k:${PUBKEY}`;
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] })];

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

  async function renderTabMobile(seeds: IStoaChainSeed[] = [], pairs: IPureKeypair[] = []) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={pairs} />
        <CodexUiRoot>
          <StoaAccountsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  it("shows the account-type prefix as a medallion (the row's leading 'head'), the address, and its position sublabel", async () => {
    const { container } = await renderTabMobile(oneSeed);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    // The medallion carries the same "k:" prefix text the desktop badge does.
    expect(within(row).getByText("k:")).toBeTruthy();
    expect(within(row).getByText("Key #0")).toBeTruthy();
    // The address is rendered via <StoaAddressHighlight>, FILLING the row
    // (owner correction, round 3: "extend the account name on the whole
    // width") rather than being capped to a fixed fraction — its full value
    // is the element's `title` (hover-to-read), same convention every other
    // measured-fit address component in this codebase already uses.
    expect(row.querySelector(`[title="${ADDR}"]`)).toBeTruthy();
  });

  it("the sublabel (lower-left) stays a fixed, un-squeezed width, leaving the balance the rest of the row", async () => {
    const { container } = await renderTabMobile(oneSeed);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    const sublabel = within(row).getByText("Key #0");
    expect(sublabel.style.flexShrink).toBe("0");
  });

  it("shows the chain count (Layers icon + number) in the upper-right corner, only once the account holds a balance on more than one chain — and NO per-row action buttons (those moved to the shared row, round 2)", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("coin.get-balance")) {
        return { result: { data: [{ account: ADDR, balance: 1.23456789, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTabMobile(oneSeed);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`) as HTMLElement;
      // 10 STOA_CHAINS all report a balance above — chainsWithBalance is 10.
      expect(within(r).queryByText("10")).toBeTruthy();
      return r;
    })) as HTMLElement;
    expect(within(row).getByText("10")).toBeTruthy();
    // No per-row action buttons anymore — Send/Copy/Explorer all moved to
    // the tab-level shared action row, tied to the SELECTED entry instead.
    expect(within(row).queryByTitle("Send STOA")).toBeNull();
    expect(within(row).queryByTitle("Copy")).toBeNull();
  });

  it("shows the balance at FULL precision (owner correction, round 3: 'extend on the whole width and shorten it only if it doesn't fit') and the ❖ emblem (Stoa mode)", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("coin.get-balance")) {
        return { result: { data: [{ account: ADDR, balance: 1.23456789, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTabMobile(oneSeed);
    // total = 1.23456789 × 10 chains — full 12-decimal precision, exactly
    // what `MobileBalanceFill` falls back to when jsdom reports no real
    // layout width to measure against (never artificially pre-shortened).
    const fullValue = (1.23456789 * 10).toFixed(12);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`) as HTMLElement;
      expect(within(r).queryByText(fullValue)).toBeTruthy();
      return r;
    })) as HTMLElement;
    const emblem = within(row).getByText("❖");
    expect(emblem.style.color).toBe("rgb(234, 179, 8)"); // #eab308 (yellow)
  });

  it("switches the emblem to ✦ grey once UrStoa mode is active", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("UR_UR|Balance")) {
        return { result: { data: [{ account: ADDR, balance: 4, staked: 0, earnings: 0, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    await renderTabMobile(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    const emblem = await screen.findByText("✦");
    expect(emblem.style.color).toBe("rgb(156, 163, 175)"); // #9ca3af (grey)
  });
});

describe("<StoaAccountsTab> — mobile: select → shared action row → full-screen (design.md §8, the 'further optimize round 2')", () => {
  const PUBKEY = "d".repeat(64);
  const ADDR = `k:${PUBKEY}`;
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] })];

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

  async function renderTabMobile(seeds: IStoaChainSeed[] = [], pairs: IPureKeypair[] = []) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={pairs} />
        <CodexUiRoot>
          <StoaAccountsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  async function getRow(container: HTMLElement) {
    return (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
  }

  it("owner correction (round 3): there is NEVER a 'nothing selected' state — the first entry is selected by DEFAULT, no tap needed, buttons active from the very first render", async () => {
    const { container } = await renderTabMobile(oneSeed);
    const row = await getRow(container);
    // Round 11 added an extra `position: relative` wrapper div around the
    // medallion circle (to host the optional seed-badge corner dot) — one
    // more `.firstElementChild` hop than before to reach the actual circle.
    const medallion = row.firstElementChild?.firstElementChild?.firstElementChild as HTMLElement;
    // Lit (gold) from the start — never a dim/un-lit initial state.
    expect(medallion.style.border).toContain("rgb(206, 172, 95)");
    expect(screen.queryByText(/tap an account below to select it/i)).toBeNull();
    expect(screen.getByTitle("Send STOA")).toBeTruthy();
    expect(screen.getByTitle("Copy")).toBeTruthy();
  });

  it("a tap on the (already, by-default) selected row opens the full-screen per-chain view in ONE tap, not the old inline expand", async () => {
    const { container } = await renderTabMobile(oneSeed);
    const row = await getRow(container);
    const headerRow = row.firstElementChild as HTMLElement;

    fireEvent.click(headerRow); // already selected by default → expands straight to full screen

    expect(await screen.findByTestId("stoa-address-fullscreen")).toBeTruthy();
    // The old inline "Per-chain grid" (Round C's `open` toggle) never fires
    // on mobile anymore — only ONE chain-breakdown surface exists now: the
    // full-screen one.
    expect(screen.getByTestId("fullscreen-chain-row-0")).toBeTruthy();
  });

  it("the full-screen view's sort toggle re-orders chains by amount (biggest first), default is chain-number order", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("coin.get-balance")) {
        return {
          result: {
            data: [
              { account: ADDR, balance: 1, exists: true },
            ],
          },
        } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTabMobile(oneSeed);
    const row = await getRow(container);
    fireEvent.click(row.firstElementChild as HTMLElement);
    await screen.findByTestId("stoa-address-fullscreen");

    const sortBtn = screen.getByRole("button", { name: /by chain #/i });
    expect(sortBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(sortBtn);
    expect(await screen.findByRole("button", { name: /by amount/i })).toBeTruthy();
  });

  it("clicking Send on the shared row opens SendStoaModal for the (default-selected) entry — no tap on the row needed first", async () => {
    await renderTabMobile(oneSeed);
    fireEvent.click(screen.getByTitle("Send STOA"));
    expect(await screen.findByTestId("mock-send-modal")).toBeTruthy();
  });

  it("closing the full-screen view returns to the list (selection persists)", async () => {
    const { container } = await renderTabMobile(oneSeed);
    const row = await getRow(container);
    fireEvent.click(row.firstElementChild as HTMLElement);
    await screen.findByTestId("stoa-address-fullscreen");

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("stoa-address-fullscreen")).toBeNull();
    expect(screen.getByTitle("Send STOA")).toBeTruthy();
  });

  it("switching Codex/Watched re-derives the default selection for the NEW subtab (round 3: 'always an entry is selected') — round 7: the edge buttons vanish entirely once nothing is selected", async () => {
    await renderTabMobile(oneSeed);
    expect(screen.getByTitle("Send STOA")).toBeTruthy();

    // The Watched list is genuinely empty in this fixture — round 7 owner
    // correction moved the action buttons to floating edge stacks with NO
    // disabled/placeholder state anymore; the list's OWN existing empty
    // message ("No watched addresses.") is the only feedback now.
    fireEvent.click(screen.getByRole("button", { name: /watched 0/i }));
    expect(await screen.findByText(/no watched addresses/i)).toBeTruthy();
    expect(screen.queryByTitle("Send STOA")).toBeNull();
    expect(screen.queryByTitle("Select an account first")).toBeNull();

    // Switching back re-derives the codex list's own first entry again.
    fireEvent.click(screen.getByRole("button", { name: /codex 1/i }));
    expect(await screen.findByTitle("Send STOA")).toBeTruthy();
  });

  it("a genuinely empty subtab (no codex accounts at all) shows NO edge buttons — just the list's own empty state", async () => {
    await renderTabMobile([]);
    expect(await screen.findByText(/no stoa accounts in the codex/i)).toBeTruthy();
    expect(screen.queryByTitle("Send STOA")).toBeNull();
    expect(screen.queryByTitle("Select an account first")).toBeNull();
  });

  it("reports the active refresh handle via onRefreshHandleChange", async () => {
    const onRefreshHandleChange = vi.fn();
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={oneSeed} pairs={[]} />
        <CodexUiRoot>
          <StoaAccountsTab onRefreshHandleChange={onRefreshHandleChange} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() =>
      expect(onRefreshHandleChange).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: expect.any(Function), loading: expect.any(Boolean), error: expect.any(Boolean) }),
      ),
    );
  });
});

describe("<StoaAccountsTab> — mobile: fullScreenPortalTarget + Total Stoa Balance (design.md §8, the 'further optimize round 3')", () => {
  const PUBKEY = "e".repeat(64);
  const ADDR = `k:${PUBKEY}`;
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] })];

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

  async function renderTabMobileWithTarget(target: HTMLElement | null) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={oneSeed} pairs={[]} />
        <CodexUiRoot>
          <StoaAccountsTab fullScreenPortalTarget={target} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  it("portals the account-detail full screen into the supplied target — owner correction: 'a full screen extension, not extending in its zone'", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const { container } = await renderTabMobileWithTarget(target);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    fireEvent.click(row.firstElementChild as HTMLElement);

    const dialog = await screen.findByTestId("stoa-address-fullscreen");
    expect(target.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);

    document.body.removeChild(target);
  });

  it("without a target, falls back to the bounded inline mount (unchanged default)", async () => {
    const { container } = await renderTabMobileWithTarget(null);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    fireEvent.click(row.firstElementChild as HTMLElement);
    const dialog = await screen.findByTestId("stoa-address-fullscreen");
    expect(container.contains(dialog)).toBe(true);
  });

  it("shows 'Total Stoa Balance' — the SUM across every chain, not just chain 0's figure", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("coin.get-balance")) {
        // Every one of the 10 STOA_CHAINS reports 5 — chain 0 alone is 5,
        // but the TOTAL across all chains is 50. The full-screen view must
        // show 50, not 5.
        return { result: { data: [{ account: ADDR, balance: 5, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTabMobileWithTarget(null);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`) as HTMLElement;
      expect(within(r).queryByText(/50\.000000000000/)).toBeTruthy();
      return r;
    })) as HTMLElement;
    fireEvent.click(row.firstElementChild as HTMLElement);
    await screen.findByTestId("stoa-address-fullscreen");

    expect(screen.getByText(/Total Stoa Balance/i)).toBeTruthy();
    expect(screen.getByText("50.000000000000 STOA")).toBeTruthy();
  });
});

describe("<StoaAccountsTab> — mobile: round 4 polish (design.md §8, the 'further optimize round 4')", () => {
  const PUBKEY = "f".repeat(64);
  const ADDR = `k:${PUBKEY}`;
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] })];

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

  async function renderTabMobile(seeds: IStoaChainSeed[] = []) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={[]} />
        <CodexUiRoot>
          <StoaAccountsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  it("the action buttons float as a horizontal bottom-bar group docked to the RIGHT edge (design.md §8, round 8 follow-up — owner correction: 'add the 3 + 3 buttons on the lower bar... they are drawing on top of existing buttons/elements, and they block view')", async () => {
    await renderTabMobile(oneSeed);
    const sendBtn = screen.getByTitle("Send STOA");
    const stack = sendBtn.parentElement as HTMLElement;
    expect(stack.style.position).toBe("absolute");
    expect(stack.style.right).toBe("6px");
    expect(stack.style.bottom).toBe("12px");
    expect(stack.style.flexDirection).toBe("row");
  });

  it("colors the FIRST 3 characters of the address the same yellow as the last 3", async () => {
    const { container } = await renderTabMobile(oneSeed);
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`);
      expect(r).toBeTruthy();
      return r;
    })) as HTMLElement;
    const addrEl = row.querySelector(`[title="${ADDR}"]`) as HTMLElement;
    // body = address minus "k:" prefix = 64 × "f" — head is the FIRST 3 chars.
    const head = within(addrEl).getAllByText("fff")[0];
    expect(head.style.color).toBe("rgb(234, 179, 8)"); // #eab308 (yellow)
    expect(head.style.fontWeight).toBe("700");
  });

  it("UrStoa mode: shows the DUAL 'liquid [staked]' figure at 3 decimals, grey (not gold), emblem AFTER the balance", async () => {
    setPactReader(async (code: string) => {
      if (code.includes("UR_UR|Balance")) {
        return { result: { data: [{ account: ADDR, balance: 4.123456789, staked: 62500.987654321, earnings: 0, exists: true }] } } as never;
      }
      return { result: { data: [] } } as never;
    });
    const { container } = await renderTabMobile(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));
    const row = (await waitFor(() => {
      const r = container.querySelector(`[data-stoa-address="${ADDR}"]`) as HTMLElement;
      expect(within(r).queryByText("4.123 [62500.988]")).toBeTruthy();
      return r;
    })) as HTMLElement;

    const balanceEl = within(row).getByText("4.123 [62500.988]");
    expect(balanceEl.style.color).toBe("rgb(156, 163, 175)"); // #9ca3af (grey), not gold

    // Emblem sits AFTER the balance in DOM order, both inside the same cluster.
    const emblem = within(row).getByText("✦");
    const cluster = balanceEl.parentElement as HTMLElement;
    expect(cluster.contains(emblem)).toBe(true);
    const children = Array.from(cluster.children);
    expect(children.indexOf(balanceEl)).toBeLessThan(children.indexOf(emblem));
  });
});

describe("<StoaAccountsTab> — mobile: Collapse-All is GONE entirely (round 11 owner correction: 'we wouldn't necessarily need an expand/collapse medallion' — the Codex list is now a flat, fixed-height, seed-badged list, so there is nothing left to collapse)", () => {
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

  async function renderMobile(seeds: IStoaChainSeed[] = []) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={[]} />
        <CodexUiRoot>
          <StoaAccountsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  const twoSeeds = [
    seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] }),
    seedFx({ id: "s2", name: "Second", accounts: [{ index: 0, publicKey: "b".repeat(64), derivationPath: "m/0" }] }),
  ];

  it("no 'Collapse All' / 'Expand All' control ever renders on mobile, even with multiple seeds", async () => {
    await renderMobile(twoSeeds);
    await waitFor(() => expect(screen.getAllByText("Key #0").length).toBe(2));
    expect(screen.queryByRole("button", { name: /collapse all/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /expand all/i })).toBeNull();
  });

  it("no group HEADER renders at all — seeds are told apart by each row's own colour-coded corner dot (type) AND its thin name pill (identity, round 12)", async () => {
    await renderMobile(twoSeeds);
    await waitFor(() => expect(screen.getAllByText("Key #0").length).toBe(2));
    // Round 12 owner correction: the seed's NAME legitimately shows now,
    // once per row, via a thin pill — it just never shows as a shared
    // GROUP header spanning multiple rows the way it used to pre-round-11.
    expect(screen.getByText("Prime Codex Seed")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByLabelText("From Prime Codex Seed")).toBeTruthy();
    expect(screen.getByLabelText("From Second")).toBeTruthy();
  });

  it("each address entry opts into scroll-snap on mobile (design.md §8, round 6: 'this must be done everywhere') — no group card exists anymore to compete with it", async () => {
    // Owner correction, round 8 follow-up — live bug report: "scrolling
    // scrolls me back, it doesnt keep," root-caused to an oversized group
    // card competing with its own children as a snap target. Round 11
    // removes the group card from mobile entirely, so this can no longer
    // even arise — every row is its own, uniform snap target.
    const { container } = await renderMobile(twoSeeds);
    await waitFor(() => expect(screen.getAllByText("Key #0").length).toBe(2));
    const entryCard = container.querySelector("[data-stoa-address]") as HTMLElement;
    expect(entryCard.style.scrollSnapAlign).toBe("start");
  });
});

describe("<StoaAccountsTab> — mobile: bottom-bar action button groups (design.md §8, round 8 follow-up — owner correction: 'i think we should add the 3 + 3 buttons on the lower bar... since on smaller screen they are drawing on top of existing buttons/elements, and they block view')", () => {
  const PUBKEY = "9".repeat(64);
  const ADDR = `k:${PUBKEY}`;
  const oneSeed = [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] })];

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

  async function renderTabMobile(seeds: IStoaChainSeed[] = []) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={[]} />
        <CodexUiRoot>
          <StoaAccountsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /codex/i })).toBeTruthy());
    return utils;
  }

  it("Stoa mode: exactly 3 buttons, all docked to the RIGHT of the bottom bar, left-to-right Send/Transfer → Copy → Explorer", async () => {
    const { container } = await renderTabMobile(oneSeed);
    await waitFor(() => expect(container.querySelector(`[data-stoa-address="${ADDR}"]`)).toBeTruthy());
    const rightStack = screen.getByTitle("Send STOA").parentElement as HTMLElement;
    expect(Array.from(rightStack.children)).toHaveLength(3);
    const [first, second, third] = Array.from(rightStack.children) as HTMLElement[];
    expect(first.title).toBe("Send STOA");
    expect(second.title).toBe("Copy");
    expect(third.title).toBe("Open in Stoa Chain Explorer");
    expect(screen.queryByTitle("Stake UrStoa")).toBeNull();
    // Round 8 follow-up: docked to the BOTTOM edge, laid out horizontally —
    // no longer vertically centered ("drawing on top of existing
    // buttons/elements... block view").
    expect(rightStack.style.bottom).toBe("12px");
    expect(rightStack.style.flexDirection).toBe("row");
  });

  it("UrStoa mode: 6 buttons total — Transfer/Copy/Explorer on the right, Collect/Stake/Unstake on the left, both left-to-right in that order, both docked to the bottom bar", async () => {
    await renderTabMobile(oneSeed);
    fireEvent.click(screen.getByRole("button", { name: "UrStoa" }));

    const rightStack = (await screen.findByTitle("Transfer UrStoa")).parentElement as HTMLElement;
    const rightTitles = Array.from(rightStack.children).map((el) => (el as HTMLElement).title);
    expect(rightTitles).toEqual(["Transfer UrStoa", "Copy", "Open in Stoa Chain Explorer"]);

    const leftStack = screen.getByTitle("Collect UrStoa earnings").parentElement as HTMLElement;
    const leftTitles = Array.from(leftStack.children).map((el) => (el as HTMLElement).title);
    expect(leftTitles).toEqual(["Collect UrStoa earnings", "Stake UrStoa", "Unstake UrStoa"]);

    // Left group docks to the LEFT edge, right group to the RIGHT — both
    // now flush against the BOTTOM (owner correction, round 8 follow-up:
    // "add the 3 + 3 buttons on the lower bar"), not vertically centered.
    expect(leftStack.style.left).toBe("6px");
    expect(leftStack.style.bottom).toBe("12px");
    expect(rightStack.style.right).toBe("6px");
    expect(rightStack.style.bottom).toBe("12px");
  });

  it("no edge buttons at all once nothing is selected (empty list)", async () => {
    await renderTabMobile([]);
    expect(await screen.findByText(/no stoa accounts in the codex/i)).toBeTruthy();
    expect(screen.queryByTitle("Send STOA")).toBeNull();
    expect(screen.queryByTitle("Copy")).toBeNull();
  });

  // Round 9 owner correction: "the buttons need to be on the same level as
  // the collapse expand medallion." When `zone3AnchorTarget` is supplied
  // (as `ChainwebPanel` always does live), the button groups dock to THAT
  // seam instead — `bottom: 0` + `translateY(50%)`, the exact straddling
  // geometry the Collapse-All medallion itself uses — rather than the
  // arbitrary `bottom: 12` fallback.
  it("with zone3AnchorTarget supplied, docks to that SAME seam the Collapse-All medallion straddles, portaled there (not fullScreenPortalTarget)", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const zone3 = document.createElement("div");
    document.body.appendChild(zone3);
    const fullScreen = document.createElement("div");
    document.body.appendChild(fullScreen);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={oneSeed} pairs={[]} />
        <CodexUiRoot>
          <StoaAccountsTab zone3AnchorTarget={zone3} fullScreenPortalTarget={fullScreen} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTitle("Send STOA")).toBeTruthy());
    const rightStack = screen.getByTitle("Send STOA").parentElement as HTMLElement;
    expect(rightStack.style.bottom).toBe("0px");
    expect(rightStack.style.transform).toBe("translateY(50%)");
    expect(zone3.contains(rightStack)).toBe(true);
    expect(fullScreen.contains(rightStack)).toBe(false);

    document.body.removeChild(zone3);
    document.body.removeChild(fullScreen);
  });
});

describe("<StoaAccountsTab activeNetwork> — 2026-09-26, owner directive: 'lets wire first the kadena switch, and read functions'", () => {
  async function renderTabNetwork(activeNetwork: "stoa" | "kadena", seeds: IStoaChainSeed[] = []) {
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} pairs={[]} />
        <StoaAccountsTab activeNetwork={activeNetwork} />
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Total Addresses/i)).toBeTruthy());
    return utils;
  }

  it("defaults to Stoa mode — the Stoa/UrStoa pill is unchanged when activeNetwork is omitted", async () => {
    await renderTab([], []);
    expect(screen.getByRole("button", { name: "Stoa" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "UrStoa" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Kadena mode morphs the pill: 'Stoa' becomes 'Kadena', 'UrStoa' is disabled — owner: 'make the selector Stoa/Urstoa disabled and morphed to Kadena in naming'", async () => {
    await renderTabNetwork("kadena");
    expect(screen.getByRole("button", { name: "Kadena" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stoa" })).toBeNull();
    expect((screen.getByRole("button", { name: "UrStoa" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Kadena mode hides the 'Send STOA' action — signing against real Kadena mainnet isn't wired yet", async () => {
    await renderTabNetwork(
      "kadena",
      [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] })],
    );
    await screen.findByText("Prime Codex Seed");
    expect(screen.queryByTitle("Send STOA")).toBeNull();
  });

  it("Stoa mode still shows 'Send STOA' — unaffected by the new prop's default", async () => {
    await renderTabNetwork(
      "stoa",
      [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] })],
    );
    await screen.findByText("Prime Codex Seed");
    expect(await screen.findByTitle("Send STOA")).toBeTruthy();
  });

  it("Kadena mode reads balances through kadenaReads' own client, not stoa-core's pactRead", async () => {
    kadenaDirtyRead.mockResolvedValue({
      result: { status: "success", data: [{ account: `k:${"a".repeat(64)}`, balance: 7.5, exists: true }] },
    });
    await renderTabNetwork(
      "kadena",
      [seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] })],
    );
    await waitFor(() => expect(kadenaDirtyRead).toHaveBeenCalled());
    // 20 Kadena chains, one batched call each (KADENA_CHAINS, not STOA_CHAINS' 10).
    expect(kadenaDirtyRead.mock.calls.length).toBeGreaterThanOrEqual(20);
  });
});
