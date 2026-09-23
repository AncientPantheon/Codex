/**
 * PureKeypairsTab specs — updated for the v0.5.x upgraded interface:
 *   • 3 subtabs (List / Generate / Import)
 *   • List rows are EXPANDABLE (Ouronet-Accounts style): a collapsed header
 *     (icon + label + badge) expands to reveal the public key, a password-gated
 *     "View Private Key" reveal, and the delete control.
 *   • Protected keys (CodexGuard / Duo) have their delete DISABLED at the UI.
 *   • Import validates a pasted pair by re-deriving the public key.
 */

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, usePureKeypairs } from "@ancientpantheon/codex-ouronet/hooks";
import { PureKeypairsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

const kpFx = (over: Partial<IPureKeypair> = {}): IPureKeypair => ({
  id: over.id ?? "kp-1",
  label: over.label,
  publicKey: over.publicKey ?? "a".repeat(64),
  encryptedPrivateKey: "enc",
  createdAt: "2026-05-25T10:00:00.000Z",
  ...over,
});

function Seeder({ pairs }: { pairs: IPureKeypair[] }) {
  const { addKeypair } = usePureKeypairs();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) pairs.forEach((p) => void addKeypair(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(pairs: IPureKeypair[] = []) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder pairs={pairs} />
      <PureKeypairsTab />
    </CodexProvider>,
  );
  if (pairs.length > 0) {
    await waitFor(() => expect(document.querySelectorAll("[data-keypair-id]").length).toBe(pairs.length));
  } else {
    await waitFor(() => expect(screen.getByText(/No pure keypairs/i)).toBeTruthy());
  }
  return utils;
}

/** Expand a collapsed keypair row by clicking its header. */
const expandRow = (card: HTMLElement) => fireEvent.click(card.querySelector("div") as HTMLElement);

describe("<PureKeypairsTab>", () => {
  it("renders the empty state + the 3 subtab pills when the codex holds no keypairs", async () => {
    await renderTab([]);
    expect(screen.getByText(/No pure keypairs/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeTruthy();
  });

  it("shows a collapsed row by label, expanding to reveal the public key + private-key control", async () => {
    await renderTab([kpFx({ id: "kp-1", label: "Trading", publicKey: "b".repeat(64) })]);
    expect(screen.getByText("Trading")).toBeTruthy();
    // Public key is hidden until expanded.
    expect(screen.queryByText("b".repeat(64))).toBeNull();
    const card = screen.getByText("Trading").closest("[data-keypair-id]") as HTMLElement;
    expandRow(card);
    expect(await within(card).findByText("b".repeat(64))).toBeTruthy();
    expect(within(card).getByRole("button", { name: /show private key/i })).toBeTruthy();
  });

  it("exposes the public+private import inputs under the Import subtab", async () => {
    await renderTab([]);
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    expect(screen.getByPlaceholderText(/private \(secret\) key/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/public key/i)).toBeTruthy();
  });

  it("accepts a 128-hex Chainweaver extended key in the Import subtab and validates the match", async () => {
    // Real vector: this 128-hex BIP32-Ed25519 key (kL‖kR) derives this pubkey.
    const PUB = "d8d5628bf6e932ac4601a038d361000246faf20a4e90d6f23998cbb834ef5f49";
    const PRIV =
      "88aa38fba13aa1ab76b3265be5f88cc6635a79b7dbe00652a2e628b3aa1b6440" +
      "4066f4b2a77f41ade24c80649797f05fbc3d9fa960bce7ff4c9c2e841430d6f3";
    await renderTab([]);
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    fireEvent.change(screen.getByPlaceholderText(/public key/i), {
      target: { value: PUB },
    });
    fireEvent.change(screen.getByPlaceholderText(/private \(secret\) key/i), {
      target: { value: PRIV },
    });
    // No "must be 64 hex" rejection; the extended key validates as a match.
    expect(await screen.findByText(/Keys match/i)).toBeTruthy();
    const addBtn = screen.getByRole("button", {
      name: /add to codex/i,
    }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
  });

  it("mints a keypair under the Generate subtab", async () => {
    await renderTab([]);
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate keypair/i }));
    expect(await screen.findByText(/save this private key/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /save to codex/i })).toBeTruthy();
  });

  it("deletes an unprotected keypair from the expanded row", async () => {
    await renderTab([kpFx({ id: "kp-del", publicKey: "c".repeat(64) })]);
    const card = screen.getByText("Pure Key #1").closest("[data-keypair-id]") as HTMLElement;
    expandRow(card);
    fireEvent.click(within(card).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(document.querySelectorAll("[data-keypair-id]").length).toBe(0));
  });

  it("disables deletion for a protected CodexGuard key (UI-level protection)", async () => {
    await renderTab([
      kpFx({ id: "kp-guard", publicKey: "d".repeat(64), isCodexGuard: true, label: "GuardianKey" }),
    ]);
    const card = screen.getByText("GuardianKey").closest("[data-keypair-id]") as HTMLElement;
    expandRow(card);
    expect(within(card).getByRole("button", { name: /cannot be removed/i })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(screen.getByText("GuardianKey")).toBeTruthy();
  });
});

describe("<PureKeypairsTab> — mobile: the subtab row is centered (design.md §8, the 'optimize each blockchain and tab' round)", () => {
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

  it("centers the Keys/Generate/Import row — accessible names (aria-label) still carry the same text", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <CodexUiRoot>
          <PureKeypairsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    const keysBtn = await screen.findByRole("button", { name: /keys \(0\)/i });
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
    const row = keysBtn.parentElement as HTMLElement;
    expect(row.style.justifyContent).toBe("center");
    cleanup();
    vi.unstubAllGlobals();
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — still left-aligned/wrapping", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <PureKeypairsTab />
      </CodexProvider>,
    );
    const keysBtn = await screen.findByRole("button", { name: /keys \(0\)/i });
    const row = keysBtn.parentElement as HTMLElement;
    expect(row.style.justifyContent).toBe("flex-start");
  });

  // Round 26 owner correction: "the 3 buttons from pure keys are a bit to
  // big, making the view get a horisontal scroll... we should move to
  // icons instead of thsse buttons. Then the buttons need to stay put,
  // scrolling shouldnt move them."
  it("mobile: renders icon-only (no visible text labels), with the Keys count as a small corner badge instead of inline text", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <CodexUiRoot>
          <PureKeypairsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    // Still reachable by accessible name (aria-label)...
    const keysBtn = await screen.findByRole("button", { name: /keys \(0\)/i });
    // ...but the VISIBLE text is gone (0 keys → no badge rendered either).
    expect(keysBtn.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Generate" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Import" }).textContent).toBe("");
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mobile: a non-zero Keys count renders as a visible corner badge", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder pairs={[kpFx({ id: "kp-1", label: "Alpha" })]} />
        <CodexUiRoot>
          <PureKeypairsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    const keysBtn = await screen.findByRole("button", { name: /keys \(1\)/i });
    expect(keysBtn.textContent).toBe("1");
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mobile: the subtab row is pinned via position: sticky, so scrolling the list below never moves it", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <CodexUiRoot>
          <PureKeypairsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    const keysBtn = await screen.findByRole("button", { name: /keys \(0\)/i });
    const row = keysBtn.parentElement as HTMLElement;
    expect(row.style.position).toBe("sticky");
    expect(row.style.top).toBe("0px");
    cleanup();
    vi.unstubAllGlobals();
  });

  it("desktop: the subtab row is NOT sticky, unchanged", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <PureKeypairsTab />
      </CodexProvider>,
    );
    const keysBtn = await screen.findByRole("button", { name: /keys \(0\)/i });
    const row = keysBtn.parentElement as HTMLElement;
    expect(row.style.position).toBe("");
  });
});

