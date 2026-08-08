/**
 * linkDualApiKey — LOCAL Pythia dual-link (Standard+Smart) builders.
 *
 * The EXECUTE + INFO for `PYTHIA|C_Link` — linking a deployed Standard (₱.) half
 * to a deployed Smart (Π.) half into an INACTIVE dual row, authorized by BOTH
 * half-owners, NO fee (Cronoton activates later after off-chain ownership proof).
 * Mirrors the local `deployApiKey.ts` seam until `@ouronet/ouronet-core` ships
 * these builders.
 *
 * FINALIZED on-chain surface (3 string args; args 1–2 auto-filled from the two
 * picked Apollo halves, arg 3 is the user-typed consumer lane):
 *   EXECUTE  (ouronet-ns.TS01-C4.PYTHIA|C_Link           standard-apollo smart-apollo consumer-lane)
 *   INFO     (ouronet-ns.PYTHIA.PYTHIA|INFO_LinkDualApiKey standard-apollo smart-apollo consumer-lane)
 */

import { pactRead } from "@stoachain/stoa-core/reads";
import { KADENA_NAMESPACE } from "@ouronet/ouronet-core/constants";

/** Encode a JS string as a Pact string literal — escapes `"` / `\` / control
 *  chars so a user-typed consumer lane (or any Apollo id) can't break or inject
 *  into the Pact code. JSON string escaping is a valid Pact string literal. */
function pactStr(s: string): string {
  return JSON.stringify(s);
}

export interface LinkDualApiKeyParams {
  /** The Standard ₱. half (auto-filled from the picked Standard half). */
  standardApollo: string;
  /** The Smart Π. half (auto-filled from the picked Smart half). */
  smartApollo: string;
  /** The consumer lane label — the ONLY user-typed field. */
  consumerLane: string;
}

/** The EXECUTE Pact code — `(…TS01-C4.PYTHIA|C_Link std smt lane)`. Authorized by
 *  both half-owners' ownership guards; no STOA/IGNIS fee. */
export function buildLinkDualApiKeyPactCode(p: LinkDualApiKeyParams): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.PYTHIA|C_Link ${pactStr(p.standardApollo)} ${pactStr(p.smartApollo)} ${pactStr(p.consumerLane)})`;
}

/** INFO read — `PYTHIA.PYTHIA|INFO_LinkDualApiKey` → `object{OuronetInfoV1.ClientInfo}`
 *  (the no-cost ClientInfo the FunctionInfoZone renders). Returns null on any
 *  failure / missing args. `consumerLane` may be empty for a live preview. */
export async function getLinkDualApiKeyInfo(p: LinkDualApiKeyParams): Promise<any | null> {
  const { standardApollo, smartApollo, consumerLane } = p;
  if (!standardApollo || !smartApollo) return null;
  try {
    const pactCode = `(${KADENA_NAMESPACE}.PYTHIA.PYTHIA|INFO_LinkDualApiKey ${pactStr(standardApollo)} ${pactStr(smartApollo)} ${pactStr(consumerLane)})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return response.result.data ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
