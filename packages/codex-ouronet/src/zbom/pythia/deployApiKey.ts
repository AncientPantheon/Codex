/**
 * deployApiKey — LOCAL Pythia API-key deploy builders (interim seam).
 *
 * The deploy + INFO are the Apollo→Pythia equivalents of ouronet-core's StoicTag
 * builders, authored HERE (codex-ouronet) against the LIVE PYTHIA Pact surface
 * until `@stoachain/ouronet-core` ships them. When it does, delete this file and
 * re-point `ActivateApolloPythiaKeyModal` at the package.
 *
 * FINALIZED on-chain surface (4 args — no consumer-lane; ONE ungated function
 * for both Standard ₱. and Smart Π.; the curve is encoded in the apollo account):
 *   EXECUTE  (ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey  patron owner-account apollo-account public)
 *   INFO     (ouronet-ns.PYTHIA.PYTHIA|INFO_DeployApiKey patron owner-account apollo-account public)
 *
 * Arg semantics: `patron` pays (standard patron procedure — patron ownership);
 * `owner-account` = the selected Ouronet account (its ownership signs);
 * `apollo-account` = the Apollo being deployed; `public` = its public key.
 */

import { pactRead } from "@stoachain/stoa-core/reads";
import { KADENA_NAMESPACE } from "@stoachain/ouronet-core/constants";

/** The 4 args the deploy + INFO take (no consumer-lane — the contract no longer
 *  needs any user-typed input). */
export interface DeployApiKeyParams {
  /** Pays gas + the STOA split (PatronZone → payment key). */
  patron: string;
  /** The selected Ouronet (DALOS) account whose ownership is enforced. */
  ownerAccount: string;
  /** The Apollo account being deployed (₱. standard / Π. smart). */
  apolloAccount: string;
  /** The Apollo account's public key. */
  publicKey: string;
}

/** `{ info, receivers }` — the INFO object + its resolved k:/c: split targets. */
export interface DeployApiKeyFullInfo {
  info: any | null;
  receivers: string[];
}

/**
 * Full INFO for a Pythia deploy — reads `PYTHIA|INFO_DeployApiKey` AND resolves
 * the STOA-split target accounts (`kadena.kadena-targets`) to their k:/c:
 * payment addresses in one `let*` read (mirror of `getRegisterStoicTagInfo`).
 * `info.kadena.kadena-split` = amounts; used for the patron's `coin.TRANSFER`.
 */
export async function getDeployApiKeyInfo(
  p: DeployApiKeyParams,
): Promise<DeployApiKeyFullInfo | null> {
  const { patron, ownerAccount, apolloAccount, publicKey } = p;
  if (!patron || !ownerAccount || !apolloAccount || !publicKey) return null;
  try {
    const pactCode =
      `(let*` +
      `  ((info (${KADENA_NAMESPACE}.PYTHIA.PYTHIA|INFO_DeployApiKey "${patron}" "${ownerAccount}" "${apolloAccount}" "${publicKey}"))` +
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
export async function getDeployApiKeyInfoOnly(
  p: DeployApiKeyParams,
): Promise<any | null> {
  const { patron, ownerAccount, apolloAccount, publicKey } = p;
  if (!patron || !ownerAccount || !apolloAccount || !publicKey) return null;
  try {
    const pactCode = `(${KADENA_NAMESPACE}.PYTHIA.PYTHIA|INFO_DeployApiKey "${patron}" "${ownerAccount}" "${apolloAccount}" "${publicKey}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return response.result.data ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The deploy Pact code — `(…TS01-C4.PYTHIA|C_DeployApiKey …)`. ONE ungated
 *  function for both Standard ₱. and Smart Π. (the curve rides in the apollo
 *  account). Mirror of `buildRegisterStoicTagPactCode`. */
export function buildDeployApiKeyPactCode(p: DeployApiKeyParams): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.PYTHIA|C_DeployApiKey "${p.patron}" "${p.ownerAccount}" "${p.apolloAccount}" "${p.publicKey}")`;
}

// ── Registration status read — the `PYTHIA|S|ApiKey` row for an Apollo half ──

/** The on-chain `PYTHIA|S|ApiKey` row (table key = apollo-account). Field names
 *  are the Pact schema names (hyphenated). `counterpart` is `"BAR"` until the
 *  pair is linked. `registered-at`/`updated-at` are Pact `time` values. */
export interface ApiKeyRow {
  public: string;
  counterpart: string;
  "owner-account": string;
  "registered-at": unknown;
  "updated-at": unknown;
  "apollo-account": string;
}

/** Reads `ouronet-ns.PYTHIA.UR_ApiKeyRowOrNull` for a SINGLE Apollo account.
 *  Prefer the batch `getApiKeySelectorData` for lists — this is a fallback. */
export async function getApiKeyRow(apolloAccount: string): Promise<ApiKeyRow | null> {
  if (!apolloAccount) return null;
  try {
    const pactCode = `(${KADENA_NAMESPACE}.PYTHIA.UR_ApiKeyRowOrNull "${apolloAccount}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return (response.result.data as ApiKeyRow) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** BATCH registration read — `ouronet-ns.DPL-UR.URC_0031 [apollo…]` — returns one
 *  entry per input, IN ORDER (index-aligned with `apolloAccounts`). ONE chain
 *  read for all Apollo accounts (mirrors `getAccountSelectorData`). Entries for
 *  unregistered Apollos come back flagged (not null); the caller decides
 *  registered-ness (a real row carries a non-empty `owner-account`). */
export async function getApiKeySelectorData(
  apolloAccounts: string[],
): Promise<Array<ApiKeyRow | null>> {
  if (!apolloAccounts.length) return [];
  try {
    const list = apolloAccounts.map((a) => `"${a}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0031 [${list}])`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return (response.result.data as Array<ApiKeyRow | null>) ?? [];
    }
    return [];
  } catch {
    return [];
  }
}

/** Is an Apollo's selector/row registered on-chain? A deployed key always carries
 *  a non-empty `owner-account`; an explicit `iz-registered:false` (if the mapper
 *  emits one) also counts as not-registered. */
export function isApiKeyRegistered(row: ApiKeyRow | null | undefined): boolean {
  if (!row) return false;
  if ((row as any)["iz-registered"] === false) return false;
  const owner = row["owner-account"];
  return typeof owner === "string" && owner.length > 0;
}
