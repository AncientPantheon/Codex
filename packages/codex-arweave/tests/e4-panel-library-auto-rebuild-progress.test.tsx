/**
 * RED matrix for the Arweave panel's mount of `LibraryAutoRebuildProgress`
 * (`arweave-auto-rebuild-on-unlock`) — mirrors
 * `e4-panel-restore-eligibility.test.tsx`'s own "mounted for real through
 * ArweavePanel" shape: present it renders through the real panel (Library
 * category, alongside `LibraryArea`); absent/`null` it renders nothing —
 * the same "absent optional seam → graceful no-op" discipline every other
 * optional `ArweavePanelDeps` field already follows.
 *
 * RED: `ArweavePanelDeps.libraryAutoRebuildProgress` + its mount in
 * `ArweavePanel` do not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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

describe("ArweavePanel — LibraryAutoRebuildProgress mount (Library category)", () => {
  it("with deps.libraryAutoRebuildProgress present, the Library category shows the real progress status alongside LibraryArea", () => {
    renderPanel({
      libraryAutoRebuildProgress: {
        ownerIndex: 0,
        totalOwners: 2,
        currentOwnerProgress: { pagesFetched: 3, recordsFound: 9 },
      },
    });
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));

    expect(screen.getByTestId("library-area")).toBeInTheDocument();
    const status = screen.getByTestId("library-auto-rebuild-progress");
    expect(status.textContent).toMatch(/1 of 2/);
    expect(status.textContent).toMatch(/3/);
    expect(status.textContent).toMatch(/9/);
  });

  it("with deps.libraryAutoRebuildProgress absent (the default makeDeps), nothing renders — same graceful no-op every other optional seam follows", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));

    expect(screen.getByTestId("library-area")).toBeInTheDocument();
    expect(screen.queryByTestId("library-auto-rebuild-progress")).not.toBeInTheDocument();
  });
});
