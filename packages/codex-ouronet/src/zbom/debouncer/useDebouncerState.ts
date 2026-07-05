/**
 * useDebouncerState — cloned from OuronetUI `src/hooks/useDebouncerState.ts`.
 *
 * Data-seam swap (T2): reads from the package's `tierClock` visual shim instead
 * of OuronetUI's `pactQueryCache`. Same TierState shape so the cloned
 * ZbomDebouncer consumes it verbatim. Package consumers only need the visual
 * bar; actual cost reads run through `useZbomInfoRead`'s own debouncer.
 */

import { useState, useEffect, useCallback } from "react";
import { tierClock } from "./tierClock.js";
import {
  PactQueryTier,
  ALL_TIERS,
  getTierInterval,
  getTierName,
} from "./pactQueryTiers.js";

export interface TierState {
  tier: PactQueryTier;
  name: string;
  activeCount: number;
  nextRefreshIn: number; // seconds — shared across ALL queries in this tier
  isFetching: boolean;
  isActive: boolean;
  totalQueries: number;
}

export interface DebouncerState {
  tiers: TierState[];
  totalActiveQueries: number;
  totalFetching: number;
  lastUpdated: number;
}

export function useDebouncerState(updateInterval = 200): DebouncerState {
  const [state, setState] = useState<DebouncerState>({
    tiers: ALL_TIERS.map((tier) => ({
      tier,
      name: getTierName(tier),
      activeCount: 0,
      nextRefreshIn: getTierInterval(tier),
      isFetching: false,
      isActive: false,
      totalQueries: 0,
    })),
    totalActiveQueries: 0,
    totalFetching: 0,
    lastUpdated: Date.now(),
  });

  const updateState = useCallback(() => {
    let totalActive = 0;
    let totalFetching = 0;

    const tiers: TierState[] = ALL_TIERS.map((tier) => {
      const tierState = tierClock.getTierState(tier);

      totalActive += tierState.queryCount;
      if (tierState.isFetching) totalFetching++;

      return {
        tier,
        name: getTierName(tier),
        activeCount: tierState.queryCount,
        nextRefreshIn: tierState.remaining,
        isFetching: tierState.isFetching,
        isActive: tierState.queryCount > 0,
        totalQueries: tierState.queryCount,
      };
    });

    setState({
      tiers,
      totalActiveQueries: totalActive,
      totalFetching,
      lastUpdated: Date.now(),
    });
  }, []);

  useEffect(() => {
    const unsubscribe = tierClock.subscribe(updateState);
    return unsubscribe;
  }, [updateState]);

  useEffect(() => {
    updateState();
    const intervalId = setInterval(updateState, updateInterval);
    return () => clearInterval(intervalId);
  }, [updateState, updateInterval]);

  return state;
}
