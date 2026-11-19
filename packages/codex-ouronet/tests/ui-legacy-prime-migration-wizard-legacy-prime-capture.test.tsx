/**
 * `runFinalize` captures the LEGACY PRIME before it destroys it —
 * `docs/work/locked-entities-and-former-prime/design.md` §A1/§A2, plan T4,
 * acceptance criteria 1 and 2.
 *
 * ## Why this is a separate spec
 *
 * `tests/ui-legacy-prime-migration-wizard.test.tsx` is 5000+ lines with its
 * own fixture estate; T4's own task line asks for a new file so that estate
 * stays put. The harness below is the MINIMUM of that file's conventions,
 * copied deliberately rather than invented: the `getAccountSelectorDataLive`
 * mock, the `<CodexProvider>` + `StoreGrabber` mount over a real
 * `MemoryCodexAdapter`, the kickstart-pair fixtures, the keep-current walk,
 * and `installMasterArweaveAccounts` writing REAL ciphertext (the Arweave
 * step matches by decrypting, so a placeholder would never let the walk
 * reach Finalize at all).
 *
 * ## What is actually under test
 *
 * Write 1 (`ensurePrimeSeedAccountPairingAndPromote`) reaches
 * `promoteSeedAndAccountToPrime`, which clears `isPrime` on every OTHER
 * account. Write 2 — the Codex Master Seed row — runs after it. So the id of
 * the account that was CodexPrime is only readable BEFORE Write 1, and there
 * is no later point at which it can be reconstructed: the flag is gone, the
 * row never named it, and its stored name is not a signal (the v0.2 kickstart
 * path takes a caller-supplied name, and name-matching is what
 * `masterNames.ts` forbids).
 *
 * The second test is the dangerous one. The wizard is re-runnable, and on a
 * retry "the account carrying `isPrime` before this run's promotion" is the
 * PREVIOUS CANDIDATE, not the owner's original account. Write-once lives in
 * `recordFormerMasterIds` (codex-core), which `setCodexMasterSeed` routes
 * every row write through — so the wizard's write is unconditional and the
 * property is proven here, end to end, rather than guarded twice.
 *
 * Every assertion reads `store.getState().codexMasterSeed`, never a spy on
 * `setCodexMasterSeed` — the sibling spec states why: a spy passes just as
 * happily on a row that was written and then lost.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, act, waitFor, cleanup } from "@testing-library/react";

import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

// Same stub the sibling wizard spec installs: Page 2's activation bullet
// reads live URC_0027 chain state, which in jsdom would be a hanging network
// read. `[]` means "no live data", i.e. every fixture falls back to its
// stored state, exactly as the sibling file's own tests do.
const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorDataLive: () => selectorRows() };
});

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";
import type { IOuroAccount } from "../src/types/entities.js";

const FINALIZE_PASSWORD = "legacy-prime-capture-test-pw";
const FINALIZE_WORDS = ["alpha", "beta", "gamma"];
const FINALIZE_BIT_STRING = seedWordsToBitString(FINALIZE_WORDS);

/** Minimal, valid `IOuroAccount` fixture — the sibling spec's `makeAccount`. */
function makeAccount(overrides: Partial<IOuroAccount> & { id: string }): IOuroAccount {
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

/** The guard a "keep current" + Stoic Dalos walk derives — an account wearing
 *  it reaches the plain `"success"` terminal status instead of
 *  `"eligible-rotation-outstanding"`. */
const matchingGuard = (): IOuroAccount["guard"] => ({
  pred: "keys-all",
  keys: [
    deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0).publicKey,
    deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey,
  ],
});

/** An account the keep-current walk can really finalize: its `secret`
 *  decrypts to the words the whole fixture estate derives from. */
async function walkableAccount(id: string): Promise<IOuroAccount> {
  return makeAccount({
    id,
    originSeedTab: "write-seed",
    guard: matchingGuard(),
    secret: await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD),
  });
}

const kickstartSeed = () => ({
  id: "capture-kickstart-seed",
  name: "Kickstart Seed",
  seedType: "koala" as const,
  version: "1.0.0",
  index: 0,
  secret: "encrypted-secret",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-24T10:00:00.000Z",
  accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/44'/626'/0'/0/0" }],
});

/** THE LEGACY PRIME of every fixture below: the v0.2 kickstart account, which
 *  `kickstartCodex` flags `isPrime`. Note its NAME — "Initial Seed", the
 *  owner's real one — is deliberately not the v0.3 `"CodexPrime"` literal, so
 *  nothing here could pass by name-matching even if it tried. */
const LEGACY_PRIME_ID = "capture-kickstart-ouro";
const kickstartOuro = () => makeAccount({ id: LEGACY_PRIME_ID, name: "Initial Seed" });

