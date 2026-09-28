/**
 * usePreZbomTooltipSetting — the Pre-ZBOM Tooltip on/off preference.
 *
 * Persisted in the per-consumer settings registry (`IConsumerSettings`, via
 * `useConsumerSettings`) under `useConsumerName()`'s value — "Codex" by
 * default, never `codex-ouronet`'s own debug "OuronetUI" entry. That
 * separation is the feature: the tooltip can be on in one app embedding this
 * package and off in another, from the same underlying codex.
 *
 * Default ON (`enabled` is `true` when no entry has been written yet — a
 * fresh codex, or a codex whose "Codex" slot has never touched this key).
 *
 * Unlike OuronetUI's `useCodexBackedSetting` (which syncs a live Redux copy
 * FROM the codex via a bridge component, because Redux and the codex are two
 * separate stores there), Codex's settings UI reads directly from the SAME
 * Zustand store this preference persists in — `useConsumerSettings(name).entry`
 * IS the live, reactive read, already hydrated by the store's own `init()`.
 * No bridge component is needed.
 *
 * The write-back lives HERE, in the setter — never in a `useEffect` watching
 * the read value. A watcher cannot tell a user's toggle from a hydration and
 * would write back whatever it just read, on every load.
 *
 * The setter follows both hard rules from the brief:
 *   - MERGE, never replace: spreads the existing `settings` payload so an
 *     unrelated key (written by a newer build of this same app, or another
 *     feature) survives.
 *   - NEVER LOWER schemaVersion: `Math.max`s the stored value against this
 *     feature's own `SETTINGS_SCHEMA_VERSION` — the store's own
 *     `updateConsumerSettings` action independently rejects an actual
 *     downgrade attempt, but computing it this way means this setter never
 *     even tries one.
 */

import { useCallback } from "react";
import { useConsumerName } from "../../provider/index.js";
import { useConsumerSettings } from "../../hooks/index.js";

/** This feature's own settings-schema version — bumps only if the shape of
 *  what it stores under `settings.preZbomTooltip` ever changes incompatibly. */
export const SETTINGS_SCHEMA_VERSION = 1;

/** This feature's own version stamp for `IConsumerSettings.consumerVersion`
 *  ("the consumer app's own semver at the time of the write"). Not wired to
 *  any package.json — no such runtime-readable value exists in this package
 *  today, and this field is informational only (the store doesn't gate on
 *  it), so a static local marker is the appropriate scope here. */
export const CONSUMER_VERSION = "1.0.0";

export interface PreZbomTooltipSetting {
  /** Whether the pre-ZBOM hover tooltip is on. Default `true`. */
  enabled: boolean;
  /** Persist a new value under the current consumerName's settings slot. */
  setEnabled: (next: boolean) => Promise<void>;
}

export function usePreZbomTooltipSetting(): PreZbomTooltipSetting {
  const consumerName = useConsumerName();
  const { entry, setSettings } = useConsumerSettings(consumerName);

  const enabled = (entry?.settings?.preZbomTooltip as boolean | undefined) ?? true;

  const setEnabled = useCallback(
    async (next: boolean) => {
      try {
        await setSettings({
          consumerName,
          consumerVersion: CONSUMER_VERSION,
          schemaVersion: Math.max(entry?.schemaVersion ?? 0, SETTINGS_SCHEMA_VERSION),
          settings: { ...(entry?.settings ?? {}), preZbomTooltip: next },
          // Server-stamped by the store action (a caller-supplied value is
          // overridden) — still supplied so the shape is complete without a cast.
          lastUpdatedAt: new Date().toISOString(),
        });
      } catch (e) {
        // `consumerName` is a caller-facing `CodexProviderProps` field this
        // package doesn't validate — an embedding app supplying one that
        // fails the store's identifier regex (e.g. a space, a leading digit)
        // would otherwise turn every toggle click into an unhandled promise
        // rejection (the settings-card click handler doesn't await this).
        // Logged, not re-thrown: there's no toast/error-surface wired to this
        // setting today, so failing loud in the console is the honest
        // alternative to a silent, invisible no-op.
        // eslint-disable-next-line no-console
        console.error("[usePreZbomTooltipSetting] failed to persist:", e);
      }
    },
    [consumerName, entry, setSettings],
  );

  return { enabled, setEnabled };
}