describe("<PureKeypairsTab> — mobile: scroll-snap on each row (design.md §8, the 'further optimize round 6' — owner correction: 'i want scrolling to show full entries... this must be done everywhere')", () => {
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

  it("each keypair row opts into scroll-snap (scrollSnapAlign: start) on mobile", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder pairs={[kpFx({ id: "kp-1", label: "Alpha" })]} />
        <CodexUiRoot>
          <PureKeypairsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    const card = (await screen.findByText("Alpha")).closest("[data-keypair-id]") as HTMLElement;
    expect(card.style.scrollSnapAlign).toBe("start");
    cleanup();
    vi.unstubAllGlobals();
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — no scroll-snap", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder pairs={[kpFx({ id: "kp-1", label: "Alpha" })]} />
        <PureKeypairsTab />
      </CodexProvider>,
    );
    const card = (await screen.findByText("Alpha")).closest("[data-keypair-id]") as HTMLElement;
    expect(card.style.scrollSnapAlign).toBe("");
  });
});

// Round 26 owner correction: "The key entries need to have same height as
// the seed entries, slim and they woould allow for a lot of entries even
// on smaller pages."
describe("<PureKeypairsTab> — mobile: slim row header, matching SeedRow (round 26)", () => {
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

  it("mobile: drops the 32×32 avatar circle for a small 10×10 colour dot, and trims the row's own padding", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder pairs={[kpFx({ id: "kp-1", label: "Alpha" })]} />
        <CodexUiRoot>
          <PureKeypairsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    const label = await screen.findByText("Alpha");
    const header = label.parentElement as HTMLElement;
    expect(header.style.padding).toBe("6px 16px");
    // No 32×32 avatar circle anywhere in this row any more.
    const card = label.closest("[data-keypair-id]") as HTMLElement;
    expect(card.querySelector('[style*="width: 32px"]')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
  });

  it("desktop: still shows the 32×32 avatar circle and the original padding, unchanged", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder pairs={[kpFx({ id: "kp-1", label: "Alpha" })]} />
        <PureKeypairsTab />
      </CodexProvider>,
    );
    const label = await screen.findByText("Alpha");
    const header = label.parentElement as HTMLElement;
    expect(header.style.padding).toBe("12px 16px");
    const card = label.closest("[data-keypair-id]") as HTMLElement;
    expect(card.querySelector('[style*="width: 32px"]')).not.toBeNull();
  });
});

