/**
 * The injected resolver-provider seam the two StoaChain-bound hooks
 * (useGetKeypair / useSignTransaction) consume at runtime.
 *
 * WHY a seam: those hooks need StoaChain crypto — keypair resolution and the
 * CodexSigningStrategy (which wires an InternalCodexResolver + a Pact client).
 * All of that is a VALUE `@stoachain` + Ouronet edge that must NOT live in this
 * chain-generic package (the D5 graph guard forbids a value chain edge in
 * codex-ui/src). So codex-ui declares only the SHAPE here and reads a concrete
 * implementation from the provider's resolver-provider context; codex-ouronet
 * supplies the real one through <CodexProvider resolverFactory={...}>.
 *
 * `CodexResolverSeam` EXTENDS the provider's `CodexResolverProvider`
 * (getKeyPairByPublicKey) with `createSigningStrategy` so the single injected
 * object serves BOTH signing hooks. It is structurally compatible with what
 * `useResolverProvider()` returns — the provider's context type is the narrower
 * `CodexResolverProvider`; this seam narrows further at the signing hooks' call
 * sites, where the injected object is known to carry `createSigningStrategy`.
 *
 * The `CodexSigningStrategy` / `IStoaChainKeypair` TYPES stay byte-stable via
 * `import type` from `@stoachain/stoa-core/signing` — erased at compile under
 * verbatimModuleSyntax, so referencing them here creates no runtime edge. The
 * seam NEVER constructs a strategy in codex-ui; it only receives one built
 * Ouronet-side behind `createSigningStrategy`.
 */

import type { CodexStore, CodexResolverProvider } from "../provider/index.js";
import type {
  IKadenaKeypair as IStoaChainKeypair,
  CodexSigningStrategy,
} from "@stoachain/stoa-core/signing";

/** Options forwarded to `createSigningStrategy` — the node-selection + foreign-
 *  key inputs the Ouronet-side strategy builder needs. All optional; the builder
 *  applies its own defaults (default Pact client, fail-fast foreign-key). */
export interface CreateSigningStrategyOptions {
  /** Optional foreign-key resolver passed into the InternalCodexResolver. */
  requestForeignKey?: (publicKey: string) => Promise<string>;
  /** Provider-level signing-client override (e.g. a CF-worker Pact proxy). */
  clientOverride?: unknown;
  /** The currently selected network node id (drives Pact URL selection). */
  selectedNode?: string;
  /** A custom node URL when the user picks the "custom" node. */
  customNodeUrl?: string;
}

/**
 * The resolver-provider seam. codex-ouronet's InternalCodexResolver (rewired
 * onto codex-core's headless resolver factory) fills it.
 */
export interface CodexResolverSeam extends CodexResolverProvider {
  /** Keypair resolution — the auth-gated `getKeyPairByPublicKey`. Narrowed here
   *  to the byte-stable `IStoaChainKeypair` return the `GetKeypairFn` View exposes
   *  (the provider context types it as `Promise<unknown>`). */
  getKeyPairByPublicKey(publicKey: string): Promise<IStoaChainKeypair>;

  /** Builds the CodexSigningStrategy for `useSignTransaction`. The whole value-
   *  level construction cluster (InternalCodexResolver + Pact client +
   *  CodexSigningStrategy) lives Ouronet-side behind this call — codex-ui never
   *  constructs any of it. */
  createSigningStrategy(
    store: CodexStore,
    options: CreateSigningStrategyOptions
  ): CodexSigningStrategy;
}
