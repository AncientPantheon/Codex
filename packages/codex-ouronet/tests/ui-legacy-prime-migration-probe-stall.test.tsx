/**
 * The probe must SETTLE — on every path, including the paths with no work
 * to do and the paths where the work never comes back.
 *
 * `docs/work/honest-failure-reporting/design.md` §1, acceptance criteria
 * 1 and 2. The owner lost the most time to this one: *"Reading your
 * Ouronet accounts…"* with no counter, forever, no CPU, no error, no
 * retry.
 *
 * Mechanism, reproduced below rather than described: Page 2's probe effect
 * claimed the pass (`startedPassRef.current = passKey`) and then
 * early-returned on `pending.length === 0` WITHOUT returning a cleanup, so
 * the claim was never released and nothing recorded that the pass had
 * finished. Under `<StrictMode>` — which `apps/codex-playground/src/
 * main.tsx` wraps the real app in, and which Testing Library does not —
 * React runs every effect as mount -> cleanup -> mount again. On the second
 * mount the sibling re-arm effect (`resetFailedProbes`, keyed on
 * `passwordEpoch`/`probeRunKey`) pushed `probePhase` back to `"pending"`,
 * the probe effect saw its own stale claim and declined, and the phase
 * stayed `"pending"` for the rest of the session. The progress panel is an
 * EARLY RETURN, so the whole step — every option, every diagnostic, the
 * inline unlock prompt — was unreachable behind it.
 *
 * `pending.length === 0` is ordinary, not exotic:
 * `computeExistingAccountCandidates` excludes the current prime account,
 * every Smart account and every APOLLO account, so a codex whose only
 * Standard DALOS account IS its prime yields zero candidates. That is the
 * FIRST test here.
 *
 * NO `vi.mock` ANYWHERE IN THIS FILE, deliberately — this suite drives
 * mainnet-facing code. Everything this file needs to control is INJECTED
 * through real props the component already (or now) declares:
 *   - `probeDecrypt` — the probe's decrypt seam, defaulting to the real
 *     `smartDecrypt`. Lets a test hand over a decrypt that never resolves
 *     (the stall the watchdog exists for) or one that rejects.
 *   - `probeWatchdogMs` — the watchdog's own wall clock, so the terminal
 *     state can be observed in milliseconds instead of the production
 *     default's tens of seconds.
 * Non-DALOS-prefixed addresses keep `useAccountChainData` from firing at
 * all (its own `Ѻ.`/`Σ.` filter), so no chain read is reached and nothing
 * about the network needs stubbing either.
 */

