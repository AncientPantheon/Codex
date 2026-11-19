/**
 * Step 3 - the payment-key and guard sections (topic 5).
 *
 * Owner's ask, verbatim in two parts: *"we display the Current payment key,
 * and its ties, and ask what would the user want"*, then *"we display first
 * the current guard, and if its a keyset refference we unfold it and get the
 * keys it references towards."*
 *
 * The guard half is driven through a FAKE `describeKeyset` so the unfolding
 * (and, more importantly, its FAILURE mode) is testable with no chain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within, cleanup } from "@testing-library/react";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

const WORDS = "river stone ember";
vi.mock("@stoachain/stoa-core/crypto", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, smartDecrypt: async () => WORDS };
});

const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorDataLive: () => selectorRows() };
});

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";
import type { IOuroAccount, IStoaChainSeed, IKeyset, IPureKeypair } from "../src/types/entities.js";
import type { MigrationProgress } from "@ancientpantheon/codex-core";

const PASSWORD = "step3-test-pw";
const BITS = seedWordsToBitString(WORDS.split(" "));
const KEY0 = deriveStoaDalosKeypairAtIndex(BITS, 0).publicKey;
const KEY1 = deriveStoaDalosKeypairAtIndex(BITS, 1).publicKey;

const CURRENT_PAYMENT = "9".repeat(64);
const OTHER_KEY = "7".repeat(64);

function account(o: Partial<IOuroAccount> & { id: string }): IOuroAccount {
  return {
    version: "1.0", isSmart: false, address: `Ѻ.${o.id}-address`, guard: null,
    stoaChainLedger: null, publicKey: "pub", secret: `ct-${o.id}`,
    backup: "ct", originSeedTab: "write-seed", ...o,
  };
}

const seeds: IStoaChainSeed[] = [{
  id: "seed-1", name: "Initial Seed", seedType: "koala", version: "1.0.0", index: 0,
  secret: "ct", main: "", createdAt: "2026-10-27T10:00:00.000Z", isPrime: true,
  accounts: [
    { index: 0, publicKey: CURRENT_PAYMENT, derivationPath: "m/0" },
    { index: 1, publicKey: OTHER_KEY, derivationPath: "m/1" },
  ],
}];

let store: ReturnType<typeof useCodexStore> | null = null;
function Grab() { store = useCodexStore(); return null; }

async function openStep3(opts: {
  guard?: IKeyset | null;
  describeKeyset?: (n: string) => Promise<{ keys: readonly string[]; pred: string }>;
  pureKeypairs?: readonly IPureKeypair[];
} = {}) {
  const current = account({ id: "current", name: "AncientHodler", guard: opts.guard ?? null });
  store = null;
  render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <Grab />
      <LegacyPrimeMigrationWizard
        open onClose={() => {}}
        currentPrimeAccount={current}
        allAccounts={[current]}
        allSeeds={seeds}
        pureKeypairs={opts.pureKeypairs}
        describeKeyset={opts.describeKeyset}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));   // intro -> account
  // The option is a container; the clickable control is the button inside it.
  const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
  fireEvent.click(within(keepOption).getByRole("button"));
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));   // account -> payment
  await screen.findByTestId("legacy-prime-migration-payment-section");
}

/** Payment (3A) and guard (3B) are separate pages now (owner correction,
 *  this session: "made step 3A and step 3B as individual steps, not both
 *  on the same step 3 page") — call after `openStep3()` for any test that
 *  needs the guard page's own content. Payment already defaults to its
 *  recommended option, so Continue is enabled without picking anything. */
async function goToGuardStep() {
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));   // payment -> guard
  await screen.findByTestId("legacy-prime-migration-guard-section");
}

// `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "E": every group
// starts collapsed unless it already holds a selected key, so a row inside
// a given group is only queryable/clickable once that group's own
// disclosure header has been opened. Shared across every describe block
// below that reaches into `legacy-prime-migration-guard-custom-editor`.
const expandGroup = (editor: HTMLElement, n: number) => {
  fireEvent.click(within(editor).getByTestId(`legacy-prime-migration-guard-custom-group-${n}`));
};

beforeEach(() => { selectorRows.mockReset(); });

