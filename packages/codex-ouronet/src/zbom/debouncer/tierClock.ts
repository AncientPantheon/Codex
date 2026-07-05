/**
 * tierClock — back-compat alias for the real `codexClock` monitor.
 *
 * This used to be a cosmetic free-running wall-clock shim (queryCount hardcoded
 * to 1, monitoring nothing). It is now an alias of `codexClock`, the genuine
 * read monitor: every CodexUI read reports start/done/error into it, so the
 * ZbomDebouncer bar and `useDebouncerState` reflect real network activity.
 *
 * Existing importers (`useDebouncerState`, `ZbomDebouncer`) consume the same
 * `{ remaining, isFetching, queryCount }` shape, so they keep working verbatim —
 * only now the data is real. Prefer importing `codexClock` directly in new code.
 */

export {
  codexClock as tierClock,
  codexClock,
  reportRead,
  type TierClockState,
  type ReadStatus,
  type TierQueryRow,
} from "./codexClock.js";
