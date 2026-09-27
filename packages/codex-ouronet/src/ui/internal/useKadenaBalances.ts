/**
 * useKadenaBalances — live per-chain KDA balances for a set of k:/w:
 * addresses against REAL Kadena mainnet, used by the Stoa Accounts tab when
 * switched into Kadena mode (see `ChainwebPanel.tsx`'s `activeNetwork`).
 *
 * Reads go through `kadenaBalanceSource.ts`'s pluggable seam
 * (`getActiveKadenaBalanceSource()`), NOT a hand-built fetch here — mirrors
 * `useStoaChainBalances.ts`'s own shape/hook contract (`byAddress`/`loading`/
 * `error`/`refresh`) exactly, so `StoaAccountsTab` can switch between the two
 * with minimal branching. The ONE real difference: there is no Stoa-equivalent
 * "Read B" selector call here (`getStoaAccountSelectorDataLive`'s
 * `O-UI-SEVEN.URC_05|StoaAccounts` is an Ouronet-custom module — confirmed
 * absent from real Kadena mainnet) — `selectorBalance` is always `undefined`
 * for a Kadena-mode read.
 *
 * 2026-09-27: this hook used to call `kadenaReads.ts`'s `getKadenaBalancesBatch`
 * directly, one read per chain. That is now `pactKadenaBalanceSource` — still
 * correct, still available, just no longer hardwired here. The DEFAULT source
 * is `restKadenaBalanceSource` (see `kadenaBalanceSource.ts`'s own doc comment
 * for the full diagnosis of why: `api.chainweb.com` does not exist, there is no
 * free public Kadena Pact API, and the direct node hairpin-NATs from its own
 * LAN). Swapping the active source (`setActiveKadenaBalanceSource`) changes
 * every read through this hook with no change needed here.
 */

import { useCallback, useEffect, useState } from "react";
import { getActiveKadenaBalanceSource } from "../../kadena/kadenaBalanceSource.js";
import { KADENA_CHAINS } from "../../kadena/kadenaReads.js";
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

    const source = getActiveKadenaBalanceSource();
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const perAddress = await codexClock.report(`kadena.balances.${source.name}`, undefined, () =>
          source.fetchBalances(addrs),
        );

        if (cancelled) return;

        const map: Record<string, StoaAccountBalances> = {};
        for (const addr of addrs) {
          const sourcePerChain = perAddress[addr] ?? {};
          const perChain: Record<string, ChainBalance> = {};
          let total = 0;
          let chainsWithBalance = 0;
          let anyExists = false;
          // Always cover every KADENA_CHAINS entry, even one the active source returned
          // no data for — a chain absent from the source's map means "exists:false", the
          // same answer it always meant, not "unknown" or a missing grid cell.
          for (const chainId of KADENA_CHAINS) {
            const entry = sourcePerChain[chainId];
            const exists = entry?.exists === true;
            const balance = exists ? (entry?.balance ?? 0) : 0;
            perChain[chainId] = { balance, exists };
            if (exists) anyExists = true;
            total += balance;
            if (exists && balance > 0) chainsWithBalance++;
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
