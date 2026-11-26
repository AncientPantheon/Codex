/**
 * `@ancientpantheon/codex-ouronet/zbom` — the ZBOM (transaction execution) surface.
 *
 * Exposes the shared subsystems the seven verbatim-cloned codex modals
 * (`./modals/*`) compose over: the package-local debouncer (cost read + status
 * circle), the patron subsystem (selection defaults + auto-select hook), the
 * toast surface (`txPending` and friends), the codex-unlock gate
 * (`useEnsureCodexUnlocked` — pops the REAL global password prompt and
 * resumes automatically), and `ActionTooltip` (the styled Radix hover
 * tooltip a button wraps itself in, instead of a native `title=` bubble) so
 * other packages (e.g. `codex-arweave`) can reach all of them without a
 * relative cross-package import.
 *
 * It also exposes `./execute` — the HEADLESS transaction surface and
 * `runMigrationChain`, the migration chain's uninterrupted loop
 * (docs/work/migration-execute/design.md). Those operations deliberately ship
 * through this EXISTING subpath rather than a new one: every subpath declared
 * in `package.json` is imported from a built `dist/` by
 * `tests/guard-subpath-resolution.test.ts`, which the test environment does
 * not build. The modals themselves mount directly from
 * `OuronetAccountsTab`; the earlier descriptor-driven `ZbomOperationModal`
 * host + `operations/*` registry were retired in favour of the 1:1 clones.
 */

export * from "./debouncer/index.js";
export * from "./patron/index.js";
export * from "./zbomProfiles.js";
export * from "./toast/toastManager.js";
export * from "./hooks/useEnsureCodexUnlocked.js";
export * from "./ui/ActionTooltip.js";
export * from "./describeKeyset.js";
export * from "./execute/index.js";