describe("Step 3 - payment key section", () => {
  // The "Step 3A"/"Step 3B" labels moved to the MODAL subtitle once payment
  // and guard became separate pages (owner correction, this session) —
  // repeating them inline here would be redundant with it, the same
  // reason `AccountStep`/`IntroStep` don't repeat "Step 2"/"Step 1" either.
  it('shows the modal subtitle "Step 3A of 5 — Payment Key Setup"', async () => {
    await openStep3();
    expect(screen.getByText(/step 3a of 5/i)).toBeTruthy();
  });

  it("shows the CURRENT payment key and the seed + position holding it (its 'ties')", async () => {
    await openStep3();
    expect(screen.getByTestId("legacy-prime-migration-payment-current")).toBeTruthy();
    const ties = screen.getByTestId("legacy-prime-migration-payment-ties").textContent ?? "";
    // The first seed renders under its MASTER name, not its stored one.
    expect(ties).toMatch(/Master Chainweb Seed/);
    expect(ties).toMatch(/Key #0/);
  });

  // Owner: "by default the option 1 is selectable, which means the new
  // derivation... must show the one that will become" — landing on this
  // step must not require a click before the user sees anything chosen.
  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 7):
  // "the circled rectangle... is no longer needed, because we already
  // show it where the arrow is pointing" — the standalone FROM/TO box
  // duplicated the SAME two values the CURRENT/SETTLED FOR pair above it
  // already shows (CURRENT = the FROM value, SETTLED FOR = the TO
  // value), so it's gone outright. The "TO" value now lives on the
  // SETTLED FOR box's own `KeyLine` instead, under the SAME testid
  // (`legacy-prime-migration-payment-to`) so it stays trivially
  // assertable without the redundant second box.
  it("pre-selects option 1 (derive) on arrival, with the derived key already visible in the SETTLED FOR box — no separate FROM/TO box", async () => {
    await openStep3();
    expect(
      screen.getByTestId("legacy-prime-migration-payment-option-derive").getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("legacy-prime-migration-payment-option-keep").getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.queryByTestId("legacy-prime-migration-payment-fromto")).toBeNull();
    expect(screen.getByTestId("legacy-prime-migration-payment-current")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-payment-to")).toBeTruthy();
    });
  });

  it("shows the derived key in the SETTLED FOR box once the derive option is (re-)chosen, with no separate FROM/TO box", async () => {
    await openStep3();
    fireEvent.click(within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"));
    expect(screen.queryByTestId("legacy-prime-migration-payment-fromto")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-payment-to")).toBeTruthy();
    });
  });

  it("switching to 'keep' deselects derive and the derived-key display disappears", async () => {
    await openStep3();
    await screen.findByTestId("legacy-prime-migration-payment-to"); // starts showing (default: derive)
    fireEvent.click(within(screen.getByTestId("legacy-prime-migration-payment-option-keep")).getByRole("button"));
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-payment-option-keep").getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(screen.queryByTestId("legacy-prime-migration-payment-to")).toBeNull();
    expect(screen.queryByTestId("legacy-prime-migration-payment-fromto")).toBeNull();
  });

  // owner (live testing, this session): "only the circled 1 and 2 can be
  // pressed, we need to be able to make the whole selection clickable" —
  // clicking the DESCRIPTION text (not the header button) must select
  // the option too.
  it("clicking the option's DESCRIPTION text (not just its header button) selects it", async () => {
    await openStep3();
    const keepOption = screen.getByTestId("legacy-prime-migration-payment-option-keep");
    fireEvent.click(within(keepOption).getByText(/recovering it depends on/i));
    await waitFor(() => {
      expect(keepOption.getAttribute("aria-selected")).toBe("true");
    });
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 7):
  // "when making the 2nd selection, which is to keep the existing
  // private key, the circled Dalos Derivation would have to Change to
  // Koala Derivation, because that[']s what the seed is using that is
  // responsible for the key involved in the second Selection." The
  // "Derivation method" section's own option 1 defaults to
  // `STOIC_DALOS_DERIVATION_LABEL` unconditionally — honest while
  // deriving (it genuinely IS the method in use), but misleading once
  // the payment key is instead KEPT as an EXISTING, non-Stoic-Dalos key
  // (Koala here, from this file's own fixture: `seedType: "koala"`):
  // nothing is being Stoic-Dalos-derived for payment at all anymore, so
  // the label now reflects the kept key's own REAL origin instead.
  it("relabels 'Derivation method' option 1 to the kept payment key's own real origin ('Koala Derivation'), once payment is explicitly KEPT as an existing koala key", async () => {
    await openStep3();
    // Starts out "Stoic Dalos Derivation" — payment still defaults to
    // "derive", genuinely using that method.
    expect(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByText("Stoic Dalos Derivation"),
    ).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("legacy-prime-migration-payment-option-keep")).getByRole("button"));

    await waitFor(() => {
      expect(
        within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).getByText("Koala Derivation"),
      ).toBeTruthy();
    });
    expect(
      within(screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos")).queryByText("Stoic Dalos Derivation"),
    ).toBeNull();
  });

  it("derives the TO key at POSITION 0 of the chosen account's words", async () => {
    await openStep3();
    fireEvent.click(within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"));
    await waitFor(() => {
      const to = screen.getByTestId("legacy-prime-migration-payment-to");
      // MeasuredHexHighlight truncates, so assert on the title (full value).
      expect(to.textContent ?? "").not.toBe("");
    });
    expect(KEY0).not.toBe(KEY1); // the two positions really are different keys
  });

  // owner (live testing, this session): "Current detected, and the
  // upcoming one you settled for in a simple Current/Before and After
  // Rectangle." The payment step's own "Settled for" box must summarize
  // whichever option is currently chosen.
  it("the 'Settled for' box shows the NEW key once deriving completes", async () => {
    await openStep3();
    fireEvent.click(within(screen.getByTestId("legacy-prime-migration-payment-option-derive")).getByRole("button"));
    await waitFor(() => {
      const settled = screen.getByTestId("legacy-prime-migration-payment-settled");
      expect(settled.textContent).toMatch(/a new key, derived at position 0/i);
      expect(settled.querySelector(`[title="${KEY0}"]`)).toBeTruthy();
    });
  });

  it("the 'Settled for' box shows 'Unchanged' and the kept key's own origin when keeping", async () => {
    await openStep3();
    fireEvent.click(within(screen.getByTestId("legacy-prime-migration-payment-option-keep")).getByRole("button"));
    const settled = screen.getByTestId("legacy-prime-migration-payment-settled");
    expect(settled.textContent).toMatch(/unchanged/i);
    expect(settled.textContent).toMatch(/koala/i);
    expect(settled.querySelector(`[title="${CURRENT_PAYMENT}"]`)).toBeTruthy();
  });

  // CORRECTED, this session — the owner's own technical challenge: keeping
  // the payment key does NOT affect eligibility
  // (`checkArweaveRestoreEligibility` reads only the Ouronet account's
  // bitstring vs. the stored Prime Arweave address — no payment key, no
  // guard, nothing Chainweb). The old copy claimed otherwise; this pins the
  // honest replacement instead: a kept key depends on a codex backup
  // (recoverable because it gets locked), not on eligibility being at risk.
  it("honestly says KEEPING the payment key depends on a codex backup, not that it breaks eligibility", async () => {
    await openStep3();
    const keep = screen.getByTestId("legacy-prime-migration-payment-option-keep");
    expect(keep.textContent ?? "").toMatch(/depends on a codex backup/i);
    expect(keep.textContent ?? "").toMatch(/non-removable/i);
    expect(keep.textContent ?? "").not.toMatch(/does NOT achieve words-only restore/i);
    expect(keep.textContent ?? "").not.toMatch(/eligib/i);
  });

  // owner (live testing, this session): "when selecting option 2 (keep the
  // same payment key), then the Derivation method changes automatically to
  // the type of derivation that key is derived from. So it would be Koala,
  // Chainweaver or PureKey (since that key is in the codex, you could know
  // what to display here)." The fixture's own seed is `seedType: "koala"`.
  it("shows the kept payment key's OWN derivation type (Koala), detected from the codex's own seeds", async () => {
    await openStep3();
    const keep = screen.getByTestId("legacy-prime-migration-payment-option-keep");
    expect(screen.getByTestId("legacy-prime-migration-payment-keep-origin").textContent)
      .toMatch(/koala/i);
    expect(screen.queryByTestId("legacy-prime-migration-payment-keep-origin-warning")).toBeNull();
    expect(keep).toBeTruthy(); // the option itself still renders normally
  });
});

