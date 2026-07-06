/**
 * The Ouronet-side resolver-provider seam that fills codex-ui's `resolverFactory`
 * prop. codex-ui's two StoaChain-bound hooks (useGetKeypair / useSignTransaction)
 * read this object from the provider's resolver-provider context and call:
 *
 *   - `getKeyPairByPublicKey(pub)` — the auth-gated keypair resolution
 *     (useGetKeypair), delegated verbatim to the rewired InternalCodexResolver.
 *   - `createSigningStrategy(store, opts)` — the whole signing-cluster
 *     construction (InternalCodexResolver + Pact client + CodexSigningStrategy)
 *     that codex-ouronet's old `useSignTransaction` used to assemble inline. It
 *     now lives here so codex-ui holds NO value @stoachain edge.
 *
 * This is the concrete implementation of codex-ui's `CodexResolverSeam` — the
 * single injected object that serves BOTH signing hooks. It carries the value
 * @stoachain edge (createClient / getPactUrl / CodexSigningStrategy) the generic
 * package forbids, so it stays Ouronet-side and flows in through the seam.
 */

import { createClient } from "@stoachain/kadena-stoic-legacy/client";
import { CodexSigningStrategy } from "@stoachain/stoa-core/signing";
import { getPactUrl, KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID } from "@stoachain/stoa-core/constants";
import { setNodeConfig } from "@stoachain/stoa-core/network";
import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";

import type { CodexStore } from "../state/index.js";
import { InternalCodexResolver } from "./InternalCodexResolver.js";

/** Options the strategy builder accepts — the node-selection + foreign-key
 *  inputs codex-ui's `useSignTransaction` forwards through the seam. Kept loose
 *  (`clientOverride`/`selectedNode`/`customNodeUrl`) to match codex-ui's
 *  `CreateSigningStrategyOptions` structurally without importing it (no reverse
 *  value edge). */
export interface OuronetSigningStrategyOptions {
  requestForeignKey?: (publicKey: string) => Promise<string>;
  clientOverride?: unknown;
  selectedNode?: string;
  customNodeUrl?: string;
}

/**
 * The resolver-provider seam object. `getKeyPairByPublicKey` delegates to the
 * per-store InternalCodexResolver (auth gate + factory-backed decrypt);
 * `createSigningStrategy` composes the full StoaChain signing cluster.
 */
export interface OuronetResolverProvider {
  getKeyPairByPublicKey(publicKey: string): Promise<IStoaChainKeypair>;
  createSigningStrategy(
    store: CodexStore,
    options: OuronetSigningStrategyOptions
  ): CodexSigningStrategy;
}

/**
 * Builds the resolver-provider seam bound to a mounted store. codex-ui's
 * `<CodexProvider resolverFactory={...}>` calls this once per store; the two
 * signing hooks then read the returned object from context.
 */
export function createOuronetResolverProvider(
  store: CodexStore
): OuronetResolverProvider {
  const resolver = new InternalCodexResolver(store);

  return {
    getKeyPairByPublicKey(publicKey: string): Promise<IStoaChainKeypair> {
      return resolver.getKeyPairByPublicKey(publicKey);
    },

    createSigningStrategy(
      strategyStore: CodexStore,
      options: OuronetSigningStrategyOptions
    ): CodexSigningStrategy {
      // Same construction the pre-carve `useSignTransaction` did inline: a
      // per-strategy resolver (so the foreign-key callback is honoured) + the
      // provider's signing-client override, or the lazy default client keyed on
      // the selected node.
      const strategyResolver = new InternalCodexResolver(strategyStore, {
        requestForeignKey: options.requestForeignKey,
      });

      // Apply the selected node to stoa-core's failover global BEFORE reading the
      // Pact URL. This is what actually routes the node URL: `getPactUrl` (used
      // here for signing AND by the Accounts-tab balance reads) reads the same
      // module-global active host that `setNodeConfig` mutates, so one call
      // redirects both. Pre-Phase-3 these fields were forwarded but never
      // applied, pinning every read/signature to the node2 default regardless of
      // the user's selection. Omitting selectedNode leaves the global untouched
      // (node2 default) — backward-compatible with callers that never forwarded
      // the node fields.
      // A "custom" selection with no URL yet (the UI can flip the toggle before
      // the user types one — customNodeUrl defaults to "") must NOT reach
      // setNodeConfig: it throws a TypeError on an empty custom URL and would
      // crash strategy construction. Treat that as "no custom node yet" and
      // leave the default global in place.
      const hasCustomUrl =
        typeof options.customNodeUrl === "string" &&
        options.customNodeUrl.length > 0;
      if (options.selectedNode === "custom" ? hasCustomUrl : !!options.selectedNode) {
        setNodeConfig(
          options.selectedNode as "node1" | "node2" | "custom",
          options.customNodeUrl,
        );
      }

      const pactClient =
        options.clientOverride ?? createClient(getPactUrl(STOACHAIN_CHAIN_ID));
      return new CodexSigningStrategy(strategyResolver, pactClient as never);
    },
  };
}
