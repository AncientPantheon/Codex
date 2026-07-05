/**
 * usePatronSelectionDefaults — package port of OuronetUI's
 * `usePatronSelection.ts`. Reads the codex-scoped
 * `uiSettings.patronSelectionMode` (v0.5.0 vocabulary
 * `wealthiest | prime | resident`) and produces the two values every ZBOM
 * modal needs at mount:
 *
 *   - `initialPatronMode` — the selector `PatronMode` (`prime | resident |
 *     custom`) the modal's `useState` should seed with. When the setting is
 *     `wealthiest` the seed is `prime` as a placeholder; `usePatronAutoSelect`
 *     then flips it to whichever codex account holds the most IGNIS.
 *   - `autoSelectBestPatron` — forwarded to the selector. `true` only when the
 *     setting is `wealthiest`; otherwise `false` so an explicit `prime` /
 *     `resident` preference wins instead of being silently overridden.
 *
 * Difference from OuronetUI: the setting is read from the package Zustand store
 * (`useCodex().uiSettings`) instead of the Redux `wallet.uiSettings` slice.
 */

import { useCodex } from "../../hooks/index.js";
import type { PatronSelectionMode } from "../../types/entities.js";

export type PatronMode = "prime" | "resident" | "custom";

export interface PatronSelectionDefaults {
  initialPatronMode: PatronMode;
  autoSelectBestPatron: boolean;
  setting: PatronSelectionMode;
}

export function usePatronSelectionDefaults(): PatronSelectionDefaults {
  const { uiSettings } = useCodex();
  const setting = (uiSettings?.patronSelectionMode ??
    "wealthiest") as PatronSelectionMode;

  const initialPatronMode: PatronMode =
    setting === "resident" ? "resident" : "prime";
  const autoSelectBestPatron = setting === "wealthiest";

  return { initialPatronMode, autoSelectBestPatron, setting };
}
