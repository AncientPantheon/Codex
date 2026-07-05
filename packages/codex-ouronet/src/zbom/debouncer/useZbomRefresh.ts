/**
 * useZbomRefresh — package-local post-tx refresh trigger.
 *
 * OuronetUI's `pactQueryCache.triggerPostTx()` kicks a T4→T5/6/7 cascade so
 * balances/info re-read after a submit. The package-local equivalent is a
 * monotonic counter: pass `refreshKey` into `useZbomInfoRead` (and any chain
 * reads), and call `triggerRefresh()` after a successful execute to force a
 * re-read. No global scheduler needed — the modal owns its own reads.
 */

import { useCallback, useState } from "react";

export interface ZbomRefresh {
  /** Monotonic key; feed into `useZbomInfoRead({ refreshKey })`. */
  refreshKey: number;
  /** Bump the key — call after a successful execute. */
  triggerRefresh: () => void;
}

export function useZbomRefresh(): ZbomRefresh {
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  return { refreshKey, triggerRefresh };
}
