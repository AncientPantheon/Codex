/**
 * The Arweave panel's CATEGORY menu (Class IA restructure).
 *
 * Pins the five-category vocabulary the Class 2 shell presents for Arweave —
 * Seeds · Pure Keys · Accounts · Upload · Library.
 *
 * Seeds, Pure Keys, and Accounts are wired to their real areas (own direct
 * specs in `e5-seeds-area.test.tsx` / `e4-panel-pure-keys.test.tsx` /
 * `e5-accounts-area.test.tsx`). This file's own concern is the MENU itself —
 * every category stays reachable and never renders blank or throws.
 *
 * `arweave-upload-categories` addendum (mounting): Upload and Library are now
 * ALSO wired for real — Upload mounts `UploadArea`, Library mounts
 * `CodexBackupArea` + `LibraryArea`. Their own deep behaviour is covered by
 * `e4-panel-upload.test.tsx` / `e4-panel-codex-backup.test.tsx`; this file
 * only asserts the real components actually mount through the panel (not the
 * old empty placeholder) and that a `deps === null` host still degrades to a
 * visible "unavailable" message rather than a crash, mirroring the existing
 * Pure Keys pattern.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import { ArweavePanel } from "../src/panel/ArweavePanel";
import { ArweavePanelProvider, type ArweavePanelDeps } from "../src/panel/context";
import type { UploadWizardSelection } from "../src/panel/UploadWizard";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import type { LibraryEntry, LibraryStore } from "../src/library/types";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

// `arweave-upload-wizard` T2: the SAME `useEnsureCodexUnlockedOptional`
// source `ArweavePanel.tsx` already threads into `ArweaveSeedsArea`'s mount
// (see that mount's own `ensureCodexUnlocked={ensureCodexUnlocked ?? undefined}`)
// is now ALSO threaded into the `UploadWizard` mount — mocked here (same
// pattern `e5-send-arweave-modal.test.tsx` already uses for the sibling
// `useEnsureCodexUnlocked` export) so a test can assert the wizard's own
// Confirm step actually calls it, rather than just checking the prop exists
// on the type.
const ensureCodexUnlockedOptionalMock = vi.fn(async () => true);
vi.mock("@ancientpantheon/codex-ouronet/zbom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useEnsureCodexUnlockedOptional: () => ensureCodexUnlockedOptionalMock,
  };
});

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;
const fakePool = { pick: () => ARWEAVE_ADDRESS } as unknown as GatewayPool;

/** The categories in display order, with the labels the rail renders.
 *  `codex-id` added by `codex-id-page` T1 — keep this list in sync with
 *  `ArweavePanel.tsx`'s own real `CATEGORIES` tuple. */
const CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ["seeds", "Seeds"],
  ["pure-keys", "Pure Keys"],
  ["accounts", "Accounts"],
  ["upload", "Upload"],
  ["library", "Library"],
  ["codex-id", "Codex ID"],
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
  // `SendArweaveModal` (Accounts category) calls `useEnsureCodexUnlocked`
  // (`codex-ouronet/zbom`), which requires a `<CodexProvider>` ancestor —
  // the SAME one `apps/codex-playground` always wraps `ArweavePanel` in
  // (`ForeignChainsWiring.tsx`: "Must be mounted INSIDE <CodexProvider>").
  const utils = render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <ArweavePanelProvider deps={deps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>
    </CodexProvider>,
  );
  return { deps, ...utils };
}

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

