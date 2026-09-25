/**
 * OuronetAccountsTab — mobile (docs/work/codex-ui-mobile/design.md §8, the
 * "Zone 3" round + several follow-up feedback rounds, most recently
 * "variable mobile pagination"): a FIXED single-line icon button row (4
 * filters left, 2 spawn actions right — NO Expand All, gapped from the
 * entries below it), and ONE CONTINUOUS `SwipeDeck` spanning the WHOLE
 * (unpaginated) account list, chunked at the EXACT measured row count that
 * fits Zone 3's real height (`useMobilePageSize` — no quantization to a
 * fixed candidate set the way the earlier `useSwipeDivisor` did; "recount
 * the number of pages needed" live off the same measurement). A "page" and
 * an inner "swipe chunk" are now the SAME thing — there is no more separate
 * outer (fixed-count) / inner (measured) split — so `GroupedSwipeBullets`
 * runs with `chunksPerPage=1`, i.e. exactly one dot per page (no grouping).
 * Swiping past the last row of one page continues straight into the next
 * page's first row (no page-boundary interruption), with the outer
 * Prev/Next pagination stripe (portaled to a host-supplied riser slot,
 * falling back to a self-positioned cluster) both reflecting AND driving
 * that same continuous position — and, since page count and chunk count are
 * now the same number, the Prev/Next stripe and the bullets strip always
 * show/hide TOGETHER (a real simplification from the prior two-tier
 * scheme). The deck's own built-in dot/arrow indicator is suppressed
 * (`hideIndicators`) — Zone 3 is a bordered/clipped box, so "the lines
 * showing there is swipeable content" now live OUTSIDE it entirely, via
 * that same pagination stripe. Tapping a row opens its expanded detail as a
 * full-screen `CodexModalShell` (owner correction: "we remove the expansion
 * but we forgot to readd it... normally the content... should be a display
 * fullscreen of its expansion box") — not an inline block, and not a batch
 * Expand-All toggle. Prime rows are colour-coded (no separator bar, pinned
 * once at the very start of the continuous list, not per page) and Spawn
 * opens full-screen when a `fullScreenPortalTarget` is supplied — the row
 * expand modal shares that exact same prop/contract.
 *
 * jsdom never resolves real layout (`clientHeight` stays 0), so
 * `useMobilePageSize` never gets a real measurement and stays at its safe
 * DEFAULT (4 rows/page) throughout — deterministic for every spec below.
 * Real measurement (a live ResizeObserver + real layout) is a browser-only
 * concern this suite can't exercise.
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

// DPL-UR chain-symbol audit follow-up (2026-09-25): mock the package-LOCAL
// getAccountSelectorDataLive (../src/zbom/ouroSelectorReads.js) instead of
// @ouronet/ouronet-core's getAccountSelectorData — see
// useAccountChainData.ts's own doc comment for why the import moved.
vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorDataLive: async () => [] };
});

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useOuroAccounts } from "@ancientpantheon/codex-ouronet/hooks";
import { OuronetAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ouroFx = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: over.id ?? "o1",
  name: over.name ?? "My Account",
  version: "1.0.0",
  isSmart: over.isSmart ?? false,
  address: over.address ?? "Ѻ." + (over.id ?? "o1"),
  guard: over.guard ?? null,
  stoaChainLedger: null,
  publicKey: over.publicKey ?? "p".repeat(64),
  secret: "s",
  backup: "b",
  ...over,
});

/** N standard accounts (index 0 becomes CodexPrime regardless of its own name). */
const manyAccounts = (n: number): IOuroAccount[] =>
  Array.from({ length: n }, (_, i) => ouroFx({ id: `o${i}`, name: `Account ${i}`, address: `Ѻ.o${i}` }));

function Seeder({ accounts }: { accounts: IOuroAccount[] }) {
  const { addAccount } = useOuroAccounts();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) accounts.forEach((a) => void addAccount(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderMobile(
  accounts: IOuroAccount[],
  props: React.ComponentProps<typeof OuronetAccountsTab> = {},
) {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder accounts={accounts} />
      <CodexUiRoot>
        <OuronetAccountsTab {...props} />
      </CodexUiRoot>
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByText("CodexPrime")).toBeTruthy());
  return utils;
}

