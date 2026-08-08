/**
 * dualLinkOps — LOCAL Pythia dual-link operation builders (Rename + Revoke).
 *
 * The EXECUTE + INFO for the two patron-paid dual-link ops on an ALREADY-LINKED
 * pair, both authorized by BOTH half-owners (`P|TS`), both in the `TS01-C4` /
 * `PYTHIA` modules. Mirrors the local `deployApiKey.ts` seam.
 *
 *   RENAME  (ouronet-ns.TS01-C4.PYTHIA|C_UpdateDualConsumerLane patron dual-link-key new-name)
 *           INFO (ouronet-ns.PYTHIA.PYTHIA|INFO_UpdateDualConsumerLane patron dual-link-key new-name)
 *           → 100 STOA (UNDISCOUNTED), a 4-way split (same shape as account
 *             activation): `info.kadena["kadena-targets"]` (4 accounts) +
 *             `["kadena-split"]` (4 amounts) resolved to k:/c: receivers via
 *             `DALOS.UR_AccountKadena` — costs + receivers come from the chain, so
 *             they never drift when the on-chain price/targets change.
 *
 *   REVOKE  (ouronet-ns.TS01-C4.PYTHIA|C_RevokeLink patron dual-link-key)
 *           INFO (ouronet-ns.PYTHIA.PYTHIA|INFO_UnlinkDualApiKey patron dual-link-key)
 *           → IGNIS-only (1 unit, or 0 when virtual gas is zero); no STOA split.
 */

import { pactRead } from "@stoachain/stoa-core/reads";
import { KADENA_NAMESPACE } from "@ouronet/ouronet-core/constants";

/** Pact string literal — escapes `"` / `\` so a user-typed lane can't break/inject. */
const S = (s: string): string => JSON.stringify(s);

// ── Rename (consumer-lane) — patron pays 100 STOA, 4-way split ───────────────

export interface RenameDualLaneParams {
  patron: string;
  dualLinkKey: string;
  newName: string;
}

/** `{ info, receivers }` — the INFO object + its resolved k:/c: split targets. */
export interface RenameDualLaneFullInfo {
  info: any | null;
  receivers: string[];
}

/** Full INFO for the rename — reads `PYTHIA|INFO_UpdateDualConsumerLane` AND
 *  resolves the STOA-split target accounts to their k:/c: payment addresses in one
 *  `let*` (mirror of `getDeployApiKeyInfo`). */
export async function getRenameDualLaneInfo(
  p: RenameDualLaneParams,
): Promise<RenameDualLaneFullInfo | null> {
  const { patron, dualLinkKey, newName } = p;
  if (!patron || !dualLinkKey || !newName) return null;
  try {
    const pactCode =
      `(let*` +
      `  ((info (${KADENA_NAMESPACE}.PYTHIA.PYTHIA|INFO_UpdateDualConsumerLane ${S(patron)} ${S(dualLinkKey)} ${S(newName)}))` +
      `   (receivers (map (${KADENA_NAMESPACE}.DALOS.UR_AccountKadena) (at "kadena-targets" (at "kadena" info)))))` +
      `  { "info": info, "receivers": receivers })`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      const data = response.result.data;
      return { info: data?.info ?? null, receivers: data?.receivers ?? [] };
    }
    return null;
  } catch {
    return null;
  }
}

/** INFO-only read (no receiver resolution) — the `FunctionInfoZone` fetcher. */
export async function getRenameDualLaneInfoOnly(p: RenameDualLaneParams): Promise<any | null> {
  const { patron, dualLinkKey, newName } = p;
  if (!patron || !dualLinkKey || !newName) return null;
  try {
    const pactCode = `(${KADENA_NAMESPACE}.PYTHIA.PYTHIA|INFO_UpdateDualConsumerLane ${S(patron)} ${S(dualLinkKey)} ${S(newName)})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return response.result.data ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The rename EXECUTE Pact code. */
export function buildRenameDualLanePactCode(p: RenameDualLaneParams): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.PYTHIA|C_UpdateDualConsumerLane ${S(p.patron)} ${S(p.dualLinkKey)} ${S(p.newName)})`;
}

// ── Revoke (kill-switch) — patron pays 1 IGNIS, no STOA split ────────────────

export interface RevokeDualLinkParams {
  patron: string;
  dualLinkKey: string;
}

/** INFO for the revoke — `PYTHIA|INFO_UnlinkDualApiKey` (IGNIS cost, no STOA
 *  split). Returned for the FunctionInfoZone + the ignis-need read. */
export async function getRevokeDualLinkInfoOnly(p: RevokeDualLinkParams): Promise<any | null> {
  const { patron, dualLinkKey } = p;
  if (!patron || !dualLinkKey) return null;
  try {
    const pactCode = `(${KADENA_NAMESPACE}.PYTHIA.PYTHIA|INFO_UnlinkDualApiKey ${S(patron)} ${S(dualLinkKey)})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return response.result.data ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The revoke EXECUTE Pact code. */
export function buildRevokeDualLinkPactCode(p: RevokeDualLinkParams): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.PYTHIA|C_RevokeLink ${S(p.patron)} ${S(p.dualLinkKey)})`;
}