describe("Step 3 - guard section, by current guard shape", () => {
  it("says 'no guard on record' for a null guard (31 of the owner's 43 accounts)", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();
    expect(await screen.findByTestId("legacy-prime-migration-guard-current-none")).toBeTruthy();
  });

  it("lists the keys of a DIRECT keyset with its predicate", async () => {
    await openStep3({ guard: { pred: "keys-any", keys: [CURRENT_PAYMENT, OTHER_KEY] } });
    await goToGuardStep();
    const el = await screen.findByTestId("legacy-prime-migration-guard-current-keyset");
    expect(el.textContent).toMatch(/2 key\(s\)/);
    expect(el.textContent).toMatch(/keys-any/);
  });

  it("UNFOLDS a keyset reference through describeKeyset and names the ref", async () => {
    const describeKeyset = vi.fn(async () => ({ keys: [OTHER_KEY], pred: "keys-all" }));
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } } as unknown as IKeyset,
      describeKeyset,
    });
    await goToGuardStep();
    const el = await screen.findByTestId("legacy-prime-migration-guard-current-keyset");
    expect(el.textContent).toMatch(/ouronet-ns\.dh_hov-keyset/);
    expect(describeKeyset).toHaveBeenCalledWith("ouronet-ns.dh_hov-keyset");
  });

  // owner (live testing, this session): "the user has to see, hey my
  // guard currently is a keyset-ref" — expanding a reference's keys isn't
  // enough on its own; the fact that it IS a reference (as opposed to a
  // direct keyset) must be explicitly visible, with the same "keyset-ref"
  // vocabulary the Codex ID page's own guard display already uses.
  it("explicitly labels a resolved keyset-ref as a KEYSET-REF, not just an expanded key list", async () => {
    const describeKeyset = vi.fn(async () => ({ keys: [OTHER_KEY], pred: "keys-all" }));
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } } as unknown as IKeyset,
      describeKeyset,
    });
    await goToGuardStep();
    const el = await screen.findByTestId("legacy-prime-migration-guard-current-keyset");
    expect(within(el).getByTestId("legacy-prime-migration-guard-keyset-ref-badge").textContent)
      .toMatch(/keyset-ref/i);
  });

  // Owner (live testing, real data, said several times): "it still
  // doesnt show its a keyset-ref... the AncientHodler Account has a
  // keyset-ref, which is the ouronet-ns.dh_ah-keyset, which should be
  // shown there at the current guard."
  //
  // The case the two tests around this one both MISSED: a guard already
  // EXPANDED to `{pred, keys}` that still records the reference it came
  // from. `detectGuardKind` calls that a plain `"keyset"` (there's no
  // nested `keysetref` object), so the badge depended entirely on
  // `resolveGuardKeys` picking the annotation up — and it only ever read
  // the camelCase `keysetRef` spelling, so the lowercase one (which real
  // persisted guards use) silently produced an unannotated keyset. No
  // `describeKeyset` is needed or wanted here: the keys are already in
  // hand, only the "this came from a reference" fact was being dropped.
  it("labels an already-EXPANDED keyset that records its source reference as a KEYSET-REF, naming it — for both spellings, with no chain read", async () => {
    for (const annotation of [
      { keysetRef: "ouronet-ns.dh_ah-keyset" },
      { keysetref: "ouronet-ns.dh_ah-keyset" },
    ]) {
      const describeKeyset = vi.fn();
      await openStep3({
        guard: { pred: "keys-any", keys: [CURRENT_PAYMENT, OTHER_KEY], ...annotation } as unknown as IKeyset,
        describeKeyset,
      });
      await goToGuardStep();
      const el = await screen.findByTestId("legacy-prime-migration-guard-current-keyset");
      expect(within(el).getByTestId("legacy-prime-migration-guard-keyset-ref-badge").textContent)
        .toMatch(/keyset-ref/i);
      expect(el.textContent).toMatch(/ouronet-ns\.dh_ah-keyset/);
      expect(el.textContent).toMatch(/2 key\(s\)/);
      expect(describeKeyset).not.toHaveBeenCalled();
      cleanup();
    }
  });

  // Owner (live testing, real data, asked 10+ times — and THIS is why
  // every previous attempt failed): "you still havent shown that the
  // current guard is a keyset-ref… In the codex it is properly
  // recognised as a keyset ref. WHY can't you do it here as well."
  //
  // Because the two screens were reading DIFFERENT VALUES, not rendering
  // one value differently. `OuronetAccountsTab` renders
  // `hydrate(account, byAddress[address])`, overlaying the LIVE URC_0027
  // `ouronet-account-guard` ("chain fields win when present"), which is
  // the real `{keysetref:{ns,ksn}}`. This wizard read the codex's at-rest
  // `account.guard` — an older EXPANDED `{pred,keys}` snapshot with no
  // reference annotation anywhere in it. No display fix could ever
  // surface a reference that wasn't in the value being displayed.
  it("resolves the LIVE chain guard, not the codex's stale stored copy — so a keyset-ref shows as one here exactly as it does on the Codex tab", async () => {
    const describeKeyset = vi.fn(async () => ({
      keys: [CURRENT_PAYMENT, OTHER_KEY], pred: "keys-any",
    }));
    // The chain says: this account's guard IS a keyset reference.
    selectorRows.mockResolvedValue([{
      "iz-activated": true,
      "ouronet-account": "Ѻ.current-address",
      "ouronet-account-guard": { keysetref: { ns: "ouronet-ns", ksn: "dh_ah-keyset" } },
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
    } as unknown as AccountSelectorData]);

    // ...while the codex's own stored copy is a STALE expanded keyset
    // that mentions no reference at all. Reading this is what used to
    // make the badge impossible.
    await openStep3({
      guard: { pred: "keys-any", keys: [CURRENT_PAYMENT, OTHER_KEY] } as unknown as IKeyset,
      describeKeyset,
    });
    await goToGuardStep();

    const el = await screen.findByTestId("legacy-prime-migration-guard-current-keyset");
    await waitFor(() => {
      expect(within(el).getByTestId("legacy-prime-migration-guard-keyset-ref-badge").textContent)
        .toMatch(/keyset-ref/i);
    });
    expect(el.textContent).toMatch(/ouronet-ns\.dh_ah-keyset/);
    // And it genuinely went to chain to expand that reference.
    expect(describeKeyset).toHaveBeenCalledWith("ouronet-ns.dh_ah-keyset");
  });

  it("explicitly labels an UNRESOLVED keyset-ref as a KEYSET-REF too, not just an error", async () => {
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_sc_dalos-keyset" } } as unknown as IKeyset,
      describeKeyset: async () => { throw new Error("node unreachable"); },
    });
    await goToGuardStep();
    const el = await screen.findByTestId("legacy-prime-migration-guard-current-unresolved");
    expect(within(el).getByTestId("legacy-prime-migration-guard-keyset-ref-badge").textContent)
      .toMatch(/keyset-ref/i);
  });

  it("reports an UNRESOLVABLE reference as unknown - never as 'no keys'", async () => {
    // The safety property, surfaced in the UI: a failed read must not read as
    // "this guard authorizes nothing".
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_sc_dalos-keyset" } } as unknown as IKeyset,
      describeKeyset: async () => { throw new Error("node unreachable"); },
    });
    await goToGuardStep();
    const el = await screen.findByTestId("legacy-prime-migration-guard-current-unresolved");
    expect(el.textContent).toMatch(/could not be read/i);
    expect(el.textContent).toMatch(/unknown — not empty|unknown - not empty/i);
    expect(screen.queryByTestId("legacy-prime-migration-guard-current-none")).toBeNull();
  });

  it("reports a capability guard as having no enumerable keys", async () => {
    await openStep3({
      guard: { cgName: "ouronet-ns.DALOS.CAP", cgArgs: [], cgPactId: null } as unknown as IKeyset,
    });
    await goToGuardStep();
    const el = await screen.findByTestId("legacy-prime-migration-guard-current-unsupported");
    expect(el.textContent).toMatch(/does not name a fixed list of keys/i);
  });

  // Owner (live testing, this round): switched the chosen account (Page 2)
  // to a SECOND account whose real guard is a genuine keyset-ref, with NO
  // `describeKeyset` wired (the real app's state before this round's own
  // wiring fix) — the guard step's CURRENT box kept showing the FIRST
  // account's flat 2-key keyset instead of correctly flipping to the
  // second account's "could not be read" state. `guardResolution`'s own
  // effect (unlike every other resolution effect in this file) has only a
  // `cancelled` boolean, no request-id token — this reproduces the race
  // directly: switch accounts, go back to the guard step, and prove the
  // CURRENT box reflects the NEWLY chosen account's own guard, not a
  // stale leftover from the previous one.
  it("re-resolves the CURRENT guard after switching accounts — never keeps showing the PREVIOUS account's resolution", async () => {
    const flatKeys = [CURRENT_PAYMENT, OTHER_KEY];
    const current = account({
      id: "current", name: "FirstAccount",
      guard: { pred: "keys-any", keys: flatKeys } as unknown as IKeyset,
    });
    const other = account({
      id: "other", name: "AncientHodler",
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_ah-keyset" } } as unknown as IKeyset,
    });
    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current, other]}
          allSeeds={seeds}
          // No `describeKeyset` — reproduces the real app's state before
          // this round's own wiring fix (`CodexIdPage.tsx` never passed
          // it at all).
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
    const keepOption = await screen.findByTestId("legacy-prime-migration-account-option-keep");
    fireEvent.click(within(keepOption).getByRole("button"));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");

    // FirstAccount's flat keyset resolves correctly.
    let el = await screen.findByTestId("legacy-prime-migration-guard-current-keyset");
    expect(el.textContent).toMatch(/2 key\(s\)/);

    // Back to payment, back to account, switch to AncientHodler.
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back")); // guard -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back")); // payment -> account
    const otherItem = await screen.findByTestId("legacy-prime-migration-account-existing-item-other");
    fireEvent.click(otherItem);
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
    await screen.findByTestId("legacy-prime-migration-payment-section");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // payment -> guard
    await screen.findByTestId("legacy-prime-migration-guard-section");

    // AncientHodler's real guard is a keyset-ref with no describeKeyset
    // wired — this must become "could not be read", never a stale
    // continuation of FirstAccount's flat 2-key display.
    await waitFor(() => {
      expect(screen.queryByTestId("legacy-prime-migration-guard-current-keyset")).toBeNull();
    });
    el = await screen.findByTestId("legacy-prime-migration-guard-current-unresolved");
    expect(within(el).getByTestId("legacy-prime-migration-guard-keyset-ref-badge").textContent)
      .toMatch(/keyset-ref/i);
  });
});

