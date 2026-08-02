// @ancientpantheon/codex-ouronet/resolver
//
// InternalCodexResolver — implements stoa-core/signing's KeyResolver
// interface by reading from the internal Zustand codex store. Replaces
// OuronetUI's ReduxCodexResolver.
//
// Consumers don't usually import this directly — <CodexProvider> wires
// it up internally via useSignTransaction. Exposed via this subpath for
// advanced cases (custom signing pipelines, multi-codex experiments,
// etc.). Re-exporting the KeyResolver type from stoa-core saves
// consumers from a redundant import path.

export { InternalCodexResolver } from "./InternalCodexResolver.js";
export type { InternalCodexResolverOptions } from "./InternalCodexResolver.js";
export type { KeyResolver, IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";

// Headless, server-safe Kadena resolver for Khronoton automatons (Pythia,
// Mnemosyne). A pre-bound `KeyResolver` a consumer adopts binding NO `@stoachain`
// crypto itself — delegating all seedType-aware derivation to Codex's one
// canonical path. See docs/work/khronoton-headless-kadena-resolver/design.md.
export { createHeadlessKadenaResolver } from "./headlessKadenaResolver.js";
export type { HeadlessKadenaResolverOptions } from "./headlessKadenaResolver.js";
// The structural snapshot types a consumer needs to type its `loadSnapshot`
// thunk, surfaced here so it never reaches into codex-core directly.
export type {
  SnapshotSlice,
  StoaChainSeedLike,
  PureKeypairLike,
  StoaChainSeedType,
  ResolvedStoaChainKeypair,
} from "@ancientpantheon/codex-core";
