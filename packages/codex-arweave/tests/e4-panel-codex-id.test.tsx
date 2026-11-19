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
import { render, screen, within, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

import type { ForeignKeyEntry, MigrationProgress } from "@ancientpantheon/codex-core";
import { MASTER_ARWEAVE_SEED } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import { ArweavePanel } from "../src/panel/ArweavePanel";
import { ArweavePanelProvider, type ArweavePanelDeps } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import type { LibraryEntry, LibraryStore } from "../src/library/types";
import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { STRUCTURAL_SHAPE_TARGET_VERSION } from "@ancientpantheon/codex-ouronet/structural-migration";
import type { KeygenWorkerMsg } from "../src/keygen";
// The payload type `ensurePrimeArweaveSeed` reports through — imported BY NAME
// from the package's own `./panel` surface rather than re-declared structurally
// here, so a field rename breaks this file's build instead of drifting past it.
import type { EnsurePrimeArweaveSeedProgress } from "../src/panel";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

/**
 * `legacy-prime-migration-wizard` T9 — mocks ONLY `LegacyPrimeMigrationWizard`
 * out of `@ancientpantheon/codex-ouronet/components` (every other export,
 * e.g. `StructuralUpgradeWizard`, passes through unmodified via
 * `importOriginal`), capturing the real props `CodexIdPage.tsx` constructs
 * and hands it — in particular the real `ensurePrimeArweaveSeed` function
 * this task wires up. The wizard's OWN internal step-by-step UI (account
 * choice, keys choice, etc.) is already covered by
 * `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx` —
 * this file's job is only to prove `CodexIdPage.tsx` builds and threads the
 * REAL capability through, which this capture lets every T9 test invoke
 * directly, exactly as the real wizard's own finalize step would once it
 * resolves `sweepNeeded: false`. Every pre-existing test in this file keeps
 * asserting only on the `legacy-prime-migration-wizard-modal` testid
 * (open/absent), which this mock still renders identically — see the mock
 * body below.
 */
interface CapturedLegacyPrimeMigrationWizardProps {
  open: boolean;
  /** `arweave-master-accounts` T2: the capability now takes a SECOND,
   *  OPTIONAL argument (`missingIndexes` / `onProgress`). Declared here the
   *  way `CodexIdPage.tsx` actually constructs it — the wizard's own prop
   *  type only ever calls it with the first argument, which stays
   *  compatible precisely because the second one is optional. */
  ensurePrimeArweaveSeed?: (
    words: {
      bitString: string;
      words?: readonly string[];
    },
    opts?: {
      missingIndexes?: readonly number[];
      onProgress?: (p: EnsurePrimeArweaveSeedProgress) => void;
    },
  ) => Promise<void>;
  /** Bug-fix round (`docs/work/wizard-keyset-scale-and-sidebar/` follow-up):
   *  `CodexIdPage.tsx` previously never passed this prop at all, so the
   *  guard step's "CURRENT" box could never resolve a real on-chain
   *  keyset-ref guard. Captured here the same way `ensurePrimeArweaveSeed`
   *  already is, to prove the real wiring exists. */
  describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
}
let capturedWizardProps: CapturedLegacyPrimeMigrationWizardProps | null = null;
vi.mock("@ancientpantheon/codex-ouronet/components", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    LegacyPrimeMigrationWizard: (props: CapturedLegacyPrimeMigrationWizardProps) => {
      capturedWizardProps = props;
      return props.open ? <div data-testid="legacy-prime-migration-wizard-modal" /> : null;
    },
  };
});

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

// Exposes the per-mount store so a test can set `Codex_Shape_Version`
// directly — same `StoreGrabber` convention as
// `packages/codex-ouronet/tests/hooks-needs-structural-upgrade.test.tsx`'s
// own (used by two parallel tasks of this plan already).
let capturedStore: ReturnType<typeof useCodexStore> | null = null;
function StoreGrabber() {
  capturedStore = useCodexStore();
  return null;
}

