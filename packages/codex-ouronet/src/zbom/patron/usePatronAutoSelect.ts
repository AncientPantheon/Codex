/**
 * usePatronAutoSelect — package port of OuronetUI's `usePatronAutoSelect.ts`.
 * Selects the IGNIS-paying patron based on `uiSettings.patronSelectionMode`,
 * with fallback to the wealthiest codex-satisfiable account when the preferred
 * patron can't cover the cost.
 *
 * Selection logic (identical to My Codex):
 *   1. Try the setting (Codex Prime / Resident / Wealthiest).
 *   2. If the selected patron has insufficient IGNIS → fall back to Wealthiest.
 *   3. If Wealthiest is also insufficient → stay on current + noViablePatron.
 *   4. If all candidates have 0 IGNIS → Wealthiest resolves to Codex Prime.
 *
 * `ignisCost` is watched via `checkFallback` (called externally once the cost
 * is known) to avoid a circular dep when the caller derives the cost from INFO
 * data that itself depends on the patron address.
 *
 * Differences from OuronetUI:
 *   - State comes from the package Zustand store (`useCodex` / `useActiveWallet`)
 *     instead of the Redux `useWallet()` context.
 *   - `primeAccount` resolves via the explicit `isPrime` flag (the package's
 *     causal CodexPrime model), falling back to positional `accounts[0]` for
 *     legacy codices that predate the flag.
 *   - `codexPubs` is built as `buildCodexPubSet(seeds, [], pureKeypairs)` —
 *     the package models accounts only as nested `seeds[].accounts[]` (no flat
 *     `stoaChainAccounts` mirror), matching `InternalCodexResolver.listCodexPubs`.
 *   - `getIgnisBalance` is injectable via options purely for unit-testability;
 *     production callers omit it and get the real chain read.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { getIgnisBalance as defaultGetIgnisBalance } from "../debouncer/monitoredReads.js";
import { analyzeGuard, buildCodexPubSet } from "@stoachain/stoa-core/guard";
import { useCodex } from "../../hooks/index.js";
import { useActiveWallet } from "../../hooks/index.js";
import type { IOuroAccount, PatronSelectionMode } from "../../types/entities.js";

export type PatronMode = "prime" | "resident" | "custom";

const LABELS: Record<PatronSelectionMode, string> = {
  wealthiest: "Wealthiest Patron",
  prime: "Codex Prime",
  resident: "Resident Account",
};

export interface PatronAutoSelectOptions {
  /** Test seam — defaults to the real `getIgnisBalance`. Production omits it. */
  getIgnisBalance?: (address: string) => Promise<string | null>;
}

export interface PatronAutoSelectResult {
  patronMode: PatronMode;
  setPatronMode: (m: PatronMode) => void;
  patronAccount: IOuroAccount | null;
  selectedCustomAccount: IOuroAccount | null;
  setSelectedCustomAccount: (a: IOuroAccount | null) => void;
  patronIgnisBalance: number | null;
  isReady: boolean;
  patronLabel: string;
  noViablePatron: boolean;
  /** Call once `ignisCost` is known — runs the fallback check without
   *  re-running the initial selection. */
  checkFallback: (ignisCost: number) => void;
  /** Always `false`; surfaced so consumers forward the canonical
   *  `autoSelectBestPatron` prop to the selector. This hook performs its own
   *  wealthiest selection (with fallback + user-override tracking); enabling
   *  the selector's inner auto-select would race with that. */
  autoSelectBestPatron: false;
}

