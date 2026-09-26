/**
 * useKadenaBalances — live per-chain KDA balances for a set of k:/w:
 * addresses against REAL Kadena mainnet, used by the Stoa Accounts tab when
 * switched into Kadena mode (see `ChainwebPanel.tsx`'s `activeNetwork`).
 *
 * ONE read per Kadena chain (`KADENA_CHAINS`, 0-19), each batching a
 * `map`/`try` over every address — mirrors `useStoaChainBalances.ts`'s own
 * shape/hook contract (`byAddress`/`loading`/`error`/`refresh`) exactly, so
 * `StoaAccountsTab` can switch between the two with minimal branching. The
 * ONE real difference: there is no Stoa-equivalent "Read B" selector call
 * here (`getStoaAccountSelectorDataLive`'s `O-UI-SEVEN.URC_05|StoaAccounts`
 * is an Ouronet-custom module — confirmed absent from real Kadena mainnet,
 * see `kadenaReads.ts`'s own doc comment) — `selectorBalance` is always
 * `undefined` for a Kadena-mode read.
 *
 * Reads go through `kadenaReads.ts`'s `getKadenaBalancesBatch` — a raw,
 * hand-built Pact transaction against the ACTIVE Kadena node
 * (`getActiveKadenaNodeUrl()`, set by the Network tab's Kadena row — see
 * `kadenaReads.ts`'s own doc comment on why this is a module-level global
 * rather than a prop threaded through `ForeignChainsTab` → `ChainwebPanel`
 * → `StoaAccountsTab`), NEVER through `@stoachain/stoa-core`'s `pactRead`
 * (which cannot address real Kadena mainnet — its hardcoded
 * `networkId: "stoa"` would be rejected node-side).
 */

import { useCallback, useEffect, useState } from "react";
import { KADENA_CHAINS, getKadenaBalancesBatch, getActiveKadenaNodeUrl } from "../../kadena/kadenaReads.js";
import { codexClock } from "../../zbom/debouncer/codexClock.js";
import type { ChainBalance, StoaAccountBalances, StoaBalancesView } from "./useStoaChainBalances.js";

/**
 * @param enabled When false, NO chain read is issued and balances stay
 *   empty — StoaAccountsTab gates this on `activeNetwork === "kadena"`, so
 *   switching OUT of Kadena mode stops paying for these reads immediately.
 */
export function useKadenaBalances(
  addresses: string[],
  enabled = true,
): StoaBalancesView {
  const [byAddress, setByAddress] = useState<Record<string, StoaAccountBalances>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const key = [...addresses].sort().join("|");

  useEffect(() => {
    const addrs = key ? key.split("|") : [];
    if (!enabled || !addrs.length) {
      setByAddress({});
      setError(null);
      setLoading(false);
      return;
    }

    const nodeUrl = getActiveKadenaNodeUrl();
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const perChainResults = await Promise.all(
          KADENA_CHAINS.map(async (chainId: string) => {
            const rows = await codexClock.report("kadena.coin.get-balance", { chainId }, () =>
              getKadenaBalancesBatch(addrs, { nodeUrl, chainId }),
            );
            return { chainId, rows };
          }),
        );

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
            const bal = exists ? (row?.balance ?? 0) : 0;
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
            // No Kadena equivalent of the O-UI-SEVEN selector read — see this
            // file's own doc comment.
            selectorBalance: undefined,
          };
        }
        setByAddress(map);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Live Kadena read failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, enabled]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { byAddress, loading, error, refresh };
}
