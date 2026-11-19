/**
 * Re-export of the real on-chain `describeKeyset` for consumers that cannot
 * depend on `@ouronet/ouronet-core` directly.
 *
 * `codex-arweave` (specifically `CodexIdPage.tsx`, wiring up
 * `LegacyPrimeMigrationWizard`'s `describeKeyset` prop — see
 * `docs/work/wizard-keyset-scale-and-sidebar/`'s follow-up bug-fix round)
 * has no dependency on `@ouronet/ouronet-core` at all, and it isn't hoisted
 * to the repo root either — a direct import from that package would fail
 * to resolve. This package (`codex-ouronet`) already depends on
 * `@ouronet/ouronet-core` for real (see its own `package.json`) and already
 * imports this exact function elsewhere (`zbom/cfm/inputs.tsx`'s "use
 * existing keyset-ref" tab), so re-exporting it here — through the same
 * `@ancientpantheon/codex-ouronet/zbom` subpath `codex-arweave` already
 * imports `useEnsureCodexUnlockedOptional` from — avoids adding a brand-new
 * cross-package dependency just to read one function.
 */
export { describeKeyset } from "@ouronet/ouronet-core/interactions/guardFunctions";