describe("<OuronetAccountsTab> — mobile: the fixed icon-only button row", () => {
  it("renders the 4 filters + 2 spawn actions as icon-only buttons — NO Expand All (row expansion is per-row full-screen, not a batch toggle)", async () => {
    await renderMobile(manyAccounts(3));
    expect(screen.getByRole("button", { name: /^Standard \(3\)$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Smart \(0\)$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Single API/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Dual API/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spawn Standard Account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spawn Smart Account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /expand all/i })).toBeNull();
  });
});

describe("<OuronetAccountsTab> — mobile: the measured page size (useMobilePageSize), continuous across the WHOLE list", () => {
  // The deck's own dot/arrow indicator is suppressed on this screen
  // (`hideIndicators` — an earlier feedback round: "the lines showing
  // there is swipeable content are outside the box of Zone 3"), so chunk
  // count is asserted via each pane's own `data-mobile-swipe-chunk` marker
  // instead of the (absent) "go to pane" dots.

  it("13 accounts: chunks of 3 + 4 + 4 + 1 (page 0 alone is shrunk by the 1 pinned CodexPrime row; every OTHER page stays at the full measured size)", async () => {
    // 13 total: index 0 is CodexPrime (pinned outside the chunks, taking up
    // 1 of page 0's 4 slots), leaving 12 in restList — 3 (page 0's own
    // share) + 4 + 4 + 1 at the default page size. Owner correction
    // (design.md §8, round 8): "if 8 positions fit on a page, they must
    // all be occupied" — this used to be a flat 4 + 4 + 4 (3 chunks) in
    // this jsdom-default scenario because the OLD hook's prime deduction
    // only ever applied once a REAL (nonzero) measurement landed, so the
    // bug was invisible here even though it's the exact same math bug a
    // real device hits — the fix (subtracting prime rows only from page
    // 0's OWN slice, not the shared page-size constant) applies
    // unconditionally now, real measurement or fallback default alike.
    const { container } = await renderMobile(manyAccounts(13));
    expect(container.querySelectorAll("[data-mobile-swipe-chunk]")).toHaveLength(4);
  });

  it("7 accounts: chunks of 3 + 3 (page 0's own share shrunk by 1 for the pinned row)", async () => {
    // 7 total → restList 6 → page 0 gets 4-1=3 slots, page 1 gets the full 3 left.
    const { container } = await renderMobile(manyAccounts(7));
    expect(container.querySelectorAll("[data-mobile-swipe-chunk]")).toHaveLength(2);
  });

  it("3 accounts (all fit in one page): only 1 pane", async () => {
    const { container } = await renderMobile(manyAccounts(3));
    expect(container.querySelectorAll("[data-mobile-swipe-chunk]")).toHaveLength(1);
  });

  it("25 accounts: chunking runs over the WHOLE restList continuously, not capped at any fixed outer-page count, and no page but the first is ever short a slot", async () => {
    // 25 total → restList 24 → page 0: 3 (4-1) + five more pages at the
    // FULL size of 4 (3+4+4+4+4+4+1=24) = 7 continuous chunks — there is no
    // more fixed 12-per-outer-page cap to be bound by, and (the round 8 fix)
    // no page but the very first ever loses a slot to the prime-row deduction.
    const { container } = await renderMobile(manyAccounts(25));
    expect(container.querySelectorAll("[data-mobile-swipe-chunk]")).toHaveLength(7);
  });

  it("owner correction: 'if 8 positions fit on a page, they must all be occupied' — every page but the first (which alone shares its slots with the pinned row) is filled to the FULL measured page size", async () => {
    // 13 total → restList 12 → page 0 TOTAL rendered rows = 1 pinned
    // CodexPrime + 3 of its own restList share = 4 (the FULL page size,
    // same as every other page) — pages 1/2 get the full 4 (no prime row
    // to share with), page 3 gets whatever's left (1). Every page but the
    // last is completely full; the bug this fixes was page 0 ending up
    // with an empty slot relative to the others.
    const { container } = await renderMobile(manyAccounts(13));
    const chunks = Array.from(container.querySelectorAll("[data-mobile-swipe-chunk]"));
    const rowCounts = chunks.map((c) => (c as HTMLElement).querySelectorAll("[data-account-id]").length);
    expect(rowCounts).toEqual([4, 4, 4, 1]);
  });

  it("never re-renders the pinned CodexPrime row inside any chunk but the very first (no more per-page repeat)", async () => {
    const { container } = await renderMobile(manyAccounts(25));
    const chunks = container.querySelectorAll("[data-mobile-swipe-chunk]");
    expect(within(chunks[0] as HTMLElement).queryByText("CodexPrime")).toBeTruthy();
    expect(within(chunks[1] as HTMLElement).queryByText("CodexPrime")).toBeNull();
  });
});

