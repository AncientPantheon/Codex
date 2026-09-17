/**
 * Toast chain-theming — the reported bug: an Arweave send's toast pointed
 * its "View on Explorer" link at `https://explorer.stoachain.com/transactions/`
 * with an Arweave tx id, which is a dead/wrong link for a completely
 * different chain. Under the hood `.submitted(id)` also unconditionally
 * kicked off `_pollConfirmation` — a StoaChain Pact `/api/v1/poll` request-key
 * poll — for an id that Pact node could never recognize, so an Arweave send
 * toast spun "Confirming…" for a pointless 200s timeout.
 *
 * Fix: `txPending(title, { chain })` tags the toast with its chain (defaults
 * to `"stoachain"`, zero behavior change for the 6 existing Kadena/Stoa
 * modals). `"arweave"` toasts:
 *   - skip the Pact poll entirely — `.submitted()` marks the toast DONE
 *     immediately (the gateway's 2xx accept, already true by the time
 *     `sendFrom` resolves, IS the meaningful success signal; there's no
 *     Pact-style request-key/sub-2-minute confirmation model to poll for).
 *   - render a ViewBlock explorer link (`viewblock.io/arweave/tx/<id>`,
 *     matching the address-page convention `ArweaveAccountsArea.tsx` already
 *     uses), not the StoaChain one.
 *   - use a distinct accent color (violet, not StoaChain gold) while active,
 *     so a stack of toasts reads "different chain" at a glance.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, act } from "@testing-library/react";
import { txPending, toastStore, onTxConfirmed, DISMISS_MS } from "../src/zbom/toast/toastManager";
import { MultiStepToastContainer } from "../src/zbom/toast/MultiStepToastContainer";

afterEach(() => {
  cleanup();
  // The toast store is module-global — drain it between tests so one test's
  // toasts never bleed into the next.
  for (const t of toastStore.getAll()) toastStore.remove(t.id);
});

describe("txPending — chain tagging", () => {
  it("defaults to the stoachain chain when no opts are given (existing 6 Kadena/Stoa modals, unchanged)", () => {
    txPending("Stake UrStoa").start();
    const [entry] = toastStore.getAll();
    expect(entry.chain).toBe("stoachain");
  });

  it("tags the toast entry with chain: 'arweave' when requested", () => {
    txPending("Send Arweave", { chain: "arweave" }).start();
    const [entry] = toastStore.getAll();
    expect(entry.chain).toBe("arweave");
  });
});

describe("txPending — .submitted() chain-aware confirmation", () => {
  it("stoachain (default): .submitted() stays in the active 'Confirming…' state (kicks off Pact polling, unchanged)", () => {
    const ctrl = txPending("Transfer UrStoa");
    ctrl.submitted("req-key-abc");
    const [entry] = toastStore.getAll();
    expect(entry.steps[0].status).toBe("active");
    expect(entry.steps[0].label).toBe("Confirming…");
  });

  it("arweave WITHOUT a pollFn: marks the toast DONE immediately (no confirmation model available)", () => {
    const ctrl = txPending("Send Arweave", { chain: "arweave" });
    ctrl.submitted("arweave-tx-id-123");
    const [entry] = toastStore.getAll();
    expect(entry.steps[0].status).toBe("done");
    expect(entry.steps[0].requestKey).toBe("arweave-tx-id-123");
  });

  it("arweave WITH a pollFn: stays 'Confirming…' until pollFn resolves 'confirmed', polling at 15s intervals", async () => {
    vi.useFakeTimers();
    try {
      const pollFn = vi.fn<(id: string) => Promise<"pending" | "confirmed" | "give-up">>();
      pollFn.mockResolvedValueOnce("pending").mockResolvedValueOnce("confirmed");
      const ctrl = txPending("Send Arweave", { chain: "arweave", pollFn });
      ctrl.submitted("tx-id-1");

      // Immediately after submit: still actively confirming, real network
      // hasn't been asked yet — the FIRST poll fires after one interval.
      expect(toastStore.getAll()[0].steps[0].status).toBe("active");
      expect(pollFn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(15_000);
      expect(pollFn).toHaveBeenCalledTimes(1);
      expect(toastStore.getAll()[0].steps[0].status).toBe("active"); // still pending

      await vi.advanceTimersByTimeAsync(15_000);
      expect(pollFn).toHaveBeenCalledTimes(2);
      const [entry] = toastStore.getAll();
      expect(entry.steps[0].status).toBe("done");
      expect(entry.steps[0].label).toBe("Confirmed");
      expect(entry.steps[0].requestKey).toBe("tx-id-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("arweave WITH a pollFn that returns 'give-up': stops polling immediately rather than exhausting the full ~10-minute budget", async () => {
    vi.useFakeTimers();
    try {
      const pollFn = vi.fn(async () => "give-up" as const);
      const ctrl = txPending("Send Arweave", { chain: "arweave", pollFn });
      ctrl.submitted("mock-tx-id");

      await vi.advanceTimersByTimeAsync(15_000);
      expect(pollFn).toHaveBeenCalledTimes(1);
      const [entry] = toastStore.getAll();
      expect(entry.steps[0].status).toBe("done");
      expect(entry.steps[0].label).toBe("Submitted");

      // Confirms it actually STOPPED — a further 10 minutes calls pollFn no more.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(pollFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("arweave WITH a pollFn: on real confirmation, fires onTxConfirmed — the SAME 'something confirmed, refresh' signal StoaChain's own poll fires, so a consumer (e.g. ArweaveAccountsArea's balance refresh) can react even though the send modal that started this poll is long since closed", async () => {
    vi.useFakeTimers();
    const heard = vi.fn();
    const unsubscribe = onTxConfirmed(heard);
    try {
      const pollFn = vi.fn(async () => "confirmed" as const);
      const ctrl = txPending("Send Arweave", { chain: "arweave", pollFn });
      ctrl.submitted("tx-id-confirm-signal");

      expect(heard).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it("arweave WITH a pollFn: exhausting the poll budget without confirmation falls back to 'Submitted', not stuck 'Confirming…' forever", async () => {
    vi.useFakeTimers();
    try {
      const pollFn = vi.fn(async () => "pending" as const);
      const ctrl = txPending("Send Arweave", { chain: "arweave", pollFn });
      ctrl.submitted("tx-id-2");

      // The full ~10-minute budget, plus slack.
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      const [entry] = toastStore.getAll();
      expect(entry.steps[0].status).toBe("done");
      expect(entry.steps[0].label).toBe("Submitted");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("txPending — chain-aware dismiss duration (10x for arweave, per explicit request)", () => {
  it("tags a stoachain toast with the default DISMISS_MS", () => {
    txPending("Stake UrStoa").start();
    const [entry] = toastStore.getAll();
    expect(entry.dismissMs).toBe(DISMISS_MS);
  });

  it("tags an arweave toast with 10x DISMISS_MS — Arweave blocks land far slower than Pact confirmation", () => {
    txPending("Send Arweave", { chain: "arweave" }).start();
    const [entry] = toastStore.getAll();
    expect(entry.dismissMs).toBe(DISMISS_MS * 10);
  });
});

describe("MultiStepToastContainer — chain-aware explorer link + accent", () => {
  it("an arweave toast's explorer link points at ViewBlock's Arweave tx page, not StoaChain's explorer", async () => {
    render(<MultiStepToastContainer />);
    const ctrl = txPending("Send Arweave", { chain: "arweave" });
    ctrl.submitted("rBNSMe0XEv1R0y61z7j-znkZjaoKl3XaKBfs6aYCuts");

    const card = await screen.findByText("Send Arweave");
    const container = card.closest("[data-toast-id]") as HTMLElement;
    const link = within(container).getByTitle("View on Explorer");
    expect(link.getAttribute("href")).toBe(
      "https://viewblock.io/arweave/tx/rBNSMe0XEv1R0y61z7j-znkZjaoKl3XaKBfs6aYCuts",
    );
    expect(link.getAttribute("href")).not.toContain("explorer.stoachain.com");
  });

  it("a stoachain toast's explorer link is unchanged (explorer.stoachain.com)", async () => {
    render(<MultiStepToastContainer />);
    const ctrl = txPending("Send Stoa");
    ctrl.done({ label: "Confirmed", requestKey: "kadena-req-key-xyz" });

    const card = await screen.findByText("Send Stoa");
    const container = card.closest("[data-toast-id]") as HTMLElement;
    const link = within(container).getByTitle("View on Explorer");
    expect(link.getAttribute("href")).toBe(
      "https://explorer.stoachain.com/transactions/kadena-req-key-xyz",
    );
  });

  it("an active (in-flight) arweave toast uses a distinct accent color from StoaChain gold", async () => {
    render(<MultiStepToastContainer />);
    txPending("Send Arweave", { chain: "arweave" }).start();

    const card = await screen.findByText("Send Arweave");
    const container = card.closest("[data-toast-id]") as HTMLElement;
    // Header status dot reflects the chain accent while the toast is active
    // (not yet done/error).
    const dot = container.querySelector('div[style*="border-radius: 50%"]') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).not.toBe("rgb(206, 172, 95)"); // #ceac5f (StoaChain gold)
  });

  it("a completed arweave toast's depletion bar lingers 10x longer than a stoachain one's", async () => {
    render(<MultiStepToastContainer />);
    txPending("Send Arweave", { chain: "arweave" }).submitted("some-id"); // no pollFn -> done immediately
    txPending("Send Stoa").done({ label: "Confirmed", requestKey: "req-1" });

    const arweaveCard = (await screen.findByText("Send Arweave")).closest("[data-toast-id]") as HTMLElement;
    const stoaCard = (await screen.findByText("Send Stoa")).closest("[data-toast-id]") as HTMLElement;
    const arweaveBar = arweaveCard.querySelector(".toast-deplete") as HTMLElement;
    const stoaBar = stoaCard.querySelector(".toast-deplete") as HTMLElement;
    expect(arweaveBar).toBeTruthy();
    expect(stoaBar).toBeTruthy();
    expect(arweaveBar.style.animationDuration).toBe(`${DISMISS_MS * 10}ms`);
    expect(stoaBar.style.animationDuration).toBe(`${DISMISS_MS}ms`);
  });

  it("an arweave toast that only reached 'Submitted' (broadcast succeeded, but confirmation unverified) gets the longer-wait caption, not the 'Confirmed' one", () => {
    render(<MultiStepToastContainer />);
    act(() => {
      txPending("Send Arweave", { chain: "arweave" }).submitted("id-2"); // no pollFn -> "Submitted"
    });

    const card = screen.getByText("Send Arweave");
    const container = card.closest("[data-toast-id]") as HTMLElement;
    expect(within(container).getByText(/broadcast succeeded/i)).toBeTruthy();
    expect(within(container).queryByText(/confirmed on-chain/i)).toBeNull();
  });

  it("a REAL-confirmed arweave toast (label 'Confirmed') gets the indexing-lag caption", async () => {
    vi.useFakeTimers();
    try {
      render(<MultiStepToastContainer />);
      const ctrl = txPending("Send Arweave", { chain: "arweave", pollFn: async () => "confirmed" as const });
      act(() => {
        ctrl.submitted("id-3");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      const card = screen.getByText("Send Arweave");
      const container = card.closest("[data-toast-id]") as HTMLElement;
      expect(within(container).getByText(/confirmed on-chain/i)).toBeTruthy();
      expect(within(container).queryByText(/broadcast succeeded/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stoachain toast never shows the explorer-lag caption (StoaChain's own explorer is first-party, no such lag)", () => {
    render(<MultiStepToastContainer />);
    act(() => {
      txPending("Send Stoa").done({ label: "Confirmed", requestKey: "req-1" });
    });

    const card = screen.getByText("Send Stoa");
    const container = card.closest("[data-toast-id]") as HTMLElement;
    expect(within(container).queryByText(/confirmed on-chain/i)).toBeNull();
    expect(within(container).queryByText(/broadcast succeeded/i)).toBeNull();
  });
});
