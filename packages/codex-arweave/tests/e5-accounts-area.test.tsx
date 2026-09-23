/**
 * ArweaveAccountsArea — the Arweave "Accounts" category listing (T6).
 *
 * Presentational ONLY: it is handed the ciphertext `ForeignKeyEntry[]` plus the
 * known seeds and renders them grouped by the seed that produced them. It never
 * decrypts, never reads a store, never touches the network.
 *
 * Each case guards a user-visible regression:
 *   (a) rows out of index order read as a scrambled keyring — the `#N` position
 *       IS the key's identity inside its seed, so the order must be the seed's,
 *       not the array's.
 *   (b) an entry whose `seedId` names no known seed, and a LEGACY entry written
 *       before seed provenance existed, must still be reachable. Silently
 *       dropping either loses a key from the user's view — the worst failure
 *       this surface can have.
 *   (c) a row without its index + address tells the user nothing about which
 *       account it is.
 *   (d) an empty codex must say so rather than render blank (reads as a bug) or
 *       throw (kills the whole panel).
 *   (e) `encryptedKeyfile` is the only copy of the user's key material. It must
 *       never reach a DOM node, where it becomes copyable/inspectable.
 *   (f) a group that cannot be collapsed makes a 1000-key seed unusable.
 *   (g) STRUCTURAL PARITY with Chainweb's `StoaAccountsTab`: the user reads both
 *       chains' Accounts pages as one surface. A missing "Total Addresses"
 *       header, a missing Codex/Watched toggle, a group whose badge disagrees
 *       with the rows under it, or a prime group that does not announce itself
 *       as the Prime Arweave Seed all make Arweave read as a different (and
 *       less trustworthy) product than Chainweb.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor, act } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { winstonToAr } from "@ancientpantheon/arweave-core";
import { registerChainAddressValidator } from "@ancientpantheon/codex-ouronet/hooks";
import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";

import { ArweaveAccountsArea, type ArweaveAccountsAreaProps } from "../src/panel/ArweaveAccountsArea";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import { arweaveValidator } from "../src/address-book/arweaveValidator";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

const CIPHERTEXT = "ENCRYPTED-KEYFILE-CIPHERTEXT-MUST-NEVER-RENDER";

function makeEntry(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2)}`,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: CIPHERTEXT,
    ...overrides,
  };
}

function makeWatchEntry(overrides: Partial<WatchListEntry> = {}): WatchListEntry {
  return {
    id: `watch-${Math.random().toString(36).slice(2)}`,
    label: "",
    address: "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4",
    type: "arweave",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Round 19 owner correction: "the arweave account must be shorted same as
 * stoa accounts, first 3 last 3 characters coloured, and ... in the
 * middle." `ArweaveAddressHighlight` (the component this now renders
 * through) splits any address over 6 characters into 3 sibling `<span>`s
 * (head/mid/tail) for the per-edge colour — RTL's `getByText` does NOT
 * match text split across multiple elements by default (the classic
 * "text broken up by multiple elements" limitation). This custom matcher
 * targets the SAME node `getNodeText` would have matched pre-highlight —
 * the element whose OWN full (concatenated-children) `textContent` is
 * EXACTLY the given string — which is precisely `ArweaveAddressHighlight`'s
 * own outer wrapper span. Short fixture addresses (≤6 chars, e.g.
 * "ADDR-0") never split at all and still match a plain string query fine;
 * this is only needed for the longer ones.
 */
function addressText(text: string) {
  return (_: string, element: Element | null) => element?.textContent === text;
}

afterEach(() => cleanup());

