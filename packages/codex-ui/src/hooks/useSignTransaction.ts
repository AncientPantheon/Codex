/**
 * useSignTransaction — CFM strategy wrapper.
 *
 * Replaces OuronetUI's useCFMStrategy hook. In codex-ouronet this hook itself
 * constructed the whole signing cluster (InternalCodexResolver + a Pact client
 * from kadena-stoic-legacy's createClient(getPactUrl) + a CodexSigningStrategy).
 * That is a VALUE @stoachain edge the D5 carve forbids in this chain-generic
 * package, so the ENTIRE construction moves behind the injected resolver-provider
 * seam: `useSignTransaction` calls `seam.createSigningStrategy(store, opts)` and
 * returns the strategy the Ouronet-side builder produced. codex-ui constructs
 * nothing chain-bound and holds no value @stoachain import.
 *
 * The composed CodexSigningStrategy is memoised against:
 *   - seam identity (rebuilt across provider remounts)
 *   - store identity
 *   - selectedNode + customNodeUrl (rebuilt when user switches node)
 *   - the requestForeignKey option + the client override
 *
 * Same memo-invalidation rule OuronetUI's useCFMStrategy uses; without it, an
 * open modal would stay pinned to whichever node was active when it mounted.
 *
 * The `CodexSigningStrategy` / `PactClient` types stay byte-stable via type-only
 * imports from @stoachain/stoa-core/signing (erased at compile — no runtime edge).
 */

import { useMemo } from "react";
import type { CodexSigningStrategy } from "@stoachain/stoa-core/signing";

import {
  useCodexStore,
  useSigningClientOverride,
  useResolverProvider,
} from "../provider/index.js";
import type { CodexResolverSeam } from "./seams.js";

export interface UseSignTransactionOptions {
  /** Optional foreign-key resolver — forwarded to the injected strategy
   *  builder. Default (omitted) makes foreign-key signing fail-fast. */
  requestForeignKey?: (publicKey: string) => Promise<string>;
}

export interface SignTransactionView {
  /** The composed CodexSigningStrategy. Exposed for consumers needing
   *  lower-level access (the package's own components use it directly). */
  strategy: CodexSigningStrategy;
  /** Convenience pass-through to strategy.execute. Stable identity. */
  execute: CodexSigningStrategy["execute"];
  /** Convenience pass-through to strategy.sign. Stable identity. */
  sign: CodexSigningStrategy["sign"];
}

export function useSignTransaction(
  options: UseSignTransactionOptions = {}
): SignTransactionView {
  const store = useCodexStore();
  const clientOverride = useSigningClientOverride();
  const seam = useResolverProvider() as CodexResolverSeam | null;
  // Subscribe to node-related uiSettings so the strategy rebuilds when the user
  // switches node. The actual node URL is resolved Ouronet-side inside the
  // injected builder; the hook just re-invokes the seam when these change.
  const selectedNode = store((s) => s.uiSettings.selectedNode);
  const customNodeUrl = store((s) => s.uiSettings.customNodeUrl);
  const requestForeignKey = options.requestForeignKey;

  const strategy = useMemo(() => {
    if (!seam) {
      throw new Error(
        "useSignTransaction: no resolver-provider. Pass a `resolverFactory` to " +
          "<CodexProvider> so the signing strategy can be built."
      );
    }
    // The whole strategy-construction cluster (resolver + Pact client + strategy)
    // lives Ouronet-side behind this call. selectedNode + customNodeUrl rebuild
    // the memo so swapping nodes mid-session takes effect on next execute().
    return seam.createSigningStrategy(store, {
      requestForeignKey,
      clientOverride,
      selectedNode,
      customNodeUrl,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seam, store, selectedNode, customNodeUrl, requestForeignKey, clientOverride]);

  // execute/sign are bound to the strategy instance — pre-bind so callers can
  // destructure without losing `this`.
  return useMemo(
    () => ({
      strategy,
      execute: strategy.execute.bind(strategy),
      sign: strategy.sign.bind(strategy),
    }),
    [strategy]
  );
}
