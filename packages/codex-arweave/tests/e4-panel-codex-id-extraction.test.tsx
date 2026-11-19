/**
 * RED matrix for the "Codex ID" page's extraction into a standalone,
 * reusable component (`CodexIdPage`), independent of `ArweavePanel`'s own
 * tab-bar/category-switching machinery.
 *
 * The real-world motivation: a top-level nav entry (`apps/codex-playground`'s
 * desktop `.cxpg-viewtabs` row + mobile `CodexTierTwoMenu`) needs to render
 * this SAME page directly, without going three clicks deep through
 * `ArweavePanel`'s own Blockchain Accounts -> Arweave -> Codex ID tabs. This
 * only works if the page's content/behaviour is identical whether reached
 * via `ArweavePanel`'s own `active === "codex-id"` branch (unchanged, see
 * `e4-panel-codex-id.test.tsx`) or mounted directly as `<CodexIdPage />`.
 *
 * `CodexIdPage` takes the SAME `deps: ArweavePanelDeps | null` shape
 * `ArweavePanel` itself already reads out of `ArweavePanelContext` — no new,
 * narrower prop surface was invented, so a host that already has an
 * `ArweavePanelDeps` bundle (every host does, to mount `ArweavePanel` at
 * all) can mount this page with literally the same object.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";
import type { IOuroAccount, IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";

import { CodexIdPage } from "../src/panel/CodexIdPage";
import type { ArweavePanelDeps } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

/**
 * `legacy-prime-migration-wizard` post-build fix round, Fix 2:
 * `CodexIdPage.tsx` now calls the real `useStoaChainSeeds`/`useOuroAccounts`
 * hooks directly (closing the gap Wave 2's own implementer left documented:
 * "CodexIdPage.tsx currently has no useStoaChainSeeds/useOuroAccounts hook
 * access at all"). Those hooks require a `<CodexProvider>` ancestor
 * (`useCodexStore` throws without one) — every test in this file mounts
 * `<CodexIdPage>` directly, with NO provider in the tree (by design: this
 * file's whole point is that the page works standalone). Mocking the two
 * hooks here (default: empty seeds/accounts, matching the exact pre-Fix-2
 * props this page always passed before) keeps every pre-existing test's
 * rendered behavior byte-identical while letting the real production
 * component code run unmodified. Only the one NEW test below overrides the
 * mock to assert the real passthrough.
 *
 * `upgrade-prompt-ui` T5: `CodexIdPage` now also calls `useCodex()` and
 * `useNeedsStructuralUpgrade()` directly (the new "Codex Upgrade" card's own
 * gating) — both likewise require a `<CodexProvider>` ancestor
 * (`useCodex` -> `useCodexStore()`, same throw-without-provider as the two
 * hooks above). Mocked here for the exact same reason, with a fixed
 * "codex is current, no upgrade needed" default so every pre-existing test
 * in this file keeps rendering exactly as before — the T5 scenarios
 * themselves (undefined `Codex_Shape_Version` vs. current target) are
 * covered against a REAL store in `e4-panel-codex-id.test.tsx`, which
 * already mounts this page through a real `<CodexProvider>`.
 *
 * Owner correction (this session, Page 2's "Option 1 must show the real
 * Master Account", two rounds): a FIRST attempt at this fallback added
 * `useActiveWallet()` (`activeOuroAccountId`/`activeStoaChainWalletId`) as
 * a middle tier, reasoning it mirrored the Ouronet Accounts tab's "★
 * Selected" badge — WRONG, caught against real data (an unrelated account
 * the owner had merely clicked "select" on for Transfer/CFM purposes was
 * shown as the kept Prime instead of the real one). Reading
 * `OuronetAccountsTab.tsx` directly confirmed "★ Selected" is a SEPARATE,
 * user-toggleable "active owner for operations" concept, not the
 * permanent, locked CodexPrime identity. `useActiveWallet()` was removed
 * from `CodexIdPage.tsx` entirely — the resolution is back to the
 * grounded two-tier `isPrime ?? allAccounts[0]` / `isPrime ?? allSeeds[0]`
 * fallback, matching `OuronetAccountsTab.tsx`'s own `isFirst = index === 0`
 * CodexPrime rule and `SeedWordsTab.tsx`'s own `isPrime === true || index
 * === 0` rule exactly. No `useActiveWallet` mock needed any more.
 */
