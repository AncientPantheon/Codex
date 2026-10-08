/**
 * RED matrix for the new "Codex ID" tab (`codex-id-page` T1).
 *
 * This is the dedicated, standalone home for the codex's permaweb posture —
 * the real, live restore-eligibility status (reused from
 * `ArweaveRestoreEligibilityStatus`, the SAME component already mounted in
 * the Library tab — no second eligibility-checking implementation), plus
 * composition points for T2's informatics content and T3's action buttons
 * (not this task's job to build their real content).
 *
 * Mirrors `e4-panel-categories.test.tsx` / `e4-panel-restore-eligibility.test.tsx`'s
 * own `makeDeps`/`renderPanel` setup — same fakes, same real `ArweavePanel`
 * mount through `CodexProvider` + `ArweavePanelProvider`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import {
  ARWEAVE_RESTORE_ELIGIBLE_MESSAGE,
  ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE,
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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ArweavePanel — the 'Codex ID' tab", () => {
  it("is present in the tab bar, alongside the other five categories", () => {
    renderPanel();
    expect(screen.getByTestId("arweave-subtab-codex-id")).toHaveTextContent("Codex ID");
  });

  it("clicking it shows the Codex ID page body and hides whatever was showing before (e.g. the default Accounts body)", () => {
    renderPanel();
    // Default category is `accounts` — its body is visible to start with.
    expect(screen.queryByTestId("arweave-codex-id-page")).toBeNull();

    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
    // Accounts' own send button (present by default — see
    // `e4-panel-categories.test.tsx`'s identical assertion) is gone now that
    // Accounts isn't the active category.
    expect(screen.queryByTestId(`arweave-account-send-${ARWEAVE_ADDRESS}`)).toBeNull();
  });

  it("an ELIGIBLE codex shows the real eligible-restore copy, reusing ArweaveRestoreEligibilityStatus's own message — not a second implementation", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    await waitFor(() =>
      expect(screen.getByText(ARWEAVE_RESTORE_ELIGIBLE_MESSAGE)).toBeInTheDocument(),
    );
    expect(screen.queryByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).not.toBeInTheDocument();
  });

  it("a NOT-eligible codex shows the real not-eligible copy, with its real reason text", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => false) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    await waitFor(() =>
      expect(screen.getByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).toBeInTheDocument(),
    );
    expect(screen.queryByText(ARWEAVE_RESTORE_ELIGIBLE_MESSAGE)).not.toBeInTheDocument();
  });

  it("the page is fully composed now (T3) — T1's generic placeholder is gone, replaced by T2's real informatics content", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    expect(screen.queryByTestId("arweave-codex-id-coming-soon")).toBeNull();
    expect(screen.getByTestId("codex-backup-informatics")).toBeInTheDocument();
    expect(screen.getByTestId("codex-migration-informatics")).toBeInTheDocument();
  });

  it("the 'make this codex eligible' action is present and genuinely disabled (not eligible / unknown eligibility — the default)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    expect(makeEligible).toBeDisabled();

    // A disabled button fires no click handler at all — nothing to assert
    // beyond "the page is unchanged" (no handler exists to wrongly run).
    fireEvent.click(makeEligible);
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
  });

  it("the 'make this codex eligible' disabled action carries specific, honest 'coming soon' messaging — not vague placeholder text", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    expect(makeEligible).toHaveTextContent(/coming soon/i);
    expect(makeEligible.title).toMatch(/migration wizard/i);
    expect(screen.getByText(/legacy-prime-migration/i)).toBeInTheDocument();
  });

  it("an ELIGIBLE codex does NOT show the disabled 'make eligible' button — it shows an 'already eligible' confirmation instead", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    await waitFor(() =>
      expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("arweave-codex-id-make-eligible")).toBeNull();
    // The real backup trigger stays enabled regardless of eligibility — a
    // different (now-built) engine gates it, not the migration status.
    const page = screen.getByTestId("arweave-codex-id-page");
    expect(within(page).getByTestId("codex-backup-start")).toBeEnabled();
  });

  it("a NOT-eligible codex (resolved, not just default/unknown) still shows the disabled 'make eligible' button, not the 'already eligible' note", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => false) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    await waitFor(() =>
      expect(screen.getByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("arweave-codex-id-make-eligible")).toBeDisabled();
    expect(screen.queryByTestId("arweave-codex-id-already-eligible")).toBeNull();
  });

  it("the 'back up this codex' coming-soon button is GONE — the backup action is real now, not disabled/coming-soon (arweave-codex-id-backup-live)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    // The old disabled placeholder button no longer exists at all.
    expect(screen.queryByTestId("arweave-codex-id-backup")).toBeNull();
    expect(screen.queryByText(/Back Up This Codex To Arweave \(coming soon\)/i)).toBeNull();
  });

  it("a real, functional backup trigger (the reused CodexBackupArea's own 'Back up codex to Arweave' button) is present and enabled on the Codex ID page", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const page = screen.getByTestId("arweave-codex-id-page");
    const trigger = within(page).getByTestId("codex-backup-start");
    expect(trigger).toBeEnabled();
  });

  it("clicking the real backup trigger and confirming calls the injected getExportJson/backupCodex seams and shows the resulting link — mirrors CodexBackupArea's own e4-panel-codex-backup.test.tsx assertion style", async () => {
    const exportJson = '{"labels":["seed-1"],"ciphertext":"opaque-blob"}';
    const resultId = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
    const getExportJson = vi.fn(async () => exportJson);
    const backupCodex = vi.fn(async (_json: string) => ({ id: resultId }));
    renderPanel({ getExportJson, backupCodex });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const page = screen.getByTestId("arweave-codex-id-page");
    fireEvent.click(within(page).getByTestId("codex-backup-start"));
    fireEvent.click(await within(page).findByTestId("codex-backup-permanence-accept"));

    await waitFor(() => expect(backupCodex).toHaveBeenCalledWith(exportJson));
    expect(getExportJson).toHaveBeenCalledTimes(1);

    const result = await within(page).findByTestId("codex-backup-result");
    expect(result.textContent).toContain(resultId);
  });

  it("the 'make this codex eligible' disabled/coming-soon button is UNCHANGED by this task (regression guard)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    expect(makeEligible).toBeDisabled();
    expect(makeEligible).toHaveTextContent(/coming soon/i);
    expect(makeEligible.title).toMatch(/migration wizard/i);
  });

  it("selecting this tab does not disturb another category's own state (regression guard — mirrors e4-panel-categories.test.tsx's 'exactly one category body at a time')", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.getByTestId("arweave-upload-start")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-upload-start")).toBeNull();

    // Selecting Upload again afterward still works correctly — the new tab
    // leaves no stray state behind.
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.getByTestId("arweave-upload-start")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-codex-id-page")).toBeNull();
  });
});