function renderPanel(overrides: Partial<ArweavePanelDeps> = {}) {
  const deps = makeDeps(overrides);
  const utils = render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <StoreGrabber />
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

  it("the page is fully composed now (T3) — T1's generic placeholder is gone, replaced by T2's real informatics content, now split across tabs", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    expect(screen.queryByTestId("arweave-codex-id-coming-soon")).toBeNull();
    // Default tab ("How Backup Works") shows immediately; the others are a
    // click away, not stacked all at once (owner correction, 2026-10-12:
    // the page read as one undifferentiated wall even after a visual-only
    // re-style — split into tabs).
    expect(screen.getByTestId("codex-backup-informatics")).toBeInTheDocument();
    expect(screen.queryByTestId("codex-encryption-informatics")).toBeNull();
    expect(screen.queryByTestId("codex-migration-informatics")).toBeNull();

    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-encryption"));
    expect(screen.getByTestId("codex-encryption-informatics")).toBeInTheDocument();
    expect(screen.queryByTestId("codex-backup-informatics")).toBeNull();

    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-migration"));
    expect(screen.getByTestId("codex-migration-informatics")).toBeInTheDocument();
    expect(screen.queryByTestId("codex-encryption-informatics")).toBeNull();
  });

  it("`legacy-prime-migration-wizard` T3: the 'make this codex eligible' action is present and ENABLED on a VERSIONED, not-yet-eligible codex — the old disabled 'coming soon' placeholder is gone", () => {
    renderPanel();
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    expect(makeEligible).toBeEnabled();
    expect(makeEligible).not.toHaveTextContent(/coming soon/i);
  });

  it("`legacy-prime-migration-wizard` T3: clicking 'make this codex eligible' on a VERSIONED codex opens the LegacyPrimeMigrationWizard modal, absent before the click and present after", async () => {
    renderPanel();
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    // Round 6 owner correction (`codex-id-step-flow`): clicking this button
    // now calls `useEnsureCodexUnlockedOptional()` FIRST — the SAME real
    // global unlock gate every ZBOM transaction modal already calls before
    // signing, popping `<PasswordModal>` if locked. Authenticated here so
    // the fast path (`useRequestPassword`'s own "already unlocked, resolve
    // immediately" branch) resolves without needing a `<PasswordModal>`
    // mounted in this test's tree; the gate itself (prompt-on-locked,
    // cancel-aborts) is this hook's OWN existing test suite's job, not
    // re-tested here.
    act(() => {
      capturedStore!.getState().actions.authenticate("test-password", 60);
    });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    expect(screen.queryByTestId("legacy-prime-migration-wizard-modal")).toBeNull();

    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    fireEvent.click(makeEligible);

    // The unlock gate's own fast path still resolves via a real Promise
    // microtask (not synchronously) even when already unlocked — `waitFor`
    // instead of a bare synchronous assertion.
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-wizard-modal")).toBeInTheDocument();
    });
  });

  // Owner correction (this session): "when clicking the Make eligible
  // button, the system [should] ask for the password, to unlock the
  // codex, if its locked similarly to when youre executing a transaction."
  // Proves the actual gated path: on a LOCKED codex, clicking "Make Codex
  // Permaweb Eligible" does NOT open the wizard — it sets the store's real
  // `pendingPasswordRequest` (the SAME slice `<PasswordModal>` and every
  // ZBOM transaction modal already key off) instead. Submitting the
  // request authenticates AND opens the wizard; cancelling leaves it
  // closed, with the codex still locked.
  it("`codex-id-step-flow` round 6: on a LOCKED codex, clicking 'make this codex eligible' does NOT open the wizard immediately — it sets the real pendingPasswordRequest, same as a ZBOM transaction", async () => {
    renderPanel();
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    // Deliberately never authenticated — a genuinely locked codex.
    expect(capturedStore!.getState().locked).toBe(true);

    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
    fireEvent.click(screen.getByTestId("arweave-codex-id-make-eligible"));

    await waitFor(() => {
      expect(capturedStore!.getState().pendingPasswordRequest).not.toBeNull();
    });
    expect(screen.queryByTestId("legacy-prime-migration-wizard-modal")).toBeNull();

    // Submitting the request — the SAME action `<PasswordModal>`'s own
    // submit button calls — authenticates AND resolves the gate.
    act(() => {
      capturedStore!.getState().actions.submitPasswordRequest("real-password", 60);
    });

    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-wizard-modal")).toBeInTheDocument();
    });
    expect(capturedStore!.getState().locked).toBe(false);
  });

  it("`codex-id-step-flow` round 6: cancelling the password request on a LOCKED codex leaves the wizard closed and the codex still locked", async () => {
    renderPanel();
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });

    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
    fireEvent.click(screen.getByTestId("arweave-codex-id-make-eligible"));

    await waitFor(() => {
      expect(capturedStore!.getState().pendingPasswordRequest).not.toBeNull();
    });

    act(() => {
      capturedStore!.getState().actions.cancelPasswordRequest();
    });

    // Give the rejected promise's own `.catch`-equivalent (the hook's
    // `catch { return false; }`) a tick to settle, then confirm nothing
    // opened and nothing got silently authenticated.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("legacy-prime-migration-wizard-modal")).toBeNull();
    expect(capturedStore!.getState().locked).toBe(true);
  });

  it("`permaweb-eligibility-gate`: an UNVERSIONED codex (Codex_Shape_Version undefined — the default) shows 'make this codex eligible' DISABLED, with an explanation to version first", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    expect(makeEligible).toBeDisabled();
    expect(makeEligible).toHaveAttribute(
      "title",
      expect.stringMatching(/not versioned.*version it first/i),
    );
    // `codex-id-step-flow`: the inline explanation under a gated step is
    // now the short "Step N must be checked first" form, matching the
    // other gated steps — the `title` attribute above still carries the
    // longer "version it first, then make eligible" explanation. Scoped to
    // Step 2's own card since Step 3 shows the identical "Step 1 must be
    // checked first" text for the same reason (both gated on Step 1).
    const step2Card = screen.getByTestId("codex-id-step-2");
    expect(within(step2Card).getByText(/step 1.*must be checked first/i)).toBeInTheDocument();

    // A disabled button fires no click handler — the wizard modal never opens.
    fireEvent.click(makeEligible);
    expect(screen.queryByTestId("legacy-prime-migration-wizard-modal")).toBeNull();
  });

  it("`permaweb-eligibility-gate`: an unversioned codex that is also resolved NOT-eligible still shows 'make eligible' DISABLED (the versioning gate wins over the old enabled-by-default behavior)", () => {
    // Unversioned (default, no stamp) already disables Step 2 regardless of
    // eligibility — no need to wait for `checkArweaveRestoreEligibility` to
    // resolve for this specific assertion.
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => false) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    expect(screen.getByTestId("arweave-codex-id-make-eligible")).toBeDisabled();
  });

  it("an ELIGIBLE codex does NOT show the disabled 'make eligible' button — it shows an 'already eligible' confirmation instead", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    await waitFor(() =>
      expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("arweave-codex-id-make-eligible")).toBeNull();
    // `codex-id-step-flow`: Step 3 (upload) is now gated on BOTH Step 1
    // (versioned) and Step 2 (eligible) — a real eligible codex would
    // always have gone through Step 1 first too, so stamp it here
    // (same race-avoidance ordering already established in this file:
    // AFTER the async init()/eligibility-check settle).
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    // Owner correction (2026-10-12): the real backend (`buildRealPanelDeps`'s
    // `backupCodex` closure) unconditionally REQUIRES eligibility — clicking
    // backup on an ineligible codex was always going to throw. The trigger
    // is now gated the same way: enabled ONLY once eligible, matching reality
    // instead of a guaranteed-to-fail click.
    const page = screen.getByTestId("arweave-codex-id-page");
    expect(within(page).getByTestId("codex-backup-wizard-open")).toBeEnabled();
  });

  it("a NOT-eligible, VERSIONED codex (resolved, not just default/unknown) still shows the ENABLED 'make eligible' button, not the 'already eligible' note", () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => false) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
    // Stamped IMMEDIATELY after render+click, with NO `waitFor` in between
    // (mirrors the already-safe `upgrade-prompt-ui` T5 pattern elsewhere in
    // this file) — a `waitFor` here would race `CodexProvider`'s own async
    // `init()`, which re-sets `Codex_Shape_Version` from the (empty) adapter
    // snapshot and can clobber a manual stamp set mid-poll.
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    expect(screen.getByTestId("arweave-codex-id-make-eligible")).toBeEnabled();
    expect(screen.queryByTestId("arweave-codex-id-already-eligible")).toBeNull();
  });

  it("a NOT-eligible, VERSIONED codex shows the backup trigger DISABLED, with an honest explanation — the real backend throws for anything short of eligible", () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => false) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
    // `codex-id-step-flow`: Step 1 (versioned) first — this test's own
    // concern is specifically the Step-2-blocks-Step-3 case, not Step 1.
    // Stamped immediately, same race-avoidance reasoning as above.
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    const trigger = screen.getByTestId("codex-backup-wizard-open");
    expect(trigger).toBeDisabled();
    // `codex-id-step-flow`: the "(not yet eligible)" suffix moved out of
    // the button's own TEXT (so all 3 steps' buttons are the same size) —
    // the `title` tooltip still carries the explanation, and the
    // paragraph below names exactly which step is blocking (next line).
    expect(trigger).toHaveAttribute("title", expect.stringMatching(/once this codex is eligible/i));
    expect(screen.getByText(/step 2.*must be checked first/i)).toBeInTheDocument();
    // A disabled button fires no click handler — the wizard modal never opens.
    fireEvent.click(trigger);
    expect(screen.queryByTestId("codex-backup-wizard-modal")).toBeNull();
  });

  it("the 'back up this codex' coming-soon button is GONE — the backup action is real now, not disabled/coming-soon (arweave-codex-id-backup-live)", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    // The old disabled placeholder button no longer exists at all.
    expect(screen.queryByTestId("arweave-codex-id-backup")).toBeNull();
    expect(screen.queryByText(/Back Up This Codex To Arweave \(coming soon\)/i)).toBeNull();
  });

  it("a real, functional backup trigger (opens a popup wrapping the reused CodexBackupArea) is present and enabled on an ELIGIBLE, VERSIONED Codex ID page", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    await waitFor(() =>
      expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
    );
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    const page = screen.getByTestId("arweave-codex-id-page");
    const trigger = within(page).getByTestId("codex-backup-wizard-open");
    expect(trigger).toBeEnabled();

    // Owner correction (2026-10-12): the backup action opens as a real
    // popup (CodexModalShell — the same modal chrome every other
    // write-action in this app uses) rather than rendering inline.
    expect(screen.queryByTestId("codex-backup-wizard-modal")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByTestId("codex-backup-wizard-modal")).toBeInTheDocument();
    expect(within(screen.getByTestId("codex-backup-wizard-modal")).getByTestId("codex-backup-start")).toBeInTheDocument();
  });

  it("clicking the backup trigger, opening the popup, and confirming calls the injected getExportJson/backupCodex seams and shows the resulting link — mirrors CodexBackupArea's own e4-panel-codex-backup.test.tsx assertion style", async () => {
    const exportJson = '{"labels":["seed-1"],"ciphertext":"opaque-blob"}';
    const resultId = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
    const getExportJson = vi.fn(async () => exportJson);
    const backupCodex = vi.fn(async (_json: string) => ({ id: resultId }));
    renderPanel({
      getExportJson,
      backupCodex,
      checkArweaveRestoreEligibility: vi.fn(async () => true),
    });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const page = screen.getByTestId("arweave-codex-id-page");
    await waitFor(() =>
      expect(within(page).getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
    );
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    expect(within(page).getByTestId("codex-backup-wizard-open")).toBeEnabled();
    fireEvent.click(within(page).getByTestId("codex-backup-wizard-open"));

    const modal = screen.getByTestId("codex-backup-wizard-modal");
    fireEvent.click(within(modal).getByTestId("codex-backup-start"));
    fireEvent.click(await within(modal).findByTestId("codex-backup-permanence-accept"));

    await waitFor(() => expect(backupCodex).toHaveBeenCalledWith(exportJson));
    expect(getExportJson).toHaveBeenCalledTimes(1);

    const result = await within(modal).findByTestId("codex-backup-result");
    expect(result.textContent).toContain(resultId);
  });

  it("closing the backup popup (×) dismisses it without losing the page", async () => {
    renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
    );
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    expect(screen.getByTestId("codex-backup-wizard-open")).toBeEnabled();
    fireEvent.click(screen.getByTestId("codex-backup-wizard-open"));
    expect(screen.getByTestId("codex-backup-wizard-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("codex-backup-wizard-close"));
    expect(screen.queryByTestId("codex-backup-wizard-modal")).toBeNull();
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
  });

  it("`legacy-prime-migration-wizard` T3: on a VERSIONED codex, the 'make this codex eligible' button's title still references the migration wizard, honestly (no longer 'coming soon')", () => {
    renderPanel();
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    expect(makeEligible).toBeEnabled();
    expect(makeEligible.title).toMatch(/migration wizard/i);
    expect(makeEligible.title).not.toMatch(/coming soon/i);
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

  it("`upgrade-prompt-ui` T5: an unversioned codex (Codex_Shape_Version undefined — the default) shows the enabled 'Upgrade Codex Now' button, and clicking it opens the StructuralUpgradeWizard modal", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    const upgradeButton = screen.getByTestId("codex-id-structural-upgrade-open");
    expect(upgradeButton).toBeEnabled();
    expect(screen.queryByTestId("structural-upgrade-wizard-modal")).toBeNull();

    fireEvent.click(upgradeButton);

    expect(screen.getByTestId("structural-upgrade-wizard-modal")).toBeInTheDocument();
  });

  it("`upgrade-prompt-ui` T5: once Codex_Shape_Version is stamped at the current structural target, the 'Upgrade Codex Now' button is gone, replaced by an 'up to date' note", () => {
    renderPanel();
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

    expect(screen.queryByTestId("codex-id-structural-upgrade-open")).toBeNull();
    // `codex-id-step-flow`: the done-state note is now button-shaped and
    // shows the real version inline ("✓ Versioned — v1.0.0"), not the old
    // "Up to date..." sentence.
    expect(screen.getByTestId("codex-id-structural-upgrade-up-to-date")).toHaveTextContent(
      /versioned/i,
    );
  });

  describe("`codex-id-step-flow`: the 3-step row", () => {
    it("renders all 3 steps inside one row container, left to right, with an arrow between each pair", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

      const row = screen.getByTestId("codex-id-steps-row");
      const step1 = within(row).getByTestId("codex-id-step-1");
      const step2 = within(row).getByTestId("codex-id-step-2");
      const step3 = within(row).getByTestId("codex-id-step-3");
      // DOM order IS left-to-right order for a row with no reordering CSS.
      const children = Array.from(row.children);
      expect(children.indexOf(step1)).toBeLessThan(children.indexOf(step2));
      expect(children.indexOf(step2)).toBeLessThan(children.indexOf(step3));
      // Exactly 2 arrows: one between 1-2, one between 2-3.
      expect(within(row).getAllByText("→")).toHaveLength(2);
    });

    it("Step 1 is always enabled, regardless of Steps 2/3's own state", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

      expect(screen.getByTestId("codex-id-structural-upgrade-open")).toBeEnabled();
    });

    it("Step 2 is disabled while Step 1 is unchecked, and shows its own inline reason", () => {
      renderPanel();
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

      const step2 = screen.getByTestId("codex-id-step-2");
      expect(within(step2).getByTestId("arweave-codex-id-make-eligible")).toBeDisabled();
      expect(within(step2).getByText(/step 1.*must be checked first/i)).toBeInTheDocument();
    });

    it("Step 2 becomes enabled once Step 1 is checked (Codex_Shape_Version stamped)", () => {
      renderPanel();
      act(() => {
        capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
      });
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));

      expect(screen.getByTestId("arweave-codex-id-make-eligible")).toBeEnabled();
    });

    it("Step 3 is disabled while Step 1 is unchecked, naming Step 1 as the blocker", () => {
      renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => false) });
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
      const step3 = screen.getByTestId("codex-id-step-3");
      expect(within(step3).getByTestId("codex-backup-wizard-open")).toBeDisabled();
      expect(within(step3).getByText(/step 1.*must be checked first/i)).toBeInTheDocument();
    });

    it("Step 3 is disabled while Step 1 is checked but Step 2 is not, naming Step 2 as the blocker", () => {
      renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => false) });
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
      // Stamped immediately after render+click, no intervening `waitFor` —
      // same race-avoidance reasoning as the other VERSIONED tests above.
      act(() => {
        capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
      });
      const step3 = screen.getByTestId("codex-id-step-3");
      expect(within(step3).getByTestId("codex-backup-wizard-open")).toBeDisabled();
      expect(within(step3).getByText(/step 2.*must be checked first/i)).toBeInTheDocument();
    });

    it("Step 3 becomes enabled once BOTH Step 1 and Step 2 are checked", async () => {
      renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
      await waitFor(() =>
        expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
      );
      act(() => {
        capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
      });

      expect(screen.getByTestId("codex-backup-wizard-open")).toBeEnabled();
    });

    it("Steps 1 and 2 show a checkmark badge once done; Step 3's badge reflects 'last backup succeeded', not a permanent checkmark", async () => {
      renderPanel({ checkArweaveRestoreEligibility: vi.fn(async () => true) });
      fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
      await waitFor(() =>
        expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
      );

      // Step 1 unchecked yet -> shows the number, not a checkmark.
      expect(within(screen.getByTestId("codex-id-step-1")).getByText("1")).toBeInTheDocument();

      act(() => {
        capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
      });

      // Step 1 and Step 2 both checked now.
      expect(within(screen.getByTestId("codex-id-step-1")).getByText("✓")).toBeInTheDocument();
      expect(within(screen.getByTestId("codex-id-step-2")).getByText("✓")).toBeInTheDocument();
      // Step 3: no backup made yet this session -> still the number, not a checkmark.
      expect(within(screen.getByTestId("codex-id-step-3")).getByText("3")).toBeInTheDocument();
    });
  });
});