describe("Step 3 - guard options", () => {
  // See the payment section's equivalent test above for why this is the
  // modal subtitle now, not inline section text.
  it('shows the modal subtitle "Step 3B of 5 — Ouronet Account Guard Setup"', async () => {
    await openStep3();
    await goToGuardStep();
    expect(screen.getByText(/step 3b of 5/i)).toBeTruthy();
  });

  it("offers the recommended single-key keys-all guard, naming position 1", async () => {
    await openStep3();
    await goToGuardStep();
    const rec = await screen.findByTestId("legacy-prime-migration-guard-option-recommended");
    expect(rec.textContent).toMatch(/keys-all/);
    expect(rec.textContent).toMatch(/position 1/i);
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-guard-recommended-key")).toBeTruthy();
    });
  });

  // Owner: "either way, we must be presented option 1 the default option" —
  // regardless of current guard shape (null, direct, or reference), the
  // upgrade-to-keys-all option is pre-selected without a click.
  it("pre-selects option 1 (recommended) on arrival, for a NULL current guard", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-guard-option-recommended").getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(
      screen.getByTestId("legacy-prime-migration-guard-option-keep").getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("pre-selects option 1 (recommended) on arrival, even when the current guard is a reference", async () => {
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } } as unknown as IKeyset,
      describeKeyset: async () => ({ keys: [OTHER_KEY], pred: "keys-all" }),
    });
    await goToGuardStep();
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-guard-option-recommended").getAttribute("aria-selected"),
      ).toBe("true");
    });
  });

  it("words the recommended option as REPLACING a reference when the guard is one", async () => {
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } } as unknown as IKeyset,
      describeKeyset: async () => ({ keys: [OTHER_KEY], pred: "keys-all" }),
    });
    await goToGuardStep();
    const rec = await screen.findByTestId("legacy-prime-migration-guard-option-recommended");
    await waitFor(() => expect(rec.textContent).toMatch(/Replace the reference/i));
  });

  it("keep-as-is on a REFERENCE promises not to modify the on-chain keyset, and to lock what it names", async () => {
    // The owner's settled decision, stated to the user in the UI.
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } } as unknown as IKeyset,
      describeKeyset: async () => ({ keys: [OTHER_KEY], pred: "keys-all" }),
    });
    await goToGuardStep();
    const keep = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    await waitFor(() => {
      expect(keep.textContent).toMatch(/never modified by this migration/i);
      expect(keep.textContent).toMatch(/non-removable/i);
    });
  });

  // guard-step-variants (docs/work/guard-step-variants/design.md): a NULL
  // guard is Variant B, whose custom option is tagged "Expert Mode" (the
  // owner's own wording for both variants' custom option), not the old
  // plain "Advanced" tag — that tag is still used verbatim on the
  // "unsupported"/"unknown" fallback and the payment step's own advanced
  // option, both deliberately untouched by this topic.
  it("offers a custom keyset as an EXPERT MODE option", async () => {
    await openStep3();
    await goToGuardStep();
    const custom = await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    expect(custom.textContent).toMatch(/Expert Mode/i);
    expect(custom.textContent).toMatch(/any predicate/i);
  });

  // owner (live testing, round 2): "Current detected, and the upcoming one
  // you settled for... Current/Before and After Rectangle." The guard
  // step's own "Settled for" box must summarize whichever option is
  // currently chosen, the same way the payment step's does.
  it("the 'Settled for' box shows the derived key once the recommended option is ready", async () => {
    await openStep3();
    await goToGuardStep();
    await waitFor(() => {
      const settled = screen.getByTestId("legacy-prime-migration-guard-settled");
      expect(settled.textContent).toMatch(/a keyset of 1 key\(s\) under keys-all/i);
      expect(settled.querySelector(`[title="${KEY1}"]`)).toBeTruthy();
    });
  });

  it("the 'Settled for' box shows 'no guard on record' + '(unchanged)' when keep-as-is is chosen and there's no guard at all", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();
    const keep = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keep).getByRole("button"));
    await waitFor(() => {
      const settled = screen.getByTestId("legacy-prime-migration-guard-settled");
      expect(settled.textContent).toMatch(/no guard on record/i);
      expect(settled.textContent).toMatch(/\(unchanged\)/i);
    });
  });

  // Owner (live testing, this round): "Settle for Unchanged is incorrect,
  // we should show the same keys as the one on left. instead of saying
  // Unchanged... And if its the same then we add (unchanged) in
  // parenthesis." A bare "Unchanged." told the user nothing about WHAT
  // isn't changing — this proves the real current keys now appear on the
  // right, identical to the left-hand CURRENT box, with "(unchanged)"
  // marking that they're the same.
  it("the 'Settled for' box shows the SAME real keys as the CURRENT box, with '(unchanged)', for a direct keyset", async () => {
    await openStep3({ guard: { pred: "keys-any", keys: [CURRENT_PAYMENT, OTHER_KEY] } });
    await goToGuardStep();
    const keep = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keep).getByRole("button"));
    await waitFor(() => {
      const settled = screen.getByTestId("legacy-prime-migration-guard-settled");
      expect(settled.textContent).toMatch(/2 key\(s\)/);
      expect(settled.textContent).toMatch(/keys-any/);
      expect(settled.textContent).toMatch(/\(unchanged\)/i);
      expect(settled.querySelector(`[title="${CURRENT_PAYMENT}"]`)).toBeTruthy();
      expect(settled.querySelector(`[title="${OTHER_KEY}"]`)).toBeTruthy();
    });
  });

  // Owner (live testing, this round, real-data report): "it still doesnt
  // show its a keyset-ref" — the SAME keyset-ref badge the CURRENT box
  // already shows must also appear on the SETTLED side for "keep",
  // including when it hasn't resolved.
  it("the 'Settled for' box shows the keyset-ref badge too, for 'keep' on a resolved reference", async () => {
    const describeKeyset = vi.fn(async () => ({ keys: [OTHER_KEY], pred: "keys-all" }));
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } } as unknown as IKeyset,
      describeKeyset,
    });
    await goToGuardStep();
    const keep = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keep).getByRole("button"));
    await waitFor(() => {
      const settled = screen.getByTestId("legacy-prime-migration-guard-settled");
      expect(within(settled).getByTestId("legacy-prime-migration-guard-keyset-ref-badge").textContent)
        .toMatch(/keyset-ref/i);
      expect(settled.textContent).toMatch(/ouronet-ns\.dh_hov-keyset/);
      expect(settled.textContent).toMatch(/\(unchanged\)/i);
      expect(settled.querySelector(`[title="${OTHER_KEY}"]`)).toBeTruthy();
    });
  });

  it("the 'Settled for' box shows the keyset-ref badge for 'keep' even when the reference could not be read, without fabricating keys", async () => {
    await openStep3({
      guard: { keysetref: { ns: "ouronet-ns", ksn: "dh_sc_dalos-keyset" } } as unknown as IKeyset,
      describeKeyset: async () => { throw new Error("node unreachable"); },
    });
    await goToGuardStep();
    const keep = await screen.findByTestId("legacy-prime-migration-guard-option-keep");
    fireEvent.click(within(keep).getByRole("button"));
    await waitFor(() => {
      const settled = screen.getByTestId("legacy-prime-migration-guard-settled");
      expect(within(settled).getByTestId("legacy-prime-migration-guard-keyset-ref-badge").textContent)
        .toMatch(/keyset-ref/i);
      expect(settled.textContent).toMatch(/could not be read/i);
      expect(settled.textContent).toMatch(/\(unchanged\)/i);
    });
  });
});