const mockSeedsView = { seeds: [] as IStoaChainSeed[], addSeed: vi.fn(), updateSeed: vi.fn(), deleteSeed: vi.fn() };
const mockAccountsView = { accounts: [] as IOuroAccount[], addAccount: vi.fn(), updateAccount: vi.fn(), deleteAccount: vi.fn() };
const mockCodexView = {
  isReady: true,
  isLocked: false,
  isDirty: false,
  initError: null,
  kadenaSeeds: [],
  pureKeypairs: [],
  ouroAccounts: [],
  addressBook: [],
  watchList: [],
  uiSettings: {},
  schemaVersion: 1,
  Codex_Shape_Version: undefined as string | undefined,
  lastUpdatedAt: null,
  lastUpdatedDevice: null,
};
vi.mock("@ancientpantheon/codex-ouronet/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useStoaChainSeeds: () => mockSeedsView,
    useOuroAccounts: () => mockAccountsView,
    useCodex: () => mockCodexView,
    useNeedsStructuralUpgrade: () => false,
  };
});

// `upgrade-prompt-ui` T5: `StructuralUpgradeWizard` itself (unlike
// `LegacyPrimeMigrationWizard`) calls `useCodexStore()`/`useCodex()`
// unconditionally — even while `open={false}` — via its OWN internal,
// relative imports (not the `@ancientpantheon/codex-ouronet/hooks` package
// subpath mocked above, so that mock does not reach it). Mounting the real
// component here would therefore throw the same missing-`<CodexProvider>`
// error for every test in this file. Stubbed to a no-op that never touches
// the store, matching this file's standing "no provider in the tree"
// convention; the real wizard mounting/opening behavior is covered against
// a REAL store in `e4-panel-codex-id.test.tsx`.
/** The props `CodexIdPage` hands the migration wizard, captured by the
 *  pass-through spy below. `settled-master-identity` follow-up: the SEED
 *  half of the positional-vs-isPrime rule used to be asserted through the
 *  wizard's Option-1 PROSE ("keeps its Chainweb seed: <name>"). That prose
 *  was later deleted by an unrelated round ("optimise option 1... to not
 *  use so much vertical space"), which orphaned the assertion and left the
 *  seed rule red for a reason that had nothing to do with the rule — which
 *  was, and is, perfectly intact. Asserting a RESOLUTION rule through a
 *  grandchild's copy is what made it brittle; the prop boundary is the
 *  actual contract `CodexIdPage` owes, and cannot be orphaned by wording. */
let capturedWizardProps: { currentPrimeSeed?: { name?: string } | null } | null = null;

vi.mock("@ancientpantheon/codex-ouronet/components", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const RealWizard = actual.LegacyPrimeMigrationWizard as React.ComponentType<
    Record<string, unknown>
  >;
  return {
    ...actual,
    StructuralUpgradeWizard: ({ open }: { open: boolean; onClose: () => void }) =>
      open ? <div data-testid="structural-upgrade-wizard-modal" /> : null,
    // A PASS-THROUGH spy, deliberately: it records the props and then
    // renders the REAL wizard, so every other test in this file keeps
    // asserting against real wizard DOM exactly as before. This adds
    // visibility, never a behaviour change.
    LegacyPrimeMigrationWizard: (props: Record<string, unknown>) => {
      capturedWizardProps = props as typeof capturedWizardProps;
      return <RealWizard {...props} />;
    },
  };
});

function makeSeedFixture(overrides: Partial<IStoaChainSeed> & { id: string }): IStoaChainSeed {
  return {
    version: "1.0",
    index: 0,
    secret: "ciphertext",
    main: "k:main",
    createdAt: new Date().toISOString(),
    accounts: [],
    seedType: "stoic",
    ...overrides,
  };
}

