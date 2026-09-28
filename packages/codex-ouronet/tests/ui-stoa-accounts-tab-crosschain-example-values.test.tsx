/**
 * <StoaAccountsTab> — the Send launcher's cross-chain tooltip variant
 * (`coin.C_TransferAcross`/`coin.transfer-crosschain`) needs real EXAMPLE
 * values, not the registry's own generic per-TYPE ghost — a live bug
 * report: the StoaChain variant showed every slot unfilled (its own
 * `LocalStopgapCard` ignored `values` entirely, a separate bug fixed
 * alongside this one — see `zbom-prezbom-hint.test.tsx`'s own "local
 * stopgap" describe block), and the Kadena variant showed the SAME ghost
 * value for both `receiver` and `target-chain` (both `string`-typed, so the
 * registry's per-TYPE fallback can't tell them apart without a real caller
 * value).
 *
 * This file proves `AddressRow`'s own fix: `sender` is the row's own
 * address, `receiver` is a REAL second codex address (never a guess — when
 * there isn't one, `receiver` is simply omitted), `target-chain` is the
 * literal `"1"`.
 */
import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useStoaChainSeeds } from "@ancientpantheon/codex-ouronet/hooks";
import type { IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";
import { setPactReader } from "@stoachain/stoa-core/reads";

const capturedValues: Record<string, Array<Record<string, string> | undefined>> = {};
vi.mock("../src/zbom/cfm/PreZbomHint.js", () => ({
  default: ({ entrypoint, values, children }: { entrypoint: string | readonly string[]; values?: Record<string, string>; children: React.ReactNode }) => {
    const key: string = Array.isArray(entrypoint) ? entrypoint.join(",") : (entrypoint as string);
    (capturedValues[key] ??= []).push(values);
    return <>{children}</>;
  },
}));

import { StoaAccountsTab } from "../src/ui/tabs/StoaAccountsTab.js";

const { kadenaDirtyRead } = vi.hoisted(() => ({ kadenaDirtyRead: vi.fn() }));
vi.mock("@stoachain/kadena-stoic-legacy/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoachain/kadena-stoic-legacy/client")>();
  return { ...actual, createClient: () => ({ dirtyRead: kadenaDirtyRead }) };
});

beforeEach(() => {
  Object.keys(capturedValues).forEach((k) => delete capturedValues[k]);
  setPactReader(async () => ({ result: { data: [] } }) as never);
  kadenaDirtyRead.mockReset().mockResolvedValue({ result: { status: "success", data: [] } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
});

const seedFx = (over: Partial<IStoaChainSeed> = {}): IStoaChainSeed => ({
  id: over.id ?? "s1",
  name: over.name ?? "My Seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: "enc",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-25T10:00:00.000Z",
  accounts: over.accounts ?? [],
  ...over,
});

function Seeder({ seeds }: { seeds: IStoaChainSeed[] }) {
  const { addSeed } = useStoaChainSeeds();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) seeds.forEach((s) => void addSeed(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(seeds: IStoaChainSeed[], activeNetwork: "stoa" | "kadena" = "stoa") {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder seeds={seeds} />
      <StoaAccountsTab activeNetwork={activeNetwork} />
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByText(/Total Addresses/i)).toBeTruthy());
  return utils;
}

const ADDR_A = `k:${"a".repeat(64)}`;
const ADDR_B = `k:${"b".repeat(64)}`;
const TWO_ACCOUNT_SEED = [
  seedFx({
    id: "s1",
    accounts: [
      { index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" },
      { index: 1, publicKey: "b".repeat(64), derivationPath: "m/1" },
    ],
  }),
];
const ONE_ACCOUNT_SEED = [
  seedFx({ id: "s1", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] }),
];

describe("<StoaAccountsTab> — native Stoa Send launcher's cross-chain example values", () => {
  it("fills sender (this row's own address), receiver (a REAL second codex address), and target-chain (\"1\") when a second address exists", async () => {
    await renderTab(TWO_ACCOUNT_SEED, "stoa");
    const key = "coin.C_Transfer,coin.C_TransferAnew,coin.C_TransferAcross";
    const calls = await waitFor(() => {
      const found = capturedValues[key];
      expect(found, `${key} was never rendered`).toBeTruthy();
      return found!;
    });
    const forA = calls.find((v) => v?.sender === ADDR_A);
    expect(forA, "no call with sender=ADDR_A").toBeTruthy();
    expect(forA?.receiver).toBe(ADDR_B); // the OTHER address, never itself
    expect(forA?.["target-chain"]).toBe("1");
  });

  it("omits receiver entirely (never a guessed address) when this is the only address in the codex — sender and target-chain still fill", async () => {
    await renderTab(ONE_ACCOUNT_SEED, "stoa");
    const key = "coin.C_Transfer,coin.C_TransferAnew,coin.C_TransferAcross";
    const calls = await waitFor(() => {
      const found = capturedValues[key];
      expect(found, `${key} was never rendered`).toBeTruthy();
      return found!;
    });
    const last = calls[calls.length - 1];
    expect(last?.sender).toBe(ADDR_A);
    expect(last?.receiver).toBeUndefined();
    expect(last?.["target-chain"]).toBe("1");
  });
});

describe("<StoaAccountsTab> — Kadena Send launcher's cross-chain example values", () => {
  it("fills sender, a REAL second-address receiver (distinct from target-chain, unlike the registry's own reused-ghost fallback), and target-chain \"1\"", async () => {
    await renderTab(TWO_ACCOUNT_SEED, "kadena");
    const key = "coin.transfer,coin.transfer-create,coin.transfer-crosschain";
    const calls = await waitFor(() => {
      const found = capturedValues[key];
      expect(found, `${key} was never rendered`).toBeTruthy();
      return found!;
    });
    const forA = calls.find((v) => v?.sender === ADDR_A);
    expect(forA, "no call with sender=ADDR_A").toBeTruthy();
    expect(forA?.receiver).toBe(ADDR_B);
    expect(forA?.["target-chain"]).toBe("1");
    // The whole point of this fix: receiver and target-chain must be
    // DIFFERENT values, not the same ghost/example reused for both.
    expect(forA?.receiver).not.toBe(forA?.["target-chain"]);
  });
});
