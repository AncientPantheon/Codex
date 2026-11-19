/**
 * Resume, driven through the real wizard: a recorded run re-opens where it
 * was, with the choices visibly selected and labelled as resumed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";

vi.mock("@stoachain/stoa-core/crypto", async (o) => ({
  ...(await o<Record<string, unknown>>()),
  smartDecrypt: async () => "river stone ember",
}));
const selectorRows = vi.fn<() => Promise<AccountSelectorData[]>>(async () => []);
vi.mock("../src/zbom/ouroSelectorReads.js", async (o) => ({
  ...(await o<Record<string, unknown>>()),
  getAccountSelectorDataLive: () => selectorRows(),
}));

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import type { IOuroAccount, IStoaChainSeed } from "../src/types/entities.js";
import type { MigrationProgress } from "@ancientpantheon/codex-core";

const account = (o: Partial<IOuroAccount> & { id: string }): IOuroAccount => ({
  version: "1.0", isSmart: false, address: `Ѻ.${o.id}`, guard: null,
  stoaChainLedger: null, publicKey: "pub", secret: `ct-${o.id}`,
  backup: "ct", originSeedTab: "write-seed", ...o,
});

const seeds: IStoaChainSeed[] = [{
  id: "seed-1", name: "Initial Seed", seedType: "koala", version: "1.0.0", index: 0,
  secret: "ct", main: "", createdAt: "2026-10-29T09:00:00.000Z", isPrime: true,
  accounts: [{ index: 0, publicKey: "9".repeat(64), derivationPath: "m/0" }],
}];

let store: ReturnType<typeof useCodexStore> | null = null;
function Grab() { store = useCodexStore(); return null; }

async function openWith(row: MigrationProgress | undefined, accounts: IOuroAccount[]) {
  const adapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({
    ...emptySnapshot("dev"), schemaVersion: 1,
    ouroAccounts: accounts, kadenaSeeds: seeds,
    migrationProgress: row,
  });
  store = null;
  render(
    <CodexProvider adapter={adapter}>
      <Grab />
      <LegacyPrimeMigrationWizard
        open onClose={() => {}}
        currentPrimeAccount={accounts[0] ?? null}
        allAccounts={accounts}
        allSeeds={seeds}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  return adapter;
}

const recorded = (over: Partial<MigrationProgress> = {}): MigrationProgress => ({
  stage: "selection",
  startedAt: "2026-10-29T09:00:00.000Z",
  updatedAt: "2026-10-29T09:05:00.000Z",
  selection: {
    account: { kind: "keep-current" },
    payment: { kind: "stoic-dalos-position-0" },
    guard: { kind: "recommended-single-key" },
  },
  ...over,
});

beforeEach(() => { selectorRows.mockReset(); });

describe("resuming a recorded run", () => {
  it("re-opens directly on step 3, not back at the intro", async () => {
    await openWith(recorded(), [account({ id: "a1", name: "AncientHodler" })]);
    expect(await screen.findByTestId("legacy-prime-migration-payment-section")).toBeTruthy();
  });

  it("shows BOTH choices already selected — 'showing the user what he chose'", async () => {
    // Payment and guard are separate pages (owner correction, this
    // session) — resume lands on payment first; its choice shows
    // immediately, and continuing to guard shows that choice too.
    await openWith(recorded(), [account({ id: "a1" })]);
    await screen.findByTestId("legacy-prime-migration-payment-section");
    expect(
      screen.getByTestId("legacy-prime-migration-payment-option-derive").getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    await screen.findByTestId("legacy-prime-migration-guard-section");
    expect(
      screen.getByTestId("legacy-prime-migration-guard-option-recommended").getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("says it is a RESUMED run, and when it started", async () => {
    await openWith(recorded(), [account({ id: "a1" })]);
    const banner = await screen.findByTestId("legacy-prime-migration-resume-banner");
    expect(banner.textContent).toMatch(/Resumed/);
    expect(banner.textContent).toMatch(/2026-10-29/);
  });

  it("Continue is immediately available — the decisions survived", async () => {
    await openWith(recorded(), [account({ id: "a1" })]);
    await screen.findByTestId("legacy-prime-migration-payment-section");
    await waitFor(() => {
      expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
        .toBe(false);
    });
  });
});

describe("a stale recorded choice", () => {
  it("re-opens on the ACCOUNT step and reports what has to be re-made", async () => {
    const row = recorded({
      selection: {
        account: { kind: "existing", accountId: "deleted-99" },
        payment: { kind: "stoic-dalos-position-0" },
        guard: { kind: "recommended-single-key" },
      },
    });
    await openWith(row, [account({ id: "a1" })]);

    expect(await screen.findByTestId("legacy-prime-migration-account")).toBeTruthy();
    const notice = await screen.findByTestId("legacy-prime-migration-resume-notice");
    expect(notice.textContent).toMatch(/no longer in this codex/i);
  });

  it("blocks Continue until the demoted decision is re-made", async () => {
    const row = recorded({
      selection: {
        account: { kind: "existing", accountId: "gone" },
        payment: { kind: "stoic-dalos-position-0" },
        guard: { kind: "recommended-single-key" },
      },
    });
    await openWith(row, [account({ id: "a1" })]);
    await screen.findByTestId("legacy-prime-migration-account");
    expect((screen.getByTestId("legacy-prime-migration-continue") as HTMLButtonElement).disabled)
      .toBe(true);
  });
});

describe("a new-words run cannot be resumed", () => {
  it("explains that the words were never saved, and does not pretend to restore", async () => {
    const row = recorded({
      selection: { account: { kind: "new-words" }, payment: { kind: "keep" }, guard: { kind: "keep" } },
    });
    await openWith(row, [account({ id: "a1" })]);
    const notice = await screen.findByTestId("legacy-prime-migration-resume-notice");
    expect(notice.textContent).toMatch(/never saved to your codex/i);
    // and it did NOT jump to step 3 on a selection it cannot honour
    expect(screen.queryByTestId("legacy-prime-migration-payment-section")).toBeNull();
  });
});

describe("start over", () => {
  it("clears the recorded row so the wizard stops offering to resume", async () => {
    const adapter = await openWith(recorded(), [account({ id: "a1" })]);
    await screen.findByTestId("legacy-prime-migration-resume-banner");

    fireEvent.click(screen.getByTestId("legacy-prime-migration-resume-startover"));

    await waitFor(() => {
      expect(store!.getState().migrationProgress).toBeUndefined();
    });
    expect((await adapter.loadAll()).migrationProgress ?? undefined).toBeUndefined();
    expect(screen.queryByTestId("legacy-prime-migration-resume-banner")).toBeNull();
  });
});

describe("a codex with no recorded run", () => {
  it("opens normally at the intro, with no banner", async () => {
    await openWith(undefined, [account({ id: "a1" })]);
    expect(await screen.findByTestId("legacy-prime-migration-intro")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-resume-banner")).toBeNull();
  });
});
