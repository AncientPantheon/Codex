/**
 * LegacyPrimeMigrationWizard — Page 1 ("intro") + the wizard shell
 * (`legacy-prime-migration-wizard` T3, Wave 1), extended by T4 (Wave 2)
 * with Page 2 ("account") — the Prime Ouronet Account identity choice.
 *
 * T3 only built `"intro"`'s real content, with "Continue" as a deliberate
 * no-op stub. T4 wires "Continue" for real (intro -> account) and builds
 * `"account"`'s three radio-style choices — this file's fourth test
 * (T3-era) is UPDATED, not left contradicting the new reality, since T4's
 * own task line says "wire it for real now." See the updated test's own
 * comment below for why.
 *
 * T6 (Wave 4) corrected Page 2's candidate model from seed-based to
 * account-based (`IOuroAccount.originSeedTab`, per `legacy-prime-migration-
 * wizard/design.md`'s rewritten "Page 2" section) and Page 3's framing from
 * "accept existing / define new" to a derivation-METHOD choice (Stoic Dalos
 * vs. Advanced native) — the Page 2/Page 3 suites below, and every other
 * suite's fixtures that exercised the old seed-based picker, are updated
 * accordingly. `makeSeed` (the old `IStoaChainSeed` fixture Page 2's picker
 * used to need) is gone — Page 2 is exercised entirely via `IOuroAccount`
 * fixtures now.
 *
 * Page 2 is exercised directly via mock props (`allAccounts`/
 * `currentPrimeAccount`) — this task does not wire real props from
 * `CodexIdPage.tsx` (left as a documented follow-up; see the component's
 * own module doc), so these tests build minimal `IOuroAccount` fixtures
 * directly.
 *
 * T8 (Wave 5) adds Page 7 ("finalize") — unlike every suite above, these
 * tests mount the wizard over a REAL store + `MemoryCodexAdapter`
 * (`<CodexProvider>` + a `StoreGrabber`, same convention
 * `tests/ui-structural-upgrade-wizard.test.tsx` already established for
 * exercising a wizard that calls real store actions), since Finalize
 * genuinely calls `ensurePrimeSeedAccountPairingAndPromote` (T7) and
 * `stampPrimeAlignmentAligned` through the component itself, not a mock.
 * Fixture words/ciphertext mirror `tests/
 * state-legacy-prime-migration-finalize.test.ts`'s own `WORDS`/`BIT_STRING`
 * convention exactly, so the `guardRotationNeeded: true` vs. `false` split is
 * produced the SAME real way T7's own suite produces it (a mismatched vs.
 * exactly-matching `guard`), not stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, act, waitFor } from "@testing-library/react";

/**
 * Round 9: this file's decrypt-probe and Page-7 finalize suites do REAL
 * crypto — each `smartDecrypt` is a PBKDF2-600k derivation, and some
 * tests do four or more. Testing Library's 1000ms default for
 * `waitFor`/`findBy*` is comfortably under that once the machine is
 * saturated by the rest of the suite running in parallel, which is what
 * produced this file's long-standing "passes alone, fails in the full
 * run, different tests each time" behaviour. Raising the async timeout
 * fixes the measurement, not the assertions — nothing here waits on a
 * timer, so a genuinely broken expectation still fails, just later.
 */
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { createDefaultRegistry, createOuronetAccount } from "@stoachain/stoa-core/dalos";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

// Round 4 (this session): Page 2's activation bullet now reads LIVE
// URC_0027 chain state via `useAccountChainData` (the SAME hook
// `OuronetAccountsTab.tsx` uses — see that file's own tests,
// `ui-ouronet-accounts-payment-key.test.tsx`, for this exact mock
// pattern, reused verbatim here, not reinvented). Without stubbing it,
// every render in this file would fire a real (hanging, in jsdom) network
// read — defaulted to `[]` (no live data) so every pre-existing test's
// "last known" stored-state fallback behavior stays byte-identical; only
// the dedicated live-activation tests below override it.
const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorDataLive: () => selectorRows() };
});

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

import {
  LegacyPrimeMigrationWizard,
  LOCK_IN_WARNING_TEXT,
  PRIME_TRIO_LOCKED_REMINDER_TEXT,
} from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";
import type { IOuroAccount, IStoaChainSeed } from "../src/types/entities.js";

/** Minimal, valid `IOuroAccount` fixture — only the fields Page 2/3's own
 *  logic reads (`id`, `originSeedTab`, `name`, `address`) are given
 *  meaningful values; the rest are the smallest values satisfying the
 *  interface. */
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

/** Drives the wizard from "intro" to "account" by clicking Continue — the
 *  real navigation T4 wires. Shared by every Page 2 test below so each one
 *  starts from the same, real entry point rather than asserting against an
 *  internal step the component doesn't expose any other way. */
function openAccountStep(props: Partial<Parameters<typeof LegacyPrimeMigrationWizard>[0]> = {}) {
  render(<LegacyPrimeMigrationWizard open onClose={() => {}} {...props} />);
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
}

