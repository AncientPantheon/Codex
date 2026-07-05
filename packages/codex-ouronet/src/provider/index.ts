// @ancientpantheon/codex-ouronet/provider
//
// <CodexProvider> — the Ouronet-side wrapper consumers place once at app root.
// It renders codex-ui's chain-generic <CodexProvider> with the Ouronet store,
// resolver, and zbom-toast seams injected (see ./CodexProvider.tsx). The public
// prop surface stays byte-stable with the pre-carve provider (N-04).
//
// The store/context hooks (`useCodexStore`, `useSigningClientOverride`,
// `useResolverProvider`) live in codex-ui's provider and are re-exported here so
// downstream code keeps its import path unchanged after the carve.

export { CodexProvider } from "./CodexProvider.js";
export type { CodexProviderProps } from "./CodexProvider.js";

// Generic context hooks — the store, signing-client override, and resolver
// provider all live in codex-ui's provider now; re-export the byte-stable names.
export {
  useCodexStore,
  useSigningClientOverride,
  useResolverProvider,
} from "@ancientpantheon/codex-ui/provider";
