// @ancientpantheon/codex-ouronet/types
//
// Canonical entity types for the package. See `./entities.ts` for the full
// inventory + per-field docs.
//
// Consumers depending on these shapes should import from this subpath
// rather than fishing types out of `OuronetUI/src/ouro.d.ts` (which will
// be removed during Phase 9 of the migration).

export type {
  // Enums
  SeedType,
  OuronetOriginCurve,
  OuroOriginMode,
  OuroOriginSeedTab,
  DeviceVariant,

  // Entity types
  IKeyset,
  WalletAccount,
  IKadenaSeed,
  IKadenaWallet,
  IPureKeypair,
  IOuroAccount,
  AddressBookEntry,
  AddressKind,
  UiSettings,
  PatronSelectionMode,
  ZbomProfile,
  WatchListEntry,
  IConsumerSettings,
  ICodexIdentity,
} from "./entities.js";

export { DEFAULT_UI_SETTINGS } from "./entities.js";

// Adapter contract types re-exported for convenience so consumers can
// `import type { CodexSnapshot, CodexAdapter } from "@ancientpantheon/codex-ouronet/types"`
// without reaching into the /adapters subpath.
export type { CodexSnapshot, CodexAdapter } from "../adapters/types.js";
