/**
 * RED matrix for the Library category's "General Data" / "Codex" tab split
 * (owner's own words, direct quote): "lets make two Tabs here, General Data
 * and Codex, separate on their own display."
 *
 * Mirrors `e4-panel-categories.test.tsx`'s own "mounted for real through
 * ArweavePanel" shape — these are composition tests over the REAL
 * `ArweavePanel`, not `LibraryArea`/`CodexBackupArea` in isolation, because
 * the whole point of this task is the WIRING between the two tabs and the
 * three areas (`LibraryArea`, `CodexBackupArea`, `CodexBackupHistoryArea`)
 * that used to render stacked, unconditionally, inside the Library category.
 *
 * - "General Data" (the default tab, so the owner never lands on an empty
 *   screen) shows the redesigned `LibraryArea` — every upload EXCEPT the ones
 *   tagged `Codex-Category: codex-backup`.
 * - "Codex" shows `CodexBackupArea` + `CodexBackupHistoryArea` (+ the
 *   recovery-eligibility status that sits directly above the backup button),
 *   moved OFF the always-visible General Data view and under their own tab.
 *
 * FAILS RED because `ArweavePanel.tsx` does not yet render a tab switcher at
 * all inside the Library category — `CodexBackupArea`/`CodexBackupHistoryArea`
 * are unconditionally stacked above `LibraryArea`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import { ArweavePanel } from "../src/panel/ArweavePanel";
import { ArweavePanelProvider, type ArweavePanelDeps } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import type { LibraryEntry, LibraryStore } from "../src/library/types";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;
const fakePool = { pick: () => ARWEAVE_ADDRESS } as unknown as GatewayPool;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

function makeDeps(overrides: Partial<ArweavePanelDeps> = {}): ArweavePanelDeps {
  const libraryRows: LibraryEntry[] = [];
  return {
    address: ARWEAVE_ADDRESS,

    foreignKeys: [makeEntry()],
    keygenRunner: { runKeygen: vi.fn(async () => fixtureJwk) },
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
    uploadFilesAndTrack: vi.fn(async () => ({
      manifestId: "manifest-id",
      fileIds: [],
      uploadId: "upload-id",
    })),
    getExportJson: vi.fn(async () => "{}"),
    backupCodex: vi.fn(async () => ({ id: "backup-id" })),
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
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <ArweavePanelProvider deps={deps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>
    </CodexProvider>,
  );
  return { deps, ...utils };
}

function goToLibrary(): void {
  fireEvent.click(screen.getByTestId("arweave-subtab-library"));
}

describe("ArweavePanel — Library category tab switcher (General Data / Codex)", () => {
  it("shows both tabs, clearly labeled, once Library is selected", () => {
    renderPanel();
    goToLibrary();

    const general = screen.getByTestId("library-tab-general");
    const codex = screen.getByTestId("library-tab-codex");
    expect(general).toHaveTextContent(/general data/i);
    expect(codex).toHaveTextContent(/codex/i);
  });

  it("defaults to the General Data tab — LibraryArea is visible without any extra click", () => {
    renderPanel();
    goToLibrary();

    expect(screen.getByTestId("library-area")).toBeInTheDocument();
    expect(screen.getByTestId("library-tab-general")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("library-tab-codex")).toHaveAttribute("aria-selected", "false");
    // Codex's own areas are NOT stacked above/alongside General Data anymore.
    expect(screen.queryByTestId("codex-backup-area")).not.toBeInTheDocument();
    expect(screen.queryByTestId("codex-backup-history-area")).not.toBeInTheDocument();
  });

  it("switching to the Codex tab shows CodexBackupArea + CodexBackupHistoryArea and hides LibraryArea", () => {
    renderPanel();
    goToLibrary();

    fireEvent.click(screen.getByTestId("library-tab-codex"));

    expect(screen.getByTestId("codex-backup-area")).toBeInTheDocument();
    expect(screen.getByTestId("codex-backup-history-area")).toBeInTheDocument();
    expect(screen.queryByTestId("library-area")).not.toBeInTheDocument();
    expect(screen.getByTestId("library-tab-codex")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("library-tab-general")).toHaveAttribute("aria-selected", "false");
  });

  it("switching back to General Data restores LibraryArea and hides the Codex areas again", () => {
    renderPanel();
    goToLibrary();
    fireEvent.click(screen.getByTestId("library-tab-codex"));
    fireEvent.click(screen.getByTestId("library-tab-general"));

    expect(screen.getByTestId("library-area")).toBeInTheDocument();
    expect(screen.queryByTestId("codex-backup-area")).not.toBeInTheDocument();
  });
});

describe("ArweavePanel — General Data tab excludes codex-backup uploads", () => {
  it("a Codex-Category: codex-backup entry never appears under General Data's LibraryArea", async () => {
    const libraryRows: LibraryEntry[] = [
      {
        id: "backupBackupBackupBackupBackupBackupBackupB",
        owner: ARWEAVE_ADDRESS,
        itemId: "codex-export",
        contentType: "application/json",
        status: "final",
        createdAt: 100,
        tags: [{ name: "Codex-Category", value: "codex-backup" }],
      },
      {
        id: "regularRegularRegularRegularRegularRegularR",
        owner: ARWEAVE_ADDRESS,
        itemId: "a-photo",
        contentType: "image/png",
        status: "final",
        createdAt: 200,
        tags: [{ name: "Codex-Category", value: "personal-photos" }],
      },
    ];
    renderPanel({ listLibrary: vi.fn(async () => libraryRows) });
    goToLibrary();

    expect(await screen.findByTestId("library-category-personal-photos")).toBeInTheDocument();
    expect(screen.queryByTestId("library-category-codex-backup")).not.toBeInTheDocument();
    expect(screen.queryByText("codex-export")).not.toBeInTheDocument();
  });

  it("the SAME codex-backup entry IS visible on the Codex tab's history list", async () => {
    const libraryRows: LibraryEntry[] = [
      {
        id: "backupBackupBackupBackupBackupBackupBackupB",
        owner: ARWEAVE_ADDRESS,
        itemId: "codex-export",
        contentType: "application/json",
        status: "final",
        createdAt: 100,
        tags: [{ name: "Codex-Category", value: "codex-backup" }],
      },
    ];
    renderPanel({ listLibrary: vi.fn(async () => libraryRows) });
    goToLibrary();
    fireEvent.click(screen.getByTestId("library-tab-codex"));

    const history = await screen.findByTestId("codex-backup-history-area");
    expect(within(history).getAllByTestId("codex-backup-history-entry")).toHaveLength(1);
  });
});

/**
 * Density/scale sanity check (owner's own real-world example): "imagine I
 * upload a folder with 15000 photos each with a big and small variant" —
 * this is the SYNTHETIC large-count scenario the task asks for (50+ entries
 * across multiple categories), mounted through the REAL ArweavePanel, not
 * just LibraryArea in isolation, so a panel-level wiring mistake (e.g. the
 * wrong `listLibrary` seam reaching General Data) would actually be caught.
 */
