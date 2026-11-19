/**
 * The decrypt pass's EXACTLY-ONCE invariant.
 *
 * Round 10 owner report: "Reading your Ouronet accounts… 0 of 14" and it
 * never moved. Root cause: the probe effect was keyed on `toProbe` — the
 * accounts still LEFT to probe — so committing a result shrank that list,
 * changed the effect's dependencies, and restarted the pass. Round 9's
 * 4-wide pool made it visible: the worker that finished cancelled the
 * other three mid-decrypt (their results dropped by the `!cancelled`
 * guards), and the restart reset the counter to 0 — forever.
 *
 * The suite did not catch it. `ui-legacy-prime-migration-wizard.test.tsx`
 * exercises the progress panel with THREE candidates, and with a pool of
 * four that converges fast enough to look fine. The bug only bites at
 * real codex sizes — the owner has 14.
 *
 * So this file pins the invariant directly rather than by timing:
 * `smartDecrypt` is counted, and a pass over N accounts must call it
 * EXACTLY N times. Restarting the pass shows up immediately as wasted
 * (and discarded) decrypts, at any N, without depending on how fast the
 * machine happens to be.
 *
 * `wizard-seed-dashboard-refinements` (this round): `accountChoice` now
 * defaults to `{kind:"keep-current"}` instead of `null` ("no state of no
 * account selected"), so the wizard's OWN preview-derivation effect (for
 * the Settling Dashboard's payment/guard tickers) now ALSO decrypts
 * `currentPrimeAccount`'s own secret concurrently with this file's probe
 * pass over the OTHER candidate accounts — a real, legitimate, UNRELATED
 * decrypt this invariant was never about. `previewAccountSecret` names
 * that ONE secret per test so the mock can exclude it from both the count
 * and the gate — the probe pass's own exactly-once invariant is otherwise
 * unaffected by it.
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, act, waitFor } from "@testing-library/react";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

/** Counts every decrypt the pass performs. The plaintext is a 3-word
 *  custom phrase: real words (so `hasKnownWords`), not a 12/24-word
 *  dictionary mnemonic (so ungated => Recommended). */
const decryptedSecrets: string[] = [];
/** When set, each decrypt blocks on this instead of a 5ms sleep, letting a
 *  test RELEASE decrypts one at a time and observe the counter deterministically.
 *  Default (null) keeps the plain async sleep for the exactly-once tests. */
let decryptGate: (() => Promise<void>) | null = null;
/** The chosen-for-preview account's OWN secret (see the module doc above)
 *  — excluded from both counting and gating, since it is a different,
 *  unrelated decrypt source from the probe pass this file actually pins. */
let previewAccountSecret: string | null = null;
vi.mock("@stoachain/stoa-core/crypto", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    smartDecrypt: async (secret: string) => {
      if (secret === previewAccountSecret) {
        await new Promise((r) => setTimeout(r, 5));
        return "river stone ember";
      }
      decryptedSecrets.push(secret);
      if (decryptGate) {
        await decryptGate();
      } else {
        // Asynchronous like the real thing, so the pool genuinely overlaps
        // and a restart has a window to interleave — just not 600k-slow.
        await new Promise((r) => setTimeout(r, 5));
      }
      return "river stone ember";
    },
  };
});

// Same stub the sibling suite uses — keeps the live URC_0027 chain read
// (and its hanging jsdom network call) out of the picture.
const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorDataLive: () => selectorRows() };
});

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import type { IOuroAccount } from "../src/types/entities.js";

const PASSWORD = "probe-pass-test-pw";

function makeAccount(overrides: Partial<IOuroAccount> & { id: string }): IOuroAccount {
  return {
    version: "1.0",
    isSmart: false,
    address: `Ѻ.${overrides.id}-address`,
    guard: null,
    stoaChainLedger: null,
    publicKey: "pub",
    secret: `ciphertext-for-${overrides.id}`,
    backup: "ciphertext",
    ...overrides,
  };
}

