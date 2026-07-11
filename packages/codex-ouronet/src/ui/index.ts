// @ancientpantheon/codex-ouronet/ui — the Ouronet-side UI barrel.
//
// The D5 carve moved the chain-generic, token-styled UI leaves + the two
// pure-layout slot shells into @ancientpantheon/codex-ui/ui. This barrel
// RECONSTITUTES the pre-carve `./ui` public surface BYTE-FOR-BYTE (N-04):
//
//   - the MOVE-set generic names are re-exported FROM `@ancientpantheon/codex-ui/ui`
//   - the STAY-set names (the 5 @stoachain/zbom-edged tabs, the zbom debouncer
//     trio, the 3 zbom settings cards, the @stoachain-edged CodexInfoCard +
//     EncryptionCard [C4], and the Ouronet-composed CodexTabs /
//     CodexSettingsSection aggregators) are exported LOCALLY.
//
// codex-ui's own `./ui` barrel CANNOT re-export the STAY names (they are value
// @stoachain/zbom edges the graph guard forbids), so this barrel is the single
// place the full pre-carve `./ui` name set is reassembled.
//
// The CSS sheet is a build artifact loaded once via
// `import "@ancientpantheon/codex-ouronet/ui.css"`, not a JS import.

// ── MOVE-set generic leaves re-exported from codex-ui ──
export {
  CodexUiRoot,
  StoicTagDisplay,
  CodexLockControl,
  CodexPasswordPrompt,
  ObservationalCodexIdSettings,
  ObservationalCodexIdDisplay,
} from "@ancientpantheon/codex-ui/ui";
export type {
  CodexUiRootProps,
  StoicTagDisplayProps,
  CodexLockControlProps,
  ObservationalCodexIdSettingsProps,
  ObservationalCodexIdDisplayProps,
  ObservationalCodexIdConfig,
} from "@ancientpantheon/codex-ui/ui";

// ── MOVE-set settings cards re-exported from codex-ui ──
export {
  ChangePasswordCard,
  DownloadCodexCard,
  ExperimentalCurvesCard,
  CodexIdentityCard,
  CodexGuardCard,
  ConsumerSettingsCard,
  GasSettingsCard,
} from "@ancientpantheon/codex-ui/ui";
export type {
  ChangePasswordCardProps,
  ChangePasswordPayload,
  DownloadCodexCardProps,
  ExperimentalCurvesCardProps,
  CodexIdentityCardProps,
  CodexGuardCardProps,
  ConsumerSettingsCardProps,
  GasSettingsCardProps,
} from "@ancientpantheon/codex-ui/ui";

// ── STAY-set: the five @stoachain/zbom-edged account tabs (local) ──
export { AddressBookTab } from "./tabs/AddressBookTab.js";
export type { AddressBookTabProps } from "./tabs/AddressBookTab.js";
export { PureKeypairsTab } from "./tabs/PureKeypairsTab.js";
export type { PureKeypairsTabProps } from "./tabs/PureKeypairsTab.js";
export { SeedWordsTab } from "./tabs/SeedWordsTab.js";
export type { SeedWordsTabProps } from "./tabs/SeedWordsTab.js";
export { StoaAccountsTab } from "./tabs/StoaAccountsTab.js";
export type { StoaAccountsTabProps } from "./tabs/StoaAccountsTab.js";
export { OuronetAccountsTab } from "./tabs/OuronetAccountsTab.js";
export type { OuronetAccountsTabProps } from "./tabs/OuronetAccountsTab.js";

// ── STAY-set: the Ouronet-composed tabs aggregator (fills CodexTabsShell) ──
export { CodexTabs } from "./CodexTabs.js";
export type { CodexTabsProps, CodexTabKey } from "./CodexTabs.js";

// ── STAY-set: the zbom debouncer trio (value zbom edge) ──
export { CodexDebouncerPanel } from "../zbom/debouncer/CodexDebouncerPanel.js";
export type { CodexDebouncerPanelProps } from "../zbom/debouncer/CodexDebouncerPanel.js";
export { codexClock } from "../zbom/debouncer/codexClock.js";
export { CODEX_READ_REGISTRY } from "../zbom/debouncer/readRegistry.js";
export type { CodexReadFn } from "../zbom/debouncer/readRegistry.js";

// ── STAY-set: the @stoachain-edged settings cards (C4 — CodexInfoCard +
//    EncryptionCard transitively edge @stoachain via encryptionState) ──
export { CodexInfoCard } from "./settings/CodexInfoCard.js";
export type { CodexInfoCardProps } from "./settings/CodexInfoCard.js";
export { EncryptionCard } from "./settings/EncryptionCard.js";
export type { EncryptionCardProps } from "./settings/EncryptionCard.js";

// ── STAY-set: the three zbom settings cards (value zbom edge) ──
export { ZbomSettingsCard } from "./settings/ZbomSettingsCard.js";
export type { ZbomSettingsCardProps } from "./settings/ZbomSettingsCard.js";
export { DebouncerSettingsCard } from "./settings/DebouncerSettingsCard.js";
export type { DebouncerSettingsCardProps } from "./settings/DebouncerSettingsCard.js";
export { ReadFunctionsCard } from "./settings/ReadFunctionsCard.js";
export type { ReadFunctionsCardProps } from "./settings/ReadFunctionsCard.js";

// ── STAY-set: the Ouronet-composed settings aggregator (fills the section
//    shell with the concrete cards + the zbom-specific subtab taxonomy) ──
export { CodexSettingsSection } from "./settings/CodexSettingsSection.js";
export type { CodexSettingsSectionProps, CodexNetworkTabConfig } from "./settings/CodexSettingsSection.js";

// ── Apollo-ownership verifier (/apollo-verify) — generic RP verify page +
//    signing seam (the Apollo-curve `@stoachain` value edge) ──
export { ApolloVerifyView } from "../apollo-verify/ApolloVerifyView.js";
export type { ApolloVerifyViewProps } from "../apollo-verify/ApolloVerifyView.js";
export {
  signApolloOwnership,
  buildApolloOwnershipMessage,
} from "../apollo-verify/signApolloOwnership.js";
export type { ApolloProof } from "../apollo-verify/signApolloOwnership.js";
