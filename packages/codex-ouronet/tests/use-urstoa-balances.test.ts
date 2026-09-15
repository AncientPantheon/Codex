/**
 * useUrStoaBalances — live UrStoa vault balances (balance/staked/earnings) for
 * a set of k:/u:/c:/w: addresses, ONE chain only ("0" — UrStoa is not
 * deployed across STOA_CHAINS the way native `coin` is), used to drive the
 * UrStoa view of the Stoa Accounts tab. Mirrors `useStoaChainBalances`'s
 * shape/discipline: batched `map`/`try` Pact read routed through the
 * consumer-configured `pactRead` seam, `enabled` gating so a standalone
 * Codex with nothing wired never reads "by its own power", `codexClock.report`
 * timing wrapper.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { setPactReader } from "@stoachain/stoa-core/reads";

import { useUrStoaBalances } from "../src/ui/internal/useUrStoaBalances.js";

const ADDR_A = "k:" + "a".repeat(64);
const ADDR_B = "k:" + "b".repeat(64);

describe("useUrStoaBalances", () => {
  beforeEach(() => {
    setPactReader(async () => ({ result: { data: [] } }) as never);
  });

  it("batches every address into a single Pact read (one call, not one per address)", async () => {
    let calls = 0;
    let receivedCode = "";
    setPactReader(async (code: string) => {
      calls++;
      receivedCode = code;
      return { result: { data: [] } } as never;
    });

    const { result } = renderHook(() => useUrStoaBalances([ADDR_A, ADDR_B]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toBe(1);
    // Batches both addresses into one `map`/`try` expression over a literal list.
    expect(receivedCode).toContain(`"${ADDR_A}"`);
    expect(receivedCode).toContain(`"${ADDR_B}"`);
    expect(receivedCode).toContain("map");
  });

  it("maps balance/staked/earnings/exists per address from the batched read result", async () => {
    setPactReader(async () => ({
      result: {
        data: [
          { account: ADDR_A, balance: 12.5, staked: 3, earnings: { decimal: "0.75" }, exists: true },
          { account: ADDR_B, balance: 0, staked: 0, earnings: 0, exists: false },
        ],
      },
    }) as never);

    const { result } = renderHook(() => useUrStoaBalances([ADDR_A, ADDR_B]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.byAddress[ADDR_A]).toEqual({
      balance: 12.5,
      staked: 3,
      earnings: 0.75,
      exists: true,
    });
    expect(result.current.byAddress[ADDR_B]).toEqual({
      balance: 0,
      staked: 0,
      earnings: 0,
      exists: false,
    });
  });

  it("issues no read and stays empty when enabled=false — a standalone Codex must not read by its own power", async () => {
    let calls = 0;
    setPactReader(async () => {
      calls++;
      return { result: { data: [] } } as never;
    });

    const { result } = renderHook(() => useUrStoaBalances([ADDR_A], false));
    // Give any accidental async effect a tick to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.byAddress).toEqual({});
  });

  it("refresh() forces a new read of the same addresses", async () => {
    let calls = 0;
    setPactReader(async () => {
      calls++;
      return { result: { data: [] } } as never;
    });

    const { result } = renderHook(() => useUrStoaBalances([ADDR_A]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls).toBe(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(calls).toBe(2));
  });
});
