/**
 * dualLinkOps — LOCAL Pythia dual-link operation builders (Rename + Revoke).
 *
 * The EXECUTE + INFO for the two patron-paid dual-link ops on an ALREADY-LINKED
 * pair, both authorized by BOTH half-owners (`P|TS`), both in the `TS01-C4` /
 * `PYTHIA` modules. Mirrors the local `deployApiKey.ts` seam.
 *
 *   RENAME  (ouronet-ns.TS01-C4.PYTHIA|C_UpdateDualConsumerLane patron executor dual-link-key new-name)
 *           INFO (ouronet-ns.PYTHIA.INFO_PYTHIA|UpdateDualConsumerLane patron dual-link-key new-name)  — verified, 3-arg, UNCHANGED
 *           → 100 STOA (UNDISCOUNTED), a 4-way split (same shape as account
 *             activation): `info.kadena["kadena-targets"]` (4 accounts) +
 *             `["kadena-split"]` (4 amounts) resolved to k:/c: receivers via
 *             `DALOS.UR_AccountStoa` — costs + receivers come from the chain, so
 *             they never drift when the on-chain price/targets change.
 *
 *   REVOKE  (ouronet-ns.TS01-C4.PYTHIA|C_RevokeLink patron executor dual-link-key)
 *           INFO (ouronet-ns.PYTHIA.INFO_PYTHIA|RevokeLink patron dual-link-key)  — confirmed 2026-09-26, see below
 *           → IGNIS-only (1 unit, or 0 when virtual gas is zero); no STOA split.
 *
 * `executor` (chain-symbol handoff, 2026-09-25) — both EXECUTE calls above
 * were one argument short of their declared arity (`patron, executor,
 * dual-link-key[, new-name]` per StoicSyntax-Prefixes.md §2.2). This build
 * passes the Standard half's DALOS owner (`standardOwner`, threaded in from
 * each modal's own props), the same choice `linkDualApiKey.ts` documents for
 * `C_Link`. CONFIRMED 2026-09-26 via `describe-module "ouronet-ns.TS01-C4"`
 * against mainnet: `PythiaV5.C_RevokeDualLink` / `C_UpdateDualConsumerLane`'s
 * own doc comments both say their `executor` "is bound by
 * `UEV_ExecutorIsHalfOwner`... as a DISJUNCTION" — either half-owner is
 * valid, so `standardOwner` is a confirmed-correct choice, not a guess.
 *
 * The Revoke INFO read, previously left unresolved ("REMOVED entirely" —
 * neither `PYTHIA.PYTHIA|INFO_UnlinkDualApiKey` nor
 * `PYTHIA.INFO_PYTHIA|UnlinkDualApiKey` exist), is now CONFIRMED: the real
 * name is `INFO_PYTHIA|RevokeLink`, a 2-arg `(patron dual-link-key)` read —
 * the SAME 2 args already being sent, just under the wrong function name
 * (found via the same `describe-module` dump, `"ouronet-ns.PYTHIA"`).
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

/** Full INFO for the rename — reads `INFO_PYTHIA|UpdateDualConsumerLane` AND
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
      `  ((info (${KADENA_NAMESPACE}.PYTHIA.INFO_PYTHIA|UpdateDualConsumerLane ${S(patron)} ${S(dualLinkKey)} ${S(newName)}))` +
      `   (receivers (map (${KADENA_NAMESPACE}.DALOS.UR_AccountStoa) (at "kadena-targets" (at "kadena" info)))))` +
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
    const pactCode = `(${KADENA_NAMESPACE}.PYTHIA.INFO_PYTHIA|UpdateDualConsumerLane ${S(patron)} ${S(dualLinkKey)} ${S(newName)})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return response.result.data ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The rename EXECUTE Pact code. `executor` — see module doc comment
 *  (CONFIRMED valid: either half-owner, per `UEV_ExecutorIsHalfOwner`); a
 *  SEPARATE param from the 3-arg `RenameDualLaneParams` the (unchanged) INFO
 *  reads above use, since only the EXECUTE call's declared arity grew. */
export function buildRenameDualLanePactCode(p: RenameDualLaneParams & { executor: string }): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.PYTHIA|C_UpdateDualConsumerLane ${S(p.patron)} ${S(p.executor)} ${S(p.dualLinkKey)} ${S(p.newName)})`;
}

// ── Revoke (kill-switch) — patron pays 1 IGNIS, no STOA split ────────────────

export interface RevokeDualLinkParams {
  patron: string;
  dualLinkKey: string;
}

/** INFO for the revoke — `PYTHIA.INFO_PYTHIA|RevokeLink` (IGNIS cost, no STOA
 *  split). Returned for the FunctionInfoZone + the ignis-need read. */
export async function getRevokeDualLinkInfoOnly(p: RevokeDualLinkParams): Promise<any | null> {
  const { patron, dualLinkKey } = p;
  if (!patron || !dualLinkKey) return null;
  try {
    const pactCode = `(${KADENA_NAMESPACE}.PYTHIA.INFO_PYTHIA|RevokeLink ${S(patron)} ${S(dualLinkKey)})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return response.result.data ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The revoke EXECUTE Pact code. `executor` — see module doc comment
 *  (CONFIRMED valid: either half-owner, per `UEV_ExecutorIsHalfOwner`). */
export function buildRevokeDualLinkPactCode(p: RevokeDualLinkParams & { executor: string }): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.PYTHIA|C_RevokeLink ${S(p.patron)} ${S(p.executor)} ${S(p.dualLinkKey)})`;
}
