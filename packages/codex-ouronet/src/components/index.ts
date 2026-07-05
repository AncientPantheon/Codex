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
