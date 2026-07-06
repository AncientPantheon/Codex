/**
 * <CodexProvider> — the chain-generic React root of the Codex family.
 *
 * Provides:
 *   - Per-mount store + React Context (the store factory is INJECTED — see below)
 *   - Auto-init with the supplied adapter (browser-only effect)
 *   - passwordCacheMinutes prop → seeds uiSettings.passwordCacheMinutes
 *   - initialUiSettings prop → first-boot override of UI settings
 *   - onCodexDirty callback → fires on clean→dirty transitions
 *   - signingClient prop → optional signing-client override (consumed by the
 *     signing hook via the provider's internal context)
 *   - resolverFactory prop → produces the resolver-provider the two StoaChain-bound
 *     hooks (useGetKeypair / useSignTransaction) consume, exposed via context
 *   - zbomToast prop → an injected toast-host slot mounted browser-side
 *   - SSR-safe shell: renders children with a no-op shell on the server
 *     (typeof window === 'undefined'); init runs only in the browser
 *
 * Why the store is INJECTED (not a hardcoded createCodexStore import): this
 * package is chain-generic and must carry no value @stoachain / Ouronet edge.
 * The concrete Zustand store (with its structural guards + Ouronet entity
 * coupling) stays in codex-ouronet and is supplied through the `createStore`
 * seam. The provider mounts whatever store the seam returns.
 *
 * Why the resolver is INJECTED: the two signing hooks need a runtime resolver
 * that reaches @stoachain crypto; that resolver stays Ouronet-side and is
 * supplied through `resolverFactory`, exposed here via context so the hooks can
 * read it without importing anything chain-bound.
 *
 * Why the toast host is INJECTED: the transaction-status modal container is a
 * zbom (Ouronet) value edge. codex-ui takes it as the `zbomToast` slot; the
 * concrete container is supplied by codex-ouronet.
 *
 * Why per-mount store (not module-level singleton): tests need isolation across
 * cases; two providers in one tree each get their own store; hooks subscribe via
 * the nearest context.
 *
 * Why an effect (not synchronous init): adapter.loadAll() is async. Initialising
 * in an effect exposes the same isReady/isLocked pair through useCodex().
 *
 * Why THREE contexts (store + signingClient + resolver): the store is universally
 * needed by every hook; the signingClient and resolver are consumed only by the
 * signing hooks. Splitting them keeps the non-signing hooks off signing-related
 * re-renders.
 */

import * as React from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { ReactNode } from "react";
import type { PactClient } from "@stoachain/stoa-core/signing";
// TYPE-ONLY (erased under verbatimModuleSyntax): the canonical callable Zustand
// store handle. The concrete `createCodexStore` factory is still INJECTED via the
// `createStore` seam — this is the type contract only, carrying no value/reverse edge.
import type { CodexStore as OuronetCodexStore } from "@ancientpantheon/codex-ouronet/state";

// The store's concrete state type stays Ouronet-side (§5). codex-ui treats the
// injected store structurally; a broad shape keeps it chain-generic while still
// giving the effect the getState().actions surface it touches.
export interface CodexStoreLike {
  getState: () => {
    schemaVersion?: number;
    dirty?: boolean;
    actions: {
      init: (adapter: unknown, deviceVariant?: unknown) => Promise<void> | void;
      updateUiSettings: (
        overrides: Record<string, unknown>
      ) => Promise<void> | void;
      clearDirty: () => void;
    };
  };
  subscribe: (listener: (state: { dirty?: boolean }) => void) => () => void;
}

/** The store handle the context serves. This is the CALLABLE Zustand store
 *  Ouronet's `createCodexStore` returns (`UseBoundStore<StoreApi<CodexStoreState>>`)
 *  — selector form `store((s) => s.slice)` plus `getState`/`subscribe`. Pinned to
 *  the canonical Ouronet type via a TYPE-ONLY import (erased at compile; the
 *  factory itself is still injected through the `createStore` seam, so no runtime
 *  or reverse value edge results). `CodexStoreLike` (below) remains the narrow
 *  structural surface the provider's own init effect touches. */