let store: ReturnType<typeof useCodexStore> | null = null;
function StoreGrabber() {
  store = useCodexStore();
  return null;
}

async function openAccountStepWith(candidates: readonly IOuroAccount[]): Promise<void> {
  const current = makeAccount({ id: "current", name: "CurrentAccount" });
  previewAccountSecret = current.secret;
  store = null;
  render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <StoreGrabber />
      <LegacyPrimeMigrationWizard
        open
        onClose={() => {}}
        currentPrimeAccount={current}
        allAccounts={[current, ...candidates]}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  act(() => {
    store!.getState().actions.authenticate(PASSWORD, 60);
  });
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
}

/**
 * `<StrictMode>` coverage — the gap that let the owner's stall ship.
 *
 * `apps/codex-playground/src/main.tsx` wraps the app in `<StrictMode>`;
 * Testing Library does not. StrictMode deliberately runs every effect as
 * mount -> CLEANUP -> mount again, and the probe's exactly-once guard
 * (`startedPassRef`) turned that into a permanent stall: the first mount
 * claimed the pass and was immediately cancelled, so it never settled,
 * and the second mount saw the claim already taken and started nothing.
 * The whole suite stayed green over a screen frozen at "0 of 14".
 */
describe("LegacyPrimeMigrationWizard — Page 2 decrypt pass under <StrictMode>", () => {
  beforeEach(() => {
    decryptedSecrets.length = 0;
    decryptGate = null;
    previewAccountSecret = null;
    selectorRows.mockReset();
  });

  it("still settles and reveals the full list when effects are double-invoked (mount -> cleanup -> mount)", async () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeAccount({ id: `strict-${i}`, name: `Strict${i}` }),
    );
    const current = makeAccount({ id: "strict-current", name: "StrictCurrent" });
    previewAccountSecret = current.secret;
    store = null;
    render(
      <StrictMode>
        <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
          <StoreGrabber />
          <LegacyPrimeMigrationWizard
            open
            onClose={() => {}}
            currentPrimeAccount={current}
            allAccounts={[current, ...candidates]}
          />
        </CodexProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => {
      store!.getState().actions.authenticate(PASSWORD, 60);
    });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));

    // The stall showed up here: the panel never went away.
    await screen.findByTestId("legacy-prime-migration-account-existing-item-strict-0");
    expect(screen.queryByTestId("legacy-prime-migration-account-probe-progress")).toBeNull();

    for (const c of candidates) {
      const row = screen.getByTestId(`legacy-prime-migration-account-existing-item-${c.id}`);
      expect(within(row).queryByText("No known words")).toBeNull();
    }
    // Every account really was read (StrictMode's discarded first mount
    // may add a few duplicates — that is dev-only and bounded; what must
    // never happen again is zero completions).
    expect(new Set(decryptedSecrets).size).toBe(candidates.length);
  });
});

