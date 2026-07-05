/**
 * Pact Query Tiers — cloned verbatim from OuronetUI `src/lib/pact-query-tiers.ts`.
 * The 7-tier debounce taxonomy. In the package these tier definitions drive the
 * VISUAL ZbomDebouncer bar only (via tierClock); actual cost reads use the
 * per-read debouncer in `useZbomInfoRead` (the D3 decision).
 */

export type PactQueryTier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7';

export interface TierConfig {
  name: string;
  interval: number; // in seconds
  color: string;
  description: string;
}

export const TIER_CONFIGS: Record<PactQueryTier, TierConfig> = {
  T1: {
    name: 'INSTANT',
    interval: 0,
    color: '#c0392b', // red
    description: 'Tx confirmed → immediate refresh'
  },
  T2: {
    name: 'RAPID',
    interval: 2,
    color: '#f97316', // orange
    description: 'ZBOM input keystroke debounce'
  },
  T3: {
    name: 'FAST',
    interval: 5,
    color: '#eab308', // yellow
    description: 'Nonce/Set field selection'
  },
  T4: {
    name: 'MEDIUM',
    interval: 10,
    color: '#4ade80', // green
    description: 'Post-tx propagation'
  },
  T5: {
    name: 'SLOW',
    interval: 30,
    color: '#22d3ee', // cyan
    description: 'UI elements passive display'
  },
  T6: {
    name: 'LAZY',
    interval: 60,
    color: '#3b82f6', // blue
    description: 'Dashboard token cycling (auto)'
  },
  T7: {
    name: 'IDLE',
    interval: 120,
    color: '#6b7280', // gray
    description: 'Background keepalive'
  }
} as const;

export const ALL_TIERS: PactQueryTier[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export function getTierConfig(tier: PactQueryTier): TierConfig {
  return TIER_CONFIGS[tier];
}

export function getTierInterval(tier: PactQueryTier): number {
  return TIER_CONFIGS[tier].interval;
}

export function getTierColor(tier: PactQueryTier): string {
  return TIER_CONFIGS[tier].color;
}

export function getTierName(tier: PactQueryTier): string {
  return TIER_CONFIGS[tier].name;
}
