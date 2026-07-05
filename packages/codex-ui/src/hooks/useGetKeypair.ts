/**
 * useGetKeypair — returns a stable async function (pub) => IKadenaKeypair.
 *
 * THE function that OuronetUI's wallet-context exposes today as
 * `getKadenaKeyPairsByPublicKey`. It delegates to the INJECTED
 * resolver-provider seam (codex-ouronet's InternalCodexResolver, supplied via
 * <CodexProvider resolverFactory={...}>) — codex-ui holds NO real resolver and
 * NO value @stoachain edge. The seam throws CodexLockedError when the codex is
 * locked and CodexKeyMissingError when the pubkey isn't in the codex.
 *
 * The returned function is memoised against the seam identity — stable across
 * renders, so consumers can pass it to useEffect deps without triggering
 * infinite loops.
 */

import { useMemo } from "react";
import type { IKadenaKeypair } from "@stoachain/stoa-core/signing";
import { useResolverProvider } from "../provider/index.js";
import type { CodexResolverSeam } from "./seams.js";

export type GetKeypairFn = (publicKey: string) => Promise<IKadenaKeypair>;

export function useGetKeypair(): GetKeypairFn {
  const seam = useResolverProvider() as CodexResolverSeam | null;
  return useMemo(() => {
    return (publicKey: string): Promise<IKadenaKeypair> => {
      if (!seam) {
        throw new Error(
          "useGetKeypair: no resolver-provider. Pass a `resolverFactory` to " +
            "<CodexProvider> so the Kadena-bound hooks can resolve keypairs."
        );
      }
      return seam.getKeyPairByPublicKey(publicKey);
    };
  }, [seam]);
}
