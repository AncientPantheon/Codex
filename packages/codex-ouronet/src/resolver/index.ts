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
export type { KeyResolver, IKadenaKeypair } from "@stoachain/stoa-core/signing";
