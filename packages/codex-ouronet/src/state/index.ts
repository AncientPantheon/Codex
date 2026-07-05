// @ancientpantheon/codex-ouronet/state
//
// The Zustand store backing CodexProvider. Consumers MUST go through
// hooks (which subscribe to slices of this store via React-style
// reactive subscriptions), not import from here directly FOR RUNTIME.
//
// TYPE-ONLY CONTRACT EXPOSED: the store STATE type (`CodexStoreState`) and
// the canonical callable-store handle type (`CodexStore`) are now publicly
// reachable via the `./state` package.json export. This is a type-only
// seam so codex-ui can pin its injected `createStore` seam to the exact
// callable Zustand store shape without a value edge — the concrete
// `createCodexStore` factory is still injected at runtime (never imported
// by codex-ui). Runtime consumers still go through the hooks.

import type { UseBoundStore, StoreApi } from "zustand";
import type { CodexStoreState } from "./store.js";

/**
 * The canonical callable Zustand store handle codex-ui's `createStore` seam
 * returns and `useCodexStore()` serves — `store((s) => s.slice)` selector form
 * plus `getState`/`subscribe`. Erased at compile under codex-ui's
 * `verbatimModuleSyntax`; no runtime/reverse edge results from consuming it.
 */
export type CodexStore = UseBoundStore<StoreApi<CodexStoreState>>;

export type {
  CodexStoreState,
  CodexStoreActions,
  PasswordCacheEntry,
  PendingPasswordRequest,
  KickstartArgs,
  KickstartResult,
  UnsignedPactTx,
} from "./store.js";

export {
  createCodexStore,
  _internal_requireUnlocked,
  CodexPasswordError,
  RETIREMENT_SUFFIX_REGEX,
  RETIREMENT_SUFFIX_CAPTURE_REGEX,
} from "./store.js";

export type { SchemaMigration } from "./migrations.js";
export {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  applyMigrations,
  canConsumerWrite,
} from "./migrations.js";
