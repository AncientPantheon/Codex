/**
 * useAccountChainData — hydrates codex Ouronet accounts with their LIVE
 * on-chain state, the same way My Codex does.
 *
 * The codex store only holds at-rest fields (address, codex public key,
 * stored guard). Activation status, the on-chain sovereign/governor, the
 * payment key + its guard + balance, the on-chain public key, and the
 * StoicTag are all CHAIN STATE — they're read from the immutable Pact
 * function via `getAccountSelectorDataLive`, which routes through the
 * `pactRead` seam the consumer configures at boot (OuronetUI wires its
 * cache-aware reader; a standalone consumer wires its own). The package
 * therefore REFERENCES these on-chain functions and DEPENDS on them — it
 * does not (and cannot) embed them; they live immutably on StoaChain.
 *
 * DPL-UR chain-symbol audit (2026-09-25, follow-up handoff): reads
 * `ouronet-ns.O-UI-SEVEN.URC_01|Accounts` directly via the package-LOCAL
 * `getAccountSelectorDataLive` (`../../zbom/ouroSelectorReads.js`) instead of
 * `@ouronet/ouronet-core`'s `getAccountSelectorData`, which still constructs
 * the archived `DPL-UR.URC_0027_AccountSelectorMapper` call internally as of
 * its latest published version (4.6.0, checked 2026-09-25). See that local
 * file's own doc comment for the full rationale — delete it and revert this
 * import the day `@ouronet/ouronet-core` ships an O-UI-SEVEN-compatible
 * release.
 *
 * APOLLO (₱./Π.) observational accounts are excluded from the read: the
 * selector mapper only recognises DALOS Genesis (Ѻ./Σ.) accounts, and one
 * unrecognised address fails the whole batch — which is exactly why the
 * legacy My Codex sync dropped APOLLO accounts from the list. Here they
 * simply stay un-hydrated (they have no chain state anyway).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { getAccountSelectorDataLive } from "../../zbom/ouroSelectorReads.js";
import type { AccountSelectorData } from "@ouronet/ouronet-core/interactions/ouroTypes";
import { codexClock } from "../../zbom/debouncer/codexClock.js";
import { usePostTxRefresh } from "../../zbom/toast/usePostTxRefresh.js";

const DALOS_PREFIXES = ["Ѻ.", "Σ."];
const isDalos = (addr: string) => DALOS_PREFIXES.some((p) => addr.startsWith(p));

/** The on-chain read functions this layer references (for the read-deps drawer). */
export const CODEX_CHAIN_READ_FUNCTIONS = [
  {
    name: "ouronet-ns.O-UI-SEVEN.URC_01|Accounts",
    purpose:
      "Live account state for Ouronet accounts — activation, account guard, smart/standard, payment key + guard + balance, on-chain public key, sovereign, governor, and StoicTag.",
    via: "getAccountSelectorDataLive (local — ../../zbom/ouroSelectorReads.js; interim until @ouronet/ouronet-core ships an O-UI-SEVEN-compatible release)",
  },
] as const;

export interface AccountChainData {
  /** AccountSelectorData keyed by the on-chain `ouronet-account` address. */
  byAddress: Record<string, AccountSelectorData>;
  loading: boolean;
  /** Non-null when the read failed (node unreachable / read error). */
  error: string | null;
  refresh: () => void;
}

export function useAccountChainData(addresses: string[]): AccountChainData {
  const [byAddress, setByAddress] = useState<Record<string, AccountSelectorData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-read whenever ANY Codex transaction confirms — so activation, guard,
  // payment-key, StoicTag (and everything URC_0027 carries) reflect on-chain
  // state without a manual reload.
  const txNonce = usePostTxRefresh();

  const key = addresses.filter(isDalos).sort().join("|");
  const dalos = useMemo(() => addresses.filter(isDalos), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async () => {
    if (dalos.length === 0) {
      setByAddress({});
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await codexClock.report("URC_0027", undefined, () =>
        getAccountSelectorDataLive(dalos),
      );
      const map: Record<string, AccountSelectorData> = {};
      for (const r of rows) map[r["ouronet-account"]] = r;
      setByAddress(map);
      if (rows.length === 0) {
        setError("Chain read returned no data — node unreachable or read failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chain read failed.");
    } finally {
      setLoading(false);
    }
  }, [dalos]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, txNonce]);

  return { byAddress, loading, error, refresh: () => void fetchData() };
}
