/**
 * RED matrix for the Arweave panel LIBRARY area (E-10).
 *
 * Pins the `LibraryArea` contract: list pending+final NEWEST-FIRST (from E3's
 * `list(owner)`, distinguishable badges); open via a HEALTHY gateway (`openUrl(id,
 * {pool})` composes the URL from the healthy endpoint of a seeded fake pool, NOT
 * hardcoded arweave.net); a manifest entry renders a SINGLE link; and
 * rebuild-from-chain (`rebuildLibrary(owner, {store, pool})`) reconciles N records
 * newest-first.
 *
 * ALL Library/pool calls are FAKES. FAILS RED because `../src/panel/LibraryArea`
 * does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup, fireEvent } from "@testing-library/react";

import { LibraryArea } from "../src/panel/LibraryArea";
import type { LibraryEntry } from "@ancientpantheon/codex-arweave/library";

const OWNER = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const HEALTHY_ENDPOINT = "https://healthy.example";
const ID_NEW = "newNewNewNewNewNewNewNewNewNewNewNewNewNewNe";
const ID_OLD = "oldOldOldOldOldOldOldOldOldOldOldOldOldOldOl";
const ID_MANIFEST = "manManManManManManManManManManManManManManMa";

function makeEntry(overrides: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: "id",
    owner: OWNER,
    itemId: "item",
    contentType: "text/plain",
    status: "final",
    createdAt: 0,
    tags: [],
    ...overrides,
  };
}

/** A fake gateway pool whose healthy endpoint the link composes against. */
function makePool() {
  return {
    getHealthSnapshot: () => [
      { endpoint: "https://down.example", healthy: false, active: false },
      { endpoint: HEALTHY_ENDPOINT, healthy: true, active: true },
    ],
    getActiveEndpoint: () => HEALTHY_ENDPOINT,
    execute: vi.fn(),
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  const pool = makePool();
  return {
    owner: OWNER,
    pool,
    // E3's list(owner) — newest-first is the store's job; here we return two entries.
    listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
      makeEntry({ id: ID_NEW, createdAt: 200, status: "pending" }),
      makeEntry({ id: ID_OLD, createdAt: 100, status: "final" }),
    ]),
    // E3's openUrl(id, {pool}) composes the URL from the healthy endpoint.
    openUrl: vi.fn((id: string) => `${HEALTHY_ENDPOINT}/${id}`),
    // E3's rebuildLibrary(owner, {store, pool}) reconciles chain records.
    rebuildLibrary: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LibraryArea — list newest-first", () => {
  it("lists pending + final entries newest-first with distinguishable status badges", async () => {
    render(<LibraryArea {...makeProps()} />);

    const items = await screen.findAllByTestId("library-entry");
    expect(items).toHaveLength(2);
    // Newest-first: the createdAt:200 entry precedes the createdAt:100 one.
    expect(items[0].textContent).toContain(ID_NEW);
    expect(items[1].textContent).toContain(ID_OLD);
    // Distinguishable badges: pending vs final.
    expect(within(items[0]).getByText(/pending/i)).toBeInTheDocument();
    expect(within(items[1]).getByText(/final/i)).toBeInTheDocument();
  });
});

describe("LibraryArea — open via a healthy gateway", () => {
  it("composes the open URL from the healthy endpoint via openUrl(id,{pool}), not hardcoded arweave.net", async () => {
    const props = makeProps();
    render(<LibraryArea {...props} />);
    await screen.findAllByTestId("library-entry");

    const link = screen.getAllByTestId("library-open-link")[0];
    expect(props.openUrl).toHaveBeenCalledWith(ID_NEW, expect.objectContaining({ pool: props.pool }));
    expect(link).toHaveAttribute("href", `${HEALTHY_ENDPOINT}/${ID_NEW}`);
    // The healthy endpoint drives the link — never the arweave.net default.
    expect(link.getAttribute("href")).not.toContain("arweave.net");
  });
});

describe("LibraryArea — manifest single-link", () => {
  it("renders a manifest entry as ONE link, not an expanded file list", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_MANIFEST,
          createdAt: 300,
          contentType: "application/x.arweave-manifest+json",
          manifest: { isManifest: true },
        }),
      ]),
    });
    render(<LibraryArea {...props} />);

    const entry = (await screen.findAllByTestId("library-entry"))[0];
    // Exactly one link for the manifest — not an expanded per-file list.
    expect(within(entry).getAllByRole("link")).toHaveLength(1);
    expect(within(entry).getByTestId("library-manifest-badge")).toBeInTheDocument();
  });
});

describe("LibraryArea — rebuild from chain", () => {
  it("empty library → rebuild → shows the reconciled entries newest-first", async () => {
    const chainEntries = [
      makeEntry({ id: ID_NEW, createdAt: 200 }),
      makeEntry({ id: ID_OLD, createdAt: 100 }),
    ];
    let listCalls = 0;
    const listLibrary = vi.fn(async (): Promise<LibraryEntry[]> => {
      // First read (mount) is empty; after rebuild the reconciled set appears.
      listCalls += 1;
      return listCalls === 1 ? [] : chainEntries;
    });
    const props = makeProps({ listLibrary });
    render(<LibraryArea {...props} />);

    // Empty-state before rebuild.
    expect(await screen.findByTestId("library-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-rebuild"));

    await waitFor(() =>
      expect(props.rebuildLibrary).toHaveBeenCalledWith(
        OWNER,
        expect.objectContaining({ pool: props.pool }),
      ),
    );
    const items = await screen.findAllByTestId("library-entry");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(ID_NEW);
    expect(items[1].textContent).toContain(ID_OLD);
  });
});
