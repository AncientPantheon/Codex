/**
 * linkDualApiKey — LOCAL Pythia dual-link (Standard+Smart) builders.
 *
 * The EXECUTE + INFO for `PYTHIA|C_Link` — linking a deployed Standard (₱.) half
 * to a deployed Smart (Π.) half into an INACTIVE dual row, authorized by BOTH
 * half-owners, NO fee (Cronoton activates later after off-chain ownership proof).
 * Mirrors the local `deployApiKey.ts` seam until `@ouronet/ouronet-core` ships
 * these builders.
 *
 * on-chain surface (4 string args — chain-symbol handoff, 2026-09-25: the
 * package previously sent only 3, one short of the declared arity; `executor`
 * is the NEW first arg, args 2–3 auto-filled from the two picked Apollo
 * halves, arg 4 is the user-typed consumer lane):
 *   EXECUTE  (ouronet-ns.TS01-C4.PYTHIA|C_Link  executor standard-apollo smart-apollo consumer-lane)
 *   INFO     (ouronet-ns.PYTHIA.INFO_PYTHIA|Link                 standard-apollo smart-apollo consumer-lane)
 *
 * Both CONFIRMED 2026-09-26 via `describe-module "ouronet-ns.TS01-C4"` /
 * `"ouronet-ns.PYTHIA"` against mainnet (full module source, chain 0):
 *   - EXECUTE's `executor` value: `PythiaV5.C_LinkDualApiKey`'s own doc
 *     comment says it "is bound by UEV_ExecutorIsHalfOwner inside
 *     PYTHIA|C>LINK-DUAL" — a DISJUNCTION over EITHER half-owner, so the
 *     Standard half's DALOS owner (`standardOwner`, this build's choice) is
 *     a confirmed-valid executor, not a guess.
 *   - INFO's real name is `INFO_PYTHIA|Link`, a 3-arg
 *     `(standard-apollo smart-apollo consumer-lane)` read — NEITHER of the
 *     two previously-tried names (`INFO_PYTHIA|LinkDualApiKey`,
 *     `PYTHIA|INFO_LinkDualApiKey`) exist on chain ("no such member" on
 *     both, confirmed live); this was the SAME 3 args already being sent,
 *     just under the wrong function name.
 */

import { pactRead } from "@stoachain/stoa-core/reads";
import { buildCall, buildPreviewCall } from "@ouronet/talos-registry";

/** The EXECUTE entrypoint key — `TS01-C4.PYTHIA|C_Link`. Its own `.preview`
 *  (resolved internally by `buildPreviewCall`) is `PYTHIA.INFO_PYTHIA|Link`. */
export const LINK_DUAL_API_KEY_KEY = "TS01-C4.PYTHIA|C_Link";

export interface LinkDualApiKeyParams {
  /** The account whose ownership authorizes this call — either half-owner is
   *  valid (`UEV_ExecutorIsHalfOwner` disjunction, see module doc). */
  executor: string;
  /** The Standard ₱. half (auto-filled from the picked Standard half). */
  standardApollo: string;
  /** The Smart Π. half (auto-filled from the picked Smart half). */
  smartApollo: string;
  /** The consumer lane label — the ONLY user-typed field. */
  consumerLane: string;
}

/** The EXECUTE Pact code — `(…TS01-C4.PYTHIA|C_Link executor std smt lane)`.
 *  Authorized by both half-owners' ownership guards; no STOA/IGNIS fee. */
export function buildLinkDualApiKeyPactCode(p: LinkDualApiKeyParams): string {
  return buildCall(LINK_DUAL_API_KEY_KEY, {
    executor: p.executor,
    "standard-apollo": p.standardApollo,
    "smart-apollo": p.smartApollo,
    "consumer-lane": p.consumerLane,
  });
}

/** The preview Pact code — `(…PYTHIA.INFO_PYTHIA|Link std smt lane)`. Live-
 *  confirmed 3-arg shape (no `executor` — that's EXEC-only, see module doc). */
export function buildLinkDualApiKeyPreview(
  p: Pick<LinkDualApiKeyParams, "standardApollo" | "smartApollo" | "consumerLane">,
): string {
  return buildPreviewCall(LINK_DUAL_API_KEY_KEY, {
    "standard-apollo": p.standardApollo,
    "smart-apollo": p.smartApollo,
    "consumer-lane": p.consumerLane,
  });
}

/** INFO read — `PYTHIA.INFO_PYTHIA|Link` → `object{OuronetInfoV2.ClientInfo}`
 *  (the no-cost ClientInfo the FunctionInfoZone renders). Returns null on any
 *  failure / missing args. `consumerLane` may be empty for a live preview. */
export async function getLinkDualApiKeyInfo(p: LinkDualApiKeyParams): Promise<any | null> {
  const { standardApollo, smartApollo, consumerLane } = p;
  if (!standardApollo || !smartApollo) return null;
  try {
    const pactCode = buildLinkDualApiKeyPreview({ standardApollo, smartApollo, consumerLane });
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return response.result.data ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
