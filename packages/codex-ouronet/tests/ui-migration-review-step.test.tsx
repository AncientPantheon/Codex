/**
 * The REVIEW step — the stage 1 -> 2 gate.
 *
 * Owner: *"i need to make sure the parts prior to it are all correct."* A
 * commit you cannot inspect first is one you have to undo to understand, so
 * this screen must show every choice AND its consequences, and reaching it
 * must still have written nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

const WORDS = "river stone ember";
vi.mock("@stoachain/stoa-core/crypto", async (o) => ({
  ...(await o<Record<string, unknown>>()),
  smartDecrypt: async () => WORDS,
}));
const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("../src/zbom/ouroSelectorReads.js", async (o) => ({
  ...(await o<Record<string, unknown>>()),
  getAccountSelectorDataLive: () => selectorRows(),
}));

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";
import type { IOuroAccount, IStoaChainSeed } from "../src/types/entities.js";

const BITS = seedWordsToBitString(WORDS.split(" "));
const KEY0 = deriveStoaDalosKeypairAtIndex(BITS, 0).publicKey;
const KEY1 = deriveStoaDalosKeypairAtIndex(BITS, 1).publicKey;
const CURRENT_PAYMENT = "9".repeat(64);

const account = (o: Partial<IOuroAccount> & { id: string }): IOuroAccount => ({
  version: "1.0", isSmart: false, address: `Ѻ.${o.id}`, guard: null,
  stoaChainLedger: null, publicKey: "pub", secret: `ct-${o.id}`,
  backup: "ct", originSeedTab: "write-seed", ...o,
});

const seeds: IStoaChainSeed[] = [{
  id: "seed-1", name: "Initial Seed", seedType: "koala", version: "1.0.0", index: 0,
  secret: "ct", main: "", createdAt: "2026-10-29T09:00:00.000Z", isPrime: true,
  accounts: [
    { index: 0, publicKey: CURRENT_PAYMENT, derivationPath: "m/0" },
    { index: 1, publicKey: "7".repeat(64), derivationPath: "m/1" },
  ],
}];

let store: ReturnType<typeof useCodexStore> | null = null;
function Grab() { store = useCodexStore(); return null; }

const pick = (tid: string) =>
  fireEvent.click(within(screen.getByTestId(tid)).getByRole("button"));

async function reachReview(
  guard:
    | "recommended" | "custom" | "keep"
    // guard-step-variants (docs/work/guard-step-variants/design.md): the
    // three newest kinds, each needing its own drive sequence below since
    // none of them is a single click on a same-named testid the way the
    // three original kinds are.
    | "update-keyset-recommended" | "update-keyset-custom" | "use-existing-keyset"
    = "recommended",
  opts: {
    /** Variant A ("update-keyset-*") needs the CURRENT guard to be a
     *  keyset reference — defaults to `null` (Variant B), matching every
     *  pre-existing call site. */
    currentGuard?: IOuroAccount["guard"];
    describeKeyset?: (n: string) => Promise<{ keys: readonly string[]; pred: string }>;
  } = {},
) {
  const current = account({ id: "current", name: "AncientHodler", guard: opts.currentGuard ?? null });
  store = null;
  render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <Grab />
      <LegacyPrimeMigrationWizard
        open onClose={() => {}}
        currentPrimeAccount={current}
        allAccounts={[current]}
        allSeeds={seeds}
        describeKeyset={opts.describeKeyset}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  act(() => { store!.getState().actions.authenticate("pw", 60); });
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  const keep = await screen.findByTestId("legacy-prime-migration-account-option-keep");
  fireEvent.click(within(keep).getByRole("button"));
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  await screen.findByTestId("legacy-prime-migration-payment-section");
  pick("legacy-prime-migration-payment-option-derive");
  // Payment (3A) and guard (3B) are separate pages now (owner correction,
  // this session) — Continue again to reach the guard page before picking
  // a guard option.
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  await screen.findByTestId("legacy-prime-migration-guard-section");

  if (guard === "update-keyset-recommended") {
    pick("legacy-prime-migration-guard-option-update-keyset");
  } else if (guard === "update-keyset-custom") {
    // Variant A's custom option defaults to sub-tab 3A ("update-keyset-
    // custom"), so picking the header is enough to reach the editor.
    pick("legacy-prime-migration-guard-option-custom");
    const editor = await screen.findByTestId("legacy-prime-migration-guard-custom-editor");
    fireEvent.click(within(editor).getByLabelText("Master Chainweb Seed - Key #1"));
  } else if (guard === "use-existing-keyset") {
    pick("legacy-prime-migration-guard-option-custom");
    fireEvent.click(await screen.findByTestId("legacy-prime-migration-guard-custom-sub-existing"));
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ns"), {
      target: { value: "ouronet-ns" },
    });
    fireEvent.change(screen.getByTestId("legacy-prime-migration-guard-existing-ksn"), {
      target: { value: "owner-made-keyset" },
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-guard-existing-resolve"));
    await screen.findByTestId("legacy-prime-migration-guard-existing-resolved");
  } else {
    pick(`legacy-prime-migration-guard-option-${guard === "keep" ? "keep" : guard}`);
  }

  await waitFor(() => {
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(false);
  });
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
  return screen.findByTestId("legacy-prime-migration-review");
}