// Round 9/10 owner correction: "we need pagination on the pure keys as
// well, which should kick in once enough entries exist, of course."
describe("<PureKeypairsTab> — mobile: pagination (round 9/10 — 'we need pagination on the pure keys as well, which should kick in once enough entries exist')", () => {
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

  async function renderTabMobile(pairs: IPureKeypair[] = []) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder pairs={pairs} />
        <CodexUiRoot>
          <PureKeypairsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /keys \(\d+\)/i })).toBeTruthy());
    return utils;
  }

  it("no pagination controls when everything fits on one page", async () => {
    await renderTabMobile([kpFx({ id: "kp-1", label: "Alpha" })]);
    await screen.findByText("Alpha");
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
  });

  it("paginates using the MEASURED page size, with Prev/Next controls", async () => {
    // jsdom never resolves real layout (`clientHeight` stays 0), so the
    // hook stays at its safe DEFAULT of 4 rows/page — 6 keypairs → 2 pages
    // (4 + 2).
    const pairs = Array.from({ length: 6 }, (_, i) => kpFx({ id: `kp-${i}`, label: `Key${String(i).padStart(2, "0")}` }));
    await renderTabMobile(pairs);
    expect(await screen.findByText("Key00")).toBeTruthy();
    expect(screen.getByText("Key03")).toBeTruthy();
    expect(screen.queryByText("Key04")).toBeNull();
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Key04")).toBeTruthy();
    expect(screen.getByText("Key05")).toBeTruthy();
    expect(screen.queryByText("Key00")).toBeNull();
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("reports the handle upward instead of rendering inline once a caller opts in", async () => {
    type PaginationHandle = { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null;
    const handleRef: { current: PaginationHandle } = { current: null };
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const pairs = Array.from({ length: 6 }, (_, i) => kpFx({ id: `kp-${i}`, label: `Key${String(i).padStart(2, "0")}` }));
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder pairs={pairs} />
        <CodexUiRoot>
          <PureKeypairsTab onPaginationHandleChange={(h) => { handleRef.current = h; }} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await screen.findByText("Key00");
    expect(handleRef.current).toEqual(expect.objectContaining({ page: 0, totalPages: 2 }));
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();

    act(() => handleRef.current?.onNext());
    await waitFor(() => expect(screen.getByText("Key04")).toBeTruthy());
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — no pagination controls, every keypair renders unconditionally", async () => {
    const pairs = Array.from({ length: 6 }, (_, i) => kpFx({ id: `kp-${i}`, label: `Key${String(i).padStart(2, "0")}` }));
    await renderTab(pairs);
    for (let i = 0; i < 6; i++) expect(screen.getByText(`Key${String(i).padStart(2, "0")}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
  });
});
