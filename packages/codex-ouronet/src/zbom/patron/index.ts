/**
 * ZBOM patron subsystem — package-local port of OuronetUI's patron-selection
 * hooks (cfm/usePatronSelection + usePatronAutoSelect). Store-backed
 * (Zustand) rather than Redux. Phase 5 (Wave 5).
 */

export { usePatronSelectionDefaults } from "./usePatronSelectionDefaults.js";
export type {
  PatronMode,
  PatronSelectionDefaults,
} from "./usePatronSelectionDefaults.js";
export { usePatronAutoSelect } from "./usePatronAutoSelect.js";
export type {
  PatronAutoSelectOptions,
  PatronAutoSelectResult,
} from "./usePatronAutoSelect.js";
