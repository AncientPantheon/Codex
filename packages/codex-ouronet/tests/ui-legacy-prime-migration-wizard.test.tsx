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
import { render, screen, within, fireEvent, act, waitFor, cleanup } from "@testing-library/react";

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
// The wizard OWNS this contract (codex-arweave's provider satisfies it
// structurally — codex-ouronet must not import that package, which depends on
// this one). Typing the progress stubs against it is what keeps these tests
// honest about the payload the real derivation sends.
import type { ArweaveDerivationProgress } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
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

// `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "E": every group
// inside the custom guard editor starts collapsed unless it already holds a
// selected key, so a row inside a given group is only queryable/clickable
// once that group's own disclosure header has been opened.
function expandGroup(editor: HTMLElement, n: number) {
  fireEvent.click(within(editor).getByTestId(`legacy-prime-migration-guard-custom-group-${n}`));
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
      "once this completes, your Codex Ouronet Master, Master Chainweb Seed, and Master ArWeave Seed are locked — permanently.",
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
    // shown as its own unmistakable chip (bullet + name + curve badge),
    // the SAME visual language Option 2's candidates use. `wizard-page2-
    // and-dashboard-fixes` (this round): the prose sentence that USED to
    // repeat the name a second time (plus a separate "its Chainweb seed"
    // mention) is condensed to a plain "No identity change." — the chip
    // alone is now this option's one unambiguous identity source.
    const chip = within(keepOption).getByTestId("legacy-prime-migration-account-keep-chip");
    expect(within(chip).getByText("Codex Ouronet Master")).toBeTruthy();
    expect(within(chip).getByText("DALOS")).toBeTruthy();
    expect(within(keepOption).getByText("No identity change.")).toBeTruthy();
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
    // The address renders TWICE: the chip's name-slot fallback (no
    // `.name`) and the chip's own dedicated address line underneath
    // (round 6, shown for every entry) — the prose sentence's own
    // fallback mention is gone (`wizard-page2-and-dashboard-fixes`:
    // condensed to a plain "No identity change.", no account reference
    // left in it at all).
    expect(within(keepOption).getAllByTitle("Ѻ.realaccountaddress").length).toBe(2);
    const chip = within(keepOption).getByTestId("legacy-prime-migration-account-keep-chip");
    expect(within(chip).getAllByTitle("Ѻ.realaccountaddress").length).toBe(2);
    expect(within(keepOption).getByText("No identity change.")).toBeTruthy();
  });

  it('option 1 shows the literal "CodexPrime" label when the current account IS the array\'s index-0 account, even if its own stored .name is something else entirely (e.g. "Initial Seed") — mirrors OuronetAccountsTab.tsx\'s own index-0 rule exactly', () => {
    // This is the owner's exact real-data bug: a real/imported first
    // account can carry a stale/unrelated `.name` (here literally "Initial
    // Seed", matching their real screenshot) — `OuronetAccountsTab.tsx`
    // NEVER reads `.name` for index 0 at all, it's always "CodexPrime".
    const current = makeAccount({ id: "current-1", name: "Initial Seed" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current] });

    const keepOption = screen.getByTestId("legacy-prime-migration-account-option-keep");
    // Appears once now (the chip only) — the condensed prose line
    // (`wizard-page2-and-dashboard-fixes`) no longer repeats it.
    expect(within(keepOption).getAllByText("Codex Ouronet Master").length).toBe(1);
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

  // Owner (live testing, this round): "whatever Ouronet Account you
  // choose, it makes seed word recuperation possible, so i dont know
  // what you had to write that [warning]." This warning used to show
  // whenever the current account's own `originSeedTab === undefined` —
  // the SAME unreliable, metadata-only signal the Finalize path (see
  // `resolveFinalizeDerivation`'s own doc comment, a few hundred lines
  // below) already stopped trusting two rounds ago, for the exact same
  // reason: `originSeedTab` is a provenance tag stamped only at
  // account-SPAWN time, never derived from or verified against the
  // actual stored secret, so a missing tag is proof of nothing. On top
  // of that, this round's OWN fix made `SeedRevealModal` recover real
  // seed material for EVERY account/seed shape (seedWords, bitmap,
  // bitString, int10, int49 — see that component's own module doc) —
  // there is no longer any real account for which "no recovery is
  // possible" is a true statement. The warning is gone outright, not
  // just re-gated on a better signal.
  it("never shows a 'no known words'/'cannot restore' warning on option 1, even when the current account's own originSeedTab is undefined", () => {
    const withoutTag = makeAccount({ id: "current-1" }); // originSeedTab undefined
    openAccountStep({ currentPrimeAccount: withoutTag, allAccounts: [withoutTag] });
    expect(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).queryByRole("alert"),
    ).toBeNull();
  });

  it("never shows a 'no known words'/'cannot restore' warning on option 1, when the current account's own originSeedTab is \"write-seed\" either", () => {
    const withTag = makeAccount({ id: "current-2", originSeedTab: "write-seed" });
    openAccountStep({ currentPrimeAccount: withTag, allAccounts: [withTag] });
    expect(
      within(screen.getByTestId("legacy-prime-migration-account-option-keep")).queryByRole("alert"),
    ).toBeNull();
  });

  it("choosing option 3 (\"type new words\") always shows both warning lines, unconditionally, before any text is entered", () => {
    openAccountStep({ allAccounts: [] });

    const newOption = screen.getByTestId("legacy-prime-migration-account-option-new");
    // No text has been typed into the word-entry field yet — the warnings
    // must already be visible regardless. `wizard-page2-and-dashboard-
    // fixes` (this round) combined both warnings into ONE alert box
    // (vertical-space optimization) — both sentences' exact wording is
    // still present, just as sibling text within the same element, so
    // this checks the alert's own combined `textContent` rather than two
    // separate exact-text nodes.
    const alert = within(newOption).getByRole("alert");
    expect(alert.textContent).toContain(
      "This creates a new account that must be activated on-chain before use",
    );
    expect(alert.textContent).toContain(
      "This account starts completely empty — no funds, no history.",
    );
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
  async function openKeysStepFromExisting(originSeedTab: "write-seed" | "12-words" | "24-words", onStateChange?: (state: unknown) => void) {
    const candidate = makeAccount({ id: "candidate-1", name: "Candidate Account", originSeedTab });
    openAccountStep({ allAccounts: [candidate], onStateChange });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-candidate-1"));
    // Selecting an "existing" account kicks off an async seed-id resolution
    // (`accountSeedResolving`) that now also gates Continue itself — wait for
    // it to settle before clicking, or the click silently no-ops.
    await waitFor(() => expect(
      (screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled,
    ).toBe(false));
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

  it("clicking Continue on the account step (with a choice made) navigates to the keys step", async () => {
    await openKeysStepFromExisting("write-seed");

    expect(screen.queryByTestId("legacy-prime-migration-account")).toBeNull();
    expect(screen.getByTestId("legacy-prime-migration-keys")).toBeTruthy();
  });

  it("selecting an account whose originSeedTab is \"12-words\" via option 2, then viewing Step 3, shows BOTH derivation options (Stoic Dalos AND Advanced)", async () => {
    await openKeysStepFromExisting("12-words");

    expect(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).toBeTruthy();
  });

  it("selecting an account whose originSeedTab is \"24-words\" via option 2 ALSO offers the Advanced option", async () => {
    await openKeysStepFromExisting("24-words");

    expect(screen.getByTestId("legacy-prime-migration-keys-option-advanced")).toBeTruthy();
  });

  it("selecting an account whose originSeedTab is \"write-seed\" via option 2 shows ONLY Stoic Dalos — the Advanced option is entirely absent from the DOM", async () => {
    await openKeysStepFromExisting("write-seed");

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

  it("selecting Stoic Dalos marks it active/selected and clears the other option's selected state", async () => {
    await openKeysStepFromExisting("12-words");

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

  it("selecting Advanced marks it active/selected", async () => {
    await openKeysStepFromExisting("12-words");

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

  it("whenever Advanced is active, 'Advanced (native format) derivation' is named as the derivation path (in the words/derivation transparency block)", async () => {
    await openKeysStepFromExisting("12-words");

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
  it("shows a 'Step 1 of 5' indicator naming the intro step, then updates through account, payment, guard and review", async () => {
    // "payment"/"guard" show "Step 3A of 5"/"Step 3B of 5" — two SCREENS,
    // one conceptual "step 3" (owner correction, this session: "made step
    // 3A and step 3B as individual steps, not both on the same step 3
    // page") — so "review" is still "Step 4", not "Step 5".
    //
    // UPDATED (wizard-arweave-step T1): the TOTAL is 5 now, not 4. The
    // Arweave verification step is a genuine fifth numbered stage (its own
    // question, its own screen, its own gate), unlike 3A/3B, which are two
    // halves of one decision — so the count it is "of" really did change.
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[account]} />);

    expect(screen.getByText(/step 1 of 5/i)).toBeTruthy();
    expect(screen.queryByText(/step 2 of 5/i)).toBeNull();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 2 of 5/i)).toBeTruthy();
    expect(screen.queryByText(/step 1 of 5/i)).toBeNull();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-account-1"));
    // Choosing an "existing" account now also gates Continue on its async
    // seed-id resolution — wait for it to settle before clicking.
    await waitFor(() => expect(
      (screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled,
    ).toBe(false));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 3a of 5/i)).toBeTruthy();
    expect(screen.queryByText(/step 2 of 5/i)).toBeNull();

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 3b of 5/i)).toBeTruthy();
    expect(screen.queryByText(/step 3a of 5/i)).toBeNull();

    // ...and through to the two steps the Arweave topic renumbered: review
    // KEEPS "4" (it was never the thing that moved), and the new Arweave
    // verification step is "5".
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    expect(screen.getByText(/step 4 of 5/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    expect(screen.getByText(/step 5 of 5 — Arweave Accounts/i)).toBeTruthy();
  });
});

/**
 * Owner, this session: *"the prev next buttons, have to also be placed on
 * top... they have to stay fixed there, even if i scroll... so theyre
 * always there for pressing."* A second Back/Continue row, sticky to the
 * top of the modal's own scrolling card, alongside the original bottom
 * row — not a replacement for it.
 */
describe("LegacyPrimeMigrationWizard — Back/Continue in the title bar (wizard-seed-dashboard-refinements)", () => {
  // owner (this round): "make back and next button part of the region
  // where the steps are presented... making the prev and next button
  // part of the title dashboard the one that presents the steps." —
  // Back/Continue now live inside the modal's OWN title bar (via
  // `CodexModalShell`'s `headerExtra` prop), which is already outside the
  // scrolling body by construction — no separate sticky rectangle is
  // needed for them anymore, so `legacy-prime-migration-nav` (the old
  // wrapping rectangle's testid) is retired; `legacy-prime-migration-
  // back`/`-continue`/`-continue-blocked` are PRESERVED on the relocated
  // elements, since dozens of other tests throughout this file call them
  // by name.
  it("renders exactly ONE Back and ONE Continue button, inside the modal's title bar", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    expect(screen.getAllByTestId("legacy-prime-migration-continue")).toHaveLength(1);
    expect(screen.queryByTestId("legacy-prime-migration-nav")).toBeNull();
  });

  it("clicking Continue advances the step", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    expect(screen.getByText(/step 1 of 5/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 2 of 5/i)).toBeTruthy();
  });

  it("clicking Back returns to the previous step", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.getByText(/step 2 of 5/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back"));
    expect(screen.getByText(/step 1 of 5/i)).toBeTruthy();
  });

  it("the Back button is absent on intro", () => {
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[]} />);
    expect(screen.queryByTestId("legacy-prime-migration-back")).toBeNull();
  });

  // owner (this round): `accountChoice` now defaults to `{kind:"keep-
  // current"}` ("no state of no account selected"), and `paymentChoice`
  // already defaulted to a real choice — so the account/payment steps can
  // no longer be "incomplete" on arrival the way this test used to reach
  // by doing nothing. The guard step's own empty-custom-keys case is
  // still genuinely reachable (a real user action, not a default), so it
  // now exercises the SAME "blocked reason shown, Continue disabled" UI
  // contract this test originally covered.
  it("the blocked-reason line shows, and disables Continue, when the guard step's custom keyset has no keys picked yet", async () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[account]} />);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    await screen.findByTestId("legacy-prime-migration-guard-custom-editor");

    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent)
      .toMatch(/select at least one key/i);
  });

  // REPLACED (wizard-arweave-step T1), deliberately and not weakened: this
  // used to walk this STORELESS wizard (no `<CodexProvider>` ancestor at
  // all) straight through to finalize and assert the nav row is gone there.
  // Finalize is no longer reachable that way — the Arweave verification step
  // cannot prove that a codex it has no connection to holds accounts #0 and
  // #1, so it blocks, which is the gate doing its job. The "no Back/Continue
  // on finalize" contract itself is now pinned where finalize IS genuinely
  // reachable, in the Page 7 suite's own success test.
  it("the walk stops at the Arweave step when there is no codex to verify against — Back/Continue stay, and say why", async () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[account]} />);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-account-1"));
    // Choosing an "existing" account now also gates Continue on its async
    // seed-id resolution — wait for it to settle before clicking.
    await waitFor(() => expect(
      (screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled,
    ).toBe(false));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // -> guard
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // -> arweave
    await screen.findByTestId("legacy-prime-migration-arweave-step");

    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(true);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    expect(screen.queryByTestId("legacy-prime-migration-finalize")).toBeNull();
    // ...and it is HONEST about why: "missing" and "couldn't be checked" are
    // different facts, and only one of them is true here.
    expect(screen.getByTestId("legacy-prime-migration-arweave-master-unresolved").textContent)
      .toMatch(/could not be run/i);
    expect(screen.getByTestId("legacy-prime-migration-back")).toBeTruthy();
  });

  // owner (this round): "In the very beginning... by default the codex
  // prime account is selected (there is no state of no account
  // selected)." — matches how `paymentChoice`/`guardChoice`/`keysChoice`
  // already default to their own recommended choice.
  it("the account step shows 'Keep your current account' selected on the VERY FIRST render, no click needed", () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "write-seed" });
    render(<LegacyPrimeMigrationWizard open onClose={() => {}} allAccounts={[account]} />);
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    expect(screen.getByTestId("legacy-prime-migration-account-option-keep").getAttribute("aria-selected"))
      .toBe("true");
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

  it("Page 3 shows 1/2 on Stoic Dalos/Advanced when both options are present (dictionary-gated existing-account path)", async () => {
    const account = makeAccount({ id: "account-1", originSeedTab: "12-words" });
    openAccountStep({ allAccounts: [account] });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-account-existing-item-account-1"));
    // Choosing an "existing" account now also gates Continue on its async
    // seed-id resolution — wait for it to settle before clicking.
    await waitFor(() => expect(
      (screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled,
    ).toBe(false));
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
  /** The adapter the current fixture's codex is PERSISTED into. Kept so a
   *  test can mount a SECOND provider over the same stored codex — the
   *  real shape of "the user closed the panel and opened the wizard again
   *  later", which `migration-pending-apply` makes a supported path. */
  let capturedAdapter: MemoryCodexAdapter | null = null;
  function FinalizeStoreGrabber() {
    capturedStore = useCodexStore();
    return null;
  }

  /** Renders the wizard over a fresh, real `MemoryCodexAdapter`-backed
   *  store, waits for it to be ready, then kickstarts + adds `targetAccount`
   *  + authenticates — the real, store-level equivalent of
   *  `openAccountStep`'s prop-only setup above. Returns the captured store
   *  so a test can read `primeAlignment`/`kadenaSeeds`/`ouroAccounts`
   *  afterward.
   *
   *  `opts.unlock` (default `true`) is what the `wizard-unlock-lifecycle`
   *  suite below turns OFF: with no `authenticate()` call the real store's own
   *  `getPassword()` throws `CodexLockedError`, exactly as it does for a real
   *  codex whose absolute unlock window closed while the user was thinking
   *  their way through this wizard. Passing a password OTHER than
   *  `FINALIZE_PASSWORD` gives the second, distinct failure: unlocked, but
   *  holding a password that decrypts nothing. */
  async function renderFinalizeWizard(
    targetAccount: IOuroAccount,
    props: Partial<Parameters<typeof LegacyPrimeMigrationWizard>[0]> = {},
    opts: { unlock?: boolean; password?: string } = {},
  ): Promise<NonNullable<typeof capturedStore>> {
    capturedStore = null;
    const adapter = new MemoryCodexAdapter("dev");
    capturedAdapter = adapter;
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
    if (opts.unlock !== false) {
      act(() => {
        capturedStore!.getState().actions.authenticate(opts.password ?? FINALIZE_PASSWORD, 60);
      });
    }
    return capturedStore!;
  }

  /** Drives the wizard intro -> account ("keep current") -> payment (3A,
   *  "Stoic Dalos Derivation") -> guard (3B) -> review -> ARWEAVE — the
   *  verification step `wizard-arweave-step` inserts between review and
   *  finalize. Payment and guard are separate pages now (owner correction,
   *  this session), each with its own Continue click.
   *
   *  Stops ON the Arweave step deliberately: Continue out of it is gated on
   *  the Arweave check itself, which is the thing under test — see
   *  {@link passArweaveStep} for the rest of the walk. */
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
    // guard -> REVIEW (writes nothing), then review -> ARWEAVE. Continue no
    // longer commits straight from the guard step.
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  /** Waits for the Arweave step's own check to SETTLE SATISFIED and clicks
   *  Continue out of it (arweave -> finalize). The `waitFor` is the point:
   *  the check is a real decrypt-and-compare, and Continue stays disabled
   *  until it proves the codex holds #0 and #1 — a fixture that does not
   *  genuinely hold them can never get past here, by design
   *  (`docs/work/wizard-arweave-step/design.md`: "Finalize is unreachable
   *  until the codex really holds #0 and #1").
   *
   *  THIS NO LONGER COMMITS (`migration-pending-apply` T4). Arriving at
   *  finalize starts nothing at all now — it only puts the "Settle Choices"
   *  button on screen. {@link settleChoices} is the step that commits. */
  async function passArweaveStep(): Promise<void> {
    await screen.findByTestId("legacy-prime-migration-arweave-step");
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  }

  /**
   * THE COMMIT, as a user performs it since `migration-pending-apply` T4 —
   * waits for the Settle Choices gate to open and clicks it. Owner: *"the
   * wizard has to end with a finalize button 'Settle Choices'… Once all the
   * squares are lit at the end, the user clicks Settle Choices, which is the
   * finalize button, and clicking it is the final action that settles the
   * selected choices."*
   *
   * The `waitFor` IS the gate: the button stays disabled while any of the
   * four dashboard colours is still being read, and stays disabled forever
   * if one of them cannot light at all — so a fixture whose account, payment
   * key, guard or Arweave accounts are unattributable can no longer commit
   * from here, by design.
   */
  async function settleChoices(): Promise<void> {
    await screen.findByTestId("legacy-prime-migration-settle-choices");
    await waitFor(() => {
      expect(
        (screen.getByTestId("legacy-prime-migration-settle-choices") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-settle-choices"));
  }

  /** The full walk, intro -> finalize -> COMMITTED, for a fixture that really
   *  does hold the master Arweave accounts by the time it reaches the Arweave
   *  step. The trailing `settleChoices()` is what used to happen implicitly
   *  as a side effect of the arweave -> finalize transition. */
  async function driveToFinalizeViaKeepCurrent(): Promise<void> {
    driveToArweaveStepViaKeepCurrent();
    await passArweaveStep();
    await settleChoices();
  }

  /**
   * Passes the Arweave step and commits, with `mutate` applied to the codex
   * in the SAME TICK the commit click lands.
   *
   * This is how the suites below still reach `runFinalize`'s own password and
   * Arweave branches now that the Arweave STEP gates the way in. It is not a
   * contrivance: the step's verdict is a measurement taken at one moment, and
   * what the commit does a moment later has to hold up against the codex as
   * it is THEN — an unlock window that lapses by the clock (no re-render
   * announces that), or Arweave keys that another panel removed. `runFinalize`
   * keeps its own pre-check, re-check and password handling for exactly that
   * window (`docs/work/wizard-arweave-step/design.md`: finalize's re-check
   * "becomes belt-and-braces rather than the only guard, and stays"), and this
   * is what exercises it.
   *
   * One tick matters, and since `migration-pending-apply` T4 it matters at a
   * DIFFERENT click. The commit is no longer a side effect of the arweave ->
   * finalize transition; it is the "Settle Choices" button on the finalize
   * screen, gated on the Settling Dashboard's four colours. So the walk is:
   * pass the Arweave step (which now writes nothing), wait for the Settle
   * gate to open, and only THEN apply `mutate` in the same tick as the
   * Settle click. Anything that changes `passwordCache` or the codex's
   * Arweave rows with a flush in between re-arms the violet ticker's own
   * resolution (by design — see that effect's dependencies), which would
   * correctly close the Settle gate again instead of letting the commit
   * start.
   */
  async function commitFromArweaveStepWith(mutate: () => void): Promise<void> {
    await screen.findByTestId("legacy-prime-migration-arweave-step");
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // -> finalize, writes nothing
    await waitFor(() => {
      expect(
        (screen.getByTestId("legacy-prime-migration-settle-choices") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    act(() => {
      mutate();
      fireEvent.click(screen.getByTestId("legacy-prime-migration-settle-choices"));
    });
  }

  /** Installs the master Arweave accounts the Arweave step now demands, for
   *  the suites whose subject is what happens AFTER it. */
  async function installMasterArweaveAccountsFor(bitString: string): Promise<void> {
    await act(async () => {
      await installMasterArweaveAccounts({ bitString });
    });
  }

  /** The codex's Arweave ACCOUNTS going away between the Arweave step's
   *  verdict and the commit — the drift `runFinalize`'s own pre-check exists
   *  for, and the only way its derive/re-check branches are still reachable
   *  now that the step gates the way in. An in-memory write, not a store
   *  action: what is being simulated is the codex changing UNDER the wizard
   *  (another panel, a restore), not a user action inside it. The matching
   *  Arweave SEED is deliberately left in place, so the pre-check finds the
   *  seed and asks only for the missing positions — exactly as it would for a
   *  codex that genuinely lost its keys. */
  function dropArweaveAccountsFrom(store: NonNullable<typeof capturedStore>): void {
    store.setState({ foreignKeys: [] });
  }

  /**
   * Writes the Arweave END STATE eligibility is defined on
   * (`docs/work/arweave-master-accounts/design.md`): an Arweave seed whose
   * ciphertext decrypts to the Codex Master Seed's own bitstring, PLUS a
   * `ForeignKeyEntry` carrying that seed's id at `index` 0 and 1 (an Arweave
   * ACCOUNT is a foreign-key entry addressed by `(seedId, index)`, never the
   * seed row on its own).
   *
   * Written through the REAL store actions, with the secret encrypted under
   * the codex's own held password — exactly as the real
   * `ensurePrimeArweaveSeed` (`packages/codex-arweave/src/panel/
   * CodexIdPage.tsx`) writes it. It has to be real ciphertext: the predicate
   * `runFinalize` now consults (`codexHoldsMasterArweaveAccounts`) matches by
   * DECRYPTING `secret` and comparing bitstrings, so a placeholder would not
   * match and nothing would be proven.
   */
  async function installMasterArweaveAccounts(opts: {
    bitString: string;
    indexes?: readonly number[];
    seedId?: string;
  }): Promise<string> {
    const store = capturedStore!;
    const seedId = opts.seedId ?? "finalize-installed-arweave-seed";
    const password = store.getState().actions.getPassword();
    if (!store.getState().arweaveSeeds.some((s) => s.id === seedId)) {
      await store.getState().actions.addArweaveSeed({
        id: seedId,
        name: "Installed Arweave Seed",
        secret: await encryptStringV2(opts.bitString, password),
        createdAt: "2026-11-18T00:00:00.000Z",
      });
    }
    for (const index of opts.indexes ?? [0, 1]) {
      await store.getState().actions.addForeignKey({
        id: `${seedId}-key-${index}`,
        chainId: "arweave:mainnet",
        encryptedKeyfile: "encrypted-keyfile-ciphertext",
        seedId,
        index,
      });
    }
    return seedId;
  }

  /**
   * A REALISTIC `ensurePrimeArweaveSeed` stub — it PERSISTS what a real
   * derivation persists (the master's Arweave seed plus one key per derived
   * position) and reports each delivery through `onProgress`, rather than
   * merely resolving.
   *
   * Every fixture below that expects to reach eligibility uses this, because
   * "the call resolved" is no longer eligibility: that inference IS the bug
   * `arweave-master-accounts` closes (the wizard printed "This codex is now
   * eligible." while the Settling Dashboard's violet ticker — the independent
   * check of the same fact — stayed dark, because the derivation was
   * discarding its key). `opts.indexes` forces a PARTIAL delivery, which the
   * real generator resolves on too (only a zero-key derivation rejects).
   */
  function fakeArweaveDerivation(opts: { indexes?: readonly number[] } = {}) {
    return vi.fn(
      async (
        words: { bitString: string; words?: readonly string[] },
        callOpts?: {
          missingIndexes?: readonly number[];
          onProgress?: (p: { index: number; delivered: number; total: number }) => void;
        },
      ): Promise<void> => {
        const indexes = opts.indexes ?? callOpts?.missingIndexes ?? [0, 1];
        let delivered = 0;
        for (const index of indexes) {
          delivered += 1;
          callOpts?.onProgress?.({ index, delivered, total: indexes.length });
        }
        await installMasterArweaveAccounts({ bitString: words.bitString, indexes });
      },
    );
  }

  it("a fixture needing a guard rotation still becomes ELIGIBLE, and reports the rotation as outstanding rather than blocking on it", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const targetAccount = makeAccount({
      id: "finalize-target-sweep-needed",
      originSeedTab: "write-seed",
      guard: null, // mismatched — guarantees guardRotationNeeded: true, same as T7's own suite.
      secret,
    });
    // The ArWeave face IS the one real precondition for eligibility (without
    // it there is no prime ArWeave address to compare against), so this
    // fixture supplies it — and since `arweave-master-accounts` T3 it has to
    // supply it FOR REAL (seed + accounts #0 and #1), because Finalize now
    // verifies the end state instead of trusting the call. The old
    // guard-mismatch bail fired before the ArWeave step and masked that —
    // part of why the ordering was wrong.
    const store = await renderFinalizeWizard(targetAccount, {
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
    });
    // The Arweave verification step (wizard-arweave-step T1) now stands
    // between review and the commit, and will not let a codex past until it
    // genuinely holds accounts #0 and #1 under the Codex Master Seed — so
    // this fixture installs them for real before walking through.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

    await driveToFinalizeViaKeepCurrent();

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

    // ...and the commit ended in a PENDING PLAN rather than a seal
    // (`migration-pending-apply` T2 — the stamp moved to Apply, so a codex
    // that has merely finalized is not yet aligned; see that topic's own
    // suite below). Eligibility remains a structural property of the codex:
    // `checkArweaveRestoreEligibility` derives an ArWeave address from the
    // prime account's bitstring and compares it to the stored prime one. No
    // chain read, no guard, no funds.
    await waitFor(() => {
      expect(store.getState().migrationProgress?.pending).toBeTruthy();
    });
    expect(store.getState().primeAlignment).toBe("legacy");

    // The chosen key changes are reported as OPTIONAL and outstanding, and
    // the recorded run survives so Apply can execute them later.
    expect(store.getState().migrationProgress).toBeTruthy();
    const outstanding = screen.getByTestId("legacy-prime-migration-commit-outstanding").textContent ?? "";
    expect(outstanding).toMatch(/OPTIONAL/i);
    expect(outstanding).toMatch(/not on chain yet/i);
    expect(outstanding).toMatch(/old keys keep working/i);
  });

  it("a fixture that resolves guardRotationNeeded: false, with ensurePrimeArweaveSeed resolving, reaches the success screen and records a pending plan", async () => {
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
    const ensurePrimeArweaveSeed = fakeArweaveDerivation();
    const store = await renderFinalizeWizard(targetAccount, { ensurePrimeArweaveSeed });
    // The Arweave verification step (wizard-arweave-step T1) now stands
    // between review and the commit, and will not let a codex past until it
    // genuinely holds accounts #0 and #1 under the Codex Master Seed — so
    // this fixture installs them for real before walking through.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

    await driveToFinalizeViaKeepCurrent();

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
    );
    expect(screen.getByText(PRIME_TRIO_LOCKED_REMINDER_TEXT)).toBeTruthy();
    // CHANGED to the new reality (wizard-arweave-step T1), not weakened: the
    // Arweave step verified these accounts before the commit was allowed to
    // start, so the commit derives NOTHING — two RSA-4096 keys this codex
    // already holds are not re-derived just because finalize also checks.
    // The derivation INPUT contract (`{bitString, words}` + the missing
    // positions) is pinned where the derivation now actually happens, on the
    // Arweave step itself.
    expect(ensurePrimeArweaveSeed).not.toHaveBeenCalled();
    // The "no Back/Continue once finalize is reached" contract, pinned here —
    // where finalize is genuinely reachable — rather than on the storeless
    // walk that can no longer get past the Arweave step.
    expect(screen.queryByTestId("legacy-prime-migration-continue")).toBeNull();
    expect(screen.queryByTestId("legacy-prime-migration-back")).toBeNull();
    // CHANGED by `migration-pending-apply` T2, and deliberately inverted: the
    // success path used to CLEAR the recorded run (`completeMigration()`,
    // which deletes it outright) and stamp alignment. The record IS the
    // pending state now — it has to survive for Apply to have anything to
    // seal — and the seal itself happens at Apply, not here.
    await waitFor(() => {
      expect(store.getState().migrationProgress?.pending).toBeTruthy();
    });
    expect(store.getState().primeAlignment).toBe("legacy");
    expect(store.getState().codexMasterSeed).toBeTruthy();
  });

  // owner (live testing, this session): a real "AncientHodler" account
  // with a genuinely working, chain-verified seed still failed Finalize
  // with "no known recovery words on record". `originSeedTab` is a
  // provenance tag stamped only at account-SPAWN time — many real,
  // perfectly recoverable legacy accounts never had it stamped at all
  // (documented elsewhere in this file as an already-known, unreliable-
  // both-ways gap). This proves Finalize now succeeds off the REAL
  // decrypt attempt alone, with `originSeedTab` genuinely `undefined`.
  it("finalizes successfully for an account whose originSeedTab was never stamped, as long as its secret actually decrypts", async () => {
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const key0 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0);
    const key1 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1);
    const targetAccount = makeAccount({
      id: "finalize-target-unstamped-origin",
      // originSeedTab deliberately OMITTED — undefined, the exact legacy
      // shape this bug hit.
      guard: { pred: "keys-all", keys: [key0.publicKey, key1.publicKey] },
      secret,
    });
    const ensurePrimeArweaveSeed = fakeArweaveDerivation();
    const store = await renderFinalizeWizard(targetAccount, { ensurePrimeArweaveSeed });
    // The Arweave verification step (wizard-arweave-step T1) now stands
    // between review and the commit, and will not let a codex past until it
    // genuinely holds accounts #0 and #1 under the Codex Master Seed — so
    // this fixture installs them for real before walking through.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

    await driveToFinalizeViaKeepCurrent();

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
    );
    expect(screen.queryByTestId("legacy-prime-migration-finalize-error")).toBeNull();
    // The commit genuinely completed — which since `migration-pending-apply`
    // T2 is "a pending plan was recorded", not "alignment was stamped".
    await waitFor(() => {
      expect(store.getState().migrationProgress?.pending?.accountId).toBe(targetAccount.id);
    });
  });

  /**
   * STAGE 2's Write 2 — the Codex Master Seed ROW.
   *
   * Owner, live testing: finalize declared the codex eligible while the Codex
   * ID page still said *"This codex has not settled on a Codex Master Seed
   * yet"*, with "Make Codex Permaweb Eligible" still live. The row had never
   * been written, and nothing anywhere said so.
   *
   * The cause was Write 2 taking its `chainwebSeedId` from
   * `migrationProgress.committed.seedId` — a value Write 1 publishes through
   * a deliberately FIRE-AND-FORGET `recordMigrationCommit` (best-effort by
   * design: recording must never fail a migration that otherwise succeeded,
   * and the action itself is a NO-OP whenever there is no recorded run to
   * merge into). When that read came up empty, the `if` simply fell through
   * and the row was silently skipped.
   *
   * So these tests assert against the STORE's `codexMasterSeed` — the thing
   * the Codex ID page actually reads — never against a spy on
   * `setCodexMasterSeed`, which would have passed just as happily on the
   * broken code for the one case the recording did land.
   */
  describe("Write 2 — the Codex Master Seed row", () => {
    /** The two keys a "keep current account" + Stoic Dalos walk derives for
     *  these words; an account guarded by exactly them resolves
     *  `guardRotationNeeded: false`, i.e. the plain success path. */
    const matchingGuard = (): IOuroAccount["guard"] => ({
      pred: "keys-all",
      keys: [
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0).publicKey,
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey,
      ],
    });

    /** The Chainweb seed the pairing (Write 1) ended up using: the account's
     *  own parent seed, which that write either reused or created. */
    function pairedSeedIdOf(
      store: NonNullable<typeof capturedStore>,
      accountId: string,
    ): string | undefined {
      return store.getState().ouroAccounts.find((a) => a.id === accountId)?.parentSeedId;
    }

    it("names the chosen account and the seed Write 1 paired it with, reusing the account's existing Chainweb seed", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-row-reused-seed",
        originSeedTab: "write-seed",
        guard: matchingGuard(),
        secret,
      });
      const store = await renderFinalizeWizard(targetAccount, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      // The seed the account already points at — the pairing must reuse THIS
      // id, and the row must name the same one. Paired AFTER the add on
      // purpose: `addOuroAccount` drops a `parentSeedId` whose seed is not in
      // the codex yet (its own documented defensive rule), so the link has to
      // be made once the seed exists — the same `updateOuroAccount` link the
      // pairing action itself writes.
      await act(async () => {
        await store.getState().actions.addStoaChainSeed({
          ...kickstartSeed(),
          id: "finalize-already-paired-seed",
          name: "Already Paired Seed",
        });
        await store.getState().actions.updateOuroAccount({
          ...targetAccount,
          parentSeedId: "finalize-already-paired-seed",
        });
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      const row = store.getState().codexMasterSeed;
      expect(row?.ouroAccountId).toBe(targetAccount.id);
      expect(row?.chainwebSeedId).toBe("finalize-already-paired-seed");
      expect(pairedSeedIdOf(store, targetAccount.id)).toBe(row?.chainwebSeedId);
    });

    // THE REGRESSION TEST FOR THE REPORTED BUG. `migrationProgress` is gone
    // by the time the commit runs, so every `recordMigrationCommit` in it is
    // a no-op (the real action returns early with no run to merge into) and
    // `committed.seedId` never lands — the exact state the old read-it-back
    // Write 2 silently skipped on. The row must still be written, because
    // the pairing's own result is right there in scope.
    it("writes the row even when migrationProgress.committed.seedId never lands", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-row-unrecorded-commit",
        originSeedTab: "write-seed",
        guard: matchingGuard(),
        secret,
      });
      const store = await renderFinalizeWizard(targetAccount, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      // Same tick as the commit click (see `commitFromArweaveStepWith`): the
      // recorded run disappears under the wizard, which is what makes the
      // fire-and-forget recording a no-op for the whole commit.
      await commitFromArweaveStepWith(() => store.setState({ migrationProgress: undefined }));

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      const row = store.getState().codexMasterSeed;
      expect(row?.ouroAccountId).toBe(targetAccount.id);
      expect(row?.chainwebSeedId).toBe(pairedSeedIdOf(store, targetAccount.id));
      expect(row?.chainwebSeedId).toBeTruthy();
      // ...and the commit completed over a row that is really there: the
      // pending plan `migration-pending-apply` T2 writes names the SAME seed
      // id, so Apply cannot be offered over a migration with a missing row.
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending?.seedId).toBe(row?.chainwebSeedId);
      });
    });

    // The legacy/imported account this wizard exists to rescue: the Codex ID
    // page reported "No matching Chainweb seed on record" for the owner's
    // account, so Write 1 CREATES the seed rather than reusing one. The row
    // must name that brand-new seed.
    it("writes the row for an account with no pre-existing matching Chainweb seed, naming the seed the pairing created", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-row-no-existing-seed",
        originSeedTab: "write-seed",
        guard: matchingGuard(),
        // parentSeedId deliberately absent — nothing on record to pair with.
        secret,
      });
      const store = await renderFinalizeWizard(targetAccount, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      const row = store.getState().codexMasterSeed;
      expect(row?.ouroAccountId).toBe(targetAccount.id);
      const createdSeedId = pairedSeedIdOf(store, targetAccount.id);
      expect(createdSeedId).toBeTruthy();
      expect(createdSeedId).not.toBe("finalize-kickstart-seed");
      expect(row?.chainwebSeedId).toBe(createdSeedId);
      // The named seed is a real row in the codex, and the promoted one.
      const named = store.getState().kadenaSeeds.find((s) => s.id === row?.chainwebSeedId);
      expect(named).toBeTruthy();
      expect(named?.isPrime).toBe(true);
    });

    // The other half of why this bug was invisible: Write 2 sat inside a bare
    // `catch {}`, so a row that genuinely FAILED to write looked exactly like
    // one that was never needed. It stays non-fatal (the row is descriptive
    // and re-runnable — a real failure here must not throw away a migration
    // that otherwise succeeded), but it must leave evidence: a recorded
    // `rowWritten: false` a later reader/resume can act on, and a reported
    // error rather than silence.
    it("records and reports a Codex Master Seed row that FAILED to write, without failing the migration", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-row-write-fails",
        originSeedTab: "write-seed",
        guard: null, // guardRotationNeeded: true — keeps the recorded run alive to read.
        secret,
      });
      const store = await renderFinalizeWizard(targetAccount, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);
      // The row write itself failing — a persistence error, not a missing id.
      const rowFailure = new Error("adapter refused to persist the Codex Master Seed row");
      store.setState({
        actions: {
          ...store.getState().actions,
          setCodexMasterSeed: async () => {
            throw rowFailure;
          },
        },
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await driveToFinalizeViaKeepCurrent();

        // NOT fatal: the rest of the commit ran, right through to the pending
        // plan (`migration-pending-apply` T2's Write 5 — which replaced the
        // alignment stamp this used to assert on).
        await waitFor(() =>
          expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
        );
        await waitFor(() => {
          expect(store.getState().migrationProgress?.pending).toBeTruthy();
        });
        // ...but the miss is on the record, and the summary does not claim a
        // row that is not there.
        await waitFor(() => {
          expect(store.getState().migrationProgress?.committed?.rowWritten).toBe(false);
        });
        expect(store.getState().codexMasterSeed).toBeUndefined();
        expect(
          screen.getByTestId("legacy-prime-migration-commit-summary").textContent ?? "",
        ).not.toMatch(/row is recorded/i);
        // ...and it was reported rather than swallowed.
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Codex Master Seed"), rowFailure);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  /**
   * STAGE 2's Write 4 — the master Arweave seed's ID on the Codex Master Seed
   * row (`CodexMasterSeed.arweaveSeedId`).
   *
   * Owner, after finalizing: *"The newly made Master Arweave Seed should be on
   * position one colour golden, and the one existing as Master Arweave Seed,
   * should have become Arweave Seed One."* The names were already fixed, but
   * the Arweave seed list orders and golds by `isPrime` — a "first seed ever
   * added" provenance marker that deliberately never moves (`addArweaveSeed`
   * throws `id-conflict` on a second explicit prime). So on a codex that
   * already had an Arweave seed, the DEMOTED one kept gold and position one.
   *
   * The fix is identity-first, mirroring `codex/masterNames.ts` for account
   * names: display follows the authoritative identity field, which finalize
   * has to actually WRITE — it was declared, persisted and exported, but
   * never set by anything.
   *
   * The id written is the one the SAME predicate the eligibility gate uses
   * (`codexHoldsMasterArweaveAccounts`) matched, taken from the authoritative
   * evaluation: the post-derivation re-check when a derivation ran, the
   * pre-check when the codex was already complete. A second way of
   * identifying the seed is exactly how this file's own history shows the
   * ticker and the wizard came to disagree.
   *
   * These assert against the STORE's `codexMasterSeed` — what the Arweave
   * seed list actually reads — never a spy on `setCodexMasterSeed`.
   */
  describe("Write 4 — the master Arweave seed id on the Codex Master Seed row", () => {
    /** Same walk-matching guard the Write 2 suite uses: an account guarded by
     *  exactly the two keys a "keep current" + Stoic Dalos walk derives
     *  resolves `guardRotationNeeded: false`, i.e. the plain success path. */
    const matchingGuard = (): IOuroAccount["guard"] => ({
      pred: "keys-all",
      keys: [
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0).publicKey,
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey,
      ],
    });

    // The DERIVING path: the accounts drift away after the Arweave step's
    // verdict, so the commit really runs `ensurePrimeArweaveSeed` and settles
    // on its post-derivation re-check. The seed row itself survives the drop
    // (`dropArweaveAccountsFrom`), so the derivation fills in the missing
    // positions under the seed that already exists — the one whose id must
    // end up on the Codex Master Seed row.
    it("records the seed the post-derivation re-check matched, when a derivation ran", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-arweave-seed-id-derived",
        originSeedTab: "write-seed",
        guard: matchingGuard(),
        secret,
      });
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      const store = await renderFinalizeWizard(targetAccount, { ensurePrimeArweaveSeed });
      let masterArweaveSeedId = "";
      await act(async () => {
        masterArweaveSeedId = await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING });
      });

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      expect(ensurePrimeArweaveSeed).toHaveBeenCalled();
      expect(masterArweaveSeedId).toBeTruthy();
      expect(store.getState().codexMasterSeed?.arweaveSeedId).toBe(masterArweaveSeedId);
      // The id names a seed the codex genuinely holds #0 and #1 under — the
      // whole point of taking it from the verified predicate.
      expect(store.getState().arweaveSeeds.some((s) => s.id === masterArweaveSeedId)).toBe(true);
      for (const index of [0, 1]) {
        expect(
          store.getState().foreignKeys.some(
            (k) => k.seedId === masterArweaveSeedId && k.index === index,
          ),
        ).toBe(true);
      }
      // The two mandatory faces are untouched by the merge.
      expect(store.getState().codexMasterSeed?.ouroAccountId).toBe(targetAccount.id);
      expect(store.getState().codexMasterSeed?.chainwebSeedId).toBeTruthy();
    });

    // The ALREADY-COMPLETE path, which is the one most likely to forget: it
    // derives nothing, so there is no post-derivation re-check to read and the
    // id has to come from the PRE-check. A codex that already had its master
    // Arweave accounts is precisely the owner's reported case (an existing
    // Arweave seed was demoted to "Arweave Seed One"), so it must not be the
    // path that leaves the row unstamped. The non-default seed id is
    // deliberate: it proves the value tracks the matched seed rather than a
    // constant the fixture happens to share with the helper.
    it("records the seed the pre-check matched on a codex that already holds #0 and #1, with nothing derived", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-arweave-seed-id-already-held",
        originSeedTab: "write-seed",
        guard: matchingGuard(),
        secret,
      });
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      const store = await renderFinalizeWizard(targetAccount, { ensurePrimeArweaveSeed });
      let masterArweaveSeedId = "";
      await act(async () => {
        masterArweaveSeedId = await installMasterArweaveAccounts({
          bitString: FINALIZE_BIT_STRING,
          seedId: "finalize-already-held-master-arweave-seed",
        });
      });

      await driveToFinalizeViaKeepCurrent();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      // Nothing was derived — this is genuinely the pre-check's answer.
      expect(ensurePrimeArweaveSeed).not.toHaveBeenCalled();
      expect(masterArweaveSeedId).toBe("finalize-already-held-master-arweave-seed");
      expect(store.getState().codexMasterSeed?.arweaveSeedId).toBe(masterArweaveSeedId);
    });

    // THE REGRESSION GUARD. A codex that is NOT holding #0 and #1 at the end
    // must not be stamped as having a master Arweave seed: the row is what the
    // seed list golds and sorts by, so a stamp on an unverified seed would
    // re-create the reported bug pointing at a seed the codex cannot even
    // prove it derives from. Same "verify the end state, do not trust that the
    // call returned" rule the Arweave block already follows — and the seed ROW
    // is still present here (only the accounts went away), so a `seedId`-only
    // check would happily stamp it.
    it("leaves arweaveSeedId UNSET when the codex does not hold the accounts at the end", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-arweave-seed-id-not-held",
        originSeedTab: "write-seed",
        guard: matchingGuard(),
        secret,
      });
      const store = await renderFinalizeWizard(targetAccount); // no ensurePrimeArweaveSeed at all
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-error")).toBeTruthy(),
      );
      expect(store.getState().primeAlignment).toBe("legacy");
      // The ROW is there (Write 2 ran before the Arweave block) — what is
      // missing is specifically the Arweave face.
      expect(store.getState().codexMasterSeed?.ouroAccountId).toBe(targetAccount.id);
      expect(store.getState().codexMasterSeed?.arweaveSeedId).toBeUndefined();
    });

    // `setCodexMasterSeed` MERGES and THROWS when the merged row cannot name
    // both mandatory faces, so this write is only safe because Write 2 ran
    // first — and Write 2 is itself non-fatal (`rowWritten: false`). When it
    // did not land, this stamp throws. An Arweave-seed-id stamp must never
    // fail a migration that otherwise succeeded, but it must not vanish
    // either: the half of the Write 2 bug that kept it invisible for so long
    // was a bare `catch {}`.
    it("reports a stamp that FAILED to write, without failing the migration", async () => {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const targetAccount = makeAccount({
        id: "finalize-target-arweave-seed-id-write-fails",
        originSeedTab: "write-seed",
        guard: matchingGuard(),
        secret,
      });
      const store = await renderFinalizeWizard(targetAccount, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);
      // Only the Arweave stamp fails; Write 2's row still lands, so this is
      // the stamp's own failure handling under test, not Write 2's.
      const realSetCodexMasterSeed = store.getState().actions.setCodexMasterSeed;
      const stampFailure = new Error("adapter refused to persist the Arweave seed id");
      store.setState({
        actions: {
          ...store.getState().actions,
          setCodexMasterSeed: async (row) => {
            if (row.arweaveSeedId !== undefined) throw stampFailure;
            return realSetCodexMasterSeed(row);
          },
        },
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await driveToFinalizeViaKeepCurrent();

        // NOT fatal: the migration finished and left a pending plan
        // (`migration-pending-apply` T2's Write 5 — which replaced the
        // alignment stamp this used to assert on).
        await waitFor(() =>
          expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
        );
        await waitFor(() => {
          expect(store.getState().migrationProgress?.pending).toBeTruthy();
        });
        // The plan still NAMES the seed the codex proved it holds — the row
        // stamp failing to persist does not change which seed that is.
        expect(store.getState().migrationProgress?.pending?.arweaveSeedId)
          .toBe("finalize-installed-arweave-seed");
        expect(store.getState().codexMasterSeed?.ouroAccountId).toBe(targetAccount.id);
        expect(store.getState().codexMasterSeed?.arweaveSeedId).toBeUndefined();
        // ...and it was REPORTED rather than swallowed.
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Arweave seed id"),
          stampFailure,
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
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
    // UPDATED (wizard-arweave-step T1): the Arweave step would never have let
    // a codex missing its accounts reach the commit at all, so the subject of
    // this test — what the COMMIT does when the derivation it falls back on
    // rejects — is reached the way it is genuinely still reached: the accounts
    // drift away after the step's verdict (`dropArweaveAccountsFrom`).
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

    driveToArweaveStepViaKeepCurrent();
    await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

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
    // Same reachability note as the rejecting case above.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

    driveToArweaveStepViaKeepCurrent();
    await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

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
      // CORRECTED (owner-reported bug, found on a real codex): "keep the
      // PAYMENT key" locks the account's OWN registered payment key, read
      // from `stoaChainLedger`. This fixture used to leave that unset and
      // still passed, because `currentPaymentKeyOf` read position 0 of
      // `allSeeds[0]` POSITIONALLY — which happens to be `kickstartKey`
      // here, and is a DIFFERENT key on the owner's real codex (its
      // account's payment key lives in a non-prime koala seed while
      // seeds[0] is a prime stoic seed). So the old pass was an accident
      // of fixture ordering, and the lock it proved was the lock of a key
      // the account never used. Stated properly now, in the `k:` address
      // form `state/store.ts:2680` writes for a non-stoic (koala) seed —
      // which keeps this test's own subject intact: payment and guard
      // still point at the SAME kickstart key, so one assertion pair
      // still proves both write paths.
      stoaChainLedger: `k:${kickstartKey}`,
      secret,
    });
    const store = await renderFinalizeWizard(targetAccount, {
      allSeeds: [kickstartSeed()],
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
    });
    // The Arweave verification step (wizard-arweave-step T1) gates the way
    // into the commit — installed for real, so this test's own subject (what
    // the commit LOCKS) is what it still measures.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

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
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    await passArweaveStep(); // arweave -> finalize, once the check actually passes
    await settleChoices(); // ...and THEN the commit, on its own explicit click (T4)

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

  /**
   * The owner's real codex, at the WRITE.
   *
   * Reported this session and verified by decrypting that codex's export:
   * its Ouronet account's actual on-chain payment key is `k:e20f2672…f231`
   * — position 0 of a NON-prime KOALA seed — while `allSeeds[0]` is the
   * prime STOIC "Prime Codex Seed", holding `225eb6d1…` at position 0.
   * `currentPaymentKeyOf` read that position POSITIONALLY, so a `"keep"`
   * payment choice sent the STOIC key into `secureMasterAccount` (locking
   * a key the account has never used, non-removably) and into
   * `recordMigrationCommit` (where stage 3A then compares it against the
   * account's `stoaChainLedger` and reports a rotation that was never
   * chosen). A wrong WRITE, against a real codex — the display half of
   * the same bug is pinned in
   * `tests/ui-migration-payment-key-identity.test.tsx`.
   *
   * The two seeds are passed as `allSeeds` in the owner's own ORDER (the
   * prime stoic one FIRST, so a positional read lands on it), and the
   * koala seed is ALSO added to the store — `secureMasterAccount` resolves
   * the key it is handed against `kadenaSeeds` to decide which seed and
   * position to lock, so the codex has to genuinely hold it for there to
   * be a lock to assert on at all.
   */
  it("a KEPT payment key locks and commits the ACCOUNT's own registered key (a non-prime koala seed's #0), never allSeeds[0]'s position 0", async () => {
    const PRIME_STOIC_KEY0 = "225eb6d1b11f637b7f6014d9dd4ad5630d157540ef0fc4" + "0".repeat(18);
    const KOALA_KEY0 = "e20f267264634c5bc76e15dd5a9df6703fc3c06726e7674aa6217edeb064f231";
    const primeStoicSeed: IStoaChainSeed = {
      id: "owner-prime-codex-seed", name: "Prime Codex Seed", seedType: "stoic",
      version: "1.0.0", index: 0, secret: "ct-stoic", main: "",
      createdAt: "2026-11-01T10:00:00.000Z", isPrime: true,
      accounts: [{ index: 0, publicKey: PRIME_STOIC_KEY0, derivationPath: "m/0" }],
    };
    const koalaSeed: IStoaChainSeed = {
      id: "owner-original-koala", name: "OriginalKoala", seedType: "koala",
      version: "1.0.0", index: 1, secret: "ct-koala", main: `k:${KOALA_KEY0}`,
      createdAt: "2026-11-02T10:00:00.000Z", isPrime: false,
      accounts: [{ index: 0, publicKey: KOALA_KEY0, derivationPath: "m/0" }],
    };
    const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
    const targetAccount = makeAccount({
      id: "finalize-target-owner-koala-payment",
      originSeedTab: "write-seed",
      // The account's REAL payment key, in the `k:` address form
      // `state/store.ts:2680` writes for every non-stoic seed.
      stoaChainLedger: `k:${KOALA_KEY0}`,
      secret,
    });
    const store = await renderFinalizeWizard(targetAccount, {
      allSeeds: [primeStoicSeed, koalaSeed],
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
    });
    await act(async () => {
      await store.getState().actions.addStoaChainSeed(koalaSeed);
    });
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

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
      within(screen.getByTestId("legacy-prime-migration-guard-option-recommended")).getByRole("button"),
    );
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    await passArweaveStep();
    await settleChoices();

    await waitFor(() =>
      expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
    );

    // What stage 3A reads to decide whether a payment rotation is still
    // outstanding: it compares this against the account's own
    // `stoaChainLedger` (bare), so recording the stoic key here is what
    // made a "keep" look like a pending rotation forever.
    expect(store.getState().migrationProgress?.committed?.paymentPublicKey).toBe(KOALA_KEY0);
    // ...and the non-removable lock lands on the seed that actually holds
    // that key, never on the prime stoic seed.
    expect(store.getState().masterKeyLocks).toContainEqual(
      expect.objectContaining({
        seedId: "owner-original-koala", position: 0, reason: "master-payment-key",
      }),
    );
    expect(store.getState().masterKeyLocks).not.toContainEqual(
      expect.objectContaining({ seedId: "owner-prime-codex-seed" }),
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
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      describeKeyset: async () => ({ keys: ["7".repeat(64)], pred: "keys-all" }),
    });
    // The Arweave verification step (wizard-arweave-step T1) gates the way
    // into the commit — installed for real, so this test's own subject (what
    // the commit LOCKS) is what it still measures.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

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
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    await passArweaveStep(); // arweave -> finalize, once the check actually passes
    await settleChoices(); // ...and THEN the commit, on its own explicit click (T4)

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
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      describeKeyset: async () => ({ keys: ["7".repeat(64)], pred: "keys-all" }),
    });
    // The Arweave verification step (wizard-arweave-step T1) gates the way
    // into the commit — installed for real, so this test's own subject (what
    // the commit LOCKS) is what it still measures.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

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
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    await passArweaveStep(); // arweave -> finalize, once the check actually passes
    await settleChoices(); // ...and THEN the commit, on its own explicit click (T4)

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
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      describeKeyset,
    });
    // The Arweave verification step (wizard-arweave-step T1) gates the way
    // into the commit — installed for real, so this test's own subject (what
    // the commit LOCKS) is what it still measures.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

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
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    await passArweaveStep(); // arweave -> finalize, once the check actually passes
    await settleChoices(); // ...and THEN the commit, on its own explicit click (T4)

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
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      describeKeyset,
    });
    // The Arweave verification step (wizard-arweave-step T1) gates the way
    // into the commit — installed for real, so this test's own subject (what
    // the commit LOCKS) is what it still measures.
    await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

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
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    await passArweaveStep(); // arweave -> finalize, once the check actually passes
    await settleChoices(); // ...and THEN the commit, on its own explicit click (T4)

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
      ensurePrimeArweaveSeed: fakeArweaveDerivation(),
    });
    await act(async () => {
      await store.getState().actions.addOuroAccount(chosenAccount);
      await store.getState().actions.addStoaChainSeed(secondSeed());
    });
    // The Arweave step checks the CHOSEN account's bitstring (the whole point
    // of resolving it through the same path the commit uses), so the accounts
    // have to be installed under THOSE words — the old current account's
    // would not satisfy it, and must not.
    await installMasterArweaveAccountsFor(seedWordsToBitString(CHOSEN_WORDS));

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    fireEvent.click(
      await screen.findByTestId("legacy-prime-migration-account-existing-item-finalize-chosen-existing"),
    );
    // Choosing an "existing" account now also gates Continue on its async
    // seed-id resolution — wait for it to settle before clicking.
    await waitFor(() => expect(
      (screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled,
    ).toBe(false));
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
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
    await passArweaveStep(); // arweave -> finalize, once the check actually passes
    await settleChoices(); // ...and THEN the commit, on its own explicit click (T4)

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

  /**
   * `docs/work/wizard-unlock-lifecycle/design.md` — T2.
   *
   * Finalize used to be a DEAD END on either password problem. Both collapsed
   * into one terminal red line, which is what the owner actually hit on their
   * real codex: *"Could not decrypt this account's words: AES-GCM auth-tag
   * failure"*. The wizard is a long, think-about-it flow and the codex's
   * unlock window is short and ABSOLUTE (never sliding — see
   * `src/zbom/hooks/useEnsureCodexUnlocked.ts`), so the window closing
   * mid-run is the NORMAL case here, not an edge one. Finalize must ask for
   * the password where the user stands and resume, exactly as the Account
   * step's own `legacy-prime-migration-account-probe-unlock` panel already
   * does — now via the shared `InlineUnlockPrompt` (`wizard-unlock-prompt`).
   *
   * Driven end-to-end through the real store: a mocked `getPassword` would
   * prove nothing about the real `CodexLockedError`/`smartDecrypt` seams that
   * produce these two failures in the first place.
   */
  describe("password problems at Finalize (wizard-unlock-lifecycle T2)", () => {
    /** A target whose secret really decrypts under `FINALIZE_PASSWORD`, and
     *  whose guard already matches the derived position-0/1 pair — so once
     *  the password problem is resolved, finalize runs all the way to the
     *  success screen (`guardRotationNeeded: false`). */
    async function unlockableTarget(id: string): Promise<IOuroAccount> {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      const key0 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0);
      const key1 = deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1);
      return makeAccount({
        id,
        originSeedTab: "write-seed",
        guard: { pred: "keys-all", keys: [key0.publicKey, key1.publicKey] },
        secret,
      });
    }

    it("reaching Finalize with the codex LOCKED shows the inline unlock prompt, not a terminal error", async () => {
      const target = await unlockableTarget("finalize-locked-prompts");
      // UPDATED (wizard-arweave-step T1): the codex starts UNLOCKED and
      // holding its master Arweave accounts, because the Arweave step cannot
      // verify a locked codex and will not let one past. The lock then lands
      // where it genuinely lands for a flow this long — between reading the
      // Arweave screen and pressing commit, with the absolute window lapsing
      // in between (see `commitFromArweaveStepWith`).
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => store.getState().actions.lock());

      const prompt = await screen.findByTestId("wizard-unlock-prompt");
      expect(prompt.textContent).toContain(
        "Your codex is locked — enter your password to finish.",
      );
      // The regression this pins: the SAME state used to render the red
      // terminal box with a "Close" button as the only way out.
      expect(screen.queryByTestId("legacy-prime-migration-finalize-error")).toBeNull();
      expect(screen.getByTestId("legacy-prime-migration-finalize")).toBeTruthy();
    });

    it("submitting the correct password at the locked prompt completes the interrupted finalize", async () => {
      const target = await unlockableTarget("finalize-locked-then-completes");
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);
      const authenticateSpy = vi.spyOn(store.getState().actions, "authenticate");

      driveToArweaveStepViaKeepCurrent();
      // The window lapses between the Arweave screen and the commit — see
      // `commitFromArweaveStepWith`.
      await commitFromArweaveStepWith(() => store.getState().actions.lock());
      await screen.findByTestId("wizard-unlock-prompt");

      fireEvent.change(screen.getByTestId("wizard-unlock-prompt-input"), {
        target: { value: FINALIZE_PASSWORD },
      });
      fireEvent.click(screen.getByTestId("wizard-unlock-prompt-submit"));

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      // The interrupted run really finished: it reached Write 5 and left a
      // pending plan (`migration-pending-apply` T2 — this used to assert the
      // alignment stamp, which now happens at Apply).
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending).toBeTruthy();
      });
      // Not called, and that is the point of the step now existing: the
      // Arweave accounts were verified BEFORE the commit, so the resumed
      // commit re-checks them and derives nothing.
      expect(ensurePrimeArweaveSeed).not.toHaveBeenCalled();
      expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
      // A GENUINELY locked codex is the one case allowed to start a new
      // window — once, from the password the user just typed.
      expect(authenticateSpy).toHaveBeenCalledTimes(1);
      expect(authenticateSpy.mock.calls[0]![0]).toBe(FINALIZE_PASSWORD);
      expect(store.getState().passwordCache?.expiresAt ?? 0).toBeGreaterThan(Date.now());
      authenticateSpy.mockRestore();
    });

    it("submitting a WRONG password keeps the user on Finalize with another attempt, never a dead end", async () => {
      const target = await unlockableTarget("finalize-locked-wrong-pw");
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => store.getState().actions.lock());
      await screen.findByTestId("wizard-unlock-prompt");

      fireEvent.change(screen.getByTestId("wizard-unlock-prompt-input"), {
        target: { value: "definitely-the-wrong-password" },
      });
      fireEvent.click(screen.getByTestId("wizard-unlock-prompt-submit"));

      await waitFor(() =>
        expect(screen.getByTestId("wizard-unlock-prompt-error").textContent).toBe(
          "Incorrect password — try again.",
        ),
      );
      // Still on finalize, still prompting, nothing stamped, and the staged
      // selections survive for the next attempt (or a later resume).
      expect(screen.getByTestId("legacy-prime-migration-finalize")).toBeTruthy();
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
      expect(screen.queryByTestId("legacy-prime-migration-finalize-success")).toBeNull();
      expect(store.getState().primeAlignment).not.toBe("aligned");
      expect(store.getState().migrationProgress?.selection?.account).toEqual({
        kind: "keep-current",
      });
    });

    it("a codex that is UNLOCKED but holding a password that decrypts nothing prompts again — and re-finalizing never touches the unlock window", async () => {
      const target = await unlockableTarget("finalize-wrong-held-password");
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      // Unlocked — `getPassword()` succeeds — but with a password that is NOT
      // the one this account's secret was encrypted under. `authenticate()`
      // never validates anything, so this is a real, reachable state.
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);
      const authenticateSpy = vi.spyOn(store.getState().actions, "authenticate");
      // The cache goes BAD between the Arweave screen and the commit, with
      // the window itself untouched — written straight into the cache rather
      // than through `authenticate()` so the spy below observes only what the
      // WIZARD does, and so the expiry this test asserts on is a value the
      // test owns. (`authenticate()` caches whatever it is handed and never
      // validates it, which is what makes this state reachable at all.)
      const staleCache = { value: "a-stale-wrong-password", expiresAt: Date.now() + 60 * 60_000 };

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => store.setState({ passwordCache: staleCache }));

      const prompt = await screen.findByTestId("wizard-unlock-prompt");
      expect(prompt.textContent).toContain(
        "The password this codex currently holds could not decrypt this account. Re-enter it to finish.",
      );
      expect(screen.queryByTestId("legacy-prime-migration-finalize-error")).toBeNull();

      fireEvent.change(screen.getByTestId("wizard-unlock-prompt-input"), {
        target: { value: FINALIZE_PASSWORD },
      });
      fireEvent.click(screen.getByTestId("wizard-unlock-prompt-submit"));

      // The password QUESTION is answered — the typed password decrypts the
      // account, so the prompt goes away and the run moves on.
      await waitFor(() => expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull());
      // THE INVARIANT (see `useEnsureCodexUnlocked`'s own doc): this codex was
      // already unlocked, so its absolute window must keep counting down from
      // where it was. Calling `authenticate()` here would silently reset the
      // TTL and make the visible "re-authenticate in X" countdown a lie —
      // precisely the bug that hook was changed to stop.
      expect(authenticateSpy).not.toHaveBeenCalled();
      expect(store.getState().passwordCache!.expiresAt).toBe(staleCache.expiresAt);
      // AND THE HONEST TAIL (changed by wizard-arweave-step T1, reported as a
      // PRE-EXISTING hazard rather than papered over): the run does NOT reach
      // the success screen, because the password the codex still HOLDS cannot
      // read its own Arweave seed — and `runFinalize` reads that seed with the
      // held password deliberately (it is the password the generator would
      // encrypt a new seed under, so the two must agree). Eligibility is
      // therefore withheld rather than claimed, which is the safe direction;
      // the fix (letting a proven override win for this read, or re-caching
      // it) belongs with whoever owns that password lifecycle.
      expect(screen.queryByTestId("legacy-prime-migration-finalize-success")).toBeNull();
      expect(store.getState().primeAlignment).not.toBe("aligned");
      authenticateSpy.mockRestore();
    });

    it("a run whose codex never locks shows no unlock prompt at all", async () => {
      const target = await unlockableTarget("finalize-never-locked");
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      // No extra step, no extra password entry, for the user who never hit
      // the lock window (design.md's own acceptance criterion).
      expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending).toBeTruthy();
      });
    });
  });

  /**
   * `docs/work/arweave-master-accounts/design.md` — T3.
   *
   * THE REPORTED BUG: the finalize panel printed "This codex is now eligible."
   * while the Settling Dashboard's violet ticker — the dashboard's own,
   * independent check of the very same fact — was DARK. Owner: *"it says it
   * made my codex eligible, but it never did check if the codex has arweave
   * accounts... it first has to have shown a purple square box on the Codex
   * Master Seed, which would mean the codex holds #0 and #1 arweave accounts
   * derived from the Codex Master Seed. That's the last step that would make
   * it eligible. And if it doesn't it would have to make it on the spot."*
   *
   * Eligibility is now a VERIFIED PREDICATE over the codex's end state
   * (`codexHoldsMasterArweaveAccounts`, the same one the ticker reads), not an
   * inference from "the derivation call didn't throw". Every fixture here uses
   * a guard-MISMATCHED account (`guard: null`), so the terminal state is
   * `eligible-rotation-outstanding` and the literal "This codex is now
   * eligible." panel is the thing under test.
   */
  describe("Arweave master accounts gate eligibility (arweave-master-accounts T3)", () => {
    /** Guard deliberately mismatched, so reaching eligibility renders the
     *  "This codex is now eligible." panel rather than the success box. */
    async function eligibilityTarget(id: string): Promise<IOuroAccount> {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      return makeAccount({ id, originSeedTab: "write-seed", guard: null, secret });
    }

    it("a codex ALREADY holding #0 and #1 under the master seed reaches the eligible panel without deriving anything", async () => {
      const target = await eligibilityTarget("finalize-arweave-already-held");
      // Never called: re-deriving two RSA-4096 keys a codex already holds
      // costs the user seconds of work for nothing, and design.md's own
      // criterion is explicit ("completes finalize without deriving anything
      // new"). It also writes nothing here, so if it WERE called this
      // fixture's end state would be unchanged — the assertion below is the
      // only thing that can catch it.
      const ensurePrimeArweaveSeed = vi.fn(async () => {});
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();

      const committed = await screen.findByTestId("legacy-prime-migration-finalize-committed");
      expect(committed.textContent).toContain("This codex is now eligible.");
      expect(ensurePrimeArweaveSeed).not.toHaveBeenCalled();
      // The eligible claim is backed by a completed commit — which since
      // `migration-pending-apply` T2 means a recorded pending plan, not a
      // stamped alignment (that moved to Apply).
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending?.arweaveSeedId)
          .toBe("finalize-installed-arweave-seed");
      });
    });

    it("a codex missing BOTH master Arweave accounts derives exactly #0 and #1, then reaches the eligible panel", async () => {
      const target = await eligibilityTarget("finalize-arweave-missing-both");
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      // UPDATED (wizard-arweave-step T1): the Arweave STEP is what a codex
      // missing its accounts now meets first, and it will not let one past —
      // so the commit's own derive-and-re-check path (which design.md keeps
      // deliberately, as belt-and-braces) is reached the one way it still
      // genuinely is: the accounts drift away after the step's verdict.
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      const committed = await screen.findByTestId("legacy-prime-migration-finalize-committed");
      expect(committed.textContent).toContain("This codex is now eligible.");
      expect(ensurePrimeArweaveSeed).toHaveBeenCalledTimes(1);
      // Derived against the SAME bitstring the Codex Master Seed row was
      // written from, for exactly the positions the predicate found absent.
      expect(ensurePrimeArweaveSeed.mock.calls[0]![0]).toEqual({
        bitString: FINALIZE_BIT_STRING,
        words: FINALIZE_WORDS,
      });
      expect(ensurePrimeArweaveSeed.mock.calls[0]![1]?.missingIndexes).toEqual([0, 1]);
      // Same substitution as the sibling test above: a completed commit is
      // now evidenced by the pending plan, not by the alignment stamp.
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending).toBeTruthy();
      });
      // ...and the claim is TRUE: the codex really holds both accounts under
      // the seed that derives from the master bitstring.
      const seedId = store.getState().arweaveSeeds[0]!.id;
      expect(
        store.getState().foreignKeys
          .filter((k) => k.seedId === seedId)
          .map((k) => k.index)
          .sort(),
      ).toEqual([0, 1]);
    });

    it("an ensurePrimeArweaveSeed that RESOLVES but leaves #1 missing never claims eligibility, and never stamps alignment", async () => {
      const target = await eligibilityTarget("finalize-arweave-partial-delivery");
      // PARTIAL DELIVERY RESOLVES (`arweave-master-accounts` T2: only a
      // zero-key derivation rejects), so a resolved call is not proof of
      // anything — this is the exact reported bug, a success message over a
      // dark violet ticker.
      const ensurePrimeArweaveSeed = fakeArweaveDerivation({ indexes: [0] });
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      // UPDATED (wizard-arweave-step T1): the Arweave STEP is what a codex
      // missing its accounts now meets first, and it will not let one past —
      // so the commit's own derive-and-re-check path (which design.md keeps
      // deliberately, as belt-and-braces) is reached the one way it still
      // genuinely is: the accounts drift away after the step's verdict.
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      await screen.findByTestId("legacy-prime-migration-finalize-error");
      expect(ensurePrimeArweaveSeed).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("legacy-prime-migration-finalize-committed")).toBeNull();
      expect(screen.queryByTestId("legacy-prime-migration-finalize-success")).toBeNull();
      expect(store.getState().primeAlignment).toBe("legacy");
      // The key that DID arrive is kept — it is a real key, and the next
      // attempt only needs #1.
      expect(store.getState().foreignKeys.map((k) => k.index)).toEqual([0]);
    });

    it("an ABSENT ensurePrimeArweaveSeed leaves the codex not-eligible and withholds the eligible panel", async () => {
      const target = await eligibilityTarget("finalize-arweave-no-generator");
      const store = await renderFinalizeWizard(target); // no ensurePrimeArweaveSeed prop at all
      // UPDATED (wizard-arweave-step T1): the Arweave STEP is what a codex
      // missing its accounts now meets first, and it will not let one past —
      // so the commit's own derive-and-re-check path (which design.md keeps
      // deliberately, as belt-and-braces) is reached the one way it still
      // genuinely is: the accounts drift away after the step's verdict.
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      await screen.findByTestId("legacy-prime-migration-finalize-error");
      expect(screen.queryByTestId("legacy-prime-migration-finalize-committed")).toBeNull();
      expect(store.getState().primeAlignment).toBe("legacy");
      // The pre-check is a READ: it must not have invented a seed row of its
      // own (the pre-T2 failure mode was precisely a seed with no accounts).
      // So the codex still holds EXACTLY the one seed it arrived with, and
      // the accounts that drifted away were not conjured back either.
      expect(store.getState().arweaveSeeds.map((seed) => seed.id))
        .toEqual(["finalize-installed-arweave-seed"]);
      expect(store.getState().foreignKeys).toEqual([]);
      // ...while the non-Arweave writes still landed, unchanged.
      expect(store.getState().codexMasterSeed).toBeTruthy();
      expect(store.getState().masterKeyLocks.length).toBeGreaterThan(0);
    });

    it("renders which Arweave position is being derived, from the derivation's own progress events, and clears it when the derivation finishes", async () => {
      const target = await eligibilityTarget("finalize-arweave-progress");
      let release: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      // Each RSA-4096 key costs SECONDS. A screen that says nothing for that
      // long is indistinguishable from a hang — and the line must track the
      // derivation's REAL events (never a timer), which is why this stub
      // holds the run open between the last event and completion.
      const ensurePrimeArweaveSeed = vi.fn(
        async (
          words: { bitString: string; words?: readonly string[] },
          callOpts?: {
            missingIndexes?: readonly number[];
            onProgress?: (p: { index: number; delivered: number; total: number }) => void;
          },
        ): Promise<void> => {
          callOpts?.onProgress?.({ index: 0, delivered: 0, total: 2 });
          callOpts?.onProgress?.({ index: 1, delivered: 1, total: 2 });
          await gate;
          await installMasterArweaveAccounts({ bitString: words.bitString });
        },
      );
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      // UPDATED (wizard-arweave-step T1): the Arweave STEP is what a codex
      // missing its accounts now meets first, and it will not let one past —
      // so the commit's own derive-and-re-check path (which design.md keeps
      // deliberately, as belt-and-braces) is reached the one way it still
      // genuinely is: the accounts drift away after the step's verdict.
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      const progress = await screen.findByTestId("legacy-prime-migration-finalize-arweave-progress");
      // The LAST event's position and count, not a fabricated percentage.
      expect(progress.textContent).toContain("#1");
      expect(progress.textContent).toContain("1 of 2");

      await act(async () => { release!(); });

      await waitFor(() =>
        expect(screen.queryByTestId("legacy-prime-migration-finalize-arweave-progress")).toBeNull(),
      );
      await screen.findByTestId("legacy-prime-migration-finalize-committed");
    });

    it("the FINALIZE screen renders the same bar and status line as the Arweave step — the owner reaches both", async () => {
      const target = await eligibilityTarget("finalize-arweave-progress-bar");
      let release: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const ensurePrimeArweaveSeed = vi.fn(
        async (
          words: { bitString: string; words?: readonly string[] },
          callOpts?: {
            missingIndexes?: readonly number[];
            onProgress?: (p: ArweaveDerivationProgress) => void;
          },
        ): Promise<void> => {
          callOpts?.onProgress?.({
            index: 1,
            delivered: 0,
            total: 2,
            search: {
              position: 2,
              totalCount: 2,
              stage: "p",
              attempts: 2048,
              grandAttempts: 12345,
              percent: 64,
            },
          });
          await gate;
          await installMasterArweaveAccounts({ bitString: words.bitString });
        },
      );
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      await screen.findByTestId("legacy-prime-migration-finalize-arweave-progress");
      expect(
        screen.getByTestId("legacy-prime-migration-finalize-arweave-progress-search").textContent,
      ).toBe("Position 2 of 2 · prime P · 2,048 this search · 12,345 total · 64%");
      const bar = screen.getByTestId("legacy-prime-migration-finalize-arweave-progress-bar");
      expect(bar.getAttribute("role")).toBe("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("64");
      expect(bar.getAttribute("data-percent")).toBe("64");

      await act(async () => { release!(); });

      await waitFor(() =>
        expect(screen.queryByTestId("legacy-prime-migration-finalize-arweave-progress")).toBeNull(),
      );
      await screen.findByTestId("legacy-prime-migration-finalize-committed");
    });
  });

  /**
   * `docs/work/wizard-arweave-step/design.md` — T1.
   *
   * THE REPORTED DEFECT: there was no step. The Arweave check ran inside
   * `runFinalize`, so there was nothing to watch, nothing to confirm, and no
   * way to tell a real check from a no-op. Owner, twice: *"how can the codex
   * be eligible, if the wizard has no step for verifying if the codex has
   * arweave account? … There should be a separate step regarding the arweave
   * account verification."*
   *
   * So the check is a SCREEN now — three separately-visible rows, one per
   * question the owner asked, in their order — and Continue out of it is
   * bound to the predicate's own answer, which makes Finalize unreachable
   * until the codex genuinely holds #0 and #1 under the Codex Master Seed.
   */
  describe("the Arweave verification step (wizard-arweave-step T1)", () => {
    /** Guard deliberately mismatched (same as the eligibility suite above):
     *  irrelevant to the Arweave step itself, and it keeps these fixtures
     *  off the success screen if one ever did reach finalize. */
    async function arweaveStepTarget(id: string): Promise<IOuroAccount> {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      return makeAccount({ id, originSeedTab: "write-seed", guard: null, secret });
    }

    function rowText(which: "seed" | "key0" | "key1"): string {
      return screen.getByTestId(`legacy-prime-migration-arweave-check-${which}`).textContent ?? "";
    }

    it("a codex already holding a matching seed with #0 and #1 reports all three checks satisfied, offers NO Generate button, and lets Continue through", async () => {
      const target = await arweaveStepTarget("arweave-step-already-held");
      await renderFinalizeWizard(target);
      await act(async () => {
        await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING });
      });

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");

      await waitFor(() => expect(rowText("seed")).toMatch(/satisfied/i));
      expect(rowText("key0")).toMatch(/satisfied/i);
      expect(rowText("key1")).toMatch(/satisfied/i);
      expect(rowText("seed")).not.toMatch(/missing/i);
      expect(rowText("key0")).not.toMatch(/missing/i);
      expect(rowText("key1")).not.toMatch(/missing/i);
      // Nothing to generate — and the step says so, rather than offering a
      // button that would re-derive two RSA-4096 keys the codex already has.
      expect(screen.queryByTestId("legacy-prime-migration-arweave-generate")).toBeNull();
      expect(screen.getByTestId("legacy-prime-migration-arweave-step").textContent)
        .toMatch(/nothing (to do|needs)/i);
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
      expect(screen.queryByTestId("legacy-prime-migration-continue-blocked")).toBeNull();
    });

    it("a codex with NO Arweave seed reports all three checks missing, offers Generate, and blocks Continue with a reason naming the missing seed", async () => {
      const target = await arweaveStepTarget("arweave-step-nothing-held");
      const store = await renderFinalizeWizard(target);

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");

      await waitFor(() => expect(rowText("seed")).toMatch(/missing/i));
      expect(rowText("key0")).toMatch(/missing/i);
      expect(rowText("key1")).toMatch(/missing/i);
      expect(screen.getByTestId("legacy-prime-migration-arweave-generate")).toBeTruthy();
      await waitFor(() => {
        expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
          .toBe(true);
      });
      // The reason NAMES what is missing — a disabled button that says
      // nothing is indistinguishable from a broken one (this file's own
      // `continueBlockedReason` rule).
      expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent)
        .toMatch(/seed/i);
      // Checking is a READ: arriving on this step must not write anything.
      expect(store.getState().arweaveSeeds).toEqual([]);
      expect(store.getState().foreignKeys).toEqual([]);
    });

    it("a codex holding a matching seed with ONLY #0 reports the seed and #0 satisfied and #1 missing", async () => {
      const target = await arweaveStepTarget("arweave-step-only-key0");
      await renderFinalizeWizard(target);
      await act(async () => {
        await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING, indexes: [0] });
      });

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");

      await waitFor(() => expect(rowText("seed")).toMatch(/satisfied/i));
      expect(rowText("key0")).toMatch(/satisfied/i);
      expect(rowText("key0")).not.toMatch(/missing/i);
      // The one real distinction this test exists for: the key rows track
      // `missingIndexes` per position, not one shared "any missing" flag.
      expect(rowText("key1")).toMatch(/missing/i);
      expect(rowText("key1")).not.toMatch(/satisfied/i);
      expect(screen.getByTestId("legacy-prime-migration-arweave-generate")).toBeTruthy();
      await waitFor(() => {
        expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
          .toBe(true);
      });
      expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent)
        .toMatch(/#1/);
    });

    it("FINALIZE IS UNREACHABLE while the check is unsatisfied — clicking Continue leaves the user on the Arweave step, with nothing committed", async () => {
      const target = await arweaveStepTarget("arweave-step-finalize-unreachable");
      // Supplied, and must stay UNCALLED: the commit never starts, so the
      // generator `runFinalize` would have reached is never reached either.
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await waitFor(() => {
        expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
          .toBe(true);
      });

      // A disabled button ignores clicks, but the handler is asserted too —
      // the gate must hold in `handleContinue` itself, not merely in the
      // button's `disabled` attribute (a keyboard/programmatic activation
      // must not slip past it either).
      fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

      expect(screen.getByTestId("legacy-prime-migration-arweave-step")).toBeTruthy();
      expect(screen.queryByTestId("legacy-prime-migration-finalize")).toBeNull();
      expect(ensurePrimeArweaveSeed).not.toHaveBeenCalled();
      expect(store.getState().primeAlignment).toBe("legacy");
      expect(store.getState().codexMasterSeed).toBeFalsy();
    });
  });

  /**
   * `docs/work/wizard-arweave-step/design.md` — T2.
   *
   * T1 built the screen and the gate and left Generate rendered-but-inert.
   * This suite is about the ACTION, and about the two traps around it:
   *
   *   1. A RESOLVED derivation is not a finished one. Partial delivery
   *      resolves (only a zero-key run rejects), so success here must be the
   *      RE-EVALUATED predicate, never the promise coming back. "The call
   *      returned, therefore eligible" is the original reported bug.
   *   2. A LOCKED codex (or one holding a password that decrypts nothing)
   *      dead-ended on this step after T1: the check could not run, Continue
   *      was blocked, and the only way out was closing the wizard. It now
   *      asks for the password where the user stands, and "unreadable" must
   *      never be printed as "missing" — that would invite the owner to
   *      re-derive two RSA-4096 keys they already have.
   */
  describe("the Arweave step's Generate + unlock path (wizard-arweave-step T2)", () => {
    /** Same fixture shape T1's own suite uses: a target whose secret really
     *  decrypts under `FINALIZE_PASSWORD`, with the guard deliberately
     *  mismatched so a fixture that somehow reached finalize could not land
     *  on the success screen by accident. */
    async function arweaveStepTarget(id: string): Promise<IOuroAccount> {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      return makeAccount({ id, originSeedTab: "write-seed", guard: null, secret });
    }

    function rowText(which: "seed" | "key0" | "key1"): string {
      return screen.getByTestId(`legacy-prime-migration-arweave-check-${which}`).textContent ?? "";
    }
    function continueBtn(): HTMLButtonElement {
      return screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement;
    }
    function generateBtn(): HTMLButtonElement {
      return screen.getByTestId("legacy-prime-migration-arweave-generate") as HTMLButtonElement;
    }
    function unlockInput(): HTMLElement {
      return screen.getByTestId("wizard-unlock-prompt-input");
    }
    function unlockSubmit(): HTMLElement {
      return screen.getByTestId("wizard-unlock-prompt-submit");
    }

    /** Walks to the Arweave step and waits for its check to settle
     *  UNSATISFIED with a usable Generate button — i.e. the fixture really
     *  needs generating, and the button really is live. */
    async function arriveNeedingGeneration(): Promise<void> {
      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await waitFor(() => expect(generateBtn().disabled).toBe(false));
    }

    /** A derivation stub with the two params typed exactly as the wizard's
     *  own `ensurePrimeArweaveSeed` prop declares them. */
    type EnsureArgs = [
      words: { bitString: string; words?: readonly string[] },
      opts?: {
        missingIndexes?: readonly number[];
        onProgress?: (p: ArweaveDerivationProgress) => void;
      },
    ];

    it("generating on a codex missing BOTH accounts asks for [0, 1] and — once the real writes land — flips all three rows to satisfied and opens Continue", async () => {
      const target = await arweaveStepTarget("arweave-step-generate-both");
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });

      await arriveNeedingGeneration();
      expect(rowText("seed")).toMatch(/missing/i);

      await act(async () => {
        fireEvent.click(generateBtn());
      });

      await waitFor(() => expect(rowText("key1")).toMatch(/satisfied/i));
      expect(rowText("seed")).toMatch(/satisfied/i);
      expect(rowText("key0")).toMatch(/satisfied/i);
      await waitFor(() => expect(continueBtn().disabled).toBe(false));

      // The derivation is asked for exactly what the step's OWN evaluation
      // found missing, with the chosen account's own words.
      expect(ensurePrimeArweaveSeed).toHaveBeenCalledTimes(1);
      const [words, opts] = ensurePrimeArweaveSeed.mock.calls[0]! as EnsureArgs;
      expect(words.bitString).toBe(FINALIZE_BIT_STRING);
      expect(words.words).toEqual(FINALIZE_WORDS);
      expect(opts?.missingIndexes).toEqual([0, 1]);
      // ...and the end state is real, not claimed.
      expect([...store.getState().foreignKeys.map((k) => k.index)].sort()).toEqual([0, 1]);
    });

    it("generating on a codex that already holds #0 asks for ONLY #1", async () => {
      const target = await arweaveStepTarget("arweave-step-generate-only-key1");
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      await act(async () => {
        await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING, indexes: [0] });
      });

      await arriveNeedingGeneration();
      await act(async () => {
        fireEvent.click(generateBtn());
      });

      await waitFor(() => expect(rowText("key1")).toMatch(/satisfied/i));
      // The one distinction this test exists for: an RSA-4096 key the codex
      // already holds must not be re-derived (seconds of work, for nothing).
      const [, opts] = ensurePrimeArweaveSeed.mock.calls[0]! as EnsureArgs;
      expect(opts?.missingIndexes).toEqual([1]);
      await waitFor(() => expect(continueBtn().disabled).toBe(false));
    });

    it("a generator that RESOLVES WITHOUT WRITING leaves Continue blocked and names what is still missing", async () => {
      const target = await arweaveStepTarget("arweave-step-generate-resolves-empty");
      // THE TRAP, verbatim: this resolves. It writes nothing and reports
      // nothing — which is what a partial delivery looks like from the
      // caller's side, since only a zero-key derivation rejects. If success
      // were inferred from the promise, this fixture would walk into
      // Finalize and be told it is eligible.
      const ensurePrimeArweaveSeed = vi.fn(async (): Promise<void> => {});
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });

      await arriveNeedingGeneration();
      await act(async () => {
        fireEvent.click(generateBtn());
      });

      const error = await screen.findByTestId("legacy-prime-migration-arweave-generate-error");
      expect(ensurePrimeArweaveSeed).toHaveBeenCalledTimes(1);
      expect(error.textContent).toMatch(/#0 and #1/);
      expect(error.textContent).toMatch(/no Arweave seed/i);
      expect(rowText("key0")).toMatch(/missing/i);
      expect(rowText("key1")).toMatch(/missing/i);
      await waitFor(() => expect(continueBtn().disabled).toBe(true));
      fireEvent.click(continueBtn());
      expect(screen.getByTestId("legacy-prime-migration-arweave-step")).toBeTruthy();
      expect(screen.queryByTestId("legacy-prime-migration-finalize")).toBeNull();
      expect(store.getState().primeAlignment).toBe("legacy");
    });

    it("the progress line reports the derivation's OWN events while it runs, holds Generate shut meanwhile, and is gone once it settles", async () => {
      const target = await arweaveStepTarget("arweave-step-generate-progress");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let report!: (p: { index: number; delivered: number; total: number }) => void;
      const ensurePrimeArweaveSeed = vi.fn(
        async (...[words, opts]: EnsureArgs): Promise<void> => {
          report = opts!.onProgress!;
          report({ index: 0, delivered: 0, total: 2 });
          await gate;
          await installMasterArweaveAccounts({ bitString: words.bitString, indexes: [0, 1] });
        },
      );
      await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });

      await arriveNeedingGeneration();
      await act(async () => {
        fireEvent.click(generateBtn());
      });

      const progress = await screen.findByTestId("legacy-prime-migration-arweave-progress");
      expect(progress.textContent).toMatch(/#0/);
      expect(progress.textContent).toMatch(/0 of 2/);
      expect(generateBtn().disabled).toBe(true);

      // Driven ONLY by `onProgress` — no timer, no synthetic percentage: the
      // line moves when, and only when, the derivation says it moved.
      await act(async () => {
        report({ index: 1, delivered: 1, total: 2 });
      });
      expect(screen.getByTestId("legacy-prime-migration-arweave-progress").textContent)
        .toMatch(/#1/);
      expect(screen.getByTestId("legacy-prime-migration-arweave-progress").textContent)
        .toMatch(/1 of 2/);

      await act(async () => {
        release();
        await gate;
      });
      await waitFor(() =>
        expect(screen.queryByTestId("legacy-prime-migration-arweave-progress")).toBeNull(),
      );
      await waitFor(() => expect(rowText("key1")).toMatch(/satisfied/i));
    });

    /**
     * THE REPORTED GAP, on this very screen: *"We need the progress bar we
     * already built in for this to be shown here, the one that shows the
     * tries, etc, we've already built it."* The bar is `RunProgress`
     * (codex-arweave's `ArweaveSeedsArea.tsx`), and the two tests below pin
     * the two modes its status line distinguishes — a LIVE prime search
     * (`search` present) and a DELIVERED key (`search` absent). Getting the
     * second one wrong is exactly how a bar ends up frozen or lying.
     */
    it("a progress event carrying a live prime SEARCH renders RunProgress's full status line and fills the bar to the library's own percent", async () => {
      const target = await arweaveStepTarget("arweave-step-progress-search");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ensurePrimeArweaveSeed = vi.fn(
        async (...[words, opts]: EnsureArgs): Promise<void> => {
          opts!.onProgress!({
            index: 0,
            delivered: 0,
            total: 2,
            search: {
              position: 1,
              totalCount: 2,
              stage: "q",
              attempts: 1234,
              grandAttempts: 98765,
              percent: 37,
            },
          });
          await gate;
          await installMasterArweaveAccounts({ bitString: words.bitString, indexes: [0, 1] });
        },
      );
      await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });

      await arriveNeedingGeneration();
      await act(async () => {
        fireEvent.click(generateBtn());
      });

      await screen.findByTestId("legacy-prime-migration-arweave-progress");
      // Field for field and separator for separator, the line the owner
      // already reads on the Arweave tab.
      expect(screen.getByTestId("legacy-prime-migration-arweave-progress-search").textContent)
        .toBe("Position 1 of 2 · prime Q · 1,234 this search · 98,765 total · 37%");
      // Filled from the LIBRARY's own percent — not from the delivered count,
      // which is 0 of 2 here. A bar sitting at 0% through a minutes-long
      // search IS the defect being closed.
      const bar = screen.getByTestId("legacy-prime-migration-arweave-progress-bar");
      expect(bar.getAttribute("role")).toBe("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("37");
      expect(bar.getAttribute("data-percent")).toBe("37");
      expect(bar.getAttribute("aria-valuemin")).toBe("0");
      expect(bar.getAttribute("aria-valuemax")).toBe("100");

      await act(async () => {
        release();
        await gate;
      });
      await waitFor(() =>
        expect(screen.queryByTestId("legacy-prime-migration-arweave-progress")).toBeNull(),
      );
    });

    it("a DELIVERED-key event (no search detail) drops the status line and falls back to the delivered/total percent", async () => {
      const target = await arweaveStepTarget("arweave-step-progress-delivered");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let report!: (p: ArweaveDerivationProgress) => void;
      const ensurePrimeArweaveSeed = vi.fn(
        async (...[words, opts]: EnsureArgs): Promise<void> => {
          report = opts!.onProgress!;
          report({
            index: 0,
            delivered: 0,
            total: 2,
            search: {
              position: 1,
              totalCount: 2,
              stage: "p",
              attempts: 7,
              grandAttempts: 7,
              percent: 12,
            },
          });
          await gate;
          await installMasterArweaveAccounts({ bitString: words.bitString, indexes: [0, 1] });
        },
      );
      await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });

      await arriveNeedingGeneration();
      await act(async () => {
        fireEvent.click(generateBtn());
      });
      await screen.findByTestId("legacy-prime-migration-arweave-progress-search");

      // The key LANDS: this event carries no `search`, and the search detail
      // from the previous event must not survive it — a stale "prime P · 7
      // this search" under a key that is already delivered is a lie about
      // work that is no longer happening.
      await act(async () => {
        report({ index: 0, delivered: 1, total: 2 });
      });

      expect(screen.queryByTestId("legacy-prime-migration-arweave-progress-search")).toBeNull();
      const bar = screen.getByTestId("legacy-prime-migration-arweave-progress-bar");
      expect(bar.getAttribute("aria-valuenow")).toBe("50");
      expect(bar.getAttribute("data-percent")).toBe("50");

      await act(async () => {
        release();
        await gate;
      });
      await waitFor(() =>
        expect(screen.queryByTestId("legacy-prime-migration-arweave-progress")).toBeNull(),
      );
    });

    it("a REJECTING generator shows its failure, leaves Continue blocked, and allows another attempt", async () => {
      const target = await arweaveStepTarget("arweave-step-generate-rejects");
      const ensurePrimeArweaveSeed = vi.fn(async (): Promise<void> => {
        throw new Error("the Arweave derivation worker died");
      });
      await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });

      await arriveNeedingGeneration();
      await act(async () => {
        fireEvent.click(generateBtn());
      });

      const error = await screen.findByTestId("legacy-prime-migration-arweave-generate-error");
      expect(error.textContent).toMatch(/the Arweave derivation worker died/);
      expect(screen.queryByTestId("legacy-prime-migration-arweave-progress")).toBeNull();
      expect(continueBtn().disabled).toBe(true);
      // Not a dead end: the button comes back, because nothing was lost.
      expect(generateBtn().disabled).toBe(false);
    });

    it("with NO ensurePrimeArweaveSeed prop, Generate is disabled with a stated reason rather than throwing on click", async () => {
      const target = await arweaveStepTarget("arweave-step-generate-unavailable");
      await renderFinalizeWizard(target); // no derivation prop at all

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await waitFor(() => expect(rowText("seed")).toMatch(/missing/i));

      expect(generateBtn().disabled).toBe(true);
      expect(screen.getByTestId("legacy-prime-migration-arweave-generate-unavailable").textContent)
        .toMatch(/not available/i);
      // A disabled control that says why is the minimum; crashing is not an
      // option (this file's own `continueBlockedReason` rule).
      fireEvent.click(generateBtn());
      expect(screen.queryByTestId("legacy-prime-migration-arweave-generate-error")).toBeNull();
      expect(continueBtn().disabled).toBe(true);
    });

    it("a codex that LOCKS on this step asks for the password inline, and never reports its accounts as 'missing'", async () => {
      const target = await arweaveStepTarget("arweave-step-locked-prompt");
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await act(async () => {
        await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING });
      });

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await waitFor(() => expect(rowText("seed")).toMatch(/satisfied/i));

      // The absolute unlock window lapsing while the owner reads this screen
      // is the normal case for a flow this long.
      await act(async () => {
        store.getState().actions.lock();
      });

      const prompt = await screen.findByTestId("wizard-unlock-prompt");
      expect(prompt.textContent).toMatch(/locked/i);
      // UNREADABLE IS NOT ABSENT. This codex holds #0 and #1 — nobody can
      // currently prove it. Printing "Missing" here would invite re-deriving
      // two RSA-4096 keys it already has.
      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-arweave-master-unresolved")).toBeTruthy(),
      );
      expect(rowText("seed")).not.toMatch(/missing/i);
      expect(rowText("key0")).not.toMatch(/missing/i);
      expect(rowText("key1")).not.toMatch(/missing/i);
      expect(continueBtn().disabled).toBe(true);
      expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent)
        .not.toMatch(/holds no Arweave seed/i);
      // And no Generate button on a codex nothing could be checked on.
      expect(screen.queryByTestId("legacy-prime-migration-arweave-generate")).toBeNull();
    });

    it("the correct password at that prompt re-runs the check, lets Continue through, and starts the absolute window exactly once", async () => {
      const target = await arweaveStepTarget("arweave-step-locked-then-passes");
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await act(async () => {
        await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING });
      });
      const authenticateSpy = vi.spyOn(store.getState().actions, "authenticate");

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await waitFor(() => expect(rowText("seed")).toMatch(/satisfied/i));
      await act(async () => {
        store.getState().actions.lock();
      });
      await screen.findByTestId("wizard-unlock-prompt");

      fireEvent.change(unlockInput(), { target: { value: FINALIZE_PASSWORD } });
      await act(async () => {
        fireEvent.click(unlockSubmit());
      });

      await waitFor(() => expect(rowText("seed")).toMatch(/satisfied/i));
      expect(rowText("key0")).toMatch(/satisfied/i);
      expect(rowText("key1")).toMatch(/satisfied/i);
      await waitFor(() => expect(continueBtn().disabled).toBe(false));
      expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
      // A GENUINELY locked codex is the one case allowed to start a new
      // window — once, from the password the user just proved.
      expect(authenticateSpy).toHaveBeenCalledTimes(1);
      expect(authenticateSpy.mock.calls[0]![0]).toBe(FINALIZE_PASSWORD);
      authenticateSpy.mockRestore();
    });

    it("a WRONG password at that prompt says so, keeps the step, and never starts the window from an unproven password", async () => {
      const target = await arweaveStepTarget("arweave-step-locked-wrong-pw");
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await act(async () => {
        await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING });
      });

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await waitFor(() => expect(rowText("seed")).toMatch(/satisfied/i));
      await act(async () => {
        store.getState().actions.lock();
      });
      await screen.findByTestId("wizard-unlock-prompt");

      fireEvent.change(unlockInput(), { target: { value: "definitely-the-wrong-password" } });
      await act(async () => {
        fireEvent.click(unlockSubmit());
      });

      await waitFor(() =>
        expect(screen.getByTestId("wizard-unlock-prompt-error").textContent).toBe(
          "Incorrect password — try again.",
        ),
      );
      expect(screen.getByTestId("legacy-prime-migration-arweave-step")).toBeTruthy();
      expect(continueBtn().disabled).toBe(true);
      // `authenticate()` caches whatever it is handed and never validates it,
      // so caching an unproven password would leave the codex "unlocked" with
      // a password that decrypts nothing — and suppress its own fix.
      expect(store.getState().passwordCache).toBeNull();
    });

    it("an UNLOCKED codex whose held password decrypts nothing prompts too, and the proven password runs the check without touching the absolute window", async () => {
      const target = await arweaveStepTarget("arweave-step-wrong-held-password");
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await act(async () => {
        await installMasterArweaveAccounts({ bitString: FINALIZE_BIT_STRING });
      });
      const authenticateSpy = vi.spyOn(store.getState().actions, "authenticate");
      // Unlocked — `getPassword()` succeeds — but holding a password nothing
      // in this codex was encrypted under. Written straight into the cache,
      // so the spy observes only what the WIZARD does.
      const staleCache = { value: "a-stale-wrong-password", expiresAt: Date.now() + 90 * 60_000 };

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await waitFor(() => expect(rowText("seed")).toMatch(/satisfied/i));
      await act(async () => {
        store.setState({ passwordCache: staleCache });
      });

      const prompt = await screen.findByTestId("wizard-unlock-prompt");
      expect(prompt.textContent).toMatch(/could not decrypt/i);
      expect(rowText("key0")).not.toMatch(/missing/i);

      fireEvent.change(unlockInput(), { target: { value: FINALIZE_PASSWORD } });
      await act(async () => {
        fireEvent.click(unlockSubmit());
      });

      // THE PROVEN PASSWORD IS THE ONE THE CHECK USES. Re-reading the cached
      // one it has never proven would fail this codex forever, on a password
      // the user has already corrected.
      await waitFor(() => expect(rowText("key1")).toMatch(/satisfied/i));
      await waitFor(() => expect(continueBtn().disabled).toBe(false));
      // THE INVARIANT (see `useEnsureCodexUnlocked`'s own doc): this codex was
      // already unlocked, so its absolute window keeps counting down from
      // where it was. `authenticate()` here would silently reset the TTL.
      expect(authenticateSpy).not.toHaveBeenCalled();
      expect(store.getState().passwordCache!.expiresAt).toBe(staleCache.expiresAt);
      authenticateSpy.mockRestore();
    });

    it("on that same codex, Generate is held back with a stated reason rather than writing an Arweave seed under the password the codex still holds", async () => {
      const target = await arweaveStepTarget("arweave-step-generate-password-mismatch");
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      // NOTHING installed: this codex genuinely needs generating, which is
      // what makes the hazard reachable.
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      const staleCache = { value: "a-stale-wrong-password", expiresAt: Date.now() + 90 * 60_000 };

      driveToArweaveStepViaKeepCurrent();
      await screen.findByTestId("legacy-prime-migration-arweave-step");
      await act(async () => {
        store.setState({ passwordCache: staleCache });
      });
      await screen.findByTestId("wizard-unlock-prompt");
      fireEvent.change(unlockInput(), { target: { value: FINALIZE_PASSWORD } });
      await act(async () => {
        fireEvent.click(unlockSubmit());
      });

      await waitFor(() => expect(rowText("seed")).toMatch(/missing/i));
      // `ensurePrimeArweaveSeed` encrypts what it writes under the password
      // the CODEX holds (it calls `getPassword()` inside its own package), not
      // under the one just proven here. Running it would leave an Arweave
      // seed encrypted under a password nothing else in this codex uses — a
      // row that can never be read back, and never satisfy this check.
      expect(generateBtn().disabled).toBe(true);
      expect(screen.getByTestId("legacy-prime-migration-arweave-generate-unavailable").textContent)
        .toMatch(/password/i);
      fireEvent.click(generateBtn());
      expect(ensurePrimeArweaveSeed).not.toHaveBeenCalled();
      expect(store.getState().arweaveSeeds).toEqual([]);
    });
  });

  /**
   * `docs/work/migration-pending-apply/design.md` — T2.
   *
   * THE OWNER'S MODEL, stated twice with the same analogy: *"using the wizard
   * for the first time places the codex in a pending state. This pending state
   * can be placed in a new pending state forever, until the apply button seals
   * it forever. The finalize at the end simply writes a new pending state."*
   *
   * Finalize used to do the opposite of both halves: it STAMPED
   * `primeAlignment: "aligned"` (which `ensurePrimeSeedAccountPairingAndPromote`
   * and `promoteSeedAndAccountToPrime` then throw on permanently, with no
   * un-stamp anywhere), and on the clean `"success"` path it called
   * `completeMigration()`, which DELETES `migrationProgress` outright. So a
   * finished finalize left nothing to apply and dead-ended any second run.
   *
   * Every assertion here is against the STORE — the thing the Apply button and
   * the Codex ID page actually read — never against a spy on the actions,
   * which would pass just as happily on a record that was written and then
   * deleted a tick later.
   */
  describe("Finalize writes a pending plan and no longer seals (migration-pending-apply T2)", () => {
    /** The guard the "keep current" + Stoic Dalos walk derives, so these
     *  fixtures reach the plain `"success"` terminal status. */
    const matchingGuardForWalk = (): IOuroAccount["guard"] => ({
      pred: "keys-all",
      keys: [
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0).publicKey,
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey,
      ],
    });

    async function pendingTarget(
      id: string,
      guard: IOuroAccount["guard"],
    ): Promise<IOuroAccount> {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      return makeAccount({ id, originSeedTab: "write-seed", guard, secret });
    }

    /**
     * The user closing the Codex ID panel and opening the wizard again later,
     * over the SAME persisted codex: a second `<CodexProvider>` mount on the
     * same `MemoryCodexAdapter`, which re-hydrates everything the first run
     * wrote (the promoted account, the Codex Master Seed row, the Arweave
     * rows, and the recorded run). A fresh store, deliberately — re-opening
     * the wizard inside the same mount cannot reset the finalize panel, and
     * would not exercise the re-hydration the real second run depends on.
     *
     * The codex comes back LOCKED (the password cache is store state, not
     * persisted), so this re-authenticates exactly as the real panel's unlock
     * gate does.
     */
    async function reopenWizardOverSameCodex(
      targetAccount: IOuroAccount,
      props: Partial<Parameters<typeof LegacyPrimeMigrationWizard>[0]> = {},
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
            currentPrimeAccount={targetAccount}
            allAccounts={[targetAccount]}
            {...props}
          />
        </CodexProvider>,
      );
      await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
      act(() => {
        capturedStore!.getState().actions.authenticate(FINALIZE_PASSWORD, 60);
      });
      return capturedStore!;
    }

    /** The rest of the walk for a RESUMED wizard, which re-opens on the
     *  payment page with every choice restored (`resolveMigrationResume`),
     *  not on the intro. Same clicks `driveToArweaveStepViaKeepCurrent` makes
     *  from "payment" onward. */
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

    // The record IS the pending state. `completeMigration()` on the success
    // path deleted it (persisting `null`, which makes the adapter REMOVE the
    // shard), so the Apply button would have had nothing to read and the
    // user's finalized plan was gone the instant it was made.
    it("a successful finalize leaves migrationProgress PRESENT, holding a pending plan that names the chosen account and the keys it just derived", async () => {
      const target = await pendingTarget("finalize-pending-success", matchingGuardForWalk());
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending).toBeTruthy();
      });
      const plan = store.getState().migrationProgress!.pending!;
      expect(plan.accountId).toBe(target.id);
      // The Chainweb seed Write 1 paired this account with — the same id the
      // Codex Master Seed row names.
      expect(plan.seedId).toBe(store.getState().codexMasterSeed?.chainwebSeedId);
      expect(plan.seedId).toBeTruthy();
      expect(plan.arweaveSeedId).toBe("finalize-installed-arweave-seed");
      // Exactly what Write 3 locked: payment at position 0, the recommended
      // single guard key at position 1.
      expect(plan.paymentPublicKey).toBe(
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0).publicKey,
      );
      expect(plan.guardPublicKeys).toEqual([
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey,
      ]);
      expect(Number.isNaN(Date.parse(plan.finalizedAt))).toBe(false);
      // The commit record Finalize built on the way is NOT thrown away by the
      // pending write.
      expect(store.getState().migrationProgress?.committed?.accountId).toBe(target.id);
      // Nothing is applied yet — Apply is what sets this.
      expect(store.getState().migrationProgress?.appliedAt).toBeUndefined();
    });

    // The seal moved to Apply. Stamping it here is what made the "Retry the
    // Eligibility Wizard" button a dead end — and it would also make Apply a
    // no-op on a decision the user never confirmed.
    it("a successful finalize does NOT stamp primeAlignment — it stays \"legacy\" until Apply seals it", async () => {
      const target = await pendingTarget("finalize-pending-no-seal", matchingGuardForWalk());
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      expect(store.getState().primeAlignment).toBe("legacy");
    });

    // `"eligible-rotation-outstanding"` differs from `"success"` ONLY in
    // whether the user's chosen key changes are already on chain — which is
    // what the Apply popup computes separately (`computeOutstandingKeyChanges`).
    // Both are completed finalizes, so BOTH must leave something to apply;
    // dropping this one would deny the Apply button to exactly the users who
    // have transactions to execute.
    it("the eligible-rotation-outstanding path ALSO leaves a pending plan", async () => {
      const target = await pendingTarget("finalize-pending-rotation-outstanding", null);
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-committed")).toBeTruthy(),
      );
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending).toBeTruthy();
      });
      expect(store.getState().migrationProgress!.pending!.accountId).toBe(target.id);
      expect(store.getState().primeAlignment).toBe("legacy");
    });

    // THE REGRESSION TEST for the dead end the owner would have hit on the
    // new "Retry the Eligibility Wizard" button. With the stamp still at
    // finalize, Write 1's `ensurePrimeSeedAccountPairingAndPromote` throws
    // `CodexError` ("already locked") the moment the second run commits, and
    // the panel lands on the red terminal box instead of a new plan.
    it("running the whole wizard a SECOND time succeeds and REPLACES the pending plan", async () => {
      const target = await pendingTarget("finalize-pending-second-run", matchingGuardForWalk());
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await driveToFinalizeViaKeepCurrent();
      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      await waitFor(() => {
        expect(store.getState().migrationProgress?.pending).toBeTruthy();
      });
      const firstPlan = store.getState().migrationProgress!.pending!;

      // ── the user comes back and runs the whole thing again ──
      const second = await reopenWizardOverSameCodex(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      driveResumedWalkToArweaveStep();
      await passArweaveStep();
      await settleChoices(); // the second run's own explicit commit (T4)

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      expect(screen.queryByTestId("legacy-prime-migration-finalize-error")).toBeNull();
      // A NEW plan, not a merge onto the old one, and still unsealed.
      await waitFor(() => {
        expect(second.getState().migrationProgress?.pending?.finalizedAt)
          .not.toBe(firstPlan.finalizedAt);
      });
      const secondPlan = second.getState().migrationProgress!.pending!;
      expect(secondPlan.accountId).toBe(target.id);
      expect(secondPlan.guardPublicKeys).toEqual([
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey,
      ]);
      expect(second.getState().migrationProgress?.appliedAt).toBeUndefined();
      expect(second.getState().primeAlignment).toBe("legacy");
    });

    // An INCOMPLETE migration has nothing to apply: without the master
    // Arweave accounts there is no prime ArWeave address to compare against,
    // so eligibility genuinely cannot be claimed — and a plan here would let
    // Apply stamp alignment over a codex that is not eligible at all.
    it("the arweave-unavailable path writes NO pending plan", async () => {
      const target = await pendingTarget("finalize-pending-arweave-unavailable", matchingGuardForWalk());
      const store = await renderFinalizeWizard(target); // no ensurePrimeArweaveSeed at all
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      driveToArweaveStepViaKeepCurrent();
      await commitFromArweaveStepWith(() => dropArweaveAccountsFrom(store));

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-error")).toBeTruthy(),
      );
      expect(store.getState().migrationProgress?.pending).toBeUndefined();
      expect(store.getState().primeAlignment).toBe("legacy");
    });
  });

  /**
   * `docs/work/migration-pending-apply/plan.md` — T4.
   *
   * THE REPORTED DEFECT: the commit was fired as a SIDE EFFECT of a step
   * transition (`handleContinue`'s `"arweave"` branch did `setStep
   * ("finalize")` and then `void runFinalize()` in the same breath), and the
   * finalize panel had no idle state at all — `finalizeStatus` initialised to
   * `"running"`, so the screen structurally assumed the commit was already in
   * flight by the time it mounted. There was nothing to press, and nothing
   * the user could decide once they got there.
   *
   * Owner: *"the wizard has to end with a finalize button 'Settle Choices'.
   * This button must be clickable once all the squares are lit (there might
   * be some moment where the squares are not lit, as readings are being
   * done). Once all the squares are lit at the end, the user clicks Settle
   * Choices, which is the finalize button, and clicking it is the final
   * action that settles the selected choices. Right now I don't think it
   * works this way."*
   *
   * And, asked what "all squares lit" means: *"all squares lit, by this i
   * mean, one blue one red one brown one pink, in the sense that we have all
   * the colour lit."* So the gate is each ROLE lit SOMEWHERE on the
   * dashboard, never every square on every card — roles legitimately split
   * across cards, and two of the dashboard's cards hardcode squares dark by
   * design.
   */
  describe("the wizard ends with an explicit \"Settle Choices\" button (T4)", () => {
    const walkMatchingGuard = (): IOuroAccount["guard"] => ({
      pred: "keys-all",
      keys: [
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 0).publicKey,
        deriveStoaDalosKeypairAtIndex(FINALIZE_BIT_STRING, 1).publicKey,
      ],
    });

    async function settleTarget(id: string, guard: IOuroAccount["guard"]): Promise<IOuroAccount> {
      const secret = await encryptStringV2(FINALIZE_WORDS.join(" "), FINALIZE_PASSWORD);
      return makeAccount({ id, originSeedTab: "write-seed", guard, secret });
    }

    /** intro -> finalize, stopping ON the idle finalize screen with nothing
     *  committed — the state this whole suite is about. */
    async function arriveAtIdleFinalize(): Promise<void> {
      driveToArweaveStepViaKeepCurrent();
      await passArweaveStep();
      await screen.findByTestId("legacy-prime-migration-settle-choices");
    }

    /** The same walk, but choosing "Keep this guard as is" on the guard page
     *  — the one decision that can leave the brown square permanently dark
     *  for a guard that names no keys. */
    async function driveToIdleFinalizeKeepingGuard(): Promise<void> {
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
      await screen.findByTestId("legacy-prime-migration-guard-section");
      fireEvent.click(
        within(screen.getByTestId("legacy-prime-migration-guard-option-keep")).getByRole("button"),
      );
      fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // guard -> review
      fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // review -> arweave
      await passArweaveStep();
      await screen.findByTestId("legacy-prime-migration-settle-choices");
    }

    function settleButton(): HTMLButtonElement {
      return screen.getByTestId("legacy-prime-migration-settle-choices") as HTMLButtonElement;
    }

    // THE INVARIANT THE OLD SHAPE COULD NOT HAVE: reaching the last screen is
    // not the same event as deciding to write. Every one of `runFinalize`'s
    // five writes is asserted ABSENT here — a spy on the actions would pass
    // just as happily on a commit that ran and failed.
    it("arriving at the finalize step starts NOTHING — it offers Settle Choices and the codex is untouched", async () => {
      const target = await settleTarget("settle-arrive-writes-nothing", walkMatchingGuard());
      const ensurePrimeArweaveSeed = fakeArweaveDerivation();
      const store = await renderFinalizeWizard(target, { ensurePrimeArweaveSeed });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await arriveAtIdleFinalize();
      // The gate OPENS for this fixture (all four colours light) — so the
      // button being there and enabled, with nothing written, is the fact.
      await waitFor(() => expect(settleButton().disabled).toBe(false));

      expect(screen.queryByTestId("legacy-prime-migration-finalize-running")).toBeNull();
      expect(screen.queryByTestId("legacy-prime-migration-finalize-success")).toBeNull();
      expect(screen.queryByTestId("legacy-prime-migration-finalize-committed")).toBeNull();
      expect(screen.queryByTestId("legacy-prime-migration-finalize-error")).toBeNull();

      expect(store.getState().primeAlignment).toBe("legacy");
      expect(store.getState().codexMasterSeed).toBeFalsy();
      expect(store.getState().migrationProgress?.pending).toBeUndefined();
      expect(store.getState().migrationProgress?.committed).toBeUndefined();
      expect(store.getState().masterKeyLocks).toEqual([]);
      expect(store.getState().ouroAccounts.some((a) => a.id === target.id && a.isPrime)).toBe(false);
      expect(ensurePrimeArweaveSeed).not.toHaveBeenCalled();
    });

    it("clicking Settle Choices runs the commit and reaches the success panel", async () => {
      const target = await settleTarget("settle-click-commits", walkMatchingGuard());
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await arriveAtIdleFinalize();
      await settleChoices();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      await waitFor(() => expect(store.getState().migrationProgress?.pending).toBeTruthy());
      expect(store.getState().codexMasterSeed).toBeTruthy();
      // The button it was pressed on is gone — the commit is not re-runnable
      // by a second click on a screen that has already written.
      expect(screen.queryByTestId("legacy-prime-migration-settle-choices")).toBeNull();
    });

    // The owner's parenthetical: *"there might be some moment where the
    // squares are not lit, as readings are being done"*. "Not yet asked",
    // "asked and false" and "being asked right now" are three different
    // facts, and the violet (Arweave) role had NO in-flight flag at all —
    // its `seedDashboardArweaveAccountsHeld` was a bare boolean starting
    // `false`, so a re-read looked identical to a settled "no".
    //
    // Nothing is awaited between the `act` and the assertions, deliberately:
    // the resolution is a real decrypt-and-compare, so the only way to
    // observe the in-flight window deterministically is to read the DOM in
    // the very same synchronous turn the effect re-armed in.
    it("Settle Choices is BLOCKED while the Arweave role is being re-read, and says it is still checking", async () => {
      const target = await settleTarget("settle-arweave-resolving", walkMatchingGuard());
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await arriveAtIdleFinalize();
      await waitFor(() => expect(settleButton().disabled).toBe(false));

      // Another panel adds an unrelated Arweave account under this codex —
      // which re-arms the violet ticker's own resolution.
      act(() => {
        store.setState({
          foreignKeys: [
            ...store.getState().foreignKeys,
            {
              id: "unrelated-arweave-key",
              chainId: "arweave:mainnet",
              encryptedKeyfile: "encrypted-keyfile-ciphertext",
              seedId: "some-other-arweave-seed",
              index: 0,
            },
          ],
        });
      });

      expect(settleButton().disabled).toBe(true);
      expect(screen.getByTestId("legacy-prime-migration-settle-blocked").textContent)
        .toMatch(/still checking/i);
      expect(settleButton().title).toMatch(/still checking/i);

      // ...and it is a WINDOW, not a dead end: the answer lands and the gate
      // opens again.
      await waitFor(() => expect(settleButton().disabled).toBe(false));
    });

    // A colour that is SETTLED dark is a different statement from one still
    // being read, and the user is owed the difference by name. This fixture's
    // guard resolves to `{kind: "none"}` — `keysOf` returns `[]`, so no card
    // anywhere can attribute a single guard member and the brown square can
    // never light. A disabled button that said nothing would leave the owner
    // exactly where he was: on the last step, stuck.
    it("Settle Choices is BLOCKED when a colour is settled dark, and the reason NAMES that colour", async () => {
      const target = await settleTarget("settle-guard-dark", null);
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      // The walk's own default is the RECOMMENDED (derived) guard, which
      // lights brown off the chosen account's own fallback card — so this
      // one picks "Keep this guard as is" over a guard naming no keys at
      // all, which is what leaves the square dark for good.
      await driveToIdleFinalizeKeepingGuard();

      await waitFor(() => {
        expect(screen.getByTestId("legacy-prime-migration-settle-blocked").textContent)
          .toMatch(/guard/i);
      });
      const reason = screen.getByTestId("legacy-prime-migration-settle-blocked").textContent ?? "";
      expect(reason).toMatch(/brown|gold/i);
      expect(reason).not.toMatch(/still checking/i);
      expect(settleButton().disabled).toBe(true);

      // The gate holds in the HANDLER, not merely in the `disabled`
      // attribute — the same contract the Arweave step's own gate is pinned
      // on ("FINALIZE IS UNREACHABLE…" above): a keyboard or programmatic
      // activation must not slip past it either.
      fireEvent.click(settleButton());
      expect(screen.queryByTestId("legacy-prime-migration-finalize-running")).toBeNull();
      expect(store.getState().codexMasterSeed).toBeFalsy();
      expect(store.getState().migrationProgress?.pending).toBeUndefined();
    });

    // THE ESCAPE HATCH. Several colours can legitimately never light (a guard
    // resolving to `"none"`/`"unsupported"`/`"keyset-ref-unresolved"`, a kept
    // payment key belonging to nothing this codex holds, a locked codex), so
    // a strict gate on its own would strand the user on the last step with a
    // permanently dead button. `"finalize"` used to be forward-only BECAUSE
    // reaching it meant the commit had already run; in the idle state nothing
    // has been written, so going back is free — and it is the way to change
    // the choice the reason just complained about.
    it("Back from the idle finalize state returns to the Arweave step, with nothing written", async () => {
      const target = await settleTarget("settle-back-escape", null);
      const store = await renderFinalizeWizard(target, {
        ensurePrimeArweaveSeed: fakeArweaveDerivation(),
      });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      // Deliberately the TRAPPED fixture — a kept guard naming no keys, so
      // the brown square never lights and Settle can never open. Back is the
      // only way forward, and it has to work.
      await driveToIdleFinalizeKeepingGuard();
      await waitFor(() => expect(settleButton().disabled).toBe(true));

      fireEvent.click(screen.getByTestId("legacy-prime-migration-settle-back"));

      await screen.findByTestId("legacy-prime-migration-arweave-step");
      expect(screen.queryByTestId("legacy-prime-migration-finalize")).toBeNull();
      expect(store.getState().primeAlignment).toBe("legacy");
      expect(store.getState().codexMasterSeed).toBeFalsy();
      expect(store.getState().migrationProgress?.pending).toBeUndefined();
      expect(store.getState().migrationProgress?.committed).toBeUndefined();
      expect(store.getState().masterKeyLocks).toEqual([]);
    });

    // ...and the exception stops exactly where the writes begin. Once
    // `runFinalize` is in flight there is no safe "back": Write 1 promotes
    // an account and Write 3 makes keys non-removable.
    it("Back is NOT available once the commit is running", async () => {
      const target = await settleTarget("settle-back-gone-while-running", walkMatchingGuard());
      await renderFinalizeWizard(target, { ensurePrimeArweaveSeed: fakeArweaveDerivation() });
      await installMasterArweaveAccountsFor(FINALIZE_BIT_STRING);

      await arriveAtIdleFinalize();
      await waitFor(() => expect(settleButton().disabled).toBe(false));
      expect(screen.getByTestId("legacy-prime-migration-settle-back")).toBeTruthy();

      // No await between the click and the assertion: `runFinalize` sets
      // `"running"` synchronously, so this reads the in-flight state itself
      // rather than the terminal one it settles into.
      act(() => { fireEvent.click(settleButton()); });
      expect(screen.getByTestId("legacy-prime-migration-finalize-running")).toBeTruthy();
      expect(screen.queryByTestId("legacy-prime-migration-settle-back")).toBeNull();
      expect(screen.queryByTestId("legacy-prime-migration-settle-choices")).toBeNull();

      await waitFor(() =>
        expect(screen.getByTestId("legacy-prime-migration-finalize-success")).toBeTruthy(),
      );
      expect(screen.queryByTestId("legacy-prime-migration-settle-back")).toBeNull();
    });
  });
});

