/**
 * `docs/work/wizard-seed-dashboard/plan.md` and
 * `docs/work/wizard-seed-dashboard-refinements/plan.md` — the migration
 * wizard's "Settling Dashboard": one CARD per seed actually backing the
 * chosen account / settled payment key / settled guard key(s) / the
 * codex's Prime Arweave address, each card containing one SUB-ROW per
 * distinct derivation label in play for that seed this run.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

const WORDS = "river stone ember";
const WORDS_ARR = WORDS.split(" ");
// Branches on the ciphertext (unlike a plain constant mock) so the violet
// (Arweave) ticker tests can control exactly which "secret" decrypts to
// which bitstring, while every OTHER secret (the chosen account's own,
// which `reviewPreview` always decrypts) still falls through to the same
// WORDS every earlier test in this file already relies on.
const ARWEAVE_DECRYPT_MAP: Record<string, string> = {};
// Lets a test hold a SPECIFIC ciphertext's own decrypt pending until it
// explicitly releases it — used to reproduce the real race this round's
// "switching accounts back and forth" bug report exercises (a slow/
// in-flight async resolution for one account choice outliving a LATER,
// synchronous choice, then clobbering it once it finally settles).
const PENDING_DECRYPTS: Record<string, Promise<void>> = {};
// How many times each specific ciphertext has actually been handed to
// `smartDecrypt` — the only way to prove a decrypt did NOT happen
// (`settled-master-identity/design.md` §2's seed-bitstring memo: a real
// decrypt here is 600,000 PBKDF2 iterations, so "it still lit up" is not
// evidence the work was skipped). Counted at CALL ENTRY, before any
// `PENDING_DECRYPTS` await, so a held-pending decrypt still counts as
// having been requested. Shared across every test in this file, so a
// counting assertion must use ciphertexts unique to its own fixture.
const DECRYPT_COUNTS: Record<string, number> = {};
vi.mock("@stoachain/stoa-core/crypto", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    smartDecrypt: async (ciphertext: string) => {
      DECRYPT_COUNTS[ciphertext] = (DECRYPT_COUNTS[ciphertext] ?? 0) + 1;
      if (ciphertext in PENDING_DECRYPTS) await PENDING_DECRYPTS[ciphertext];
      return ARWEAVE_DECRYPT_MAP[ciphertext] ?? WORDS;
    },
  };
});

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";
import type { IOuroAccount, IStoaChainSeed, IArweaveSeed, IPureKeypair } from "../src/types/entities.js";

const PASSWORD = "seed-dashboard-test-pw";
const BITS = seedWordsToBitString(WORDS_ARR);
const KEY0 = deriveStoaDalosKeypairAtIndex(BITS, 0).publicKey; // what "derive" (recommended payment) yields
const KEY1 = deriveStoaDalosKeypairAtIndex(BITS, 1).publicKey; // what "recommended-single-key" (guard) yields

const ACCOUNT_PUB = "1".repeat(64);
const GUARD_KEY_A = "2".repeat(64);
const GUARD_KEY_B = "3".repeat(64);
const GUARD_KEY_C = "4".repeat(64);
const UNRELATED_1 = "5".repeat(64);
const UNRELATED_2 = "6".repeat(64);

function account(o: Partial<IOuroAccount> & { id: string }): IOuroAccount {
  return {
    version: "1.0", isSmart: false, address: `Ѻ.${o.id}-address`, guard: null,
    stoaChainLedger: null, publicKey: "pub", secret: `ct-${o.id}`,
    backup: "ct", originSeedTab: "write-seed", ...o,
  };
}

let store: ReturnType<typeof useCodexStore> | null = null;
function Grab() { store = useCodexStore(); return null; }

async function renderWizard(
  seeds: IStoaChainSeed[],
  current: IOuroAccount,
  opts: {
    currentPrimeSeed?: IStoaChainSeed | null;
    pureKeypairs?: readonly IPureKeypair[];
    describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
  } = {},
) {
  store = null;
  render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <Grab />
      <LegacyPrimeMigrationWizard
        open onClose={() => {}}
        currentPrimeAccount={current}
        currentPrimeSeed={opts.currentPrimeSeed}
        allAccounts={[current]}
        allSeeds={seeds}
        pureKeypairs={opts.pureKeypairs}
        describeKeyset={opts.describeKeyset}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
}

/** Advances intro -> account. `accountChoice` now defaults to
 *  `{kind:"keep-current"}` (owner, this round: "there is no state of no
 *  account selected"), so the Settling Dashboard is already populated by
 *  the time this returns, with no click needed on the account page
 *  itself — the explicit click below is kept only to exercise the
 *  already-selected option's own idempotent re-click, matching every
 *  other test file's own `openStep3`-style helper in this package. */
async function toAccountStep() {
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
  const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
  fireEvent.click(within(keepOption).getByRole("button"));
}

function dashboardCard(seedId: string) {
  return screen.getByTestId(`legacy-prime-migration-settling-dashboard-card-${seedId}`);
}

function subRowTestid(seedId: string, index: number) {
  return `legacy-prime-migration-settling-dashboard-card-${seedId}-subrow-${index}`;
}

// `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "E": every group
// inside the custom guard editor starts collapsed unless it already holds a
// selected key, so a row inside a given group is only queryable/clickable
// once that group's own disclosure header has been opened.
function expandGroup(editor: HTMLElement, n: number) {
  fireEvent.click(within(editor).getByTestId(`legacy-prime-migration-guard-custom-group-${n}`));
}

describe("Settling Dashboard — placement", () => {
  it("is absent on the intro step, present once the account step is reached", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seed });
    expect(screen.queryByTestId("legacy-prime-migration-settling-dashboard")).toBeNull();

    await toAccountStep();
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-settling-dashboard")).toBeTruthy();
    });
  });

  // owner: "The Settling Dashboard is fixed and stays with the page." A
  // manual `position: sticky, top: 0` wrapper around the dashboard was
  // tried first, but the owner's live-testing feedback (this round) was
  // that scrolling down STILL carried the title/nav header AND the
  // dashboard away — because `CodexModalShell`'s own header row sits in
  // the SAME scrolling box as everything in `children` whenever
  // `footerSplit` is false (the case for this wizard's own call site, on
  // desktop), so `position: sticky`'s "nearest scrolling ancestor" was
  // the WHOLE card, header included, not a dedicated scroll region. Now
  // fixed by handing the dashboard (and the blocked-reason line) to
  // `CodexModalShell`'s own `topBar` prop (with `splitOnDesktop`, so the
  // existing mobile-only split mechanism also applies here) — `topBar`
  // is rendered OUTSIDE the scrolling `-body` element by construction,
  // not merely styled to look fixed.
  it("renders OUTSIDE the modal's own scrolling body — pinned structurally via CodexModalShell's topBar, not a CSS sticky hack", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seed });
    await toAccountStep();

    const dashboard = await screen.findByTestId("legacy-prime-migration-settling-dashboard");
    const body = screen.getByTestId("legacy-prime-migration-wizard-modal-body");
    expect(body.contains(dashboard)).toBe(false);
  });

  // `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "F" — the
  // dashboard above is only proven to be OUTSIDE `-body`; it could still
  // be arriving via `topBar` (stacked above the body, same as before this
  // round) rather than the new `sidebar` column. This proves it lands
  // SPECIFICALLY inside the sidebar column CodexModalShell renders for a
  // `sidebar` prop — same DOM shape (`overflowY: auto` + `borderRight`)
  // `tests/ui-codex-modal-shell-mobile.test.tsx`'s own sidebar tests
  // assert on `CodexModalShell` directly — and that the modal is visibly
  // wider once that column is showing than it is on "intro" (where
  // there's no sidebar at all).
  it("renders specifically inside CodexModalShell's new sidebar column (not merely outside -body), with the modal wider than on intro", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seed });
    const card = screen.getByTestId("legacy-prime-migration-wizard-modal").firstElementChild as HTMLElement;
    const introMaxWidth = card.style.maxWidth;

    await toAccountStep();

    const dashboard = await screen.findByTestId("legacy-prime-migration-settling-dashboard");
    const sidebarColumn = dashboard.parentElement as HTMLElement;
    expect(sidebarColumn.style.overflowY).toBe("auto");
    expect(sidebarColumn.style.borderRight).toBe("1px solid rgb(38, 38, 38)");

    expect(card.style.maxWidth).not.toBe(introMaxWidth);
  });
});