describe("<OuronetAccountsTab> — mobile: tapping a row opens its expanded detail full screen (owner correction: \"we remove the expansion but we forgot to readd it\")", () => {
  it("opens a full-screen CodexModalShell with the account's expanded detail, closable via its own close button", async () => {
    const { container } = await renderMobile(manyAccounts(2));
    const row = container.querySelector("[data-account-id]") as HTMLElement;
    const accountId = row.getAttribute("data-account-id") as string;
    const header = row.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(header);

    // The chevron flips to indicate the row is now expanded...
    expect(row.querySelector("svg.lucide-chevron-down")).toBeTruthy();
    // ...and a full-screen modal (NOT an inline block under the row) carries
    // the expanded content — same "expand modal" `data-testid` convention
    // `PureKeyRow`'s (round 27) and `SeedRow`'s (round 21) own full-screen
    // expand popups already use.
    const modal = screen.getByTestId(`ouronet-account-expand-modal-${accountId}`);
    expect(modal).toBeTruthy();
    expect(within(modal).queryByText(/Ouronet Account/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId("ouronet-account-expand-close"));
    expect(screen.queryByTestId(`ouronet-account-expand-modal-${accountId}`)).toBeNull();
  });

  it("portals the expand modal into the supplied fullScreenPortalTarget, escaping this tab's own bounded Zone 3", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const { container } = await renderMobile(manyAccounts(2), { fullScreenPortalTarget: target });
    const row = container.querySelector("[data-account-id]") as HTMLElement;
    const accountId = row.getAttribute("data-account-id") as string;
    fireEvent.click(row.querySelector('[role="button"]') as HTMLElement);

    const modal = screen.getByTestId(`ouronet-account-expand-modal-${accountId}`);
    expect(target.contains(modal)).toBe(true);
    expect(container.contains(modal)).toBe(false);
    document.body.removeChild(target);
  });
});

describe("<OuronetAccountsTab> — mobile: icon-only badges (Prime/Standard-Smart/Selected/Active), not text pills", () => {
  it("CodexPrime's row shows a Lock icon badge, not the '🔒 Prime' text pill", async () => {
    const { container } = await renderMobile(manyAccounts(1));
    expect(screen.queryByText(/🔒\s*Prime/)).toBeNull();
    const primeBadge = screen.getByLabelText("Prime");
    expect(primeBadge).toBeTruthy();
    const row = container.querySelector("[data-account-id]") as HTMLElement;
    expect(row.contains(primeBadge)).toBe(true);
  });

  it("shows a Standard/Smart icon badge (the SAME User/Sparkles icons the filter row uses), not a text pill", async () => {
    await renderMobile(manyAccounts(2));
    // Both accounts are Standard — one badge per row, not a bare-text pill.
    expect(screen.getAllByLabelText("Standard")).toHaveLength(2);
  });

  it("shows an Active/Inactive icon badge, not the green/red text pill", async () => {
    await renderMobile(manyAccounts(1));
    // No live chain data in this suite — whichever state it resolves to,
    // the badge carries it via aria-label, never as bare pill text.
    const badge = screen.queryByLabelText("Active") ?? screen.queryByLabelText("Inactive");
    expect(badge).toBeTruthy();
    expect(screen.queryByText(/^Active$/)).toBeNull();
    expect(screen.queryByText(/^Inactive$/)).toBeNull();
  });
});

