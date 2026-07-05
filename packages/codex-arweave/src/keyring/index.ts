/**
 * `@ancientpantheon/codex-arweave/keyring` subpath barrel.
 *
 * The Arweave foreign-key keyring surface: generate / import a key (encrypted at
 * rest, unlock-gated) and decrypt an entry for transient use. EXPLICIT named
 * exports only (PAT-001, arweave-core's auditable-surface rule) — never
 * `export *`. The root `src/index.ts` aggregates this subpath in Wave 3 (T11.6);
 * this file does NOT touch it.
 */

export {
  generateArweaveKey,
  importArweaveKey,
  decryptArweaveKey,
} from "./foreignKeys.js";
export type {
  ForeignKeyStoreSeam,
  GenerateArweaveKeyArgs,
  ImportArweaveKeyArgs,
  DecryptArweaveKeyArgs,
} from "./foreignKeys.js";
