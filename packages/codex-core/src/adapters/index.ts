/**
 * The adapters subpath barrel: the chain-agnostic codex storage seam.
 *
 * Explicit named exports keep the public surface auditable (no `export *`).
 * The root barrel (`src/index.ts`) re-exports this subpath under `./adapters`.
 */

export type {
  CodexSnapshotBase,
  CodexAdapter,
  DeviceVariant,
} from "./types.js";
export { emptySnapshotBase, assertCodexAdapter } from "./types.js";

export { MemoryCodexAdapter } from "./MemoryCodexAdapter.js";
export { LocalStorageCodexAdapter } from "./LocalStorageCodexAdapter.js";
export type {
  StorageLike,
  LocalStorageCodexKeys,
  LocalStorageCodexAdapterOptions,
} from "./LocalStorageCodexAdapter.js";