describe("Settling Dashboard — view-seed button activation", () => {
  // owner (this round): "as long as the Ouronet Account isnt selected,
  // which comes in step 2... the View Seed button is disabled. Only
  // when step 2 has popped, then the Prime Codex Account is the default
  // selection, THEN the view seed button is lit." — the card/ticker data
  // can resolve (via the synchronous `currentPrimeSeed` shortcut) WHILE
  // the account step's own candidate-probing scan is still running; the
  // button must stay disabled through that window regardless, and light
  // up only once the account step's REAL content (not the probe-progress
  // panel) has rendered.
  it("the view-seed button is disabled while the account step's own candidate probe is still scanning, then enables once it settles", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    // A second candidate account is what makes the probe pass actually
    // run (and take more than one tick) rather than settling instantly.
    const other = account({ id: "other", name: "OtherAccount" });
    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seed}
          allAccounts={[current, other]}
          allSeeds={[seed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    const testid = subRowTestid("seed-1", 0);
    const card = await screen.findByTestId("legacy-prime-migration-settling-dashboard-card-seed-1");
    const button = within(card).getByTestId(`${testid}-expand`) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await screen.findByTestId("legacy-prime-migration-account-option-keep");
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  // Owner (live testing, this round): "it seems the blue ticker isnt
  // appearing anymore... or it did, but took a while. we should at
  // least show some sort of progress that its being decrypted or
  // something." Every ticker/button on the dashboard is already dark/
  // disabled while the account step's own candidate probe is scanning
  // (the fix above) — but nothing told the user THAT was what was
  // happening, so a genuinely slow probe just looked broken. A single
  // status line on the dashboard itself, shown for exactly the same
  // `viewSeedDisabled` window, closes that gap without duplicating it
  // per-card.
  it("shows a status line while the dashboard's tickers/buttons are disabled by the account probe, and hides it once settled", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const other = account({ id: "other", name: "OtherAccount" });
    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seed}
          allAccounts={[current, other]}
          allSeeds={[seed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    const dashboard = await screen.findByTestId("legacy-prime-migration-settling-dashboard");
    expect(within(dashboard).getByTestId("legacy-prime-migration-settling-dashboard-checking")).toBeTruthy();

    await screen.findByTestId("legacy-prime-migration-account-option-keep");
    await waitFor(() => {
      expect(within(dashboard).queryByTestId("legacy-prime-migration-settling-dashboard-checking")).toBeNull();
    });
  });

  // Owner (live testing, this round): "during loading when the View seed
  // is disabled, the blue tick should also be disabled. because it
  // becomes lit, when the first ouronet account is selected in step 2."
  // The card/ticker data can resolve (via the synchronous
  // `currentPrimeSeed` shortcut) WHILE the probe is still scanning — same
  // premature-lighting bug as the button, just on the ticker instead.
  it("the blue (account) ticker stays unlit while the account step's own candidate probe is still scanning, then lights up once it settles", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const other = account({ id: "other", name: "OtherAccount" });
    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seed}
          allAccounts={[current, other]}
          allSeeds={[seed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    const testid = subRowTestid("seed-1", 0);
    const card = await screen.findByTestId("legacy-prime-migration-settling-dashboard-card-seed-1");
    const ticker = within(card).getByTestId(`${testid}-ticker-account`);
    expect(ticker.getAttribute("data-lit")).toBe("false");

    await screen.findByTestId("legacy-prime-migration-account-option-keep");
    await waitFor(() => expect(ticker.getAttribute("data-lit")).toBe("true"));
  });
});

describe("Settling Dashboard — synchronous tickers", () => {
  // owner: "if you have the same seed words used with multiple
  // derivations to get all the components, congratulations you have one
  // single seed word set that can derive everything." The account role
  // ALWAYS labels Stoic Dalos Derivation; a `seedType: "stoic"` seed's own
  // default-derived payment key computes the LITERAL SAME label — so
  // account + payment merge onto ONE sub-row via `currentPrimeSeed`
  // (structural) + the default "derive" choice, with no click needed.
  it("merges the account and the default-derived payment key onto ONE sub-row when the backing seed's seedType is stoic, once the payment step is reached", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "stoic", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: KEY0, derivationPath: "m/0" }],
    };
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    await renderWizard([seed], current, { currentPrimeSeed: seed });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment

    await waitFor(() => {
      const testid = subRowTestid("seed-1", 0);
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-payment`).getAttribute("data-lit")).toBe("true");
    });
    // Exactly one sub-row for this card — not two.
    expect(screen.queryByTestId(`${subRowTestid("seed-1", 1)}-ticker-account`)).toBeNull();
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 5):
  // "Master Chainweb seed becomes the seed that is responsible for the
  // Payment Key. It shifted. This musnt be possible." The DEFAULT
  // payment/guard choices ("derive a new one"/"recommended-single-key")
  // now attribute to the SAME identity as the account role directly
  // (never via key search — see `seedDashboard.ts`'s own doc comment),
  // so this test's OLD premise (two roles coincidentally sharing a
  // "Koala Derivation" label via keys pre-recorded in the fixture,
  // despite the account NOT matching this seed at all) no longer
  // reflects anything real — a round-5 test below covers the corrected
  // default-merge behavior instead. What this test actually verifies —
  // two DIFFERENT roles on the SAME seed merging onto ONE sub-row when
  // their labels coincide — still needs covering for the ONE case where
  // `derivationLabelForSeed` (not Stoic Dalos) still applies: an
  // EXISTING, already-recorded key kept/selected explicitly (payment
  // "keep", guard "custom"), never derived.
  it("merges EXISTING payment and guard keys (not derived) onto ONE sub-row when they share a derivation label, via explicit 'keep'/'custom' choices", async () => {
    ARWEAVE_DECRYPT_MAP["seed-1-koala-secret"] = "unrelated koala wordlist only for this seed";
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-1-koala-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [
        { index: 0, publicKey: KEY0, derivationPath: "m/0" },
        { index: 1, publicKey: KEY1, derivationPath: "m/1" },
      ],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }));
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    const keepPayment = await screen.findByTestId("legacy-prime-migration-payment-option-keep");
    fireEvent.click(within(keepPayment).getByRole("button")); // KEY0, this seed's own recorded key
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    const custom = await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(within(custom).getByRole("button"));
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #1")); // KEY1, same seed

    await waitFor(() => {
      const testid = subRowTestid("seed-1", 0);
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-payment`).getAttribute("data-lit")).toBe("true");
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-guard`).getAttribute("data-lit")).toBe("true");
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("false");
    });
  });

  // Owner (same round): "With the default option the Same Master Seed
  // would be responsible for the Ouronet Account (previous selection,
  // so blue ticker), and the payment key, thus also green ticker." The
  // Payment step's own "Derivation method" for the DEFAULT "derive"
  // choice is fixed — "Stoic Dalos Derivation" — regardless of the
  // backing seed's OWN historical `seedType` (koala here), so payment
  // merges onto the ACCOUNT's own sub-row, never splitting onto a
  // separate "Koala Derivation" one.
  //
  // Owner (round 6, live testing): "at every stage we show only the
  // tickers that have been settled up to that step" — this test now
  // ALSO proves the step-gating itself: payment stays unlit while still
  // on "account" (point 1/2: "every checkbox has to be empty"/"only the
  // blue ticker must be on"), guard stays unlit while on "payment"
  // (point 3: "we should [not] show the guard ticker just yet, only
  // when we get to it"), and both finally light once "guard" is
  // actually reached.
  it("merges the account and the DEFAULT-derived payment/guard keys onto ONE sub-row — but ONLY once each role's own step is actually reached", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seed });
    await toAccountStep();
    const testid = subRowTestid("seed-1", 0);

    // Still on "account" — only the account role has been reached.
    await waitFor(() => {
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
    });
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-payment`).getAttribute("data-lit")).toBe("false");
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-guard`).getAttribute("data-lit")).toBe("false");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment

    // Now on "payment" — payment lights (merged onto the SAME sub-row),
    // guard still doesn't.
    await waitFor(() => {
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-payment`).getAttribute("data-lit")).toBe("true");
    });
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-guard`).getAttribute("data-lit")).toBe("false");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard

    // Now on "guard" — all three finally light, still one merged sub-row.
    await waitFor(() => {
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-guard`).getAttribute("data-lit")).toBe("true");
    });
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-payment`).getAttribute("data-lit")).toBe("true");
    // Exactly one sub-row for this card — not split across several.
    expect(screen.queryByTestId(`${subRowTestid("seed-1", 1)}-ticker-account`)).toBeNull();

    // Owner: "Going back should show no tickers, since going back,
    // means the forward selections are reverted, or not done yet."
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back")); // guard -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back")); // payment -> account
    await waitFor(() => {
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-payment`).getAttribute("data-lit")).toBe("false");
    });
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
    expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-guard`).getAttribute("data-lit")).toBe("false");
  });

  // Owner (round 5): the DEFAULT choices now merge payment/guard onto
  // the account's own sub-row (see the test above) — this test instead
  // covers the genuinely-distinct case: payment/guard EXPLICITLY set to
  // something else entirely (an unrelated EXISTING key, "keep" for
  // guard) must still leave a seed backing ONLY the account showing
  // payment/guard unlit.
  it("a seed backing only the chosen account shows payment/guard UNLIT when those are explicitly set to something else, not derived from this account", async () => {
    const seed1: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seed2: IStoaChainSeed = {
      id: "seed-2", name: "Seed B", seedType: "koala", version: "1.0", index: 1,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };
    // `seed2` listed FIRST — `currentPaymentKeyOf` reads `allSeeds[0]`'s
    // own index-0 key, so "keep payment" resolves to seed2's own key,
    // never seed1's.
    await renderWizard([seed2, seed1], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seed1 });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    const keepPayment = await screen.findByTestId("legacy-prime-migration-payment-option-keep");
    fireEvent.click(within(keepPayment).getByRole("button"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    const keepGuard = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keepGuard).getByRole("button"));

    await waitFor(() => {
      const testid = subRowTestid("seed-1", 0);
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-payment`).getAttribute("data-lit")).toBe("false");
      expect(within(dashboardCard("seed-1")).getByTestId(`${testid}-ticker-guard`).getAttribute("data-lit")).toBe("false");
    });
  });

  it("a seed with zero attribution renders no card at all", async () => {
    const seedA: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seedB: IStoaChainSeed = {
      id: "seed-unrelated", name: "Seed Unrelated", seedType: "koala", version: "1.0", index: 1,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [
        { index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" },
        { index: 1, publicKey: UNRELATED_2, derivationPath: "m/1" },
      ],
    };
    await renderWizard([seedA, seedB], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seedA });
    await toAccountStep();

    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-settling-dashboard-card-seed-1")).toBeTruthy();
    });
    expect(screen.queryByTestId("legacy-prime-migration-settling-dashboard-card-seed-unrelated")).toBeNull();
  });

  it("splits a custom guard's key count across the seeds that actually back each key, as a SECOND sub-row when the account is also on one of them", async () => {
    const seedA: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [
        { index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" },
        { index: 1, publicKey: GUARD_KEY_A, derivationPath: "m/1" },
        { index: 2, publicKey: GUARD_KEY_B, derivationPath: "m/2" },
      ],
    };
    const seedB: IStoaChainSeed = {
      id: "seed-2", name: "Seed B", seedType: "koala", version: "1.0", index: 1,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: GUARD_KEY_C, derivationPath: "m/0" }],
    };
    await renderWizard([seedA, seedB], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seedA });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard

    const custom = await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(within(custom).getByRole("button"));
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    // Array index 0 (Seed A here) always labels as "Master Chainweb Seed" —
    // the same convention every other seed-label call site in this file
    // uses (`masterChainwebSeedName`), not the seed's own stored name.
    // Group 0 is Seed A, group 1 is Seed B — both start collapsed.
    expandGroup(editor, 0);
    expandGroup(editor, 1);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #1"));
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #2"));
    fireEvent.click(within(editor).getByLabelText("Seed B - Key #0"));

    await waitFor(() => {
      // Seed A: the account's own sub-row is created FIRST (index 0,
      // "Stoic Dalos Derivation"); the guard's "Koala Derivation" label
      // differs, so it lands on a SECOND sub-row (index 1).
      expect(within(dashboardCard("seed-1")).getByTestId(`${subRowTestid("seed-1", 1)}-ticker-guard`).textContent)
        .toBe("2");
      // Seed B backs only the guard — one sub-row, index 0.
      expect(within(dashboardCard("seed-2")).getByTestId(`${subRowTestid("seed-2", 0)}-ticker-guard`).textContent)
        .toBe("1");
    });
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 8):
  // "Keep this guard as is, would have to show the Seed Words that are
  // responsible for the two keys the guard currently has." `summarizeGuardChoice`
  // returns `keys: null` for "keep" (it never even tries to resolve the
  // CURRENT keys — see that function's own "keep" branch) — so the
  // dashboard never attributed anything when the user explicitly kept
  // the existing guard, even though the REAL current guard resolution
  // (`guardResolution`, already decrypt-free: it's a live chain-shape
  // read, not a secret) has had the actual key list in hand the whole
  // time. "Keep" now reads from THAT resolution (`keysOf`) instead.
  it("lights the guard ticker on the seeds actually holding the CURRENT guard's keys, once guard is explicitly KEPT as-is", async () => {
    const seedA: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [
        { index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" },
        { index: 1, publicKey: GUARD_KEY_A, derivationPath: "m/1" },
      ],
    };
    const seedB: IStoaChainSeed = {
      id: "seed-2", name: "Seed B", seedType: "koala", version: "1.0", index: 1,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: GUARD_KEY_C, derivationPath: "m/0" }],
    };
    const current = account({
      id: "current", publicKey: ACCOUNT_PUB,
      guard: { pred: "keys-any", keys: [GUARD_KEY_A, GUARD_KEY_C] },
    });
    await renderWizard([seedA, seedB], current, { currentPrimeSeed: seedA });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard

    const keepGuard = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keepGuard).getByRole("button"));

    await waitFor(() => {
      // Seed A: the account's own sub-row (index 0) — guard's "Koala
      // Derivation" label differs, so it lands on a second sub-row.
      expect(within(dashboardCard("seed-1")).getByTestId(`${subRowTestid("seed-1", 1)}-ticker-guard`).textContent)
        .toBe("1");
      // Seed B backs only the guard.
      expect(within(dashboardCard("seed-2")).getByTestId(`${subRowTestid("seed-2", 0)}-ticker-guard`).textContent)
        .toBe("1");
    });
  });

  // Bug-fix round (`docs/work/wizard-keyset-scale-and-sidebar/` follow-up):
  // owner's real-data report — a 2-key keyset-REFERENCE guard (confirmed
  // via another screen in the app) was showing with only ONE key
  // attributed anywhere on the dashboard. Root-caused to `describeKeyset`
  // never being wired from `CodexIdPage.tsx` at all (fixed separately,
  // that file's own call site) — with no real chain read, ANY keyset-ref
  // guard always fell back to "keyset-ref-unresolved" (or, before an
  // account-switch regression test proved it ISN'T stale, whatever was
  // last resolved). This test proves the full happy path once
  // `describeKeyset` genuinely works: the SAME "keep" attribution/
  // splitting logic the flat-keyset test above already proves correct
  // also fires correctly for a RESOLVED keyset-ref — `keysOf` treats
  // `"keyset"` and `"keyset-ref"` identically, so both of the reference's
  // real keys attribute to their own seeds, summing to the full count.
  it("resolves a keyset-REFERENCE guard (not just a direct keyset) and splits its real keys across the seeds that hold them, once 'keep' is chosen", async () => {
    const seedA: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [
        { index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" },
        { index: 1, publicKey: GUARD_KEY_A, derivationPath: "m/1" },
      ],
    };
    const seedB: IStoaChainSeed = {
      id: "seed-2", name: "Seed B", seedType: "koala", version: "1.0", index: 1,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: GUARD_KEY_C, derivationPath: "m/0" }],
    };
    const current = account({
      id: "current", publicKey: ACCOUNT_PUB,
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_ah-keyset" } } as unknown as IOuroAccount["guard"],
    });
    const describeKeyset = vi.fn(async () => ({ keys: [GUARD_KEY_A, GUARD_KEY_C], pred: "keys-any" }));
    await renderWizard([seedA, seedB], current, { currentPrimeSeed: seedA, describeKeyset });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard

    const keepGuard = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keepGuard).getByRole("button"));

    await waitFor(() => {
      expect(describeKeyset).toHaveBeenCalledWith("ouronet-ns.dh_ah-keyset");
      // Seed A: the account's own sub-row (index 0) — guard's "Koala
      // Derivation" label differs, so it lands on a second sub-row.
      expect(within(dashboardCard("seed-1")).getByTestId(`${subRowTestid("seed-1", 1)}-ticker-guard`).textContent)
        .toBe("1");
      // Seed B backs only the guard.
      expect(within(dashboardCard("seed-2")).getByTestId(`${subRowTestid("seed-2", 0)}-ticker-guard`).textContent)
        .toBe("1");
    });
  });

  // owner (live testing, resumed real-data screenshot): "The chosen
  // Ouronet Account, Its Seed Becomes the Master Seed... no Blue Ticker
  // for the Seed." Root cause: a real Prime account's own STORED
  // `.publicKey` can drift from any seed's own recorded key list on
  // legacy/imported codices (the exact reason `CodexIdPage.tsx` treats
  // `currentPrimeAccount`/`currentPrimeSeed` as a STRUCTURAL pairing, not
  // a key-matched one) — so attribution must use `currentPrimeSeed`
  // directly for "keep current", never a raw key comparison.
  it("lights the account ticker via currentPrimeSeed even when the account's OWN stored key matches no seed", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      // Deliberately does NOT contain ACCOUNT_PUB anywhere — simulating a
      // legacy account whose stored identity key has drifted from this
      // seed's own bookkeeping.
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    await renderWizard([seed], current, { currentPrimeSeed: seed });
    await toAccountStep();

    await waitFor(() => {
      expect(within(dashboardCard("seed-1"))
        .getByTestId(`${subRowTestid("seed-1", 0)}-ticker-account`)
        .getAttribute("data-lit")).toBe("true");
    });
  });

  // owner (live testing, this round): "as soon as i select the Ouronet
  // Account it dissapeared" — picking an "existing" (non-default,
  // non-prime) account has NO `currentPrimeSeed`-style structural
  // shortcut available; this proves the NEW async bitstring match
  // (`resolveAccountSeedId`) is what actually drives that case, not the
  // old, unreliable raw key-match — the existing account's own STORED
  // `.publicKey` deliberately matches no seed's `accounts[]` anywhere.
  it("lights the account ticker for an 'existing' (non-default) account via the async bitstring match, never via its own stored key", async () => {
    const existingWords = "totally distinct seed words right here now";
    // `seedHodler` below is `seedType: "koala"` — per `entities.ts`'s own
    // documented TRUE semantics (and `resolveAccountSeedId`'s own fix,
    // `wizard-page2-and-dashboard-fixes` round 2), a non-stoic seed's own
    // `secret` decrypts to the real MNEMONIC directly, never a bitstring
    // — so this seed's own secret maps to the SAME words, exactly like a
    // real koala seed genuinely backing this account would.
    ARWEAVE_DECRYPT_MAP["hodler-secret"] = existingWords; // an ACCOUNT's secret decrypts to WORDS
    ARWEAVE_DECRYPT_MAP["seed-hodler-secret"] = existingWords; // a koala SEED's secret decrypts to the SAME real mnemonic

    const existingAccountPub = "7".repeat(64); // deliberately absent from every seed below
    const existingAccount = account({ id: "hodler", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-secret" });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const seedHodler: IStoaChainSeed = {
      id: "seed-hodler", name: "Seed Hodler", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-hodler-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_2, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[seedHodler]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler");
    fireEvent.click(item);

    await waitFor(() => {
      expect(within(dashboardCard("seed-hodler"))
        .getByTestId(`${subRowTestid("seed-hodler", 0)}-ticker-account`)
        .getAttribute("data-lit")).toBe("true");
    });
  });

  it("clicking the view-seed button opens the real seed-reveal modal even when the account's own key isn't verifiably positioned in this seed (structural match via currentPrimeSeed)", async () => {
    // A REAL, valid 1600-bit bitstring behind this seed's secret — unlike
    // every other fixture seed in this file (a placeholder "ct" that
    // decrypts to the shared WORDS string via the mock below), this one
    // actually gets rendered through `DalosSecretReveal`'s own
    // `rebuildFullKey`, which requires a genuine bitstring.
    // STOIC specifically — only a stoic seed's own `.secret` decrypts
    // DIRECTLY to a bitstring (every other seedType's secret is a real
    // mnemonic instead; see `SeedRevealModal.tsx`'s own doc comment).
    ARWEAVE_DECRYPT_MAP["seed-1-real-bits"] = BITS;
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "stoic", version: "1.0", index: 0,
      secret: "seed-1-real-bits", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    await renderWizard([seed], current, { currentPrimeSeed: seed });
    await toAccountStep();

    const testid = subRowTestid("seed-1", 0);
    const card = await screen.findByTestId("legacy-prime-migration-settling-dashboard-card-seed-1");
    fireEvent.click(within(card).getByTestId(`${testid}-expand`));
    await waitFor(() => {
      const dialog = within(screen.getByTestId("legacy-prime-migration-seed-reveal-modal"));
      expect(dialog.getByText("Seed A")).toBeTruthy(); // the modal's own title
      expect(dialog.getByText("BitString")).toBeTruthy(); // a real DalosSecretReveal tab
    });
  });
});