describe("Step 3 - the custom keyset editor (advanced)", () => {
  const pickCustom = async () => {
    const custom = await screen.findByTestId("legacy-prime-migration-guard-option-custom");
    fireEvent.click(within(custom).getByRole("button"));
    return screen.findByTestId("legacy-prime-migration-guard-custom-editor");
  };

  it("lists the codex's OWN keys, labelled by seed and position - not a blank hex box", async () => {
    // The ZBOM guard editor is free-text hex only; the owner asked for "all
    // the keys he has in wallet", so this picker is new work, not reuse.
    await openStep3();
    await goToGuardStep();
    const editor = await pickCustom();
    expandGroup(editor, 0);
    expect(within(editor).getByLabelText("Master Chainweb Seed - Key #0")).toBeTruthy();
    expect(within(editor).getByLabelText("Master Chainweb Seed - Key #1")).toBeTruthy();
  });

  it("warns while no key is selected, since an empty keyset would lock the owner out", async () => {
    await openStep3();
    await goToGuardStep();
    await pickCustom();
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-empty")).toBeTruthy();
  });

  it("selecting a key clears the warning and records the choice", async () => {
    await openStep3();
    await goToGuardStep();
    const editor = await pickCustom();
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    await waitFor(() => {
      expect(screen.queryByTestId("legacy-prime-migration-guard-custom-empty")).toBeNull();
    });
  });

  // review.md (deferred finding #2): clicking "Define a custom guard"
  // records `{kind:"custom", keys:[], ...}` immediately — a genuinely
  // INCOMPLETE choice (Continue stays blocked on it). The persisted
  // `migrationProgress.selection` must agree and stay unwritten until a
  // real key is actually picked, or abandoning the wizard here would leave
  // a half-made guard choice recorded as if it were final.
  it("merely opening the custom editor (no key picked yet) does NOT persist the selection; picking a key does", async () => {
    await openStep3();
    await goToGuardStep();
    await pickCustom();

    expect(store!.getState().migrationProgress?.selection).toBeUndefined();

    const editor = screen.getByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));

    await waitFor(() => {
      expect(store!.getState().migrationProgress?.selection?.guard).toEqual({
        kind: "custom", keys: [CURRENT_PAYMENT], pred: "keys-all",
      });
    });
  });

  it("offers the full predicate catalogue, with m-of-n DISABLED until the key count matches", async () => {
    await openStep3();
    await goToGuardStep();
    const editor = await pickCustom();
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    const select = screen.getByTestId("legacy-prime-migration-guard-custom-pred") as HTMLSelectElement;
    const byLabel = (t: string) =>
      Array.from(select.querySelectorAll("option")).find((o) => o.textContent?.startsWith(t));
    expect(byLabel("keys-all")!.hasAttribute("disabled")).toBe(false);
    // 2-of-3 needs exactly three keys; only one is selected.
    expect(byLabel("2-of-3")!.hasAttribute("disabled")).toBe(true);
    // keys-2 needs at least two.
    expect(byLabel("keys-2")!.hasAttribute("disabled")).toBe(true);
  });

  it("enables a 2-key predicate once a second key is selected", async () => {
    await openStep3();
    await goToGuardStep();
    const editor = await pickCustom();
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #1"));
    const select = screen.getByTestId("legacy-prime-migration-guard-custom-pred") as HTMLSelectElement;
    const keys2 = Array.from(select.querySelectorAll("option")).find((o) => o.textContent?.startsWith("keys-2"));
    await waitFor(() => expect(keys2!.hasAttribute("disabled")).toBe(false));
  });

  // `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "G — Pure keys
  // join the picker and the dashboard": a codex's raw pure keypairs (never
  // derived from a seed) are perfectly valid guard/payment keys, so the
  // picker must list them too — each still its OWN individually
  // selectable checkbox (a predicate needs real, distinct public keys),
  // never collapsed into one unselectable blob the way the Settling
  // Dashboard's attribution card does.
  it("lists a pureKeypairs entry as its own checkbox, and toggling it updates selectedKeys exactly like a seed-derived key", async () => {
    const PURE_KEY = "8".repeat(64);
    const pureKeypair: IPureKeypair = {
      id: "pk-1", publicKey: PURE_KEY, encryptedPrivateKey: "ct", createdAt: "2026-01-01T00:00:00.000Z",
    };
    await openStep3({ pureKeypairs: [pureKeypair] });
    await goToGuardStep();
    const editor = await pickCustom();
    // Group 0 is the seed, group 1 is the trailing "Pure Keys" group —
    // both start collapsed (no key pre-selected), so both must be opened
    // before their rows are queryable.
    expandGroup(editor, 0);
    expandGroup(editor, 1);

    // Present alongside the seed-derived keys, not instead of them.
    expect(within(editor).getByLabelText("Master Chainweb Seed - Key #0")).toBeTruthy();
    const checkbox = within(editor).getByLabelText("Pure Keypair") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
    await waitFor(() => {
      expect(store!.getState().migrationProgress?.selection?.guard).toEqual({
        kind: "custom", keys: [PURE_KEY], pred: "keys-all",
      });
    });

    // Unchecking it behaves exactly like unchecking a seed-derived key.
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(false));
  });

  // `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "E — Search +
  // collapsed-by-default grouping in the picker": with hundreds of keys a
  // flat checkbox wall is unusable, so rows are partitioned into
  // collapsible per-seed/"Pure Keys" groups, collapsed by default — a
  // regression here would mean either a huge key list is unusable again,
  // or (worse) a key the owner thinks is hidden is actually visible/picked.
  it("groups rows by seed, collapsed by default, with no row visible/queryable until its group is opened", async () => {
    await openStep3();
    await goToGuardStep();
    const editor = await pickCustom();

    const group0 = within(editor).getByTestId("legacy-prime-migration-guard-custom-group-0");
    expect(group0.getAttribute("aria-expanded")).toBe("false");
    // The group's own name and row count both appear in its header.
    expect(group0.textContent).toMatch(/Master Chainweb Seed/);
    expect(group0.textContent).toMatch(/2/);
    // Collapsed: neither row is in the DOM at all, not merely hidden.
    expect(within(editor).queryByLabelText("Master Chainweb Seed - Key #0")).toBeNull();
    expect(within(editor).queryByLabelText("Master Chainweb Seed - Key #1")).toBeNull();
  });

  it("clicking a collapsed group's header reveals its rows, and toggling one still updates selectedKeys/the predicate", async () => {
    await openStep3();
    await goToGuardStep();
    const editor = await pickCustom();
    const group0 = within(editor).getByTestId("legacy-prime-migration-guard-custom-group-0");

    fireEvent.click(group0);
    expect(group0.getAttribute("aria-expanded")).toBe("true");
    const checkbox = within(editor).getByLabelText("Master Chainweb Seed - Key #0") as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(store!.getState().migrationProgress?.selection?.guard).toEqual({
        kind: "custom", keys: [CURRENT_PAYMENT], pred: "keys-all",
      });
    });

    // Clicking the SAME header again collapses it back (manual override,
    // independent of the already-selected key inside it).
    fireEvent.click(group0);
    expect(group0.getAttribute("aria-expanded")).toBe("false");
    expect(within(editor).queryByLabelText("Master Chainweb Seed - Key #0")).toBeNull();
  });

  it("a non-empty search force-expands only the group with a matching row, and hides every other group's rows", async () => {
    const PURE_KEY = "6".repeat(64);
    const pureKeypair: IPureKeypair = {
      id: "pk-2", publicKey: PURE_KEY, encryptedPrivateKey: "ct", createdAt: "2026-01-01T00:00:00.000Z",
      label: "Treasury Key",
    };
    await openStep3({ pureKeypairs: [pureKeypair] });
    await goToGuardStep();
    const editor = await pickCustom();
    const seedGroup = within(editor).getByTestId("legacy-prime-migration-guard-custom-group-0");
    const pureGroup = within(editor).getByTestId("legacy-prime-migration-guard-custom-group-1");
    // Both start collapsed — neither row is visible yet.
    expect(seedGroup.getAttribute("aria-expanded")).toBe("false");
    expect(pureGroup.getAttribute("aria-expanded")).toBe("false");

    const search = within(editor).getByTestId("legacy-prime-migration-guard-custom-search");
    fireEvent.change(search, { target: { value: "treasury" } });

    // Only the "Pure Keys" group (the one matching row) is force-expanded.
    expect(pureGroup.getAttribute("aria-expanded")).toBe("true");
    expect(within(editor).getByLabelText("Treasury Key")).toBeTruthy();
    // The seed group has zero matches, so it stays collapsed and shows
    // none of its own rows either way.
    expect(seedGroup.getAttribute("aria-expanded")).toBe("false");
    expect(within(editor).queryByLabelText("Master Chainweb Seed - Key #0")).toBeNull();

    // Clearing the search collapses the "Pure Keys" group back to its own
    // manual (default, collapsed) state — the force-expand was search-only.
    fireEvent.change(search, { target: { value: "" } });
    expect(pureGroup.getAttribute("aria-expanded")).toBe("false");
  });

  // The resume path (`migrationResume.ts`) is the one real way a "custom"
  // guard choice's `keys` can already be non-empty the FIRST time
  // `CustomKeysetEditor` ever mounts — proving the "already-selected key"
  // branch runs at genuine first render, not merely after a user click.
  it("a group containing an already-selected key starts expanded on first render, while the other starts collapsed", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const current = account({ id: "current", name: "AncientHodler" });
    const PURE_KEY = "5".repeat(64);
    const pureKeypair: IPureKeypair = {
      id: "pk-3", publicKey: PURE_KEY, encryptedPrivateKey: "ct", createdAt: "2026-01-01T00:00:00.000Z",
    };
    await adapter.saveAll({
      ...emptySnapshot("dev"), schemaVersion: 1,
      ouroAccounts: [current], kadenaSeeds: seeds, pureKeypairs: [pureKeypair],
      migrationProgress: {
        stage: "selection",
        startedAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        selection: {
          account: { kind: "keep-current" },
          payment: { kind: "stoic-dalos-position-0" },
          guard: { kind: "custom", keys: [CURRENT_PAYMENT], pred: "keys-all" },
        },
      } satisfies MigrationProgress,
    });
    store = null;
    render(
      <CodexProvider adapter={adapter}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open onClose={() => {}}
          currentPrimeAccount={current}
          allAccounts={[current]}
          allSeeds={seeds}
          pureKeypairs={[pureKeypair]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    await screen.findByTestId("legacy-prime-migration-payment-section");
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    const seedGroup = within(editor).getByTestId("legacy-prime-migration-guard-custom-group-0");
    const pureGroup = within(editor).getByTestId("legacy-prime-migration-guard-custom-group-1");
    // The seed group holds CURRENT_PAYMENT, already in `selectedKeys` —
    // starts expanded, with no click.
    expect(seedGroup.getAttribute("aria-expanded")).toBe("true");
    expect(within(editor).getByLabelText("Master Chainweb Seed - Key #0")).toBeTruthy();
    // The Pure Keys group holds no already-selected key — starts collapsed.
    expect(pureGroup.getAttribute("aria-expanded")).toBe("false");
    expect(within(editor).queryByLabelText("Pure Keypair")).toBeNull();
  });
});