function renderPanelMobile(overrides: Partial<ArweavePanelDeps> = {}) {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const deps = makeDeps(overrides);
  const utils = render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <ArweavePanelProvider deps={deps}>
        <CodexUiRoot>
          <ArweavePanel id={ARWEAVE_CHAIN_ID} />
        </CodexUiRoot>
      </ArweavePanelProvider>
    </CodexProvider>,
  );
  return { deps, ...utils };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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

  // Seeds, Pure Keys, Accounts, Upload, and Library are ALL wired now
  // (ArweaveSeedsArea / PureKeysArea / ArweaveAccountsArea / UploadArea /
  // CodexBackupArea+LibraryArea) — no category keeps the generic empty
  // placeholder body any longer, so the old "renders a visible 'not wired
  // yet' body" matrix has no subject left. Each wired category's own deep
  // coverage lives in its own spec file (see this file's own module doc);
  // the Upload/Library "mounts for real" + "deps === null unavailable"
  // cases live in the describe blocks below.

  it("threads deps all the way to Accounts so its Send button is actually reachable (not just present on the component)", () => {
    // Regression guard: ArweaveAccountsArea's `deps` prop can exist and be
    // fully tested in isolation while ArweavePanel simply never passes it
    // down — the Send button then silently never renders in the real app.
    // This mounts the real ArweavePanel (not ArweaveAccountsArea directly)
    // with real deps and checks the button is actually there.
    renderPanel();
    expect(
      screen.getByTestId(`arweave-account-send-${ARWEAVE_ADDRESS}`),
    ).toBeInTheDocument();
  });

  it("shows exactly one category body at a time (switching away unmounts the last)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.getByTestId("arweave-upload-start")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    expect(screen.queryByTestId("arweave-upload-start")).toBeNull();
    expect(screen.getByTestId("library-area")).toBeInTheDocument();
  });
});

