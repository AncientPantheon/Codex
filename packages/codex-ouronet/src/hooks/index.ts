// @ancientpantheon/codex-ouronet/hooks
//
// Public React hooks consumers use to interact with the codex.
//
// The D5 carve moved the 16 chain-generic hook FUNCTIONS + their `*View`/`*Fn`
// types into @ancientpantheon/codex-ui/hooks (they read the store via codex-ui's
// provider context — which codex-ouronet's <CodexProvider> wrapper populates).
// This barrel re-exports that byte-stable 16-hook surface so a consumer of
// @ancientpantheon/codex-ouronet/hooks gets the same face as before (N-04).
//
// The chain-aware address-book validation registry (D-10) STAYS Ouronet-side —
// it is the StoaChain validator + pluggable per-chain seam, coupled to the Ouronet
// address-book entity. It is exported LOCALLY below.
//
// Inventory (the 16 hooks re-exported from codex-ui):
//   - useCodex()             high-level Codex state + actions
//   - useActiveWallet()      active kadena/ouro wallet + switch
//   - useGetKeypair()        pubkey → IStoaChainKeypair (throws CodexKeyMissingError)
//   - useSignTransaction()   CFM strategy wrapper (replaces useCFMStrategy)
//   - useCodexAuth()         password prompts, lock/unlock
//   - useRequestPassword()   Promise-returning unlock-and-get-password gate
//   - useStoaChainSeeds()       CRUD
//   - usePureKeypairs()      CRUD
//   - useOuroAccounts()      CRUD (CodexPrime is protected)
//   - useAddressBook()       CRUD
//   - useWatchList()         CRUD
//   - useCodexBackup()       download / import / cloud-export helpers
//   - useCodexLifecycle()    kickstart / recover
//   - useCodexIdentity()     double-Apollo identity + register-tx builder
//   - useCodexGuard()        active CodexGuard read + generate/rotate
//   - useConsumerSettings()  per-consumer namespaced settings

export {
  useCodex,
  useActiveWallet,
  useCodexAuth,
  useRequestPassword,
  useGetKeypair,
  useSignTransaction,
  useStoaChainSeeds,
  usePureKeypairs,
  useOuroAccounts,
  useAddressBook,
  useWatchList,
  useCodexBackup,
  useCodexLifecycle,
  useCodexIdentity,
  useCodexGuard,
  useConsumerSettings,
} from "@ancientpantheon/codex-ui/hooks";
export type {
  CodexView,
  ActiveWalletView,
  CodexAuthView,
  RequestPasswordFn,
  GetKeypairFn,
  SignTransactionView,
  UseSignTransactionOptions,
  StoaChainSeedsView,
  PureKeypairsView,
  OuroAccountsView,
  AddressBookView,
  WatchListView,
  CodexBackupView,
  CodexLifecycleView,
  CodexIdentityView,
  CodexGuardView,
  ConsumerSettingsView,
} from "@ancientpantheon/codex-ui/hooks";

// Chain-aware address-book validation seam (D-10 / D-11). ADDITIVE — the
// useAddressBook / AddressBookView surface is unchanged. STAYS Ouronet-side (the
// StoaChain validator + the pluggable per-chain registry, coupled to the Ouronet
// address-book entity).
export {
  STOACHAIN_CHAIN_ID,
  stoaChainAddressValidator,
  createAddressValidatorRegistry,
  registerChainAddressValidator,
  validateAddress,
  getRegisteredChains,
  resetAddressValidators,
  UnknownChainError,
} from "./addressBookChain.js";
export type {
  ChainAddressValidator,
  AddressValidatorRegistry,
} from "./addressBookChain.js";
