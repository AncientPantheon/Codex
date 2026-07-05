/**
 * useCodexGuard — read the active CodexGuard's public/encrypted-private halves
 * and run the generate/rotate actions (v0.3.0+).
 *
 * `activePublicKey`/`encryptedPrivateKey` are DERIVED from a subscription to
 * the `pureKeypairs` slice using the same canonical active-guard filter the
 * store getters use (`isCodexGuard === true && wasCodexGuard !== true`), so the
 * hook re-renders when `rotate()` swaps the active guard. A mid-rotation hybrid
 * (both flags) is treated as retired-not-active so the exactly-one invariant
 * holds. `generateForLegacy`/`rotate` are the store actions verbatim — they own
 * auth pre-flight, generation, and all integrity throws.
 */

import { useMemo } from "react";
import { useCodexStore } from "../provider/index.js";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

export interface CodexGuardView {
  activePublicKey: string | null;
  encryptedPrivateKey: string | null;
  generateForLegacy: () => Promise<void>;
  rotate: () => Promise<void>;
}

function activeGuardOf(pureKeypairs: IPureKeypair[]): IPureKeypair | null {
  const active = pureKeypairs.filter(
    (k) => k.isCodexGuard === true && k.wasCodexGuard !== true
  );
  return active[0] ?? null;
}

export function useCodexGuard(): CodexGuardView {
  const store = useCodexStore();
  const pureKeypairs = store((s) => s.pureKeypairs);
  const actions = store((s) => s.actions);

  const guard = useMemo(() => activeGuardOf(pureKeypairs), [pureKeypairs]);

  return {
    activePublicKey: guard?.publicKey ?? null,
    encryptedPrivateKey: guard?.encryptedPrivateKey ?? null,
    // The actions return the new/retired keypair(s); the View contract is
    // void — callers re-read the derived pubkey, not the action's return.
    generateForLegacy: async () => {
      await actions.generateCodexGuardForLegacy();
    },
    rotate: async () => {
      await actions.rotateCodexGuard();
    },
  };
}