describe("<OuronetAccountsTab> — mobile: no separator bar above/below CodexPrime (design.md §8, the follow-up feedback round)", () => {
  it("does not render the 'Other ... accounts' separator bar — CodexPrime is colour-coded instead (AccountRow's own border/background)", async () => {
    await renderMobile(manyAccounts(3));
    expect(screen.queryByText(/Other standard accounts/i)).toBeNull();
  });

  it("the fixed button row keeps a real gap above the account entries (not flush)", async () => {
    const { container } = await renderMobile(manyAccounts(1));
    const buttonRow = screen.getByRole("button", { name: /^Standard/ }).parentElement as HTMLElement;
    expect(buttonRow.style.marginBottom).not.toBe("");
    expect(buttonRow.style.marginBottom).not.toBe("0px");
    void container;
  });
});

describe("<OuronetAccountsTab> — mobile: the Spawn interface renders full-screen (design.md §8, the follow-up feedback round)", () => {
  it("without fullScreenPortalTarget: SpawnAccountModal mounts inline (the fallback, unaffected)", async () => {
    const { container } = await renderMobile(manyAccounts(1));
    fireEvent.click(screen.getByRole("button", { name: "Spawn Standard Account" }));
    const dialog = await screen.findByRole("dialog");
    expect(container.contains(dialog)).toBe(true);
  });

  it("WITH fullScreenPortalTarget: SpawnAccountModal portals there instead — 'the whole screen, not only on zone 3'", async () => {
    const portalTarget = document.body.appendChild(document.createElement("div"));
    const { container } = await renderMobile(manyAccounts(1), { fullScreenPortalTarget: portalTarget });
    fireEvent.click(screen.getByRole("button", { name: "Spawn Standard Account" }));
    const dialog = await screen.findByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(portalTarget.contains(dialog)).toBe(true);
    document.body.removeChild(portalTarget);
  });
});