/**
 * `legacy-prime-migration-wizard` T9 — the REAL `ensurePrimeArweaveSeed`
 * capability `CodexIdPage.tsx` now constructs and hands to
 * `LegacyPrimeMigrationWizard`. Mirrors
 * `apps/codex-playground/src/kickstartPrimeArweaveSeed.ts`'s own
 * derive-then-persist shape, adapted to run from inside the wizard's
 * finalize flow and to additionally reconcile against whatever Prime
 * Arweave Seed (if any) already exists — see `CodexIdPage.tsx`'s own
 * header comment for the full "why" (in particular: why the V2 envelope is
 * reimplemented locally rather than imported from `@stoachain/stoa-core`,
 * which `codex-arweave` cannot depend on).
 *
 * Drives the captured `ensurePrimeArweaveSeed` function directly (see the
 * `LegacyPrimeMigrationWizard` mock above) rather than clicking through the
 * wizard's own multi-page UI — that UI, and its own `sweepNeeded`
 * computation, are already covered by
 * `packages/codex-ouronet/tests/ui-legacy-prime-migration-wizard.test.tsx`;
 * this file's job is only the wiring.
 */
describe("`legacy-prime-migration-wizard` T9 — ensurePrimeArweaveSeed, wired for real", () => {
  const PASSWORD = "hunter2";
  const BITSTRING_A = "1".repeat(1600);
  const WORDS_A = ["alpha", "beta", "gamma"];
  const BITSTRING_B = "0".repeat(1600);

  /** A minimal FAKE `Worker`, driven message-by-message — mirrors
   *  `seeds-derive-prime-seed.test.ts`'s own `FakeWorker` (no real Web
   *  Worker, no real RSA-4096 search). */
  class FakeWorker {
    onmessage: ((ev: { data: KeygenWorkerMsg }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    postMessage(msg: unknown): void {
      this.posted.push(msg);
    }
    terminate(): void {
      this.terminated = true;
    }
    emit(data: KeygenWorkerMsg): void {
      act(() => {
        this.onmessage?.({ data });
      });
    }
  }

  /** Independent (test-only) reimplementation of the real V2 envelope —
   *  same reason `CodexIdPage.tsx`'s own local reimplementation exists:
   *  `codex-arweave` cannot import `@stoachain/stoa-core` directly. Used
   *  here ONLY to build/verify fixtures without ever touching the
   *  production code under test. */
  async function testEncryptV2(plaintext: string, password: string): Promise<string> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-512" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
    const toB64 = (buf: ArrayBuffer) => {
      const bytes = new Uint8Array(buf);
      let out = "";
      for (let i = 0; i < bytes.byteLength; i++) out += String.fromCharCode(bytes[i]!);
      return btoa(out);
    };
    return btoa(
      JSON.stringify({
        v: 2,
        ciphertext: toB64(ciphertext),
        iv: toB64(iv.buffer),
        salt: toB64(salt.buffer),
      }),
    );
  }

  async function testDecryptV2(encryptedBase64: string, password: string): Promise<string> {
    const envelope = JSON.parse(atob(encryptedBase64)) as {
      v: number;
      ciphertext: string;
      iv: string;
      salt: string;
    };
    const fromB64 = (b64: string) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    };
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: fromB64(envelope.salt), iterations: 600_000, hash: "SHA-512" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(envelope.iv) },
      key,
      fromB64(envelope.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  }

  /** Opens the wizard on a versioned, authenticated codex — the common
   *  setup every test below needs before it can reach
   *  `capturedWizardProps`. Waits for `CodexProvider`'s own async `init()`
   *  to settle FIRST (mirrors the pre-existing "stamped AFTER the async
   *  init()/eligibility-check settle" tests elsewhere in this file) — a
   *  manual `setState` issued before `init()` resolves races it and gets
   *  silently clobbered once the (empty) adapter snapshot loads. */
  async function openWizard(
    overrides: Partial<ArweavePanelDeps> = {},
  ): Promise<ReturnType<typeof renderPanel>> {
    const rendered = renderPanel(overrides);
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
    });
    act(() => {
      capturedStore!.getState().actions.authenticate(PASSWORD, 60);
    });
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
    fireEvent.click(screen.getByTestId("arweave-codex-id-make-eligible"));
    // Round 6 owner correction (`codex-id-step-flow`): this click now
    // calls `useEnsureCodexUnlockedOptional()` first — already authenticated
    // above, so its fast path resolves without a `<PasswordModal>`, but
    // still via a real Promise microtask, not synchronously.
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-wizard-modal")).toBeInTheDocument();
    });
    return rendered;
  }

  /** Drives one full `ensurePrimeArweaveSeed` run that delivers both master
   *  positions — the exact flow a real wizard finalize performs. Returns
   *  once the capability's own promise has settled.
   *
   *  Hoisted to this describe's scope by `former-master-record` T2 so its own
   *  former-record cases drive the SAME flow T1's name-preservation cases do,
   *  rather than a second copy of it. */
  async function runMasterDerivation(
    getWorker: () => FakeWorker | undefined,
    bitString: string,
  ): Promise<void> {
    let settled!: Promise<void>;
    act(() => {
      settled = capturedWizardProps!.ensurePrimeArweaveSeed!({ bitString, words: WORDS_A });
    });
    await waitFor(() => {
      expect(getWorker()).toBeDefined();
      expect(getWorker()!.onmessage).not.toBeNull();
    });
    getWorker()!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
    getWorker()!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
    getWorker()!.emit({ kind: "batch-done" });
    await act(async () => {
      await settled;
    });
  }

  it("on a codex with ZERO existing Arweave seeds, installs exactly one new Prime seed whose decrypted secret matches the finalize bitstring", async () => {
    let worker: FakeWorker | undefined;
    await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });

    expect(capturedStore!.getState().arweaveSeeds).toEqual([]);
    expect(capturedWizardProps?.ensurePrimeArweaveSeed).toBeTypeOf("function");

    act(() => {
      void capturedWizardProps!.ensurePrimeArweaveSeed!({ bitString: BITSTRING_A, words: WORDS_A });
    });
    await waitFor(() => {
      expect(worker).toBeDefined();
      expect(worker!.onmessage).not.toBeNull();
    });
    worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
    worker!.emit({ kind: "batch-done" });

    await waitFor(() => expect(capturedStore!.getState().arweaveSeeds.length).toBe(1));
    const seed = capturedStore!.getState().arweaveSeeds[0]!;
    expect(seed.isPrime).toBe(true);
    await expect(testDecryptV2(seed.secret, PASSWORD)).resolves.toBe(BITSTRING_A);
  });

  it("wires the real describeKeyset through to the wizard, so the guard step can resolve an on-chain keyset-ref guard", async () => {
    await openWizard();
    expect(capturedWizardProps?.describeKeyset).toBeTypeOf("function");
  });

  /**
   * `arweave-master-accounts` T2 — DELIBERATE behaviour change, flagged.
   *
   * This test used to assert `expect(worker).toBeUndefined()` ("a real match
   * never even needs to confirm derivability — nothing changes"). That WAS
   * the bug: a codex whose Arweave seed already matches the master bitstring
   * but holds no accounts under it got an immediate early-return, so it kept
   * ZERO Arweave accounts while the wizard called it eligible (see
   * `docs/work/arweave-master-accounts/design.md`). The match now resolves
   * the seed's `id` and the master positions are derived UNDER it — no second
   * seed row, which is what "adds NO new seed" was really protecting.
   */
  it("on a codex whose EXISTING Prime Arweave Seed already matches the finalize words, adds NO new seed — the master accounts are derived under THAT seed's id", async () => {
    const existingSecret = await testEncryptV2(BITSTRING_A, PASSWORD);
    let worker: FakeWorker | undefined;
    const { deps } = await openWizard({
      workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
    });
    act(() => {
      capturedStore!.setState({
        arweaveSeeds: [
          {
            id: "existing-prime",
            name: "Master ArWeave Seed",
            secret: existingSecret,
            createdAt: new Date().toISOString(),
            isPrime: true,
          },
        ],
      });
    });

    let settled!: Promise<void>;
    act(() => {
      settled = capturedWizardProps!.ensurePrimeArweaveSeed!({
        bitString: BITSTRING_A,
        words: WORDS_A,
      });
    });
    await waitFor(() => {
      expect(worker).toBeDefined();
      expect(worker!.onmessage).not.toBeNull();
    });
    worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
    worker!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
    worker!.emit({ kind: "batch-done" });
    await act(async () => {
      await settled;
    });

    expect(capturedStore!.getState().arweaveSeeds.length).toBe(1);
    expect(vi.mocked(deps.addForeignKey).mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({ seedId: "existing-prime", index: 0, address: "ADDR-0" }),
      expect.objectContaining({ seedId: "existing-prime", index: 1, address: "ADDR-1" }),
    ]);
  });

  it("on a codex whose EXISTING Prime Arweave Seed does NOT match, ADDS a new seed — the original stays present and still decrypts to its own original words", async () => {
    const existingSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
    let worker: FakeWorker | undefined;
    const { deps } = await openWizard({
      workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
    });
    act(() => {
      capturedStore!.setState({
        arweaveSeeds: [
          {
            id: "existing-prime",
            name: "Master ArWeave Seed",
            secret: existingSecret,
            createdAt: new Date().toISOString(),
            isPrime: true,
          },
        ],
      });
    });

    let settled!: Promise<void>;
    act(() => {
      settled = capturedWizardProps!.ensurePrimeArweaveSeed!({
        bitString: BITSTRING_A,
        words: WORDS_A,
      });
    });
    await waitFor(() => {
      expect(worker).toBeDefined();
      expect(worker!.onmessage).not.toBeNull();
    });
    worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
    worker!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
    worker!.emit({ kind: "batch-done" });
    await act(async () => {
      await settled;
    });

    await waitFor(() => expect(capturedStore!.getState().arweaveSeeds.length).toBe(2));
    const seeds = capturedStore!.getState().arweaveSeeds;

    const original = seeds.find((s) => s.id === "existing-prime")!;
    expect(original.secret).toBe(existingSecret);
    expect(original.isPrime).toBe(true);
    await expect(testDecryptV2(original.secret, PASSWORD)).resolves.toBe(BITSTRING_B);

    const added = seeds.find((s) => s.id !== "existing-prime")!;
    expect(added.isPrime).not.toBe(true);
    await expect(testDecryptV2(added.secret, PASSWORD)).resolves.toBe(BITSTRING_A);

    // `arweave-master-accounts` T2: the pre-existing, DIFFERENT seed keeps
    // its own accounts — the master's #0/#1 are addressed under the newly
    // added seed, never grafted onto the mismatched one.
    expect(vi.mocked(deps.addForeignKey).mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({ seedId: added.id, index: 0, address: "ADDR-0" }),
      expect.objectContaining({ seedId: added.id, index: 1, address: "ADDR-1" }),
    ]);
  });

  /**
   * `arweave-master-accounts` T2 — THE BUG this topic exists for.
   *
   * `ensurePrimeArweaveSeed` used to `await deriveArweaveSeedAtPositionZero(…)`
   * (one position, `ranges: [{start:0,end:0}]`) and throw the returned
   * `SeededKey` away, writing only the seed ROW. An Arweave ACCOUNT is a
   * `ForeignKeyEntry` addressed by `(seedId, index)`, so the codex ended up
   * with an Arweave seed and ZERO Arweave accounts while the wizard declared
   * it eligible. These tests pin the derive-AND-persist contract: both master
   * positions, one batch, every delivered key stored under the resolved seed.
   */
  describe("`arweave-master-accounts` T2 — both master positions, actually persisted", () => {
    /** The indices a `{kind:"start-seeded"}` post actually asks for — read
     *  off the INCLUSIVE `ranges` the worker was handed, so the assertion is
     *  about the positions covered, not the range form used to spell them. */
    function requestedIndexes(posted: unknown): number[] {
      const msg = posted as { kind: string; ranges: ReadonlyArray<{ start: number; end: number }> };
      const out: number[] = [];
      for (const range of msg.ranges) {
        for (let i = range.start; i <= range.end; i += 1) out.push(i);
      }
      return out;
    }

    it("on a codex with NO Arweave seed, persists BOTH delivered keys as foreign keys at index 0 and 1 under the new seed's id, with their addresses", async () => {
      let worker: FakeWorker | undefined;
      const { deps } = await openWizard({
        workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
      });
      expect(capturedStore!.getState().arweaveSeeds).toEqual([]);

      let settled!: Promise<void>;
      act(() => {
        settled = capturedWizardProps!.ensurePrimeArweaveSeed!({
          bitString: BITSTRING_A,
          words: WORDS_A,
        });
      });
      await waitFor(() => {
        expect(worker).toBeDefined();
        expect(worker!.onmessage).not.toBeNull();
      });
      worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
      worker!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
      worker!.emit({ kind: "batch-done" });
      await act(async () => {
        await settled;
      });

      const seeds = capturedStore!.getState().arweaveSeeds;
      expect(seeds.length).toBe(1);
      const seedId = seeds[0]!.id;

      // The core regression: TWO real accounts, addressed `(seedId, index)`
      // — today's code writes none at all.
      expect(vi.mocked(deps.addForeignKey).mock.calls.map(([entry]) => entry)).toEqual([
        expect.objectContaining({ seedId, index: 0, address: "ADDR-0" }),
        expect.objectContaining({ seedId, index: 1, address: "ADDR-1" }),
      ]);
      // Composed through the SAME keyring seam `ArweavePanel`'s own
      // `persistKey` uses — the JWK is encrypted at rest, never stored raw.
      expect(deps.generateArweaveKey).toHaveBeenCalledWith({ jwk: fixtureJwk, label: "#0" });
      expect(deps.generateArweaveKey).toHaveBeenCalledWith({ jwk: fixtureJwk, label: "#1" });
    });

    it("derives both positions in ONE batch — a single worker, a single seeded request covering #0 and #1", async () => {
      let worker: FakeWorker | undefined;
      let workerFactoryCalls = 0;
      await openWizard({
        workerFactory: () => {
          workerFactoryCalls += 1;
          return (worker = new FakeWorker()) as unknown as Worker;
        },
      });

      let settled!: Promise<void>;
      act(() => {
        settled = capturedWizardProps!.ensurePrimeArweaveSeed!({ bitString: BITSTRING_A });
      });
      await waitFor(() => {
        expect(worker).toBeDefined();
        expect(worker!.onmessage).not.toBeNull();
      });
      worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
      worker!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
      worker!.emit({ kind: "batch-done" });
      await act(async () => {
        await settled;
      });

      // Two batches would pay the worker startup twice and give the finalize
      // panel two unrelated progress streams for one user-visible step.
      expect(workerFactoryCalls).toBe(1);
      expect(worker!.posted).toHaveLength(1);
      expect(requestedIndexes(worker!.posted[0])).toEqual([0, 1]);
    });

    it("`missingIndexes: [1]` asks for ONLY #1 and persists only #1 — the #0 the library force-generates on every call is never stored", async () => {
      let worker: FakeWorker | undefined;
      const { deps } = await openWizard({
        workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
      });

      let settled!: Promise<void>;
      act(() => {
        settled = capturedWizardProps!.ensurePrimeArweaveSeed!(
          { bitString: BITSTRING_A },
          { missingIndexes: [1] },
        );
      });
      await waitFor(() => {
        expect(worker).toBeDefined();
        expect(worker!.onmessage).not.toBeNull();
      });
      expect(requestedIndexes(worker!.posted[0])).toEqual([1]);

      // `rsa4096/ranges.js` seeds its index set with `new Set([0])`, so #0
      // arrives whatever `ranges` said. Storing it would CLOBBER the key the
      // codex already holds at #0 — the never-clobber guard every storage
      // step in this package applies.
      worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0-FORCED" });
      worker!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
      worker!.emit({ kind: "batch-done" });
      await act(async () => {
        await settled;
      });

      expect(vi.mocked(deps.addForeignKey).mock.calls.map(([entry]) => entry)).toEqual([
        expect.objectContaining({ index: 1, address: "ADDR-1" }),
      ]);
      expect(deps.generateArweaveKey).toHaveBeenCalledTimes(1);
    });

    it("reports progress from the worker's OWN events: the position in flight as it is searched, then each delivered key", async () => {
      let worker: FakeWorker | undefined;
      await openWizard({
        workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
      });
      const onProgress = vi.fn();

      let settled!: Promise<void>;
      act(() => {
        settled = capturedWizardProps!.ensurePrimeArweaveSeed!(
          { bitString: BITSTRING_A },
          { onProgress },
        );
      });
      await waitFor(() => {
        expect(worker).toBeDefined();
        expect(worker!.onmessage).not.toBeNull();
      });

      // Each RSA-4096 key takes seconds, so the panel must be able to name
      // the position being searched BEFORE any key lands — a timer could not
      // know this, only the library's own batch-progress event does.
      worker!.emit({
        kind: "batch-progress",
        ev: {
          index: 0,
          completedCount: 0,
          totalCount: 2,
          addressProgress: 0.5,
          overallProgress: 0.25,
          stage: "p",
          attempts: 7,
        },
      });
      // `objectContaining`, not an exact match: this test's subject is the
      // `index`/`delivered`/`total` counters, and a batch-progress event now
      // ALSO carries the live `search` block (pinned by its own tests in
      // "rich search telemetry on the progress payload" below).
      expect(onProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({ index: 0, delivered: 0, total: 2 }),
      );

      worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
      expect(onProgress).toHaveBeenLastCalledWith({ index: 0, delivered: 1, total: 2 });

      worker!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
      expect(onProgress).toHaveBeenLastCalledWith({ index: 1, delivered: 2, total: 2 });

      worker!.emit({ kind: "batch-done" });
      await act(async () => {
        await settled;
      });
    });

    /**
     * The RICH half of that same progress channel.
     *
     * The owner's report: the migration wizard's Arweave derivation shows no
     * real progress bar, while `ArweaveSeedsArea`'s `RunProgress` has rendered
     * one all along — "Position N of T · prime STAGE · X this search · Y total
     * · Z%" — driven by the library's own `BatchProgressEvent`. The wizard
     * lives in `codex-ouronet`, which cannot import that component (it would
     * close a package cycle), so the only way the line can exist there is for
     * `ensurePrimeArweaveSeed` to stop FLATTENING the event down to
     * `{ index, delivered, total }` and forward the search detail too.
     *
     * These tests pin that detail — and in particular the one piece of it the
     * library does NOT provide and a naive implementation gets wrong.
     */
    describe("rich search telemetry on the progress payload", () => {
      /** Opens the wizard, starts a derivation, and returns the live worker +
       *  the spy + the (unsettled) promise — the common preamble of every test
       *  below, which otherwise repeats ~20 lines each. */
      async function startDerivation(
        opts: { missingIndexes?: readonly number[] } = {},
      ): Promise<{
        worker: FakeWorker;
        onProgress: ReturnType<typeof vi.fn>;
        settled: Promise<void>;
        lastSearch: () => EnsurePrimeArweaveSeedProgress["search"];
      }> {
        let worker: FakeWorker | undefined;
        await openWizard({
          workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
        });
        const onProgress = vi.fn();
        let settled!: Promise<void>;
        act(() => {
          settled = capturedWizardProps!.ensurePrimeArweaveSeed!(
            { bitString: BITSTRING_A },
            { ...opts, onProgress },
          );
        });
        await waitFor(() => {
          expect(worker).toBeDefined();
          expect(worker!.onmessage).not.toBeNull();
        });
        const lastSearch = (): EnsurePrimeArweaveSeedProgress["search"] => {
          const calls = onProgress.mock.calls as [EnsurePrimeArweaveSeedProgress][];
          return calls[calls.length - 1]![0].search;
        };
        return { worker: worker!, onProgress, settled, lastSearch };
      }

      /** Keeps the per-test emissions readable: only the fields that vary. */
      function batchProgress(
        ev: Partial<Extract<KeygenWorkerMsg, { kind: "batch-progress" }>["ev"]>,
      ): KeygenWorkerMsg {
        return {
          kind: "batch-progress",
          ev: {
            index: 0,
            completedCount: 0,
            totalCount: 2,
            addressProgress: 0.5,
            overallProgress: 0.25,
            stage: "p",
            attempts: 1,
            ...ev,
          },
        };
      }

      it("forwards the library's live search detail — position/totalCount/stage/attempts/percent — alongside the unchanged index/delivered/total", async () => {
        // Without these fields the wizard can render nothing but a spinner for
        // the ~6.7 s of every key: this is the regression that leaves the owner
        // staring at a dead dialog mid-migration.
        const { worker, onProgress, settled } = await startDerivation();

        worker.emit(
          batchProgress({
            index: 0,
            completedCount: 0,
            totalCount: 2,
            overallProgress: 0.25,
            stage: "p",
            attempts: 7,
          }),
        );

        expect(onProgress).toHaveBeenLastCalledWith({
          index: 0,
          delivered: 0,
          total: 2,
          search: {
            // `completedCount` is how many FINISHED — the one in flight is the
            // next, hence +1, exactly as `ArweaveSeedsArea` computes it.
            position: 1,
            totalCount: 2,
            stage: "p",
            attempts: 7,
            grandAttempts: 7,
            // `overallProgress` is 0..1; the line shows whole percent.
            percent: 25,
          },
        });

        worker.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
        worker.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
        worker.emit({ kind: "batch-done" });
        await act(async () => {
          await settled;
        });
      });

      it("counts RESTATED attempts for one (index,stage) ONCE, at the high-water mark — never the naive running sum", async () => {
        // THE trap. The library RESTATES the attempt count for the search in
        // flight (5, then 12, …), so `grandAttempts += ev.attempts` over-counts
        // badly — a run would claim tens of thousands of candidate searches it
        // never made, and the "total" figure would be pure fiction.
        const { worker, settled, lastSearch } = await startDerivation();

        worker.emit(batchProgress({ index: 0, stage: "p", attempts: 5 }));
        expect(lastSearch()?.grandAttempts).toBe(5);

        worker.emit(batchProgress({ index: 0, stage: "p", attempts: 12 }));
        expect(lastSearch()?.attempts).toBe(12);
        // 12, the high-water mark for this (index,stage) — NOT 5 + 12.
        expect(lastSearch()?.grandAttempts).toBe(12);

        worker.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
        worker.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
        worker.emit({ kind: "batch-done" });
        await act(async () => {
          await settled;
        });
      });

      it("accumulates ADDITIVELY across different stages and different indexes", async () => {
        // The other half of the same rule: high-water marks are per
        // (index,stage), so a new stage or a new position must ADD its own
        // count rather than reset or replace the total.
        const { worker, settled, lastSearch } = await startDerivation();

        worker.emit(batchProgress({ index: 0, stage: "p", attempts: 12 }));
        expect(lastSearch()?.grandAttempts).toBe(12);

        // Same index, the OTHER prime — a distinct search of its own.
        worker.emit(batchProgress({ index: 0, stage: "q", attempts: 4 }));
        expect(lastSearch()?.grandAttempts).toBe(16);

        // A different position entirely.
        worker.emit(batchProgress({ index: 1, stage: "p", attempts: 3, completedCount: 1 }));
        expect(lastSearch()?.grandAttempts).toBe(19);
        expect(lastSearch()?.position).toBe(2);

        worker.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
        worker.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
        worker.emit({ kind: "batch-done" });
        await act(async () => {
          await settled;
        });
      });

      it("a DELIVERED key reports no search at all, so the consumer can tell 'searching' from 'delivered'", async () => {
        // `RunProgress` renders its status line only while
        // `search !== undefined && status === "running"`. A key delivery is not
        // a search in flight; leaving `search` set would freeze the last
        // position/attempts on screen as if the search never ended.
        const { worker, onProgress, settled } = await startDerivation();

        worker.emit(batchProgress({ index: 0, stage: "p", attempts: 7 }));
        worker.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });

        const delivery = onProgress.mock.calls.at(-1)![0] as EnsurePrimeArweaveSeedProgress;
        expect(delivery.search).toBeUndefined();
        // …while the counters the existing consumers read are untouched.
        expect(delivery).toMatchObject({ index: 0, delivered: 1, total: 2 });

        worker.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
        worker.emit({ kind: "batch-done" });
        await act(async () => {
          await settled;
        });
      });

      it("ignores progress for a position this run never asked for — including its attempts", async () => {
        // `rsa4096/ranges.js` force-generates #0 on EVERY call whatever
        // `ranges` says, so a run for position 1 alone still sees #0's draws.
        // They are already filtered out of `onProgress`; they must not sneak
        // into `grandAttempts` either, or the one position being shown would be
        // credited with a search it did not run.
        const { worker, onProgress, settled, lastSearch } = await startDerivation({
          missingIndexes: [1],
        });

        worker.emit(batchProgress({ index: 0, stage: "p", attempts: 999, totalCount: 1 }));
        expect(onProgress).not.toHaveBeenCalled();

        worker.emit(
          batchProgress({ index: 1, stage: "p", attempts: 3, totalCount: 1, completedCount: 0 }),
        );
        expect(lastSearch()?.grandAttempts).toBe(3);

        worker.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
        worker.emit({ kind: "batch-done" });
        await act(async () => {
          await settled;
        });
      });
    });

    it("a derivation that delivers ZERO keys REJECTS, and writes neither a seed row nor an account", async () => {
      let worker: FakeWorker | undefined;
      const { deps } = await openWizard({
        workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
      });

      let settled!: Promise<void>;
      act(() => {
        settled = capturedWizardProps!.ensurePrimeArweaveSeed!({ bitString: BITSTRING_A });
      });
      // Handled immediately: the rejection below is the assertion, not noise.
      const outcome = settled.then(
        () => "resolved" as const,
        (cause: unknown) => cause as Error,
      );
      await waitFor(() => {
        expect(worker).toBeDefined();
        expect(worker!.onmessage).not.toBeNull();
      });
      // The batch terminates having delivered nothing (cancelled, aborted,
      // or a worker that produced no key for the requested positions).
      worker!.emit({ kind: "batch-done" });

      const result = await outcome;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/no key/i);
      // The old failure mode: a seed row with no accounts under it, which
      // the wizard then called eligible.
      expect(capturedStore!.getState().arweaveSeeds).toEqual([]);
      expect(deps.addForeignKey).not.toHaveBeenCalled();
    });

    it("reuses ANY existing seed whose bitstring equals the master's — not only the prime-flagged one — instead of adding a duplicate row", async () => {
      // The eligibility predicate (`codexHoldsMasterArweaveAccounts`) matches
      // a seed by DECRYPTED BITSTRING, with no regard for `isPrime`. Resolving
      // the seed id by `isPrime` alone would write a second row holding the
      // very same master bitstring.
      const otherSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      const masterSecret = await testEncryptV2(BITSTRING_A, PASSWORD);
      let worker: FakeWorker | undefined;
      const { deps } = await openWizard({
        workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
      });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [
            {
              id: "flagged-prime-but-different",
              secret: otherSecret,
              createdAt: new Date().toISOString(),
              isPrime: true,
            },
            {
              id: "master-match-not-flagged",
              secret: masterSecret,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      });

      let settled!: Promise<void>;
      act(() => {
        settled = capturedWizardProps!.ensurePrimeArweaveSeed!({ bitString: BITSTRING_A });
      });
      await waitFor(() => {
        expect(worker).toBeDefined();
        expect(worker!.onmessage).not.toBeNull();
      });
      worker!.emit({ kind: "key", index: 0, jwk: fixtureJwk, address: "ADDR-0" });
      worker!.emit({ kind: "key", index: 1, jwk: fixtureJwk, address: "ADDR-1" });
      worker!.emit({ kind: "batch-done" });
      await act(async () => {
        await settled;
      });

      expect(capturedStore!.getState().arweaveSeeds.map((s) => s.id)).toEqual([
        "flagged-prime-but-different",
        "master-match-not-flagged",
      ]);
      expect(vi.mocked(deps.addForeignKey).mock.calls.map(([entry]) => entry)).toEqual([
        expect.objectContaining({ seedId: "master-match-not-flagged", index: 0 }),
        expect.objectContaining({ seedId: "master-match-not-flagged", index: 1 }),
      ]);
    });

    it("`missingIndexes: []` (nothing missing) derives nothing and writes nothing — never a seed row with no accounts", async () => {
      let workerFactoryCalls = 0;
      const { deps } = await openWizard({
        workerFactory: () => {
          workerFactoryCalls += 1;
          return new FakeWorker() as unknown as Worker;
        },
      });

      await act(async () => {
        await capturedWizardProps!.ensurePrimeArweaveSeed!(
          { bitString: BITSTRING_A, words: WORDS_A },
          { missingIndexes: [] },
        );
      });

      expect(workerFactoryCalls).toBe(0);
      expect(capturedStore!.getState().arweaveSeeds).toEqual([]);
      expect(deps.addForeignKey).not.toHaveBeenCalled();
    });
  });

  /**
   * The master designation is DERIVED, so NO stored name is ever written or
   * destroyed (`docs/work/prime-two-name-model/design.md`,
   * `former-master-record` T1).
   *
   * This describe block previously asserted the opposite model: exactly one
   * seed CARRIES the title `name: "Master ArWeave Seed"`, and the displaced
   * holder is renamed to a generic "Arweave Seed N". That was live DATA LOSS.
   * Arweave seeds have NO rename UI at all (`ArweaveSeedsArea.tsx`'s own
   * comment says so), so overwriting the displaced seed's `name` destroyed a
   * user-chosen name beyond recovery, and stamping the title on every new row
   * destroyed the new seed's name too.
   *
   * The owner's model instead: *"a prime seed or account has 2 names: its
   * golden prime name, and its normal name [...] because as non-prime accounts
   * become prime, their names mangle."* The golden designation is computed
   * from `codexMasterSeed.arweaveSeedId` at render time
   * (`resolveMasterArweaveSeed` → `ArweaveSeedsArea`'s master row), so
   * `ensurePrimeArweaveSeed` has nothing to write about it — and the real
   * invariant ("exactly ONE row wears the master treatment") is verified
   * through the resolver in `e5-seeds-area.test.tsx`, not through a name
   * string.
   *
   * The regression these tests catch is a user's seed name silently replaced
   * on disk, with no UI anywhere to put it back.
   */
  describe("the master designation is derived — no stored name is destroyed", () => {
    /** A THIRD distinct 1600-bit master bitstring, for the "two takeovers in
     *  a row" case below (A and B are already spoken for). */
    const BITSTRING_C = "10".repeat(800);

    /** The name a user typed on the seed that holds the role today. It is
     *  UNRECOVERABLE once overwritten — there is no rename UI. */
    const USER_NAME = "My cold storage seed";

    /** One pre-existing seed, under the name its user chose. */
    function seedRow(id: string, secret: string, name?: string) {
      return {
        id,
        ...(name === undefined ? {} : { name }),
        secret,
        createdAt: new Date().toISOString(),
        isPrime: true,
      };
    }

    it("takes over the master role WITHOUT touching the displaced seed's own stored name", async () => {
      const staleSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [seedRow("stale-master", staleSecret, USER_NAME)],
        });
      });

      await runMasterDerivation(() => worker, BITSTRING_A);

      const seeds = capturedStore!.getState().arweaveSeeds;
      expect(seeds).toHaveLength(2);

      // THE data-loss assertion: the displaced seed is byte-identical to what
      // it was. A generic "Arweave Seed N" here is a name the user can never
      // get back.
      const demoted = seeds.find((s) => s.id === "stale-master")!;
      expect(demoted.name).toBe(USER_NAME);
      expect(demoted.secret).toBe(staleSecret);
      // `isPrime` is PROVENANCE ("the first seed ever added") and is
      // deliberately never relocated — see `resolveMasterArweaveSeed`.
      expect(demoted.isPrime).toBe(true);

      const created = seeds.find((s) => s.id !== "stale-master")!;
      await expect(testDecryptV2(created.secret, PASSWORD)).resolves.toBe(BITSTRING_A);
    });

    /**
     * The LEGACY row every codex that ran the old code now holds on disk:
     * `name: "Master ArWeave Seed"`, stamped by the creation site this task
     * fixes. The old demotion matched exactly that string and overwrote it
     * with "Arweave Seed N" — so for these codexes the rename was not
     * hypothetical, it fired on the very next takeover. Nothing may write to
     * the displaced seed's name, whatever that name happens to be.
     */
    it("leaves even a legacy seed stored UNDER the designation string unrenamed when it is displaced", async () => {
      const staleSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [seedRow("legacy-titled", staleSecret, MASTER_ARWEAVE_SEED)],
        });
      });

      await runMasterDerivation(() => worker, BITSTRING_A);

      const seeds = capturedStore!.getState().arweaveSeeds;
      expect(seeds).toHaveLength(2);
      const demoted = seeds.find((s) => s.id === "legacy-titled")!;
      expect(demoted.name).toBe(MASTER_ARWEAVE_SEED);
      expect(demoted.secret).toBe(staleSecret);
    });

    it("writes the newly created master row with NO stored name — the designation is never persisted", async () => {
      const staleSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [seedRow("stale-master", staleSecret, USER_NAME)],
        });
      });

      await runMasterDerivation(() => worker, BITSTRING_A);

      const seeds = capturedStore!.getState().arweaveSeeds;
      const created = seeds.find((s) => s.id !== "stale-master")!;
      expect(created.name).toBeUndefined();
      // And NOTHING on the codex claims the title by name: the moment a
      // stored name says "master", it can drift from the id that decides it
      // (two rows both reading "Master ArWeave Seed" is the bug the owner
      // reproduced).
      expect(seeds.filter((s) => s.name === MASTER_ARWEAVE_SEED)).toHaveLength(0);
    });

    it("two takeovers in a row leave BOTH displaced seeds under their own original names", async () => {
      const firstSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [seedRow("stale-master", firstSecret, USER_NAME)],
        });
      });

      await runMasterDerivation(() => worker, BITSTRING_A);
      const afterFirst = capturedStore!.getState().arweaveSeeds;
      const firstCreatedId = afterFirst.find((s) => s.id !== "stale-master")!.id;

      await runMasterDerivation(() => worker, BITSTRING_C);

      const seeds = capturedStore!.getState().arweaveSeeds;
      expect(seeds).toHaveLength(3);
      // The user-named seed survived TWO role moves intact...
      expect(seeds.find((s) => s.id === "stale-master")!.name).toBe(USER_NAME);
      // ...and the seed the first run created stays unnamed rather than being
      // handed a generic name by its demotion.
      expect(seeds.find((s) => s.id === firstCreatedId)!.name).toBeUndefined();
      expect(seeds.filter((s) => s.name === MASTER_ARWEAVE_SEED)).toHaveLength(0);

      const latest = seeds.find((s) => s.id !== "stale-master" && s.id !== firstCreatedId)!;
      await expect(testDecryptV2(latest.secret, PASSWORD)).resolves.toBe(BITSTRING_C);
    });

    it("the EXISTING-match path (a seed whose bitstring already equals the master's) touches no name and creates no second row", async () => {
      const masterSecret = await testEncryptV2(BITSTRING_A, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [seedRow("existing-master", masterSecret, USER_NAME)],
        });
      });

      await runMasterDerivation(() => worker, BITSTRING_A);

      const seeds = capturedStore!.getState().arweaveSeeds;
      expect(seeds).toHaveLength(1);
      expect(seeds[0]!.id).toBe("existing-master");
      expect(seeds[0]!.name).toBe(USER_NAME);
    });

    it("a derivation that delivers ZERO keys still writes no seed row AND touches no name — the lazy seed write stays lazy", async () => {
      const staleSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [seedRow("stale-master", staleSecret, USER_NAME)],
        });
      });

      let settled!: Promise<void>;
      act(() => {
        settled = capturedWizardProps!.ensurePrimeArweaveSeed!({ bitString: BITSTRING_A });
      });
      const outcome = settled.then(
        () => "resolved" as const,
        (cause: unknown) => cause as Error,
      );
      await waitFor(() => {
        expect(worker).toBeDefined();
        expect(worker!.onmessage).not.toBeNull();
      });
      worker!.emit({ kind: "batch-done" });
      expect(await outcome).toBeInstanceOf(Error);

      const seeds = capturedStore!.getState().arweaveSeeds;
      expect(seeds).toHaveLength(1);
      expect(seeds[0]!.name).toBe(USER_NAME);
    });
  });

  /**
   * Demotion by IDENTITY, recorded on the master row (`former-master-record`
   * T2, against `docs/work/prime-two-name-model/design.md`).
   *
   * T1 removed the old demotion, which found the displaced seed by
   * `seed.name === "Master ArWeave Seed"` and overwrote that name. With the
   * designation no longer stored anywhere, such a predicate matches NOTHING —
   * the demotion would be an undetectable no-op, which is the specific failure
   * these cases exist to catch.
   *
   * What replaces it: creating the master ArWeave seed STAMPS its id onto
   * `codexMasterSeed.arweaveSeedId`, and `setCodexMasterSeed` (T3) appends the
   * outgoing id to `formerArweaveSeedIds` by itself. So the displaced seed is
   * identified by the id it actually held, nothing is written TO it, and the
   * "Former Master ArWeave Seed" designation becomes derivable.
   *
   * Asserted against the STORE, never a spy: "the former master is recorded"
   * has to mean the codex really carries it.
   *
   * Each case guards a distinct regression:
   *   (records) without the stamp the master id never moves, so the gold stays
   *       on the old seed and no former holder is ever recorded — invisible
   *       until a user notices two rows disagreeing.
   *   (identity) a seed whose stored NAME is the designation must not be
   *       mistaken for the holder: that is the pre-T1 predicate, and it would
   *       record the wrong seed as the former master.
   *   (first-ever) a first settlement must record NO former — an invented
   *       history would hand the "Former" designation to a seed that never
   *       held the role.
   *   (non-fatal) the stamp merges into a row that must name both mandatory
   *       faces, so on a codex with no master row it THROWS. A derivation that
   *       cost minutes of RSA-4096 must not be lost to it.
   */
  describe("the demotion moves the master ID — the displaced seed is recorded, never rewritten", () => {
    /** A FOURTH distinct 1600-bit master bitstring (A, B and C are spoken for
     *  by the cases above). */
    const BITSTRING_D = "0011".repeat(400);
    const USER_NAME = "My cold storage seed";

    /** One pre-existing seed row, as the store holds it. */
    function seedRow(id: string, secret: string, name?: string, isPrime = false) {
      return {
        id,
        ...(name === undefined ? {} : { name }),
        secret,
        createdAt: new Date().toISOString(),
        ...(isPrime ? { isPrime: true } : {}),
      };
    }

    /** Establishes the master row DIRECTLY (not through `setCodexMasterSeed`),
     *  so the setup itself records no former holder and each case starts from a
     *  clean history. Both mandatory faces are present — the merge the stamp
     *  performs refuses a row that cannot name them. */
    function settleMasterRow(arweaveSeedId?: string): void {
      act(() => {
        capturedStore!.setState({
          codexMasterSeed: {
            ouroAccountId: "ouro-1",
            chainwebSeedId: "chainweb-1",
            ...(arweaveSeedId === undefined ? {} : { arweaveSeedId }),
            establishedAt: "2026-01-01T00:00:00.000Z",
          },
        });
      });
    }

    it("records the PREVIOUS holder in formerArweaveSeedIds and leaves its stored name untouched", async () => {
      const staleSecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [seedRow("stale-master", staleSecret, USER_NAME, true)],
        });
      });
      settleMasterRow("stale-master");

      await runMasterDerivation(() => worker, BITSTRING_A);

      const seeds = capturedStore!.getState().arweaveSeeds;
      const created = seeds.find((s) => s.id !== "stale-master")!;
      const row = capturedStore!.getState().codexMasterSeed!;
      // The role moved to the seed just created...
      expect(row.arweaveSeedId).toBe(created.id);
      // ...and the seed it displaced is on record as a former holder.
      expect(row.formerArweaveSeedIds).toEqual(["stale-master"]);
      // Nothing was written to the displaced seed itself.
      expect(seeds.find((s) => s.id === "stale-master")!.name).toBe(USER_NAME);
    });

    it("records the seed that actually HELD the role, not the one whose stored name says 'Master ArWeave Seed'", async () => {
      const decoySecret = await testEncryptV2(BITSTRING_B, PASSWORD);
      const holderSecret = await testEncryptV2(BITSTRING_D, PASSWORD);
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      act(() => {
        capturedStore!.setState({
          arweaveSeeds: [
            // The DECOY: the first seed this codex ever got, carrying the
            // designation as its stored name (every codex that ran the pre-T1
            // code has such a row on disk). It is NOT the master.
            seedRow("decoy-named-master", decoySecret, MASTER_ARWEAVE_SEED, true),
            // The real holder, under the name its user chose.
            seedRow("real-master", holderSecret, USER_NAME),
          ],
        });
      });
      settleMasterRow("real-master");

      await runMasterDerivation(() => worker, BITSTRING_A);

      const row = capturedStore!.getState().codexMasterSeed!;
      expect(row.formerArweaveSeedIds).toEqual(["real-master"]);
      expect(row.formerArweaveSeedIds).not.toContain("decoy-named-master");
      // And the decoy is untouched — not renamed, not promoted.
      const seeds = capturedStore!.getState().arweaveSeeds;
      expect(seeds.find((s) => s.id === "decoy-named-master")!.name).toBe(MASTER_ARWEAVE_SEED);
    });

    it("records NO former holder for the first-ever master ArWeave seed", async () => {
      let worker: FakeWorker | undefined;
      await openWizard({ workerFactory: () => (worker = new FakeWorker()) as unknown as Worker });
      // A codex mid-migration: both mandatory faces settled, no ArWeave face.
      settleMasterRow(undefined);

      await runMasterDerivation(() => worker, BITSTRING_A);

      const created = capturedStore!.getState().arweaveSeeds[0]!;
      const row = capturedStore!.getState().codexMasterSeed!;
      expect(row.arweaveSeedId).toBe(created.id);
      expect(row.formerArweaveSeedIds).toBeUndefined();
    });

    it("never fails the derivation when the stamp cannot land — a codex with no master row keeps its new seed and its keys, and the failure is reported", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        let worker: FakeWorker | undefined;
        const { deps } = await openWizard({
          workerFactory: () => (worker = new FakeWorker()) as unknown as Worker,
        });
        // No `codexMasterSeed` row at all: the merge cannot name the two
        // mandatory faces, so `setCodexMasterSeed` throws.
        expect(capturedStore!.getState().codexMasterSeed).toBeUndefined();

        await runMasterDerivation(() => worker, BITSTRING_A);

        // The derivation's own output survived in full.
        expect(capturedStore!.getState().arweaveSeeds).toHaveLength(1);
        expect(vi.mocked(deps.addForeignKey).mock.calls).toHaveLength(2);
        expect(capturedStore!.getState().codexMasterSeed).toBeUndefined();
        // ...and it was REPORTED rather than swallowed.
        expect(
          errors.mock.calls.some(([first]) =>
            String(first).includes("Codex Master Seed row's Arweave seed id"),
          ),
        ).toBe(true);
      } finally {
        errors.mockRestore();
      }
    });
  });
});