describe("LegacyPrimeMigrationWizard", () => {
  it("shows the intro content and the lock-in warning text, verbatim, when open", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} />);

    expect(screen.getByTestId("legacy-prime-migration-wizard-modal")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-intro")).toBeTruthy();
    // The lock-in rule must read EXACTLY this wording — this is the
    // contract a future task reads to confirm the warning was never
    // paraphrased away.
    expect(screen.getByText(LOCK_IN_WARNING_TEXT)).toBeTruthy();
    expect(LOCK_IN_WARNING_TEXT).toBe(
      "once this completes, your Ouronet Codex Master, Master Chainweb Seed, and Master ArWeave Seed are locked — permanently.",
    );
  });

  it("renders nothing (no modal in the DOM) when open is false", () => {
    render(<LegacyPrimeMigrationWizard open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("legacy-prime-migration-wizard-modal")).toBeNull();
  });

  it("calling the close (×) handler invokes the passed onClose", () => {
    const onClose = vi.fn();
    render(<LegacyPrimeMigrationWizard open onClose={onClose} />);

    fireEvent.click(screen.getByTestId("legacy-prime-migration-wizard-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // UPDATED (T4, Wave 2): T3 left "Continue" a documented no-op stub
  // specifically so T4 could wire the real "intro" -> "account" transition
  // ("wire it for real now" — T4's own task line). This replaces the old
  // T3-era assertion that Continue did nothing; leaving that assertion in
  // place would now directly contradict the real, intended behavior this
  // task ships.
  it("clicking Continue on the intro step navigates to the account step (T4 wires this for real)", () => {
    const onClose = vi.fn();
    render(<LegacyPrimeMigrationWizard open onClose={onClose} />);

    const continueButton = screen.getByTestId("legacy-prime-migration-continue");
    fireEvent.click(continueButton);

    expect(onClose).not.toHaveBeenCalled();
    // Navigated away from "intro"...
    expect(screen.queryByTestId("legacy-prime-migration-intro")).toBeNull();
    // ...to the real "account" step content (Page 2, below).
    expect(screen.getByTestId("legacy-prime-migration-account")).toBeTruthy();
  });
});

describe("LegacyPrimeMigrationWizard — Page 2 (\"account\"): the Prime Ouronet Account choice", () => {
  // T6 (Wave 4) corrected Page 2's candidate model: the original
  // `computeStoicCandidates` filtered `IStoaChainSeed.seedType === "stoic"`
  // — a category error (picking Chainweb SEEDS instead of Ouronet
  // ACCOUNTS; confirmed wrong by the owner this session). The whole suite
  // below is account-based now, per `legacy-prime-migration-wizard/
  // design.md`'s rewritten "Page 2" section:
  //   - Option 2 lists every OTHER `IOuroAccount` that is Standard
  //     (`!isSmart`) and DALOS-curve (`!isExperimentalAccount`) — a SECOND
  //     owner correction, this session, removed `originSeedTab !==
  //     undefined` as a listing filter entirely: a real codex's Standard
  //     accounts very often never had this field stamped (an imported/
  //     migrated-codex data gap), so excluding them made the picker show
  //     almost nothing real. Word origin now ONLY decides the RECOMMENDED
  //     tag (below), never list membership.
  //   - Each listed candidate is tagged RECOMMENDED iff its own
  //     `originSeedTab === "write-seed"`; shown with "No known words"
  //     instead (unbadged) when `originSeedTab === undefined` — never
  //     hidden either way.
  //   - Option 1 ("keep current") is tagged RECOMMENDED iff the CURRENT
  //     account's own `originSeedTab === "write-seed"`.
  //   - Option 3 ("type new words") is tagged RECOMMENDED iff NEITHER the
  //     current account NOR any option-2 candidate is already
  //     `"write-seed"`-origin — a real gap in the previously-shipped code
  //     (it never showed a badge on option 3 at all), fixed here.

  it("an other account with originSeedTab undefined STILL shows in option 2 (owner correction: word origin no longer gates listing) — unrecommended, with 'No known words', and does NOT affect option 1/3's own recommended computation", () => {
    const current = makeAccount({ id: "current-1", originSeedTab: "write-seed" });
    const other = makeAccount({ id: "other-1", name: "NoWordsAccount" }); // originSeedTab undefined
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current, other] });

    // Shown now, not absent.
    const existingOption = screen.getByTestId("legacy-prime-migration-account-option-existing");
    expect(within(existingOption).getByText("NoWordsAccount")).toBeTruthy();
    const otherItem = screen.getByTestId("legacy-prime-migration-account-existing-item-other-1");
    expect(within(otherItem).queryByText("Recommended")).toBeNull();
    expect(within(otherItem).getByText("No known words")).toBeTruthy();

    // Option 1/3's own recommended computation is unaffected by this
    // unrecommended candidate's presence — current account is write-seed,
    // so option 1 is recommended, option 3 is not.
    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    expect(within(keepOption).getByText("Recommended")).toBeTruthy();

    const newOption = screen.getByTestId("legacy-prime-migration-account-option-new");
    expect(within(newOption).queryByText("Recommended")).toBeNull();
  });

  it("with ZERO other accounts at all (not just zero with known words): option 2 is genuinely absent, option 1 is recommended (write-seed current), option 3 is NOT recommended", () => {
    const current = makeAccount({ id: "current-1", originSeedTab: "write-seed" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    expect(within(keepOption).getByText("Recommended")).toBeTruthy();

    const newOption = screen.getByTestId("legacy-prime-migration-account-option-new");
    expect(within(newOption).queryByText("Recommended")).toBeNull();
  });

  it("with zero existing-account candidates and a current account with NO known word origin: option 2 is absent, option 1 is NOT recommended, option 3 IS recommended", () => {
    const current = makeAccount({ id: "current-1" }); // originSeedTab undefined
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    expect(within(keepOption).queryByText("Recommended")).toBeNull();

    const newOption = screen.getByTestId("legacy-prime-migration-account-option-new");
    expect(within(newOption).getByText("Recommended")).toBeTruthy();
  });

  it("with one candidate account whose originSeedTab is \"write-seed\": option 2 is present, that candidate is tagged RECOMMENDED, and option 1/3 are NOT (current account is not write-seed-origin)", () => {
    const current = makeAccount({ id: "current-1", originSeedTab: "12-words" });
    const candidate = makeAccount({ id: "candidate-1", name: "Candidate Account", originSeedTab: "write-seed" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current, candidate] });

    const existingOption = screen.getByTestId("legacy-prime-migration-account-option-existing");
    expect(within(existingOption).getByText("Candidate Account")).toBeTruthy();
    const candidateItem = screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-1");
    expect(within(candidateItem).getByText("Recommended")).toBeTruthy();

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    expect(within(keepOption).queryByText("Recommended")).toBeNull();
    const newOption = screen.getByTestId("legacy-prime-migration-account-option-new");
    expect(within(newOption).queryByText("Recommended")).toBeNull();
  });

  it("with one candidate account whose originSeedTab is \"12-words\": option 2 is present, that candidate shows WITHOUT the recommended tag, and is still selectable", () => {
    const candidate = makeAccount({ id: "candidate-1", name: "Dictionary Account", originSeedTab: "12-words" });
    openAccountStep({ allAccounts: [candidate] });

    const existingOption = screen.getByTestId("legacy-prime-migration-account-option-existing");
    expect(within(existingOption).getByText("Dictionary Account")).toBeTruthy();
    const candidateItem = screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-1");
    expect(within(candidateItem).queryByText("Recommended")).toBeNull();

    fireEvent.click(candidateItem);
    expect(candidateItem.getAttribute("aria-selected")).toBe("true");
  });

  it("the current account is never listed as its own option-2 candidate, even when it has a known word origin", () => {
    const current = makeAccount({ id: "current-1", name: "Current Account", originSeedTab: "write-seed" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();
  });

  it("option 2's un-named candidate fallback (account address) renders through OuronetAddressHighlight", () => {
    const candidate = makeAccount({ id: "candidate-1", originSeedTab: "write-seed", address: "Ѻ.deadbeefcafefeed" });
    openAccountStep({ allAccounts: [candidate] });

    // Round 6: the address now legitimately renders twice for an un-named
    // candidate — once as the name-slot fallback, once as the new
    // dedicated address line every candidate shows underneath its name.
    expect(screen.getAllByTitle("Ѻ.deadbeefcafefeed").length).toBe(2);
  });

  // Owner correction (this session, real screenshot: "Apollo Accounts have
  // no place in the list, as the smart ouronet accounts have no place in
  // the list"): a Smart account and an APOLLO-curve account must NEVER
  // appear as option-2 candidates, even with a known word origin.
  it("a SMART account with a known word origin is EXCLUDED from option 2 — smart accounts are never Prime candidates", () => {
    const smartCandidate = makeAccount({
      id: "candidate-1",
      name: "SmartOuronetDev",
      originSeedTab: "write-seed",
      isSmart: true,
    });
    openAccountStep({ allAccounts: [smartCandidate] });

    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();
  });

  it("an APOLLO-curve account with a known word origin is EXCLUDED from option 2 — only DALOS-curve accounts qualify", () => {
    const apolloCandidate = makeAccount({
      id: "candidate-1",
      name: "ApolloStandard",
      originSeedTab: "write-seed",
      originCurve: "apollo",
    });
    openAccountStep({ allAccounts: [apolloCandidate] });

    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();
  });

  it("an APOLLO-curve account detected via address-prefix fallback (no originCurve field stamped) is ALSO excluded — mirrors detectOriginCurve's own fallback, not a second implementation", () => {
    const apolloLegacyCandidate = makeAccount({
      id: "candidate-1",
      name: "LegacyApolloAccount",
      originSeedTab: "write-seed",
      address: "₱.deadbeefcafefeed", // APOLLO standard prefix, no originCurve stamp
    });
    openAccountStep({ allAccounts: [apolloLegacyCandidate] });

    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();
  });

  it("a Standard, DALOS-curve account with a known word origin is INCLUDED (the real positive case, not just exclusions)", () => {
    const validCandidate = makeAccount({
      id: "candidate-1",
      name: "AncientHodler",
      originSeedTab: "write-seed",
      isSmart: false,
      originCurve: "dalos",
    });
    openAccountStep({ allAccounts: [validCandidate] });

    const existingOption = screen.getByTestId("legacy-prime-migration-account-option-existing");
    expect(within(existingOption).getByText("AncientHodler")).toBeTruthy();
  });

  // Owner correction (this session): "with a green bullet if its
  // activated, red if its not" — status only, never a filter (an inactive
  // account still shows, just with a red bullet).
  it("an ACTIVATED candidate shows a green bullet; an INACTIVE candidate shows a red bullet — status only, never filtered out", () => {
    const activeCandidate = makeAccount({
      id: "candidate-active",
      name: "ActiveAccount",
      originSeedTab: "write-seed",
      isActive: true,
    });
    const inactiveCandidate = makeAccount({
      id: "candidate-inactive",
      name: "InactiveAccount",
      originSeedTab: "write-seed",
      isActive: false,
    });
    openAccountStep({ allAccounts: [activeCandidate, inactiveCandidate] });

    // Title text now includes an honest "last known" caveat (this session
    // — the bullet reads only the STORED flag, no live chain query).
    const activeItem = screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-active");
    expect(within(activeItem).getByTitle(/^Activated/)).toBeTruthy();

    const inactiveItem = screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-inactive");
    expect(within(inactiveItem).getByTitle(/^Not activated/)).toBeTruthy();
  });

  // Owner correction (this session, real screenshot): option 1 used to
  // silently show the Chainweb SEED's name ("Initial Seed") instead of the
  // OURONET ACCOUNT's real name ("CodexPrime") whenever the account's own
  // `name` was missing — misleading, since the label explicitly claims to
  // be the account. Fixed: never substitute an unrelated entity's name.
  it("option 1 shows the REAL current account's own name, never a substituted seed name, when the account has a name", () => {
    const current = makeAccount({ id: "current-1", name: "CodexPrime" });
    const seed = { id: "seed-1", name: "Initial Seed" } as IStoaChainSeed;
    openAccountStep({ currentPrimeAccount: current, currentPrimeSeed: seed, allAccounts: [current] });

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    // Round 4 owner correction ("the last 7 times"): the kept account is
    // now ALSO shown as its own unmistakable chip (bullet + name + curve
    // badge), the SAME visual language Option 2's candidates use — not
    // just named inline in prose. "CodexPrime" legitimately appears
    // twice now (the chip AND the prose sentence); `getAllByText` proves
    // both, and the chip is asserted by its own testid specifically.
    expect(within(keepOption).getAllByText("Ouronet Codex Master").length).toBe(2);
    const chip = within(keepOption).getByTestId("legacy-prime-migration-account-keep-chip");
    expect(within(chip).getByText("Ouronet Codex Master")).toBeTruthy();
    expect(within(chip).getByText("DALOS")).toBeTruthy();
    // The seed name is shown too, but separately labeled — never conflated
    // with the account's own name.
    expect(within(keepOption).getByText(/its chainweb seed/i)).toBeTruthy();
    expect(within(keepOption).getByText("Initial Seed")).toBeTruthy();
  });

  it("option 1 falls back to the account's own ADDRESS (never the seed's name) when the account has no name and is NOT the array's index-0 account", () => {
    // Round 6: an index-0 account ALWAYS shows the literal "CodexPrime"
    // label now (see the dedicated describe block below), regardless of
    // its own `.name` — so this "no name -> address" fallback path is
    // only reachable for a NON-index-0 `currentPrimeAccount` (still a
    // real, legitimate shape this component must handle: a test harness,
    // or any future caller, can pass a `currentPrimeAccount` that isn't
    // literally `allAccounts[0]`).
    const indexZeroAccount = makeAccount({ id: "index-zero", name: "SomeOtherAccount" });
    const current = makeAccount({ id: "current-1", address: "Ѻ.realaccountaddress" });
    const seed = { id: "seed-1", name: "Initial Seed" } as IStoaChainSeed;
    openAccountStep({
      currentPrimeAccount: current,
      currentPrimeSeed: seed,
      allAccounts: [indexZeroAccount, current],
    });

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    // The address now legitimately renders THREE times: the chip's
    // name-slot fallback (no `.name`), the chip's own dedicated address
    // line underneath (round 6, shown for every entry), and the prose
    // sentence's own fallback.
    expect(within(keepOption).getAllByTitle("Ѻ.realaccountaddress").length).toBe(3);
    const chip = within(keepOption).getByTestId("legacy-prime-migration-account-keep-chip");
    expect(within(chip).getAllByTitle("Ѻ.realaccountaddress").length).toBe(2);
    // "Initial Seed" is still shown, but as the clearly-labeled seed, not
    // substituted in place of the account's own identity.
    expect(within(keepOption).getByText(/its chainweb seed/i)).toBeTruthy();
  });

  it('option 1 shows the literal "CodexPrime" label when the current account IS the array\'s index-0 account, even if its own stored .name is something else entirely (e.g. "Initial Seed") — mirrors OuronetAccountsTab.tsx\'s own index-0 rule exactly', () => {
    // This is the owner's exact real-data bug: a real/imported first
    // account can carry a stale/unrelated `.name` (here literally "Initial
    // Seed", matching their real screenshot) — `OuronetAccountsTab.tsx`
    // NEVER reads `.name` for index 0 at all, it's always "CodexPrime".
    const current = makeAccount({ id: "current-1", name: "Initial Seed" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    expect(within(keepOption).getAllByText("Ouronet Codex Master").length).toBe(2);
    expect(within(keepOption).queryByText("Initial Seed")).toBeNull();
  });

  it("each option-2 candidate shows its detected curve (DALOS) for transparency, auditable against a real filter regression", () => {
    const candidate = makeAccount({ id: "candidate-1", name: "RealDalosAccount", originSeedTab: "write-seed", originCurve: "dalos" });
    openAccountStep({ allAccounts: [candidate] });

    const candidateItem = screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-1");
    expect(within(candidateItem).getByText("DALOS")).toBeTruthy();
  });

  // Owner correction (this session): "they must be ordered alphabetically
  // similar as they are shown in the codex" — mirrors the real Ouronet
  // Accounts tab's own display order.
  it("option 2's candidates are ordered ALPHABETICALLY by name, not by insertion/array order", () => {
    const candidates = [
      makeAccount({ id: "c-zebra", name: "Zebra", originSeedTab: "write-seed" }),
      makeAccount({ id: "c-alpha", name: "Alpha", originSeedTab: "write-seed" }),
      makeAccount({ id: "c-mango", name: "Mango", originSeedTab: "write-seed" }),
    ];
    openAccountStep({ allAccounts: candidates });

    const existingOption = screen.getByTestId("legacy-prime-migration-account-option-existing");
    const names = within(existingOption)
      .getAllByRole("option")
      .map((el) => el.textContent?.match(/Alpha|Mango|Zebra/)?.[0]);
    expect(names).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("the current account's own originSeedTab === undefined shows option 1's new 'no known words' warning", () => {
    const current = makeAccount({ id: "current-1" }); // originSeedTab undefined
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    expect(
      within(keepOption).getByText(
        "Keeping this account will not make seed-words-only restore possible — it has no known recovery words on record.",
      ),
    ).toBeTruthy();
  });

  it("the current account's own originSeedTab === \"write-seed\" does NOT show option 1's 'no known words' warning", () => {
    const current = makeAccount({ id: "current-1", originSeedTab: "write-seed" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    expect(
      within(keepOption).queryByText(
        "Keeping this account will not make seed-words-only restore possible — it has no known recovery words on record.",
      ),
    ).toBeNull();
  });

  it("choosing option 3 (\"type new words\") always shows both warning lines, unconditionally, before any text is entered", () => {
    openAccountStep({ allAccounts: [] });

    const newOption = screen.getByTestId("legacy-prime-migration-account-option-new");
    // No text has been typed into the word-entry field yet — the warnings
    // must already be visible regardless.
    expect(
      within(newOption).getByText(
        "This creates a new account that must be activated on-chain before use",
      ),
    ).toBeTruthy();
    expect(
      within(newOption).getByText(
        "This account starts completely empty — no funds, no history.",
      ),
    ).toBeTruthy();
  });

  it("selecting option 1 (keep current) marks it active/selected", () => {
    const candidate = makeAccount({ id: "candidate-1", originSeedTab: "write-seed" });
    openAccountStep({ allAccounts: [candidate] });

    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );

    expect(
      screen.getByTestId("legacy-prime-migration-account-option-keep").getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("legacy-prime-migration-account-option-new").getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("selecting a candidate under option 2 marks option 2 (and that exact candidate) active/selected, and updates accountChoice to {kind: 'existing', accountId}", () => {
    const candidate = makeAccount({ id: "candidate-1", originSeedTab: "write-seed" });
    openAccountStep({ allAccounts: [candidate] });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-1"));

    expect(
      screen
        .getByTestId("legacy-prime-migration-account-option-existing")
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("legacy-prime-migration-account-existing-item-candidate-1")
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("legacy-prime-migration-account-option-keep").getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("selecting option 3 (type new words) marks it active/selected", () => {
    openAccountStep({ allAccounts: [] });

    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-new")).getByRole("button", {
        name: /type new words/i,
      }),
    );

    expect(
      screen.getByTestId("legacy-prime-migration-account-option-new").getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("legacy-prime-migration-account-option-keep").getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("typing new words updates the wizard's stored choice (verified by the words round-tripping back into the input)", () => {
    openAccountStep({ allAccounts: [] });

    const input = screen.getByTestId("legacy-prime-migration-account-new-words-input");
    fireEvent.change(input, { target: { value: "apple banana cherry" } });

    expect((input as HTMLTextAreaElement).value).toBe("apple banana cherry");
    expect(
      screen.getByTestId("legacy-prime-migration-account-option-new").getAttribute("aria-selected"),
    ).toBe("true");
  });
});

/**
 * Page 2's decrypt-probe (owner correction, this session, two rounds):
 * round 1 — "a lot of accounts are shown with no known words, when in fact
 * the codex can indeed show me their seed words" — `originSeedTab`
 * metadata can be missing/stale on real, imported accounts even though the
 * account's `secret` decrypts to real content right now. `AccountStep`
 * probes any candidate missing that metadata via the SAME `getPassword()`
 * -> `smartDecrypt(account.secret, ...)` seam Page 7's finalize step uses.
 *
 * Round 2 (same complaint, still wrong): the first version of this probe
 * additionally required the decrypted plaintext NOT look like a
 * pre-converted DALOS bitstring, reasoning that meant "no words" — WRONG,
 * caught against real data (most of the owner's real accounts decrypt to
 * bitstrings and were still shown "No known words"). `ViewSeedModal.tsx` /
 * `DalosSecretReveal.tsx` (the codex's own real "reveal seed words"
 * feature) prove the real rule: ANY successfully-decrypted representation
 * (seedWords, bitString, bitmap, integerBase10/49) re-derives a full key
 * via `rebuildFullKey` and the reveal ALWAYS includes a words/Seed tab
 * regardless. So "known words" only needs a successful, non-empty decrypt
 * — the bitstring-shape exclusion is gone.
 *
 * This needs a REAL store, unlike every Page 2 test above that uses
 * `openAccountStep`'s prop-only mock — `getPassword` is only real when the
 * wizard reads it from `useCodexStoreOptional()`'s own `actions.
 * getPassword` (see the component's `actions?.getPassword` call site), so
 * this mirrors Page 7's own harness convention: `CodexProvider` +
 * `MemoryCodexAdapter` + a real `authenticate()` call.
 */
describe("LegacyPrimeMigrationWizard — Page 2 decrypt-probe (real getPassword)", () => {
  const PROBE_PASSWORD = "decrypt-probe-test-pw";
  const PROBE_WORDS = ["river", "stone", "ember"];

  let capturedStore: ReturnType<typeof useCodexStore> | null = null;
  function ProbeStoreGrabber() {
    capturedStore = useCodexStore();
    return null;
  }

  it("a candidate with originSeedTab undefined, whose secret decrypts to real words (not a DALOS bitstring), upgrades from 'No known words' to a real candidate once the probe resolves", async () => {
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), PROBE_PASSWORD);
    const noMetadataCandidate = makeAccount({
      id: "probe-no-metadata",
      name: "Mnemosyne",
      secret,
      // originSeedTab deliberately left undefined — the stale/missing-
      // metadata case the owner reported against their real accounts.
    });
    const current = makeAccount({ id: "probe-current" });

    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, noMetadataCandidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate(PROBE_PASSWORD, 60);
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    // Round 9 (owner: "Id rather be shown first a progress bar before
    // anything is shown, then shown everything at once correctly"): the
    // list is withheld entirely while the pass runs, so there is no
    // interim "No known words" paint to observe any more — the progress
    // panel stands in its place, and the row arrives already correct.
    expect(screen.getByTestId("legacy-prime-migration-account-probe-progress")).toBeTruthy();
    expect(
      screen.queryByTestId("legacy-prime-migration-account-existing-item-probe-no-metadata"),
    ).toBeNull();

    const candidateItem = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-probe-no-metadata",
    );
    expect(within(candidateItem).queryByText("No known words")).toBeNull();
  });

  // Owner correction round 2 (real screenshot): the FIRST version of this
  // probe treated a decrypted DALOS bitstring as "not known words" — wrong.
  // `DalosSecretReveal.tsx` proves a bitstring secret re-derives a full
  // words/Seed representation too (`rebuildFullKey`), exactly like a
  // literal-words secret does. This asserts the bitstring case upgrades
  // the SAME as the literal-words case above, not differently.
  it("a candidate with originSeedTab undefined, whose secret decrypts to a DALOS bitstring, ALSO upgrades from 'No known words' — the codex can re-derive words from a bitstring too", async () => {
    const bitString = seedWordsToBitString(PROBE_WORDS);
    const secret = await encryptStringV2(bitString, PROBE_PASSWORD);
    const bitstringCandidate = makeAccount({
      id: "probe-bitstring",
      name: "Bitstring Account",
      secret,
      // originSeedTab left undefined, same as above — the decrypted
      // plaintext here is a pre-converted bitstring, not literal word text,
      // but the codex's own reveal feature can still show it as words.
    });
    const current = makeAccount({ id: "probe-current-2" });

    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, bitstringCandidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate(PROBE_PASSWORD, 60);
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    const candidateItem = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-probe-bitstring",
    );
    expect(within(candidateItem).queryByText("No known words")).toBeNull();
  });

  it("a candidate whose secret fails to decrypt (wrong/garbage ciphertext) stays flagged 'No known words' — a real decrypt failure, not a representation judgment", async () => {
    const unreadableCandidate = makeAccount({
      id: "probe-unreadable",
      name: "Unreadable Account",
      secret: "not-valid-v2-ciphertext",
      // originSeedTab left undefined; the secret is genuinely not
      // decryptable by this codex's password, unlike the two cases above.
    });
    const current = makeAccount({ id: "probe-current-3" });

    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, unreadableCandidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate(PROBE_PASSWORD, 60);
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    // Round 9: the row only appears once the pass has settled — and then
    // it is correct first time, including when the verdict is a failure.
    const candidateItem = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-probe-unreadable",
    );
    expect(within(candidateItem).getByText("No known words")).toBeTruthy();
    // Round 6 owner correction (real screenshot, repeated across rounds —
    // "how could you know the OTHER accounts have seed words if for these
    // ones you can't?"): the "No known words" label now carries the REAL
    // classified reason (`@stoachain/stoa-core/crypto`'s own typed
    // `CorruptEnvelopeError`/`WrongPasswordError`/`UnsupportedFormatError`
    // taxonomy, not a guess) instead of a bare, unexplained "no". A
    // garbage, non-envelope-shaped secret is a malformed envelope, not a
    // wrong password — the tooltip must say so, distinctly.
    expect(within(candidateItem).getByTitle(/corrupted\/malformed/i)).toBeTruthy();
  });

  /**
   * Round 9 owner ask: "it kinda loaded with latency, first was red, and
   * then it loaded. Id rather be shown first a progress bar before
   * anything is shown, then shown everything at once correctly from the
   * get go."
   *
   * Round 8's per-account publishing fixed "nothing until the last
   * decrypt lands" but produced exactly that: a list painted WRONG first
   * (every row red) that then repaired itself row by row. The step now
   * withholds its body until the pass settles.
   */
  it("shows a progress panel while the decrypt pass runs — with NO candidate rows painted yet — then reveals the whole list already resolved", async () => {
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), PROBE_PASSWORD);
    const one = makeAccount({ id: "prog-1", name: "ProgOne", secret });
    const two = makeAccount({ id: "prog-2", name: "ProgTwo", secret });
    const three = makeAccount({ id: "prog-3", name: "ProgThree", secret });
    const current = makeAccount({ id: "prog-current" });

    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, one, two, three]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate(PROBE_PASSWORD, 60);
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    // While the pass runs: progress panel, and NOT a single candidate row
    // (nor the Option 1 chip, whose tag depends on the same pass).
    expect(screen.getByTestId("legacy-prime-migration-account-probe-progress")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();
    expect(screen.queryByTestId("legacy-prime-migration-account-existing-item-prog-1")).toBeNull();
    expect(screen.queryByTestId("legacy-prime-migration-account-keep-chip")).toBeNull();
    expect(screen.getByText(/Reading your Ouronet accounts/i)).toBeTruthy();

    // Then the whole list at once, every row already correct — these words
    // are a 3-word custom phrase, so all three are ungated => Recommended.
    const first = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-prog-1",
    );
    expect(screen.queryByTestId("legacy-prime-migration-account-probe-progress")).toBeNull();
    for (const id of ["prog-1", "prog-2", "prog-3"]) {
      const row = screen.getByTestId(`legacy-prime-migration-account-existing-item-${id}`);
      expect(within(row).queryByText("No known words")).toBeNull();
      expect(within(row).getByText("Recommended")).toBeTruthy();
    }
    expect(within(first).getByText("ProgOne")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-account-keep-chip")).toBeTruthy();
  });

  /**
   * Round 8 owner report: "it worked for a second, then i got out, and
   * tried again, then it shows like this that it doesnt recognise the
   * words" — a full list of "No known words" with NO unlock prompt in
   * sight. Two compounding causes, one test each below.
   *
   * Cause 1 (`<PasswordModal>`/`authenticate()` never validate, by their
   * own documentation): a wrong-but-cached password makes `getPassword()`
   * SUCCEED, so the step is never "locked" — the old prompt condition —
   * while every decrypt fails. The step must notice "a whole pass
   * decrypted nothing" and ask for the password anyway.
   */
  it("a cached password that decrypts NOTHING surfaces the password prompt — even though getPassword() succeeded and the codex never reported itself locked", async () => {
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), "the-real-password");
    const candidate = makeAccount({ id: "wrong-cached-pw", name: "WrongCachedPw", secret });
    const current = makeAccount({ id: "wrong-cached-pw-current" });

    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, candidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    // Authenticated — but with a password that is NOT the one these
    // secrets were encrypted with. `getPassword()` will happily return it.
    act(() => {
      capturedStore!.getState().actions.authenticate("a-stale-wrong-password", 60);
    });
    expect(capturedStore!.getState().locked).toBe(false);

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-account-probe-unlock")).toBeTruthy();
    });
    // And it says so plainly, rather than claiming the codex is locked.
    expect(screen.getByText(/could not decrypt ANY of these accounts/i)).toBeTruthy();
    // Round 9: a pass that cannot proceed SETTLES rather than sitting on a
    // progress bar forever — the list and the prompt must both be
    // reachable, so the row is here with its classified reason.
    const item = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-wrong-cached-pw",
    );
    expect(within(item).getByText(/wrong password/)).toBeTruthy();
  });

  /**
   * Cause 2 (mine): a recorded FAILURE used to be treated as a final
   * answer. `toProbe` excluded anything already probed — including
   * failures — so after one bad pass the effect's dep list went empty and
   * never re-ran, AND the prompt's own submit re-probed that same empty
   * list. Entering the CORRECT password afterwards did literally nothing,
   * which is the "tried again, still doesn't recognise them" half of the
   * report. Failures must stay retryable.
   */
  it("after a failed pass, entering the CORRECT password in the prompt actually re-probes and recovers the accounts (the failure is not cached as final)", async () => {
    const realPassword = "the-real-password";
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), realPassword);
    const candidate = makeAccount({ id: "recoverable", name: "Recoverable", secret });
    const current = makeAccount({ id: "recoverable-current" });

    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, candidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate("wrong-password-first-try", 60);
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    // First pass fails for everything — the row appears (settled) with
    // its reason once that pass is done.
    const item = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-recoverable",
    );
    await waitFor(() => {
      expect(within(item).getByText(/wrong password/)).toBeTruthy();
    });

    // Now the real password, via the prompt the failure surfaced.
    const input = screen.getByTestId("legacy-prime-migration-account-probe-unlock-input");
    fireEvent.change(input, { target: { value: realPassword } });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-probe-unlock-submit"));

    await waitFor(() => {
      expect(within(item).queryByText("No known words")).toBeNull();
    });
    expect(screen.queryByTestId("legacy-prime-migration-account-probe-unlock")).toBeNull();
  });

  it("a fresh authenticate() anywhere re-arms previously-failed probes, so the list recovers without reopening the wizard", async () => {
    const realPassword = "the-real-password";
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), realPassword);
    const candidate = makeAccount({ id: "epoch-recover", name: "EpochRecover", secret });
    const current = makeAccount({ id: "epoch-recover-current" });

    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, candidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate("wrong-password-first-try", 60);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    const item = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-epoch-recover",
    );
    await waitFor(() => {
      expect(within(item).getByText(/wrong password/)).toBeTruthy();
    });

    // Re-authenticating elsewhere (global <PasswordModal>, the
    // Make-Eligible gate, anywhere) moves `passwordCache` — the step must
    // take that as "try again", not stay stuck on the old verdict.
    act(() => {
      capturedStore!.getState().actions.authenticate(realPassword, 60);
    });

    // Round 9: the list is withheld again while the re-probe runs, so the
    // row that comes back is a NEW node — re-query it rather than holding
    // the (now detached) reference from the failed pass.
    await waitFor(() => {
      const refreshed = screen.getByTestId(
        "legacy-prime-migration-account-existing-item-epoch-recover",
      );
      expect(within(refreshed).queryByText("No known words")).toBeNull();
    });
  });

  it('a candidate whose secret IS a real V2 envelope, but the cached password is WRONG for it, shows the classified "Wrong password" reason — distinct from a corrupted/malformed envelope', async () => {
    const realButDifferentPassword = "a-totally-different-password";
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), realButDifferentPassword);
    const wrongPwCandidate = makeAccount({
      id: "probe-wrong-pw-classified",
      name: "WrongPwClassified",
      secret,
    });
    const current = makeAccount({ id: "probe-current-wrong-pw-classified" });

    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, wrongPwCandidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    // Authenticated with a DIFFERENT password than the one this specific
    // account's secret was actually encrypted with — simulates a real
    // account whose secret predates a password change, or was imported
    // under a different password entirely.
    act(() => {
      capturedStore!.getState().actions.authenticate(PROBE_PASSWORD, 60);
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    const candidateItem = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-probe-wrong-pw-classified",
    );
    await waitFor(() => {
      expect(within(candidateItem).getByTitle(/wrong password/i)).toBeTruthy();
    });
    expect(within(candidateItem).getByText("No known words")).toBeTruthy();
  });

  // Round 3 owner correction (real screenshot, STILL "No known words" on
  // everything after round 2's fix was verified served): repro'd via a
  // throwaway test that mounted the wizard WITHOUT ever authenticating —
  // `getPassword()` threw `CodexLockedError`, UNCAUGHT, inside the probe's
  // async body (an unhandled promise rejection), and the label never
  // flipped for ANY candidate, forever, with zero visible sign anything
  // was wrong. A real codex's password-cache TTL can expire by the time
  // the owner reaches this step even though the rest of the app still
  // reads "unlocked" — this proves the fix: the inline "Unlock & Check"
  // prompt appears instead of silently failing, and submitting the real
  // password both probes AND re-authenticates (via the `authenticate`
  // prop), recovering exactly the data the automatic probe couldn't reach.
  it("when the codex is LOCKED at probe time (getPassword() throws), the inline 'Unlock & Check' prompt appears instead of silently failing forever, and submitting the real password probes successfully", async () => {
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), PROBE_PASSWORD);
    const lockedCandidate = makeAccount({
      id: "probe-locked",
      name: "LockedCandidate",
      secret,
    });
    const current = makeAccount({ id: "probe-current-4" });

    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, lockedCandidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    // Deliberately NEVER call authenticate() — the real store's own
    // `getPassword()` throws `CodexLockedError` exactly as it would for a
    // real, genuinely-locked/expired-cache codex.

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    const candidateItem = screen.getByTestId(
      "legacy-prime-migration-account-existing-item-probe-locked",
    );
    expect(within(candidateItem).getByText("No known words")).toBeTruthy();

    const unlockPrompt = await screen.findByTestId(
      "legacy-prime-migration-account-probe-unlock",
    );
    expect(unlockPrompt).toBeTruthy();

    const input = screen.getByTestId("legacy-prime-migration-account-probe-unlock-input");
    fireEvent.change(input, { target: { value: PROBE_PASSWORD } });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-probe-unlock-submit"));

    await waitFor(() => {
      expect(within(candidateItem).queryByText("No known words")).toBeNull();
    });
    // The prompt itself goes away once resolved.
    await waitFor(() => {
      expect(
        screen.queryByTestId("legacy-prime-migration-account-probe-unlock"),
      ).toBeNull();
    });
    // The `authenticate` prop was really called on the REAL store (not just
    // used locally for this one probe) — the rest of the app benefits too,
    // same as `ViewSeedModal.tsx`'s own inline-unlock convention.
    expect(capturedStore!.getState().locked).toBe(false);
  });

  it("entering the WRONG password at the unlock prompt shows an error and does not falsely clear 'No known words'", async () => {
    const secret = await encryptStringV2(PROBE_WORDS.join(" "), PROBE_PASSWORD);
    const lockedCandidate = makeAccount({
      id: "probe-locked-wrong-pw",
      name: "LockedCandidateWrongPw",
      secret,
    });
    const current = makeAccount({ id: "probe-current-5" });

    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <ProbeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, lockedCandidate]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    await screen.findByTestId("legacy-prime-migration-account-probe-unlock");

    const input = screen.getByTestId("legacy-prime-migration-account-probe-unlock-input");
    fireEvent.change(input, { target: { value: "definitely-the-wrong-password" } });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-probe-unlock-submit"));

    await waitFor(() => {
      expect(screen.getByText("Incorrect password — try again.")).toBeTruthy();
    });
    const candidateItem = screen.getByTestId(
      "legacy-prime-migration-account-existing-item-probe-locked-wrong-pw",
    );
    expect(within(candidateItem).getByText("No known words")).toBeTruthy();
  });
});