export type CodexStore = OuronetCodexStore;

/**
 * The resolver-provider seam the two StoaChain-bound hooks consume at runtime.
 * codex-ouronet's InternalCodexResolver fills it; codex-ui never imports the
 * concrete resolver, only reads it from context.
 */
export interface CodexResolverProvider {
  getKeyPairByPublicKey(publicKey: string): Promise<unknown>;
}

/** Factory that builds the resolver-provider from the mounted store. */
export type CodexResolverFactory = (store: CodexStore) => CodexResolverProvider;

export interface CodexProviderProps {
  /** Injected store factory (seam). codex-ouronet supplies its real
   *  `createCodexStore`; codex-ui carries no store value import. Required. */
  createStore: () => CodexStore;

  /** Storage backend for the codex. Required. */
  adapter: unknown;

  /** Device-variant marker stamped on every touch(). Defaults to "dev". */
  deviceVariant?: unknown;

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
  initialUiSettings?: Record<string, unknown>;

  /**
   * Callback fired when the codex transitions clean (`dirty: false`) → dirty
   * (`dirty: true`). Does NOT fire on every mutation, nor on the initial state.
   */
  onCodexDirty?: () => void;

  /**
   * Optional pre-configured signing client. When provided, the signing hook
   * uses this instead of constructing one. Its type stays byte-stable via a
   * TYPE-ONLY import from @stoachain/stoa-core/signing (erased at compile).
   */
  signingClient?: PactClient;

  /**
   * Injected resolver-provider factory (seam). Produces the resolver the
   * signing hooks consume; exposed via context by this provider. codex-ouronet
   * supplies the real InternalCodexResolver.
   */
  resolverFactory?: CodexResolverFactory;

  /**
   * Injected transaction-status toast host (seam). Replaces the zbom
   * MultiStepToastContainer value import; mounted browser-side inside the
   * provider tree. codex-ouronet supplies the concrete container.
   */
  zbomToast?: ReactNode;

  children: ReactNode;
}

const CodexStoreContext = createContext<CodexStore | null>(null);

/** Optional signing-client override context. Separate from the store so the
 *  signing hook can fall back to its default path when no override is given. */
const SigningClientContext = createContext<PactClient | null>(null);

/** Resolver-provider context. Null when no resolverFactory is supplied. */
const ResolverProviderContext = createContext<CodexResolverProvider | null>(
  null
);

