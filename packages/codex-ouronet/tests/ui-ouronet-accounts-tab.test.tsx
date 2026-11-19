/**
 * OuronetAccountsTab specs — updated for the v0.3.x "1:1 My Codex clone"
 * rewrite of the tab.
 *
 * The tab is now self-contained: it reads live chain state (URC_0027) via the
 * package's own `useAccountChainData`, derives StoicTag / sovereign / governor
 * from that chain overlay, and self-hosts every action modal. The earlier
 * injected-StoicTag contract (`stoicTagFor` / `onClaimStoicTag` /
 * `onReleaseStoicTag`) is gone — props are now `{ className? }` only — so the
 * old claim/release specs are retired here. StoicTag Add/Release + Activate +
 * Rotate-Governor are deferred clone stubs (v0.3.2 / ZBOM Wave 8) and are not
 * asserted yet.
 *
 * What these specs pin about the new contract:
 *   - the empty state ("No standard accounts in Codex", default Standard tab);
 *   - the CodexPrime invariant (index 0 always displays as "CodexPrime", locked);
 *   - non-prime accounts display their own name + Standard/Smart counts;
 *   - a collapsed row expands to reveal the on-chain breakdown (Ouronet Account
 *     section), and an activated, guarded account exposes "Rotate Guard" which
 *     opens the self-hosted rotate dialog;
 *   - CodexPrime delete is blocked (disabled control), non-prime is deletable;
 *   - the SETTLED master (`codexMasterSeed.ouroAccountId`) carries the
 *     "Codex Ouronet Master" name wherever it sits in the list, with its own
 *     stored name demoted to a second line beneath — and a codex that never
 *     settled one still names positionally, with no second line
 *     (settled-master-identity/design.md);
 *   - prime-identity-display/plan.md T2 — the owner's screenshot: on a SEALED
 *     codex the row PINNED first, the row painted GOLD, the row wearing the
 *     🔒 Prime badge and the row carrying the golden DESIGNATION are all the
 *     same row (the settled master), and an unsealed codex — finalized or
 *     never-migrated — keeps the positional rule byte-for-byte.
 *
 * NB: `@testing-library/jest-dom` is declared by this package but never
 * registered in `tests/setup.ts`, so its matchers (`toBeDisabled`,
 * `toHaveAttribute`, `toBeInTheDocument`) throw `Invalid Chai property` — which
 * inside a `waitFor` surfaces as an opaque "Test timed out". Every assertion
 * below is deliberately a plain DOM check.
 */

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// The tab reads live URC_0027 chain state via getAccountSelectorDataLive
// (package-LOCAL, ../src/zbom/ouroSelectorReads.js — DPL-UR chain-symbol
// audit follow-up, 2026-09-25: reads O-UI-SEVEN.URC_01|Accounts directly
// instead of @ouronet/ouronet-core's getAccountSelectorData), which hits a
// real Stoa node. In jsdom there is no node, so each render would fire a
// hanging network read; left in-flight, those reads race across tests and make
// the modal-open spec flaky. Stub it to return no rows — the codex-only view
// these specs assert is exactly what the tab renders when chain data is absent.
vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorDataLive: async () => [] };
});

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useOuroAccounts } from "@ancientpantheon/codex-ouronet/hooks";
import { OuronetAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";
import type { CodexMasterSeed, MigrationProgress } from "@ancientpantheon/codex-core";

const KEY = "a".repeat(64);

/** The gold every prime surface in this codebase paints the master with
 *  (`#ceac5f`), as jsdom serialises an inline style. */
const GOLD = "rgb(206, 172, 95)";
/** The displaced holder's muted silver (`#9a9a9a`) — the SAME value
 *  `ArweaveSeedsArea`'s own former-master designation line uses, deliberately
 *  neither the gold nor an ordinary row's `#d2d3d4`. */
const MUTED_SILVER = "rgb(154, 154, 154)";

const ouroFx = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: over.id ?? "o1",
  name: over.name ?? "My Account",
  version: "1.0.0",
  isSmart: over.isSmart ?? false,
  address: over.address ?? "Ѻ.my-account",
  guard: over.guard ?? null,
  stoaChainLedger: null,
  publicKey: over.publicKey ?? "p".repeat(64),
  secret: "s",
  backup: "b",
  ...over,
});

