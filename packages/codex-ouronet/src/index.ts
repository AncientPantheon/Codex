// @ancientpantheon/codex-ouronet — root entry intentionally near-empty.
//
// Per the established stoa-js monorepo convention (matching the empty roots
// of @stoachain/ouronet-core and @stoachain/stoa-core), consumers MUST import
// from a subpath for tree-shaking:
//
//   import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";   // good
//   import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";           // good
//   import { CodexProvider } from "@ancientpantheon/codex-ouronet";            // not supported
//
// Subpath inventory:
//   /provider     — <CodexProvider> root component
//   /hooks        — useCodex, useActiveWallet, useGetKeypair, useSignTransaction, etc.
//   /components   — headless <PasswordModal>, <BackupRestorePanel>, etc.
//   /adapters     — LocalStorageCodexAdapter, MemoryCodexAdapter, CodexAdapter interface
//   /resolver     — InternalCodexResolver implementing ouronet-core's KeyResolver
//   /errors       — typed CodexError subclasses (CodexLockedError, CodexKeyMissingError, ...)
//   /types        — type re-exports for consumers
//   /google-drive — opt-in OAuth + cloud-backup sync (separate subpath; consumers
//                   that don't want Google Drive don't pull in its deps)
//
// See packages/ouronet-codex/README.md for the integration recipe.
export {};