describe("LegacyPrimeMigrationWizard — Account step layout (wizard-page2-and-dashboard-fixes)", () => {
  // owner (this round): "there are a lot of ouronet Accounts... we also
  // add to it a search bar that searches for a given name" — a plain
  // client-side filter over the already-loaded candidate list.
  it("filters the existing-account list by name, and clearing the search restores every candidate", async () => {
    const current = makeAccount({ id: "current-1" });
    const hodler = makeAccount({ id: "hodler-1", name: "AncientHodler" });
    const pleb = makeAccount({ id: "pleb-1", name: "AncientPleb" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current, hodler, pleb] });
    await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler-1");

    fireEvent.change(screen.getByTestId("legacy-prime-migration-account-existing-search"), {
      target: { value: "hodler" },
    });
    expect(screen.getByTestId("legacy-prime-migration-account-existing-item-hodler-1")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-account-existing-item-pleb-1")).toBeNull();

    fireEvent.change(screen.getByTestId("legacy-prime-migration-account-existing-search"), {
      target: { value: "" },
    });
    expect(screen.getByTestId("legacy-prime-migration-account-existing-item-hodler-1")).toBeTruthy();
    expect(screen.getByTestId("legacy-prime-migration-account-existing-item-pleb-1")).toBeTruthy();
  });

  it("the existing-account list has its own bounded, independently-scrolling region, distinct from the modal's own scroll", async () => {
    const current = makeAccount({ id: "current-1" });
    const hodler = makeAccount({ id: "hodler-1", name: "AncientHodler" });
    openAccountStep({ currentPrimeAccount: current, allAccounts: [current, hodler] });
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler-1");
    const listbox = item.closest('[role="listbox"]') as HTMLElement;
    expect(listbox.style.overflowY).toBe("auto");
    expect(listbox.style.maxHeight).not.toBe("");
  });
});