describe("LegacyPrimeMigrationWizard — capturing the legacy prime before Write 1 destroys it", () => {
  let capturedStore: ReturnType<typeof useCodexStore> | null = null;
  let capturedAdapter: MemoryCodexAdapter | null = null;
  function FinalizeStoreGrabber() {
    capturedStore = useCodexStore();
    return null;
  }

  /**
   * Writes the Arweave END STATE the Arweave step demands: a seed whose
   * ciphertext decrypts to the walk's bitstring plus a foreign key at index 0
   * and 1. Real ciphertext, through the real actions — the gate decrypts.
   */
  async function installMasterArweaveAccounts(bitString: string): Promise<void> {
    const store = capturedStore!;
    const seedId = "capture-installed-arweave-seed";
    const password = store.getState().actions.getPassword();
    if (!store.getState().arweaveSeeds.some((s) => s.id === seedId)) {
      await store.getState().actions.addArweaveSeed({
        id: seedId,
        name: "Installed Arweave Seed",
        secret: await encryptStringV2(bitString, password),
        createdAt: "2026-11-18T00:00:00.000Z",
      });
    }
    for (const index of [0, 1]) {
      await store.getState().actions.addForeignKey({
        id: `${seedId}-key-${index}`,
        chainId: "arweave:mainnet",
        encryptedKeyfile: "encrypted-keyfile-ciphertext",
        seedId,
        index,
      });
    }
  }

  /** A derivation that PERSISTS what a real one persists. Never actually
   *  called by these fixtures (the accounts are already installed), but the
   *  prop is what the wizard checks before it will commit. */
  function fakeArweaveDerivation() {
    return vi.fn(async (words: { bitString: string }): Promise<void> => {
      await installMasterArweaveAccounts(words.bitString);
    });
  }

  /**
   * Mounts the wizard over a fresh, real `MemoryCodexAdapter`-backed store,
   * kickstarts it (which makes `opts.legacyPrime` the codex's `isPrime`
   * account), adds the extra accounts, and authenticates.
   *
   * `currentPrimeAccount` is a PROP, and deliberately need not be the
   * account the store flags `isPrime` — that divergence is the whole subject:
   * the wizard's keep-current walk promotes the prop, while the flag names
   * whoever held the role before.
   */
  async function renderFinalizeWizard(opts: {
    legacyPrime?: IOuroAccount;
    add?: readonly IOuroAccount[];
    currentPrimeAccount: IOuroAccount;
  }): Promise<NonNullable<typeof capturedStore>> {
    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    capturedAdapter = adapter;
    render(
      <CodexProvider adapter={adapter}>
        <FinalizeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={opts.currentPrimeAccount}
          allAccounts={[opts.currentPrimeAccount]}
          ensurePrimeArweaveSeed={fakeArweaveDerivation()}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    await act(async () => {
      await capturedStore!.getState().actions.kickstartCodex({
        seed: kickstartSeed(),
        primeOuroAccount: opts.legacyPrime ?? kickstartOuro(),
      });
    });
    for (const account of opts.add ?? []) {
      await act(async () => {
        await capturedStore!.getState().actions.addOuroAccount(account);
      });
    }
    act(() => {
      capturedStore!.getState().actions.authenticate(FINALIZE_PASSWORD, 60);
    });
    return capturedStore!;
  }

  /** The user closing the panel and opening the wizard again later over the
   *  SAME persisted codex — a second provider on the same adapter, which
   *  re-hydrates the first run's promotion, row and Arweave rows. The codex
   *  comes back locked (the password cache is store state, not persisted). */
  async function reopenWizardOverSameCodex(
    currentPrimeAccount: IOuroAccount,
  ): Promise<NonNullable<typeof capturedStore>> {
    const adapter = capturedAdapter!;
    cleanup();
    capturedStore = null;
    render(
      <CodexProvider adapter={adapter}>
        <FinalizeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={currentPrimeAccount}
          allAccounts={[currentPrimeAccount]}
          ensurePrimeArweaveSeed={fakeArweaveDerivation()}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate(FINALIZE_PASSWORD, 60);
    });
    return capturedStore!;
  }

  /** intro -> account ("keep current") -> payment -> guard -> review -> arweave. */
  function driveToArweaveStepViaKeepCurrent(): void {
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByRole("button", {
        name: /stoic dalos/i,
      }),
    );
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-recommended")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
  }

  /** The same clicks from "payment" onward, for a RESUMED wizard — it
   *  re-opens on the payment page with every choice restored, not on intro. */
  function driveResumedWalkToArweaveStep(): void {
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-recommended")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
  }

  /** Waits for the Arweave step's real decrypt-and-compare to settle, then
   *  Continues out of it. Writes nothing. */
  async function passArweaveStep(): Promise<void> {
    await screen.findByTestId("legacy-prime-migration-arweave-step");
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  /** THE COMMIT — the "Settle Choices" button, gated on the Settling
   *  Dashboard's four colours. */
  async function settleChoices(): Promise<void> {
    await screen.findByTestId("legacy-prime-migration-settle-choices");
    await waitFor(() => {
      expect(
        (screen.getByTestId("legacy-prime-migration-settle-choices") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-settle-choices"));
  }

  async function driveToFinalizeViaKeepCurrent(): Promise<void> {
    driveToArweaveStepViaKeepCurrent();
    await passArweaveStep();
    await settleChoices();
  }

  async function awaitSuccess(): Promise<void> {
    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
    );
  }

  /**
   * CRITERION 1. Without a capture taken before Write 1, this id is
   * unrecoverable: the promotion clears `isPrime` on every other account, the
   * row has never named it, and the Codex ID page would go on rendering the
   * owner's displaced account with no designation at all — which is the
   * reported bug.
   */
  it("records the account that was CodexPrime before Write 1's promotion cleared its flag", async () => {
    const target = await walkableAccount("capture-first-finalize-target");
    const store = await renderFinalizeWizard({
      add: [target],
      currentPrimeAccount: target,
    });
    await act(async () => {
      await installMasterArweaveAccounts(FINALIZE_BIT_STRING);
    });
    // The precondition the whole task rests on: the flag IS on the kickstart
    // account right up until the commit.
    expect(store.getState().ouroAccounts.find((a) => a.isPrime)?.id).toBe(LEGACY_PRIME_ID);

    await driveToFinalizeViaKeepCurrent();
    await awaitSuccess();

    const row = store.getState().codexMasterSeed;
    expect(row?.ouroAccountId).toBe(target.id);
    expect(row?.legacyPrimeOuroAccountId).toBe(LEGACY_PRIME_ID);
    // ...and the evidence really is gone by now, so nothing downstream could
    // have reconstructed it.
    expect(store.getState().ouroAccounts.find((a) => a.isPrime)?.id).toBe(target.id);
  });

  /**
   * CRITERION 2 — the dangerous one. A capture that re-ran each finalize
   * would record the SECOND run's reading, which is the previous CANDIDATE
   * (`target`), not the owner's original account. Because Write 1 destroys
   * the evidence, that error would be silent and permanent.
   *
   * `formerOuroAccountIds` is asserted alongside on purpose: it proves the
   * second row write genuinely happened with a different account (so a green
   * `legacyPrimeOuroAccountId` cannot be the no-change short-circuit in
   * `setCodexMasterSeed` quietly skipping the write).
   */
  it("a SECOND finalize naming a third account leaves the field naming the ORIGINAL kickstart prime", async () => {
    const target = await walkableAccount("capture-second-run-first-target");
    const third = await walkableAccount("capture-second-run-third-account");
    const store = await renderFinalizeWizard({
      add: [target],
      currentPrimeAccount: target,
    });
    await act(async () => {
      await installMasterArweaveAccounts(FINALIZE_BIT_STRING);
    });

    await driveToFinalizeViaKeepCurrent();
    await awaitSuccess();
    expect(store.getState().codexMasterSeed?.legacyPrimeOuroAccountId).toBe(LEGACY_PRIME_ID);

    // ── the user adds another account and runs the whole thing again ──
    await act(async () => {
      await store.getState().actions.addOuroAccount(third);
    });
    const second = await reopenWizardOverSameCodex(third);
    // This run's reading would be the PREVIOUS CANDIDATE, not the original.
    expect(second.getState().ouroAccounts.find((a) => a.isPrime)?.id).toBe(target.id);

    driveResumedWalkToArweaveStep();
    await passArweaveStep();
    await settleChoices();
    await awaitSuccess();

    const row = second.getState().codexMasterSeed;
    expect(row?.ouroAccountId).toBe(third.id);
    // The row REALLY was rewritten by the second run...
    expect(row?.formerOuroAccountIds).toEqual([target.id]);
    // ...and the write-once field did not follow it.
    expect(row?.legacyPrimeOuroAccountId).toBe(LEGACY_PRIME_ID);
    expect(row?.legacyPrimeOuroAccountId).not.toBe(target.id);
  });

  /**
   * A finalize that re-confirms the account ALREADY carrying `isPrime`
   * displaced nobody, so it must not claim a legacy prime — claiming one
   * would put a "Former Codex Prime" designation on the codex's own settled
   * master at the seal.
   */
  it("a finalize that re-confirms the account already carrying isPrime records no legacy prime", async () => {
    const legacyPrime = await walkableAccount(LEGACY_PRIME_ID);
    const store = await renderFinalizeWizard({
      legacyPrime,
      currentPrimeAccount: legacyPrime,
    });
    await act(async () => {
      await installMasterArweaveAccounts(FINALIZE_BIT_STRING);
    });

    await driveToFinalizeViaKeepCurrent();
    await awaitSuccess();

    const row = store.getState().codexMasterSeed;
    expect(row?.ouroAccountId).toBe(LEGACY_PRIME_ID);
    expect(row?.legacyPrimeOuroAccountId).toBeUndefined();
  });
});