export function usePatronAutoSelect(
  options: PatronAutoSelectOptions = {},
): PatronAutoSelectResult {
  const getIgnisBalance = options.getIgnisBalance ?? defaultGetIgnisBalance;

  const { ouroAccounts, kadenaSeeds, pureKeypairs, uiSettings } = useCodex();
  const { activeOuroAccount } = useActiveWallet();
  const selectionMode = (uiSettings?.patronSelectionMode ??
    "wealthiest") as PatronSelectionMode;

  const accounts: IOuroAccount[] = ouroAccounts ?? [];
  const primeAccount = useMemo<IOuroAccount | null>(
    () => accounts.find((a) => a.isPrime) ?? accounts[0] ?? null,
    [accounts],
  );
  const residentAccount = activeOuroAccount ?? null;

  const [patronMode, setPatronMode] = useState<PatronMode>("prime");
  const [selectedCustomAccount, setSelectedCustomAccount] =
    useState<IOuroAccount | null>(null);
  const [patronIgnisBalance, setPatronIgnisBalance] = useState<number | null>(
    null,
  );
  const [isReady, setIsReady] = useState(false);
  const [patronLabel, setPatronLabel] = useState(
    LABELS[selectionMode] || "Wealthiest Patron",
  );
  const [noViablePatron, setNoViablePatron] = useState(false);

  // Store wealthiest account for fallback.
  const wealthiestRef = useRef<{ account: IOuroAccount; ignis: number } | null>(
    null,
  );
  const balanceMapRef = useRef<Map<string, number>>(new Map());

  // Track user manual overrides — prevents fallback from overriding the choice.
  const userOverrideRef = useRef(false);

  const setPatronModeWithOverride = useCallback((m: PatronMode) => {
    userOverrideRef.current = true;
    setPatronMode(m);
  }, []);

  // Reset override flag when the selection-mode setting changes.
  useEffect(() => {
    userOverrideRef.current = false;
  }, [selectionMode]);

  const patronAccount = useMemo<IOuroAccount | null>(() => {
    if (patronMode === "prime") return primeAccount;
    if (patronMode === "resident") return residentAccount;
    return selectedCustomAccount ?? primeAccount;
  }, [patronMode, selectedCustomAccount, primeAccount, residentAccount]);

  const selectPatron = useCallback(
    (acc: IOuroAccount, label: string) => {
      if (acc.address === primeAccount?.address) setPatronMode("prime");
      else if (acc.address === residentAccount?.address)
        setPatronMode("resident");
      else {
        setSelectedCustomAccount(acc);
        setPatronMode("custom");
      }
      setPatronLabel(label);
    },
    [primeAccount?.address, residentAccount?.address],
  );

  // ── Main selection (runs on setting change, NOT on ignisCost) ─────────────
  useEffect(() => {
    if (!primeAccount || accounts.length === 0) return;

    let aborted = false;
    void (async () => {
      try {
        const codexPubs = buildCodexPubSet(kadenaSeeds, [], pureKeypairs);
        const eligible = accounts.filter(
          (a) => !a.isSmart && a.isActive !== false,
        );

        // Fetch all balances.
        const bMap = new Map<string, number>();
        await Promise.allSettled(
          eligible.map(async (acc) => {
            try {
              const bal = await getIgnisBalance(acc.address);
              bMap.set(acc.address, bal ? parseFloat(bal) : 0);
            } catch {
              bMap.set(acc.address, 0);
            }
          }),
        );
        if (aborted) return;
        balanceMapRef.current = bMap;

        // Find wealthiest with keys in codex.
        const sorted = [...eligible]
          .map((acc) => ({ acc, ignis: bMap.get(acc.address) ?? 0 }))
          .sort((a, b) => b.ignis - a.ignis);

        let wealthiest: IOuroAccount | null = null;
        for (const entry of sorted) {
          const guard = entry.acc.guard;
          if (!guard) continue;
          if (analyzeGuard(guard, codexPubs).satisfied) {
            wealthiest = entry.acc;
            break;
          }
        }
        if (!wealthiest) wealthiest = primeAccount;
        wealthiestRef.current = {
          account: wealthiest,
          ignis: bMap.get(wealthiest.address) ?? 0,
        };

        // Select based on the setting.
        if (selectionMode === "wealthiest") {
          selectPatron(wealthiest, LABELS.wealthiest);
        } else if (selectionMode === "prime") {
          selectPatron(primeAccount, LABELS.prime);
        } else {
          selectPatron(residentAccount ?? primeAccount, LABELS.resident);
        }
        setNoViablePatron(false);
        setIsReady(true);
      } catch {
        setPatronMode("prime");
        setPatronLabel(LABELS[selectionMode]);
        setIsReady(true);
      }
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMode, primeAccount?.address, accounts.length, selectPatron]);

  // ── Fallback check (called externally when ignisCost is known) ────────────
  const checkFallback = useCallback(
    (ignisCost: number) => {
      if (userOverrideRef.current) return; // User chose manually — don't override.
      if (ignisCost <= 0 || !patronAccount) return;
      const currentBalance =
        balanceMapRef.current.get(patronAccount.address) ??
        patronIgnisBalance ??
        0;

      if (currentBalance >= ignisCost) {
        setNoViablePatron(false);
        return;
      }

      // Current patron insufficient → try wealthiest.
      const w = wealthiestRef.current;
      if (
        w &&
        w.ignis >= ignisCost &&
        w.account.address !== patronAccount.address
      ) {
        selectPatron(w.account, `${LABELS[selectionMode]} → ${LABELS.wealthiest}`);
        setNoViablePatron(false);
        return;
      }

      // Wealthiest also insufficient → stay on current but mark red.
      setNoViablePatron(true);
    },
    [patronAccount, patronIgnisBalance, selectionMode, selectPatron],
  );

  // Fetch the selected patron's IGNIS balance.
  useEffect(() => {
    if (!patronAccount?.address) {
      setPatronIgnisBalance(null);
      return;
    }
    let aborted = false;
    getIgnisBalance(patronAccount.address)
      .then((b) => {
        if (!aborted) setPatronIgnisBalance(b ? parseFloat(b) : null);
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patronAccount?.address]);

  return {
    patronMode,
    setPatronMode: setPatronModeWithOverride,
    patronAccount,
    selectedCustomAccount,
    setSelectedCustomAccount,
    patronIgnisBalance,
    isReady,
    patronLabel,
    noViablePatron,
    checkFallback,
    autoSelectBestPatron: false,
  };
}