describe("LegacyPrimeMigrationWizard — Page 2 decrypt pass runs exactly once per account", () => {
  beforeEach(() => {
    decryptedSecrets.length = 0;
    decryptGate = null;
    previewAccountSecret = null;
    selectorRows.mockReset();
  });

  it("decrypts each of 14 candidates EXACTLY once — the pass is never restarted by its own results (owner's real codex size, the one that stalled at '0 of 14')", async () => {
    const candidates = Array.from({ length: 14 }, (_, i) =>
      makeAccount({ id: `acct-${String(i).padStart(2, "0")}`, name: `Account${i}` }),
    );
    await openAccountStepWith(candidates);

    // The body is withheld while the pass runs...
    expect(screen.getByTestId("legacy-prime-migration-account-probe-progress")).toBeTruthy();
    expect(screen.getByText(/0 of 14/)).toBeTruthy();

    // ...and then the whole list arrives, resolved.
    await screen.findByTestId("legacy-prime-migration-account-existing-item-acct-00");
    expect(screen.queryByTestId("legacy-prime-migration-account-probe-progress")).toBeNull();

    // THE invariant: 14 accounts => 14 decrypts. The stall produced far
    // more than this (one restart per committed result, each discarding
    // the three decrypts still in flight).
    expect(decryptedSecrets.length).toBe(14);
    expect(new Set(decryptedSecrets).size).toBe(14);

    // And every row is genuinely resolved, not merely rendered.
    for (const c of candidates) {
      const row = screen.getByTestId(`legacy-prime-migration-account-existing-item-${c.id}`);
      expect(within(row).queryByText("No known words")).toBeNull();
      expect(within(row).getByText("Recommended")).toBeTruthy();
    }
  });

  it("the progress counter actually ADVANCES to completion rather than resetting (it was pinned at 0 for the owner)", async () => {
    // Observed by STEPPING the pass, not by racing a wall clock. The previous
    // version sampled the counter for a fixed ~400ms budget, which made it a
    // CPU-contention coin flip: run this file alone and the pass climbs inside
    // the window; run it alongside the other 129 files and one decrypt can
    // outlast the whole budget, so the only value ever sampled is "0" and the
    // test fails over a perfectly healthy screen. Gating each decrypt removes
    // time from the assertion entirely — every reading below is forced.
    const TOTAL = 9;
    const candidates = Array.from({ length: TOTAL }, (_, i) =>
      makeAccount({ id: `prog-${i}`, name: `Prog${i}` }),
    );

    const blocked: Array<() => void> = [];
    decryptGate = () => new Promise<void>((resolve) => { blocked.push(resolve); });

    await openAccountStepWith(candidates);

    const counter = (): string => {
      const panel = screen.queryByTestId("legacy-prime-migration-account-probe-progress");
      return panel?.textContent ?? "";
    };
    const releaseOne = async (): Promise<void> => {
      const next = blocked.shift();
      expect(next, "a decrypt should have been in flight to release").toBeTypeOf("function");
      await act(async () => {
        next!();
        await Promise.resolve();
      });
    };

    // The pool fills (4-wide) and NOTHING has completed yet, so the counter
    // must read a genuine "0 of 9" — this is the owner's frozen state, which
    // is legitimate right here and only a bug if it never moves.
    await waitFor(() => expect(blocked.length).toBeGreaterThan(0));
    expect(counter()).toMatch(new RegExp(`0 of ${TOTAL}`));

    // Release decrypts one at a time; each completion must tick the counter up
    // by exactly one and must NEVER re-base the total (the restart bug did
    // both: back to 0, over a shrinking "of N").
    for (let done = 1; done < TOTAL; done++) {
      await releaseOne();
      await waitFor(() => expect(counter()).toMatch(new RegExp(`${done} of ${TOTAL}`)));
    }

    // Final release settles the pass and reveals the rows.
    await releaseOne();
    await screen.findByTestId("legacy-prime-migration-account-existing-item-prog-0");

    // Exactly-once still holds: a restart would have spent extra decrypts.
    expect(decryptedSecrets.length).toBe(TOTAL);
    expect(blocked.length).toBe(0);
  });

  it("a retry (Re-check) runs one more clean pass over the unresolved accounts — not a cascade", async () => {
    // Make every decrypt fail so nothing resolves and the retry control
    // is offered, then confirm the retry costs exactly one pass.
    const failing = Array.from({ length: 5 }, (_, i) =>
      makeAccount({ id: `retry-${i}`, name: `Retry${i}` }),
    );
    const spy = vi.spyOn(await import("@stoachain/stoa-core/crypto"), "smartDecrypt");
    spy.mockImplementation(async (secret: string) => {
      if (secret !== previewAccountSecret) decryptedSecrets.push(secret);
      await new Promise((r) => setTimeout(r, 5));
      throw new Error("nope");
    });

    await openAccountStepWith(failing);
    await screen.findByTestId("legacy-prime-migration-account-probe-unlock");
    expect(decryptedSecrets.length).toBe(5);

    spy.mockRestore();
  });
});