describe("<OuronetAccountsTab> — mobile: outer Prev/Next pagination (the middle riser stripe)", () => {
  it("without a riser target: falls back to a self-positioned cluster", async () => {
    // 10 total → restList 9 → default page size 4 → ceil(9/4) = 3 pages.
    const { container } = await renderMobile(manyAccounts(10));
    const prev = screen.getByRole("button", { name: /previous page/i });
    const next = screen.getByRole("button", { name: /next page/i });
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);
    expect(container.contains(prev)).toBe(true);
  });

  it("WITH a riser target: portals the Prev/Next cluster there instead", async () => {
    const riserSlot = document.body.appendChild(document.createElement("div"));
    const { container } = await renderMobile(manyAccounts(10), { paginationRiserTarget: riserSlot });
    const next = screen.getByRole("button", { name: /next page/i });
    expect(container.contains(next)).toBe(false);
    expect(riserSlot.contains(next)).toBe(true);
    document.body.removeChild(riserSlot);
  });

  it("the bullets strip is a SEPARATE portal target from the Prev/Next stripe — 'they work in concert but they are different entities'", async () => {
    const paginationSlot = document.body.appendChild(document.createElement("div"));
    const bulletsSlot = document.body.appendChild(document.createElement("div"));
    await renderMobile(manyAccounts(10), {
      paginationRiserTarget: paginationSlot,
      swipeIndicatorRiserTarget: bulletsSlot,
    });
    const next = screen.getByRole("button", { name: /next page/i });
    const bullet = screen.getByRole("button", { name: "Go to swipe 1 of page 1" });
    expect(paginationSlot.contains(next)).toBe(true);
    expect(paginationSlot.contains(bullet)).toBe(false);
    expect(bulletsSlot.contains(bullet)).toBe(true);
    expect(bulletsSlot.contains(next)).toBe(false);
    document.body.removeChild(paginationSlot);
    document.body.removeChild(bulletsSlot);
  });

  it("clicking Next actually advances the page — 6 accounts (restList 5, default page size 4) → exactly 2 pages", async () => {
    await renderMobile(manyAccounts(6));
    expect((screen.getByRole("button", { name: /previous page/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /next page/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: /previous page/i }) as HTMLButtonElement).disabled).toBe(false);
    });
    // Exactly 2 pages here — landing on page 2 means Next is now the one disabled.
    expect((screen.getByRole("button", { name: /next page/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("with a single page: no pagination cluster at all", async () => {
    // 3 accounts → restList 2, well under the default page size (4) → 1
    // chunk, 1 page — genuinely nothing swipeable, so no cluster at all.
    await renderMobile(manyAccounts(3));
    expect(screen.queryByRole("button", { name: /next page/i })).toBeNull();
  });

  it("the Prev/Next stripe and the bullets strip now show/hide TOGETHER — a page and a swipe chunk are the SAME thing since the 'variable mobile pagination' round (previously they could diverge under the old fixed-12-outer-page scheme)", async () => {
    // 7 accounts → restList 6 → default page size 4 → 2 pages — both
    // clusters must be present.
    await renderMobile(manyAccounts(7));
    expect(screen.getByRole("button", { name: /next page/i })).toBeTruthy();
    expect(screen.getAllByLabelText(/go to swipe/i).length).toBeGreaterThan(0);
  });

  it("continuous sweep: Next/Prev walk the SAME underlying position a swipe would — 10 accounts (restList 9, page size 4) → exactly 3 pages, round-trip Next×2 then Prev×2 returns to the start", async () => {
    await renderMobile(manyAccounts(10));
    expect((screen.getByRole("button", { name: "Go to swipe 1 of page 1" })).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Go to swipe 1 of page 2" })).getAttribute("aria-pressed")).toBe("true");
    });
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Go to swipe 1 of page 3" })).getAttribute("aria-pressed")).toBe("true");
    });
    expect((screen.getByRole("button", { name: /next page/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Go to swipe 1 of page 2" })).getAttribute("aria-pressed")).toBe("true");
    });
    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Go to swipe 1 of page 1" })).getAttribute("aria-pressed")).toBe("true");
    });
    expect((screen.getByRole("button", { name: /previous page/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switching tabs resets the continuous sweep position back to swipe 1 of page 1", async () => {
    await renderMobile(manyAccounts(10));
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Go to swipe 1 of page 2" })).getAttribute("aria-pressed")).toBe("true");
    });
    fireEvent.click(screen.getByRole("button", { name: /^Smart/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Standard/ }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Go to swipe 1 of page 1" })).getAttribute("aria-pressed")).toBe("true");
    });
  });
});

describe("<OuronetAccountsTab> — mobile: swipe bullets are now FLAT (chunksPerPage=1, no more grouping — a page and a swipe chunk are the same thing since the 'variable mobile pagination' round)", () => {
  it("shows exactly ONE bullet for the active page — never 'swipe 2/3 of page N' labels anymore (that grouping concept is gone)", async () => {
    // 10 total → restList 9 → default page size 4 → 3 pages. jsdom's
    // zero-width default windows the strip down to just the ACTIVE page's
    // own bullet (see the ellipsis test below) — this asserts page 1's
    // bullet specifically, and that no "swipe 2 of page 1" (the OLD
    // grouped-bullet shape) ever renders, on ANY page.
    await renderMobile(manyAccounts(10));
    expect(screen.getByRole("button", { name: "Go to swipe 1 of page 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go to swipe 2 of page 1" })).toBeNull();
  });

  it("navigating to page 2 via Prev/Next re-centers the strip on page 2's own bullet", async () => {
    await renderMobile(manyAccounts(10));
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => {
      const bullet = screen.getByRole("button", { name: "Go to swipe 1 of page 2" });
      expect(bullet.getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.queryByRole("button", { name: "Go to swipe 1 of page 1" })).toBeNull();
  });

  it("clicking the active page's own bullet keeps it pressed (a real, working control, not decorative)", async () => {
    await renderMobile(manyAccounts(10));
    const bullet = screen.getByRole("button", { name: "Go to swipe 1 of page 1" });
    expect(bullet.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(bullet);
    expect(bullet.getAttribute("aria-pressed")).toBe("true");
  });

  it("reserves BOTH ellipsis slots in the DOM at all times — only their text content toggles, so the visible bullets never shift", async () => {
    const { container } = await renderMobile(manyAccounts(10));
    const lead = container.querySelector('[data-swipe-ellipsis="lead"]');
    const trail = container.querySelector('[data-swipe-ellipsis="trail"]');
    expect(lead).toBeTruthy();
    expect(trail).toBeTruthy();
    // jsdom never resolves real width (`clientWidth` stays 0) — the strip's
    // safe default windows down to just the active page's own bullet, so
    // with 3 pages here, the trailing slot truncates (pages 2-3 hidden)
    // while the leading slot (already on page 1) doesn't.
    expect(lead!.textContent).toBe("");
    expect(trail!.textContent).toBe("…");
  });
});
