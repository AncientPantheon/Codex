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
 *   EXECUTE  (ouronet-ns.TS01-C4.PYTHIA|C_Link            executor standard-apollo smart-apollo consumer-lane)
 *   INFO     (ouronet-ns.PYTHIA.INFO_PYTHIA|LinkDualApiKey executor standard-apollo smart-apollo consumer-lane)  — UNVERIFIED, see linkDualApiKeyModal.tsx
 *
 * `executor` VALUE — NOT independently chain-verified (arity/typecheck can't
 * catch a wrong-but-same-typed account swapped in): the handoff that flagged
 * this bug explicitly could not resolve `C_Link`'s exact on-chain signature
 * beyond its declared param COUNT + first-param NAME ("executor, not
 * patron — the one deliberately free operation in the system"). This build
 * passes the Standard half's DALOS owner (`standardOwner`, already a prop on
 * `LinkDualApiKeyModal` and consistently treated as the "first"/canonical
 * half elsewhere in this file family — e.g. `DUAL_LINK_BAR`'s own "Standard
 * comes FIRST" convention in `deployApiKey.ts`) as the best-justified
 * candidate. VERIFY against the actual Pact contract source before this
 * executes a real mainnet transaction.
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
  /** The account whose ownership authorizes this call (see module doc — value
   *  choice UNVERIFIED against the contract source). */
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
  return `(${KADENA_NAMESPACE}.TS01-C4.PYTHIA|C_Link ${pactStr(p.executor)} ${pactStr(p.standardApollo)} ${pactStr(p.smartApollo)} ${pactStr(p.consumerLane)})`;
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