/**
 * Round 4 owner correction (real screenshot): two more root causes found
 * against real data.
 *
 * 1. "Why are accounts like Mnemosyne and Ouronet displaying the red
 *    bullet, when they are activated?" — twice rejected as a documented
 *    "architectural limitation" (the bullet read only the STORED
 *    `account.isActive`). Re-reading `OuronetAccountsTab.tsx` found it was
 *    never actually unfixable: it overlays LIVE URC_0027 chain state via
 *    `useAccountChainData` (`../src/ui/internal/useAccountChainData.js`) —
 *    reused directly here, not reimplemented. These tests mock
 *    `getAccountSelectorDataLive` (`../src/zbom/ouroSelectorReads.js`) the
 *    SAME way `ui-ouronet-accounts-payment-key.test.tsx` does, to prove
 *    the bullet now reflects LIVE data when present.
 *
 * 2. "Why isn't the recommended badge placed properly on Ouronet accounts
 *    who I know for sure I made of ungated seed words, like AncientHodler?"
 *    — `originSeedTab` (dictionary-gated vs. arbitrary) is stamped ONLY at
 *    account-creation time and is NOT recoverable from decrypted content
 *    (this codebase has no client-side wordlist to check membership
 *    against — confirmed by search, not assumed). The only honest fix: let
 *    the owner self-correct the real, persisted record via the actual
 *    `updateOuroAccount` store action.
 */
