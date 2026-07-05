/**
 * useCodexIdentity — read the codex's double-Apollo identity (v0.3.0+) and
 * build the unsigned on-chain registration tx.
 *
 * Thin wrapper: subscribes directly to the `codexIdentity` slice (NOT the
 * getter) so a component re-renders when kickstart/migration sets it, and
 * exposes `buildRegisterCodexIdentityTx` verbatim — the action does the
 * identity + active-CodexGuard integrity checks and throws on its own.
 */

import { useCodexStore } from "../provider/index.js";
import type { ICodexIdentity } from "@ancientpantheon/codex-ouronet/types";
import type { UnsignedPactTx } from "@ancientpantheon/codex-ouronet/state";

export interface CodexIdentityView {
  identity: ICodexIdentity | null;
  buildRegisterTx: (opts?: { registeredBy?: string }) => UnsignedPactTx;
}

export function useCodexIdentity(): CodexIdentityView {
  const store = useCodexStore();
  // Direct slice subscription — the state slot is undefined for fresh/legacy
  // codices; coalesce to null at the public boundary (matching the getter).
  const identity = store((s) => s.codexIdentity) ?? null;
  const actions = store((s) => s.actions);

  return {
    identity,
    buildRegisterTx: actions.buildRegisterCodexIdentityTx,
  };
}
