/**
 * usePostTxRefresh — a monotonic nonce that increments every time a Codex
 * transaction CONFIRMS on-chain.
 *
 * `toastManager` fires `onTxConfirmed` once a submitted tx is mined + succeeds
 * (it already flashes the visual T4 debouncer via `tierClock.triggerPostTx()` at
 * the same moment). Chain-read effects that want to reflect the new on-chain
 * state simply add this nonce to their dependency list — so a single subscription
 * point turns "a tx confirmed" into "every wired read re-fetches", which is the
 * post-tx cascade the debouncer visual already implies but nothing was consuming.
 *
 * Usage: `const txNonce = usePostTxRefresh();` then include `txNonce` in the
 * read effect's deps (or a `refreshKey`).
 */

import { useState, useEffect } from "react";
import { onTxConfirmed } from "./toastManager.js";

export function usePostTxRefresh(): number {
  const [nonce, setNonce] = useState(0);
  useEffect(() => onTxConfirmed(() => setNonce((n) => n + 1)), []);
  return nonce;
}