describe("LegacyPrimeMigrationWizard — Page 2 live chain data + self-correction (round 4)", () => {
  beforeEach(() => selectorRows.mockReset());

  function liveRow(address: string, overrides: Partial<AccountSelectorData> = {}): AccountSelectorData {
    return {
      "iz-activated": true,
      "ouronet-account": address,
      "ouronet-account-guard": { pred: "keys-all", keys: ["p".repeat(64)] },
      "iz-smart": false,
      "ouro-balance": 0,
      "ignis-balance": 0,
      "payment-key-existance": false,
      "payment-key": "",
      "payment-key-balance": 0,
      "payment-key-guard": false,
      "public-key": "",
      sovereign: false,
      governor: false,
      "stoic-tag-has": false,
      "stoic-tag": "",
      ...overrides,
    } as AccountSelectorData;
  }

  it("Option 2's activation bullet reflects LIVE chain state (activated), overriding a STALE stored isActive: false", async () => {
    const candidate = makeAccount({
      id: "live-activated",
      name: "Mnemosyne",
      address: "Ѻ.mnemosyne-address",
      originSeedTab: "write-seed",
      isActive: false, // stale stored value — the owner's real complaint.
    });
    selectorRows.mockResolvedValue([liveRow("Ѻ.mnemosyne-address", { "iz-activated": true })]);

    openAccountStep({ allAccounts: [candidate] });

    const item = screen.getByTestId("legacy-prime-migration-account-existing-item-live-activated");
    // `useAccountChainData`'s read is async (a real `fetchData()` promise,
    // mocked here but still awaited through the same hook) — wait for it
    // to resolve and the bullet to flip, same as the decrypt-probe tests
    // above wait for their own async resolution.
    await waitFor(() => {
      expect(within(item).getByTitle("Activated")).toBeTruthy();
    });
    expect(within(item).queryByTitle(/last known/)).toBeNull();
  });

  it("Option 2's activation bullet falls back to the stored 'last known' isActive while the live read is absent (loading/failed)", () => {
    const candidate = makeAccount({
      id: "no-live-data",
      name: "NoLiveData",
      address: "Ѻ.no-live-data-address",
      originSeedTab: "write-seed",
      isActive: true,
    });
    selectorRows.mockResolvedValue([]); // no live row for this address.

    openAccountStep({ allAccounts: [candidate] });

    const item = screen.getByTestId("legacy-prime-migration-account-existing-item-no-live-data");
    expect(within(item).getByTitle(/^Activated \(last known/)).toBeTruthy();
  });

  it("Option 1's new account chip ALSO reflects live chain state, the same way Option 2's bullets do", async () => {
    const current = makeAccount({
      id: "current-live",
      name: "CurrentAccount",
      address: "Ѻ.current-live-address",
      isActive: false,
    });
    selectorRows.mockResolvedValue([liveRow("Ѻ.current-live-address", { "iz-activated": true })]);

    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    const chip = screen.getByTestId("legacy-prime-migration-account-keep-chip");
    await waitFor(() => {
      expect(within(chip).getByTitle("Activated")).toBeTruthy();
    });
  });

  /**
   * Round 7 owner correction: "you can easily detect that yourself, if its
   * not a valid koala or chainweaver seed, then its not dictionary gated,
   * and it should then read recommended."
   *
   * The owner was right and my previous round was WRONG: I claimed this
   * codebase had no wordlist to check against and shipped a manual "Not
   * dictionary-gated? Mark it" button around that claim.
   * `KadenaWalletBuilder.isValidMnemonic` (`@stoachain/stoa-core/wallet`,
   * already imported in five other files here) does exactly the owner's
   * rule — verified against the real library before writing these:
   *   12 "abandon…about"            -> true   (Chainweaver, checksum OK)
   *   24 "abandon…art"              -> true   (BIP39, checksum OK)
   *   12 non-dictionary words       -> false  (same COUNT, still ungated)
   *   arbitrary / bitstring / empty -> false
   * So the tag is now decided by the account's REAL decrypted content, and
   * the manual button is gone. These mount the real `CodexProvider` +
   * `MemoryCodexAdapter` harness (same as the decrypt-probe suite) because
   * the probe only runs with a real `getPassword`.
   */
  const GATE_PW = "round7-gating-detection-pw";
  /** Canonical all-zero-entropy BIP39 mnemonics — real, checksum-valid. */
  const VALID_24_KOALA = `${"abandon ".repeat(23)}art`;
  const VALID_12_CHAINWEAVER = `${"abandon ".repeat(11)}about`;
  /** 12 words, but not a dictionary phrase — the case word-count alone
   *  can't distinguish and only a real checksum/wordlist check catches. */
  const UNGATED_12 = "zebrax quibble florn stomp vexil mungo crandle tiffle borp wexi plonk grum";

  async function renderGatingProbe(candidate: IOuroAccount): Promise<void> {
    let gateStore: ReturnType<typeof useCodexStore> | null = null;
    function GatingStoreGrabber() {
      gateStore = useCodexStore();
      return null;
    }
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <GatingStoreGrabber />
        <LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[candidate]} />
      </CodexProvider>,
    );
    await waitFor(() => expect(gateStore!.getState().ready).toBe(true));
    act(() => {
      gateStore!.getState().actions.authenticate(GATE_PW, 60);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  it("a candidate whose secret decrypts to NON-dictionary words is auto-tagged Recommended — even though its stamped originSeedTab says \"12-words\" (the owner's AncientHodler case: stale metadata says gated, the real content isn't)", async () => {
    const candidate = makeAccount({
      id: "ancient-hodler",
      name: "AncientHodler",
      originSeedTab: "12-words", // stale/wrong stamp — content is what counts.
      secret: await encryptStringV2(UNGATED_12, GATE_PW),
    });
    await renderGatingProbe(candidate);

    // Round 9: the row lands already correct — no "No known words" first
    // draft to wait out, just the progress panel then the finished list.
    const item = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-ancient-hodler",
    );
    expect(within(item).getByText("Recommended")).toBeTruthy();
    expect(within(item).queryByText("No known words")).toBeNull();
  });

  it("a candidate whose secret decrypts to a VALID 24-word Koala mnemonic is NOT Recommended (genuinely dictionary-gated) — even though its stamped originSeedTab says \"write-seed\"", async () => {
    const candidate = makeAccount({
      id: "koala-gated",
      name: "KoalaGated",
      originSeedTab: "write-seed", // stamp claims ungated; the content disagrees.
      secret: await encryptStringV2(VALID_24_KOALA, GATE_PW),
    });
    await renderGatingProbe(candidate);

    // Round 9: the `write-seed` stamp would have tagged this Recommended
    // from metadata alone, but that never reaches the screen now — the row
    // is only rendered once the decrypt pass has already overruled the
    // stamp, so it appears untagged the first time it is seen.
    const item = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-koala-gated",
    );
    expect(within(item).queryByText("Recommended")).toBeNull();
    expect(within(item).queryByText("No known words")).toBeNull();
  });

  it("a candidate whose secret decrypts to a VALID 12-word Chainweaver mnemonic is NOT Recommended either — both dictionary families are detected, not just BIP39/24", async () => {
    const candidate = makeAccount({
      id: "chainweaver-gated",
      name: "ChainweaverGated",
      secret: await encryptStringV2(VALID_12_CHAINWEAVER, GATE_PW),
    });
    await renderGatingProbe(candidate);

    const item = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-chainweaver-gated",
    );
    expect(within(item).queryByText("No known words")).toBeNull();
    expect(within(item).queryByText("Recommended")).toBeNull();
  });

  it("the manual \"Not dictionary-gated? Mark it\" button is gone entirely — the codex detects gating itself now", async () => {
    const candidate = makeAccount({
      id: "no-manual-button",
      name: "NoManualButton",
      originSeedTab: "24-words",
      secret: await encryptStringV2(VALID_24_KOALA, GATE_PW),
    });
    await renderGatingProbe(candidate);

    const item = await screen.findByTestId(
      "legacy-prime-migration-account-existing-item-no-manual-button",
    );
    expect(within(item).queryByText("No known words")).toBeNull();
    expect(within(item).queryByText("Not dictionary-gated? Mark it")).toBeNull();
  });
});