/**
 * `migration-pending-apply` T3 — the step-2 card's FOUR states, the Apply
 * button beneath the green Retry button, and the Apply popup.
 *
 * The owner's model (`docs/work/migration-pending-apply/design.md`): the
 * wizard's Finalize writes a PENDING plan, exactly like setting partitions in
 * a partition manager; **Apply** is what writes them. So after a finalize the
 * middle button must stop being a dead "✓ Permaweb Eligible" note and become
 * a real launcher ("Retry the Eligibility Wizard") with Apply beneath it,
 * until Apply seals — after which it is locked green forever.
 *
 * The scope the owner set for this pass: the NO-TRANSACTION seal path must
 * genuinely work end to end; the with-transactions path must DETECT and
 * report honestly, never fake an execution or seal over unexecuted work.
 *
 * Asserts against the STORE (`migrationProgress.appliedAt` / `primeAlignment`)
 * rather than a spy, so "Seal worked" means the codex really is sealed.
 */
describe("`migration-pending-apply` T3 — the four-state step-2 card and the Apply popup", () => {
  const PASSWORD = "hunter2";
  /** The guard keys a `custom` guard choice would put in force... */
  const CHOSEN_GUARD_KEY = "c".repeat(64);
  /** ...versus what the account carries on chain today. */
  const OLD_GUARD_KEY = "9".repeat(64);

  /** What a completed Finalize recorded. Secret-free by construction. */
  const PLAN = {
    finalizedAt: "2026-11-18T10:00:00.000Z",
    accountId: "ouro-1",
    seedId: "seed-1",
    arweaveSeedId: "ar-seed-1",
  };

  /** A recorded run carrying a pending plan. Defaults to the "kept both keys"
   *  selection — the case that genuinely needs no transaction at all. */
  function progressWith(over: Partial<MigrationProgress> = {}): MigrationProgress {
    return {
      stage: "committing",
      startedAt: "2026-11-18T09:00:00.000Z",
      updatedAt: "2026-11-18T10:00:00.000Z",
      selection: {
        account: { kind: "keep-current" },
        payment: { kind: "keep" },
        guard: { kind: "keep" },
      },
      committed: { accountId: "ouro-1" },
      pending: PLAN,
      ...over,
    };
  }

  /** The master account `computeOutstandingKeyChanges` compares the plan
   *  against — resolved POSITIONALLY (`accounts[0]`), the same rule
   *  `PendingKeyChangesSection` and the accounts tab already use. */
  const MASTER_ACCOUNT = {
    id: "ouro-1",
    name: "Master",
    version: "1.0",
    isSmart: false,
    address: "Ѻ.master",
    // `as const`: `IKeyset.pred` is a literal union, and a standalone object
    // literal widens `"keys-any"` to `string` without it.
    guard: { pred: "keys-any" as const, keys: [OLD_GUARD_KEY] },
    stoaChainLedger: null,
    publicKey: "pub",
    secret: "ct",
    backup: "ct",
  };

  /** Mounts the Codex ID page on a VERSIONED codex with whatever store state
   *  the test needs seeded. Mirrors `openWizard`'s own ordering: wait for
   *  `CodexProvider`'s async `init()` FIRST, or the manual `setState` races it
   *  and gets clobbered by the (empty) adapter snapshot. */
  async function renderCodexIdPage(
    seed: () => void,
    overrides: Partial<ArweavePanelDeps> = {},
    opts: { authenticate?: boolean } = {},
  ): Promise<void> {
    renderPanel(overrides);
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.setState({ Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION });
      seed();
    });
    if (opts.authenticate !== false) {
      act(() => {
        capturedStore!.getState().actions.authenticate(PASSWORD, 60);
      });
    }
    fireEvent.click(screen.getByTestId("arweave-subtab-codex-id"));
  }

  it("state (2) — no pending plan: today's gold 'Make Codex Permaweb Eligible' button, with NO Retry and NO Apply", async () => {
    await renderCodexIdPage(() => {});

    expect(screen.getByTestId("arweave-codex-id-make-eligible")).toBeEnabled();
    expect(screen.queryByTestId("arweave-codex-id-retry-eligibility")).toBeNull();
    // Apply must never be offered over a codex with nothing recorded to apply
    // — `sealMigration` THROWS when there is no pending plan.
    expect(screen.queryByTestId("arweave-codex-id-apply-migration")).toBeNull();
  });

  it("state (3) — a pending, unsealed plan: a real GREEN 'Retry the Eligibility Wizard' BUTTON with Apply BENEATH it, and no gold make-eligible button", async () => {
    await renderCodexIdPage(() => {
      capturedStore!.setState({ migrationProgress: progressWith() });
    });

    const card = screen.getByTestId("codex-id-step-2");
    const retry = within(card).getByTestId("arweave-codex-id-retry-eligibility");
    // The eligible slot used to be a `<div role="status">` with nowhere for a
    // launcher to live — this state must be a real, clickable button.
    expect(retry.tagName).toBe("BUTTON");
    expect(retry).toHaveTextContent(/retry the eligibility wizard/i);
    // The same green as `DONE_STEP_STYLE` (`#4ade80`), so it reads as one
    // palette rather than a second, unrelated green.
    expect(retry.style.color).toBe("rgb(74, 222, 128)");

    const apply = within(card).getByTestId("arweave-codex-id-apply-migration");
    // "beneath it" — DOM order is vertical order inside this card.
    expect(
      retry.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(card).queryByTestId("arweave-codex-id-make-eligible")).toBeNull();
  });

  it("a pending plan WINS over a resolved-eligible check — a finalized codex reads eligible, and that must not hide the unapplied plan", async () => {
    // THE precedence trap: `step2Done = isEligible` comes from the injected
    // async check, which a just-finalized codex passes. Checking it first
    // would show the locked "✓ Permaweb Eligible" note and NO Apply button on
    // every real post-finalize codex — i.e. the owner could never apply.
    await renderCodexIdPage(
      () => {
        capturedStore!.setState({ migrationProgress: progressWith() });
      },
      { checkArweaveRestoreEligibility: vi.fn(async () => true) },
    );

    // Step 3 unlocking is the observable proof that `isEligible` really did
    // resolve true — it is gated on exactly that.
    await waitFor(() => expect(screen.getByTestId("codex-backup-wizard-open")).toBeEnabled());

    expect(screen.getByTestId("arweave-codex-id-apply-migration")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-codex-id-retry-eligibility")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-codex-id-already-eligible")).toBeNull();
  });

  it("Retry opens the wizard through the SAME unlock gate as 'Make Codex Permaweb Eligible' — on a LOCKED codex it raises the real password request first", async () => {
    await renderCodexIdPage(
      () => {
        capturedStore!.setState({ migrationProgress: progressWith() });
      },
      {},
      { authenticate: false },
    );
    expect(capturedStore!.getState().locked).toBe(true);

    fireEvent.click(screen.getByTestId("arweave-codex-id-retry-eligibility"));

    await waitFor(() => {
      expect(capturedStore!.getState().pendingPasswordRequest).not.toBeNull();
    });
    expect(screen.queryByTestId("legacy-prime-migration-wizard-modal")).toBeNull();

    act(() => {
      capturedStore!.getState().actions.submitPasswordRequest("real-password", 60);
    });
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-wizard-modal")).toBeInTheDocument();
    });
  });

  it("state (3) with NOTHING outstanding: Apply's popup says plainly that nothing needs sending, and Seal genuinely seals — appliedAt + primeAlignment in the STORE, then the locked state (4)", async () => {
    await renderCodexIdPage(() => {
      capturedStore!.setState({
        migrationProgress: progressWith(),
        ouroAccounts: [MASTER_ACCOUNT],
      });
    });

    expect(screen.queryByTestId("codex-apply-migration-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("arweave-codex-id-apply-migration"));

    const modal = screen.getByTestId("codex-apply-migration-modal");
    expect(within(modal).getByTestId("codex-apply-migration-nothing-to-send")).toBeInTheDocument();
    expect(within(modal).queryByTestId("codex-apply-migration-needs-transactions")).toBeNull();
    // The keyset-choice seal block must not swallow the owner's MAIN path: a
    // `keep` guard is not a keyset update, so no note and no block.
    expect(within(modal).queryByTestId("codex-apply-migration-keyset-note")).toBeNull();

    fireEvent.click(within(modal).getByTestId("codex-apply-migration-seal"));

    // The seal is real, not a mock call: the codex itself is sealed.
    await waitFor(() => {
      expect(capturedStore!.getState().migrationProgress?.appliedAt).toBeTruthy();
    });
    expect(capturedStore!.getState().primeAlignment).toBe("aligned");
    expect(capturedStore!.getState().migrationProgress?.stage).toBe("done");

    expect(screen.queryByTestId("codex-apply-migration-modal")).toBeNull();
    // ...and the card is state (4): locked green, no launcher, no Apply.
    expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-codex-id-retry-eligibility")).toBeNull();
    expect(screen.queryByTestId("arweave-codex-id-apply-migration")).toBeNull();
  });

  it("state (3) WITH outstanding changes: the popup lists each one FROM → TO, says transactions are still needed, and offers NO Seal button", async () => {
    await renderCodexIdPage(() => {
      capturedStore!.setState({
        migrationProgress: progressWith({
          selection: {
            account: { kind: "keep-current" },
            payment: { kind: "keep" },
            guard: { kind: "custom", keys: [CHOSEN_GUARD_KEY], pred: "keys-all" },
          },
        }),
        ouroAccounts: [MASTER_ACCOUNT],
      });
    });

    fireEvent.click(screen.getByTestId("arweave-codex-id-apply-migration"));
    const modal = screen.getByTestId("codex-apply-migration-modal");

    expect(within(modal).getByTestId("pending-key-change-guard")).toBeInTheDocument();
    // The REAL keys, both ends — a summary would not tell the owner what is
    // about to be signed. (`MeasuredHexHighlight` always carries the full
    // value in its `title`, whatever it truncated the display to.)
    expect(within(modal).getByTitle(OLD_GUARD_KEY)).toBeInTheDocument();
    expect(within(modal).getByTitle(CHOSEN_GUARD_KEY)).toBeInTheDocument();
    expect(within(modal).getByTestId("codex-apply-migration-needs-transactions")).toBeInTheDocument();

    // THE load-bearing rule: execution is not wired yet, so sealing here would
    // lock the codex forever with the chosen keys never put in force.
    expect(within(modal).queryByTestId("codex-apply-migration-seal")).toBeNull();
    expect(within(modal).queryByTestId("codex-apply-migration-nothing-to-send")).toBeNull();
    expect(capturedStore!.getState().migrationProgress?.appliedAt).toBeUndefined();
    expect(capturedStore!.getState().primeAlignment).not.toBe("aligned");
  });

  it("state (4) — sealed: the locked '✓ Permaweb Eligible' status, with NO Retry and NO Apply, even though the sealed row still KEEPS its plan", async () => {
    await renderCodexIdPage(() => {
      capturedStore!.setState({
        migrationProgress: progressWith({ stage: "done", appliedAt: "2026-11-18T11:00:00.000Z" }),
      });
    });

    expect(screen.getByTestId("arweave-codex-id-already-eligible")).toHaveTextContent(
      /permaweb eligible/i,
    );
    expect(screen.queryByTestId("arweave-codex-id-retry-eligibility")).toBeNull();
    expect(screen.queryByTestId("arweave-codex-id-apply-migration")).toBeNull();
    expect(screen.queryByTestId("arweave-codex-id-make-eligible")).toBeNull();
    // A bare `progress.pending` truthiness check would keep offering Apply
    // forever, because a sealed row deliberately keeps the applied plan.
    expect(capturedStore!.getState().migrationProgress?.pending).toBeTruthy();
  });

  it("a guard choice of `update-keyset-custom` is OUTSTANDING WORK: the popup needs transactions, names the `define-keyset` that would do it, and offers NO Seal", async () => {
    // Owner's correction to T3: updating a namespace keyset's definition IS a
    // real on-chain transaction (`define-keyset` against that keyset) — this
    // app just does not wire it up yet. `computeOutstandingKeyChanges` still
    // skips both kinds (outstandingKeyChanges.ts:58-71) because it answers the
    // narrower "which key ROTATIONS are outstanding"; the popup must combine
    // that with the keyset choice, or it offers Seal — permanent — over work
    // that was never executed.
    await renderCodexIdPage(() => {
      capturedStore!.setState({
        migrationProgress: progressWith({
          selection: {
            account: { kind: "keep-current" },
            payment: { kind: "keep" },
            guard: { kind: "update-keyset-custom", keys: [CHOSEN_GUARD_KEY], pred: "keys-all" },
          },
        }),
        ouroAccounts: [MASTER_ACCOUNT],
      });
    });

    fireEvent.click(screen.getByTestId("arweave-codex-id-apply-migration"));
    const modal = screen.getByTestId("codex-apply-migration-modal");

    // The keyset choice is the ONLY outstanding item — `keep`/`keep` leaves
    // `computeOutstandingKeyChanges` reporting `none: true` — so this branch
    // can only be reached by combining the two.
    expect(within(modal).getByTestId("codex-apply-migration-needs-transactions")).toBeInTheDocument();
    expect(within(modal).queryByTestId("codex-apply-migration-nothing-to-send")).toBeNull();
    expect(within(modal).queryByTestId("codex-apply-migration-seal")).toBeNull();

    const note = within(modal).getByTestId("codex-apply-migration-keyset-note");
    // Naming the transaction is the point of the correction: the old copy told
    // the owner no such transaction exists, which is false.
    expect(note).toHaveTextContent(/define-keyset/i);
    expect(note).toHaveTextContent(/not wired up/i);
    expect(note.textContent ?? "").not.toMatch(/nothing executable/i);

    // Still genuinely absent from the executable list — the note is the only
    // place it is accounted for.
    expect(within(modal).queryByTestId("pending-key-change-guard")).toBeNull();
    expect(capturedStore!.getState().migrationProgress?.appliedAt).toBeUndefined();
    expect(capturedStore!.getState().primeAlignment).not.toBe("aligned");
  });

  it("a guard choice of `update-keyset-recommended` blocks sealing exactly as `update-keyset-custom` does", async () => {
    // The recommended variant is the same on-chain operation with the repo's
    // own keys — if only the `custom` kind were wired into the seal block, the
    // commoner choice would seal over un-executed work.
    await renderCodexIdPage(() => {
      capturedStore!.setState({
        migrationProgress: progressWith({
          selection: {
            account: { kind: "keep-current" },
            payment: { kind: "keep" },
            guard: { kind: "update-keyset-recommended" },
          },
        }),
        ouroAccounts: [MASTER_ACCOUNT],
      });
    });

    fireEvent.click(screen.getByTestId("arweave-codex-id-apply-migration"));
    const modal = screen.getByTestId("codex-apply-migration-modal");

    expect(within(modal).getByTestId("codex-apply-migration-needs-transactions")).toBeInTheDocument();
    expect(within(modal).queryByTestId("codex-apply-migration-seal")).toBeNull();
    expect(within(modal).getByTestId("codex-apply-migration-keyset-note")).toHaveTextContent(
      /define-keyset/i,
    );
  });

  it("the keyset note is NOT rendered for a guard choice that is not one of the two keyset kinds", async () => {
    // A `custom` guard rotates the ACCOUNT's guard — a different operation,
    // already listed FROM → TO above. Showing the define-keyset note there
    // would claim outstanding work that does not exist.
    await renderCodexIdPage(() => {
      capturedStore!.setState({
        migrationProgress: progressWith({
          selection: {
            account: { kind: "keep-current" },
            payment: { kind: "keep" },
            guard: { kind: "custom", keys: [CHOSEN_GUARD_KEY], pred: "keys-all" },
          },
        }),
        ouroAccounts: [MASTER_ACCOUNT],
      });
    });

    fireEvent.click(screen.getByTestId("arweave-codex-id-apply-migration"));
    const modal = screen.getByTestId("codex-apply-migration-modal");

    expect(within(modal).getByTestId("pending-key-change-guard")).toBeInTheDocument();
    expect(within(modal).queryByTestId("codex-apply-migration-keyset-note")).toBeNull();
  });

  it("a Seal that FAILS reports the failure and keeps the popup open — never a silent close that implies the codex was sealed", async () => {
    await renderCodexIdPage(() => {
      capturedStore!.setState({
        migrationProgress: progressWith(),
        ouroAccounts: [MASTER_ACCOUNT],
      });
    });
    fireEvent.click(screen.getByTestId("arweave-codex-id-apply-migration"));

    // The plan goes away underneath the open popup (abandoned elsewhere, or a
    // sync from another device) — `sealMigration` then refuses, by design:
    // "you cannot seal nothing".
    act(() => {
      capturedStore!.setState({ migrationProgress: undefined });
    });
    fireEvent.click(
      within(screen.getByTestId("codex-apply-migration-modal")).getByTestId(
        "codex-apply-migration-seal",
      ),
    );

    const error = await screen.findByTestId("codex-apply-migration-error");
    expect(error.textContent).toMatch(/seal/i);
    expect(screen.getByTestId("codex-apply-migration-modal")).toBeInTheDocument();
    expect(capturedStore!.getState().primeAlignment).not.toBe("aligned");
  });
});