export function CodexProvider({
  createStore,
  adapter,
  deviceVariant = "dev",
  passwordCacheMinutes,
  initialUiSettings,
  onCodexDirty,
  signingClient,
  resolverFactory,
  zbomToast,
  children,
}: CodexProviderProps): React.JSX.Element {
  const storeRef = useRef<CodexStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createStore();
  }
  const store = storeRef.current;

  // SSR detection — the init effect skips entirely on the server (browser-only
  // storage adapters would crash on adapter.loadAll()).
  const isBrowser = typeof window !== "undefined";

  // Stable refs for the values consumed inside effects, so a fresh closure per
  // render does not re-trigger init.
  const onCodexDirtyRef = useRef(onCodexDirty);
  onCodexDirtyRef.current = onCodexDirty;
  const passwordCacheMinutesRef = useRef(passwordCacheMinutes);
  passwordCacheMinutesRef.current = passwordCacheMinutes;
  const initialUiSettingsRef = useRef(initialUiSettings);
  initialUiSettingsRef.current = initialUiSettings;

  // Init effect — runs once. Loads the adapter snapshot, applies first-boot UI
  // settings overrides when applicable, then settles the store.
  useEffect(() => {
    if (!isBrowser) return; // SSR — consumer renders the inert shell.

    let cancelled = false;
    (async () => {
      // The init effect treats the store through its NARROW structural surface
      // (`CodexStoreLike`): `adapter`/`deviceVariant`/UI overrides are `unknown`
      // at the provider boundary, so the loose signatures on `CodexStoreLike`
      // are what the effect wants — not the concrete `CodexStoreState` actions.
      const looseStore = store as unknown as CodexStoreLike;
      const actions = looseStore.getState().actions;
      await actions.init(adapter, deviceVariant);
      if (cancelled) return;

      const state = looseStore.getState();
      // First-boot overlay — only when nothing persisted yet (schemaVersion 0).
      const isFreshBoot = state.schemaVersion === 0;
      const overrides: Record<string, unknown> = {};
      if (isFreshBoot && initialUiSettingsRef.current) {
        Object.assign(overrides, initialUiSettingsRef.current);
      }
      if (passwordCacheMinutesRef.current !== undefined && isFreshBoot) {
        overrides.passwordCacheMinutes = passwordCacheMinutesRef.current;
      }
      if (Object.keys(overrides).length > 0) {
        await actions.updateUiSettings(overrides);
        // First-boot overrides are bootstrap defaults, not user edits.
        actions.clearDirty();
      }
    })().catch(() => {
      // Errors land in the store's initError slice; consumers read it via useCodex.
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, isBrowser]);

  // onCodexDirty subscription — fires on the false→true edge.
  const prevDirtyRef = useRef(false);
  useEffect(() => {
    if (!isBrowser) return;
    const unsub = store.subscribe((state) => {
      const wasDirty = prevDirtyRef.current;
      const isDirty = state.dirty === true;
      if (!wasDirty && isDirty && onCodexDirtyRef.current) {
        onCodexDirtyRef.current();
      }
      prevDirtyRef.current = isDirty;
    });
    return unsub;
  }, [store, isBrowser]);

  const storeValue = useMemo(() => store, [store]);

  const clientValue = useMemo(() => signingClient ?? null, [signingClient]);

  // Resolver-provider — built once from the mounted store via the injected
  // seam. Null when no factory supplied (the signing hooks handle absence).
  const resolverValue = useMemo(
    () => (resolverFactory ? resolverFactory(store) : null),
    [resolverFactory, store]
  );

  return (
    <CodexStoreContext.Provider value={storeValue}>
      <SigningClientContext.Provider value={clientValue}>
        <ResolverProviderContext.Provider value={resolverValue}>
          {children}
          {/* Injected transaction-status toast host. Browser-only — the
              provider is SSR-safe and the host may need document. */}
          {isBrowser && zbomToast}
        </ResolverProviderContext.Provider>
      </SigningClientContext.Provider>
    </CodexStoreContext.Provider>
  );
}

/**
 * Internal hook — returns the per-mount store. Consumed by every public hook to
 * read/subscribe to codex state. Throws if called outside a <CodexProvider>.
 */
export function useCodexStore(): CodexStore {
  const store = useContext(CodexStoreContext);
  if (store === null) {
    throw new Error(
      "useCodexStore: missing <CodexProvider>. Wrap your app at the root, e.g. " +
        "<CodexProvider createStore={createCodexStore} adapter={new LocalStorageCodexAdapter()}>{...}</CodexProvider>."
    );
  }
  return store;
}

/**
 * Internal hook — returns the optional signingClient override, or null when
 * none was supplied. Does NOT throw outside a provider.
 */
export function useSigningClientOverride(): PactClient | null {
  return useContext(SigningClientContext);
}

/**
 * Internal hook — returns the injected resolver-provider, or null when no
 * resolverFactory was supplied. Consumed by useGetKeypair / useSignTransaction
 * for their runtime crypto calls. Does NOT throw outside a provider.
 */
export function useResolverProvider(): CodexResolverProvider | null {
  return useContext(ResolverProviderContext);
}
