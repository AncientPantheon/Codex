/**
 * `@ancientpantheon/codex-ouronet/zbom` — the ZBOM (transaction execution) surface.
 *
 * Exposes the shared subsystems the seven verbatim-cloned codex modals
 * (`./modals/*`) compose over: the package-local debouncer (cost read + status
 * circle) and the patron subsystem (selection defaults + auto-select hook). The
 * modals themselves mount directly from `OuronetAccountsTab`; the earlier
 * descriptor-driven `ZbomOperationModal` host + `operations/*` registry were
 * retired in favour of the 1:1 clones.
 */

export * from "./debouncer/index.js";
export * from "./patron/index.js";
export * from "./zbomProfiles.js";
