// @ancientpantheon/codex-ouronet/components
//
// Headless React components consumers theme with their own design tokens.
//
// The D5 carve moved the four chain-generic, headless components (PasswordModal,
// BackupRestorePanel, ActiveWalletPicker, CodexInfoPanel — no value @stoachain /
// zbom edge) into @ancientpantheon/codex-ui/components. This barrel re-exports
// them so the byte-stable `/components` surface is unchanged (N-04).
//
// The @stoachain-edged components STAY Ouronet-side and are exported LOCALLY:
//   - <AddPureKeypairForm>        import a raw private key as foreign key
//   - <RotateGuardModal>          CFM modal for ouro-account guard rotation
//   - <RotatePaymentKeyModal>     CFM modal for payment-key rotation
//   - <RotateSovereignModal>      CFM modal for smart-account sovereign

// ── Generic components re-exported from codex-ui ──
export {
  PasswordModal,
  BackupRestorePanel,
  ActiveWalletPicker,
  CodexInfoPanel,
} from "@ancientpantheon/codex-ui/components";
export type {
  PasswordModalProps,
  PasswordModalRenderArgs,
  BackupRestorePanelProps,
  BackupRestoreRenderArgs,
  ActiveWalletPickerProps,
  ActiveWalletPickerRenderArgs,
  CodexInfoPanelProps,
  CodexInfoRenderArgs,
} from "@ancientpantheon/codex-ui/components";

// ── STAY components (value @stoachain / zbom edge) — kept local ──
export { AddPureKeypairForm } from "./AddPureKeypairForm.js";
export type {
  AddPureKeypairFormProps,
  AddPureKeypairRenderArgs,
} from "./AddPureKeypairForm.js";

export { RotateSovereignModal } from "./RotateSovereignModal.js";
export type {
  RotateSovereignModalProps,
  RotateSovereignRenderArgs,
} from "./RotateSovereignModal.js";

export { RotatePaymentKeyModal } from "./RotatePaymentKeyModal.js";
export type {
  RotatePaymentKeyModalProps,
  RotatePaymentKeyRenderArgs,
} from "./RotatePaymentKeyModal.js";

export { RotateGuardModal } from "./RotateGuardModal.js";
export type {
  RotateGuardModalProps,
  RotateGuardRenderArgs,
  RotateGuardMode,
  RotateGuardPred,
} from "./RotateGuardModal.js";

// `legacy-prime-migration-wizard` T3: the Codex ID page's "Make This Codex
// Eligible" wizard shell + Page 1 (intro). Lives physically under
// `ui/internal/` (the `CodexModalShell`-wrapped, single-large-component
// wizard convention — see that file's own doc comment) but is exported
// here, the SAME way as the STAY components above, for the one host
// (`codex-arweave`'s `CodexIdPage.tsx`) that opens it.
export { LegacyPrimeMigrationWizard } from "../ui/internal/LegacyPrimeMigrationWizard.js";
export type {
  LegacyPrimeMigrationWizardProps,
  LegacyPrimeMigrationWizardStep,
} from "../ui/internal/LegacyPrimeMigrationWizard.js";

// `upgrade-prompt-ui` T4: the Codex ID page's "Codex Upgrade" wizard — runs
// the Structural Migration Engine against the live, already-unlocked codex.
// Same physical/export-location pattern as LegacyPrimeMigrationWizard above
// (a completely separate migration; this is its own sibling card, not an
// extension of it).
export { StructuralUpgradeWizard } from "../ui/internal/StructuralUpgradeWizard.js";
export type { StructuralUpgradeWizardProps } from "../ui/internal/StructuralUpgradeWizard.js";
