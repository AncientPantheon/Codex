/**
 * useUrStoaBalances — live UrStoa vault balances for a set of k:/u:/c:/w:
 * addresses, used by the Stoa Accounts tab's UrStoa view.
 *
 * ONE batched read on ONE chain, chain "0" — UrStoa is not deployed across
 * `STOA_CHAINS` the way native `coin` is (confirmed via OuronetUI's
 * `KADENA_CHAIN_ID` constant, hardcoded everywhere UrStoa is read/written).
 * The `map`/`try` expression batches every address into a single `pactRead`
 * call and returns three numeric fields per address (balance/staked/
 * earnings) plus `exists`.
 *
 * Mirrors `useStoaChainBalances`'s hook shape (byAddress / loading / error /
 * refresh), `enabled` gating rationale, and `codexClock.report` wrapping. The
 * package owns no reader — reads only work once the consumer has called
 * `setPactReader` at boot (the default reader is the dirty-read failover).
 */

import { useCallback, useEffect, useState } from "react";
import { pactRead } from "@stoachain/stoa-core/reads";
import { getPactUrl } from "@stoachain/stoa-core/constants";
import { codexClock } from "../../zbom/debouncer/codexClock.js";

const URSTOA_CHAIN_ID = "0";

export interface UrStoaAccountBalances {
  balance: number;
  staked: number;
  earnings: number;
  exists: boolean;
}
export interface UrStoaBalancesView {
  byAddress: Record<string, UrStoaAccountBalances>;
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
function rowsOf(
  res: unknown,
): Array<{ account?: string; balance?: unknown; staked?: unknown; earnings?: unknown; exists?: boolean }> {
  const r = res as { result?: { data?: unknown }; data?: unknown } | unknown[];
  const data = (r as { result?: { data?: unknown } })?.result?.data
    ?? (r as { data?: unknown })?.data
    ?? r;
  return Array.isArray(data)
    ? (data as Array<{ account?: string; balance?: unknown; staked?: unknown; earnings?: unknown; exists?: boolean }>)
    : [];
}

/**
 * @param enabled When false, NO chain read is issued and balances stay empty.
 *   Consumers gate this on whether a StoaChain connection is actually wired (a
 *   node URL / covering Pythia) — a standalone Codex with nothing connected must
 *   NOT read chain data "by its own power" (it would otherwise fall through to
 *   stoa-core's default node). Defaults true so existing callers are unchanged.
 */
export function useUrStoaBalances(addresses: string[], enabled = true): UrStoaBalancesView {
  const [byAddress, setByAddress] = useState<Record<string, UrStoaAccountBalances>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const key = [...addresses].sort().join("|");

  useEffect(() => {
    const addrs = key ? key.split("|") : [];
    if (!enabled || !addrs.length) { setByAddress({}); setError(null); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const list = addrs.map((a) => `"${a}"`).join(" ");
        const code =
          `(map (lambda (a) (try { "account": a, "balance": 0.0, "staked": 0.0, "earnings": 0.0, "exists": false } ` +
          `{ "account": a, "balance": (coin.UR_UR|Balance a), "staked": (coin.UR_URV|UserSupply a), ` +
          `"earnings": (coin.URC_URV|ClaimableRewards a), "exists": true })) [${list}])`;
        const res = await codexClock.report("urStoa.balances", { chainId: URSTOA_CHAIN_ID }, () =>
          pactRead(code, { chainId: URSTOA_CHAIN_ID, pactUrl: getPactUrl(URSTOA_CHAIN_ID), tier: "T5" }),
        );

        if (cancelled) return;

        const rows = rowsOf(res);
        const map: Record<string, UrStoaAccountBalances> = {};
        for (const addr of addrs) {
          const row = rows.find((x) => x.account === addr);
          const exists = row?.exists === true;
          map[addr] = {
            balance: exists ? coerce(row?.balance) : 0,
            staked: exists ? coerce(row?.staked) : 0,
            earnings: exists ? coerce(row?.earnings) : 0,
            exists,
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
  }, [key, tick, enabled]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { byAddress, loading, error, refresh };
}
