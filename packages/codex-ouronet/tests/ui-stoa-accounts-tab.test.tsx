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
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useStoaChainSeeds, usePureKeypairs } from "@ancientpantheon/codex-ouronet/hooks";
import { StoaAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IStoaChainSeed, IPureKeypair } from "@ancientpantheon/codex-ouronet/types";
import { setPactReader } from "@stoachain/stoa-core/reads";

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

// Stub the read seam so the tab's live-balance effect never touches the network.
beforeEach(() => {
  setPactReader(async () => ({ result: { data: [] } }) as never);
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