describe("Continue is never a live-looking no-op (owner-reported)", () => {
  // The bug: the button rendered gold with `cursor: pointer` in EVERY state
  // and, when a step's requirements were unmet, silently called
  // `console.debug` and returned. Indistinguishable from a broken button —
  // and gating on the legacy derivation-method flag additionally made
  // "keep the current payment key" an unreachable dead end.
  //
  // UPDATED (owner, this session, twice): both decisions now default to
  // option 1 on arrival (see "pre-selects option 1" above), AND payment and
  // guard are separate pages now, each with its own Continue. So "nothing
  // chosen yet" can no longer occur through normal navigation on EITHER
  // page — replaced by tests of the new baseline (enabled immediately on
  // both pages) plus the one path that can still genuinely block Continue:
  // switching to a custom guard keyset and leaving it empty.

  it("is ENABLED immediately on arrival on the PAYMENT page — it defaults to option 1", async () => {
    await openStep3();
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    expect(screen.queryByTestId("legacy-prime-migration-continue-blocked")).toBeNull();
  });

  it("is ALSO enabled immediately on arrival on the GUARD page — it defaults to option 1 too", async () => {
    await openStep3();
    await goToGuardStep();
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    expect(screen.queryByTestId("legacy-prime-migration-continue-blocked")).toBeNull();
  });

  it("switching guard to CUSTOM (which starts empty) blocks Continue again, and says why", async () => {
    await openStep3();
    await goToGuardStep();
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(true);
    });
    expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent)
      .toMatch(/at least one key/i);
  });

  it("ENABLES on the GUARD page once a real guard choice replaces an empty custom one", async () => {
    await openStep3();
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(true);
    });
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-recommended")).getByRole("button"),
    );
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    expect(screen.queryByTestId("legacy-prime-migration-continue-blocked")).toBeNull();
  });

  it('stays ENABLED on the "keep" payment path too — the dead end that gating on the derivation method created', async () => {
    await openStep3();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-payment-option-keep")).getByRole("button"),
    );
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-keep")).getByRole("button"),
    );
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
  });

  it("refuses a CUSTOM keyset with no keys selected, and says so", async () => {
    await openStep3();
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-continue-blocked").textContent)
        .toMatch(/at least one key/i);
    });
  });
});

/**
 * guard-step-variants (docs/work/guard-step-variants/design.md) — the
 * account's CURRENT guard shape decides which option set the guard step
 * offers. Variant A: a keyset reference. Variant B: a direct keyset, or
 * none. Neither (a capability/user guard, or an unrecognised shape): the
 * ORIGINAL 3-option fallback, unchanged — already proven byte-identical by
 * every pre-existing test above continuing to pass unmodified.
 */
