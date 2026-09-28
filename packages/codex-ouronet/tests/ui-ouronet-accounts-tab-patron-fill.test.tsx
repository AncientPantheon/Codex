/**
 * <OuronetAccountsTab> — canon rule 7 proof, the `accounts[0]`/single-account
 * edge case: with exactly ONE codex account, that account is BOTH the row's
 * own account (`self`) and the prime account (`accounts[0]`) — the
 * `resolvePatronFillValue`/`withPatron` ternary in `OuronetAccountsTab.tsx`
 * must still produce a real, defined `patron` value here, not `undefined`
 * or a crash. A genuinely empty accounts list never reaches `AccountRow`
 * at all (confirmed: `OuronetAccountsTab.tsx` only renders rows for a
 * non-empty list), so this single-account case is the real, reachable edge
 * this file's own pure-function tests (`zbom-prezbom-fill-map.test.ts`)
 * cannot exercise on their own.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/** Expand a collapsed account row by clicking its header button — mirrors
 *  ui-ouronet-accounts-tab.test.tsx's own `expandRow` helper exactly. */
function expandRow(card: HTMLElement) {
  const header = card.querySelector('[role="button"]') as HTMLElement;
  fireEvent.click(header);
}

vi.mock("../src/zbom/ouroSelectorReads.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAccountSelectorDataLive: async () => [] };
});

const capturedValues: Record<string, Array<Record<string, string> | undefined>> = {};
vi.mock("../src/zbom/cfm/PreZbomHint.js", () => ({
  default: ({ entrypoint, values, children }: { entrypoint: string | readonly string[]; values?: Record<string, string>; children: React.ReactNode }) => {
    // See ui-dual-api-panel.test.tsx's own comment on this exact line shape:
    // `Array.isArray`'s `arg is any[]` predicate can't narrow a
    // `readonly string[]` union member back to `string` in the false
    // branch, so the cast is required, not decorative.
    const key: string = Array.isArray(entrypoint) ? entrypoint.join(",") : (entrypoint as string);
    (capturedValues[key] ??= []).push(values);
    return <>{children}</>;
  },
}));

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useOuroAccounts } from "@ancientpantheon/codex-ouronet/hooks";
import { OuronetAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

const KEY = "a".repeat(64);
const ADDRESS = "Ѻ.only-account";

const ouroFx = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: over.id ?? "o1",
  name: over.name ?? "My Account",
  version: "1.0.0",
  isSmart: over.isSmart ?? false,
  address: over.address ?? ADDRESS,
  // Activated + guarded, so the expanded row's "Rotate Guard" launcher
  // (gated on `isActivated && account.guard`, OuronetAccountsTab.tsx:750)
  // actually renders — a bare, never-activated fixture never reaches a
  // `withPatron`-filled PreZbomHint at all.
  guard: over.guard ?? { pred: "keys-all", keys: [KEY] },
  isActive: over.isActive ?? true,
  stoaChainLedger: over.stoaChainLedger ?? null,
  publicKey: over.publicKey ?? KEY,
  secret: "s",
  backup: "b",
  ...over,
});

function Seeder({ accounts }: { accounts: IOuroAccount[] }) {
  const { addAccount } = useOuroAccounts();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) accounts.forEach((a) => void addAccount(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

describe("<OuronetAccountsTab> — single-account codex, accounts[0] IS the only account", () => {
  it("withPatron's patron value is defined and real (the account's own address) — never undefined, never a crash, for a single-account codex", async () => {
    Object.keys(capturedValues).forEach((k) => delete capturedValues[k]);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder accounts={[ouroFx()]} />
        <OuronetAccountsTab />
      </CodexProvider>,
    );
    const card = (await screen.findByText("CodexPrime")).closest("[data-account-id]") as HTMLElement;
    expandRow(card);

    const calls = await waitFor(() => {
      const found = capturedValues["TS01-C1.DALOS|C_RotateGuard"];
      expect(found, "C_RotateGuard was never rendered").toBeTruthy();
      return found;
    });
    const last = calls[calls.length - 1];
    expect(last?.patron).toBe(ADDRESS);
    expect(last?.executor).toBe(ADDRESS);
  });
});
