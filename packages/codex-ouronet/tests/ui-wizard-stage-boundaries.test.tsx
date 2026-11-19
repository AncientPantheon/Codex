/**
 * The three-stage boundaries, driven through the real wizard.
 *
 * The three facts this topic exists to establish:
 *   - a PARTIAL stage 1 writes nothing to the codex (free to abandon);
 *   - a COMPLETE stage 1 is recorded, so it can be resumed;
 *   - ARRIVING at the final step writes nothing either — stage 2 begins at
 *     the explicit "Settle Choices" click and nowhere else
 *     (`docs/work/migration-pending-apply/plan.md` T4).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

const WORDS = "river stone ember";
/** The ciphertext this file's `smartDecrypt` stub answers with the MASTER
 *  BITSTRING rather than the words — what an Arweave seed row's `secret`
 *  holds (an `IArweaveSeed.secret` IS the derived bitstring, never
 *  re-hashed), and therefore the only thing that can satisfy
 *  `codexHoldsMasterArweaveAccounts` and let the walk reach the last step. */
const ARWEAVE_MASTER_CT = "ct-arweave-master";
vi.mock("@stoachain/stoa-core/crypto", async (o) => ({
  ...(await o<Record<string, unknown>>()),
  smartDecrypt: async (ciphertext: string) => {
    if (ciphertext !== ARWEAVE_MASTER_CT) return WORDS;
    const { seedWordsToBitString } = await import("@ouronet/dalos-crypto/gen1");
    return seedWordsToBitString(WORDS.split(" "));
  },
}));
const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("../src/zbom/ouroSelectorReads.js", async (o) => ({
  ...(await o<Record<string, unknown>>()),
  getAccountSelectorDataLive: () => selectorRows(),
}));

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import type { IOuroAccount, IStoaChainSeed } from "../src/types/entities.js";

const PASSWORD = "stage-boundary-pw";

const account = (o: Partial<IOuroAccount> & { id: string }): IOuroAccount => ({
  version: "1.0", isSmart: false, address: `Ѻ.${o.id}`, guard: null,
  stoaChainLedger: null, publicKey: "pub", secret: `ct-${o.id}`,
  backup: "ct", originSeedTab: "write-seed", ...o,
});

const seeds: IStoaChainSeed[] = [{
  id: "seed-1", name: "Initial Seed", seedType: "koala", version: "1.0.0", index: 0,
  secret: "ct", main: "", createdAt: "2026-10-29T10:00:00.000Z", isPrime: true,
  accounts: [
    { index: 0, publicKey: "9".repeat(64), derivationPath: "m/0" },
    { index: 1, publicKey: "7".repeat(64), derivationPath: "m/1" },
  ],
}];

let store: ReturnType<typeof useCodexStore> | null = null;
function Grab() { store = useCodexStore(); return null; }

async function openStep3() {
  const current = account({ id: "current", name: "AncientHodler" });
  store = null;
  render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <Grab />
      <LegacyPrimeMigrationWizard
        open onClose={() => {}}
        currentPrimeAccount={current}
        allAccounts={[current]}
        allSeeds={seeds}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  const keep = await screen.findByTestId("legacy-prime-migration-account-option-keep");
  fireEvent.click(within(keep).getByRole("button"));
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  await screen.findByTestId("legacy-prime-migration-payment-section");
}

/** Payment (3A) and guard (3B) are separate pages (owner correction, this
 *  session) — call after `openStep3()` before touching anything
 *  guard-specific. Payment already defaults to its recommended option, so
 *  Continue is enabled without picking anything first. */
async function goToGuardStep() {
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  await screen.findByTestId("legacy-prime-migration-guard-section");
}

const pick = (tid: string) =>
  fireEvent.click(within(screen.getByTestId(tid)).getByRole("button"));

beforeEach(() => { selectorRows.mockReset(); });