beforeEach(() => { selectorRows.mockReset(); });

describe("the review step shows every choice", () => {
  it("names which account becomes the master", async () => {
    await reachReview();
    expect(screen.getByTestId("legacy-prime-migration-review-account").textContent)
      .toMatch(/Ouronet Codex Master/);
  });

  it("shows the payment key FROM -> TO with the real derived value", async () => {
    await reachReview();
    const box = screen.getByTestId("legacy-prime-migration-review-payment");
    await waitFor(() => expect(box.textContent).toMatch(/FROM/));
    expect(box.textContent).toMatch(/TO/);
    // the real position-0 key, not a placeholder
    expect(box.querySelector(`[title="${KEY0}"]`)).toBeTruthy();
  });

  it("shows the guard it will install, with the real position-1 key", async () => {
    await reachReview();
    const box = screen.getByTestId("legacy-prime-migration-review-guard");
    // guard-step-variants (docs/work/guard-step-variants/design.md):
    // the review's guard copy is now kind-agnostic ("A keyset of N key(s)
    // under PRED") rather than a special case per kind, so this and every
    // other guard choice reads through the same, now-correct-for-all-kinds
    // line.
    await waitFor(() => expect(box.textContent).toMatch(/a keyset of 1 key\(s\) under keys-all/i));
    expect(box.querySelector(`[title="${KEY1}"]`)).toBeTruthy();
  });

  it("states the CONSEQUENCE — what becomes non-removable", async () => {
    // The fact a user cannot infer from "keys-all over position 1", and the
    // one that is hard to undo.
    await reachReview();
    const box = screen.getByTestId("legacy-prime-migration-review-consequences");
    expect(box.textContent).toMatch(/non-removable/i);
    expect(box.textContent).toMatch(/Master Chainweb Seed/);
  });

  it("says the funds move afterwards and that eligibility waits for it", async () => {
    await reachReview();
    expect(screen.getByTestId("legacy-prime-migration-review-consequences").textContent)
      .toMatch(/not marked eligible until that is done/i);
  });

  it("reports a KEEP choice as unchanged rather than inventing a FROM -> TO", async () => {
    await reachReview("keep");
    expect(screen.getByTestId("legacy-prime-migration-review-guard").textContent)
      .toMatch(/Unchanged/);
  });

  // code review (guard-step-variants): the ReviewStep branching for the
  // three newest guard kinds (`update-keyset-recommended`/`-custom`/
  // `use-existing-keyset`) had no coverage here at all — every end-to-end
  // wizard test driving those kinds clicks straight past this screen
  // without asserting on its content. These three close that gap.
  it("shows 'update the keyset' (Variant A, DALOS Highly Recommended) as a keyset of 1 key under keys-all, using the derived position-1 key", async () => {
    const refGuard = { keysetref: { ns: "ouronet-ns", ksn: "owner-keyset" } } as unknown as IOuroAccount["guard"];
    await reachReview("update-keyset-recommended", {
      currentGuard: refGuard,
      describeKeyset: async () => ({ keys: ["7".repeat(64)], pred: "keys-all" }),
    });
    const box = screen.getByTestId("legacy-prime-migration-review-guard");
    await waitFor(() => expect(box.textContent).toMatch(/a keyset of 1 key\(s\) under keys-all/i));
    expect(box.querySelector(`[title="${KEY1}"]`)).toBeTruthy();
  });

  it("shows a CUSTOM 'update the keyset' choice (Variant A, 3A) with the CHOSEN key, not a re-derived one", async () => {
    const refGuard = { keysetref: { ns: "ouronet-ns", ksn: "owner-keyset" } } as unknown as IOuroAccount["guard"];
    const seedKey1 = "7".repeat(64); // seeds[0]'s own position-1 key, the one CustomKeysetEditor lists
    await reachReview("update-keyset-custom", {
      currentGuard: refGuard,
      describeKeyset: async () => ({ keys: [seedKey1], pred: "keys-all" }),
    });
    const box = screen.getByTestId("legacy-prime-migration-review-guard");
    await waitFor(() => expect(box.textContent).toMatch(/a keyset of 1 key\(s\) under keys-all/i));
    expect(box.querySelector(`[title="${seedKey1}"]`)).toBeTruthy();
  });

  it("shows a resolved 'use an existing keyset' choice with describeKeyset's OWN predicate, not the keys-all fallback", async () => {
    await reachReview("use-existing-keyset", {
      describeKeyset: async () => ({ keys: [KEY0, KEY1], pred: "keys-2" }),
    });
    const box = screen.getByTestId("legacy-prime-migration-review-guard");
    // The load-bearing assertion: NOT "keys-all" (every other non-custom
    // kind's fallback before this fix) — the resolved keyset's OWN
    // predicate, read straight off the recorded choice.
    await waitFor(() => expect(box.textContent).toMatch(/a keyset of 2 key\(s\) under keys-2/i));
    expect(box.querySelector(`[title="${KEY0}"]`)).toBeTruthy();
    expect(box.querySelector(`[title="${KEY1}"]`)).toBeTruthy();
  });
});

describe("reaching the review writes NOTHING to the codex", () => {
  it("leaves alignment, the master seed row and the locks untouched", async () => {
    await reachReview();
    const st = store!.getState();
    expect(st.primeAlignment).toBe("legacy");
    expect(st.codexMasterSeed).toBeUndefined();
    expect(st.masterKeyLocks).toEqual([]);
  });

  it("records only the SELECTION, which is what makes it resumable", async () => {
    await reachReview();
    expect(store!.getState().migrationProgress?.stage).toBe("selection");
    expect(store!.getState().migrationProgress?.committed).toBeUndefined();
  });

  it("going Back from the review keeps the choices editable", async () => {
    // Review's "Back" lands on guard (3B) first — the step immediately
    // before it now that payment and guard are separate pages (owner
    // correction, this session) — then payment (3A) one more Back.
    await reachReview();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back"));
    expect(await screen.findByTestId("legacy-prime-migration-guard-section")).toBeTruthy();
    fireEvent.click(screen.getByTestId("legacy-prime-migration-back"));
    expect(await screen.findByTestId("legacy-prime-migration-payment-section")).toBeTruthy();
    expect(store!.getState().primeAlignment).toBe("legacy");
  });
});
