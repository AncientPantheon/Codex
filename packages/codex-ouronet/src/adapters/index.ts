// @ancientpantheon/codex-ouronet/adapters
//
// Storage backends. v0.1.0 ships:
//   - CodexAdapter             — pluggable interface (see ./types.ts)
//   - CodexSnapshot            — full persisted state shape
//   - LocalStorageCodexAdapter — browser default (window.localStorage)
//   - MemoryCodexAdapter       — in-memory, for SSR / Next.js server / tests
//   - emptySnapshot            — sentinel empty CodexSnapshot factory
//   - assertCodexAdapter       — runtime validator for CodexProvider's
//                                `adapter` prop
//
// Consumers wanting a different backend (IndexedDB, Tauri secure storage,
// remote KMS) implement CodexAdapter and pass to <CodexProvider adapter={...}>.

export type { CodexAdapter, CodexSnapshot } from "./types.js";
export { emptySnapshot } from "./types.js";
export { MemoryCodexAdapter, assertCodexAdapter } from "./MemoryCodexAdapter.js";
export { LocalStorageCodexAdapter } from "./LocalStorageCodexAdapter.js";
