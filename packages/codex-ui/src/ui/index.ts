// @ancientpantheon/codex-ui/ui — the chain-generic, token-styled UI shell
// relocated from codex-ouronet in the D5 carve.
//
// This barrel re-exports ONLY the MOVE-set (no value @stoachain/zbom edge) plus
// the two PURE-LAYOUT slot shells. The Ouronet-side aggregators (`CodexTabs`,
// `CodexSettingsSection`), the five chain-bound tabs, the zbom cards, and the
// @stoachain-edged `CodexInfoCard`/`EncryptionCard` STAY in codex-ouronet and
// fill these shells' slots (T9.6). NAMED re-exports only — no `export *`.
//
// The `--codex-*` token sheet is a build artifact loaded once via
// `import "@ancientpantheon/codex-ui/ui.css"`, not a JS import.

// ── Token-scope wrapper ──
export { CodexUiRoot } from "./CodexUiRoot.js";
export type { CodexUiRootProps } from "./CodexUiRoot.js";

// ── Pure display leaves ──
export { CodexIdField, CopyValueTag } from "./CodexIdField.js";
export type { CodexIdFieldProps } from "./CodexIdField.js";
export { StoicTagDisplay } from "./StoicTagDisplay.js";
export type { StoicTagDisplayProps } from "./StoicTagDisplay.js";
export { CodexLockControl, CodexPasswordPrompt } from "./CodexLockControl.js";
export type { CodexLockControlProps } from "./CodexLockControl.js";

// ── Observational CodexID (C2: the seed-reveal modal is an injected slot) ──
export {
  ObservationalCodexIdSettings,
  ObservationalCodexIdDisplay,
  readObservationalCodexIdConfig,
  codexIdPrimeName,
  CODEXID_PRIME_NAMES,
} from "./ObservationalCodexId.js";
export type {
  ObservationalCodexIdSettingsProps,
  ObservationalCodexIdDisplayProps,
  ObservationalCodexIdConfig,
  ObservationalViewSeedModalArgs,
} from "./ObservationalCodexId.js";

// ── The PURE-LAYOUT slot shells (the seam the Ouronet aggregators fill) ──
export { CodexTabsShell } from "./CodexTabsShell.js";
export type { CodexTabsShellProps, CodexTabsShellItem } from "./CodexTabsShell.js";
export { CodexSettingsSectionShell } from "./settings/CodexSettingsSectionShell.js";
export type {
  CodexSettingsSectionShellProps,
  CodexSettingsSubtab,
} from "./settings/CodexSettingsSectionShell.js";

// ── Settings cards (MOVE-set only; CodexInfoCard/EncryptionCard STAY —
//    transitive @stoachain edge via encryptionState) ──
export { ChangePasswordCard } from "./settings/ChangePasswordCard.js";
export type {
  ChangePasswordCardProps,
  ChangePasswordPayload,
} from "./settings/ChangePasswordCard.js";
export { CodexGuardCard } from "./settings/CodexGuardCard.js";
export type { CodexGuardCardProps } from "./settings/CodexGuardCard.js";
export { CodexIdentityCard } from "./settings/CodexIdentityCard.js";
export type { CodexIdentityCardProps } from "./settings/CodexIdentityCard.js";
export { ConsumerSettingsCard } from "./settings/ConsumerSettingsCard.js";
export type { ConsumerSettingsCardProps } from "./settings/ConsumerSettingsCard.js";
export { DownloadCodexCard } from "./settings/DownloadCodexCard.js";
export type { DownloadCodexCardProps } from "./settings/DownloadCodexCard.js";
export { ExperimentalCurvesCard } from "./settings/ExperimentalCurvesCard.js";
export type { ExperimentalCurvesCardProps } from "./settings/ExperimentalCurvesCard.js";
export { GasSettingsCard } from "./settings/GasSettingsCard.js";
export type { GasSettingsCardProps } from "./settings/GasSettingsCard.js";
export { NetworkSettingsCard } from "./settings/NetworkSettingsCard.js";
export type { NetworkSettingsCardProps } from "./settings/NetworkSettingsCard.js";
export { PythiaConnectorCard } from "./settings/PythiaConnectorCard.js";
export type { PythiaConnectorCardProps } from "./settings/PythiaConnectorCard.js";
export { PasswordCacheCard } from "./settings/PasswordCacheCard.js";
export type { PasswordCacheCardProps } from "./settings/PasswordCacheCard.js";

// ── Styled rotate-modal shells (C3: the three concrete modals are injected) ──
export {
  StyledRotatePaymentKeyModal,
  StyledRotateGuardModal,
  StyledRotateSovereignModal,
} from "./internal/RotateModals.js";
export type { InjectedRotateModal } from "./internal/RotateModals.js";
