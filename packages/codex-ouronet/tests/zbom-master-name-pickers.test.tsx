/**
 * The two ZBOM dropdowns name the SETTLED master (settled-master-identity, T4).
 *
 * `<StoicTagPicker>` and `<AddressBookPicker>` both label the user's own
 * Ouronet accounts through `masterOuronetAccountName`. Before this topic that
 * helper was purely positional, so after the eligibility wizard settled a
 * NON-first account as master these dropdowns kept calling it by its old name
 * ("AncientHodler") while index 0 kept the master label — the defect in
 * `docs/work/settled-master-identity/design.md` §Problem 1.
 *
 * These are one-line option labels (the second line is already spoken for:
 * the §tag in StoicTagPicker, the truncated address in AddressBookPicker), so
 * the former name goes INLINE — `Codex Ouronet Master (AncientHodler)`, via
 * codex-ui's existing `codexIdPrimeName`. Two regressions are guarded per
 * picker: the settled master must read under its role with its former name
 * inline and NOT sprout a second line, and a codex that never settled a
 * master must read exactly as it does today (positional, with no parenthetical
 * suffix appearing out of nowhere).
 *
 * NB: `@testing-library/jest-dom` is NOT registered in `tests/setup.ts`, so
 * `toBeInTheDocument()` et al. throw "Invalid Chai property" here. Plain
 * `textContent` / `queryByText(...) === null` checks only.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";
import StoicTagPicker from "../src/zbom/cfm/StoicTagPicker.js";
import AddressBookPicker from "../src/zbom/cfm/AddressBookPicker.js";

afterEach(() => cleanup());

// ── Fixtures ────────────────────────────────────────────────────────────────

function acct(over: Partial<IOuroAccount> & { id: string; address: string }): IOuroAccount {
  return {
    name: undefined,
    version: "1.0",
    isSmart: false,
    guard: { pred: "keys-all", keys: [] },
    stoaChainLedger: null,
    publicKey: "",
    secret: "",
    backup: "",
    isActive: true,
    ...over,
  };
}

/** Index 0 — holds the master name positionally on a never-settled codex. */
const FIRST = acct({
  id: "acc-first",
  address: "Ѻ.AAAfirstAAAA",
  name: "CodexPrime",
  stoicTag: "firsttag",
  isPrime: true,
});
/** Index 1 — what the wizard settles on in the owner's real codex. */
const HODLER = acct({
  id: "acc-hodler",
  address: "Ѻ.BBBhodlerBBB",
  name: "AncientHodler",
  stoicTag: "hodlertag",
});
/** Index 2 — a master that never had a stored name of its own. */
const NAMELESS = acct({
  id: "acc-nameless",
  address: "Ѻ.CCCnamelessCC",
  stoicTag: "namelesstag",
});

const ACCOUNTS = [FIRST, HODLER, NAMELESS];

const MASTER_ONLY = "Codex Ouronet Master";
const MASTER_INLINE = "Codex Ouronet Master (AncientHodler)";

/** Adapter seeded with the three accounts and, optionally, a settled master. */
async function seededAdapter(settledOuroAccountId?: string): Promise<MemoryCodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  const base = emptySnapshot("dev");
  await adapter.saveAll({
    ...base,
    ouroAccounts: ACCOUNTS,
    codexMasterSeed: settledOuroAccountId
      ? {
          ouroAccountId: settledOuroAccountId,
          chainwebSeedId: "seed-master",
          establishedAt: "2026-11-01T00:00:00.000Z",
        }
      : undefined,
  });
  return adapter;
}

/** Mount a picker and open its popover, returning once options are rendered. */
async function openPicker(
  which: "stoic" | "addressBook",
  settledOuroAccountId?: string,
): Promise<void> {
  const adapter = await seededAdapter(settledOuroAccountId);
  render(
    <CodexProvider adapter={adapter}>
      {which === "stoic" ? (
        <StoicTagPicker onSelect={() => {}} />
      ) : (
        <AddressBookPicker addressType="ouronet" onSelect={() => {}} />
      )}
    </CodexProvider>,
  );
  const title = which === "stoic" ? "Insert a StoicTag" : "Address Book";
  fireEvent.click(await screen.findByTitle(title));
  // The options only appear once the adapter snapshot has hydrated the store.
  await waitFor(() => expect(screen.queryByText(anchorText(which, NAMELESS))).not.toBeNull());
}

/**
 * The option line that identifies an account REGARDLESS of its display name —
 * its §tag in StoicTagPicker, its address in AddressBookPicker. Used to reach
 * each account's own option, so a label assertion can never be satisfied by a
 * DIFFERENT account that happens to carry the expected text (which is exactly
 * how a positional-naming bug hides).
 *
 * (The fixture addresses are all ≤16 chars, so AddressBookPicker's `truncAddr`
 * renders them verbatim.)
 */
function anchorText(which: "stoic" | "addressBook", acc: IOuroAccount): string {
  return which === "stoic" ? `§${acc.stoicTag}` : acc.address;
}

/**
 * The displayed NAME line of `acc`'s own option, asserted to be a single leaf
 * line inside a two-line option (name + identifier). A name that grew a second
 * line would either nest an element here or add a third child.
 */
function optionNameOf(which: "stoic" | "addressBook", acc: IOuroAccount): string {
  const anchor = screen.getByText(anchorText(which, acc));
  const option = anchor.parentElement!;
  expect(option.childElementCount).toBe(2);
  // StoicTagPicker puts the §tag first and the name second; AddressBookPicker
  // puts the name first and the address second.
  const nameEl = option.children[which === "stoic" ? 1 : 0] as HTMLElement;
  expect(nameEl.childElementCount).toBe(0);
  return nameEl.textContent ?? "";
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe.each([
  ["StoicTagPicker", "stoic" as const],
  ["AddressBookPicker", "addressBook" as const],
])("%s names the settled master", (_label, which) => {
  it("reads 'Codex Ouronet Master (AncientHodler)' on ONE line for a settled non-first account", async () => {
    await openPicker(which, HODLER.id);

    expect(optionNameOf(which, HODLER)).toBe(MASTER_INLINE);
    // No second line: the former name exists ONLY inside the inline label.
    expect(screen.queryByText("AncientHodler")).toBeNull();
  });

  it("moves the master name OFF index 0, which falls back to its own stored name", async () => {
    await openPicker(which, HODLER.id);

    expect(optionNameOf(which, FIRST)).toBe("CodexPrime");
  });

  it("renders a settled master with no stored name as the bare role, with no empty parens", async () => {
    await openPicker(which, NAMELESS.id);

    expect(optionNameOf(which, NAMELESS)).toBe(MASTER_ONLY);
    // The name moved off index 0 and onto the nameless account, so nothing
    // else may read as the master either.
    expect(optionNameOf(which, FIRST)).toBe("CodexPrime");
  });

  it("with NO settled master, index 0 still reads 'Codex Ouronet Master' exactly (today's behaviour)", async () => {
    await openPicker(which);

    // Today's label carries no inline former name; the stored "CodexPrime"
    // stays displaced and silent, exactly as before this topic.
    expect(optionNameOf(which, FIRST)).toBe(MASTER_ONLY);
    expect(screen.queryByText("CodexPrime")).toBeNull();
    // ...and the other accounts keep their own positional names, unchanged.
    expect(optionNameOf(which, HODLER)).toBe("AncientHodler");
    expect(optionNameOf(which, NAMELESS)).toBe("Account #3");
  });
});