describe("stage 1 is free to abandon until it is COMPLETE", () => {
  // UPDATED (owner, this session): payment and guard now default to their
  // RECOMMENDED option on arrival (see `ui-step3-payment-and-guard.test.tsx`'s
  // "pre-selects option 1" tests) — so once an account is chosen, the
  // underlying choice VALUES are already complete before any click on this
  // step. Recording still only happens through the explicit onChoose
  // callback (never from the default alone), so arriving here and touching
  // nothing is still the one genuinely abandon-free state — see below for
  // what choosing just one decision now does, given the other already
  // defaults.
  it("writes NOTHING merely by arriving at Step 3 — recording needs an explicit choice", async () => {
    await openStep3();
    await act(async () => { await Promise.resolve(); });
    expect(store!.getState().migrationProgress).toBeUndefined();
  });
});

describe("a COMPLETE stage 1 is recorded, so it can be resumed", () => {
  it("records the selection once account + payment + guard are all chosen", async () => {
    await openStep3();
    pick("legacy-prime-migration-payment-option-derive");
    await goToGuardStep();
    pick("legacy-prime-migration-guard-option-recommended");

    await waitFor(() => {
      expect(store!.getState().migrationProgress).toBeTruthy();
    });
    const row = store!.getState().migrationProgress!;
    expect(row.stage).toBe("selection");
    expect(row.selection?.account).toEqual({ kind: "keep-current" });
    expect(row.selection?.payment).toEqual({ kind: "stoic-dalos-position-0" });
    expect(row.selection?.guard).toEqual({ kind: "recommended-single-key" });
  });

  // The other half of the "pre-selected" consequence: touching only ONE of
  // the two decisions now completes the full selection, because the
  // UNTOUCHED one already carries its default value — not left null the
  // way it was before defaults existed.
  it("records immediately after choosing ONLY payment — guard already defaults", async () => {
    await openStep3();
    pick("legacy-prime-migration-payment-option-derive");

    await waitFor(() => {
      expect(store!.getState().migrationProgress).toBeTruthy();
    });
    const row = store!.getState().migrationProgress!;
    expect(row.selection?.payment).toEqual({ kind: "stoic-dalos-position-0" });
    expect(row.selection?.guard).toEqual({ kind: "recommended-single-key" });
  });

  it("records immediately after choosing ONLY guard — payment already defaults", async () => {
    await openStep3();
    await goToGuardStep();
    pick("legacy-prime-migration-guard-option-recommended");

    await waitFor(() => {
      expect(store!.getState().migrationProgress).toBeTruthy();
    });
    const row = store!.getState().migrationProgress!;
    expect(row.selection?.payment).toEqual({ kind: "stoic-dalos-position-0" });
    expect(row.selection?.guard).toEqual({ kind: "recommended-single-key" });
  });

  it("records a CHANGED decision, so a resume shows what was last chosen", async () => {
    await openStep3();
    pick("legacy-prime-migration-payment-option-derive");
    await goToGuardStep();
    pick("legacy-prime-migration-guard-option-recommended");
    await waitFor(() => expect(store!.getState().migrationProgress).toBeTruthy());

    pick("legacy-prime-migration-guard-option-keep");
    await waitFor(() => {
      expect(store!.getState().migrationProgress?.selection?.guard).toEqual({ kind: "keep" });
    });
  });

  it("the recorded row contains NO seed words", async () => {
    await openStep3();
    pick("legacy-prime-migration-payment-option-derive");
    await goToGuardStep();
    pick("legacy-prime-migration-guard-option-recommended");
    await waitFor(() => expect(store!.getState().migrationProgress).toBeTruthy());

    const serialized = JSON.stringify(store!.getState().migrationProgress);
    for (const w of WORDS.split(" ")) expect(serialized).not.toContain(w);
  });

  it("persists to the ADAPTER, not just React state — that is what survives a close", async () => {
    await openStep3();
    pick("legacy-prime-migration-payment-option-derive");
    await goToGuardStep();
    pick("legacy-prime-migration-guard-option-recommended");
    await waitFor(() => expect(store!.getState().migrationProgress).toBeTruthy());

    const adapter = store!.getState().adapter!;
    const persisted = (await adapter.loadAll()).migrationProgress;
    expect(persisted?.selection?.payment).toEqual({ kind: "stoic-dalos-position-0" });
  });
});

