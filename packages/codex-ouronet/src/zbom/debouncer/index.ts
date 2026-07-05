/** ZBOM package-local debouncer (Wave 3). */

export {
  parseIgnisInfo,
  parseKadenaInfo,
  parseKadenaSplit,
  coercePactDecimal,
  unwrapReadResult,
} from "./parseIgnisInfo.js";
export type { ParsedIgnisInfo, ParsedKadenaInfo, ParsedKadenaSplit } from "./parseIgnisInfo.js";

export { useZbomInfoRead } from "./useZbomInfoRead.js";
export type {
  ZbomInfoRead,
  ZbomReadStatus,
  UseZbomInfoReadOptions,
} from "./useZbomInfoRead.js";

export { useZbomRefresh } from "./useZbomRefresh.js";
export type { ZbomRefresh } from "./useZbomRefresh.js";

export { DebouncerCircle } from "./DebouncerCircle.js";
export type { DebouncerCircleProps } from "./DebouncerCircle.js";

// ── Real read-monitor + full debouncer panel ────────────────────────────────
export { CodexDebouncerPanel } from "./CodexDebouncerPanel.js";
export type { CodexDebouncerPanelProps } from "./CodexDebouncerPanel.js";

export { codexClock, reportRead } from "./codexClock.js";
export type { TierClockState, ReadStatus, TierQueryRow } from "./codexClock.js";

export { useDebouncerState } from "./useDebouncerState.js";
export type { TierState, DebouncerState } from "./useDebouncerState.js";

export {
  ALL_TIERS,
  TIER_CONFIGS,
  getTierConfig,
  getTierInterval,
  getTierColor,
  getTierName,
} from "./pactQueryTiers.js";
export type { PactQueryTier, TierConfig } from "./pactQueryTiers.js";

// ── Read registry (single source of truth for CodexUI reads) ────────────────
export {
  CODEX_READ_REGISTRY,
  READ_BY_ID,
  READ_IDS,
} from "./readRegistry.js";
export type { CodexReadFn, ReadKind } from "./readRegistry.js";
