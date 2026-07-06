// @ancientpantheon/codex-ui — the ROOT barrel.
//
// The chain-generic React shell of the Codex family. Aggregates the four public
// subpaths (provider, hooks, components, ui) via NAMED re-exports — NO `export *`
// (so the surface is explicit + tree-shakeable and every symbol is auditable).
// Consumers can import the root barrel or the more-specific subpath barrels
// (`@ancientpantheon/codex-ui/{provider,hooks,components,ui}`); this file is the
// convenience aggregate.
//
// No value @stoachain / value Ouronet edge crosses this boundary — the store,
// resolver, and toast host all flow in through the provider's injected seams.

// ── provider ──
export {
  CodexProvider,
  useCodexStore,
  useSigningClientOverride,
  useResolverProvider,
} from "./provider/index.js";
export type {
  CodexProviderProps,
  CodexStore,
  CodexStoreLike,
  CodexResolverProvider,
  CodexResolverFactory,
} from "./provider/index.js";

// ── hooks (the 16-hook set + their View/Fn types + the local import error +
//    the resolver-provider seam type) ──
export {
  useCodex,
  useActiveWallet,
  useCodexAuth,
  useRequestPassword,
  useGetKeypair,
  useSignTransaction,
  useKadenaSeeds,
  usePureKeypairs,
  useOuroAccounts,
  useAddressBook,
  useWatchList,
  useCodexBackup,
  useCodexLifecycle,
  useCodexIdentity,
  useCodexGuard,
  useConsumerSettings,
} from "./hooks/index.js";
// codex-ui-LOCAL import-failure error — the root-barrel catch point (kept out of
// the /hooks subpath surface, which is byte-locked to the 16 hook functions).
export { CodexImportError } from "./hooks/errors.js";
export type {
  CodexView,
  ActiveWalletView,
  CodexAuthView,
  RequestPasswordFn,
  GetKeypairFn,
  SignTransactionView,
  UseSignTransactionOptions,
  KadenaSeedsView,
  PureKeypairsView,
  OuroAccountsView,
  AddressBookView,
  WatchListView,
  CodexBackupView,
  CodexLifecycleView,
  CodexIdentityView,
  CodexGuardView,
  ConsumerSettingsView,
  CodexResolverSeam,
  CreateSigningStrategyOptions,
} from "./hooks/index.js";

// ── components ──
export {
  PasswordModal,
  BackupRestorePanel,
  ActiveWalletPicker,
  CodexInfoPanel,
} from "./components/index.js";
export type {
  PasswordModalProps,
  PasswordModalRenderArgs,
  BackupRestorePanelProps,
  BackupRestoreRenderArgs,
  ActiveWalletPickerProps,
  ActiveWalletPickerRenderArgs,
  CodexInfoPanelProps,
  CodexInfoRenderArgs,
} from "./components/index.js";

// ── ui (token wrapper, display leaves, slot shells, settings cards, styled
//    rotate-modal shells) ──
export {
  CodexUiRoot,
  CodexIdField,
  CopyValueTag,
  StoicTagDisplay,
  CodexLockControl,
  CodexPasswordPrompt,
  ObservationalCodexIdSettings,
  ObservationalCodexIdDisplay,
  readObservationalCodexIdConfig,
  codexIdPrimeName,
  CODEXID_PRIME_NAMES,
  CodexTabsShell,
  CodexSettingsSectionShell,
  ChangePasswordCard,
  CodexGuardCard,
  CodexIdentityCard,
  ConsumerSettingsCard,
  DownloadCodexCard,
  ExperimentalCurvesCard,
  GasSettingsCard,
  PasswordCacheCard,
  StyledRotatePaymentKeyModal,
  StyledRotateGuardModal,
  StyledRotateSovereignModal,
} from "./ui/index.js";
export type {
  CodexUiRootProps,
  CodexIdFieldProps,
  StoicTagDisplayProps,
  CodexLockControlProps,
  ObservationalCodexIdSettingsProps,
  ObservationalCodexIdDisplayProps,
  ObservationalCodexIdConfig,
  ObservationalViewSeedModalArgs,
  CodexTabsShellProps,
  CodexTabsShellItem,
  CodexSettingsSectionShellProps,
  CodexSettingsSubtab,
  ChangePasswordCardProps,
  ChangePasswordPayload,
  CodexGuardCardProps,
  CodexIdentityCardProps,
  ConsumerSettingsCardProps,
  DownloadCodexCardProps,
  ExperimentalCurvesCardProps,
  GasSettingsCardProps,
  PasswordCacheCardProps,
  InjectedRotateModal,
} from "./ui/index.js";

// ── ui/foreign-chains (the chain-generic foreign-chains tab + its slot contract) ──
export { ForeignChainsTab } from "./ui/foreign-chains/index.js";
export type {
  PanelProps,
  ForeignChainPanels,
  ForeignChainsTabProps,
} from "./ui/foreign-chains/index.js";
