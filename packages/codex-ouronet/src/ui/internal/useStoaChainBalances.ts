/**
 * useStoaChainBalances — live per-chain coin balances for a set of k:/u:/c:/w:
 * addresses, used by the Stoa Accounts tab.
 *
 * Two reads (both routed through the consumer-configured `pactRead` seam):
 *   A. `coin.get-balance` — ONE read per chain (STOA_CHAINS, 0–9), each batching
 *      a `map`/`try` over every address. Drives the per-chain grid + the row
 *      total. A non-existent account on a chain yields {balance:0, exists:false}.
 *   B. `ouronet-ns.DPL-UR.URC_0028_StoaAccountSelectorMapper` (getStoaAccountSelectorData)
 *      — one batched call over the codex addresses; its `balance` feeds the
 *      single "Stoa Balance" summary line. Optional / best-effort.
 *
 * Mirrors the `useAccountChainData` hook shape (byAddress / loading / error /
 * refresh). The package owns no reader — reads only work once the consumer has
 * called `setPactReader` at boot (the default reader is the dirty-read failover).
 */

import { useCallback, useEffect, useState } from "react";
import { pactRead } from "@stoachain/stoa-core/reads";
import { STOA_CHAINS, getPactUrl } from "@stoachain/stoa-core/constants";
import { getStoaAccountSelectorData } from "@stoachain/ouronet-core/interactions/ouroAccountFunctions";
import { codexClock } from "../../zbom/debouncer/codexClock.js";

export interface ChainBalance {
  balance: number;
  exists: boolean;
}
export interface StoaAccountBalances {
  /** chainId ("0".."9") → balance on that chain. */
  perChain: Record<string, ChainBalance>;
  total: number;
  chainsWithBalance: number;
  /** No chain reports the account exists. */
  isEmpty: boolean;
  /** URC_0028 selector balance (the protocol "Stoa Balance" figure), if read. */
  selectorBalance?: number;
}
export interface StoaBalancesView {
  byAddress: Record<string, StoaAccountBalances>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Pact decimals arrive as number | string | { decimal }. Coerce to number. */
function coerce(b: unknown): number {
  if (b == null) return 0;
  if (typeof b === "number") return b;
  if (typeof b === "string") return parseFloat(b) || 0;
  if (typeof b === "object" && b !== null && "decimal" in (b as Record<string, unknown>)) {
    return parseFloat(String((b as { decimal: unknown }).decimal)) || 0;
  }
  return 0;
}

/** Unwrap a dirty-read response to its data array (shape varies by reader). */
function rowsOf(res: unknown): Array<{ account?: string; balance?: unknown; exists?: boolean }> {
  const r = res as { result?: { data?: unknown }; data?: unknown } | unknown[];
  const data = (r as { result?: { data?: unknown } })?.result?.data
    ?? (r as { data?: unknown })?.data
    ?? r;
  return Array.isArray(data) ? (data as Array<{ account?: string; balance?: unknown; exists?: boolean }>) : [];
}

export function useStoaChainBalances(addresses: string[], selectorAddresses: string[]): StoaBalancesView {
  const [byAddress, setByAddress] = useState<Record<string, StoaAccountBalances>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const key = [...addresses].sort().join("|");
  const selKey = [...selectorAddresses].sort().join("|");

  useEffect(() => {
    const addrs = key ? key.split("|") : [];
    if (!addrs.length) { setByAddress({}); setError(null); setLoading(false); return; }
    const selAddrs = selKey ? selKey.split("|") : [];

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Read A — one batched coin.get-balance read per chain.
        const perChainResults = await Promise.all(
          STOA_CHAINS.map(async (chainId: string) => {
            const list = addrs.map((a) => `"${a}"`).join(" ");
            const code =
              `(map (lambda (a) (try { "account": a, "balance": 0.0, "exists": false } ` +
              `{ "account": a, "balance": (coin.get-balance a), "exists": true })) [${list}])`;
            const res = await codexClock.report("coin.get-balance", { chainId }, () =>
              pactRead(code, { chainId, pactUrl: getPactUrl(chainId), tier: "T5" }),
            );
            return { chainId, rows: rowsOf(res) };
          }),
        );

        // Read B — URC_0028 selector balances (best-effort).
        const selector: Record<string, number> = {};
        if (selAddrs.length) {
          try {
            const sel = await codexClock.report("URC_0028", undefined, () =>
              getStoaAccountSelectorData(selAddrs),
            );
            for (const d of sel) selector[d.account] = coerce(d.balance);
          } catch { /* selector is optional; ignore */ }
        }

        if (cancelled) return;

        const map: Record<string, StoaAccountBalances> = {};
        for (const addr of addrs) {
          const perChain: Record<string, ChainBalance> = {};
          let total = 0;
          let chainsWithBalance = 0;
          let anyExists = false;
          for (const { chainId, rows } of perChainResults) {
            const row = rows.find((x) => x.account === addr);
            const exists = row?.exists === true;
            const bal = exists ? coerce(row?.balance) : 0;
            perChain[chainId] = { balance: bal, exists };
            if (exists) anyExists = true;
            total += bal;
            if (exists && bal > 0) chainsWithBalance++;
          }
          map[addr] = {
            perChain,
            total,
            chainsWithBalance,
            isEmpty: !anyExists,
            selectorBalance: addr in selector ? selector[addr] : undefined,
          };
        }
        setByAddress(map);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Live chain read failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selKey, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { byAddress, loading, error, refresh };
}