/**
 * Page 3 ("keys") — corrected by T6 (Wave 4). Per `legacy-prime-migration-
 * wizard/design.md`'s rewritten "Page 3" section: the words are NEVER
 * re-chosen here — Page 3 is purely a derivation-METHOD choice applied to
 * whichever words back the Page-2 account. There is no longer an "accept
 * the existing keys, unchanged" branch at all (every path derives keys from
 * the Page-2 words via one of two methods):
 *   1. Stoic Dalos Derivation — always available, always the default.
 *   2. Advanced (native format) derivation — offered ONLY when the
 *      Page-2-chosen account's own `originSeedTab` is `"12-words"` or
 *      `"24-words"` (dictionary-gated) — never for `"write-seed"` or
 *      freshly-typed words.
 */
describe("LegacyPrimeMigrationWizard — Page 3 (\"keys\"): the derivation-method choice", () => {
  /** Drives the wizard from "intro" through "account" (choosing the Page 2
   *  option-2 "existing" candidate with the given `originSeedTab`) into
   *  "keys". */
  function openKeysStepFromExisting(originSeedTab: "write-seed" | "12-words" | "24-words", onStateChange?: (state: unknown) => void) {
    const candidate = makeAccount({ id: "candidate-1", name: "Candidate Account", originSeedTab });
    openAccountStep({ allAccounts: [candidate], onStateChange });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-1"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  /** Drives the wizard into "keys" via Page 2 option 1 ("keep current"),
   *  with the current account's own `originSeedTab` set as given. */
  function openKeysStepFromKeepCurrent(originSeedTab?: "write-seed" | "12-words" | "24-words", onStateChange?: (state: unknown) => void) {
    const current = makeAccount({ id: "current-1", originSeedTab });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current], onStateChange });
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  /** Drives the wizard into "keys" via Page 2 option 3 ("type new words"),
   *  typing real words first so the words-display tests below have real
   *  plaintext to assert against. */
  function openKeysStepFromNewWords(onStateChange?: (state: unknown) => void) {
    openAccountStep({ allAccounts: [], onStateChange });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-account-new-words-input"), {
      target: { value: "alpha beta gamma" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  it("clicking Continue on the account step (with a choice made) navigates to the keys step", () => {
    openKeysStepFromExisting("write-seed");

    expect(screen.queryByTestId("legacy-prime-migration-account")).toBeNull();
    expect(screen.getByTestId("legacy-prime-migration-keys")).toBeTruthy();
  });

  it("selecting an account whose originSeedTab is \"12-words\" via option 2, then viewing Step 3, shows BOTH derivation options (Stoic Dalos AND Advanced)", () => {
    openKeysStepFromExisting("12-words");

    expect(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).toBeTruthy();
  });

  it("selecting an account whose originSeedTab is \"24-words\" via option 2 ALSO offers the Advanced option", () => {
    openKeysStepFromExisting("24-words");

    expect(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).toBeTruthy();
  });

  it("selecting an account whose originSeedTab is \"write-seed\" via option 2 shows ONLY Stoic Dalos — the Advanced option is entirely absent from the DOM", () => {
    openKeysStepFromExisting("write-seed");

    expect(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-keys-option-advanced")).toBeNull();
  });

  it("'type new words' (option-3 freshly-typed words) shows ONLY Stoic Dalos — the Advanced option is entirely absent from the DOM", () => {
    openKeysStepFromNewWords();

    expect(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-keys-option-advanced")).toBeNull();
  });

  it("'keep current' with a dictionary-gated current account (\"12-words\") offers the Advanced option too", () => {
    openKeysStepFromKeepCurrent("12-words");

    expect(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).toBeTruthy();
  });

  it("'keep current' with a write-seed-origin current account shows ONLY Stoic Dalos", () => {
    openKeysStepFromKeepCurrent("write-seed");

    expect(screen.queryByTestId("legacy-prime-migration-keys-option-advanced")).toBeNull();
  });

  it("selecting Stoic Dalos marks it active/selected and clears the other option's selected state", () => {
    openKeysStepFromExisting("12-words");

    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByRole("button", {
        name: /stoic dalos/i,
      }),
    );

    expect(
      screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos").getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("legacy-prime-migration-keys-option-advanced").getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("selecting Advanced marks it active/selected", () => {
    openKeysStepFromExisting("12-words");

    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).getByRole("button", {
        name: /advanced/i,
      }),
    );

    expect(
      screen.getByTestId("legacy-prime-migration-keys-option-advanced").getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("whenever Stoic Dalos is active for 'type new words', the ACTUAL typed words and 'Stoic Dalos Derivation' are both shown (in the words/derivation transparency block)", () => {
    openKeysStepFromNewWords();

    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByRole("button", {
        name: /stoic dalos/i,
      }),
    );

    const wordsBlock = screen.getByTestId("legacy-prime-migration-keys-words-block");
    expect(within(wordsBlock).getByText("Stoic Dalos Derivation")).toBeTruthy();
    expect(within(wordsBlock).getByText(/alpha beta gamma/)).toBeTruthy();
  });

  it("whenever Stoic Dalos is active for 'keep current', 'Stoic Dalos Derivation' is visible but the actual words are NOT re-displayed — a reference is shown instead", () => {
    openKeysStepFromKeepCurrent("write-seed");

    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByRole("button", {
        name: /stoic dalos/i,
      }),
    );

    const wordsBlock = screen.getByTestId("legacy-prime-migration-keys-words-block");
    expect(within(wordsBlock).getByText("Stoic Dalos Derivation")).toBeTruthy();
    expect(within(wordsBlock).getByText(/current account's words/i)).toBeTruthy();
  });

  it("whenever Advanced is active, 'Advanced (native format) derivation' is named as the derivation path (in the words/derivation transparency block)", () => {
    openKeysStepFromExisting("12-words");

    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).getByRole("button", {
        name: /advanced/i,
      }),
    );

    const wordsBlock = screen.getByTestId("legacy-prime-migration-keys-words-block");
    expect(within(wordsBlock).getByText("Advanced (native format) derivation")).toBeTruthy();
    expect(within(wordsBlock).queryByText("Stoic Dalos Derivation")).toBeNull();
  });
});

/**
 * Post-build fix round (owner clicked through the wizard on localhost,
 * `apps/codex-playground`, and reported 4 concrete gaps) — Fix 1: a visible
 * step indicator. The owner's own complaint was "I can't see which page I'm
 * on" — this suite's regression is exactly that: the subtitle must actually
 * change text as `step` changes, not just render SOME static string once.
 */
describe("LegacyPrimeMigrationWizard — Fix 1: step indicator", () => {
  it("shows a 'Step 1 of 4' indicator naming the intro step, then updates through account, payment, guard and review", () => {
    // "payment"/"guard" show "Step 3A of 4"/"Step 3B of 4" — two SCREENS,
    // one conceptual "step 3" (owner correction, this session: "made step
    // 3A and step 3B as individual steps, not both on the same step 3
    // page") — so "review" is still "Step 4 of 4", not "Step 5 of 5".
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[account]} />);

    expect(screen.getByText(/step 1 of 4/i)).toBeTruthy();
    expect(screen.queryByText(/step 2 of 4/i)).toBeNull();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 2 of 4/i)).toBeTruthy();
    expect(screen.queryByText(/step 1 of 4/i)).toBeNull();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-account-1"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 3a of 4/i)).toBeTruthy();
    expect(screen.queryByText(/step 2 of 4/i)).toBeNull();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 3b of 4/i)).toBeTruthy();
    expect(screen.queryByText(/step 3a of 4/i)).toBeNull();
  });
});