/**
 * Seeds the accounts and — when the spec is about a SETTLED master — the
 * `codexMasterSeed` row, straight onto the per-mount store (the same
 * `useCodexStore().setState` seeding `ui-codex-settings-info-cards.test.tsx`
 * uses: there is no form for this row, and `setCodexMasterSeed` would demand a
 * real Chainweb seed this display-only spec has no use for). Written BEFORE the
 * accounts so no row ever renders against a half-seeded store.
 */
function Seeder({
  accounts,
  masterSeed,
  progress,
}: {
  accounts: IOuroAccount[];
  masterSeed?: CodexMasterSeed;
  progress?: MigrationProgress;
}) {
  const { addAccount } = useOuroAccounts();
  const { isReady } = useCodex();
  const store = useCodexStore();
  React.useEffect(() => {
    if (!isReady) return;
    if (masterSeed) store.setState({ codexMasterSeed: masterSeed });
    // The SEAL, seeded the same display-only way as the master row above:
    // `isMigrationSealed(progress)` is what gates the gold/badge/pinning, and
    // driving the whole wizard to set `appliedAt` is a different suite's job.
    if (progress) store.setState({ migrationProgress: progress });
    accounts.forEach((a) => void addAccount(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(
  accounts: IOuroAccount[] = [],
  props: React.ComponentProps<typeof OuronetAccountsTab> = {},
  masterSeed?: CodexMasterSeed,
  progress?: MigrationProgress,
) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder accounts={accounts} masterSeed={masterSeed} progress={progress} />
      <OuronetAccountsTab {...props} />
    </CodexProvider>,
  );
  if (accounts.length > 0) {
    // index 0 always displays as the Codex Ouronet Master; later rows show their own name.
    await screen.findByText(accounts.length === 1 ? "Codex Ouronet Master" : (accounts[1].name as string));
  } else {
    await screen.findByText(/No standard accounts in Codex/i);
  }
  return utils;
}

/** Expand a collapsed account row by clicking its header button. */
function expandRow(card: HTMLElement) {
  // The expand toggle is the header row (a `role="button"` div). Do NOT use
  // `querySelector("button")` — the first real <button> is now the Atom
  // account-selector (it stops propagation and selects rather than expands).
  const header = card.querySelector('[role="button"]') as HTMLElement;
  fireEvent.click(header);
}

describe("<OuronetAccountsTab>", () => {
  it("renders the empty state when the codex holds no ouro accounts", async () => {
    await renderTab([]);
    expect(screen.getByText(/No standard accounts in Codex/i)).toBeTruthy();
  });

  it("displays the first account as the locked CodexPrime, with its own stored name kept as the second line", async () => {
    await renderTab([ouroFx({ id: "prime", name: "Some Name", address: "Ѻ.prime-acct" })]);
    expect(screen.getByText("Codex Ouronet Master")).toBeTruthy();
    // Prime entities share a unified "🔒 Prime" badge (distinct from the name).
    expect(screen.getByText(/🔒\s*Prime/)).toBeTruthy();
    // The golden designation no longer REPLACES the account's own name — it
    // sits above it (prime-two-name-model/design.md: "a prime seed or account
    // has 2 names: its golden prime name, and its normal name [...] because as
    // non-prime accounts become prime, their names mangle"). This assertion
    // used to demand the opposite ("the seeded name is intentionally
    // overridden for the prime slot"), which IS the mangling being fixed.
    expect(screen.getByTestId("account-own-name-prime").textContent).toBe("Some Name");
  });

  it("renders a non-prime account by its own name and counts it under Standard", async () => {
    await renderTab([
      ouroFx({ id: "prime", name: "Prime" }),
      ouroFx({ id: "o2", name: "Second", address: "Ѻ.second-acct" }),
    ]);
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("Standard (2)")).toBeTruthy();
  });

  it("expands a row to reveal the on-chain Ouronet Account breakdown", async () => {
    await renderTab([ouroFx({ id: "prime", name: "Prime", address: "Ѻ.prime-acct" })]);
    const card = (await screen.findByText("Codex Ouronet Master")).closest("[data-account-id]") as HTMLElement;
    expandRow(card);
    expect(await within(card).findByText(/Ouronet Account/i)).toBeTruthy();
  });

  it("opens the self-hosted rotate-guard dialog for an activated, guarded account", async () => {
    await renderTab([
      ouroFx({
        id: "prime",
        name: "Prime",
        isActive: true,
        guard: { pred: "keys-all", keys: [KEY] },
      }),
    ]);
    const card = (await screen.findByText("Codex Ouronet Master")).closest("[data-account-id]") as HTMLElement;
    expandRow(card);
    const btn = await within(card).findByRole("button", { name: /rotate guard/i });
    fireEvent.click(btn);
    // The verbatim-cloned RotateGuardModal opens with an <h2>Rotate Guard</h2>
    // heading (the row's trigger is a button, so the heading role is unique).
    expect(await screen.findByRole("heading", { name: /rotate guard/i })).toBeTruthy();
  });

  it("blocks deleting the CodexPrime account but allows deleting a non-prime one", async () => {
    await renderTab([
      ouroFx({ id: "prime", name: "Prime", isActive: true }),
      ouroFx({ id: "o2", name: "Second", address: "Ѻ.second-acct", isActive: true }),
    ]);

    const prime = (await screen.findByText("Codex Ouronet Master")).closest("[data-account-id]") as HTMLElement;
    expandRow(prime);
    // DELIBERATE REWRITE (locked-entities-and-former-prime/plan.md T5). This
    // used to assert the prime exposed a DISABLED delete control
    // (`getByRole("button", { name: /cannot be removed/i })`). The owner
    // overruled that behaviour — "delete button should not be available for
    // them" — so the row must now render NO delete control of any kind; the
    // Locked medallion on its title line carries the reason instead. Not a
    // casualty: do not "repair" this back to a disabled-button assertion.
    expect(within(prime).queryByRole("button", { name: /cannot be removed/i })).toBeNull();
    expect(within(prime).queryByRole("button", { name: /^delete$/i })).toBeNull();

    const second = (await screen.findByText("Second")).closest("[data-account-id]") as HTMLElement;
    expandRow(second);
    expect(within(second).getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });

  // The settled master is whichever account `codexMasterSeed.ouroAccountId`
  // names, NOT whichever one happens to sit at index 0 — the whole defect
  // settled-master-identity/design.md opens with ("the account the wizard
  // settled as master is not the account the rest of the app treats as
  // master"). Without this spec the positional rule can silently come back and
  // the wizard's result reads as if it never ran.
  it("names the SETTLED master by role with its own name beneath, leaving the first account under its own name", async () => {
    await renderTab(
      [
        ouroFx({ id: "first", name: "First Account", address: "Ѻ.first-acct" }),
        ouroFx({ id: "hodler", name: "AncientHodler", address: "Ѻ.hodler-acct" }),
      ],
      {},
      { ouroAccountId: "hodler", chainwebSeedId: "cw-seed", establishedAt: "2026-11-17T00:00:00.000Z" },
      // The SEAL is now part of this fixture: prime-two-name-model/design.md's
      // "the designation follows the SEAL, not the finalize" makes every
      // master-identity surface read `isMigrationSealed(progress)`, so a row
      // written by a finalize that was never applied names positionally. The
      // behaviour this spec exists to pin — the settled master named by role
      // wherever it sits — is unchanged; only the fixture gained the Apply.
      SEALED,
    );

    const hodler = document.querySelector('[data-account-id="hodler"]') as HTMLElement;
    expect(within(hodler).getByText("Codex Ouronet Master")).toBeTruthy();
    // The row's own stored name coexists with the designation, never destroyed
    // — a second line on the settled master's own row, not a label on some
    // other row.
    expect(within(hodler).getByTestId("account-own-name-hodler").textContent).toBe("AncientHodler");

    // index 0 lost the master name to the settled account and falls back to
    // its own stored one; two accounts reading as the master at once would be
    // worse than naming the wrong one.
    const first = document.querySelector('[data-account-id="first"]') as HTMLElement;
    expect(within(first).getByText("First Account")).toBeTruthy();
    expect(within(first).queryByText("Codex Ouronet Master")).toBeNull();
    // No designation on that row at all, so no second line either: an
    // undesignated row already shows its own name as its title.
    expect(screen.queryByTestId("account-own-name-first")).toBeNull();
  });

  // Backwards compatibility: a codex that never ran the eligibility wizard has
  // no settled master, so position 0 still wins AND nothing new appears
  // beneath it — index 0's stored name is the legacy "CodexPrime" literal the
  // master-name module exists to stop displaying, so an unconditional
  // own-name line would leak it onto every un-migrated codex.
  it("keeps naming positionally, with no own-name line, when no master has been settled and the stored name is the legacy literal", async () => {
    await renderTab([
      ouroFx({ id: "prime", name: "CodexPrime", address: "Ѻ.prime-acct" }),
      ouroFx({ id: "o2", name: "Second", address: "Ѻ.second-acct" }),
    ]);

    const prime = document.querySelector('[data-account-id="prime"]') as HTMLElement;
    expect(within(prime).getByText("Codex Ouronet Master")).toBeTruthy();
    expect(screen.queryByTestId("account-own-name-prime")).toBeNull();
    expect(screen.queryByText("CodexPrime")).toBeNull();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * prime-identity-display/plan.md T2 — the owner's screenshot.
 *
 * He sealed a codex and photographed the accounts list: "Initial Seed" pinned
 * at the top with the 🔒 Prime badge and the gold treatment, while the settled
 * master ("Codex Ouronet Master" / AncientHodler) sat below under "Other
 * standard accounts". Root cause: the tab decided the master THREE ways —
 * `hydratedAccounts[0]` for the pinned row, `index === 0` for the gold, and
 * `codexMasterSeed.ouroAccountId` for the name — so gold and the master name
 * were different rows. These specs pin that all of them read ONE derived
 * value, and that an unsealed codex is untouched by the change.
 * ─────────────────────────────────────────────────────────────────────────── */

const ESTABLISHED_AT = "2026-11-17T00:00:00.000Z";
const APPLIED_AT = "2026-11-18T09:30:00.000Z";

/** A SEALED migration — `appliedAt` set, which is the seal and is permanent. */
const SEALED: MigrationProgress = {
  stage: "done",
  startedAt: ESTABLISHED_AT,
  updatedAt: APPLIED_AT,
  appliedAt: APPLIED_AT,
};

/** FINALIZED but never applied: a pending plan exists, `appliedAt` does not.
 *  `codexMasterSeed` is already written at this point (finalize/Write 2), which
 *  is exactly why the gate cannot be "has a master row". */
const FINALIZED_UNSEALED: MigrationProgress = {
  stage: "executing",
  startedAt: ESTABLISHED_AT,
  updatedAt: "2026-11-17T10:00:00.000Z",
  pending: { finalizedAt: "2026-11-17T10:00:00.000Z", accountId: "hodler" },
};

/** The codex settled on "hodler" and displaced "initial" — the screenshot.
 *
 *  `legacyPrimeOuroAccountId` is the WRITE-ONCE field the "Former Codex Prime"
 *  designation reads (locked-entities-and-former-prime/design.md §A2-A3); the
 *  append-only `formerOuroAccountIds` stays on the fixture because the row
 *  really does carry both, and keeping it here is what lets the spec below
 *  prove the tab reads the former and ignores the latter. */
const SETTLED_ON_HODLER: CodexMasterSeed = {
  ouroAccountId: "hodler",
  chainwebSeedId: "cw-seed",
  establishedAt: ESTABLISHED_AT,
  formerOuroAccountIds: ["initial"],
  legacyPrimeOuroAccountId: "initial",
};

/** The same settlement, but with ONLY the append-only history recorded — a
 *  row written before the write-once field existed, or by a wizard re-run that
 *  appended a CANDIDATE that never displaced anything. */
const SETTLED_WITHOUT_LEGACY_PRIME: CodexMasterSeed = {
  ouroAccountId: "hodler",
  chainwebSeedId: "cw-seed",
  establishedAt: ESTABLISHED_AT,
  formerOuroAccountIds: ["initial"],
};

/** The two accounts in the photograph, in codex (index) order. */
const screenshotAccounts = (): IOuroAccount[] => [
  ouroFx({ id: "initial", name: "Initial Seed", address: "Ѻ.initial-acct" }),
  ouroFx({ id: "hodler", name: "AncientHodler", address: "Ѻ.hodler-acct" }),
];

const rowOf = (id: string) => document.querySelector(`[data-account-id="${id}"]`) as HTMLElement;
/** Rendered row order, top to bottom — the pinned prime zone comes first. */
const rowOrder = () =>
  Array.from(document.querySelectorAll("[data-account-id]")).map((el) => el.getAttribute("data-account-id"));
/**
 * Every row whose TITLE line is painted the master's gold.
 *
 * The title carries `account-designation-<id>` when the row wears a golden
 * designation and `account-name-<id>` when it does not (the two are mutually
 * exclusive), so this can inspect EVERY row's colour — which is what makes
 * "exactly one gold row" an assertion about the whole screen rather than only
 * about the rows that already admit to being designated.
 */
const goldRowIds = () =>
  Array.from(document.querySelectorAll("[data-account-id]"))
    .filter((row) => {
      const title = row.querySelector(
        '[data-testid^="account-designation-"],[data-testid^="account-name-"]',
      ) as HTMLElement | null;
      return title?.style.color === GOLD;
    })
    .map((row) => row.getAttribute("data-account-id"));

describe("<OuronetAccountsTab> — SEALED codex: pinning, gold, the 🔒 Prime badge and the designation are ONE value", () => {
  it("pins the settled master first, paints it gold and badges it — and index 0 ('Initial Seed') is none of those", async () => {
    await renderTab(screenshotAccounts(), {}, SETTLED_ON_HODLER, SEALED);

    // Pinned FIRST, above the "Other standard accounts" separator, rather
    // than sitting under it the way the photograph shows.
    expect(rowOrder()).toEqual(["hodler", "initial"]);

    const hodler = rowOf("hodler");
    const designation = within(hodler).getByTestId("account-designation-hodler");
    expect(designation.textContent).toBe("Codex Ouronet Master");
    expect(designation.style.color).toBe(GOLD);
    expect(within(hodler).getByText(/🔒\s*Prime/)).toBeTruthy();

    // ...and the index-0 account carries none of the three.
    const initial = rowOf("initial");
    expect(within(initial).queryByText(/🔒\s*Prime/)).toBeNull();
    expect(within(initial).queryByText("Codex Ouronet Master")).toBeNull();
    expect(goldRowIds()).toEqual(["hodler"]);
  });

  it("shows the master's OWN stored name as the second line, beneath the golden designation", async () => {
    await renderTab(screenshotAccounts(), {}, SETTLED_ON_HODLER, SEALED);

    const hodler = rowOf("hodler");
    const ownName = within(hodler).getByTestId("account-own-name-hodler");
    expect(ownName.textContent).toBe("AncientHodler");
    // Muted, not gold — the designation is the golden one of the two names.
    expect(ownName.style.color).toBe("rgb(136, 136, 136)");
  });

  it("keeps a name the user gave the account BEFORE it became master visible afterwards — the designation never overwrites it", async () => {
    // "An account renamed before becoming prime keeps that name visible"
    // (prime-two-name-model/design.md). Had the role name been written into
    // the account's own `name` — the data loss this model exists to stop —
    // the second line would read the designation back, and
    // `accountOwnNameLine`'s self-reference suppression would hide it
    // entirely, failing both assertions below.
    await renderTab(
      [
        ouroFx({ id: "initial", name: "Initial Seed", address: "Ѻ.initial-acct" }),
        ouroFx({ id: "hodler", name: "My Trading Account", address: "Ѻ.hodler-acct" }),
      ],
      {},
      SETTLED_ON_HODLER,
      SEALED,
    );

    const hodler = rowOf("hodler");
    expect(within(hodler).getByTestId("account-designation-hodler").textContent).toBe("Codex Ouronet Master");
    expect(within(hodler).getByTestId("account-own-name-hodler").textContent).toBe("My Trading Account");
  });

  it("reads the DISPLACED account as the Former Codex Prime — muted silver, never gold, its own name still beneath", async () => {
    // Owner decision (1), locked-entities-and-former-prime/design.md §A3: a
    // displacement can happen only ONCE and is always kickstart-prime ->
    // settled master, so the displaced account is the codex's legacy
    // CodexPrime and reads the RETIRED designation "Former Codex Prime". The
    // short-lived "Former Codex Ouronet Master" this line used to assert
    // described a state that cannot occur, and its constant is deleted.
    await renderTab(screenshotAccounts(), {}, SETTLED_ON_HODLER, SEALED);

    const initial = rowOf("initial");
    const designation = within(initial).getByTestId("account-designation-initial");
    expect(designation.textContent).toBe("Former Codex Prime");
    expect(designation.style.color).toBe(MUTED_SILVER);
    expect(within(initial).getByTestId("account-own-name-initial").textContent).toBe("Initial Seed");
    // Exactly ONE gold row on the whole screen.
    expect(goldRowIds()).toEqual(["hodler"]);
  });

  it("reads the WRITE-ONCE legacyPrimeOuroAccountId, never the append-only formerOuroAccountIds", async () => {
    // design.md §A2: the wizard is re-runnable and every run executes Write 2,
    // so `formerOuroAccountIds` accumulates CANDIDATES that were never applied
    // and never displaced anything. A tab that designated off that list would
    // hand "Former Codex Prime" to an account that was simply proposed once.
    // Only the write-once field names the one real displacement — so a row
    // carrying the history but not the field designates nobody.
    await renderTab(screenshotAccounts(), {}, SETTLED_WITHOUT_LEGACY_PRIME, SEALED);

    const initial = rowOf("initial");
    expect(within(initial).queryByText("Former Codex Prime")).toBeNull();
    expect(within(initial).queryByText("Former Codex Ouronet Master")).toBeNull();
    // No designation at all ⇒ the row is titled by its own name, and so has no
    // second line either.
    expect(within(initial).getByTestId("account-name-initial").textContent).toBe("Initial Seed");
    expect(screen.queryByTestId("account-own-name-initial")).toBeNull();
    expect(goldRowIds()).toEqual(["hodler"]);
  });
});

describe("<OuronetAccountsTab> — UNSEALED codex: the positional rule, byte-for-byte", () => {
  it("no settled master at all: index 0 is pinned first, gold and badged", async () => {
    await renderTab(screenshotAccounts());

    expect(rowOrder()).toEqual(["initial", "hodler"]);
    const initial = rowOf("initial");
    expect(within(initial).getByTestId("account-designation-initial").style.color).toBe(GOLD);
    expect(within(initial).getByText(/🔒\s*Prime/)).toBeTruthy();
    expect(goldRowIds()).toEqual(["initial"]);
    expect(within(rowOf("hodler")).queryByText(/🔒\s*Prime/)).toBeNull();
  });

  it("FINALIZED but not applied: the gold, the badge and the pinning all stay on index 0 — only Apply moves them", async () => {
    // design.md: "the designation follows the SEAL, not the finalize".
    // `codexMasterSeed` is written at finalize, is non-fatal on failure and is
    // re-writable by a later finalize while unsealed; `appliedAt` is monotone
    // and permanent. So a pending plan naming "hodler" must move nothing.
    await renderTab(screenshotAccounts(), {}, SETTLED_ON_HODLER, FINALIZED_UNSEALED);

    expect(rowOrder()).toEqual(["initial", "hodler"]);
    const initial = rowOf("initial");
    expect(within(initial).getByTestId("account-designation-initial").textContent).toBe("Codex Ouronet Master");
    expect(within(initial).getByTestId("account-designation-initial").style.color).toBe(GOLD);
    expect(within(initial).getByText(/🔒\s*Prime/)).toBeTruthy();
    expect(goldRowIds()).toEqual(["initial"]);

    const hodler = rowOf("hodler");
    expect(within(hodler).queryByText(/🔒\s*Prime/)).toBeNull();
    expect(within(hodler).queryByText("Codex Ouronet Master")).toBeNull();
    // Nor does the FORMER designation appear on an unsealed codex, even with
    // `legacyPrimeOuroAccountId` already recorded by the finalize —
    // `isLegacyPrimeAccount` is seal-gated and fails closed, exactly like the
    // sibling predicate this line used to name.
    expect(within(initial).queryByText("Former Codex Prime")).toBeNull();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * locked-entities-and-former-prime/design.md Part B — the Locked medallion,
 * and bugs 3 and 4.
 *
 * Owner: "we have no way to see which entries are protected. Such Protected
 * Seeds or account should have a lock medalion ... and delete button should
 * not be available for them."
 *
 * Both bugs are the same shape: the store refuses the delete
 * (`deleteOuroAccount`, state/store.ts:2496-2516) while the row offers a live
 * one, so the click fails silently and leaves an unhandled rejection. The
 * medallion and the withheld control both read ONE predicate —
 * codex-core's `ouronetAccountLock` — so the badge and the throw cannot drift.
 * ─────────────────────────────────────────────────────────────────────────── */

/** No delete affordance of ANY kind in the row: neither the live control nor
 *  the disabled-with-a-tooltip one this tab used to render. Owner: "delete
 *  button should not be available for them." */
const expectNoDeleteControl = (row: HTMLElement) => {
  expect(within(row).queryByRole("button", { name: /^delete$/i })).toBeNull();
  expect(within(row).queryByRole("button", { name: /cannot be removed/i })).toBeNull();
};

describe("<OuronetAccountsTab> — the Locked medallion, and the deletes the store would refuse", () => {
  it("bug 3: an account with a confirmed encrypted ArWeave upload is Locked and offers NO delete, while its ordinary neighbour still deletes", async () => {
    // `deleteOuroAccount` throws `CodexArweaveEncryptionProtectedError` on
    // `hasEncryptedArweaveUpload === true` (state/store.ts:2508-2510) because
    // deleting the account would orphan permanent on-chain ciphertext forever.
    // `deleteProtected` never read the flag, so this row showed an ENABLED
    // delete whose click failed silently.
    await renderTab([
      ouroFx({ id: "prime", name: "Prime", isActive: true }),
      ouroFx({ id: "uploader", name: "Uploader", address: "Ѻ.uploader", isActive: true, hasEncryptedArweaveUpload: true }),
      ouroFx({ id: "plain", name: "Plain", address: "Ѻ.plain", isActive: true }),
    ]);

    const uploader = rowOf("uploader");
    const medallion = within(uploader).getByTestId("account-locked-uploader");
    // The medallion names the reason the STORE would give, not a generic
    // "protected" — the owner has to know which remedy applies.
    expect(medallion.getAttribute("aria-label")).toMatch(/^Locked — /);
    expect(medallion.getAttribute("aria-label")).toMatch(/ArWeave upload/i);
    expandRow(uploader);
    expectNoDeleteControl(uploader);

    // The neighbour the store would happily delete is untouched: no medallion,
    // and a live control. Over-locking is as wrong as under-locking.
    const plain = rowOf("plain");
    expect(within(plain).queryByTestId("account-locked-plain")).toBeNull();
    expandRow(plain);
    expect(within(plain).getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });

  it("bug 4 (the finalize→seal window): a promoted account at a NON-ZERO index on an UNSEALED codex is Locked and offers NO delete", async () => {
    // `promoteSeedAndAccountToPrime` moves `isPrime` at FINALIZE
    // (state/store.ts:2573-2576), but `useMasterOuronetIdentity` answers
    // `accounts[0]` until the codex is SEALED. Between those two moments a
    // promoted account sitting anywhere but index 0 showed an enabled delete
    // that `deleteOuroAccount` refuses with `CodexPrimeProtectedError`.
    // Reading `isPrime` off the ACCOUNT closes the window without disturbing
    // the seal gate that (correctly) governs DESIGNATIONS — hence no master
    // row and no progress in this fixture.
    //
    // The flags below are EXACTLY what `promoteSeedAndAccountToPrime` leaves
    // behind: it maps `isPrime: false` onto every other account rather than
    // deleting the key (state/store.ts:2589-2591). Stating index 0's `false`
    // explicitly is also what makes the fixture constructible —
    // `addOuroAccount` auto-primes the FIRST account added unless the caller
    // says otherwise, and then refuses a second prime with a different id.
    await renderTab([
      ouroFx({ id: "initial", name: "Initial Seed", address: "Ѻ.initial", isPrime: false }),
      ouroFx({ id: "promoted", name: "Promoted", address: "Ѻ.promoted", isPrime: true }),
    ]);

    const promoted = rowOf("promoted");
    expect(within(promoted).getByTestId("account-locked-promoted").getAttribute("aria-label"))
      .toMatch(/CodexPrime/);
    expandRow(promoted);
    expectNoDeleteControl(promoted);

    // The seal gate is untouched: index 0 still holds the gold and the
    // designation on an unsealed codex, exactly as before.
    expect(goldRowIds()).toEqual(["initial"]);
    expect(within(promoted).queryByText(/🔒\s*Prime/)).toBeNull();
  });

  it("the medallion is never the 🔒 character and never borrows the Prime badge's gold — one gold row stays the invariant", async () => {
    // `ui-ouronet-accounts-tab.test.tsx`'s own `getByText(/🔒\s*Prime/)`
    // queries throw on a second match in the same row, and `goldRowIds()`
    // asserts exactly one gold row. A medallion drawn with the emoji or in
    // `#ceac5f` would break both — pinned here so the next reader does not
    // "simplify" the inline Lock SVG back into a character.
    await renderTab([
      ouroFx({ id: "prime", name: "Prime", isActive: true, hasEncryptedArweaveUpload: true }),
      ouroFx({ id: "o2", name: "Second", address: "Ѻ.second", isActive: true }),
    ]);

    const prime = rowOf("prime");
    const medallion = within(prime).getByTestId("account-locked-prime");
    expect(medallion.textContent).not.toMatch(/🔒/);
    // Still exactly one 🔒 Prime pill in the row — this is the query the
    // medallion must not collide with.
    expect(within(prime).getByText(/🔒\s*Prime/)).toBeTruthy();
    expect(goldRowIds()).toEqual(["prime"]);
  });
});

describe("<OuronetAccountsTab> — the settled master is renameable, but still NOT deletable", () => {
  it("offers Rename on the settled master, prefilled with its OWN name, and the rename lands on the second line with the designation intact", async () => {
    // The owner's model: a prime account "can still get its normal name, like
    // the other accounts and seeds, which wouldn't have been possible
    // before". The designation is DERIVED, so it cannot collide with whatever
    // the user types — which is what makes this affordance safe at all.
    await renderTab(screenshotAccounts(), {}, SETTLED_ON_HODLER, SEALED);

    const hodler = rowOf("hodler");
    expandRow(hodler);
    fireEvent.click(within(hodler).getByRole("button", { name: /^rename$/i }));
    // Prefilled with the stored name, NOT with the golden designation — a
    // draft seeded from the designation would write the role name onto disk
    // the moment the user pressed Enter.
    const input = within(hodler).getByDisplayValue("AncientHodler");
    fireEvent.change(input, { target: { value: "Hodler Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("account-own-name-hodler").textContent).toBe("Hodler Renamed");
    });
    expect(within(rowOf("hodler")).getByTestId("account-designation-hodler").textContent).toBe(
      "Codex Ouronet Master",
    );
  });

  it("offers NO delete control at all on the settled master NOR on the displaced index-0 account — delete protection is never loosened", async () => {
    // `CodexPrimeProtectedError` is funds-adjacent and keyed off the stored
    // `isPrime` flag, which does NOT move on a settlement. So the row set the
    // UI refuses to delete is the UNION of today's (index 0, CodexID halves)
    // and the settled master — never a swap.
    //
    // DELIBERATE REWRITE (locked-entities-and-former-prime/plan.md T5). Both
    // rows used to be asserted via `getByRole("button", { name: /cannot be
    // removed/i })` plus `.disabled === true` — i.e. a DISABLED delete
    // control. The owner overruled that behaviour: "delete button should not
    // be available for them", taken literally. So the assertion flips from
    // "present and disabled" to "absent", and the `/^delete$/i` null checks
    // below are kept verbatim — they were true then and are true now, and
    // together the pair proves no delete affordance of EITHER kind survives.
    // Not a casualty: do not restore the disabled-button form.
    await renderTab(screenshotAccounts(), {}, SETTLED_ON_HODLER, SEALED);

    const hodler = rowOf("hodler");
    expandRow(hodler);
    expect(within(hodler).queryByRole("button", { name: /cannot be removed/i })).toBeNull();
    expect(within(hodler).queryByRole("button", { name: /^delete$/i })).toBeNull();
    // ...and the row still SAYS why, which is what makes withholding the
    // control an explanation rather than a disappearance.
    expect(within(hodler).getByTestId("account-locked-hodler").getAttribute("aria-label"))
      .toMatch(/^Locked — /);

    const initial = rowOf("initial");
    expandRow(initial);
    expect(within(initial).queryByRole("button", { name: /cannot be removed/i })).toBeNull();
    expect(within(initial).queryByRole("button", { name: /^delete$/i })).toBeNull();
  });
});
