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
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import { ArweavePanel } from "../src/panel/ArweavePanel";
import { ArweavePanelProvider, type ArweavePanelDeps } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import type { LibraryEntry, LibraryStore } from "../src/library/types";

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
  const utils = render(
    <ArweavePanelProvider deps={deps}>
      <ArweavePanel id={ARWEAVE_CHAIN_ID} />
    </ArweavePanelProvider>,
  );
  return { deps, ...utils };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  it("shows exactly one category body at a time (switching away unmounts the last)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.getByTestId("arweave-category-empty-upload")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    expect(screen.queryByTestId("arweave-category-empty-upload")).toBeNull();
    expect(screen.getByTestId("arweave-category-empty-library")).toBeInTheDocument();
  });
});
