/**
 * useCodexLifecycle — codex-level kickstart / recovery actions (v0.2.0+).
 *
 * The package-owned half of the "first codex creation" flow. Consumers
 * derive keypairs upstream (DALOS via stoa-core for the prime ouro,
 * StoaChainWalletBuilder for the prime kadena seed), then call
 * `kickstart(args)` to atomically install both as the codex's prime
 * pair. The package handles isPrime flagging, parentSeedId linkage,
 * activeStoaChainWalletId / activeOuroAccountId selection, and persistence.
 *
 * Usage (OuronetUI / AncientHoldings):
 *
 *   const { kickstart } = useCodexLifecycle();
 *   const { seed, primeOuro } = await kickstart({
 *     seed: { id, name, secret, main, accounts, ... },          // pre-formed
 *     primeOuroAccount: { id, address, secret, backup, ... },   // pre-derived
 *   });
 *   // Codex now has exactly one IStoaChainSeed (isPrime: true) and one
 *   // IOuroAccount (isPrime: true, parentSeedId: seed.id). Both
 *   // structurally undeletable.
 *
 * Recovery uses the same shape:
 *
 *   const { recover } = useCodexLifecycle();
 *   await recover(args); // idempotent if codex already has the same prime
 *
 * See docs/v0.2.0-design.md §5.2 and §5.3 for the full contract.
 */

import { useCodexStore } from "../provider/index.js";
import type {
  KickstartArgs,
  KickstartResult,
} from "@ancientpantheon/codex-ouronet/state";
import type {
  KickstartArgsV3,
  KickstartResultV3,
} from "@ancientpantheon/codex-ouronet/codex-identity";

export interface CodexLifecycleView {
  /** Atomically install the codex's prime entities on an empty codex.
   *  Accepts BOTH the v0.2 pre-formed shape (`{ seed, primeOuroAccount }` →
   *  `KickstartResult`) and the v0.3 atomic shape (`{ codexIdSeed, ... }` →
   *  `KickstartResultV3`, generating ICodexIdentity + CodexGuard + CodexPrime +
   *  DuoPrime). The store dispatches by shape; callers narrow the result by the
   *  shape they passed. Throws `CodexKickstartError` on pre-flight violations. */
  kickstart: (
    args: KickstartArgs | KickstartArgsV3,
  ) => Promise<KickstartResult | KickstartResultV3>;
  /** Recovery-flow variant — allows re-installing the same prime pair
   *  on a non-empty codex (idempotent), but refuses if the existing
   *  prime has a different id. v0.2-only in v0.3.0 (PAT-002). */
  recover: (args: KickstartArgs) => Promise<KickstartResult>;
}

export function useCodexLifecycle(): CodexLifecycleView {
  const store = useCodexStore();
  const actions = store((s) => s.actions);
  return {
    kickstart: actions.kickstartCodex,
    recover: actions.recoverCodexFromMnemonic,
  };
}