/**
 * Owner, this session: *"the prev next buttons, have to also be placed on
 * top... they have to stay fixed there, even if i scroll... so theyre
 * always there for pressing."* A second Back/Continue row, sticky to the
 * top of the modal's own scrolling card, alongside the original bottom
 * row — not a replacement for it.
 */
describe("LegacyPrimeMigrationWizard — sticky top nav (owner-requested)", () => {
  it("renders BOTH a top and a bottom nav row on a normal step", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    expect(screen.getByTestId("legacy-prime-migration-nav-top")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-nav")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-continue-top")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-continue")).toBeTruthy();
  });

  it("the top row is CSS-sticky to the top of the scrolling card, the bottom row is not", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    const top = screen.getByTestId("legacy-prime-migration-nav-top") as HTMLElement;
    const bottom = screen.getByTestId("legacy-prime-migration-nav") as HTMLElement;
    expect(top.style.position).toBe("sticky");
    expect(top.style.top).toBe("0px");
    expect(bottom.style.position).not.toBe("sticky");
  });

  it("clicking the TOP Continue does exactly what the bottom one does", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    expect(screen.getByText(/step 1 of 4/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top"));
    expect(screen.getByText(/step 2 of 4/i)).toBeTruthy();
  });

  it("clicking the TOP Back does exactly what the bottom one does", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top"));
    expect(screen.getByText(/step 2 of 4/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back-top"));
    expect(screen.getByText(/step 1 of 4/i)).toBeTruthy();
  });

  it("the TOP Back button is absent on intro, same as the bottom one", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    expect(screen.queryByTestId("legacy-prime-migration-back-top")).toBeNull();
    expect(screen.queryByTestId("legacy-prime-migration-back")).toBeNull();
  });

  it("the TOP row shows the SAME blocked reason, and disables the SAME way, as the bottom one", async () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[account]} />);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top"));
    expect(screen.getByText(/step 2 of 4/i)).toBeTruthy();

    expect((screen.getByTestId("legacy-prime-migration-continue-top") as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByTestId("legacy-prime-migration-continue-blocked-top").textContent)
      .toMatch(/ouronet codex master/i);
  });

  it("neither nav row renders once finalize is reached", async () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[account]} />);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-account-1"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top")); // -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top")); // -> guard
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top")); // -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue-top")); // -> finalize
    await waitFor(() => {
      expect(screen.queryByTestId("legacy-prime-migration-nav-top")).toBeNull();
    });
    expect(screen.queryByTestId("legacy-prime-migration-nav")).toBeNull();
  });
});

/**
 * Fix 3: the rendered options never showed the numbering `design.md`'s own
 * Page 2/Page 3 sections already use ("1. Keep ... 2. Choose ... 3. Type
 * ..."). Regression: without a visible number, a user reading the design
 * doc (or a support conversation referencing "option 2") has no way to map
 * that back onto what's on screen. Numbering is FIXED per option identity,
 * never renumbered to fill a gap left by a hidden option — verified below
 * by the zero-candidates case, where "type new words" keeps "3" rather than
 * sliding up to "2".
 */
describe("LegacyPrimeMigrationWizard — Fix 3: numbered options", () => {
  it("Page 2 shows 1/2/3 on keep/existing/new when all three options are present", () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    openAccountStep({ allAccounts: [account] });

    expect(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByText("1"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("legacy-prime-migration-account-option-existing")).getByText("2"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("legacy-prime-migration-account-option-new")).getByText("3"),
    ).toBeTruthy();
  });

  it("Page 2, with option 2 hidden (zero existing-account candidates), still numbers 'type new words' as 3 — not renumbered to 2", () => {
    openAccountStep({ allAccounts: [] });

    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();
    expect(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByText("1"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("legacy-prime-migration-account-option-new")).getByText("3"),
    ).toBeTruthy();
  });

  it("Page 3 shows 1/2 on Stoic Dalos/Advanced when both options are present (dictionary-gated existing-account path)", () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "12-words" });
    openAccountStep({ allAccounts: [account] });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-account-1"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    expect(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByText("1"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).getByText("2"),
    ).toBeTruthy();
  });

  it("Page 3, with the Advanced option hidden ('write-seed' path), still numbers Stoic Dalos as 1", () => {
    const current = makeAccount({ id: "current-1", originSeedTab: "write-seed" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    expect(screen.queryByTestId("legacy-prime-migration-keys-option-advanced")).toBeNull();
    expect(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByText("1"),
    ).toBeTruthy();
  });
});

/**
 * Post-build fix round, Issue 4 — the owner reported no way back once past
 * Page 1: "Continue" existed everywhere, but nothing undid it. Regression
 * this guards: a user who overshoots (picks the wrong account/keys option)
 * had no in-wizard way back to reconsider, other than closing the whole
 * wizard and losing every selection made so far.
 */