// Owner (live testing, this round): "as i changed the selected Ouronet
// Account, the displayed seed didnt change. moreover when i change
// again to the prime codex ouronet account from selecting AncientHodler
// account, the settle dashboard dissapeared." Root cause: switching
// BACK to "keep current" takes `seedDashboardAccountSeedId`'s
// SYNCHRONOUS shortcut (`currentPrimeSeed.id`, no decrypt) — but that
// branch returned BEFORE bumping `accountSeedRequestIdRef.current`, so
// it never invalidated a STILL-IN-FLIGHT async resolution from the
// PRIOR "existing" selection. When that old, slower resolution finally
// settles, its own request id still matches the ref (never bumped), so
// its result — the WRONG account's seed id, or `null` — overwrites the
// correct synchronous one, making the dashboard show stale/wrong
// content or disappear entirely.
describe("Settling Dashboard — account-switch races (wizard-page2-and-dashboard-fixes round 3)", () => {
  it("switching back to 'keep current' while a prior 'existing' account's async resolution is still in flight is NOT clobbered once that stale resolution finally settles", async () => {
    const existingWords = "totally distinct seed words right here now";
    // Delays the CANDIDATE SEED's own decrypt specifically (not the
    // ACCOUNT's) — the account step's own candidate-probe pass ALSO
    // decrypts every candidate ACCOUNT's secret (to judge real
    // recoverability before the list renders at all), so delaying that
    // one instead would hang the probe pass itself, never reaching the
    // "existing" item to click. `resolveAccountSeedId`'s own candidate
    // loop is the only thing that reads the SEED's secret, so this
    // isolates the exact in-flight window this test needs.
    let releaseHodlerSeedDecrypt: () => void = () => {};
    PENDING_DECRYPTS["seed-hodler-secret"] = new Promise((resolve) => { releaseHodlerSeedDecrypt = resolve; });
    ARWEAVE_DECRYPT_MAP["hodler-secret"] = existingWords;
    ARWEAVE_DECRYPT_MAP["seed-hodler-secret"] = existingWords;

    const existingAccountPub = "7".repeat(64);
    const existingAccount = account({ id: "hodler", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-secret" });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const seedPrime: IStoaChainSeed = {
      id: "seed-prime", name: "Seed Prime", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seedHodler: IStoaChainSeed = {
      id: "seed-hodler", name: "Seed Hodler", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-hodler-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_2, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seedPrime}
          allAccounts={[current, existingAccount]}
          allSeeds={[seedPrime, seedHodler]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    // Confirms the synchronous "keep current" starting point first.
    await waitFor(() => {
      expect(within(dashboardCard("seed-prime"))
        .getByTestId(`${subRowTestid("seed-prime", 0)}-ticker-account`)
        .getAttribute("data-lit")).toBe("true");
    });

    // Selects "existing" (AncientHodler) — its own async resolution is
    // now in flight, but will never settle during this test (the
    // decrypt it needs is held pending above).
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler");
    fireEvent.click(item);

    // Switches BACK to "keep current" before that resolution has had
    // any chance to settle — this takes the synchronous shortcut.
    const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
    fireEvent.click(within(keepOption).getByRole("button"));

    // The dashboard must show seed-prime's card again, correctly, with
    // the account ticker lit — not disappear, and not show seed-hodler.
    await waitFor(() => {
      expect(within(dashboardCard("seed-prime"))
        .getByTestId(`${subRowTestid("seed-prime", 0)}-ticker-account`)
        .getAttribute("data-lit")).toBe("true");
    });
    expect(screen.queryByTestId("legacy-prime-migration-settling-dashboard-card-seed-hodler")).toBeNull();

    // NOW release the stale AncientHodler resolution — it finally
    // settles, well after "keep current" was chosen. A correctly
    // request-id-guarded effect discards this result as superseded; the
    // bug let it through, clobbering the correct state.
    releaseHodlerSeedDecrypt();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(within(dashboardCard("seed-prime"))
      .getByTestId(`${subRowTestid("seed-prime", 0)}-ticker-account`)
      .getAttribute("data-lit")).toBe("true");
    expect(screen.queryByTestId("legacy-prime-migration-settling-dashboard-card-seed-hodler")).toBeNull();
  });

  // Owner (live testing, this round): "clicking reveal seed, still
  // showed the seed of the prime codex account. But after closing it,
  // waiting a bit, clicking view seed again, finally was showing its
  // correct seed. Its like it had to get a time to switch what it
  // shows and i clicked reveal seed to fast." The account-switch race
  // ABOVE only guarded against a STALE resolution clobbering a NEWER
  // one once it finally settles — it never stopped the "View seed"
  // button from staying clickable (showing the OLD, not-yet-replaced
  // card) during the in-flight window itself. The button must be
  // disabled for that whole window, not just during the account step's
  // own initial candidate probe.
  it("disables every 'View seed' button while a newly-chosen account's own seed resolution is still in flight, re-enabling only once it settles", async () => {
    const existingWords = "totally distinct seed words right here now";
    let releaseHodlerSeedDecrypt: () => void = () => {};
    PENDING_DECRYPTS["seed-hodler-secret-2"] = new Promise((resolve) => { releaseHodlerSeedDecrypt = resolve; });
    ARWEAVE_DECRYPT_MAP["hodler-secret-2"] = existingWords;
    ARWEAVE_DECRYPT_MAP["seed-hodler-secret-2"] = existingWords;

    const existingAccountPub = "8".repeat(64);
    const existingAccount = account({ id: "hodler2", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-secret-2" });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const seedPrime: IStoaChainSeed = {
      id: "seed-prime-2", name: "Seed Prime", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seedHodler: IStoaChainSeed = {
      id: "seed-hodler-2", name: "Seed Hodler", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-hodler-secret-2", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_2, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seedPrime}
          allAccounts={[current, existingAccount]}
          allSeeds={[seedPrime, seedHodler]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    const primeButton = await waitFor(() => {
      const button = within(dashboardCard("seed-prime-2")).getByTestId(
        `${subRowTestid("seed-prime-2", 0)}-expand`,
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(false); // sanity: enabled on the synchronous starting point
      return button;
    });

    // Selects "existing" (AncientHodler) — its own async resolution is
    // now in flight (the seed-side decrypt it needs is held pending).
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler2");
    fireEvent.click(item);

    // While that resolution is still in flight, the dashboard still
    // shows the OLD (seed-prime-2) card — but its "View seed" button
    // must now be DISABLED, not clickable-through-to-stale-content.
    await waitFor(() => expect(primeButton.disabled).toBe(true));

    // Release the resolution — it settles, the button re-enables.
    releaseHodlerSeedDecrypt();
    await waitFor(() => {
      const button = within(dashboardCard("seed-hodler-2")).getByTestId(
        `${subRowTestid("seed-hodler-2", 0)}-expand`,
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });

  // Owner (live testing, this round): "from the moment i click the
  // AncientHodler Ouronet Account, to the moment the blue dot becomes
  // visible, there a period of latency... While that view seed button
  // isnt available, the next button also must [not] be available. And
  // we need a sort of progress loader there... stay put." The "View
  // seed" buttons were already disabled for this exact in-flight window
  // (the test above) — Continue was never gated on the same window,
  // letting a user race past the Settling Dashboard before it had
  // caught up with the account they just chose. This proves Continue is
  // ALSO blocked, WITH a visible "something is loading" reason, for the
  // same window, and un-blocks the instant it settles.
  it("blocks Continue, with a visible loading reason, while a newly-chosen EXISTING account's own seed resolution is still in flight", async () => {
    const existingWords = "totally distinct seed words right here now";
    let releaseHodlerSeedDecrypt: () => void = () => {};
    PENDING_DECRYPTS["seed-hodler-secret-3"] = new Promise((resolve) => { releaseHodlerSeedDecrypt = resolve; });
    ARWEAVE_DECRYPT_MAP["hodler-secret-3"] = existingWords;
    ARWEAVE_DECRYPT_MAP["seed-hodler-secret-3"] = existingWords;

    const existingAccountPub = "9".repeat(64);
    const existingAccount = account({
      id: "hodler3race", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-secret-3",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const seedPrime: IStoaChainSeed = {
      id: "seed-prime-3", name: "Seed Prime", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seedHodler: IStoaChainSeed = {
      id: "seed-hodler-3", name: "Seed Hodler", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-hodler-secret-3", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_2, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seedPrime}
          allAccounts={[current, existingAccount]}
          allSeeds={[seedPrime, seedHodler]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    const continueButton = await screen.findByTestId("legacy-prime-migration-continue") as HTMLButtonElement;
    await waitFor(() => expect(continueButton.disabled).toBe(false)); // sanity: enabled on the starting point

    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler3race");
    fireEvent.click(item);

    await waitFor(() => expect(continueButton.disabled).toBe(true));
    expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent).toMatch(/hang tight/i);

    releaseHodlerSeedDecrypt();
    await waitFor(() => expect(continueButton.disabled).toBe(false));
    expect(screen.queryByTestId("legacy-prime-migration-continue-blocked")).toBeNull();
  });

  // Owner (live testing): "i resumed a started session, it seems there is
  // no blue box for Ouronet Account, it hasnt loaded, so its a bug. Also,
  // while the codex still looks keys up and the blue box isnt fixed, the
  // next button on the wizard must be disabled."
  //
  // The gate above used to live INSIDE the `"account"` step branch, so it
  // only held on the step where an account is picked. A resumed session
  // restores its choices and lands on a LATER step with that same
  // resolution still in flight — unlit account ticker, "Checking…" line
  // showing, and Continue fully enabled. This proves the gate now holds
  // on a later step too.
  it("blocks Continue on a LATER step too (the resumed-session case), not only on the account step", async () => {
    const existingWords = "totally distinct seed words right here now";
    let releaseHodlerSeedDecrypt: () => void = () => {};
    PENDING_DECRYPTS["seed-hodler-secret-4"] = new Promise((resolve) => { releaseHodlerSeedDecrypt = resolve; });
    ARWEAVE_DECRYPT_MAP["hodler-secret-4"] = existingWords;
    ARWEAVE_DECRYPT_MAP["seed-hodler-secret-4"] = existingWords;

    const existingAccountPub = "6".repeat(64);
    const existingAccount = account({
      id: "hodler4resume", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-secret-4",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const seedPrime: IStoaChainSeed = {
      id: "seed-prime-4", name: "Seed Prime", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seedHodler: IStoaChainSeed = {
      id: "seed-hodler-4", name: "Seed Hodler", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-hodler-secret-4", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_2, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seedPrime}
          allAccounts={[current, existingAccount]}
          allSeeds={[seedPrime, seedHodler]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    const continueButton = await screen.findByTestId("legacy-prime-migration-continue") as HTMLButtonElement;
    await waitFor(() => expect(continueButton.disabled).toBe(false));

    // Advance to a LATER step FIRST, on the synchronous "keep current"
    // default, so nothing is in flight yet...
    fireEvent.click(continueButton); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");

    // ...then go back, choose the existing account (its resolution is now
    // held pending), and advance again — mirroring a resumed session that
    // restores an "existing" choice and lands past the account step.
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back")); // payment -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler4resume");
    fireEvent.click(item);

    // Blocked on the ACCOUNT step (already covered above) — release
    // nothing, and confirm it is STILL blocked once the resolution is
    // in flight, which is the state a resume lands in.
    await waitFor(() => expect(continueButton.disabled).toBe(true));
    expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent).toMatch(/hang tight/i);

    releaseHodlerSeedDecrypt();
    await waitFor(() => expect(continueButton.disabled).toBe(false));

    // Now on the payment step, the gate must still be the one deciding —
    // prove it by checking the reason element is gone once settled.
    fireEvent.click(continueButton); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    expect(screen.queryByTestId("legacy-prime-migration-continue-blocked")).toBeNull();
  });
});

// `settled-master-identity/design.md` §2 (owner: "why is there a latency
// period between when i choose the Ouronet Account and when the Blue
// square gets light up? i dont get it?"): every account switch used to
// re-run `resolveAccountSeedId`'s whole candidate scan from scratch — up
// to N serial 600,000-iteration PBKDF2 decrypts of the SAME seeds whose
// bitstrings cannot have changed since the previous switch. The wizard
// now owns a `seedBitsCache` Map for its mounted lifetime, so going back
// to an account already visited is served entirely from memory.
describe("Settling Dashboard — seed-bitstring memoisation across account switches (settled-master-identity T6)", () => {
  it("switching A -> B -> A lights A's ticker again having decrypted each seed exactly once", async () => {
    const wordsA = "alpha bravo charlie delta echo foxtrot";
    const wordsB = "golf hotel india juliett kilo lima";
    ARWEAVE_DECRYPT_MAP["memo-acc-a-secret"] = wordsA;
    ARWEAVE_DECRYPT_MAP["memo-seed-a-secret"] = wordsA; // a koala SEED's secret decrypts to the real mnemonic
    ARWEAVE_DECRYPT_MAP["memo-acc-b-secret"] = wordsB;
    ARWEAVE_DECRYPT_MAP["memo-seed-b-secret"] = wordsB;

    const accA = account({
      id: "memo-a", name: "AccountA", publicKey: "a".repeat(64), secret: "memo-acc-a-secret",
    });
    const accB = account({
      id: "memo-b", name: "AccountB", publicKey: "b".repeat(64), secret: "memo-acc-b-secret",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    // Scanned FIRST (and matched by neither A nor B), so it proves the
    // memo covers non-matching candidates too — those are precisely the
    // ones a repeat visit would otherwise re-decrypt for nothing.
    const seedPrime: IStoaChainSeed = {
      id: "memo-seed-prime", name: "Seed Prime", seedType: "koala", version: "1.0", index: 0,
      secret: "memo-seed-prime-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seedA: IStoaChainSeed = {
      id: "memo-seed-a", name: "Seed A", seedType: "koala", version: "1.0", index: 1,
      secret: "memo-seed-a-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };
    const seedB: IStoaChainSeed = {
      id: "memo-seed-b", name: "Seed B", seedType: "koala", version: "1.0", index: 2,
      secret: "memo-seed-b-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_2, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          // Supplied so the opening `keep-current` default takes the
          // synchronous shortcut and performs NO seed decrypt of its own
          // — the counts below then belong entirely to the three
          // deliberate account selections.
          currentPrimeSeed={seedPrime}
          allAccounts={[current, accA, accB]}
          allSeeds={[seedPrime, seedA, seedB]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account

    const continueButton = await screen.findByTestId("legacy-prime-migration-continue") as HTMLButtonElement;
    const tickerLit = async (seedId: string) => {
      await waitFor(() => {
        expect(within(dashboardCard(seedId))
          .getByTestId(`${subRowTestid(seedId, 0)}-ticker-account`)
          .getAttribute("data-lit")).toBe("true");
      });
      // Continue re-enables only once the resolution has actually
      // settled (not merely rendered), so this is the signal that the
      // pass is complete and the next switch starts cleanly.
      await waitFor(() => expect(continueButton.disabled).toBe(false));
    };

    const selectExisting = async (accountId: string) => {
      fireEvent.click(await screen.findByTestId(`legacy-prime-migration-account-existing-item-${accountId}`));
    };

    await selectExisting("memo-a");
    await tickerLit("memo-seed-a");
    expect(DECRYPT_COUNTS["memo-seed-prime-secret"]).toBe(1); // scanned, no match
    expect(DECRYPT_COUNTS["memo-seed-a-secret"]).toBe(1); // scanned, matched

    await selectExisting("memo-b");
    await tickerLit("memo-seed-b");

    await selectExisting("memo-a");
    await tickerLit("memo-seed-a");

    // Three resolutions, each over the same three candidate seeds: with
    // the memo every seed is decrypted on its first encounter and never
    // again. Without it these would read 3 / 3 / 1.
    expect(DECRYPT_COUNTS["memo-seed-prime-secret"]).toBe(1);
    expect(DECRYPT_COUNTS["memo-seed-a-secret"]).toBe(1);
    expect(DECRYPT_COUNTS["memo-seed-b-secret"]).toBe(1);
  });
});

// Owner (live testing, this round): "Selecting AncientHolder, and then
// clicking reveal seed, still doesn't show its Ouronet Seed, which is
// what it should happen." An account genuinely unmatched by any
// recorded `IStoaChainSeed` (common for the legacy/imported accounts
// this wizard exists to rescue) never gets a card via the seed-matching
// mechanism — there was nothing to click that would ever reveal THAT
// account's own material. The dashboard now ALWAYS shows one extra
// fallback card for the chosen account specifically when `accountSeedId`
// resolved to `null`, with its own "View seed" button revealing the
// account's own secret directly (`AccountSeedRevealModal`), independent
// of seed-entity matching entirely.
describe("Settling Dashboard — unmatched-account fallback card (wizard-page2-and-dashboard-fixes round 4)", () => {
  // Owner (live testing, round 8): "On 2nd Page, it should then Read
  // Codex Master Seed (Ancient Hodler), as in we use in parenthesis the
  // Ouronet Account that Settled The Codex Master Seed." The fallback
  // card has no real `IStoaChainSeed` of its own, but it plays the
  // SAME "Codex Master Seed" role a real account-matching card does
  // (round 5/8) — its title now says so explicitly, with the chosen
  // account's own name in parentheses (never a bare account name alone,
  // which read as just another seed/account entry rather than THE
  // codex's own master identity).
  it("titles the fallback card 'Codex Master Seed (<account name>)', not the bare account name", async () => {
    const existingAccountPub = "7".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret-title"] = existingWords;
    const existingAccount = account({
      id: "hodler-title", name: "AncientHodler", publicKey: existingAccountPub,
      secret: "hodler-fallback-secret-title",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const unrelatedSeed: IStoaChainSeed = {
      id: "seed-unrelated-title", name: "Seed Unrelated", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[unrelatedSeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler-title");
    fireEvent.click(item);

    await waitFor(() => {
      const card = screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card");
      expect(within(card).getByText("Codex Master Seed (AncientHodler)")).toBeTruthy();
    });
  });

  it("shows a fallback card for the chosen 'existing' account when no seed in the codex matches it, and its View seed button reveals the account's OWN real words", async () => {
    const existingAccountPub = "7".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret"] = existingWords;
    const existingAccount = account({
      id: "hodler", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-fallback-secret",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    // Deliberately NO seed anywhere in the codex backs this account —
    // the ONLY seed present backs something unrelated entirely.
    const unrelatedSeed: IStoaChainSeed = {
      id: "seed-unrelated", name: "Seed Unrelated", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[unrelatedSeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler");
    fireEvent.click(item);

    const fallbackButton = await screen.findByTestId(
      "legacy-prime-migration-settling-dashboard-account-fallback-expand",
    );
    await waitFor(() => expect(fallbackButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(fallbackButton);

    await waitFor(() => {
      const dialog = within(screen.getByTestId("legacy-prime-migration-account-seed-reveal-modal"));
      expect(dialog.getByText("AncientHodler")).toBeTruthy();
      expect(dialog.getByText("Seed")).toBeTruthy();
      expect(dialog.getByText("7 words")).toBeTruthy();
    });
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 5):
  // "with the default selection, this same Master Seed would be
  // responsible for the generation of the payment key... thus also
  // green ticker." The fallback card has no real seed to attribute
  // payment to via a seed id — it must light its OWN payment ticker
  // directly when the default "derive" choice is still active, the
  // SAME way a real seed card already would.
  // Owner (round 6, live testing): "at every stage we show only the
  // tickers that have been settled up to that step." While still on
  // "account", even the fallback card's own payment ticker must stay
  // unlit — it only lights once the "payment" step is actually reached.
  it("lights the fallback card's OWN payment ticker too, for the DEFAULT 'derive' payment choice — but only once the payment step is reached", async () => {
    const existingAccountPub = "7".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret-2"] = existingWords;
    const existingAccount = account({
      id: "hodler2", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-fallback-secret-2",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const unrelatedSeed: IStoaChainSeed = {
      id: "seed-unrelated-2", name: "Seed Unrelated", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[unrelatedSeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler2");
    fireEvent.click(item);

    // Still on "account" — payment hasn't been reached yet.
    await waitFor(() => {
      const card = screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card");
      expect(
        within(card).getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-ticker-account")
          .getAttribute("data-lit"),
      ).toBe("true");
    });
    expect(
      within(screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card"))
        .getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-ticker-payment")
        .getAttribute("data-lit"),
    ).toBe("false");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment

    await waitFor(() => {
      const card = screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card");
      expect(
        within(card).getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-ticker-payment")
          .getAttribute("data-lit"),
      ).toBe("true");
    });
    // Guard/Arweave don't apply here — still present, structurally, but
    // unlit ("each entry must keep they square tickers, and we light up
    // only that which fits"). The Arweave one is no longer hardcoded dark
    // (`wizard-arweave-step` T3 made this card's violet square answer the
    // real predicate — see that block's own fallback test): this codex holds
    // no Arweave seed and no Arweave accounts, so it is dark on the merits.
    const card = screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card");
    expect(
      within(card).getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-ticker-arweave")
        .getAttribute("data-lit"),
    ).toBe("false");
  });

  // Owner (same round): "Master Chainweb seed becomes the seed that is
  // responsible for the Payment Key. It shifted. This musnt be
  // possible." A DIFFERENT, unrelated seed that happens to back the
  // KEPT payment key must show under its OWN real name — never
  // relabeled "Codex Master Seed" (round 8's rename of this label) —
  // while the chosen account's own fallback card stays separate and
  // unaffected.
  it("shows the OTHER seed backing a KEPT payment key under its OWN real name, never 'Codex Master Seed', when it's unrelated to the chosen account", async () => {
    const existingAccountPub = "7".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret-3"] = existingWords;
    const existingAccount = account({
      id: "hodler3", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-fallback-secret-3",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const paymentSeed: IStoaChainSeed = {
      id: "seed-payment-backer", name: "My Koala Seed", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[paymentSeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler3");
    fireEvent.click(item);
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    const keepPayment = await screen.findByTestId("legacy-prime-migration-payment-option-keep");
    fireEvent.click(within(keepPayment).getByRole("button"));

    await waitFor(() => {
      const card = screen.getByTestId("legacy-prime-migration-settling-dashboard-card-seed-payment-backer");
      expect(within(card).getByText("My Koala Seed")).toBeTruthy();
      expect(within(card).queryByText("Codex Master Seed")).toBeNull();
    });
    // The account's own fallback card stays separate, unrelated.
    expect(screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card")).toBeTruthy();
  });

  it("shows NO fallback card once the chosen account DOES match a real seed in the codex", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seed });
    await toAccountStep();

    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-settling-dashboard-card-seed-1")).toBeTruthy();
    });
    expect(
      screen.queryByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card"),
    ).toBeNull();
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 7,
  // screenshot 2): "the Master Seed must always be shown on the first
  // position... the Other Seeds that are responsible for the Selected
  // Keys, must follow beneath it... the seed responsible for it is the
  // Seed that is called Prime Codex Seed, (not Initial Seed)."
  it("shows the account's own fallback card FIRST, with the OTHER seed backing the kept payment key following beneath it under 'Prime Codex Seed' (not 'Initial Seed')", async () => {
    const existingAccountPub = "7".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret-4"] = existingWords;
    const existingAccount = account({
      id: "hodler4", name: "AncientHodler", publicKey: existingAccountPub, secret: "hodler-fallback-secret-4",
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    // The legacy literal name real codices can still carry, per
    // `seedNames.ts`'s own doc comment.
    const legacySeed: IStoaChainSeed = {
      id: "seed-legacy", name: "Initial Seed", seedType: "koala", version: "1.0", index: 0, isPrime: true,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[legacySeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler4");
    fireEvent.click(item);
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    const keepPayment = await screen.findByTestId("legacy-prime-migration-payment-option-keep");
    fireEvent.click(within(keepPayment).getByRole("button"));

    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-settling-dashboard-card-seed-legacy")).toBeTruthy();
    });
    const dashboard = screen.getByTestId("legacy-prime-migration-settling-dashboard");
    const fallback = within(dashboard).getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card");
    const legacyCard = within(dashboard).getByTestId("legacy-prime-migration-settling-dashboard-card-seed-legacy");
    // The fallback (account's own identity) comes BEFORE the other seed
    // in document order.
    expect(
      fallback.compareDocumentPosition(legacyCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(legacyCard).getByText("Prime Codex Seed")).toBeTruthy();
    expect(within(legacyCard).queryByText("Initial Seed")).toBeNull();
  });

  // Owner (live testing, `wizard-keyset-scale-and-sidebar` follow-up,
  // real-data report): "THe guard is made of 2 keys, so it should say 2
  // instead of 1... If a keyset is made of 9 keys, the total numbers
  // shown would have to add up to 9." The real AncientHodler test
  // account's own on-chain guard is a 2-key keyset where ONE member is
  // literally the account's own public key (a self-guard pattern — its
  // STOA payment/identity key, included in its own guard predicate).
  // That key is neither in any seed's `accounts[]` nor in
  // `pureKeypairs[]`, so before this fix it fell through unattributed —
  // only the OTHER (genuinely seed-backed) member ever counted anywhere,
  // undercounting the real keyset size on screen.
  it("counts a KEPT guard key that IS the fallback account's own public key, not just seed/pure-key members", async () => {
    const existingAccountPub = "7".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret-selfguard"] = existingWords;
    const existingAccount = account({
      id: "hodler-selfguard", name: "AncientHodler", publicKey: existingAccountPub,
      secret: "hodler-fallback-secret-selfguard",
      // One member is a genuinely-tracked seed key (counts on that
      // seed's own card); the other is the account's OWN public key —
      // the real gap this test closes.
      guard: { pred: "keys-any", keys: [UNRELATED_1, existingAccountPub] },
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const otherSeed: IStoaChainSeed = {
      id: "seed-other-selfguard", name: "Other Seed", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[otherSeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler-selfguard");
    fireEvent.click(item);
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");
    const keepGuard = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keepGuard).getByRole("button"));

    // The OTHER seed's card counts its own (genuinely seed-backed) member.
    await waitFor(() => {
      const otherCard = screen.getByTestId("legacy-prime-migration-settling-dashboard-card-seed-other-selfguard");
      const otherTicker = within(otherCard).getByTestId(
        subRowTestid("seed-other-selfguard", 0) + "-ticker-guard",
      );
      expect(otherTicker.getAttribute("data-lit")).toBe("true");
      expect(otherTicker.textContent).toBe("1");
    });
    // The fallback card counts its OWN self-referencing member — the
    // total across both cards (1 + 1) now adds up to the real keyset
    // size (2), instead of silently dropping the second member.
    const fallbackCard = screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card");
    const fallbackTicker = within(fallbackCard).getByTestId(
      "legacy-prime-migration-settling-dashboard-account-fallback-ticker-guard",
    );
    expect(fallbackTicker.getAttribute("data-lit")).toBe("true");
    expect(fallbackTicker.textContent).toBe("1");
  });

  // Owner (live testing, real data, THIRD report of the same arithmetic
  // bug): "there are two keys, why it still lists as 1???" The real
  // AncientHodler guard's second member is that account's own PAYMENT
  // key (`stoaChainLedger`, shown as "PAYMENT KEY k:35d9be77…54f" on its
  // Codex row) — NOT its DALOS `publicKey`, which is all the first
  // version of `accountOwnKeyBacksRole` checked. Same shape as the test
  // above, with the self-member moved to the field the real data
  // actually uses.
  it("counts a KEPT guard key that is the fallback account's own PAYMENT key (stoaChainLedger), not just its DALOS publicKey", async () => {
    const existingAccountPub = "7".repeat(64);
    const paymentKeyHex = "a".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret-paykey"] = existingWords;
    const existingAccount = account({
      id: "hodler-paykey", name: "AncientHodler", publicKey: existingAccountPub,
      secret: "hodler-fallback-secret-paykey",
      // Exactly the real shape: the payment key is a `k:`-prefixed
      // StoaChain address held in `stoaChainLedger`.
      stoaChainLedger: `k:${paymentKeyHex}`,
      guard: { pred: "keys-any", keys: [UNRELATED_1, paymentKeyHex] },
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const otherSeed: IStoaChainSeed = {
      id: "seed-other-paykey", name: "Other Seed", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[otherSeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler-paykey");
    fireEvent.click(item);
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");
    const keepGuard = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keepGuard).getByRole("button"));

    await waitFor(() => {
      const otherCard = screen.getByTestId("legacy-prime-migration-settling-dashboard-card-seed-other-paykey");
      expect(
        within(otherCard).getByTestId(subRowTestid("seed-other-paykey", 0) + "-ticker-guard").textContent,
      ).toBe("1");
    });
    const fallbackCard = screen.getByTestId("legacy-prime-migration-settling-dashboard-account-fallback-card");
    const fallbackTicker = within(fallbackCard).getByTestId(
      "legacy-prime-migration-settling-dashboard-account-fallback-ticker-guard",
    );
    expect(fallbackTicker.getAttribute("data-lit")).toBe("true");
    expect(fallbackTicker.textContent).toBe("1");
    // 1 + 1 = 2 = the real keyset size, with nothing left over.
    expect(
      screen.queryByTestId("legacy-prime-migration-settling-dashboard-unattributed-card"),
    ).toBeNull();
  });

  // Owner's own stated invariant, enforced structurally: "If a keyset is
  // made of 9 keys, the total numbers shown would have to add up to 9."
  // A key belonging to NO bucket at all (not a seed's, not a pure
  // keypair's, not the chosen account's own) must still be counted
  // SOMEWHERE rather than silently vanishing.
  it("counts guard keys belonging to NOTHING in this codex on a catch-all card, so the per-card totals still sum to the keyset size", async () => {
    const existingAccountPub = "7".repeat(64);
    const foreignKeyA = "b".repeat(64);
    const foreignKeyB = "c".repeat(64);
    const existingWords = "totally distinct seed words right here now";
    ARWEAVE_DECRYPT_MAP["hodler-fallback-secret-foreign"] = existingWords;
    const existingAccount = account({
      id: "hodler-foreign", name: "AncientHodler", publicKey: existingAccountPub,
      secret: "hodler-fallback-secret-foreign",
      // Three keys: one this codex holds (via a seed), two it has never
      // held in any form.
      guard: { pred: "keys-any", keys: [UNRELATED_1, foreignKeyA, foreignKeyB] },
    });
    const current = account({ id: "current", publicKey: ACCOUNT_PUB });
    const otherSeed: IStoaChainSeed = {
      id: "seed-other-foreign", name: "Other Seed", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, existingAccount]}
          allSeeds={[otherSeed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const item = await screen.findByTestId("legacy-prime-migration-account-existing-item-hodler-foreign");
    fireEvent.click(item);
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");
    const keepGuard = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keepGuard).getByRole("button"));

    const unattributed = await screen.findByTestId(
      "legacy-prime-migration-settling-dashboard-unattributed-card",
    );
    const unattributedTicker = within(unattributed).getByTestId(
      "legacy-prime-migration-settling-dashboard-unattributed-ticker-guard",
    );
    await waitFor(() => expect(unattributedTicker.textContent).toBe("2"));
    expect(unattributedTicker.getAttribute("data-lit")).toBe("true");
    // 1 (the seed-held key) + 2 (the two foreign ones) = 3 = the real
    // keyset size.
    const otherCard = screen.getByTestId("legacy-prime-migration-settling-dashboard-card-seed-other-foreign");
    expect(
      within(otherCard).getByTestId(subRowTestid("seed-other-foreign", 0) + "-ticker-guard").textContent,
    ).toBe("1");
  });
});

describe("Settling Dashboard — view seed", () => {
  it("opens the real seed-reveal modal (DalosSecretReveal, reused as-is), not an inline detail panel", async () => {
    ARWEAVE_DECRYPT_MAP["seed-1-real-bits-2"] = BITS;
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "stoic", version: "1.0", index: 0,
      secret: "seed-1-real-bits-2", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), { currentPrimeSeed: seed });
    await toAccountStep();

    const testid = subRowTestid("seed-1", 0);
    const card = await screen.findByTestId("legacy-prime-migration-settling-dashboard-card-seed-1");
    expect(screen.queryByTestId(`${testid}-detail`)).toBeNull(); // no inline detail panel at all, even before clicking
    fireEvent.click(within(card).getByTestId(`${testid}-expand`));
    await waitFor(() => {
      const dialog = within(screen.getByTestId("legacy-prime-migration-seed-reveal-modal"));
      expect(dialog.getByText("Seed A")).toBeTruthy();
      expect(dialog.getByText("BitString")).toBeTruthy();
    });
    expect(screen.queryByTestId(`${testid}-detail`)).toBeNull();
  });
});

describe("Settling Dashboard — violet (Arweave) ticker", () => {
  function arweaveSeed(o: Partial<IArweaveSeed> & { id: string }): IArweaveSeed {
    return { createdAt: "2026-01-01T00:00:00.000Z", secret: "ct", ...o };
  }

  /** The two Arweave ACCOUNTS (`ForeignKeyEntry` rows addressed by
   *  `(seedId, index)`) eligibility is actually defined on — the half the
   *  violet ticker used to ignore entirely, before `wizard-arweave-step` T3
   *  put it on `codexHoldsMasterArweaveAccounts`. */
  async function addArweaveAccounts(seedId: string, indexes: readonly number[] = [0, 1]) {
    await act(async () => {
      for (const index of indexes) {
        await store!.getState().actions.addForeignKey({
          id: `${seedId}-key-${index}`,
          chainId: "arweave:mainnet",
          encryptedKeyfile: "encrypted-keyfile-ciphertext",
          seedId,
          index,
        });
      }
    });
  }

  // UPDATED by `wizard-arweave-step` T3, which changed what this square
  // MEANS: "an Arweave seed's bitstring matches some Chainweb seed's"
  // (which lit on the seed alone) became "the codex HOLDS Arweave accounts
  // #0 and #1 under the Codex Master Seed". The merge-onto-the-account's-own-
  // sub-row behaviour this test exists for is unchanged; the fixture now has
  // to be a genuinely eligible codex to light at all — the Arweave seed's
  // ciphertext decrypts to the CHOSEN ACCOUNT's bitstring (`BITS`, from the
  // account secret's fall-through to `WORDS`), with both accounts recorded
  // under it.
  it("merges the violet ticker onto the account's own Stoic-Dalos sub-row when the codex holds #0 and #1 under the master's Arweave seed", async () => {
    ARWEAVE_DECRYPT_MAP["prime-arweave-secret"] = BITS;
    ARWEAVE_DECRYPT_MAP["seed-matching-secret"] = "SAME_BITS";
    ARWEAVE_DECRYPT_MAP["seed-other-secret"] = "DIFFERENT_BITS";

    const seedMatch: IStoaChainSeed = {
      id: "seed-match", name: "Seed Match", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-matching-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    const seedOther: IStoaChainSeed = {
      id: "seed-other", name: "Seed Other", seedType: "koala", version: "1.0", index: 1,
      secret: "seed-other-secret", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: UNRELATED_1, derivationPath: "m/0" }],
    };
    await renderWizard(
      [seedMatch, seedOther], account({ id: "current", publicKey: ACCOUNT_PUB }),
      { currentPrimeSeed: seedMatch },
    );
    await act(async () => {
      await store!.getState().actions.addArweaveSeed(
        arweaveSeed({ id: "prime-arweave", secret: "prime-arweave-secret", isPrime: true }),
      );
    });
    await addArweaveAccounts("prime-arweave");
    await toAccountStep();

    await waitFor(() => {
      const testid = subRowTestid("seed-match", 0);
      expect(within(dashboardCard("seed-match")).getByTestId(`${testid}-ticker-arweave`).getAttribute("data-lit")).toBe("true");
      // Same sub-row as the account — merged, not a second one.
      expect(within(dashboardCard("seed-match")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
    });
    // seed-other backs nothing else, and never matched the Arweave bits —
    // it must render no card at all, not a card with every ticker unlit.
    expect(screen.queryByTestId("legacy-prime-migration-settling-dashboard-card-seed-other")).toBeNull();
  });

  // INVERTED by `wizard-arweave-step` T3, honestly: this used to assert that
  // an Arweave seed NOT marked `isPrime` can never light the square, because
  // `resolveArweaveMatchSeedId` filters on that flag. The predicate that
  // replaced it deliberately does NOT (see
  // `codexHoldsMasterArweaveAccounts`' own doc): eligibility is about
  // DERIVATION, and design.md's "different seed" case explicitly leaves a
  // codex's pre-existing (hence prime-flagged) Arweave seed alone, so the
  // seed that genuinely derives from the master commonly carries no flag at
  // all. Flipping this test rather than deleting it keeps the flag's
  // irrelevance pinned — a regression back to the flag-filtered function
  // would fail here.
  it("lights the violet ticker for a matching Arweave seed that is NOT marked isPrime — derivation, not a flag", async () => {
    ARWEAVE_DECRYPT_MAP["prime-arweave-secret-2"] = BITS;
    ARWEAVE_DECRYPT_MAP["seed-matching-secret-2"] = "SAME_BITS_2";

    const seed: IStoaChainSeed = {
      id: "seed-nonprime-case", name: "Seed", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-matching-secret-2", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard(
      [seed], account({ id: "current", publicKey: ACCOUNT_PUB }),
      { currentPrimeSeed: seed },
    );
    await act(async () => {
      await store!.getState().actions.addArweaveSeed(
        arweaveSeed({ id: "not-prime", secret: "prime-arweave-secret-2", isPrime: false }),
      );
    });
    await addArweaveAccounts("not-prime");
    await toAccountStep();

    const testid = subRowTestid("seed-nonprime-case", 0);
    await waitFor(() => {
      expect(within(dashboardCard("seed-nonprime-case")).getByTestId(`${testid}-ticker-arweave`).getAttribute("data-lit")).toBe("true");
    });
  });

  // The fixture gained the two Arweave ACCOUNTS (and a master-matching
  // bitstring) in `wizard-arweave-step` T3: without them this test became
  // vacuous — the square would be dark on this codex whether it was locked or
  // not, so it pinned nothing about the lock. Now the codex is genuinely
  // eligible and only the missing password keeps it dark.
  it("never lights any card's violet ticker when the codex is locked (no cached password)", async () => {
    ARWEAVE_DECRYPT_MAP["prime-arweave-secret-3"] = BITS;
    ARWEAVE_DECRYPT_MAP["seed-matching-secret-3"] = "SAME_BITS_3";

    const seed: IStoaChainSeed = {
      id: "seed-locked-case", name: "Seed", seedType: "koala", version: "1.0", index: 0,
      secret: "seed-matching-secret-3", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={account({ id: "current", publicKey: ACCOUNT_PUB })}
          currentPrimeSeed={seed}
          allAccounts={[account({ id: "current", publicKey: ACCOUNT_PUB })]}
          allSeeds={[seed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    // Deliberately NOT authenticating — the codex stays locked, no password cached.
    await act(async () => {
      await store!.getState().actions.addArweaveSeed(
        arweaveSeed({ id: "prime-arweave-locked", secret: "prime-arweave-secret-3", isPrime: true }),
      );
    });
    await addArweaveAccounts("prime-arweave-locked");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
    fireEvent.click(within(keepOption).getByRole("button"));

    const testid = subRowTestid("seed-locked-case", 0);
    await waitFor(() => {
      expect(within(dashboardCard("seed-locked-case")).getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
    });
    expect(within(dashboardCard("seed-locked-case")).getByTestId(`${testid}-ticker-arweave`).getAttribute("data-lit")).toBe("false");
  });
});

/**
 * `docs/work/wizard-arweave-step/design.md` §"One predicate, actually" —
 * what the violet square MEANS.
 *
 * Owner, twice, after two rounds of "fixes": the wizard reached the eligible
 * panel while this square stayed dark. Root cause: the square and the
 * eligibility gate asked different questions. The square ran
 * `resolveArweaveMatchSeedId` ("does any Arweave seed's bitstring match some
 * CHAINWEB seed's?" — never looking at accounts #0/#1 at all); the gate ran
 * `codexHoldsMasterArweaveAccounts` ("does an Arweave seed match the CHOSEN
 * ACCOUNT's bitstring, AND are foreign keys #0 and #1 recorded under it?").
 * So an Arweave seed row with ZERO Arweave accounts lit the square — the
 * exact end state `arweave-master-accounts` found the old derivation leaving
 * behind — and the square could not be used to confirm anything.
 *
 * The square is now driven by the SAME predicate the Arweave step and
 * `runFinalize` use, so it means exactly one thing everywhere it appears:
 * THE CODEX HOLDS ARWEAVE ACCOUNTS #0 AND #1 UNDER THE CODEX MASTER SEED.
 *
 * WHICH CARD it lights is the composition this block also pins. The
 * predicate's own `seedId` is the ARWEAVE seed's id, which is never a card id
 * (cards are keyed by CHAINWEB seed id), so it cannot be handed to
 * `computeSeedDashboardCards` as the old function's return value was: the
 * square belongs on the Codex Master Seed's own card, which is by definition
 * the card the chosen account resolved to (`seedDashboardAccountSeedId`, the
 * blue ticker's card) — or, when that account matches no Chainweb seed at
 * all, the account's own fallback card, which carries the literal "Codex
 * Master Seed (<account>)" title for exactly that reason.
 *
 * Fixture shape: the chosen account's secret falls through the decrypt mock
 * to `WORDS`, whose Stoic-Dalos bitstring is `BITS` — so `BITS` is the Codex
 * Master Seed's bitstring here, and an Arweave seed "matching the master"
 * means one whose own ciphertext decrypts to `BITS` too. The Chainweb seed is
 * `stoic` so its sub-row label is `"Stoic Dalos Derivation"`, the same label
 * the account role uses, which merges both tickers onto sub-row 0.
 */
describe("Settling Dashboard — the violet ticker means the codex HOLDS #0 and #1 (wizard-arweave-step T3)", () => {
  /** Per-test secrets: `DECRYPT_COUNTS`/`ARWEAVE_DECRYPT_MAP` are shared
   *  across every test in this file, and the dark test below uses a decrypt
   *  COUNT as its "the predicate has actually run" signal. */
  function fixtureFor(tag: string) {
    const seedSecret = `t3-${tag}-seed-secret`;
    const arweaveSecret = `t3-${tag}-arweave-secret`;
    // A stoic seed's `secret` decrypts DIRECTLY to a bitstring, and an
    // Arweave seed's does too — both sides of the predicate's compare are
    // `BITS`, the chosen account's own master bitstring.
    ARWEAVE_DECRYPT_MAP[seedSecret] = BITS;
    ARWEAVE_DECRYPT_MAP[arweaveSecret] = BITS;
    const seed: IStoaChainSeed = {
      id: `t3-${tag}-seed`, name: "Seed T3", seedType: "stoic", version: "1.0", index: 0,
      secret: seedSecret, main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    return { seed, seedSecret, arweaveSecret, arweaveSeedId: `t3-${tag}-arweave` };
  }

  /** An Arweave SEED whose bitstring IS the master's, plus one Arweave
   *  ACCOUNT per `indexes` entry. An account is a `ForeignKeyEntry` addressed
   *  by `(seedId, index)` — never the seed row on its own, which is precisely
   *  the distinction the old ticker could not see. `isPrime: true` is set
   *  deliberately: it is what the OLD function keyed on, so a fixture with no
   *  accounts would have lit the square under it. */
  async function installArweave(
    fx: { arweaveSecret: string; arweaveSeedId: string },
    indexes: readonly number[],
  ) {
    await act(async () => {
      await store!.getState().actions.addArweaveSeed({
        id: fx.arweaveSeedId, secret: fx.arweaveSecret, isPrime: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      } as IArweaveSeed);
      for (const index of indexes) {
        await store!.getState().actions.addForeignKey({
          id: `${fx.arweaveSeedId}-key-${index}`,
          chainId: "arweave:mainnet",
          encryptedKeyfile: "encrypted-keyfile-ciphertext",
          seedId: fx.arweaveSeedId,
          index,
        });
      }
    });
  }

  /** Reaches the account step with the master seed's card rendered.
   *  `unlock: false` never calls `authenticate()`, so the real store's own
   *  `getPassword()` throws exactly as it does for a codex whose absolute
   *  unlock window closed mid-wizard. */
  async function renderAtAccountStep(opts: {
    tag: string; unlock: boolean; indexes: readonly number[];
  }) {
    const fx = fixtureFor(opts.tag);
    const current = account({ id: `t3-${opts.tag}-current`, publicKey: ACCOUNT_PUB });
    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={fx.seed}
          allAccounts={[current]}
          allSeeds={[fx.seed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    if (opts.unlock) {
      act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    }
    await installArweave(fx, opts.indexes);

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
    fireEvent.click(within(keepOption).getByRole("button"));

    const testid = subRowTestid(fx.seed.id, 0);
    // The blue ticker lighting proves the card rendered and the dashboard
    // settled, so what the violet one does next is about the Arweave
    // verdict, not about a dashboard that never got going.
    await waitFor(() => {
      expect(within(dashboardCard(fx.seed.id)).getByTestId(`${testid}-ticker-account`)
        .getAttribute("data-lit")).toBe("true");
    });
    const arweaveTicker = () =>
      within(dashboardCard(fx.seed.id)).getByTestId(`${testid}-ticker-arweave`);
    return { fx, arweaveTicker, store: store! };
  }

  // THE REPORTED BUG, as a test. Everything the OLD function looked at is
  // present and matching — an `isPrime` Arweave seed whose bitstring equals a
  // Chainweb seed's — so the old ticker lit here. The codex holds no Arweave
  // ACCOUNT at all, which is not eligibility, so the square must be dark.
  it("leaves the violet ticker DARK for an Arweave seed that matches the Codex Master Seed but holds NO accounts", async () => {
    const { fx, arweaveTicker } = await renderAtAccountStep({
      tag: "no-accounts", unlock: true, indexes: [],
    });

    // The predicate having DECRYPTED the Arweave seed is the proof that it
    // ran to a verdict — without it, "still dark" could just mean "has not
    // resolved yet", and this test would pin nothing.
    await waitFor(() => {
      expect(DECRYPT_COUNTS[fx.arweaveSecret] ?? 0).toBeGreaterThan(0);
    });
    expect(arweaveTicker().getAttribute("data-lit")).toBe("false");
  });

  // The control for the test above, on the same fixture with the same
  // account: this codex CAN light the square, and the only difference is the
  // two Arweave accounts.
  it("lights the violet ticker on the Codex Master Seed's card once accounts #0 and #1 are held under the matching seed", async () => {
    const { arweaveTicker } = await renderAtAccountStep({
      tag: "both-accounts", unlock: true, indexes: [0, 1],
    });

    await waitFor(() => {
      expect(arweaveTicker().getAttribute("data-lit")).toBe("true");
    });
  });

  // The silent-degradation half (`wizard-unlock-lifecycle` T4, pinned again
  // here because the effect's internals changed): a locked codex cannot
  // decrypt anything, so it cannot PROVE the accounts — but it must say so by
  // staying dark, never by interrupting someone reading the sidebar.
  it("leaves the violet ticker dark on a LOCKED codex that really does hold #0 and #1 — no prompt, no self-unlock", async () => {
    const { arweaveTicker, store: locked } = await renderAtAccountStep({
      tag: "locked", unlock: false, indexes: [0, 1],
    });

    expect(arweaveTicker().getAttribute("data-lit")).toBe("false");
    const dashboard = screen.getByTestId("legacy-prime-migration-settling-dashboard");
    expect(within(dashboard).queryByTestId("wizard-unlock-prompt")).toBeNull();
    // The unlock window is ABSOLUTE (`src/zbom/hooks/useEnsureCodexUnlocked.ts`) —
    // a dashboard effect that "helpfully" authenticated would re-arm it on
    // every step and selection change.
    expect(locked.getState().locked).toBe(true);
    expect(locked.getState().passwordCache).toBeNull();
  });

  // The chosen account matching no Chainweb seed is the COMMON case for the
  // legacy/imported accounts this wizard exists to rescue — the dashboard
  // gives it the fallback card titled "Codex Master Seed (<account>)", which
  // plays exactly the master role a seed-matched card does. Its violet square
  // used to be hardcoded dark, honestly so: the OLD predicate compared
  // against CHAINWEB SEED ENTITIES, and there is none here. The new one
  // compares against the ACCOUNT's own bitstring, which this card has — so
  // leaving it hardcoded would keep the reported bug alive for exactly the
  // codices the wizard targets.
  it("lights the violet ticker on the account's own FALLBACK card when no Chainweb seed matches the chosen account", async () => {
    const fx = fixtureFor("fallback");
    const current = account({ id: "t3-fallback-current", publicKey: ACCOUNT_PUB });
    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          // No `currentPrimeSeed`, and no seed on record at all, so
          // `resolveAccountSeedId` can only answer `null` — the fallback
          // card's own precondition.
          allAccounts={[current]}
          allSeeds={[]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    await installArweave(fx, [0, 1]);

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
    fireEvent.click(within(keepOption).getByRole("button"));

    const base = "legacy-prime-migration-settling-dashboard-account-fallback";
    const fallbackCard = await screen.findByTestId(`${base}-card`);
    // This card's blue ticker is lit exactly while it is not disabled, so it
    // is also the signal that the dashboard's own resolving window is over.
    await waitFor(() => {
      expect(within(fallbackCard).getByTestId(`${base}-ticker-account`)
        .getAttribute("data-lit")).toBe("true");
    });
    await waitFor(() => {
      expect(within(fallbackCard).getByTestId(`${base}-ticker-arweave`)
        .getAttribute("data-lit")).toBe("true");
    });
  });
});

// `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "G — Pure keys
// join the picker and the dashboard": a pure keypair backing the settled
// payment key and/or guard keyset has nowhere to attribute to via
// `computeSeedDashboardCards` (it is not a seed), so it needs its own,
// always-last "Pure Keys" card — one entry, regardless of how many
// distinct pure keys are actually involved.
describe("Settling Dashboard — Pure Keys card", () => {
  function pureKeypairFx(id: string, publicKey: string): IPureKeypair {
    return { id, publicKey, encryptedPrivateKey: "ct", createdAt: "2026-01-01T00:00:00.000Z" };
  }

  const PURE_PAYMENT_KEY = "7".repeat(64);
  const PURE_GUARD_KEY = "8".repeat(64);
  const pureKeysCard = () => screen.getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-card");

  it("(a) renders no Pure Keys card when no pure keypair backs payment or guard", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), {
      currentPrimeSeed: seed,
      // Present in the codex, but never selected for payment or guard below.
      pureKeypairs: [pureKeypairFx("pk-1", PURE_PAYMENT_KEY)],
    });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");

    expect(screen.queryByTestId("legacy-prime-migration-settling-dashboard-pure-keys-card")).toBeNull();
  });

  it("(b)+(d) shows the card with a lit payment ticker, and dark account/Arweave tickers, when a kept payment key resolves to a pureKeypairs entry", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: PURE_PAYMENT_KEY, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), {
      pureKeypairs: [pureKeypairFx("pk-1", PURE_PAYMENT_KEY)],
    });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    const keepPayment = await screen.findByTestId("legacy-prime-migration-payment-option-keep");
    fireEvent.click(within(keepPayment).getByRole("button")); // resolves to seed-1's own key, PURE_PAYMENT_KEY

    const card = await screen.findByTestId("legacy-prime-migration-settling-dashboard-pure-keys-card");
    await waitFor(() => {
      expect(within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-ticker-payment")
        .getAttribute("data-lit")).toBe("true");
    });
    expect(within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-ticker-account")
      .getAttribute("data-lit")).toBe("false");
    expect(within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-ticker-arweave")
      .getAttribute("data-lit")).toBe("false");
    expect((within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-view-seed") as HTMLButtonElement)
      .disabled).toBe(true);
  });

  it("(c)+(e) shows the card with a lit, counted guard ticker when the custom guard keyset includes a pureKeypairs entry, and its View seed button stays disabled", async () => {
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }],
    };
    await renderWizard([seed], account({ id: "current", publicKey: ACCOUNT_PUB }), {
      currentPrimeSeed: seed,
      pureKeypairs: [pureKeypairFx("pk-1", PURE_GUARD_KEY)],
    });
    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    const custom = await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(within(custom).getByRole("button"));
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    // One seed (group 0) plus the trailing "Pure Keys" group (group 1) —
    // the pure keypair's own checkbox lives in the latter.
    expandGroup(editor, 1);
    fireEvent.click(within(editor).getByLabelText("Pure Keypair"));

    const card = await screen.findByTestId("legacy-prime-migration-settling-dashboard-pure-keys-card");
    await waitFor(() => {
      const ticker = within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-ticker-guard");
      expect(ticker.getAttribute("data-lit")).toBe("true");
      expect(ticker.textContent).toBe("1");
    });
    expect(within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-ticker-account")
      .getAttribute("data-lit")).toBe("false");
    expect(within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-ticker-arweave")
      .getAttribute("data-lit")).toBe("false");
    expect((within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-view-seed") as HTMLButtonElement)
      .disabled).toBe(true);

    // (e) — unconditionally disabled: still true even after the step/probe
    // settling this file's OTHER cards gate their own button on.
    fireEvent.click(within(pureKeysCard()).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-view-seed"));
    expect((within(pureKeysCard()).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-view-seed") as HTMLButtonElement)
      .disabled).toBe(true);
  });

  // Live-testing bug report, this round: every test above (and every
  // `ui-step3-payment-and-guard.test.tsx` test) supplies `pureKeypairs` as
  // an explicit PROP, bypassing `pureKeypairsFromStore` entirely — the
  // REAL production call site (`CodexIdPage.tsx`) never passes that prop
  // at all, relying purely on the store fallback
  // (`pureKeypairsProp !== undefined ? pureKeypairsProp : pureKeypairsFromStore`).
  // A user with a real codex, CURRENT guard `{pred:"keys-any", keys:[keyA,keyB]}`
  // (keyA backed by a seed, keyB backed by a recorded pure keypair), who chose
  // "keep this guard exactly as it is", reported no "Pure Keys" card at all —
  // this reproduces that exact shape through the REAL store-fallback path
  // (no `pureKeypairs` prop passed to the wizard at all), mirroring the
  // prop-driven "keeps as-is" test just above it.
  it("(store-fallback) shows the Pure Keys card with a guard-ticker count of 1 when the CURRENT ('keep this guard as is') guard's keys split between a seed and a store-only pureKeypairs entry — no pureKeypairs PROP passed at all", async () => {
    const keyA = GUARD_KEY_A;
    const keyB = GUARD_KEY_B;
    const seed: IStoaChainSeed = {
      id: "seed-1", name: "Seed A", seedType: "koala", version: "1.0", index: 0,
      accounts: [{ index: 0, publicKey: ACCOUNT_PUB, derivationPath: "m/0" }, { index: 1, publicKey: keyA, derivationPath: "m/1" }],
      secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
    };
    const current = account({
      id: "current", publicKey: ACCOUNT_PUB,
      guard: { pred: "keys-any", keys: [keyA, keyB] },
    });

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          currentPrimeSeed={seed}
          allAccounts={[current]}
          allSeeds={[seed]}
          // Deliberately NO `pureKeypairs` prop — the wizard must rely
          // purely on `pureKeypairsFromStore` below, exactly as the real
          // `CodexIdPage.tsx` call site does.
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    await act(async () => {
      await store!.getState().actions.addPureKeypair(pureKeypairFx("pk-1", keyB));
    });

    await toAccountStep();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    const keepGuard = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keepGuard).getByRole("button"));

    const card = await screen.findByTestId("legacy-prime-migration-settling-dashboard-pure-keys-card");
    await waitFor(() => {
      const ticker = within(card).getByTestId("legacy-prime-migration-settling-dashboard-pure-keys-ticker-guard");
      expect(ticker.getAttribute("data-lit")).toBe("true");
      expect(ticker.textContent).toBe("1");
    });
  });
});

/**
 * `docs/work/wizard-unlock-lifecycle/design.md`, T4 — the one touch point
 * this topic deliberately did NOT convert to prompt-and-retry.
 *
 * `wizard-unlock-lifecycle` gave Finalize and both "View seed" modals an
 * inline `wizard-unlock-prompt` so a closed unlock window stops dead-ending
 * them. The dashboard's OWN two resolution effects (the Arweave-accounts
 * verdict — `resolveMasterArweaveHeld` since `wizard-arweave-step` T3, which
 * is where that swallow now lives, inside the two shared seams it calls —
 * and `resolveAccountSeedId`) are the explicit exception: a failing
 * `actions.getPassword()` becomes a `null` password rather than an
 * exception, and both answer "nothing proven" for a `null` password — so a
 * locked codex degrades to "ticker simply stays unlit" rather than crashing
 * OR interrupting a user who is only reading the sidebar. design.md: "These
 * already swallow failures into `password = null`, so they degrade to 'unlit
 * ticker' rather than crashing — correct, and left alone."
 *
 * Nothing before this block pinned that, so a future round could remove
 * the swallow (taking the whole wizard down with an escaped
 * `CodexLockedError`) or "fix" these effects to prompt — turning an
 * informational sidebar into a password demand on every step — with the
 * suite still green. Both tests below drive the SAME fixture, differing
 * ONLY in whether `authenticate()` was ever called, so the unlit state
 * proven in the second one is attributable to the lock alone.
 *
 * Fixture shape, and why it is not any of the simpler ones above:
 *  - The seed is `stoic`, so its own sub-row label is
 *    `"Stoic Dalos Derivation"` — the SAME label the account role always
 *    uses, which merges all four roles onto sub-row 0.
 *  - It backs the KEPT payment key (`accounts[0].publicKey`, which
 *    `currentPaymentKeyOf` reads) — a decrypt-free, password-free string
 *    match. That is what keeps the card (and therefore its account/Arweave
 *    tickers) rendered at all while locked, instead of vanishing and
 *    leaving nothing to assert `data-lit="false"` on.
 *  - No `currentPrimeSeed` prop, so the account role CANNOT take the
 *    synchronous structural shortcut and must go through
 *    `resolveAccountSeedId`'s decrypt-and-compare — the effect under test.
 *  - The account's own `publicKey` (`ACCOUNT_PUB`) appears in no seed, so
 *    no key-match can stand in for that decrypt either.
 */
describe("Settling Dashboard — locked codex degrades silently (wizard-unlock-lifecycle T4)", () => {
  const T4_SEED_SECRET = "t4-stoic-seed-secret";
  const T4_ARWEAVE_SECRET = "t4-prime-arweave-secret";
  const T4_PAYMENT_KEY = UNRELATED_1; // in the seed's accounts[], never the account's own key

  /** Renders the fixture, reaches the payment step with "keep this payment
   *  key" chosen, and returns once the dashboard card has rendered.
   *  `unlock: false` never calls `authenticate()`, so the real store's own
   *  `getPassword()` throws `CodexLockedError` exactly as it does for a
   *  codex whose absolute window closed mid-wizard. */
  async function renderAtPaymentStep(opts: { unlock: boolean }) {
    // A stoic seed's `secret` decrypts DIRECTLY to a bitstring, and the
    // Arweave seed's does too — so both sides of the Arweave predicate's
    // compare are `BITS` here. The account's own secret falls through the
    // mock to `WORDS`, whose derived bitstring is that same `BITS`, which is
    // both the master bitstring the Arweave verdict is about and what
    // `resolveAccountSeedId` compares against the (stoic) candidate.
    ARWEAVE_DECRYPT_MAP[T4_SEED_SECRET] = BITS;
    ARWEAVE_DECRYPT_MAP[T4_ARWEAVE_SECRET] = BITS;
    const seed: IStoaChainSeed = {
      id: "seed-t4", name: "Seed T4", seedType: "stoic", version: "1.0", index: 0,
      secret: T4_SEED_SECRET, main: "", createdAt: "2026-01-01T00:00:00.000Z",
      accounts: [{ index: 0, publicKey: T4_PAYMENT_KEY, derivationPath: "m/0" }],
    };
    const current = account({ id: "t4-current", publicKey: ACCOUNT_PUB });

    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current]}
          allSeeds={[seed]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    if (opts.unlock) {
      act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    }
    await act(async () => {
      await store!.getState().actions.addArweaveSeed({
        id: "t4-prime-arweave", secret: T4_ARWEAVE_SECRET, isPrime: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      } as IArweaveSeed);
      // The two Arweave ACCOUNTS under that seed — required since
      // `wizard-arweave-step` T3 put the violet ticker on
      // `codexHoldsMasterArweaveAccounts`: a matching seed ROW no longer
      // lights it, so without these the unlocked control below could not
      // light, and the locked assertion it controls for would prove nothing.
      for (const index of [0, 1]) {
        await store!.getState().actions.addForeignKey({
          id: `t4-prime-arweave-key-${index}`,
          chainId: "arweave:mainnet",
          encryptedKeyfile: "encrypted-keyfile-ciphertext",
          seedId: "t4-prime-arweave",
          index,
        });
      }
    });

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
    fireEvent.click(within(keepOption).getByRole("button"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    const keepPayment = await screen.findByTestId("legacy-prime-migration-payment-option-keep");
    fireEvent.click(within(keepPayment).getByRole("button"));
    await screen.findByTestId("legacy-prime-migration-settling-dashboard-card-seed-t4");
    return store!;
  }

  // The control for the test below: on this exact fixture, an UNLOCKED
  // codex really does light both password-dependent tickers. Without this,
  // "they are unlit while locked" would also pass for a fixture that could
  // never light them for some unrelated reason, and would pin nothing.
  it("lights the account AND Arweave tickers on this fixture when the codex is unlocked", async () => {
    await renderAtPaymentStep({ unlock: true });

    const testid = subRowTestid("seed-t4", 0);
    await waitFor(() => {
      const row = within(dashboardCard("seed-t4"));
      expect(row.getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("true");
      expect(row.getByTestId(`${testid}-ticker-arweave`).getAttribute("data-lit")).toBe("true");
    });
  });

  it("leaves both password-dependent tickers unlit when the codex is LOCKED — never crashing, never prompting, never unlocking anything itself", async () => {
    const locked = await renderAtPaymentStep({ unlock: false });

    const testid = subRowTestid("seed-t4", 0);
    // The payment ticker is the decrypt-free, password-free string match —
    // it lighting proves the dashboard genuinely rendered and settled (so
    // the two assertions after it are about the password, not about a
    // dashboard that never got going).
    await waitFor(() => {
      expect(within(dashboardCard("seed-t4")).getByTestId(`${testid}-ticker-payment`)
        .getAttribute("data-lit")).toBe("true");
    });
    const row = within(dashboardCard("seed-t4"));
    expect(row.getByTestId(`${testid}-ticker-account`).getAttribute("data-lit")).toBe("false");
    expect(row.getByTestId(`${testid}-ticker-arweave`).getAttribute("data-lit")).toBe("false");

    // Still a rendered dashboard, not a wizard taken down by an escaped
    // `CodexLockedError` from inside either effect.
    expect(screen.getByTestId("legacy-prime-migration-settling-dashboard")).toBeTruthy();
    // And NO prompt of its own. Scoped to the dashboard subtree on purpose:
    // the ACCOUNT step's own `legacy-prime-migration-account-probe-unlock`
    // panel is a separate, legitimate prompt (T1 left it alone), so a
    // document-wide query here would be asserting something about that
    // panel instead of about these two effects.
    expect(within(screen.getByTestId("legacy-prime-migration-settling-dashboard"))
      .queryByTestId("wizard-unlock-prompt")).toBeNull();

    // The other half of "left alone": the unlock window is ABSOLUTE (see
    // `src/zbom/hooks/useEnsureCodexUnlocked.ts`), and these effects run on
    // every step/selection change — so a dashboard that "helpfully"
    // authenticated would re-arm the window continuously and make the
    // visible "re-authenticate in X" countdown meaningless.
    expect(locked.getState().locked).toBe(true);
    expect(locked.getState().passwordCache).toBeNull();
  });
});
