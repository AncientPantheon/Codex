/**
 * codex-ui provider subpath barrel (`@ancientpantheon/codex-ui/provider`).
 *
 * The chain-generic provider + its internal context hooks. The store, resolver,
 * and toast host flow in through the injected seams on <CodexProvider>; this
 * package imports nothing chain-bound (no value @stoachain / Ouronet / zbom).
 */

export { CodexProvider, useCodexStore, useSigningClientOverride, useResolverProvider } from "./CodexProvider.js";
export type {
  CodexProviderProps,
  CodexStore,
  CodexStoreLike,
  CodexResolverProvider,
  CodexResolverFactory,
} from "./CodexProvider.js";