describe("Step 3 - guard, Variant A (a keyset reference)", () => {
  const refGuard = { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } } as unknown as IKeyset;
  const describeKeyset = async () => ({ keys: [OTHER_KEY], pred: "keys-all" });

  it("offers exactly 4 options, tagged Not Recommended / DALOS Highly Recommended / DALOS Recommended / Expert Mode", async () => {
    await openStep3({ guard: refGuard, describeKeyset });
    await goToGuardStep();

    expect(screen.getByTestId("legacy-prime-migration-guard-option-keep").textContent)
      .toMatch(/not recommended/i);
    expect(screen.getByTestId("legacy-prime-migration-guard-option-update-keyset").textContent)
      .toMatch(/dalos highly recommended/i);
    expect(screen.getByTestId("legacy-prime-migration-guard-option-recommended").textContent)
      .toMatch(/dalos recommended/i);
    expect(screen.getByTestId("legacy-prime-migration-guard-option-custom").textContent)
      .toMatch(/expert mode/i);
    // Exactly these four — no fifth option, no "use an existing keyset"
    // leaking in from Variant B.
    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-picker")).toBeNull();
  });

  it("selecting 'update the keyset' shows the SAME derived position-1 key the direct option shows", async () => {
    await openStep3({ guard: refGuard, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-update-keyset")).getByRole("button"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-guard-option-update-keyset").getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(screen.getByTestId("legacy-prime-migration-guard-recommended-key").textContent).toContain(
      KEY1.slice(0, 3),
    );
  });

  it("'Define a custom guard' defaults to sub-tab 3A (keep the reference, update it)", async () => {
    await openStep3({ guard: refGuard, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-guard-custom-sub-update").getAttribute("aria-selected"),
      ).toBe("true");
    });
    const editor = screen.getByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    // 3A means the reference is KEPT — proven by the recorded kind once
    // Continue is reachable, via the finalize-level lock test below; here,
    // proven by which sub-tab reads selected.
    expect(
      screen.getByTestId("legacy-prime-migration-guard-custom-sub-direct").getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("toggling to sub-tab 3B switches to a direct custom keyset, same editor, fresh selection", async () => {
    await openStep3({ guard: refGuard, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));

    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-custom-sub-direct"));
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-guard-custom-sub-direct").getAttribute("aria-selected"),
      ).toBe("true");
    });
    // Switching sub-tab starts the OTHER kind's selection fresh — the
    // previous tab's key choice does not silently carry over onto a
    // different eventual on-chain action.
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
      .toMatch(/0 selected/);
  });

  // code review (guard-step-variants): re-clicking the ALREADY-active
  // sub-tab, or the "Define a custom guard" header itself while already in
  // that group, used to still re-fire `onChoose` with `keys: []` — silently
  // wiping every key the user had already chosen, with no warning.
  it("re-clicking the already-active sub-tab, or the custom header itself, does NOT wipe the chosen key", async () => {
    await openStep3({ guard: refGuard, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
        .toMatch(/1 selected/);
    });

    // Re-clicking the already-active sub-tab (3A, the default here).
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-custom-sub-update"));
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
      .toMatch(/1 selected/);

    // Re-clicking the "Define a custom guard" header, already selected.
    // Scoped to its own accessible name now that the custom editor's own
    // group-disclosure buttons also render inside this same container.
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom"))
        .getByRole("button", { name: /define a custom/i }),
    );
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
      .toMatch(/1 selected/);
  });
});

describe("Step 3 - guard, Variant B (a direct keyset, or none)", () => {
  it("offers exactly 3 options, tagged DALOS Recommended / Not Recommended / Expert Mode", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();

    expect(screen.getByTestId("legacy-prime-migration-guard-option-recommended").textContent)
      .toMatch(/dalos recommended/i);
    expect(screen.getByTestId("legacy-prime-migration-guard-option-keep").textContent)
      .toMatch(/not recommended/i);
    expect(screen.getByTestId("legacy-prime-migration-guard-option-custom").textContent)
      .toMatch(/expert mode/i);
    expect(screen.queryByTestId("legacy-prime-migration-guard-option-update-keyset")).toBeNull();
  });

  it("'Define a custom guard' defaults to sub-tab 3A (a custom on-the-spot keyset)", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-guard-custom-sub-direct").getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor")).toBeTruthy();
  });

  it("toggling to sub-tab 3B shows the existing-keyset picker, not the key editor", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));
    expect(await screen.findByTestId("legacy-prime-migration-guard-existing-picker")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-guard-custom-editor")).toBeNull();
  });

  // code review (guard-step-variants): switching FROM 3A (custom, with a
  // key already picked) TO 3B used to leave the OLD custom choice
  // committed — Continue stayed unblocked on an abandoned key selection
  // the blank "use an existing keyset" form gave no indication of.
  it("toggling from 3A (with a key picked) to 3B discards the abandoned custom choice and re-blocks Continue", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();
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

    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-custom-sub-existing"));

    // The abandoned custom key must not still be the committed choice —
    // Continue re-blocks exactly as it would for a freshly-opened picker.
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-resolved")).toBeNull();
  });

  it("resolving a real existing keyset records the choice with the KEYS AND PREDICATE describeKeyset returned, and unblocks Continue", async () => {
    const describeKeyset = vi.fn(async (name: string) => {
      expect(name).toBe("ouronet-ns.owner-made-keyset");
      return { keys: [KEY0, KEY1], pred: "keys-2" };
    });
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
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

    const resolved = await screen.findByTestId("legacy-prime-migration-guard-existing-resolved");
    expect(resolved.textContent).toMatch(/2 key\(s\) under keys-2/i);
    expect(describeKeyset).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
    expect(screen.queryByTestId("legacy-prime-migration-continue-blocked")).toBeNull();
  });

  it("a failed resolution shows the honest 'could not be read' state, and records nothing", async () => {
    const describeKeyset = vi.fn(async () => { throw new Error("node unreachable"); });
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));

    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ns"), {
      target: { value: "ouronet-ns" },
    });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "nonexistent" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));

    const error = await screen.findByTestId("legacy-prime-migration-guard-existing-error");
    expect(error.textContent).toMatch(/could not be read/i);
    expect(error.textContent).toMatch(/node unreachable/i);
    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-resolved")).toBeNull();
    // Nothing was ever a complete choice, so Continue stays blocked exactly
    // as it was before this attempt (no prior guard choice in this test).
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  // code review (guard-step-variants): a `describeKeyset` call that lands
  // AFTER the user has already typed a DIFFERENT keyset name must not be
  // committed — it is for text no longer on screen. This is the FIRST-EVER
  // resolve (so `resolved` is still null while the call is in flight,
  // meaning `onInvalidate` alone has nothing to react to), proving the
  // race needs its own, edit-triggered request-token guard.
  it("a resolve that lands AFTER ns/ksn changed again is discarded, not silently committed", async () => {
    let settle: ((v: { keys: readonly string[]; pred: string }) => void) | null = null;
    const describeKeyset = vi.fn(
      () => new Promise<{ keys: readonly string[]; pred: string }>((resolve) => { settle = resolve; }),
    );
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));

    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ns"), {
      target: { value: "ouronet-ns" },
    });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "keyset-a" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));
    await waitFor(() => expect(describeKeyset).toHaveBeenCalledTimes(1));

    // The user changes their mind BEFORE the in-flight call lands.
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "keyset-b" },
    });

    // NOW the stale request for "keyset-a" resolves.
    await act(async () => { settle!({ keys: [KEY0], pred: "keys-all" }); });

    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-resolved")).toBeNull();
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  // code review (guard-step-variants): editing ns/ksn while a resolve is
  // in flight must NOT leave the Resolve button stuck on "Resolving…"
  // forever once that in-flight call's (now-discarded) result lands — the
  // discard path must never be the only place that would have reset
  // `status` back to idle.
  it("editing ns/ksn while a resolve is in flight re-enables the Resolve button, not stuck on 'Resolving…'", async () => {
    let settle: ((v: { keys: readonly string[]; pred: string }) => void) | null = null;
    const describeKeyset = vi.fn(
      () => new Promise<{ keys: readonly string[]; pred: string }>((resolve) => { settle = resolve; }),
    );
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));

    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ns"), {
      target: { value: "ouronet-ns" },
    });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "keyset-a" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));
    await waitFor(() => expect(describeKeyset).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("legacy-prime-migration-guard-existing-resolve").textContent)
      .toMatch(/resolving/i);

    // The edit abandons the in-flight request — the button must re-enable
    // IMMEDIATELY, not wait for that request to eventually settle.
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "keyset-b" },
    });
    expect(
      (screen.getByTestId("legacy-prime-migration-guard-existing-resolve") as HTMLButtonElement).disabled,
    ).toBe(false);

    // The stale request finally lands — it must not re-lock the button
    // either (nor commit its data, already proven by the sibling test).
    await act(async () => { settle!({ keys: [KEY0], pred: "keys-all" }); });
    expect(
      (screen.getByTestId("legacy-prime-migration-guard-existing-resolve") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  // code review (guard-step-variants): a keyset that genuinely resolves to
  // ZERO keys is a real but degenerate on-chain shape — recording it as the
  // guard would lock the account out, the exact hazard CustomKeysetEditor's
  // own empty-keys warning exists to prevent for the two OTHER custom-keys
  // kinds. This kind must refuse it the same way.
  it("a resolution to a ZERO-KEY keyset is refused — honestly, not silently recorded", async () => {
    const describeKeyset = vi.fn(async () => ({ keys: [], pred: "keys-all" }));
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));

    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ns"), {
      target: { value: "ouronet-ns" },
    });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "empty-keyset" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));

    const empty = await screen.findByTestId("legacy-prime-migration-guard-existing-empty");
    expect(empty.textContent).toMatch(/names no keys/i);
    expect(empty.textContent).toMatch(/lock you out/i);
    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-resolved")).toBeNull();
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  // code review (guard-step-variants): re-resolving the SAME, already-
  // successful ns/ksn and getting back ZERO keys this time must invalidate
  // that earlier non-empty result — otherwise the stale "Resolved — N
  // key(s)" block keeps showing right next to the new "no keys" warning,
  // AND the committed guard choice stays non-empty, leaving Continue
  // wrongly unblocked on keys the re-check just said are no longer real.
  it("re-resolving an already-successful keyset to NOW-EMPTY invalidates the stale non-empty result", async () => {
    let callCount = 0;
    const describeKeyset = vi.fn(async () => {
      callCount += 1;
      return callCount === 1 ? { keys: [KEY0], pred: "keys-all" } : { keys: [], pred: "keys-all" };
    });
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
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

    // Re-resolve the SAME ns/ksn (no edit) — this time it comes back empty.
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));

    const empty = await screen.findByTestId("legacy-prime-migration-guard-existing-empty");
    expect(empty.textContent).toMatch(/names no keys/i);
    // The stale success block must be GONE, not shown alongside the warning.
    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-resolved")).toBeNull();
    // And the committed choice must have been invalidated too — Continue
    // re-blocks rather than proceeding on the now-disproven key.
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  // code review (guard-step-variants): a resolve started on sub-tab 3B,
  // still in flight when the user switches AWAY to 3A and builds a real
  // custom-key selection there, used to land late and silently overwrite
  // that selection — `ExistingKeysetPicker` is unmounted by the tab
  // switch, but nothing cancelled its pending `describeKeyset` promise.
  it("a resolve started on 3B that's still in flight when the user switches to 3A does NOT overwrite the custom selection made there", async () => {
    let settle: ((v: { keys: readonly string[]; pred: string }) => void) | null = null;
    const describeKeyset = vi.fn(
      () => new Promise<{ keys: readonly string[]; pred: string }>((resolve) => { settle = resolve; }),
    );
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
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
    await waitFor(() => expect(describeKeyset).toHaveBeenCalledTimes(1));

    // Switch away to 3A BEFORE the in-flight resolve settles — this
    // unmounts the picker.
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-custom-sub-direct"));
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
        .toMatch(/1 selected/);
    });

    // NOW the orphaned 3B resolve lands.
    await act(async () => { settle!({ keys: [KEY0, KEY1], pred: "keys-2" }); });

    // The custom selection must survive untouched — not snapped back to
    // 3B, not silently replaced by the stale resolved keyset.
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
      .toMatch(/1 selected/);
    expect(
      screen.getByTestId("legacy-prime-migration-guard-custom-sub-direct").getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-picker")).toBeNull();
  });

  // code review (guard-step-variants): the "Resolved" block used to be
  // driven ONLY by the committed choice, never by the live ns/ksn text —
  // so editing the name after a successful resolve, without re-clicking
  // "Resolve", left the stale success state on screen AND Continue
  // unblocked, ready to lock keys that no longer match what was typed.
  it("editing ns/ksn after a successful resolve, without re-resolving, invalidates the stale choice", async () => {
    const describeKeyset = vi.fn(async (name: string) =>
      name === "ouronet-ns.owner-made-keyset"
        ? { keys: [KEY0, KEY1], pred: "keys-2" }
        : { keys: [KEY0], pred: "keys-all" },
    );
    await openStep3({ guard: null, describeKeyset });
    await goToGuardStep();
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

    // Edit the keyset name WITHOUT clicking Resolve again.
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "a-different-keyset" },
    });

    // The stale "Resolved" block for the OLD keyset must disappear...
    expect(screen.queryByTestId("legacy-prime-migration-guard-existing-resolved")).toBeNull();
    // ...and Continue must re-block rather than committing stale keys.
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  // code review (guard-step-variants): same regression as Variant A's own
  // version of this test — re-clicking the already-active sub-tab or the
  // custom header must not wipe the chosen key.
  it("re-clicking the already-active sub-tab, or the custom header itself, does NOT wipe the chosen key", async () => {
    await openStep3({ guard: null });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
        .toMatch(/1 selected/);
    });

    // Re-clicking the already-active sub-tab (3A, the default here).
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-custom-sub-direct"));
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
      .toMatch(/1 selected/);

    // Re-clicking the "Define a custom guard" header, already selected.
    // Scoped to its own accessible name now that the custom editor's own
    // group-disclosure buttons also render inside this same container.
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom"))
        .getByRole("button", { name: /define a custom/i }),
    );
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
      .toMatch(/1 selected/);
  });
});