import { StrictMode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { WrongPasswordError } from "@stoachain/stoa-core/crypto";

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import type { IOuroAccount } from "../src/types/entities.js";

const PASSWORD = "probe-stall-test-pw";

/** Addresses here are deliberately NOT `Ѻ.`/`Σ.`-prefixed: `useAccountChainData`
 *  filters to DALOS prefixes, so this keeps the live URC_01 chain read (and its
 *  hanging jsdom network call) out of the picture without mocking the read. */
function makeAccount(overrides: Partial<IOuroAccount> & { id: string }): IOuroAccount {
  return {
    version: "1.0",
    isSmart: false,
    address: `local-${overrides.id}-address`,
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

/** Mounts the wizard, authenticates, and navigates to Page 2 — the same
 *  three steps `ui-legacy-prime-migration-probe-pass.test.tsx` uses, minus
 *  its module mocks. `strict` renders the tree inside `<StrictMode>`, which
 *  is what the real playground app does. */
async function openAccountStep(args: {
  current: IOuroAccount;
  candidates?: readonly IOuroAccount[];
  strict?: boolean;
  probeDecrypt?: (secret: string, password: string) => Promise<string>;
  probeWatchdogMs?: number;
}): Promise<void> {
  const { current, candidates = [], strict = false } = args;
  store = null;
  const tree = (
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <StoreGrabber />
      <LegacyPrimeMigrationWizard
        open
        onClose={() => {}}
        currentPrimeAccount={current}
        allAccounts={[current, ...candidates]}
        probeDecrypt={args.probeDecrypt}
        probeWatchdogMs={args.probeWatchdogMs}
      />
    </CodexProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  act(() => {
    store!.getState().actions.authenticate(PASSWORD, 60);
  });
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
}

const progressPanel = () => screen.queryByTestId("legacy-prime-migration-account-probe-progress");

describe("LegacyPrimeMigrationWizard — Page 2 probe settles on every path", () => {
  beforeEach(() => {
    store = null;
  });

  it("settles with ZERO candidate accounts under a <StrictMode> double-mount (the owner's permanent 'Reading your Ouronet accounts…')", async () => {
    // The only Standard DALOS account in this codex IS the prime, so
    // `computeExistingAccountCandidates` returns [] and the probe has
    // nothing to decrypt. Nothing to do must still mean a definite answer.
    const current = makeAccount({ id: "only", name: "OnlyAccount" });
    await openAccountStep({ current, strict: true });

    // Page 2's real body — option 1 lives BELOW the progress panel's early
    // return, so reaching it at all is the terminal state.
    await screen.findByTestId("legacy-prime-migration-account-option-keep");
    expect(progressPanel()).toBeNull();
    // Option 2 is correctly absent (no candidates) — this is the ordinary
    // codex shape that triggered the stall, not a degraded render.
    expect(screen.queryByTestId("legacy-prime-migration-account-option-existing")).toBeNull();
  });

  it("a probe whose decrypts NEVER come back still reaches a terminal state, naming how many accounts could not be read", async () => {
    // The second way this screen can hang, and the one no claim-release
    // can fix: the pass starts, the work is real, and it simply never
    // finishes (a decrypt that neither resolves nor rejects — a wedged
    // WebCrypto call, a suspended worker, a page the OS froze mid-PBKDF2).
    // The old code had no wall clock at all, so the panel owned the screen
    // for the rest of the session. A watchdog must end it with a statement.
    const current = makeAccount({ id: "wd-current", name: "WatchdogCurrent" });
    const candidates = [
      makeAccount({ id: "wd-a", name: "WedgedA" }),
      makeAccount({ id: "wd-b", name: "WedgedB" }),
    ];
    await openAccountStep({
      current,
      candidates,
      probeWatchdogMs: 150,
      // Never settles, in either direction.
      probeDecrypt: () => new Promise<string>(() => {}),
    });

    const stalled = await screen.findByTestId("legacy-prime-migration-account-probe-stalled");
    expect(stalled.textContent).toMatch(/could not read 2 accounts/i);
    // Terminal means terminal: the spinner is gone and the step's own body
    // (every option, the re-check control, each row's reason) is reachable.
    expect(progressPanel()).toBeNull();
    expect(screen.getByTestId("legacy-prime-migration-account-option-keep")).toBeTruthy();

    // And each unread account says so on its own row, rather than being
    // labelled "No known words" with no reason — the wrong claim, since
    // nothing was ever learned about these two.
    for (const c of candidates) {
      const row = screen.getByTestId(`legacy-prime-migration-account-existing-item-${c.id}`);
      // `textContent`, not `getByText`: the reason rides inside the same
      // "No known words" span as a nested suffix (this file's own established
      // row shape), so a text query matches both the span and its child.
      expect(row.textContent).toMatch(/timed out/i);
    }
  });

  it("shows a failed account's classified reason WHILE the pass is still running, not only after it ends", async () => {
    // `probeErrors`, the inline unlock prompt and `classifyDecryptError`'s
    // whole taxonomy were rendered BELOW the progress panel's early
    // return, i.e. unreachable for exactly as long as the probe was the
    // only thing on screen. A 14-account pass where account 1 fails told
    // the owner nothing until (and unless) the last one came back.
    const current = makeAccount({ id: "mid-current", name: "MidCurrent" });
    const failing = makeAccount({ id: "mid-bad", name: "BadPasswordAccount" });
    const hanging = makeAccount({ id: "mid-slow", name: "SlowAccount" });
    await openAccountStep({
      current,
      candidates: [failing, hanging],
      // Far beyond this assertion's horizon: the point here is what the
      // panel says while it is legitimately still working, not the
      // watchdog's terminal state (asserted above).
      probeWatchdogMs: 30_000,
      probeDecrypt: async (secret: string) => {
        if (secret === failing.secret) throw new WrongPasswordError("auth tag failure");
        return new Promise<string>(() => {});
      },
    });

    // The panel is still up — one of the two decrypts has not come back —
    // and the one that failed is already explained, on it, by name.
    await waitFor(() => {
      const panel = progressPanel();
      expect(panel, "the pass must still be running for this assertion to mean anything").not.toBeNull();
      expect(panel!.textContent).toMatch(/BadPasswordAccount/);
      expect(panel!.textContent).toMatch(/wrong password/i);
    });
  });
});
