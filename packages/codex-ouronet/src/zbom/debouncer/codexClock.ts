/**
 * codexClock — the CodexUI's own real-time read MONITOR.
 *
 * This replaces the earlier cosmetic free-running `tierClock` shim. It does NOT
 * schedule reads (the React hooks fire them as they always have); it OBSERVES
 * them. Every CodexUI read is wrapped in `codexClock.report(id, …, fn)`, which:
 *   • marks the read's tier as fetching the moment it starts,
 *   • records fresh/error + a settle timestamp when it finishes,
 * keyed by its `readRegistry` id (+ chainId for per-chain reads). The
 * MainDebouncer-style panel and the Settings "Read Functions" page both read
 * their live state from here — real query counts, real spinners, real
 * per-tier "time since last refresh" rings, real active-reads tooltips.
 *
 * Fully self-contained: no OuronetUI imports, no Redux. The underlying network
 * (+ node failover, + the host's own cache) still happens inside whatever
 * reader the consumer wired via `setPactReader`; this layer only times it.
 */

import { getTierInterval, ALL_TIERS, type PactQueryTier } from "./pactQueryTiers.js";
import { READ_BY_ID } from "./readRegistry.js";

export type ReadStatus = "idle" | "fetching" | "fresh" | "error" | "stale";

interface ReadRecord {
  id: string;
  tier: PactQueryTier;
  fnName: string;
  chainId?: string;
  status: ReadStatus;
  startedAt: number;
  settledAt: number; // 0 until first settle
}

export interface TierClockState {
  /** Seconds until this tier's next nominal refresh (0 for interval-0 tiers). */
  remaining: number;
  /** True while any read in this tier is in-flight (or during a T4 post-tx flash). */
  isFetching: boolean;
  /** Number of distinct reads observed on this tier (0 ⇒ tier idle/greyed). */
  queryCount: number;
}

export interface TierQueryRow {
  id: string;
  fnName: string;
  chainId?: string;
  status: ReadStatus;
}

const _records = new Map<string, ReadRecord>();
let _listeners: Array<() => void> = [];
let _interval: ReturnType<typeof setInterval> | null = null;
let _t4FlashUntil = 0;

const keyOf = (id: string, chainId?: string) => `${id}::${chainId ?? ""}`;

/** Short human label for a read (registry canonical, minus the namespace). */
function fnLabel(id: string): string {
  const entry = READ_BY_ID[id];
  if (!entry) return id;
  const c = entry.canonical;
  // Trim the leading "ouronet-ns." for compactness; keep module.name.
  return c.startsWith("ouronet-ns.") ? c.slice("ouronet-ns.".length) : c;
}

function _notify() {
  for (const fn of _listeners) fn();
}

function _start() {
  if (_interval) return;
  _interval = setInterval(_notify, 200);
}

function _stop() {
  if (_interval && _listeners.length === 0) {
    clearInterval(_interval);
    _interval = null;
  }
}

export const codexClock = {
  /**
   * Wrap a read so its timing feeds the monitor. Resolves/rejects exactly as
   * `fn` does — instrumentation never changes the read's result or errors.
   */
  async report<T>(
    id: string,
    opts: { chainId?: string } | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const entry = READ_BY_ID[id];
    const tier: PactQueryTier = entry?.tier ?? "T5";
    const chainId = opts?.chainId;
    const k = keyOf(id, chainId);
    const now = Date.now();
    _records.set(k, {
      id,
      tier,
      fnName: fnLabel(id),
      chainId,
      status: "fetching",
      startedAt: now,
      settledAt: _records.get(k)?.settledAt ?? 0,
    });
    _notify();
    try {
      const result = await fn();
      const rec = _records.get(k);
      if (rec) {
        rec.status = "fresh";
        rec.settledAt = Date.now();
      }
      _notify();
      return result;
    } catch (e) {
      const rec = _records.get(k);
      if (rec) {
        rec.status = "error";
        rec.settledAt = Date.now();
      }
      _notify();
      throw e;
    }
  },

  subscribe(fn: () => void): () => void {
    _listeners.push(fn);
    _start();
    return () => {
      _listeners = _listeners.filter((l) => l !== fn);
      _stop();
    };
  },

  getTierState(tier: PactQueryTier): TierClockState {
    const interval = getTierInterval(tier);
    const recs = [..._records.values()].filter((r) => r.tier === tier);
    const queryCount = recs.length;
    const fetching = recs.some((r) => r.status === "fetching");
    const isFetching = fetching || (tier === "T4" && Date.now() < _t4FlashUntil);

    let remaining = interval;
    if (interval > 0 && recs.length > 0) {
      // Anchor the ring to the most-recent settle in this tier → "time since
      // last refresh", wrapping each interval like the host scheduler's ring.
      const lastSettled = Math.max(...recs.map((r) => r.settledAt || r.startedAt));
      const elapsed = (Date.now() - lastSettled) / 1000;
      remaining = interval - (elapsed % interval);
    }
    return { remaining, isFetching, queryCount };
  },

  /** Per-tier active/recent reads, for the medallion hover tooltips. */
  getQueriesByTier(): Map<PactQueryTier, TierQueryRow[]> {
    const out = new Map<PactQueryTier, TierQueryRow[]>();
    for (const t of ALL_TIERS) out.set(t, []);
    for (const r of _records.values()) {
      out.get(r.tier)!.push({ id: r.id, fnName: r.fnName, chainId: r.chainId, status: r.status });
    }
    return out;
  },

  /** Aggregate live status for one registry id (across chains) — for the Read Functions page. */
  getReadStatus(id: string): ReadStatus {
    const recs = [..._records.values()].filter((r) => r.id === id);
    if (recs.length === 0) return "idle";
    if (recs.some((r) => r.status === "fetching")) return "fetching";
    if (recs.some((r) => r.status === "fresh")) return "fresh";
    if (recs.some((r) => r.status === "error")) return "error";
    return "stale";
  },

  /** Post-tx propagation flash on T4 (mirrors the host's triggerPostTx cascade). */
  triggerPostTx(): void {
    _t4FlashUntil = Date.now() + 800;
    _notify();
  },

  /** Test/diagnostic — clear all observed reads. */
  _reset(): void {
    _records.clear();
    _t4FlashUntil = 0;
    _notify();
  },
};

/** Convenience wrapper: `reportRead(id, fn)` with no chain split. */
export function reportRead<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return codexClock.report(id, undefined, fn);
}