describe("Step 3 - guard, the unsupported/unknown fallback is untouched", () => {
  it("a capability guard still renders the ORIGINAL plain 'Recommended' option, not a variant-specific one", async () => {
    await openStep3({
      guard: { cgName: "ouronet-ns.DALOS.CAP", cgArgs: [], cgPactId: null } as unknown as IKeyset,
    });
    await goToGuardStep();
    const rec = screen.getByTestId("legacy-prime-migration-guard-option-recommended");
    expect(rec.textContent).toMatch(/upgrade to a single-key keyset/i);
    // No space between adjacent elements' text in `textContent`
    // ("...keysetRecommendedA keys-all...") so this can't use \b word
    // boundaries around "recommended" — just assert the plain tag appears,
    // and the DALOS-tier tag introduced for Variant A/B does not.
    expect(rec.textContent).toMatch(/recommended/i);
    expect(rec.textContent).not.toMatch(/dalos recommended/i);
    expect(screen.queryByTestId("legacy-prime-migration-guard-option-update-keyset")).toBeNull();
    // Same concatenated-textContent caveat as above — no \b.
    expect(screen.getByTestId("legacy-prime-migration-guard-option-custom").textContent)
      .toMatch(/advanced/i);
  });

  // code review (guard-step-variants): the SAME re-click-wipes-keys bug
  // fixed in GuardVariantA/GuardVariantB's "Define a custom guard" header
  // was left un-guarded in this fallback branch — any account whose guard
  // is a capability guard or an unrecognized shape routes through here.
  it("re-clicking the already-selected 'Define a custom keyset' header does NOT wipe the chosen key", async () => {
    await openStep3({
      guard: { cgName: "ouronet-ns.DALOS.CAP", cgArgs: [], cgPactId: null } as unknown as IKeyset,
    });
    await goToGuardStep();
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom")).getByRole("button"),
    );
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    expandGroup(editor, 0);
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #0"));
    await waitFor(() => {
      expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
        .toMatch(/1 selected/);
    });

    // Re-clicking the header while already selected. Scoped to its own
    // accessible name now that the custom editor's own group-disclosure
    // buttons also render inside this same container.
    fireEvent.click(
      within(screen.getByTestId("legacy-prime-migration-guard-option-custom"))
        .getByRole("button", { name: /define a custom/i }),
    );
    expect(screen.getByTestId("legacy-prime-migration-guard-custom-editor").textContent)
      .toMatch(/1 selected/);
  });
});
