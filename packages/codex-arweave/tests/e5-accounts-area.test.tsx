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

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor, act } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { winstonToAr } from "@ancientpantheon/arweave-core";

import { ArweaveAccountsArea } from "../src/panel/ArweaveAccountsArea";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";

const CIPHERTEXT = "ENCRYPTED-KEYFILE-CIPHERTEXT-MUST-NEVER-RENDER";

function makeEntry(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2)}`,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: CIPHERTEXT,
    ...overrides,
  };
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

    expect(within(screen.getByTestId("arweave-accounts-group-seed-1")).getByText("ADDR-A0")).toBeInTheDocument();
    expect(within(screen.getByTestId("arweave-accounts-group-seed-2")).getByText("ADDR-B0")).toBeInTheDocument();
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
    expect(within(unassigned).getByText("ADDR-ORPHAN")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();

    const pureKeys = screen.getByTestId("arweave-accounts-group-pure-keys");
    expect(within(pureKeys).getByText("ADDR-LEGACY")).toBeInTheDocument();
    expect(screen.getByText("Pure Keys")).toBeInTheDocument();

    // The known entry stays in its own group — neither catch-all is a bucket for all.
    expect(within(unassigned).queryByText("ADDR-KNOWN")).toBeNull();
    expect(within(pureKeys).queryByText("ADDR-KNOWN")).toBeNull();
    // Cross-checks: the orphan is not in Pure Keys, the legacy/seedless entry is not in Unassigned.
    expect(within(unassigned).queryByText("ADDR-LEGACY")).toBeNull();
    expect(within(pureKeys).queryByText("ADDR-ORPHAN")).toBeNull();
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
    expect(screen.getByText("ADDR-ZERO")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("ADDR-ZERO")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText("ADDR-ZERO")).toBeInTheDocument();
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

  /* ── T2: value cell, copy, explorer, confirm-then-delete ── */

  it("shows a static 'Empty' value cell on every row (balances are out of scope)", () => {
    // Regression: this cell must never read a store or the network — the whole
    // project defers balances (design.md's "Out of scope"). A value that
    // changes with the entry (rather than always reading "Empty") would mean
    // someone wired a real read where a static placeholder belongs.
    const entry = makeEntry({ seedId: "seed-1", index: 0, address: "ADDR-ZERO" });
    render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);

    const value = screen.getByTestId(`arweave-account-value-${entry.id}`);
    expect(value).toHaveTextContent("Empty");
    expect(value.textContent).toBe("Empty");
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
});
