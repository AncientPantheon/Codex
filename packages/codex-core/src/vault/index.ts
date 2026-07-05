/**
 * Vault subpath barrel for @ancientpantheon/codex-core.
 *
 * Exposes the CK-wrapping vault CONTRACT: the injectable `CryptoSeam` + `makeVault`
 * factory, the `VaultCryptoError` secret-free error, and the absolute-window unlock
 * model (`PasswordCacheEntry` + the pure `makePasswordCache` / `isUnlocked` helpers).
 * The root barrel (`src/index.ts`) re-exports these names; consumers may import from
 * either. Core holds no real crypto and no password — the seam is caller-injected.
 */

export {
  makeVault,
  VaultCryptoError,
  type CryptoSeam,
  type Vault,
} from "./crypto.js";

export {
  makePasswordCache,
  isUnlocked,
  type PasswordCacheEntry,
} from "./unlock.js";