describe("ArweavePanel — Upload category (arweave-upload-wizard, T3: the wizard entry point)", () => {
  beforeEach(() => cleanup());

  it("selecting Upload with real deps shows two entry-point buttons, not the old always-visible flat form", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.queryByTestId("arweave-category-empty-upload")).toBeNull();
    // The old flat, always-mounted form is gone — Upload is an entry point now.
    expect(screen.queryByTestId("upload-area")).toBeNull();
    expect(screen.getByTestId("arweave-upload-start")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-upload-backup-codex")).toBeInTheDocument();
  });

  it('clicking "Start Upload" opens the UploadWizard modal wired from this panel\'s own deps/state (accounts, ouronetAccounts, pool)', () => {
    const ouronetAccounts = [
      { id: "ouro-1", label: "Ouro One", account: { address: "Ѻ.ouro-one-address" } },
    ];
    renderPanel({ ouronetAccounts });
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.queryByTestId("upload-wizard-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("arweave-upload-start"));
    expect(screen.getByTestId("upload-wizard-modal")).toBeInTheDocument();
    // Step 0's account list is this panel's OWN `arweaveKeys` (the chain-
    // scoped slice of `deps.foreignKeys`) — not a second, separately-fetched
    // list.
    expect(screen.getByTestId(`upload-wizard-account-${ARWEAVE_ADDRESS}`)).toBeInTheDocument();

    // Closing the wizard (its own close button) returns to the two-button
    // entry point, not a torn-down panel.
    fireEvent.click(screen.getByTestId("upload-wizard-close"));
    expect(screen.queryByTestId("upload-wizard-modal")).toBeNull();
    expect(screen.getByTestId("arweave-upload-start")).toBeInTheDocument();
  });

  it('shows "Back Up Codex to Arweave" as a visibly-disabled "coming soon" affordance that opens nothing yet (its destination is a later topic\'s page)', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    const backupBtn = screen.getByTestId("arweave-upload-backup-codex");
    expect(backupBtn).toBeDisabled();
    fireEvent.click(backupBtn);
    expect(screen.queryByTestId("upload-wizard-modal")).toBeNull();
  });

  it("with deps === null, Upload shows a visible 'unavailable' message rather than crashing, mirroring the Pure Keys pattern", () => {
    render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.getByTestId("arweave-upload-unavailable")).toBeInTheDocument();
  });

  // arweave-upload-wizard, T2: wiring `getBalance`/`ensureCodexUnlocked`
  // through to the mounted `UploadWizard` — exercised, not just typed.
  it("wires the real `getBalance` from deps into the mounted UploadWizard — a fake deps.getBalance is actually called and its resolved balance shows on the Account step", async () => {
    const getBalance = vi.fn(async (address: string) =>
      address === ARWEAVE_ADDRESS ? 7_000_000_000_000n : 0n,
    );
    renderPanel({ getBalance });
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    fireEvent.click(screen.getByTestId("arweave-upload-start"));

    expect(getBalance).toHaveBeenCalledWith(ARWEAVE_ADDRESS);
    await waitFor(() =>
      expect(screen.getByTestId(`upload-wizard-account-balance-${ARWEAVE_ADDRESS}`).textContent).toBe(
        "7 AR",
      ),
    );
  });

  it("wires the real `ensureCodexUnlocked` into the mounted UploadWizard — the SAME source (`useEnsureCodexUnlockedOptional`) Seeds already uses, not a second path — Confirm & Upload actually calls it before uploading", async () => {
    const { deps } = renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    fireEvent.click(screen.getByTestId("arweave-upload-start"));

    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ARWEAVE_ADDRESS}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    // Round 2: the category picker is a custom ACCENT-styled dropdown, not a
    // native `<select>` — open it, then click the matching option.
    fireEvent.click(screen.getByTestId("upload-wizard-category"));
    fireEvent.click(screen.getByTestId("upload-wizard-category-option-general-other"));
    fireEvent.click(screen.getByTestId("upload-wizard-mode-public"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), {
      target: { files: [new File([new Uint8Array(10)], "note.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(ensureCodexUnlockedOptionalMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(deps.uploadAndTrack).toHaveBeenCalledTimes(1));
  });

  // arweave-non-removable-account T4: `ArweavePanelDeps.onAccountUsedForEncryption`
  // threaded into the mounted `UploadWizard` — regression guard for the
  // non-removable-account invariant's dead-letter gap (design.md: "the
  // trigger exists and fires [in library/flow.ts], but nothing in the real
  // app is wired to it yet"). This asserts the wiring is ACTUALLY reachable
  // through the real `ArweavePanel` → `UploadWizard` mount, not just present
  // on `ArweavePanelDeps`'s type — a fake could be type-compatible while the
  // panel silently never passed it down (the same class of regression the
  // Send-button test above this one already guards against for Accounts).
  it("wires the real `onAccountUsedForEncryption` from deps into the mounted UploadWizard — a fake is actually called with the encrypting account's id once a mocked encrypted upload succeeds", async () => {
    const onAccountUsedForEncryption = vi.fn();
    const ouronetAccounts = [
      { id: "ouro-1", label: "Ouro One", account: { address: "Ѻ.ouro-one-address" } },
    ];
    const { deps } = renderPanel({ ouronetAccounts, onAccountUsedForEncryption });
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    fireEvent.click(screen.getByTestId("arweave-upload-start"));

    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ARWEAVE_ADDRESS}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.click(screen.getByTestId("upload-wizard-category"));
    fireEvent.click(screen.getByTestId("upload-wizard-category-option-general-other"));
    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted"));
    fireEvent.click(screen.getByTestId("upload-wizard-encryptor-ouro-1"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), {
      target: { files: [new File([new Uint8Array(10)], "note.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(deps.uploadAndTrack).toHaveBeenCalledTimes(1));
    expect(onAccountUsedForEncryption).toHaveBeenCalledWith("ouro-1");
  });

  // `arweave-upload-wizard-deps-wiring-gap`: `ArweavePanel.tsx`'s own
  // `<UploadWizard>` mount never forwarded `deps.runDryRunUpload` — the
  // "Test this upload" dry-run button (built, unit-tested, and
  // real-browser-verified in isolation by `arweave-upload-dry-run`) has
  // therefore never actually been reachable through the real panel, since
  // `UploadWizard` itself renders that button only when its own
  // `runDryRunUpload` prop is truthy. This is the SAME class of regression
  // the `onAccountUsedForEncryption` test above already guards against for
  // the non-removable-account dead-letter gap: a fake can be fully
  // type-compatible with `ArweavePanelDeps` while the panel silently never
  // passes it down to the mounted `UploadWizard`.
  it("wires the real `runDryRunUpload` from deps into the mounted UploadWizard — the Test button is now visible and clicking it calls the real seam with the selected files/selection/accountId, rendering the dry-run result panel", async () => {
    const dryRunResult = {
      success: true,
      filesTested: 1,
      totalBytes: 10,
      chunksPosted: 1,
      resumeTested: true,
      proofsValid: true,
      decryptRoundTripOk: "not-applicable" as const,
      streamingSupported: true,
      elapsedMs: 42,
      errors: [],
    };
    const runDryRunUpload = vi.fn(
      async (_files: File[], _selection: UploadWizardSelection, _accountId: string) => dryRunResult,
    );
    const { deps } = renderPanel({ runDryRunUpload });
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    fireEvent.click(screen.getByTestId("arweave-upload-start"));

    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ARWEAVE_ADDRESS}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.click(screen.getByTestId("upload-wizard-category"));
    fireEvent.click(screen.getByTestId("upload-wizard-category-option-general-other"));
    fireEvent.click(screen.getByTestId("upload-wizard-mode-public"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    const file = new File([new Uint8Array(10)], "note.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    const dryRunButton = screen.getByTestId("upload-wizard-dry-run-button");
    expect(dryRunButton).toBeInTheDocument();
    fireEvent.click(dryRunButton);

    await waitFor(() => expect(runDryRunUpload).toHaveBeenCalledTimes(1));
    const [files, selection, accountId] = runDryRunUpload.mock.calls[0];
    expect((files as File[])[0].name).toBe("note.txt");
    expect(selection).toMatchObject({ category: "general-other" });
    expect(accountId).toBe(ARWEAVE_ADDRESS);
    expect(await screen.findByTestId("upload-wizard-dry-run-result")).toBeInTheDocument();
    // The real upload path was never touched by a dry run.
    expect(deps.uploadAndTrack).not.toHaveBeenCalled();
  });

  it("without `deps.runDryRunUpload` wired, the mounted UploadWizard never renders a 'Test this upload' button (never a disabled dead button)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    fireEvent.click(screen.getByTestId("arweave-upload-start"));
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ARWEAVE_ADDRESS}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    expect(screen.queryByTestId("upload-wizard-dry-run-button")).toBeNull();
  });

  // `arweave-upload-wizard-deps-wiring-gap`: the sibling bug
  // (`arweave-streaming-ui-support-probe-worker`) fixed the Worker-backed
  // OPFS-support probe at its source, but nothing forwarded it through
  // `ArweavePanel.tsx`'s own `<UploadWizard>` mount — so the real panel kept
  // calling `UploadWizard`'s DEFAULT (broken, main-thread) probe regardless.
  it("wires the real `isStreamingUploadSupported` from deps into the mounted UploadWizard — a fake is actually called once per wizard session, confirming it reaches the real mount rather than the component's own default", async () => {
    const isStreamingUploadSupported = vi.fn(async () => true);
    renderPanel({ isStreamingUploadSupported });
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    fireEvent.click(screen.getByTestId("arweave-upload-start"));

    await waitFor(() => expect(isStreamingUploadSupported).toHaveBeenCalledTimes(1));
  });
});

describe("ArweavePanel — Library category (arweave-upload-categories addendum: mounting)", () => {
  beforeEach(() => cleanup());

  it("selecting Library with real deps renders the real LibraryArea (General Data tab, the default) AND, on the Codex tab, CodexBackupArea — not the old empty placeholder", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    expect(screen.queryByTestId("arweave-category-empty-library")).toBeNull();
    // General Data is the default tab — LibraryArea is visible immediately.
    expect(screen.getByTestId("library-area")).toBeInTheDocument();
    // CodexBackupArea/CodexBackupHistoryArea now live on their OWN "Codex"
    // tab (`arweave-upload-library` follow-up redesign) rather than always
    // stacked above LibraryArea — reachable, not orphaned, just one click
    // away instead of unconditionally visible.
    fireEvent.click(screen.getByTestId("library-tab-codex"));
    expect(screen.getByTestId("codex-backup-area")).toBeInTheDocument();
    // CodexBackupHistoryArea (Part 2 of the same addendum) is mounted
    // alongside CodexBackupArea on that SAME "Codex" tab — the dedicated
    // "just my codex backups" list, not left orphaned either.
    expect(screen.getByTestId("codex-backup-history-area")).toBeInTheDocument();
  });

  it("with deps === null, Library shows a visible 'unavailable' message rather than crashing, mirroring the Pure Keys pattern", () => {
    render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    expect(screen.getByTestId("arweave-library-unavailable")).toBeInTheDocument();
  });

  // Real-world composition proof (owner's own report): a genuine 2-file
  // nft-data bundle (a manifest + 2 files sharing one Codex-Upload-Id, tagged
  // Codex-Category: nft-data) must render correctly through the FULL
  // ArweavePanel composition — not just in `LibraryArea`'s own isolated
  // tests, which could pass while the panel wires some prop incorrectly.
  it("a real nft-data bundle upload renders as ONE grouped NFT Data section with 2 named file rows, mounted through the real ArweavePanel", async () => {
    const MANIFEST_ID = "manManManManManManManManManManManManManManMa";
    const FILE_IMAGE_ID = "imgImgImgImgImgImgImgImgImgImgImgImgImgImgI";
    const FILE_METADATA_ID = "metMetMetMetMetMetMetMetMetMetMetMetMetMetMe";

    const libraryRows: LibraryEntry[] = [
      {
        id: MANIFEST_ID,
        owner: ARWEAVE_ADDRESS,
        itemId: "item-manifest",
        contentType: "application/x.arweave-manifest+json",
        status: "final",
        createdAt: 300,
        manifest: { isManifest: true },
        uploadId: "upload-bunny",
        tags: [{ name: "Codex-Category", value: "nft-data" }],
      },
      {
        id: FILE_IMAGE_ID,
        owner: ARWEAVE_ADDRESS,
        itemId: "item-image",
        contentType: "image/png",
        status: "final",
        createdAt: 300,
        uploadId: "upload-bunny",
        tags: [
          { name: "Codex-Category", value: "nft-data" },
          { name: "Codex-Path", value: "Set_Bunny_RGB_Big.png" },
        ],
      },
      {
        id: FILE_METADATA_ID,
        owner: ARWEAVE_ADDRESS,
        itemId: "item-metadata",
        contentType: "application/json",
        status: "final",
        createdAt: 300,
        uploadId: "upload-bunny",
        tags: [
          { name: "Codex-Category", value: "nft-data" },
          { name: "Codex-Path", value: "metadata.json" },
        ],
      },
    ];

    renderPanel({ listLibrary: vi.fn(async () => libraryRows) });
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));

    expect(await screen.findByTestId("library-category-nft-data")).toHaveTextContent("NFT Data");
    const group = screen.getByTestId("library-bundle-group");
    const rows = within(group).getAllByTestId("library-entry");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent).join(" ")).toContain("Set_Bunny_RGB_Big.png");
    expect(rows.map((r) => r.textContent).join(" ")).toContain("metadata.json");
    // The manifest is demoted to the group header, never a 3rd peer row.
    expect(screen.queryAllByTestId("library-entry")).toHaveLength(2);
    // Each file row's own copyable link box + Copy button are present.
    for (const row of rows) {
      expect(within(row).getByTestId("library-link-box")).toBeInTheDocument();
      expect(within(row).getByTestId("library-copy-button")).toBeInTheDocument();
    }
  });
});

describe("ArweavePanel — mobile: icon-only, centered, single-line category row (design.md §8, the 'Blockchain Accounts' cleanup round)", () => {
  beforeEach(() => cleanup());

  it("renders all five categories as icon-only buttons, not text-pill tabs", () => {
    renderPanelMobile();
    for (const [, label] of CATEGORIES) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("centers the category row", () => {
    renderPanelMobile();
    // Round 9's "standard pagination controls zone" reserved left/right
    // slots (a seed/address count, a refresh button) on the OUTER tablist
    // row — the actual centered icon group now lives in an inner wrapper
    // (`flex: 1, justifyContent: center`) so those reserved slots don't
    // skew the centering.
    const keysBtn = screen.getByRole("button", { name: "Seeds" });
    const row = keysBtn.parentElement as HTMLElement;
    expect(row.style.justifyContent).toBe("center");
  });

  it("still switches categories via the SAME generation-guard-aware requestCategory path — e.g. lands on the Upload category's real body", () => {
    renderPanelMobile();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByTestId("arweave-upload-start")).toBeInTheDocument();
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — still the wrapping text-pill tablist", () => {
    renderPanel();
    expect(screen.getAllByRole("tab")).toHaveLength(CATEGORIES.length);
  });
});

// Round 20 owner correction: "add arweave seed must be similar to how
// chainwebs seed is added wit ha plus button in the upper line aligned
// right" — mirrors `ChainwebPanel.tsx`'s own "+" in the same tablist
// right-slot, wired from `ArweaveSeedsArea`'s reported `openDefine` handle.
describe("ArweavePanel — mobile: the relocated Seeds '+' add-seed button (round 20)", () => {
  beforeEach(() => cleanup());

  it("shows a '+' add-seed button only while the Seeds category is active", () => {
    renderPanelMobile();
    // Default category is Accounts — no add-seed button yet.
    expect(screen.queryByTestId("arweave-mobile-add-seed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    expect(screen.getByTestId("arweave-mobile-add-seed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.queryByTestId("arweave-mobile-add-seed")).toBeNull();
  });

  it("clicking it opens the SAME define-seed form the (desktop-only, on mobile) bottom button opens", () => {
    renderPanelMobile();
    fireEvent.click(screen.getByRole("button", { name: "Seeds" }));
    fireEvent.click(screen.getByTestId("arweave-mobile-add-seed"));
    expect(screen.getByTestId("arweave-seed-define-form")).toBeInTheDocument();
  });

  it("desktop shows no such button in the tablist — it keeps its own bottom 'Add Arweave Seed' button instead", () => {
    // A Prime seed must already exist, or `ArweaveSeedsArea` shows its
    // "define your first seed" state instead of the normal list + bottom
    // button — orthogonal to this test's concern (mobile-vs-desktop).
    // `arweaveSeeds` is a real runtime seam (`ArweavePanel.tsx`'s own
    // `ArweaveSeedStoreSeams`, read via a cast) that isn't part of the
    // narrower `ArweavePanelDeps` type this file's `makeDeps` is typed
    // against — cast through a local so the excess-property check doesn't
    // block a field the component genuinely reads.
    const overrides = { arweaveSeeds: [{ id: "prime", label: "Prime Arweave Seed", bits: "1".repeat(1600), isPrime: true }] };
    renderPanel(overrides as Partial<ArweavePanelDeps>);
    fireEvent.click(screen.getByRole("tab", { name: /seeds/i }));
    expect(screen.queryByTestId("arweave-mobile-add-seed")).toBeNull();
    expect(screen.getByTestId("arweave-add-seed")).toBeTruthy();
  });
});

describe("ArweavePanel — mobile: the shared 'standard pagination controls zone' (round 9 — owner correction: 'we also need to agree on a standard pagination controls zone. If no expand collapse medallion exists at the middle of the bottom page... that's where the pagination controls should be in their own medallion with prev and next buttons, which should be simple square and with arrows, instead of the name'). Mirrors ChainwebPanel's own identical round-9 correction.", () => {
  beforeEach(() => cleanup());

  /** `n` distinct Arweave keys, all under the SAME (single, implicit
   *  "Unassigned") group — a single group means no Collapse-All medallion. */
  function manyKeys(n: number): ForeignKeyEntry[] {
    return Array.from({ length: n }, (_, i) => makeEntry({
      id: `key-${i}`,
      address: `ADDR-${String(i).padStart(4, "0")}`,
    }));
  }

  it("a single-group Accounts view (no Collapse-All medallion) shows the pagination medallion in the shared bottom-center slot, with square Prev/Next arrow buttons — and Next actually advances", async () => {
    renderPanelMobile({ foreignKeys: manyKeys(6) });
    // No Collapse-All medallion — a single (Unassigned) group has nothing
    // to collapse.
    expect(screen.queryByText("Collapse")).toBeNull();
    const prevBtn = await screen.findByRole("button", { name: "Previous page" });
    const nextBtn = screen.getByRole("button", { name: "Next page" });
    expect(prevBtn.textContent).toBe("");
    expect(nextBtn.textContent).toBe("");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.click(nextBtn);
    expect(await screen.findByText("2 / 2")).toBeTruthy();
  });

  it("past 10 pages, the medallion's center number becomes a clickable jump control", async () => {
    renderPanelMobile({ foreignKeys: manyKeys(44) });
    // Round 11 — flat entries, no header cost anymore: 44 entries / 4 per
    // page = 11 pages.
    const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
    fireEvent.click(jumpBtn);
    const input = screen.getByLabelText(/jump to page/i);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("9 / 11")).toBeTruthy();
  });

  it("portals the pagination medallion into a supplied zone3AnchorTarget, landing on that target's OWN bottom border", async () => {
    const railTarget = document.createElement("div");
    document.body.appendChild(railTarget);
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const deps = makeDeps({ foreignKeys: manyKeys(6) });
    const { container } = render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <ArweavePanelProvider deps={deps}>
          <CodexUiRoot>
            <ArweavePanel id={ARWEAVE_CHAIN_ID} zone3AnchorTarget={railTarget} />
          </CodexUiRoot>
        </ArweavePanelProvider>
      </CodexProvider>,
    );
    const nextBtn = await screen.findByRole("button", { name: "Next page" });
    expect(railTarget.contains(nextBtn)).toBe(true);
    expect(container.contains(nextBtn)).toBe(false);

    document.body.removeChild(railTarget);
  });

  // Round 15 owner correction (ported from `ChainwebPanel.tsx`'s identical
  // change): "i noticed the pages are swapable, but there are no swap
  // bullets displayed, did you miss them?" — round 11 added the swipe
  // GESTURE but never its visual position indicator.
  describe("swipe bullets — the pagination medallion's own page-position dots", () => {
    it("shows one dot per page (no ellipsis) when the page count fits within the window", async () => {
      renderPanelMobile({ foreignKeys: manyKeys(6) });
      // 6 keys / 4 per page = 2 pages — well within the 7-dot window.
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByRole("tab").length).toBe(2);
      expect(within(tablist).getByRole("tab", { name: "Go to page 1" }).getAttribute("aria-selected")).toBe("true");
      expect(within(tablist).queryByText("…")).toBeNull();

      fireEvent.click(within(tablist).getByRole("tab", { name: "Go to page 2" }));
      await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
      expect(within(tablist).getByRole("tab", { name: "Go to page 2" }).getAttribute("aria-selected")).toBe("true");
    });

    it("truncates with a TRAILING ellipsis when starting near the first page of a long list", async () => {
      renderPanelMobile({ foreignKeys: manyKeys(44) });
      // 44 / 4 = 11 pages — past the 7-dot window. Starting on page 1, the
      // window can't reach backward at all, so only a TRAILING "…" shows.
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByRole("tab").length).toBe(7);
      expect(within(tablist).getAllByText("…").length).toBe(1);
      expect(within(tablist).getByRole("tab", { name: "Go to page 1" }).getAttribute("aria-selected")).toBe("true");
    });

    it("shows BOTH a leading and a trailing ellipsis once the window sits in the middle of a long list", async () => {
      renderPanelMobile({ foreignKeys: manyKeys(44) });
      const jumpBtn = await screen.findByRole("button", { name: "1 / 11" });
      fireEvent.click(jumpBtn);
      fireEvent.change(screen.getByLabelText(/jump to page/i), { target: { value: "6" } });
      fireEvent.keyDown(screen.getByLabelText(/jump to page/i), { key: "Enter" });
      await waitFor(() => expect(screen.getByText("6 / 11")).toBeTruthy());

      const tablist = screen.getByRole("tablist", { name: "Page position" });
      expect(within(tablist).getAllByText("…").length).toBe(2);
      expect(within(tablist).getByRole("tab", { name: "Go to page 6" }).getAttribute("aria-selected")).toBe("true");
    });

    it("portals alongside the arrows/jump pill, straddling the SAME border a step further down", async () => {
      const railTarget = document.createElement("div");
      document.body.appendChild(railTarget);
      FakeResizeObserver.nextWidth = 390;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      const deps = makeDeps({ foreignKeys: manyKeys(6) });
      render(
        <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
          <ArweavePanelProvider deps={deps}>
            <CodexUiRoot>
              <ArweavePanel id={ARWEAVE_CHAIN_ID} zone3AnchorTarget={railTarget} />
            </CodexUiRoot>
          </ArweavePanelProvider>
        </CodexProvider>,
      );
      const tablist = await screen.findByRole("tablist", { name: "Page position" });
      expect(railTarget.contains(tablist)).toBe(true);
      expect(tablist.style.position).toBe("absolute");
      expect(tablist.style.bottom).toBe("0px");

      document.body.removeChild(railTarget);
    });
  });
});
