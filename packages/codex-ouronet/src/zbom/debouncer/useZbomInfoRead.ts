/**
 * useZbomInfoRead — package-local debounced INFO read for a ZBOM operation.
 *
 * D3 DECISION (see .zbom-port/research/02 + PLAN Wave 3): we reproduce My
 * Codex's per-input cost read *behaviourally* over the existing `pactRead`
 * seam, instead of porting OuronetUI's global T1–T7 `PactQueryCache`
 * scheduler. The package cannot own a singleton tier clock without dragging
 * in the whole cache subsystem and its Redux-coupled mirror; one debounced,
 * deduped read per mounted operation modal is exactly what the cost badge
 * needs. The `pactRead` reader the consumer wires at boot still provides the
 * real network + node-failover + (in OuronetUI) cache-dedup underneath.
 *
 * Behaviour parity with `useT2Read`:
 *   - a non-null `pactCode` change schedules a debounced read (default 400ms);
 *     the previous result stays visible until the new read settles;
 *   - in-flight/stale results are ignored (request-id guard) on change/unmount;
 *   - cost is read from `infoData.ignis["ignis-need"]` (0 ⇒ free).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { pactRead } from "@stoachain/stoa-core/reads";
import { parseIgnisInfo } from "./parseIgnisInfo.js";
import { codexClock } from "./codexClock.js";

export type ZbomReadStatus = "idle" | "loading" | "fresh" | "error";

export interface ZbomInfoRead {
  /** IGNIS the op needs (0 ⇒ free); `null` until a read settles. */
  ignisNeed: number | null;
  /** Full pre-discount IGNIS cost when the INFO function reports it. */
  ignisFull: number | null;
  /** Discount when reported. */
  ignisDiscount: number | null;
  /** Human-readable cost note (`ignis-text`). */
  ignisText: string;
  /** True only once a read is fresh AND `ignisNeed === 0`. */
  isFree: boolean;
  status: ZbomReadStatus;
  error: string | null;
  /** The unwrapped INFO payload (for zones that read more than the cost). */
  data: unknown;
  /** Force an immediate (un-debounced) re-read of the current code. */
  refresh: () => void;
}

export interface UseZbomInfoReadOptions {
  /** Debounce window in ms (default 400). */
  debounceMs?: number;
  /** Cache-tier hint forwarded to the reader (default "T2" — preview reads). */
  tier?: string;
  /** Bump to force a re-read (e.g. post-tx propagation from useZbomRefresh). */
  refreshKey?: number;
  /** readRegistry id — when set, this read reports into the codexClock monitor. */
  readId?: string;
}

const IDLE: Omit<ZbomInfoRead, "refresh"> = {
  ignisNeed: null,
  ignisFull: null,
  ignisDiscount: null,
  ignisText: "",
  isFree: false,
  status: "idle",
  error: null,
  data: null,
};

export function useZbomInfoRead(
  pactCode: string | null,
  opts: UseZbomInfoReadOptions = {},
): ZbomInfoRead {
  const { debounceMs = 400, tier = "T2", refreshKey = 0, readId } = opts;

  const [state, setState] = useState<Omit<ZbomInfoRead, "refresh">>(IDLE);

  // Monotonic request id — only the latest in-flight read may commit.
  const reqIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runRead = useCallback(
    (code: string) => {
      const myReq = ++reqIdRef.current;
      setState((prev) => ({ ...prev, status: "loading", error: null }));
      const doRead = () => pactRead(code, { tier });
      void (readId ? codexClock.report(readId, undefined, doRead) : doRead())
        .then((raw) => {
          if (myReq !== reqIdRef.current) return; // superseded
          const parsed = parseIgnisInfo(raw);
          setState({
            ...parsed,
            isFree: parsed.ignisNeed === 0,
            status: "fresh",
            error: null,
            data: raw,
          });
        })
        .catch((e: unknown) => {
          if (myReq !== reqIdRef.current) return;
          setState((prev) => ({
            ...prev,
            status: "error",
            error: e instanceof Error ? e.message : "INFO read failed.",
          }));
        });
    },
    [tier, readId],
  );

  // Debounced read on code / refreshKey change.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pactCode == null || pactCode.trim() === "") {
      reqIdRef.current++; // cancel any in-flight commit
      setState(IDLE);
      return;
    }
    const code = pactCode;
    // Reflect a pending read immediately so the status circle spins during the
    // debounce window (prior result stays visible via the spread in runRead).
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    timerRef.current = setTimeout(() => runRead(code), debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pactCode, debounceMs, refreshKey, runRead]);

  // Cancel any pending commit on unmount.
  useEffect(() => () => void reqIdRef.current++, []);

  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pactCode != null && pactCode.trim() !== "") runRead(pactCode);
  }, [pactCode, runRead]);

  return { ...state, refresh };
}