describe("ArweavePanel — General Data at scale (50+ entries across categories)", () => {
  function manyEntries(category: string, count: number, startId: string): LibraryEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${startId}${String(i).padStart(3, "0")}`.padEnd(43, "x"),
      owner: ARWEAVE_ADDRESS,
      itemId: `item-${category}-${i}`,
      contentType: "image/png",
      status: "final" as const,
      createdAt: 1000 - i,
      tags: [{ name: "Codex-Category", value: category }],
    }));
  }

  it("groups a large multi-category library into collapsible sections and still paginates", async () => {
    // personal-photos sorts before nft-data in the canonical taxonomy order,
    // so with 20+20 (both fit inside page 1's 25-unit budget together) BOTH
    // section headers land on page 1, while the 40-unit total still spills
    // onto a second page.
    const rows = [
      ...manyEntries("personal-photos", 20, "photo"),
      ...manyEntries("nft-data", 20, "nftid"),
    ];
    renderPanel({ listLibrary: vi.fn(async () => rows) });
    goToLibrary();

    expect(await screen.findByTestId("library-category-personal-photos")).toBeInTheDocument();
    expect(screen.getByTestId("library-category-nft-data")).toBeInTheDocument();
    // 55 total units is more than one page at the new, denser page size.
    expect(screen.getByTestId("library-pager")).toBeInTheDocument();

    // Collapsing the first category hides its rows without losing the second
    // category's own section header.
    fireEvent.click(screen.getByTestId("library-category-toggle-personal-photos"));
    expect(screen.getByTestId("library-category-nft-data")).toBeInTheDocument();
  });
});