describe("LegacyPrimeMigrationWizard — Issue 4: Back/Continue navigation", () => {
  it("Page 1 ('intro') shows no 'Back' button", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} />);
    expect(screen.queryByTestId("legacy-prime-migration-back")).toBeNull();
  });

  it("Page 2 ('account') shows a 'Back' button that returns to Page 1's content", () => {
    openAccountStep();
    expect(screen.getByTestId("legacy-prime-migration-back")).toBeTruthy();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-back"));
    expect(screen.getByTestId("legacy-prime-migration-intro")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-account")).toBeNull();
  });

  it("Page 3 ('keys') shows a 'Back' button that returns to Page 2's content", () => {
    openAccountStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByTestId("legacy-prime-migration-keys")).toBeTruthy();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-back"));
    expect(screen.getByTestId("legacy-prime-migration-account")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-keys")).toBeNull();
  });

  it("going Back from Page 2 to Page 1 and forward again preserves the already-made account choice", () => {
    openAccountStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    expect(
      screen.getByTestId("legacy-prime-migration-account-option-keep").getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-back"));
    expect(screen.getByTestId("legacy-prime-migration-intro")).toBeTruthy();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByTestId("legacy-prime-migration-account")).toBeTruthy();
    expect(
      screen.getByTestId("legacy-prime-migration-account-option-keep").getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("going Back from Page 3 to Page 2 and forward again preserves the already-made keys choice", () => {
    openAccountStep();
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
    expect(
      screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos").getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-back"));
    expect(screen.getByTestId("legacy-prime-migration-account")).toBeTruthy();
    // The account choice made before going forward the first time is also
    // still intact.
    expect(
      screen.getByTestId("legacy-prime-migration-account-option-keep").getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByTestId("legacy-prime-migration-keys")).toBeTruthy();
    expect(
      screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos").getAttribute("aria-selected"),
    ).toBe("true");
  });
});

/**
 * Fix 4: the owner compared this wizard to OuronetUI's own onboarding seed
 * input, which shows a live Ouronet-account + key preview as soon as valid
 * words are typed — this wizard's "type new words" option had nothing at
 * all. Regression this guards: a user typing brand-new words gets NO
 * feedback about what account/keys they're about to create until they've
 * already clicked through to later pages — exactly the complaint.
 *
 * Mirrors `zbom-debouncer.test.ts`'s own established fake-timer debounce
 * pattern (`vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync(ms)` inside
 * `act`) since this file's own existing debounced-preview precedent
 * (`CreateStoaChainSeedModal.tsx`'s Key #0 preview) has no actual debounce
 * to mirror timing-wise (it derives synchronously, no `setTimeout`).
 */
describe("LegacyPrimeMigrationWizard — Fix 4: live Ouronet account + key preview on 'type new words'", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("before any valid words are typed, none of the three preview blocks render", () => {
    openAccountStep({ allAccounts: [] });

    expect(screen.queryByText("Ouronet Account")).toBeNull();
    expect(screen.queryByText("Position #0 Key — Payment Key Source")).toBeNull();
    expect(screen.queryByText("Position #1 Key — Ouronet Guard Source")).toBeNull();
  });

  it("typing valid new seed words shows, after the 300ms debounce, the Ouronet account address and both derived keys — computed via the exact same functions CreateStoaChainSeedModal/SpawnAccountModal already use", async () => {
    openAccountStep({ allAccounts: [] });

    const words = ["alpha", "beta", "gamma"];
    fireEvent.change(screen.getByTestId("legacy-prime-migration-account-new-words-input"), {
      target: { value: words.join(" ") },
    });

    // Not yet — the debounce hasn't elapsed.
    expect(screen.queryByText("Ouronet Account")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Independently computed expected values, via the EXACT functions the
    // component itself must call (not a reimplementation of the pipeline).
    const bitString = seedWordsToBitString(words);
    const expectedAccount = createOuronetAccount(createDefaultRegistry(), {
      mode: "seedWords",
      data: words,
    });
    const expectedKey0 = deriveStoaDalosKeypairAtIndex(bitString, 0);
    const expectedKey1 = deriveStoaDalosKeypairAtIndex(bitString, 1);

    // UPDATED (post-build fix round, Issues 2/3): each value below now
    // renders through this package's existing measured-width truncation
    // primitives (`OuronetAddressHighlight`/`MeasuredHexHighlight` — see
    // the dedicated "Issues 2/3 regression" test below for why), which
    // split the value's characters across several colored `<span>`s for
    // the edge-highlight treatment. A plain `getByText(fullValue)` no
    // longer matches (the DOM's own error here is explicit: "the text is
    // broken up by multiple elements") — asserting against each
    // component's own `title` attribute (always the full, un-truncated
    // value, regardless of how the visible text got split/shortened) is
    // this file's own replacement signal, not a weakening of the
    // assertion: the FULL value is still verified, just via the attribute
    // that survives truncation instead of `textContent`.
    expect(screen.getByText("Ouronet Account")).toBeTruthy();
    expect(screen.getByTitle(expectedAccount.standardAddress)).toBeTruthy();

    expect(screen.getByText("Position #0 Key — Payment Key Source")).toBeTruthy();
    expect(screen.getByTitle(expectedKey0.publicKey)).toBeTruthy();
    expect(screen.getByTitle(`k:${expectedKey0.publicKey}`)).toBeTruthy();

    expect(screen.getByText("Position #1 Key — Ouronet Guard Source")).toBeTruthy();
    expect(screen.getByTitle(expectedKey1.publicKey)).toBeTruthy();
  });

  /**
   * Post-build fix round, Issues 2/3 — the owner's screenshot showed this
   * exact preview block overflowing horizontally with a visible scrollbar,
   * untruncated raw hex. Fixed by rendering every long hex/address value
   * through this package's OWN already-established measured-width
   * truncation primitives (`OuronetAddressHighlight`/`MeasuredHexHighlight`,
   * `src/ui/internal/`) — reused, not reinvented (this package already had
   * these; a brand-new `AddressChip` would have duplicated them). Both
   * primitives always set a `title` attribute to the FULL, un-truncated
   * value (their own established convention, used as the regression
   * signal here: jsdom's `clientWidth` is always 0, so these components
   * can never actually truncate in a test, but `title` is set
   * unconditionally regardless of measured width) — a reasonable proxy for
   * "this component is actually in the render tree wrapping this value",
   * per this task's own acceptance-criterion wording.
   */
  it("Issues 2/3 regression: the live preview's Ouronet Account address, both derived keys, and the k: account line all render through the existing truncation primitives (title attribute === the full value)", async () => {
    openAccountStep({ allAccounts: [] });

    const words = ["alpha", "beta", "gamma"];
    fireEvent.change(screen.getByTestId("legacy-prime-migration-account-new-words-input"), {
      target: { value: words.join(" ") },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const bitString = seedWordsToBitString(words);
    const expectedAccount = createOuronetAccount(createDefaultRegistry(), {
      mode: "seedWords",
      data: words,
    });
    const expectedKey0 = deriveStoaDalosKeypairAtIndex(bitString, 0);
    const expectedKey1 = deriveStoaDalosKeypairAtIndex(bitString, 1);

    expect(screen.getByTitle(expectedAccount.standardAddress)).toBeTruthy();
    expect(screen.getByTitle(expectedKey0.publicKey)).toBeTruthy();
    expect(screen.getByTitle(`k:${expectedKey0.publicKey}`)).toBeTruthy();
    expect(screen.getByTitle(expectedKey1.publicKey)).toBeTruthy();
  });

  it("clearing the textarea back to empty removes all three preview blocks", async () => {
    openAccountStep({ allAccounts: [] });

    const textarea = screen.getByTestId("legacy-prime-migration-account-new-words-input");
    fireEvent.change(textarea, { target: { value: "alpha beta gamma" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText("Ouronet Account")).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "" } });
    expect(screen.queryByText("Ouronet Account")).toBeNull();
  });
});

/**
 * Page 7 ("finalize") — T8, Wave 5. Per `legacy-prime-migration-wizard/
 * design.md`'s "Page 7 — Finalize" section and `plan.md`'s T8: reaching
 * "finalize" (Step 3's real "Continue") calls the store's
 * `ensurePrimeSeedAccountPairingAndPromote` (T7) for real, and — ONLY when
 * its `sweepNeeded` comes back `false` — the optional `ensurePrimeArweaveSeed`
 * prop, then `stampPrimeAlignmentAligned()`.
 *
 * Mounted over a REAL store + `MemoryCodexAdapter` (same `<CodexProvider>` +
 * `StoreGrabber` convention `tests/ui-structural-upgrade-wizard.test.tsx`
 * already established), since this is the first part of the wizard that
 * genuinely calls store actions rather than being pure selection UI — a
 * mocked store here would prove nothing about the REAL wiring these tests
 * exist to catch regressions in.
 */
describe("LegacyPrimeMigrationWizard — Page 7 (\"finalize\")", () => {
  const FINALIZE_PASSWORD = "legacy-prime-migration-finalize-test-pw";
  const FINALIZE_WORDS = ["alpha", "beta", "gamma"];
  const FINALIZE_BIT_STRING = seedWordsToBitString(FINALIZE_WORDS);

  // The kickstart pair every fixture below bootstraps the store with FIRST
  // — mirrors `tests/state-legacy-prime-migration-finalize.test.ts`'s own
  // `kickstart()` convention exactly, so the Finalize target account (added
  // SECOND, via `addOuroAccount`) is never auto-primed by that action's own
  // "first account" rule.
  const kickstartSeed = () => ({
    id: "finalize-kickstart-seed",
    name: "Kickstart Seed",
    seedType: "koala" as const,
    version: "1.0.0",
    index: 0,
    secret: "encrypted-secret",
    main: "k:" + "0".repeat(64),
    createdAt: "2026-05-24T10:00:00.000Z",
    accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/44'/626'/0'/0/0" }],
  });
  const kickstartOuro = () =>
    makeAccount({ id: "finalize-kickstart-ouro", name: "Kickstart Ouro" });

  let capturedStore: ReturnType<typeof useCodexStore> | null = null;
  function FinalizeStoreGrabber() {
    capturedStore = useCodexStore();
    return null;
  }

  /** Renders the wizard over a fresh, real `MemoryCodexAdapter`-backed
   *  store, waits for it to be ready, then kickstarts + adds `targetAccount`
   *  + authenticates — the real, store-level equivalent of
   *  `openAccountStep`'s prop-only setup above. Returns the captured store
   *  so a test can read `primeAlignment`/`kadenaSeeds`/`ouroAccounts`
   *  afterward. */
  async function renderFinalizeWizard(
    targetAccount: IOuroAccount,
    props: Partial<Parameters<typeof LegacyPrimeMigrationWizard>[0]> = {},
  ): Promise<NonNullable<typeof capturedStore>> {
    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <FinalizeStoreGrabber />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={targetAccount}
          allAccounts={[targetAccount]}
          {...props}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    await act(async () => {
      await capturedStore!.getState().actions.kickstartCodex({
        seed: kickstartSeed(),
        primeOuroAccount: kickstartOuro(),
      });
    });
    await act(async () => {
      await capturedStore!.getState().actions.addOuroAccount(targetAccount);
    });
    act(() => {
      capturedStore!.getState().actions.authenticate(FINALIZE_PASSWORD, 60);
    });
    return capturedStore!;
  }

  /** Drives the wizard intro -> account ("keep current") -> payment (3A,
   *  "Stoic Dalos Derivation") -> guard (3B) -> review -> finalize (real
   *  "Continue", T8). Payment and guard are separate pages now (owner
   *  correction, this session), each with its own Continue click. */
  function driveToFinalizeViaKeepCurrent(): void {
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
    // Step 3 now settles TWO real decisions across TWO pages, and each
    // page's Continue is gated on its own. Gating on the derivation method
    // alone made "keep the payment key" a dead end, so the helper has to
    // make both choices like a user does.
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-recommended")).getByRole("button"),
    );
    // guard -> REVIEW (writes nothing), then review -> commit. Continue no
    // longer commits straight from the guard step.
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  it("a fixture needing a guard rotation still becomes ELIGIBLE, and reports the rotation as outstanding rather than blocking on it", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const targetAccount = makeAccount({
      id: "finalize-target-sweep-needed",
      originSeedTab: "write-seed",
      guard: null, // mismatched — guarantees guardRotationNeeded: true, same as T7's own suite.
      secret,
    });
    // The ArWeave seed IS the one real precondition for eligibility (without
    // it there is no prime ArWeave address to compare against), so this
    // fixture supplies it. The old guard-mismatch bail fired before the
    // ArWeave step and masked that — part of why the ordering was wrong.
    const store = await renderFinalizeWizard(targetAccount, {
      ensurePrimeArweaveSeed: async () => {},
    });

    driveToFinalizeViaKeepCurrent();

    // CHANGED DELIBERATELY. This used to assert a dead end: the old code
    // bailed on the guard comparison BEFORE the local writes, so the Codex
    // Master Seed row and the locks were never written, and the account was
    // never promoted — which made eligibility unreachable here.
    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );
    expect(screen.getByTestId("legacy-prime-migration-finalize-close")).toBeTruthy();

    // Every local write LANDED...
    expect(store.getState().codexMasterSeed).toBeTruthy();
    expect(store.getState().masterKeyLocks.length).toBeGreaterThan(0);

    // ...the account was PROMOTED despite the guard not matching (the gate
    // that used to make eligibility unreachable here)...
    expect(store.getState().ouroAccounts.some((a) => a.isPrime)).toBe(true);

    // ...and ELIGIBILITY IS STAMPED. It is a structural property of the
    // codex: `checkArweaveRestoreEligibility` derives an ArWeave address
    // from the prime account's bitstring and compares it to the stored
    // prime one. No chain read, no guard, no funds.
    expect(store.getState().primeAlignment).toBe("aligned");

    // The chosen key changes are reported as OPTIONAL and outstanding, and
    // the recorded run survives so stage 3A can apply them later.
    expect(store.getState().migrationProgress).toBeTruthy();
    const outstanding = screen.getByTestId("legacy-prime-migration-commit-outstanding").textContent ?? "";
    expect(outstanding).toMatch(/OPTIONAL/i);
    expect(outstanding).toMatch(/not on chain yet/i);
    expect(outstanding).toMatch(/old keys keep working/i);
  });

  it("a fixture that resolves guardRotationNeeded: false, with ensurePrimeArweaveSeed resolving, reaches the success screen and stamps primeAlignment \"aligned\"", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const key0 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0);
    const key1 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1);
    const targetAccount = makeAccount({
      id: "finalize-target-success",
      originSeedTab: "write-seed",
      // Exactly matches what the Stoic Dalos derivation at positions 0/1
      // produces for these words — guarantees guardRotationNeeded: false, same as
      // T7's own suite.
      guard: { pred: "keys-all", keys: [key0.publicKey, key1.publicKey] },
      secret,
    });
    const ensurePrimeArweaveSeed = vi.fn().mockResolvedValue(undefined);
    const store = await renderFinalizeWizard(targetAccount, { ensurePrimeArweaveSeed });

    driveToFinalizeViaKeepCurrent();

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
    );
    expect(screen.getByText(PRIME_TRIO_LOCKED_REMINDER_TEXT)).toBeTruthy();
    expect(ensurePrimeArweaveSeed).toHaveBeenCalledTimes(1);
    expect(ensurePrimeArweaveSeed).toHaveBeenCalledWith({
      bitString: FINALIZE_BIT_STRING,
      words: FINALIZE_WORDS,
    });
    expect(store.getState().primeAlignment).toBe("aligned");
    // The counterpart to the pending case above: with nothing outstanding,
    // alignment IS stamped and the recorded run is CLEARED — a finished
    // codex must never offer to resume a migration that already happened.
    await waitFor(() => {
      expect(store.getState().migrationProgress).toBeUndefined();
    });
    expect(store.getState().codexMasterSeed).toBeTruthy();
  });

  it("guardRotationNeeded: false but ensurePrimeArweaveSeed rejecting shows an honest not-available state, and primeAlignment stays \"legacy\" (never stamped)", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const key0 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0);
    const key1 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1);
    const targetAccount = makeAccount({
      id: "finalize-target-arweave-throws",
      originSeedTab: "write-seed",
      guard: { pred: "keys-all", keys: [key0.publicKey, key1.publicKey] },
      secret,
    });
    const ensurePrimeArweaveSeed = vi.fn().mockRejectedValue(new Error("Prime Arweave Seed derivation failed"));
    const store = await renderFinalizeWizard(targetAccount, { ensurePrimeArweaveSeed });

    driveToFinalizeViaKeepCurrent();

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-error")).toBeTruthy(),
    );
    expect(
      within(screen.getByTestId("legacy-prime-migration-finalize-error")).getByText(
        /Prime Arweave Seed derivation failed/,
      ),
    ).toBeTruthy();
    expect(store.getState().primeAlignment).toBe("legacy");
  });

  it("guardRotationNeeded: false with ensurePrimeArweaveSeed OMITTED entirely also shows an honest not-available state, and primeAlignment stays \"legacy\" (never stamped)", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const key0 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0);
    const key1 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1);
    const targetAccount = makeAccount({
      id: "finalize-target-arweave-omitted",
      originSeedTab: "write-seed",
      guard: { pred: "keys-all", keys: [key0.publicKey, key1.publicKey] },
      secret,
    });
    const store = await renderFinalizeWizard(targetAccount); // no ensurePrimeArweaveSeed prop at all

    driveToFinalizeViaKeepCurrent();

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-error")).toBeTruthy(),
    );
    expect(store.getState().primeAlignment).toBe("legacy");
  });

  // Owner, this session: "if others are kept, that key should become non
  // removable from the codex." Before this fix, `runFinalize` passed `null`
  // to `secureMasterAccount` for BOTH "keep" choices — and `null` means
  // "unresolved" there, which only suppresses RELEASING existing locks; it
  // never ADDS one. So "keep" locked nothing, on either decision, ever.
  it("choosing KEEP for both payment and guard still LOCKS the actual current keys", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const kickstartKey = kickstartSeed().accounts[0]!.publicKey; // held by the REAL kickstart seed
    const targetAccount = makeAccount({
      id: "finalize-target-keep-both",
      originSeedTab: "write-seed",
      // A real, DIRECT keyset naming a key the codex actually holds — no
      // chain read needed to resolve it, so "keep" has something concrete
      // to lock.
      guard: { pred: "keys-all", keys: [kickstartKey] },
      secret,
    });
    const store = await renderFinalizeWizard(targetAccount, {
      allSeeds: [kickstartSeed()],
      ensurePrimeArweaveSeed: async () => {},
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-keep")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-keep")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> finalize

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );

    // Both locked, under their own distinct reasons, at the SAME position —
    // this fixture deliberately points payment AND guard at the same
    // kickstart key so one assertion proves both write paths independently.
    const locks = store.getState().masterKeyLocks;
    expect(locks).toContainEqual(
      expect.objectContaining({
        seedId: "finalize-kickstart-seed", position: 0, reason: "master-payment-key",
      }),
    );
    expect(locks).toContainEqual(
      expect.objectContaining({
        seedId: "finalize-kickstart-seed", position: 0, reason: "master-guard-key",
      }),
    );
  });

  // guard-step-variants (docs/work/guard-step-variants/design.md): the three
  // newest guard kinds lock the INTENDED final key set immediately, the same
  // "lock now even though a Stage 3 transaction may still be needed" rule
  // every other not-yet-executed choice already gets (proven above for
  // "keep") — proven end-to-end here, one kind per test.
  it("choosing 'update the keyset' (Variant A, DALOS Highly Recommended) locks the SAME derived position-1 key recommended-single-key would", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const key1 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey;
    const targetAccount = makeAccount({
      id: "finalize-target-update-keyset-recommended",
      originSeedTab: "write-seed",
      // A keyset REFERENCE — Variant A, so the guard page offers "update
      // the keyset" at all.
      guard: { keysetref: { ns: "ouronet-ns", ksn: "owner-keyset" } } as unknown as IOuroAccount["guard"],
      secret,
    });
    const store = await renderFinalizeWizard(targetAccount, {
      ensurePrimeArweaveSeed: async () => {},
      describeKeyset: async () => ({ keys: ["7".repeat(64)], pred: "keys-all" }),
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-option-update-keyset");
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-update-keyset")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> finalize

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );

    expect(store.getState().masterKeyLocks).toContainEqual(
      expect.objectContaining({ position: 1, reason: "master-guard-key" }),
    );
    const lockedSeed = store.getState().kadenaSeeds.find((s) =>
      s.accounts?.some((a) => a.index === 1 && a.publicKey === key1),
    );
    expect(lockedSeed).toBeTruthy();
  });

  it("choosing a CUSTOM 'update the keyset' guard (3A) locks the CHOSEN key, not a derived one", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const targetAccount = makeAccount({
      id: "finalize-target-update-keyset-custom",
      originSeedTab: "write-seed",
      guard: { keysetref: { ns: "ouronet-ns", ksn: "owner-keyset" } } as unknown as IOuroAccount["guard"],
      secret,
    });
    const store = await renderFinalizeWizard(targetAccount, {
      allSeeds: [kickstartSeed()],
      ensurePrimeArweaveSeed: async () => {},
      describeKeyset: async () => ({ keys: ["7".repeat(64)], pred: "keys-all" }),
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> finalize

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );

    expect(store.getState().masterKeyLocks).toContainEqual(
      expect.objectContaining({
        seedId: "finalize-kickstart-seed", position: 0, reason: "master-guard-key",
      }),
    );
  });

  it("resolving an EXISTING keyset as the guard (Variant B, 3B) locks the keys describeKeyset returned", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const kickstartKey = kickstartSeed().accounts[0]!.publicKey;
    const targetAccount = makeAccount({
      id: "finalize-target-use-existing-keyset",
      originSeedTab: "write-seed",
      guard: null, // Variant B
      secret,
    });
    const describeKeyset = vi.fn(async () => ({ keys: [kickstartKey], pred: "keys-all" }));
    const store = await renderFinalizeWizard(targetAccount, {
      allSeeds: [kickstartSeed()],
      ensurePrimeArweaveSeed: async () => {},
      describeKeyset,
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));

    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ns"), {
      target: { value: "ouronet-ns" },
    });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "owner-made-keyset" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));
    await screen.findByTestId("legacy-prime-migration-guard-existing-resolved");

    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> finalize

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );

    expect(store.getState().masterKeyLocks).toContainEqual(
      expect.objectContaining({
        seedId: "finalize-kickstart-seed", position: 0, reason: "master-guard-key",
      }),
    );
  });

  // review.md (deferred finding #3): a "use-existing-keyset" choice names
  // an EXTERNAL, independently-mutable on-chain keyset — its resolved
  // `keys` snapshot can be stale by the time Finalize actually locks it.
  // This proves a keyset that has since DRIFTED (describeKeyset now
  // returns something different from what was resolved at selection time)
  // is NOT locked using the stale snapshot — it is treated as unresolved.
  it("a 'use an existing keyset' choice that has DRIFTED by Finalize time is never locked using the stale snapshot", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const kickstartKey = kickstartSeed().accounts[0]!.publicKey;
    const targetAccount = makeAccount({
      id: "finalize-target-use-existing-keyset-drifted",
      originSeedTab: "write-seed",
      guard: null, // Variant B
      secret,
    });
    // First call (selection time, via "Resolve") returns `kickstartKey`;
    // every call AFTER that (Finalize's own re-verification) returns a
    // DIFFERENT key — simulating the on-chain keyset having been updated
    // in the meantime.
    const driftedKey = "c".repeat(64);
    let callCount = 0;
    const describeKeyset = vi.fn(async () => {
      callCount += 1;
      return callCount === 1 ? { keys: [kickstartKey], pred: "keys-all" } : { keys: [driftedKey], pred: "keys-all" };
    });
    const store = await renderFinalizeWizard(targetAccount, {
      allSeeds: [kickstartSeed()],
      ensurePrimeArweaveSeed: async () => {},
      describeKeyset,
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));

    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ns"), {
      target: { value: "ouronet-ns" },
    });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "owner-made-keyset" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));
    await screen.findByTestId("legacy-prime-migration-guard-existing-resolved");

    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> finalize

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );

    // The stale key (resolved at selection time) must NOT have been
    // locked — the re-check at Finalize caught the drift.
    expect(store.getState().masterKeyLocks).not.toContainEqual(
      expect.objectContaining({
        seedId: "finalize-kickstart-seed", position: 0, reason: "master-guard-key",
      }),
    );
  });

  // review.md (deferred findings #1/#4): "keep" used to resolve/lock
  // `currentPrimeAccount`'s guard unconditionally — but Page 2's "choose an
  // existing account" option lets the user promote a DIFFERENT account.
  // This proves guard "keep" now locks the CHOSEN account's own real guard
  // (not the old current account's), and does so freshly at Finalize time
  // rather than trusting a stale step-mount snapshot.
  it("guard 'keep' locks the CHOSEN existing account's own guard, never the old current account's, when Page 2's 'existing account' option is used", async () => {
    const secondSeed = () => ({
      id: "finalize-second-seed", name: "Second Seed", seedType: "koala" as const,
      version: "1.0.0", index: 1, secret: "encrypted-secret",
      main: "k:" + "1".repeat(64), createdAt: "2026-05-24T10:05:00.000Z",
      accounts: [{ index: 0, publicKey: "b".repeat(64), derivationPath: "m/44'/626'/1'/0/0" }],
    });
    const SECOND_KEY = secondSeed().accounts[0]!.publicKey;
    const kickstartKey = kickstartSeed().accounts[0]!.publicKey;

    // The OLD current account — its guard names `kickstartKey`. If "keep"
    // ever resolves against THIS account instead of the chosen one, this
    // key would wrongly get locked as the guard.
    const wrongSecret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const currentAccount = makeAccount({
      id: "finalize-old-current", originSeedTab: "write-seed",
      guard: { pred: "keys-all", keys: [kickstartKey] },
      secret: wrongSecret,
    });

    // The NEWLY-chosen existing account — its OWN real guard names
    // `SECOND_KEY`. This is the one that must actually get locked.
    const CHOSEN_WORDS = ["delta", "epsilon", "zeta"];
    const chosenSecret = await encryptStringV2(CHOSEN_WORDS.join(" "), FINALIZE_PASSWORD);
    const chosenAccount = makeAccount({
      id: "finalize-chosen-existing", originSeedTab: "write-seed",
      guard: { pred: "keys-all", keys: [SECOND_KEY] },
      secret: chosenSecret,
    });

    const store = await renderFinalizeWizard(currentAccount, {
      allAccounts: [currentAccount, chosenAccount],
      ensurePrimeArweaveSeed: async () => {},
    });
    await act(async () => {
      await store.getState().actions.addOuroAccount(chosenAccount);
      await store.getState().actions.addStoaChainSeed(secondSeed());
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      await screen.findByTestId("legacy-prime-migration-account-existing-item-finalize-chosen-existing"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-keep")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> finalize

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );

    const locks = store.getState().masterKeyLocks;
    expect(locks).toContainEqual(
      expect.objectContaining({
        seedId: "finalize-second-seed", position: 0, reason: "master-guard-key",
      }),
    );
    expect(locks).not.toContainEqual(
      expect.objectContaining({
        seedId: "finalize-kickstart-seed", position: 0, reason: "master-guard-key",
      }),
    );
  });

  // review.md (deferred finding #5, unrelated to guard-step-variants but
  // repaired alongside it): once Stage 1 is already recorded (account +
  // payment + guard all chosen), revising the account choice alone used to
  // leave the OLD account id persisted — `handleChooseAccount` never
  // called `recordSelectionIfComplete`, unlike the payment/guard handlers.
  it("revising the account choice after Stage 1 is already recorded re-persists the NEW account, not the old one", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const accountA = makeAccount({ id: "finalize-revise-a", originSeedTab: "write-seed", secret });
    const accountB = makeAccount({ id: "finalize-revise-b", originSeedTab: "write-seed", secret });
    const store = await renderFinalizeWizard(accountA, { allAccounts: [accountA, accountB] });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      within(await screen.findByTestId("legacy-prime-migration-account-option-keep")).getByRole("button", {
        name: /keep your current account/i,
      }),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    // An explicit payment click is what actually COMPLETES and records
    // Stage 1 for the first time (an established invariant: arriving at a
    // page via Continue alone, with only its pre-selected default, never
    // records anything on its own — only an explicit onChoose call does).
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");

    await waitFor(() => {
      expect(store.getState().migrationProgress?.selection?.account).toEqual({ kind: "keep-current" });
    });

    // Go back to the account page and switch to the OTHER account — payment
    // and guard are left untouched (both already complete, non-default
    // clicks not required for either).
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back")); // guard -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back")); // payment -> account
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-account-existing-item-finalize-revise-b"));

    await waitFor(() => {
      expect(store.getState().migrationProgress?.selection?.account).toEqual({
        kind: "existing", accountId: "finalize-revise-b",
      });
    });
  });
});