function makeAccountFixture(overrides: Partial<IOuroAccount> & { id: string }): IOuroAccount {
  return {
    version: "1.0",
    isSmart: false,
    address: "k:address",
    guard: null,
    stoaChainLedger: null,
    publicKey: "pub",
    secret: "ciphertext",
    backup: "ciphertext",
    ...overrides,
  };
}

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;
const fakePool = { pick: () => ARWEAVE_ADDRESS } as unknown as GatewayPool;

function makeDeps(overrides: Partial<ArweavePanelDeps> = {}): ArweavePanelDeps {
  return {
    address: ARWEAVE_ADDRESS,
    foreignKeys: [],
    keygenRunner: { runKeygen: vi.fn(async () => fixtureJwk) },
    generateArweaveKey: vi.fn(async () => ({
      id: ARWEAVE_ADDRESS,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile: "CIPHERTEXT",
      label: "key",
    })),
    importArweaveKey: vi.fn(async () => ({
      id: ARWEAVE_ADDRESS,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile: "CIPHERTEXT",
      label: "key",
    })),
    decryptArweaveKey: vi.fn(async () => fixtureJwk),
    addForeignKey: vi.fn(async () => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),
    getBalance: vi.fn(async () => 0n),
    send: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 0n })),
    sendFrom: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 0n })),
    estimateFee: vi.fn(async () => 0n),
    pollStatus: vi.fn(async () => "final" as const),
    uploadAndTrack: vi.fn(async () => ({
      id: "item-id",
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
    listLibrary: vi.fn(async () => []),
    openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
    rebuildLibrary: vi.fn(async () => {}),
    libraryStore: {
      append: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    } as unknown as ArweavePanelDeps["libraryStore"],
    pool: fakePool,
    addressBook: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockSeedsView.seeds = [];
  mockAccountsView.accounts = [];
});

afterEach(() => {
  cleanup();
});

describe("CodexIdPage — standalone, direct mount (no ArweavePanel tab bar involved)", () => {
  it("renders the same page shell testid as ArweavePanel's deep-link codex-id branch", () => {
    render(<CodexIdPage deps={makeDeps()} />);
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
  });

  it("shows the real eligibility status for an ELIGIBLE codex, with no second implementation", async () => {
    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => true) })} />,
    );
    // `codex-id-step-flow` (this session): the standalone eligibility status
    // bar (`ArweaveRestoreEligibilityStatus`) was removed from THIS page —
    // the step row's own Step 2 slot is now the sync point/source of truth.
    await waitFor(() =>
      expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("arweave-codex-id-make-eligible")).toBeNull();
  });

  it("`legacy-prime-migration-wizard` T3: shows the real eligibility status for a NOT-eligible codex, with the now-ENABLED 'make eligible' button that opens the real wizard", async () => {
    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => false) })} />,
    );
    // Same sync-point change as above — this file's own mock pins
    // `useNeedsStructuralUpgrade` to `false`, so Step 2 is enabled the
    // moment eligibility resolves, with no version-gate wait needed.
    const makeEligible = await screen.findByTestId("arweave-codex-id-make-eligible");
    await waitFor(() => expect(makeEligible).toBeEnabled());
    expect(makeEligible).not.toHaveTextContent(/coming soon/i);

    expect(screen.queryByTestId("legacy-prime-migration-wizard-modal")).toBeNull();
    fireEvent.click(makeEligible);
    expect(screen.getByTestId("legacy-prime-migration-wizard-modal")).toBeInTheDocument();
  });

  it("the real backup trigger opens a popup wired to the injected getExportJson/backupCodex seams, once eligible", async () => {
    const exportJson = '{"labels":["seed-1"]}';
    const resultId = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
    const getExportJson = vi.fn(async () => exportJson);
    const backupCodex = vi.fn(async (_json: string) => ({ id: resultId }));
    render(
      <CodexIdPage
        deps={makeDeps({
          getExportJson,
          backupCodex,
          checkArweaveRestoreEligibility: vi.fn(async () => true),
        })}
      />,
    );

    const page = screen.getByTestId("arweave-codex-id-page");
    const trigger = await within(page).findByTestId("codex-backup-wizard-open");
    await waitFor(() => expect(trigger).toBeEnabled());

    fireEvent.click(trigger);
    const modal = screen.getByTestId("codex-backup-wizard-modal");
    fireEvent.click(within(modal).getByTestId("codex-backup-start"));
    fireEvent.click(await within(modal).findByTestId("codex-backup-permanence-accept"));
    await waitFor(() => expect(backupCodex).toHaveBeenCalledWith(exportJson));

    const result = await within(modal).findByTestId("codex-backup-result");
    expect(result.textContent).toContain(resultId);
  });

  it("the backup trigger is disabled until eligible — the real backend throws otherwise", async () => {
    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => false) })} />,
    );
    const page = screen.getByTestId("arweave-codex-id-page");
    await waitFor(() =>
      expect(within(page).getByTestId("codex-backup-wizard-open")).toBeDisabled(),
    );
  });

  it("renders all three informatics tabs (T2's components, now split), composed unmodified", () => {
    render(<CodexIdPage deps={makeDeps()} />);
    expect(screen.getByTestId("codex-backup-informatics")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-encryption"));
    expect(screen.getByTestId("codex-encryption-informatics")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-migration"));
    expect(screen.getByTestId("codex-migration-informatics")).toBeInTheDocument();
  });

  it("degrades honestly (no crash) when mounted with deps === null — mirrors ArweavePanel's own no-provider tolerance", () => {
    render(<CodexIdPage deps={null} />);
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-codex-id-backup-unavailable")).toBeInTheDocument();
  });

  it("`legacy-prime-migration-wizard` Fix 2: calls the real useStoaChainSeeds/useOuroAccounts hooks and threads allSeeds/allAccounts/currentPrimeSeed/currentPrimeAccount through to the wizard as real props (not always-empty placeholders)", async () => {
    // `legacy-prime-migration-wizard` T6 (this session): option 2's
    // candidate source changed from Chainweb seeds (`seedType === "stoic"`)
    // to Ouronet accounts (`originSeedTab === "write-seed"`) — a real
    // conceptual correction, not a cosmetic rename. This fixture's
    // `stoicAccount` must carry `originSeedTab: "write-seed"` to qualify as
    // a candidate at all under the corrected model; the rendered item shows
    // the ACCOUNT's own name (`account.name`), not the paired seed's name.
    //
    // `codex-id-step-flow` round 3 (owner correction, real data): accounts
    // are now resolved PURE POSITIONAL (`allAccounts[0]`, no `isPrime`
    // check at all) — matching `OuronetAccountsTab.tsx`'s own standard-
    // account "CodexPrime" rule exactly (see `CodexIdPage.tsx`'s own
    // comment on `currentPrimeAccount` for the full reasoning). So
    // `primeAccount` (the one this test expects "keep current" to show)
    // must be at array index 0 — `isPrime: true` on it is no longer what
    // makes it win. Seeds are NOT affected by this — `currentPrimeSeed`
    // still uses `isPrime ?? positional`, so `primeSeed` below correctly
    // wins over `stoicSeed` purely from its own `isPrime: true`, regardless
    // of array position.
    const stoicSeed = makeSeedFixture({ id: "seed-1", seedType: "stoic", name: "Stoic Seed" });
    const primeSeed = makeSeedFixture({ id: "seed-2", seedType: "koala", name: "Koala Prime Seed", isPrime: true });
    const primeAccount = makeAccountFixture({ id: "account-1", name: "Current Prime Account", isPrime: true });
    const stoicAccount = makeAccountFixture({
      id: "account-2",
      parentSeedId: "seed-1",
      name: "Stoic Account",
      originSeedTab: "write-seed",
    });
    mockSeedsView.seeds = [stoicSeed, primeSeed];
    mockAccountsView.accounts = [primeAccount, stoicAccount];

    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => false) })} />,
    );
    const makeEligible = await screen.findByTestId("arweave-codex-id-make-eligible");
    await waitFor(() => expect(makeEligible).toBeEnabled());
    fireEvent.click(makeEligible);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    // `allSeeds`/`allAccounts` reached the wizard for real: the write-seed-
    // origin account makes option 2 ("choose an existing account") render
    // and be recommended — structurally impossible with the old
    // always-empty props.
    const existingOption = screen.getByTestId("legacy-prime-migration-account-option-existing");
    expect(within(existingOption).getByText("Stoic Account")).toBeInTheDocument();
    expect(within(existingOption).getByText("Recommended")).toBeInTheDocument();

    // `currentPrimeSeed`/`currentPrimeAccount` (derived via `isPrime`) also
    // reached the wizard: "keep current" names the real current account.
    // Round 4 (`codex-id-step-flow`): the kept account now ALSO renders as
    // its own chip (bullet + name + curve badge).
    //
    // Round 6 owner correction (real screenshot): `primeAccount` sits at
    // array index 0 here — per `OuronetAccountsTab.tsx`'s own rule (which
    // this wizard now mirrors exactly), index 0 ALWAYS shows the literal
    // "CodexPrime" label, never the account's own `.name` field. So the
    // fixture's "Current Prime Account" name is correctly NEVER shown —
    // "CodexPrime" is.
    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    const keepChip = within(keepOption).getByTestId("legacy-prime-migration-account-keep-chip");
    expect(within(keepChip).getByText("Codex Ouronet Master")).toBeInTheDocument();
    expect(within(keepOption).queryByText("Current Prime Account")).toBeNull();
  });

  // Owner correction (this session, real screenshot): a plain
  // `.find(a => a.isPrime)` returned null for a real codex whose first/
  // primary account never had `isPrime` explicitly stamped (common for an
  // imported/migrated codex — confirmed via `OuronetAccountsTab.tsx`'s own
  // `displayName`, which falls back to the literal "CodexPrime" string for
  // `index === 0` precisely because it does NOT trust `isPrime` alone
  // either). `CodexIdPage.tsx` now mirrors that same resilience: falls back
  // to the first array entry rather than leaving `currentPrimeAccount`
  // silently null when a real account genuinely exists.
  it("falls back to the FIRST account/seed (positional) when NEITHER has isPrime explicitly set — never leaves currentPrimeAccount/currentPrimeSeed silently null", async () => {
    const firstSeed = makeSeedFixture({ id: "seed-1", seedType: "koala", name: "Initial Seed" }); // no isPrime
    const firstAccount = makeAccountFixture({
      id: "account-1",
      name: "RealFirstAccount",
      address: "Ѻ.real-first-account-address",
    }); // no isPrime
    mockSeedsView.seeds = [firstSeed];
    mockAccountsView.accounts = [firstAccount];

    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => false) })} />,
    );
    const makeEligible = await screen.findByTestId("arweave-codex-id-make-eligible");
    await waitFor(() => expect(makeEligible).toBeEnabled());
    fireEvent.click(makeEligible);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    // Round 6: index-0 accounts now ALWAYS display the literal
    // "CodexPrime" label (mirrors `OuronetAccountsTab.tsx`'s own rule),
    // never the raw `.name` — so "RealFirstAccount" is correctly NOT
    // shown. The real proof that `allAccounts[0]` was genuinely resolved
    // (not silently null) is the account's own ADDRESS, shown underneath
    // the "CodexPrime" label in the chip's new address line.
    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    const keepChip = within(keepOption).getByTestId("legacy-prime-migration-account-keep-chip");
    expect(within(keepChip).getByText("Codex Ouronet Master")).toBeInTheDocument();
    expect(within(keepChip).getByTitle("Ѻ.real-first-account-address")).toBeInTheDocument();
    expect(within(keepOption).queryByText("RealFirstAccount")).toBeNull();
  });

  // Owner correction (this session, real screenshot, round 3 — STILL
  // showing the wrong account after round 2's "isPrime ?? positional" fix
  // was verified served, zero change): round 1 tried `useActiveWallet()`
  // as a middle tier — wrong (a separate "★ Selected" concept). Round 2
  // landed on `isPrime ?? allAccounts[0]` for accounts, reasoning it
  // mirrored the resilience pattern elsewhere — STILL wrong, because
  // `OuronetAccountsTab.tsx`'s OWN standard-account "CodexPrime" rule
  // (line ~500-503) does not consult `isPrime` AT ALL: `isFirst = index
  // === 0` is the entire rule. A real, imported/migrated codex can have a
  // STRAY `isPrime: true` stamp on an account that ISN'T the one the
  // codex's own canonical display treats as CodexPrime (exactly this
  // owner's real data) — checking `isPrime` first, as round 2 did, picks
  // that stray-stamped account instead of the real positional CodexPrime.
  // This proves the CORRECTED rule: accounts are PURE positional
  // (`allAccounts[0]`, `isPrime` ignored entirely) — while seeds are
  // UNCHANGED (`SeedWordsTab.tsx`'s own `isPrime === true || index === 0`
  // convention, where `isPrime` legitimately DOES override position). Same
  // fixture shape proves both at once: the isPrime-stamped ACCOUNT loses
  // to position, the isPrime-stamped SEED still wins over position.
  it("accounts are PURE POSITIONAL (isPrime ignored) while seeds still let isPrime override position — a stray isPrime stamp on a non-first account must NOT win", async () => {
    const firstAccount = makeAccountFixture({
      id: "account-1",
      name: "PositionalFirstAccount",
      address: "Ѻ.positional-first-address",
    });
    const strayPrimeAccount = makeAccountFixture({ id: "account-2", name: "StrayPrimeStampedAccount", isPrime: true });
    const firstSeed = makeSeedFixture({ id: "seed-1", seedType: "koala", name: "PositionalFirstSeed" });
    const primeSeed = makeSeedFixture({ id: "seed-2", seedType: "koala", name: "RealPrimeSeed", isPrime: true });
    mockAccountsView.accounts = [firstAccount, strayPrimeAccount];
    mockSeedsView.seeds = [firstSeed, primeSeed];

    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => false) })} />,
    );
    const makeEligible = await screen.findByTestId("arweave-codex-id-make-eligible");
    await waitFor(() => expect(makeEligible).toBeEnabled());
    fireEvent.click(makeEligible);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    const keepChip = within(keepOption).getByTestId("legacy-prime-migration-account-keep-chip");
    // Account: position 0 wins, DESPITE the other account's isPrime stamp.
    // Round 6: index-0 always shows the literal "CodexPrime" label now —
    // proven here by the chip's own address line (the real resolved
    // entity), not the (never-shown-for-index-0) `.name` field.
    expect(within(keepChip).getByText("Codex Ouronet Master")).toBeInTheDocument();
    expect(within(keepChip).getByTitle("Ѻ.positional-first-address")).toBeInTheDocument();
    expect(within(keepOption).queryByText("PositionalFirstAccount")).toBeNull();
    expect(within(keepOption).queryByText("StrayPrimeStampedAccount")).toBeNull();
    // Seed: isPrime still wins over position (unchanged rule) — asserted at
    // the PROP BOUNDARY, which is the contract `CodexIdPage` actually owes.
    // This used to read the seed's name out of Option 1's prose; that prose
    // was deleted by an unrelated UI round, orphaning the assertion while
    // the rule itself never changed. See `capturedWizardProps` above.
    expect(capturedWizardProps?.currentPrimeSeed?.name).toBe("RealPrimeSeed");
    expect(capturedWizardProps?.currentPrimeSeed?.name).not.toBe("PositionalFirstSeed");
  });
});
