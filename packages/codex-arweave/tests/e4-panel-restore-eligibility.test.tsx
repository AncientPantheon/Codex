/**
 * RED matrix for the Arweave panel's RESTORE-ELIGIBILITY status
 * (`codex-seed-restore-activation` T2).
 *
 * Pins `ArweaveRestoreEligibilityStatus`'s own contract directly (a fake
 * `checkArweaveRestoreEligibility` resolving `true`/`false`, and a
 * never-resolving one to pin the "checking…" in-flight state — this can
 * take several seconds under the real RSA-4096 derivation, so the UI must
 * never go silent while it waits), PLUS the `ArweavePanelDeps` seam +
 * `ArweavePanel` mount: present it renders through the real panel (Library
 * category, alongside `CodexBackupArea`); absent (the seam omitted) it
 * renders nothing at all — the same "absent optional seam → graceful
 * no-op" discipline every other optional `ArweavePanelDeps` field already
 * follows, verified through a REAL panel mount, not the component in
 * isolation only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import {
  ArweaveRestoreEligibilityStatus,
  ARWEAVE_RESTORE_ELIGIBLE_MESSAGE,
  ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE,
  ARWEAVE_RESTORE_CHECKING_MESSAGE,
} from "../src/panel/ArweaveRestoreEligibilityStatus";
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

/* ─────────────────────── the component, in isolation ────────────────────── */

describe("ArweaveRestoreEligibilityStatus — in-flight, eligible, not-eligible", () => {
  it("shows a real 'checking…' state while the call is in flight — never a silent freeze", async () => {
    const checkArweaveRestoreEligibility = vi.fn(() => new Promise<boolean>(() => {}));
    render(
      <ArweaveRestoreEligibilityStatus
        checkArweaveRestoreEligibility={checkArweaveRestoreEligibility}
      />,
    );

    expect(await screen.findByText(ARWEAVE_RESTORE_CHECKING_MESSAGE)).toBeInTheDocument();
    expect(checkArweaveRestoreEligibility).toHaveBeenCalledTimes(1);
  });

  it("resolving true shows the eligible copy", async () => {
    const checkArweaveRestoreEligibility = vi.fn(async () => true);
    render(
      <ArweaveRestoreEligibilityStatus
        checkArweaveRestoreEligibility={checkArweaveRestoreEligibility}
      />,
    );

    expect(await screen.findByText(ARWEAVE_RESTORE_ELIGIBLE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).not.toBeInTheDocument();
  });

  it("resolving false shows the not-yet-eligible copy", async () => {
    const checkArweaveRestoreEligibility = vi.fn(async () => false);
    render(
      <ArweaveRestoreEligibilityStatus
        checkArweaveRestoreEligibility={checkArweaveRestoreEligibility}
      />,
    );

    expect(await screen.findByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(ARWEAVE_RESTORE_ELIGIBLE_MESSAGE)).not.toBeInTheDocument();
  });

  it("with the seam absent, renders nothing", () => {
    const { container } = render(<ArweaveRestoreEligibilityStatus />);
    expect(container).toBeEmptyDOMElement();
  });
});

/* ───────────────────── mounted for real through ArweavePanel ────────────── */

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

describe("ArweavePanel — restore-eligibility status mount (Library category)", () => {
  beforeEach(() => cleanup());

  it("with deps.checkArweaveRestoreEligibility present, resolving true, the Library category shows the eligible copy alongside CodexBackupArea", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    // CodexBackupArea (and the eligibility status directly above it) now
    // live on their own "Codex" tab (`arweave-upload-library` follow-up
    // redesign) rather than the always-visible General Data default.
    fireEvent.click(screen.getByTestId("library-tab-codex"));

    expect(screen.getByTestId("codex-backup-area")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(ARWEAVE_RESTORE_ELIGIBLE_MESSAGE)).toBeInTheDocument(),
    );
  });

  it("with deps.checkArweaveRestoreEligibility absent (the default makeDeps), nothing renders — real mount through ArweavePanel, not the component in isolation", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    fireEvent.click(screen.getByTestId("library-tab-codex"));

    expect(screen.getByTestId("codex-backup-area")).toBeInTheDocument();
    expect(screen.queryByText(ARWEAVE_RESTORE_ELIGIBLE_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(ARWEAVE_RESTORE_CHECKING_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByTestId("arweave-restore-eligibility-status")).not.toBeInTheDocument();
  });
});