describe("ArweaveAccountsArea", () => {
  it("renders a seed's entries ascending by index, regardless of array order", () => {
    const entries = [
      makeEntry({ id: "b", seedId: "seed-1", index: 2, address: "ADDR-TWO" }),
      makeEntry({ id: "c", seedId: "seed-1", index: 10, address: "ADDR-TEN" }),
      makeEntry({ id: "a", seedId: "seed-1", index: 0, address: "ADDR-ZERO" }),
    ];

    render(<ArweaveAccountsArea entries={entries} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

    const group = screen.getByTestId("arweave-accounts-group-seed-1");
    const rows = within(group).getAllByTestId("arweave-account-row");
    expect(rows.map((r) => r.getAttribute("data-index"))).toEqual(["0", "2", "10"]);
  });

  it("keeps each seed's own index space separate — #0 may exist under every seed", () => {
    const entries = [
      makeEntry({ id: "a", seedId: "seed-1", index: 0, address: "ADDR-A0" }),
      makeEntry({ id: "b", seedId: "seed-2", index: 0, address: "ADDR-B0" }),
    ];

    render(
      <ArweaveAccountsArea
        entries={entries}
        seeds={[
          { id: "seed-1", label: "Prime Arweave Seed" },
          { id: "seed-2", label: "Second Seed" },
        ]}
      />,
    );

    expect(within(screen.getByTestId("arweave-accounts-group-seed-1")).getByText(addressText("ADDR-A0"))).toBeInTheDocument();
    expect(within(screen.getByTestId("arweave-accounts-group-seed-2")).getByText(addressText("ADDR-B0"))).toBeInTheDocument();
  });

  it("puts a true-orphan (unknown seedId) entry under Unassigned, and a genuinely seedless (no seedId) entry under Pure Keys", () => {
    // Mid-task correction: seedless entries duplicate into the standalone
    // "Pure Keys" tab (`PureKeysArea.tsx`'s own `seedId === undefined` filter),
    // so this Accounts-side catch-all must label them the same way rather than
    // folding them into the same "Unassigned" bucket as a true orphan (a
    // `seedId` naming no known seed — unknown/legacy provenance).
    const entries = [
      makeEntry({ id: "known", seedId: "seed-1", index: 0, address: "ADDR-KNOWN" }),
      makeEntry({ id: "orphan", seedId: "seed-gone", index: 3, address: "ADDR-ORPHAN" }),
      makeEntry({ id: "legacy", address: "ADDR-LEGACY", label: "Imported key" }),
    ];

    render(<ArweaveAccountsArea entries={entries} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

    const unassigned = screen.getByTestId("arweave-accounts-group-unassigned");
    expect(within(unassigned).getByText(addressText("ADDR-ORPHAN"))).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();

    const pureKeys = screen.getByTestId("arweave-accounts-group-pure-keys");
    expect(within(pureKeys).getByText(addressText("ADDR-LEGACY"))).toBeInTheDocument();
    expect(screen.getByText("Pure Keys")).toBeInTheDocument();

    // The known entry stays in its own group — neither catch-all is a bucket for all.
    expect(within(unassigned).queryByText(addressText("ADDR-KNOWN"))).toBeNull();
    expect(within(pureKeys).queryByText(addressText("ADDR-KNOWN"))).toBeNull();
    // Cross-checks: the orphan is not in Pure Keys, the legacy/seedless entry is not in Unassigned.
    expect(within(unassigned).queryByText(addressText("ADDR-LEGACY"))).toBeNull();
    expect(within(pureKeys).queryByText(addressText("ADDR-ORPHAN"))).toBeNull();
    // Nothing is dropped: 3 in, 3 rendered.
    expect(screen.getAllByTestId("arweave-account-row")).toHaveLength(3);
  });

  it("renders no Unassigned group when every entry maps to a known seed", () => {
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" })]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
      />,
    );

    expect(screen.queryByTestId("arweave-accounts-group-unassigned")).toBeNull();
  });

  it("shows each row's index and address", () => {
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-1", index: 7, address: "ADDR-SEVEN" })]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
      />,
    );

    const row = screen.getByTestId("arweave-account-row");
    expect(row).toHaveTextContent("#7");
    expect(row).toHaveTextContent("ADDR-SEVEN");
  });

  it("renders a visible empty state for an empty entries array", () => {
    expect(() =>
      render(<ArweaveAccountsArea entries={[]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />),
    ).not.toThrow();

    const empty = screen.getByTestId("arweave-accounts-empty");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent ?? "").not.toHaveLength(0);
    expect(screen.queryAllByTestId("arweave-account-row")).toHaveLength(0);
  });

  it("never renders an encryptedKeyfile value into the DOM", () => {
    const { container } = render(
      <ArweaveAccountsArea
        entries={[
          makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" }),
          makeEntry({ address: "ADDR-LEGACY" }),
        ]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
      />,
    );

    expect(container.innerHTML).not.toContain(CIPHERTEXT);
    expect(document.body.innerHTML).not.toContain(CIPHERTEXT);
  });

  it("collapses and re-expands a seed group on header click", () => {
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" })]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
      />,
    );

    const toggle = screen.getByTestId("arweave-accounts-toggle-seed-1");
    expect(screen.getByText(addressText("ADDR-ZERO"))).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText(addressText("ADDR-ZERO"))).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText(addressText("ADDR-ZERO"))).toBeInTheDocument();
  });

  it("shows a seed with no entries as an empty group rather than hiding the seed", () => {
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" })]}
        seeds={[
          { id: "seed-1", label: "Prime Arweave Seed" },
          { id: "seed-2", label: "Unused Seed" },
        ]}
      />,
    );

    const unused = screen.getByTestId("arweave-accounts-group-seed-2");
    expect(within(unused).getByText("Unused Seed")).toBeInTheDocument();
    expect(within(unused).queryAllByTestId("arweave-account-row")).toHaveLength(0);
  });

  /* ── Chainweb (StoaAccountsTab) structural parity ── */

  it("reports Total Addresses as the number of Arweave keys, across every group", () => {
    // Regression: a header that counts groups (or only the known-seed entries)
    // tells the user they hold fewer keys than they do — including after an
    // orphaned key lands in Unassigned.
    render(
      <ArweaveAccountsArea
        entries={[
          makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-A0" }),
          makeEntry({ seedId: "seed-1", index: 1, address: "ADDR-A1" }),
          makeEntry({ seedId: "seed-gone", index: 0, address: "ADDR-ORPHAN" }),
        ]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
      />,
    );

    const total = screen.getByTestId("arweave-accounts-total");
    expect(total).toHaveTextContent("Total Addresses");
    expect(total).toHaveTextContent("3");
  });

  it("shows a Codex Accounts / Watched Accounts toggle, Watched at 0", () => {
    // Regression: Arweave must read identically to Chainweb. A Watched count
    // that mirrored the codex count would claim watched addresses exist when
    // Arweave has no watch-list at all.
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" })]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
      />,
    );

    const codexTab = screen.getByTestId("arweave-accounts-subtab-codex");
    const watchTab = screen.getByTestId("arweave-accounts-subtab-watch");
    expect(codexTab).toHaveTextContent("Codex Accounts");
    expect(codexTab).toHaveTextContent("1");
    expect(watchTab).toHaveTextContent("Watched Accounts");
    expect(watchTab).toHaveTextContent("0");
  });

  it("switches to Watched Accounts, showing its own empty state and no codex rows", () => {
    // Regression: a toggle that does nothing, or one that leaves the codex
    // groups mounted under "Watched", would present codex keys as watched
    // third-party addresses.
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" })]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
      />,
    );

    fireEvent.click(screen.getByTestId("arweave-accounts-subtab-watch"));

    const watchedEmpty = screen.getByTestId("arweave-accounts-watched-empty");
    expect(watchedEmpty.textContent ?? "").not.toHaveLength(0);
    expect(screen.queryByTestId("arweave-accounts-group-seed-1")).toBeNull();
    expect(screen.queryAllByTestId("arweave-account-row")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("arweave-accounts-subtab-codex"));
    expect(screen.getByTestId("arweave-accounts-group-seed-1")).toBeInTheDocument();
  });

  it("titles the prime seed's group 'Prime Arweave Seed' whatever its stored label says", () => {
    // Regression: the prime seed is a fixed, permanent identity (design.md) —
    // if a stale stored label wins, the user cannot tell which seed is prime.
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" })]}
        seeds={[{ id: "seed-1", label: "some stale label", isPrime: true }]}
      />,
    );

    const group = screen.getByTestId("arweave-accounts-group-seed-1");
    expect(within(group).getByText("Prime Arweave Seed")).toBeInTheDocument();
    expect(within(group).queryByText("some stale label")).toBeNull();
  });

  it("falls back to 'Seed #N' for a non-prime seed with no label", () => {
    // Regression: an unlabelled seed rendering as a blank header gives the user
    // no way to tell two seeds' groups apart.
    render(
      <ArweaveAccountsArea
        entries={[makeEntry({ seedId: "seed-2", index: 0, address: "ADDR-ZERO" })]}
        seeds={[
          { id: "seed-1", label: "Prime Arweave Seed", isPrime: true },
          { id: "seed-2", label: "" },
        ]}
      />,
    );

    expect(within(screen.getByTestId("arweave-accounts-group-seed-2")).getByText("Seed #2")).toBeInTheDocument();
  });

  it("badges each group with its own entry count, not the total", () => {
    // Regression: a badge that disagrees with the rows beneath it (or repeats
    // the codex total on every group) misreports how many keys a seed produced
    // — the number the user checks a finished generation run against.
    render(
      <ArweaveAccountsArea
        entries={[
          makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-A0" }),
          makeEntry({ seedId: "seed-1", index: 1, address: "ADDR-A1" }),
          makeEntry({ seedId: "seed-2", index: 0, address: "ADDR-B0" }),
        ]}
        seeds={[
          { id: "seed-1", label: "Prime Arweave Seed", isPrime: true },
          { id: "seed-2", label: "Second Seed" },
        ]}
      />,
    );

    expect(screen.getByTestId("arweave-accounts-count-seed-1")).toHaveTextContent("2");
    expect(screen.getByTestId("arweave-accounts-count-seed-2")).toHaveTextContent("1");
  });

  // Same "smaller screen" overflow fix as `StoaAccountsTab`'s own
  // `GroupRow` header (design.md §8, round 8 follow-up — owner-reported
  // live bug: "on a smaller screen, the seeds view on accounts when
  // collapsing, some weird shit is happening with the entries that they
  // are not displayed properly on their entry line"). A `flex: 1` label
  // with no `minWidth: 0` refuses to shrink below its own text width,
  // which can push the count badge off its own line instead of the label
  // truncating.
  it("a long seed label truncates (ellipsis) instead of overflowing its header row — the count badge never gets pushed off its line", () => {
    // The array's FIRST seed always renders as the locked "Prime Arweave
    // Seed" regardless of its own `label` — use a SECOND seed to actually
    // exercise its own label text.
    render(
      <ArweaveAccountsArea
        entries={[
          makeEntry({ seedId: "seed-0", index: 0, address: "ADDR-P0" }),
          makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-A0" }),
        ]}
        seeds={[
          { id: "seed-0", label: "Prime" },
          { id: "seed-1", label: "A".repeat(80) },
        ]}
      />,
    );
    const nameSpan = screen.getByText("A".repeat(80));
    expect(nameSpan.style.minWidth).toBe("0px");
    expect(nameSpan.style.overflow).toBe("hidden");
    expect(nameSpan.style.textOverflow).toBe("ellipsis");
    expect(nameSpan.style.whiteSpace).toBe("nowrap");
    const badge = screen.getByTestId("arweave-accounts-count-seed-1");
    expect(badge.style.flexShrink).toBe("0");
  });

  /* ── T2: copy, explorer, confirm-then-delete ── */

  /* ── T4: live balance value cell + "Live balances" refresh control ── */

  it("shows a fallback value cell (no crash) when getBalance is omitted entirely", () => {
    // Regression: earlier this cell was a static "Empty" placeholder. Now that
    // it drives a live read, a caller that omits `getBalance` (still a valid,
    // optional prop) must render an inert, non-crashing fallback rather than
    // throwing on a missing function call.
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
    expect(() =>
      render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />),
    ).not.toThrow();

    const value = screen.getByTestId(`arweave-account-value-${entry.id}`);
    expect(value.textContent).toBe("—");
  });

  it("fires one getBalance(address) call per row on mount and renders the resolved AR value", async () => {
    // Regression: this is the whole point of T4 — a hardcoded "Empty" cell
    // told the user nothing about what an address actually holds. A value
    // cell that doesn't call getBalance, or doesn't render its resolved
    // value, leaves the row exactly as useless as before.
    const entryA = makeEntry({ id: "a", seedId: "seed-1", index: 0, address: "ADDR-A" });
    const entryB = makeEntry({ id: "b", seedId: "seed-1", index: 1, address: "ADDR-B" });
    const getBalance = vi.fn(async (address: string) =>
      address === "ADDR-A" ? 2_500_000_000_000n : 0n,
    );

    render(
      <ArweaveAccountsArea
        entries={[entryA, entryB]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        getBalance={getBalance}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`arweave-account-value-a`)).toHaveTextContent(winstonToAr(2_500_000_000_000n));
    });
    expect(getBalance).toHaveBeenCalledWith("ADDR-A");
    expect(getBalance).toHaveBeenCalledWith("ADDR-B");
  });

  it("shows a loading indicator while the balance read is pending", () => {
    let resolveBalance: (value: bigint) => void = () => {};
    const getBalance = vi.fn(() => new Promise<bigint>((resolve) => { resolveBalance = resolve; }));
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });

    render(
      <ArweaveAccountsArea
        entries={[entry]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        getBalance={getBalance}
      />,
    );

    const value = screen.getByTestId(`arweave-account-value-${entry.id}`);
    expect(value.textContent).toBe("…");
    expect(getBalance).toHaveBeenCalledWith("ADDR-ZERO");

    // Cleans up the still-pending promise so it can't resolve after the test ends.
    resolveBalance(0n);
  });

  it("renders a distinct, non-crashing fallback (not a thrown error) when getBalance rejects", async () => {
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
    const getBalance = vi.fn(async (): Promise<bigint> => {
      throw new Error("gateway unreachable");
    });

    expect(() =>
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          getBalance={getBalance}
        />,
      ),
    ).not.toThrow();

    const errorCell = await screen.findByTestId(`arweave-account-value-${entry.id}-error`);
    expect(errorCell.textContent).toBe("—");
    // The non-error testid must no longer resolve — the row is unambiguously
    // in the error state, not silently still "loading" or "ready".
    expect(screen.queryByTestId(`arweave-account-value-${entry.id}`)).toBeNull();
  });

  it("shows a 'Live balances' label and a refresh control that re-invokes getBalance for every visible row", async () => {
    const entryA = makeEntry({ id: "a", seedId: "seed-1", index: 0, address: "ADDR-A" });
    const entryB = makeEntry({ id: "b", seedId: "seed-1", index: 1, address: "ADDR-B" });
    const getBalance = vi.fn(async () => 1_000_000_000_000n);

    render(
      <ArweaveAccountsArea
        entries={[entryA, entryB]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        getBalance={getBalance}
      />,
    );

    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Live balances")).toBeInTheDocument();

    const refreshButton = screen.getByTestId("arweave-accounts-refresh");
    fireEvent.click(refreshButton);

    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(4));
    expect(getBalance).toHaveBeenNthCalledWith(3, "ADDR-A");
    expect(getBalance).toHaveBeenNthCalledWith(4, "ADDR-B");
  });

  it("shows when the balances were last actually read — 'Live balances' alone doesn't say whether it's stale", async () => {
    // WHY: there is no periodic polling at all — balances refresh only on
    // mount, on a manual Refresh click, or once after a send. The plain
    // "Live balances" label overstates freshness with nothing to back it up;
    // a visible "updated Xs ago" is how a user actually tells staleness.
    vi.useFakeTimers();
    try {
      const getBalance = vi.fn(async () => 1_000_000_000_000n);
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          getBalance={getBalance}
        />,
      );

      await act(async () => {
        await Promise.resolve(); // let the mount-time getBalance promise settle
      });
      expect(screen.getByText(/updated just now/i)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000);
      });
      expect(screen.getByText(/updated 45s ago/i)).toBeInTheDocument();

      // A manual refresh resets the clock back to "just now".
      await act(async () => {
        fireEvent.click(screen.getByTestId("arweave-accounts-refresh"));
        await Promise.resolve();
      });
      expect(screen.getByText(/updated just now/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes every visible balance when ANY tx confirms — a send's own balance refresh fires at BROADCAST time (before the debit is final), so without this the user keeps seeing the pre-send balance until they click Refresh themselves", async () => {
    // Drives the REAL toastManager (not mocked in this file) end-to-end: an
    // arweave-chain `txPending(...).submitted(id)` with a `pollFn` that
    // resolves 'confirmed' fires the SAME `onTxConfirmed` pub/sub the
    // component subscribes to — proving the wiring, not just the import.
    const { txPending } = await import("@ancientpantheon/codex-ouronet/zbom");
    vi.useFakeTimers();
    try {
      const entryA = makeEntry({ id: "a", seedId: "seed-1", index: 0, address: "ADDR-A" });
      const entryB = makeEntry({ id: "b", seedId: "seed-1", index: 1, address: "ADDR-B" });
      const getBalance = vi.fn(async () => 1_000_000_000_000n);

      render(
        <ArweaveAccountsArea
          entries={[entryA, entryB]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          getBalance={getBalance}
        />,
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(getBalance).toHaveBeenCalledTimes(2);

      const ctrl = txPending("Send Arweave", { chain: "arweave", pollFn: async () => "confirmed" });
      ctrl.submitted("some-other-tx-id"); // unrelated to entryA/entryB — refresh is a blunt "any confirm" signal

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        // Extra microtask flushes: the poll's own promise chain AND the
        // resulting fetchBalances(getBalance) promises both need to settle.
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(getBalance).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies the row's address (address ?? id) to the clipboard on copy-button click", () => {
    // Regression: a copy button that copies the wrong field (e.g. the id, or a
    // truncated display string) silently hands the user the wrong address to
    // paste elsewhere — a funds-affecting mistake for a public Arweave address.
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO-FULL" });
    render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

    fireEvent.click(screen.getByTestId(`arweave-account-copy-${entry.id}`));
    expect(writeText).toHaveBeenCalledWith("ADDR-ZERO-FULL");
  });

  it("copies entry.id when address is absent, matching the row's own displayed fallback", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const entry = makeEntry({ seedId: "seed-1", index: 0 });
    render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

    fireEvent.click(screen.getByTestId(`arweave-account-copy-${entry.id}`));
    expect(writeText).toHaveBeenCalledWith(entry.id);
  });

  it("shows a green check on the copy button after clicking, then reverts — matching StoaAccountsTab's IconCopyBtn feedback", () => {
    // Regression: Chainweb's copy button (IconCopyBtn) confirms the copy with
    // a temporary green check; the Arweave copy button silently did nothing
    // visible at all, leaving the user unsure whether the click registered.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    vi.useFakeTimers();
    try {
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

      const copyBtn = screen.getByTestId(`arweave-account-copy-${entry.id}`);
      expect(copyBtn.querySelector('[data-glyph="check"]')).toBeNull();

      fireEvent.click(copyBtn);
      expect(copyBtn.querySelector('[data-glyph="check"]')).toBeInTheDocument();

      act(() => {
        act(() => {
          vi.advanceTimersByTime(1200);
        });
      });
      expect(copyBtn.querySelector('[data-glyph="check"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("links the explorer control to viewblock.io for the row's address, opening a new tab", () => {
    // Regression: a missing target/rel lets a malicious page in the new tab
    // reach back into this one (`window.opener`) — noopener/noreferrer is a
    // security property, not a style choice.
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-EXPLORE" });
    render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

    const link = screen.getByTestId(`arweave-account-explorer-${entry.id}`);
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://viewblock.io/arweave/address/ADDR-EXPLORE");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders no delete button on any row when onDeleteKey is omitted", () => {
    // Regression: mirrors Stoa's `onRemove &&` gating — a delete control that
    // renders anyway with no callback wired would either throw on click or
    // silently do nothing, both worse than not offering it at all.
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
    render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

    expect(screen.queryByTestId(`arweave-account-delete-${entry.id}`)).toBeNull();
    // The copy and explorer controls are unaffected by the omission.
    expect(screen.getByTestId(`arweave-account-copy-${entry.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`arweave-account-explorer-${entry.id}`)).toBeInTheDocument();
  });

  it("does not call onDeleteKey on the first delete click — it reveals a confirm/cancel pair instead", () => {
    // Regression: an Arweave key costs real RSA-4096 search time to regenerate
    // (design.md), so an immediate delete on a single stray click would be a
    // destructive, costly mistake. Confirm-then-delete is the whole point.
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
    const onDeleteKey = vi.fn();
    render(
      <ArweaveAccountsArea
        entries={[entry]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        onDeleteKey={onDeleteKey}
      />,
    );

    fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));

    expect(onDeleteKey).not.toHaveBeenCalled();
    expect(screen.getByTestId(`arweave-account-delete-confirm-${entry.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`arweave-account-delete-cancel-${entry.id}`)).toBeInTheDocument();
  });

  it("calls onDeleteKey exactly once with the row's own entry when confirm is clicked", () => {
    const entryA = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-A" });
    const entryB = makeEntry({ seedId: "seed-1", index: 1, address: "ADDR-B" });
    const onDeleteKey = vi.fn();
    render(
      <ArweaveAccountsArea
        entries={[entryA, entryB]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        onDeleteKey={onDeleteKey}
      />,
    );

    fireEvent.click(screen.getByTestId(`arweave-account-delete-${entryA.id}`));
    fireEvent.click(screen.getByTestId(`arweave-account-delete-confirm-${entryA.id}`));

    expect(onDeleteKey).toHaveBeenCalledTimes(1);
    expect(onDeleteKey).toHaveBeenCalledWith(entryA);
    // The OTHER row's delete control is untouched — a confirm must never
    // sweep up a sibling row's entry.
    expect(screen.queryByTestId(`arweave-account-delete-confirm-${entryB.id}`)).toBeNull();
  });

  it("dismisses the confirm state and calls onDeleteKey zero times when cancel is clicked", () => {
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
    const onDeleteKey = vi.fn();
    render(
      <ArweaveAccountsArea
        entries={[entry]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        onDeleteKey={onDeleteKey}
      />,
    );

    fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));
    fireEvent.click(screen.getByTestId(`arweave-account-delete-cancel-${entry.id}`));

    expect(onDeleteKey).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`arweave-account-delete-confirm-${entry.id}`)).toBeNull();
    // The delete button itself is still there, ready to be clicked again.
    expect(screen.getByTestId(`arweave-account-delete-${entry.id}`)).toBeInTheDocument();
  });

  /* ── T3: balance-aware delete guard (design.md §3, both tiers) ── */

  describe("balance-aware delete guard", () => {
    it("behaves exactly as before (plain confirm/cancel, old copy) when getBalance is omitted", () => {
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      const onDeleteKey = vi.fn();
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed", hasWords: true }]}
          onDeleteKey={onDeleteKey}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));
      const panel = screen.getByTestId(`arweave-account-delete-confirm-panel-${entry.id}`);
      expect(panel).toHaveTextContent("Delete this Arweave key? It cannot be regenerated without its seed.");
      expect(screen.queryByTestId(`arweave-account-delete-checking-${entry.id}`)).not.toBeInTheDocument();
    });

    it("shows a checking-balance state, then the plain confirm panel once getBalance resolves 0n", async () => {
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      let resolveBalance: (value: bigint) => void = () => {};
      const getBalance = vi.fn(
        () => new Promise<bigint>((resolve) => { resolveBalance = resolve; }),
      );
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed", hasWords: true }]}
          getBalance={getBalance}
          onDeleteKey={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));
      expect(screen.getByTestId(`arweave-account-delete-checking-${entry.id}`)).toBeInTheDocument();
      expect(getBalance).toHaveBeenCalledWith("ADDR-ZERO");

      await act(async () => {
        resolveBalance(0n);
      });

      const panel = screen.getByTestId(`arweave-account-delete-confirm-panel-${entry.id}`);
      expect(panel).toHaveTextContent("Delete this Arweave key? It cannot be regenerated without its seed.");
      expect(screen.queryByTestId(`arweave-account-delete-checking-${entry.id}`)).not.toBeInTheDocument();
    });

    it("falls back to the plain confirm panel when getBalance rejects — a read failure must never block deletion", async () => {
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      const getBalance = vi.fn(async (): Promise<bigint> => {
        throw new Error("network unreachable");
      });
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed", hasWords: true }]}
          getBalance={getBalance}
          onDeleteKey={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));

      await waitFor(() =>
        expect(screen.getByTestId(`arweave-account-delete-confirm-panel-${entry.id}`)).toBeInTheDocument(),
      );
    });

    it("Protected tier (seed.hasWords === true) + funded: keeps the SAME confirm-then-delete action, with the sharper warning copy", async () => {
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      const onDeleteKey = vi.fn();
      const getBalance = vi.fn(async () => 5_000_000_000_000n); // 5 AR in winston
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed", hasWords: true }]}
          getBalance={getBalance}
          onDeleteKey={onDeleteKey}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));
      const panel = await screen.findByTestId(`arweave-account-delete-confirm-panel-${entry.id}`);
      expect(panel).toHaveTextContent(
        `This address holds ${winstonToAr(5_000_000_000_000n)} AR. Deleting it is possible but not reversible without the seed that made it.`,
      );
      expect(screen.queryByTestId(`arweave-account-delete-blocked-${entry.id}`)).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId(`arweave-account-delete-confirm-${entry.id}`));
      expect(onDeleteKey).toHaveBeenCalledWith(entry);
    });

    it("a seed with hasWords OMITTED (backward-compat) defaults to the Protected tier, not blocked", async () => {
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      const getBalance = vi.fn(async () => 5_000_000_000_000n);
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          // No `hasWords` at all — an older caller predating this feature.
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          getBalance={getBalance}
          onDeleteKey={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));
      const panel = await screen.findByTestId(`arweave-account-delete-confirm-panel-${entry.id}`);
      expect(panel).toHaveTextContent("Deleting it is possible but not reversible without the seed");
      expect(screen.queryByTestId(`arweave-account-delete-blocked-${entry.id}`)).not.toBeInTheDocument();
    });

    it("Unprotected tier (seed.hasWords === false) + funded: BLOCKS deletion, no delete action fires even if the dismiss is the only click", async () => {
      const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
      const onDeleteKey = vi.fn();
      const getBalance = vi.fn(async () => 5_000_000_000_000n);
      render(
        <ArweaveAccountsArea
          entries={[entry]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed", hasWords: false }]}
          getBalance={getBalance}
          onDeleteKey={onDeleteKey}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${entry.id}`));
      const blocked = await screen.findByTestId(`arweave-account-delete-blocked-${entry.id}`);
      expect(blocked).toHaveTextContent(
        `This address holds ${winstonToAr(5_000_000_000_000n)} AR and has no seed behind it — it can never be regenerated. Deletion is disabled to prevent irreversible fund loss.`,
      );
      expect(screen.queryByTestId(`arweave-account-delete-confirm-${entry.id}`)).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId(`arweave-account-delete-dismiss-${entry.id}`));
      expect(screen.queryByTestId(`arweave-account-delete-blocked-${entry.id}`)).not.toBeInTheDocument();
      expect(onDeleteKey).not.toHaveBeenCalled();
    });

    it("an Unassigned-group entry (true orphan) is ALWAYS Unprotected, regardless of any seed's hasWords", async () => {
      const orphan = makeEntry({ id: "orphan", seedId: "seed-gone", index: 0, address: "ADDR-ORPHAN" });
      const getBalance = vi.fn(async () => 5_000_000_000_000n);
      render(
        <ArweaveAccountsArea
          entries={[orphan]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed", hasWords: true }]}
          getBalance={getBalance}
          onDeleteKey={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${orphan.id}`));
      await screen.findByTestId(`arweave-account-delete-blocked-${orphan.id}`);
      expect(screen.queryByTestId(`arweave-account-delete-confirm-${orphan.id}`)).not.toBeInTheDocument();
    });

    it("a Pure-Keys-group entry (genuinely seedless) is ALWAYS Unprotected too", async () => {
      const seedless = makeEntry({ id: "seedless", address: "ADDR-SEEDLESS" });
      const getBalance = vi.fn(async () => 5_000_000_000_000n);
      render(
        <ArweaveAccountsArea
          entries={[seedless]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed", hasWords: true }]}
          getBalance={getBalance}
          onDeleteKey={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId(`arweave-account-delete-${seedless.id}`));
      await screen.findByTestId(`arweave-account-delete-blocked-${seedless.id}`);
      expect(screen.queryByTestId(`arweave-account-delete-confirm-${seedless.id}`)).not.toBeInTheDocument();
    });
  });

  /* ── T2: Watched Accounts — add form, validation, watched-row rendering ── */

  describe("Watched Accounts", () => {
    const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

    // Register the REAL Arweave address validator so the add-form's validation
    // path exercises the actual `validateAddress(ARWEAVE_CHAIN_ID, ...)` D5
    // seam, not a stand-in regex.
    beforeEach(() => {
      registerChainAddressValidator(ARWEAVE_CHAIN_ID, arweaveValidator);
    });

    function openWatchTab(): void {
      fireEvent.click(screen.getByTestId("arweave-accounts-subtab-watch"));
    }

    it("with no watchedEntries/onAddWatched props, shows the existing empty state and a disabled add button", () => {
      // Regression: an omitted seam must degrade to the pre-T2 read-only stub —
      // never a button that throws or silently no-ops on click.
      render(
        <ArweaveAccountsArea
          entries={[]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        />,
      );
      openWatchTab();

      expect(screen.getByTestId("arweave-accounts-watched-empty")).toBeInTheDocument();
      expect(screen.getByTestId("arweave-watch-submit")).toBeDisabled();
    });

    it("rejects a syntactically invalid address with a validation error, without calling onAddWatched", () => {
      const onAddWatched = vi.fn();
      render(
        <ArweaveAccountsArea
          entries={[]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          onAddWatched={onAddWatched}
        />,
      );
      openWatchTab();

      fireEvent.change(screen.getByTestId("arweave-watch-input"), { target: { value: "not-a-valid-address" } });
      fireEvent.click(screen.getByTestId("arweave-watch-submit"));

      expect(screen.getByRole("alert")).toHaveTextContent("Not a valid Arweave address.");
      expect(onAddWatched).not.toHaveBeenCalled();
    });

    it("calls onAddWatched with a syntactically valid Arweave address on submit", () => {
      const onAddWatched = vi.fn(async () => {});
      render(
        <ArweaveAccountsArea
          entries={[]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          onAddWatched={onAddWatched}
        />,
      );
      openWatchTab();

      fireEvent.change(screen.getByTestId("arweave-watch-input"), { target: { value: ARWEAVE_ADDRESS } });
      fireEvent.click(screen.getByTestId("arweave-watch-submit"));

      expect(onAddWatched).toHaveBeenCalledWith(ARWEAVE_ADDRESS);
    });

    it("rejects an address already held as a Codex account, without calling onAddWatched", () => {
      // Regression: adding a Codex-owned address to the watch list would show
      // the same address twice, under two different (and differently capable)
      // rows.
      const onAddWatched = vi.fn();
      render(
        <ArweaveAccountsArea
          entries={[makeEntry({ seedId: "seed-1", index: 0, address: ARWEAVE_ADDRESS })]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          onAddWatched={onAddWatched}
        />,
      );
      openWatchTab();

      fireEvent.change(screen.getByTestId("arweave-watch-input"), { target: { value: ARWEAVE_ADDRESS } });
      fireEvent.click(screen.getByTestId("arweave-watch-submit"));

      expect(screen.getByRole("alert")).toHaveTextContent("That address is already a Codex account.");
      expect(onAddWatched).not.toHaveBeenCalled();
    });

    it("rejects an address already on the watch list, without calling onAddWatched", () => {
      const onAddWatched = vi.fn();
      const watched = makeWatchEntry({ address: ARWEAVE_ADDRESS });
      render(
        <ArweaveAccountsArea
          entries={[]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          watchedEntries={[watched]}
          onAddWatched={onAddWatched}
        />,
      );
      openWatchTab();

      fireEvent.change(screen.getByTestId("arweave-watch-input"), { target: { value: ARWEAVE_ADDRESS } });
      fireEvent.click(screen.getByTestId("arweave-watch-submit"));

      expect(screen.getByRole("alert")).toHaveTextContent("Already watched.");
      expect(onAddWatched).not.toHaveBeenCalled();
    });

    it("renders a watched row's live balance via getBalance, formatted with winstonToAr", async () => {
      // Mirrors the codex-row "renders a live balance" test — a watched
      // address is worthless to observe if its balance never actually reads.
      const watched = makeWatchEntry({ id: "w-1", address: ARWEAVE_ADDRESS });
      const getBalance = vi.fn(async () => 2_500_000_000_000n);
      render(
        <ArweaveAccountsArea
          entries={[]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          watchedEntries={[watched]}
          getBalance={getBalance}
        />,
      );
      openWatchTab();

      await waitFor(() => {
        expect(screen.getByTestId("arweave-watched-value-w-1")).toHaveTextContent(
          winstonToAr(2_500_000_000_000n),
        );
      });
      expect(getBalance).toHaveBeenCalledWith(ARWEAVE_ADDRESS);
    });

    it("calls onRemoveWatched with the watched entry's id on remove-button click", () => {
      const onRemoveWatched = vi.fn();
      const watched = makeWatchEntry({ id: "w-2", address: ARWEAVE_ADDRESS });
      render(
        <ArweaveAccountsArea
          entries={[]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          watchedEntries={[watched]}
          onRemoveWatched={onRemoveWatched}
        />,
      );
      openWatchTab();

      fireEvent.click(screen.getByTestId("arweave-watched-remove-w-2"));

      expect(onRemoveWatched).toHaveBeenCalledWith("w-2");
    });

    it("shows a green check on the copy button after clicking, then reverts — same feedback as a Codex-owned row", () => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn() },
        configurable: true,
      });
      vi.useFakeTimers();
      try {
        const watched = makeWatchEntry({ id: "w-4", address: ARWEAVE_ADDRESS });
        render(
          <ArweaveAccountsArea
            entries={[]}
            seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
            watchedEntries={[watched]}
          />,
        );
        openWatchTab();

        const copyBtn = screen.getByTestId("arweave-watched-copy-w-4");
        expect(copyBtn.querySelector('[data-glyph="check"]')).toBeNull();

        fireEvent.click(copyBtn);
        expect(copyBtn.querySelector('[data-glyph="check"]')).toBeInTheDocument();

        act(() => {
        act(() => {
          vi.advanceTimersByTime(1200);
        });
      });
        expect(copyBtn.querySelector('[data-glyph="check"]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("never renders a Send button/test-id on a watched row, even when a full deps prop is supplied", () => {
      // The whole point of "watch" is observe-only — there is no private key
      // to sign with, so a Send affordance here would be a funds-critical bug.
      const watched = makeWatchEntry({ id: "w-3", address: ARWEAVE_ADDRESS });
      const fakeDeps = {} as never;
      render(
        <ArweaveAccountsArea
          entries={[]}
          seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
          watchedEntries={[watched]}
          deps={fakeDeps}
        />,
      );
      openWatchTab();

      expect(screen.queryByTestId("arweave-watched-send-w-3")).toBeNull();
      expect(screen.queryByText(/^Send/)).toBeNull();
    });
  });

  // Owner correction (design.md §8, round 8 follow-up): "when there are
  // more than 10 pages available the entry 15/24 when clicked needs to
  // allow the input of a given page, to jump directly to a wanted page."
  // Same "same structure and design... as what we did for chainweb"
  // mandate this whole file exists to enforce — the mobile pagination
  // engine (ported from `StoaAccountsTab`) needs the SAME jump-to-page
  // affordance past 10 pages.
  describe("mobile pagination — page-jump input past 10 pages", () => {
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

    beforeEach(() => {
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    });
    afterEach(() => vi.unstubAllGlobals());

    // Round 9 "standard pagination controls zone": the Watched subtab has
    // no groups, so the Collapse-All medallion never occupies the shared
    // slot there — pagination is ALWAYS reported upward instead of inline
    // for Watched once a caller opts in. Capture the reported handle and
    // drive it directly, same as `ArweavePanel` would from its own
    // medallion buttons — `PageJumpIndicator` itself (still used inline for
    // the multi-group Codex case) is unit-identical either way.
    type PaginationHandle = { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null;

    function renderMobile(watchedEntries: WatchListEntry[], handleRef: { current: PaginationHandle }) {
      return render(
        <CodexUiRoot>
          <ArweaveAccountsArea
            entries={[]}
            seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
            watchedEntries={watchedEntries}
            onPaginationHandleChange={(h) => { handleRef.current = h; }}
          />
        </CodexUiRoot>,
      );
    }

    it("reports a plain (non-jump) handle at 10 or fewer pages", () => {
      // jsdom's `clientHeight` never resolves above 0, so the slot engine
      // stays at its safe default of 4 slots/page — 40 uniform watched
      // entries (1 slot each) → exactly 10 pages.
      const handleRef: { current: PaginationHandle } = { current: null };
      const entries = Array.from({ length: 40 }, (_, i) => makeWatchEntry({ id: `w${i}` }));
      renderMobile(entries, handleRef);
      fireEvent.click(screen.getByTestId("arweave-accounts-subtab-watch"));
      expect(handleRef.current).toEqual(expect.objectContaining({ page: 0, totalPages: 10 }));
      expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
    });

    it("past 10 pages, jumping via the handle advances to the typed page", () => {
      const handleRef: { current: PaginationHandle } = { current: null };
      const entries = Array.from({ length: 44 }, (_, i) => makeWatchEntry({ id: `w${i}` }));
      renderMobile(entries, handleRef);
      fireEvent.click(screen.getByTestId("arweave-accounts-subtab-watch"));
      expect(handleRef.current).toEqual(expect.objectContaining({ page: 0, totalPages: 11 }));
      act(() => handleRef.current?.onJump(8));
      expect(handleRef.current).toEqual(expect.objectContaining({ page: 8, totalPages: 11 }));
    });
  });

  // Round 11 owner correction (ported from `StoaAccountsTab.tsx`'s
  // identical redesign): "instead of listing the entries as part of a
  // seed, we should make the entry carry a medallion to see from which
  // seed it belongs, thus making all entries having a fixed size." Mobile
  // ONLY — desktop's own `GroupSection` list (exercised extensively above,
  // with no `CodexUiRoot` ancestor) stays byte-identical.
  describe("mobile: the flat fixed-row Codex list (round 11)", () => {
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

    beforeEach(() => {
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    });
    afterEach(() => vi.unstubAllGlobals());

    function renderMobileCodex(entries: ForeignKeyEntry[], seeds: { id: string; label: string }[]) {
      return render(
        <CodexUiRoot>
          <ArweaveAccountsArea entries={entries} seeds={seeds} />
        </CodexUiRoot>,
      );
    }

    it("no group HEADER ever renders — instead each row carries a colour-coded corner dot (type) plus a thin pill naming its own seed (identity) — owner correction (round 12): 'the coloured point is perfect for showing the type of seed it belongs to' + a thin medallion for the name", () => {
      const entries = [
        makeEntry({ id: "a0", seedId: "seed-1", address: "ADDR-A0", index: 0 }),
        makeEntry({ id: "b0", seedId: "seed-2", address: "ADDR-B0", index: 0 }),
      ];
      const seeds = [
        { id: "seed-1", label: "Seed A" },
        { id: "seed-2", label: "Seed B" },
      ];
      renderMobileCodex(entries, seeds);
      // No GROUP header (a shared banner sitting above several rows) —
      // but the seed's name now legitimately appears ON each row's own
      // thin pill, once per row, which is the whole point of round 12.
      expect(screen.getByText(addressText("ADDR-A0"))).toBeTruthy();
      expect(screen.getByText(addressText("ADDR-B0"))).toBeTruthy();
      expect(screen.getByText("Prime Arweave Seed")).toBeTruthy();
      expect(screen.getByText("Seed B")).toBeTruthy();
      expect(screen.getByLabelText("From Prime Arweave Seed")).toBeTruthy();
      expect(screen.getByLabelText("From Seed B")).toBeTruthy();
    });

    // Round 20 owner correction: "the fat hippo name needs to be in its
    // own medalion on the opposite side" — a Pure Key's own custom label
    // previously overflowed straight out of the small circular position
    // medallion (no numeric index to show there instead).
    it("a label-only entry (no numeric index, e.g. a Pure Key) shows its own label in a SEPARATE pill on the OPPOSITE side from the group's seedBadge pill, and a short avatar initial (not the full label) inside the circular medallion", () => {
      const entries = [makeEntry({ id: "pk1", address: "ADDR-PK", label: "FatHippo" })];
      renderMobileCodex(entries, []);

      // The group pill ("Pure Keys" — no seedId) — unchanged, still there.
      expect(screen.getByText("Pure Keys")).toBeTruthy();
      // The entry's OWN label now has its own pill — the full name is
      // findable as real text, not truncated/overflowing.
      const labelPill = screen.getByTitle("FatHippo");
      expect(labelPill).toBeTruthy();
      expect(labelPill.style.right).toBe("14px");
      expect(labelPill.style.left).toBe("");
      // The circle shows a short initial, not the full "FatHippo" text
      // (which is what actually overflowed before this fix).
      expect(screen.queryByText("FatHippo", { selector: "div" })).toBeNull();
      expect(screen.getByText("FA")).toBeTruthy();
    });

    it("a left swipe on the entry area advances to the next page, a right swipe goes back — owner correction: 'we can add swiping mechanic to move page'", async () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        makeEntry({ id: `e${i}`, seedId: "seed-1", address: `ADDR-${i}`, index: i }));
      renderMobileCodex(entries, [{ id: "seed-1", label: "Seed A" }]);
      const surface = screen.getByTestId("arweave-accounts-page-surface");

      expect(screen.getByText("ADDR-0")).toBeTruthy();
      expect(screen.queryByText("ADDR-4")).toBeNull();

      // Round 18 — the gesture must actually MOVE (a `touchmove`) past the
      // dead-zone to be recognised as a horizontal page-swipe at all (this
      // is what now drives the live drag feedback) — a bare
      // touchstart+touchend with no move in between is exactly the "just
      // a tap" case that must NOT flip a page.
      const swipe = (fromX: number, toX: number) => {
        fireEvent.touchStart(surface, { touches: [{ clientX: fromX, clientY: 0 }] });
        fireEvent.touchMove(surface, { touches: [{ clientX: toX, clientY: 0 }] });
        fireEvent.touchEnd(surface, { changedTouches: [{ clientX: toX, clientY: 0 }] });
      };

      // The page change itself is deliberately ASYNC now (it waits for the
      // "animate off-screen" settle animation to finish first). Round 20's
      // two-pane carousel means "ADDR-4" becomes visible almost
      // immediately (mounted as the peeking adjacent pane as soon as the
      // drag direction locks in) — no longer a reliable signal that the
      // page-INDEX swap itself has completed. Wait for "ADDR-0" to
      // actually disappear instead.
      swipe(300, 200);
      await waitFor(() => expect(screen.queryByText("ADDR-0")).toBeNull());
      expect(screen.getByText("ADDR-4")).toBeTruthy();

      swipe(200, 300);
      await waitFor(() => expect(screen.queryByText("ADDR-4")).toBeNull());
      expect(screen.getByText("ADDR-0")).toBeTruthy();
    });

    it("visually follows the finger while dragging, resists past the first/last page, and never moves for a vertical gesture (round 18)", async () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        makeEntry({ id: `e${i}`, seedId: "seed-1", address: `ADDR-${i}`, index: i }));
      renderMobileCodex(entries, [{ id: "seed-1", label: "Seed A" }]);
      const surface = screen.getByTestId("arweave-accounts-page-surface");
      const track = screen.getByTestId("arweave-accounts-page-swipe-track");
      expect(track.style.transform).toBe("translateX(0px)");

      // Live drag tracking, no transition while the finger is still down.
      fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 0 }] });
      fireEvent.touchMove(surface, { touches: [{ clientX: 220, clientY: 0 }] });
      expect(screen.getByText("ADDR-0")).toBeTruthy();
      expect(track.style.transform).toBe("translateX(-80px)");
      expect(track.style.transition).toBe("none");
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 220, clientY: 0 }] });
      // Round 20 — wait for the ACTUAL settle (the transform resets to 0
      // in the same batched update as the real page-index swap) rather
      // than for "ADDR-4" to appear (already visible well before this).
      await waitFor(() => expect(track.style.transform).toBe("translateX(0px)"));
      expect(screen.getByText("ADDR-4")).toBeTruthy();
      expect(screen.queryByText("ADDR-0")).toBeNull();

      // Already on the LAST page — dragging further LEFT resists (0.35×)
      // instead of moving 1:1 with the finger.
      fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 0 }] });
      fireEvent.touchMove(surface, { touches: [{ clientX: 200, clientY: 0 }] });
      expect(track.style.transform).toBe("translateX(-35px)"); // -100 * 0.35
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 200, clientY: 0 }] });

      // A predominantly VERTICAL gesture never moves the track at all.
      fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 200 }] });
      fireEvent.touchMove(surface, { touches: [{ clientX: 210, clientY: 260 }] });
      expect(track.style.transform).toBe("translateX(0px)");
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 210, clientY: 260 }] });
      expect(screen.getByText("ADDR-4")).toBeTruthy();
    });

    it("round 20 — the ADJACENT page's real content mounts as a second pane and slides INTO view WHILE dragging, instead of the old blank gap ('the next page isnt there, it simply appears when the prev page is complelety gone')", async () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        makeEntry({ id: `e${i}`, seedId: "seed-1", address: `ADDR-${i}`, index: i }));
      renderMobileCodex(entries, [{ id: "seed-1", label: "Seed A" }]);
      const surface = screen.getByTestId("arweave-accounts-page-surface");

      expect(screen.queryByText("ADDR-4")).toBeNull();

      fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 0 }] });
      fireEvent.touchMove(surface, { touches: [{ clientX: 260, clientY: 0 }] });
      // Still mid-drag (well under the commit threshold) — "ADDR-4" (page
      // 2's own real content) is ALREADY mounted, sliding in.
      expect(screen.getByText("ADDR-0")).toBeTruthy();
      expect(screen.getByText("ADDR-4")).toBeTruthy();

      // Releasing under the threshold bounces back — the peek was a real
      // preview, not a premature commit.
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 260, clientY: 0 }] });
      expect(screen.getByText("ADDR-0")).toBeTruthy();
    });
  });

  // Round 17 owner correction: "we need to do the same thing with the
  // addresses of arweave, arweave account one line, balance one line, and
  // buttons below on the lower bar, with entry selection" — ports
  // `StoaAccountsTab.tsx`'s own mobile selection + shared bottom action
  // bar pattern.
  describe("mobile: entry selection + shared bottom action bar (round 17)", () => {
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

    beforeEach(() => {
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    });
    afterEach(() => vi.unstubAllGlobals());

    function renderMobile(props: Partial<ArweaveAccountsAreaProps> = {}) {
      // `SendArweaveModal` calls `useEnsureCodexUnlocked` (codex-ouronet/
      // zbom) UNCONDITIONALLY at its own top level, regardless of `isOpen`
      // — so simply MOUNTING it (whenever `deps` is truthy) requires a
      // `<CodexProvider>` ancestor, the SAME one `apps/codex-playground`
      // always wraps `ArweavePanel` in (mirrors `e4-panel-categories.test.tsx`'s
      // own `renderPanel`/`renderPanelMobile` helpers).
      return render(
        <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
          <CodexUiRoot>
            <ArweaveAccountsArea entries={[]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} {...props} />
          </CodexUiRoot>
        </CodexProvider>,
      );
    }

    it("selects the first Codex entry by default — no tap needed — and the shared bar shows Send/Copy/Explorer for it", () => {
      const entries = [
        makeEntry({ id: "e0", seedId: "seed-1", index: 0, address: "ADDR-0" }),
        makeEntry({ id: "e1", seedId: "seed-1", index: 1, address: "ADDR-1" }),
      ];
      renderMobile({ entries, deps: {} as never });
      expect(screen.getByLabelText("Send AR")).toBeTruthy();
      expect(screen.getByLabelText("Copy address")).toBeTruthy();
      expect(screen.getByLabelText("Open in Explorer")).toBeTruthy();
      // No delete/remove control for a Codex-owned entry — see `AccountRow`'s
      // own `deleteGuard` doc comment: a seed-derived key is only ever
      // deleted via its own seed, never from this surface.
      expect(screen.queryByLabelText("Stop watching this address")).toBeNull();
    });

    it("tapping a different row switches the selection — the shared bar now acts on the NEWLY selected entry", () => {
      const writeText = vi.fn();
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      const entries = [
        makeEntry({ id: "e0", seedId: "seed-1", index: 0, address: "ADDR-0" }),
        makeEntry({ id: "e1", seedId: "seed-1", index: 1, address: "ADDR-1" }),
      ];
      renderMobile({ entries });

      // Default selection is the first entry.
      fireEvent.click(screen.getByLabelText("Copy address"));
      expect(writeText).toHaveBeenLastCalledWith("ADDR-0");

      // Tap the SECOND row (its own address text) to switch selection.
      fireEvent.click(screen.getByText("ADDR-1"));
      fireEvent.click(screen.getByLabelText("Copy address"));
      expect(writeText).toHaveBeenLastCalledWith("ADDR-1");
    });

    it("no per-row buttons render on mobile Codex rows — only the leading medallion, the address line, and the balance line", () => {
      const entries = [makeEntry({ id: "e0", seedId: "seed-1", index: 0, address: "ADDR-0" })];
      renderMobile({ entries, deps: {} as never });
      // The per-row `data-testid`s (desktop-only now) never render on mobile.
      expect(screen.queryByTestId("arweave-account-send-e0")).toBeNull();
      expect(screen.queryByTestId("arweave-account-copy-e0")).toBeNull();
      expect(screen.queryByTestId("arweave-account-explorer-e0")).toBeNull();
      // Exactly one of each control exists — the shared bar's own.
      expect(screen.getAllByLabelText("Send AR").length).toBe(1);
      expect(screen.getAllByLabelText("Copy address").length).toBe(1);
    });

    it("selecting a WATCHED entry hides Send (no private key behind a watched address) and shows a remove-from-watch control instead", () => {
      const onRemoveWatched = vi.fn();
      const watched = [makeWatchEntry({ id: "w0", address: "WATCH-0" })];
      renderMobile({ deps: {} as never, watchedEntries: watched, onRemoveWatched });
      fireEvent.click(screen.getByTestId("arweave-accounts-subtab-watch"));

      expect(screen.queryByLabelText("Send AR")).toBeNull();
      expect(screen.getByLabelText("Copy address")).toBeTruthy();
      const removeBtn = screen.getByLabelText("Stop watching this address");
      expect(removeBtn).toBeTruthy();

      fireEvent.click(removeBtn);
      expect(onRemoveWatched).toHaveBeenCalledWith("w0");
    });

    it("portals the shared bottom bar into a supplied zone3AnchorTarget, landing on that target's OWN bottom border", () => {
      const railTarget = document.createElement("div");
      document.body.appendChild(railTarget);
      const entries = [makeEntry({ id: "e0", seedId: "seed-1", index: 0, address: "ADDR-0" })];
      const { container } = renderMobile({ entries, deps: {} as never, zone3AnchorTarget: railTarget });

      const sendBtn = screen.getByLabelText("Send AR");
      expect(railTarget.contains(sendBtn)).toBe(true);
      expect(container.contains(sendBtn)).toBe(false);
      const stack = sendBtn.parentElement as HTMLElement;
      expect(stack.style.bottom).toBe("0px");
      expect(stack.style.transform).toBe("translateY(50%)");

      document.body.removeChild(railTarget);
    });
  });
});
