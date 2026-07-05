/**
 * useConsumerSettings(name) — per-consumer view over the codex's namespaced
 * settings registry (v0.3.0+).
 *
 * `entry` is the named consumer's slot read from a subscription to the
 * `consumerSettings` slice (`?? null` when absent), so a write re-renders the
 * hook. `setSettings` is the store action verbatim — it validates the consumer
 * name + rejects schema downgrades, server-stamps `lastUpdatedAt`, and persists.
 */

import { useCodexStore } from "../provider/index.js";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";

export interface ConsumerSettingsView {
  entry: IConsumerSettings | null;
  setSettings: (entry: IConsumerSettings) => Promise<void>;
}

export function useConsumerSettings(name: string): ConsumerSettingsView {
  const store = useCodexStore();
  const entry = store((s) => s.consumerSettings)[name] ?? null;
  const actions = store((s) => s.actions);

  return {
    entry,
    setSettings: actions.updateConsumerSettings,
  };
}
