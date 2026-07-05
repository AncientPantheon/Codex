/**
 * <CodexProvider> — the Ouronet-side WRAPPER around codex-ui's chain-generic
 * <CodexProvider>.
 *
 * The D5 carve moved the provider's generic mechanics (per-mount store mount,
 * async init effect, first-boot UI-settings overlay, onCodexDirty edge, the
 * SSR-safe shell, the store/signingClient/resolver React contexts) into
 * @ancientpantheon/codex-ui. This file is now a thin adapter that injects the
 * Ouronet-specific seams into that generic provider:
 *
 *   - `createStore` ← codex-ouronet's `createCodexStore` (the Zustand store with
 *     its four structural guards + Ouronet entity coupling — it STAYS here, §5).
 *   - `resolverFactory` ← `createOuronetResolverProvider` (binds the rewired
 *     InternalCodexResolver's auth-gated decrypt + the CodexSigningStrategy
 *     builder — the value @stoachain edge the generic package cannot hold).
 *   - `zbomToast` ← the real `MultiStepToastContainer` (the zbom transaction-
 *     status host — a zbom value edge, injected as a slot).
 *
 * The public prop surface (`adapter`, `signingClient`, `passwordCacheMinutes`,
 * `initialUiSettings`, `onCodexDirty`, `deviceVariant`) stays byte-stable with
 * the pre-carve provider (N-04): a consumer of @ancientpantheon/codex-ouronet
 * gets the same face as before. The store/context hooks (`useCodexStore`,
 * `useSigningClientOverride`, `useResolverProvider`) are re-exported from
 * codex-ui's provider so downstream code keeps its import path.
 */

import * as React from "react";
import type { ReactNode } from "react";
import type { PactClient } from "@stoachain/stoa-core/signing";

import { CodexProvider as GenericCodexProvider } from "@ancientpantheon/codex-ui/provider";
import { createCodexStore } from "../state/store.js";
import { createOuronetResolverProvider } from "../resolver/resolverProvider.js";
import { MultiStepToastContainer } from "../zbom/toast/MultiStepToastContainer.js";
import type { CodexAdapter } from "../adapters/types.js";
import type { DeviceVariant, UiSettings } from "../types/entities.js";

export interface CodexProviderProps {
  /** Storage backend for the codex. Required. Pass `new LocalStorageCodexAdapter()`
   *  for browser apps, `new MemoryCodexAdapter()` for tests/SSR. */
  adapter: CodexAdapter;

  /** Device-variant marker stamped on every touch(). Defaults to "dev". */
  deviceVariant?: DeviceVariant;

  /**
   * TTL in minutes for the unlocked password cache. Default: 1. Applied AFTER
   * adapter.loadAll() resolves — a persisted value overrides this on subsequent
   * loads (this prop is the FIRST-BOOT default).
   */
  passwordCacheMinutes?: number;

  /**
   * First-boot UI settings override. Merged in only when nothing has been
   * persisted yet (schemaVersion === 0 after adapter.loadAll()).
   */
  initialUiSettings?: Partial<UiSettings>;

  /**
   * Callback fired when the codex transitions clean (`dirty: false`) → dirty
   * (`dirty: true`). Does NOT fire on every mutation, nor on the initial state.
   */
  onCodexDirty?: () => void;

  /**
   * Optional pre-configured Pact client. When provided, useSignTransaction uses
   * this instead of constructing one. Use for CF-worker proxies, mock clients
   * in tests, or custom failover semantics.
   */
  signingClient?: PactClient;

  children: ReactNode;
}

/**
 * Provider component. Place once at the app root inside your error boundary but
 * outside any code that uses codex hooks. Renders codex-ui's generic provider
 * with the Ouronet store, resolver, and zbom-toast seams supplied.
 *
 * ```tsx
 * <CodexProvider
 *   adapter={new LocalStorageCodexAdapter()}
 *   passwordCacheMinutes={5}
 *   onCodexDirty={() => toast.info("Save to Drive?")}
 * >
 *   <App />
 * </CodexProvider>
 * ```
 */
export function CodexProvider({
  adapter,
  deviceVariant = "dev",
  passwordCacheMinutes,
  initialUiSettings,
  onCodexDirty,
  signingClient,
  children,
}: CodexProviderProps): React.JSX.Element {
  return (
    <GenericCodexProvider
      createStore={createCodexStore}
      adapter={adapter}
      deviceVariant={deviceVariant}
      passwordCacheMinutes={passwordCacheMinutes}
      initialUiSettings={initialUiSettings}
      onCodexDirty={onCodexDirty}
      signingClient={signingClient}
      resolverFactory={createOuronetResolverProvider}
      zbomToast={<MultiStepToastContainer />}
    >
      {children}
    </GenericCodexProvider>
  );
}