/**
 * THE STAGE 1 -> 2 BOUNDARY ITSELF, which these invariants never reached:
 * everything above stops at step 3. Stage 2 — the five writes — used to
 * begin as a SIDE EFFECT of the arweave -> finalize step transition
 * (`handleContinue` did `setStep("finalize")` and `void runFinalize()` in the
 * same breath), so "the user navigated to the last screen" and "the user
 * decided to write" were the same event and there was no boundary to assert.
 *
 * `docs/work/migration-pending-apply/plan.md` T4 separates them: arriving at
 * finalize starts nothing, and "Settle Choices" is the one action that
 * commits. Owner: *"clicking it is the final action that settles the selected
 * choices."*
 */
describe("stage 2 begins at the Settle Choices click, not at the finalize step", () => {
  /** The Arweave END STATE the last step gates on: a seed row whose secret
   *  decrypts to the Codex Master Seed's own bitstring (see
   *  `ARWEAVE_MASTER_CT`), plus a foreign-key entry under it at #0 and #1. */
  async function installMasterArweaveAccounts(): Promise<void> {
    await act(async () => {
      await store!.getState().actions.addArweaveSeed({
        id: "boundary-arweave-seed",
        name: "Boundary Arweave Seed",
        secret: ARWEAVE_MASTER_CT,
        createdAt: "2026-11-19T00:00:00.000Z",
      });
      for (const index of [0, 1]) {
        await store!.getState().actions.addForeignKey({
          id: `boundary-arweave-key-${index}`,
          chainId: "arweave:mainnet",
          encryptedKeyfile: "ct",
          seedId: "boundary-arweave-seed",
          index,
        });
      }
    });
  }

  it("arriving at the finalize step writes NOTHING — the commit waits for Settle Choices", async () => {
    await openStep3();
    await installMasterArweaveAccounts();
    pick("legacy-prime-migration-payment-option-derive");
    await goToGuardStep();
    pick("legacy-prime-migration-guard-option-recommended");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave

    // Continue out of the Arweave step only opens once the codex genuinely
    // holds #0 and #1, which `installMasterArweaveAccounts` just made true.
    await screen.findByTestId("legacy-prime-migration-arweave-step");
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // arweave -> finalize

    // ON the last screen, with the finalize button offered and not pressed.
    const settle = await screen.findByTestId("legacy-prime-migration-settle-choices");
    await waitFor(() => expect((settle as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("legacy-prime-migration-finalize-running")).toBeNull();

    // STAGE 2 HAS NOT STARTED. Not one of the five writes has landed: no
    // promotion, no Codex Master Seed row, no locks, no pending plan, no
    // seal. The stage 1 SELECTION is of course still there — that is stage
    // 1's own recorded row, and the test above is what pins it.
    const row = store!.getState().migrationProgress;
    expect(row?.selection).toBeTruthy();
    expect(row?.committed).toBeUndefined();
    expect(row?.pending).toBeUndefined();
    expect(store!.getState().codexMasterSeed).toBeFalsy();
    expect(store!.getState().masterKeyLocks).toEqual([]);
    expect(store!.getState().primeAlignment).toBe("legacy");

    // ...and pressing the button IS what crosses the boundary: the panel
    // leaves its idle state and the commit is in flight. Read synchronously,
    // with nothing awaited in between — `runFinalize` sets `"running"` before
    // its first await, so this is the transition itself rather than whatever
    // it settles into. (Where it settles is not this file's subject: this
    // fixture's store deliberately holds no kickstarted seed/account pair, so
    // the commit has nothing to pair. The five writes and their outcomes are
    // pinned in `ui-legacy-prime-migration-wizard.test.tsx`.)
    act(() => { fireEvent.click(settle); });
    expect(screen.getByTestId("legacy-prime-migration-finalize-running")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-settle-choices")).toBeNull();
  });
});
