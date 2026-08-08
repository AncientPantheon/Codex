/**
 * deployApiKey — LOCAL Pythia API-key deploy builders (interim seam).
 *
 * The deploy + INFO are the Apollo→Pythia equivalents of ouronet-core's StoicTag
 * builders, authored HERE (codex-ouronet) against the LIVE PYTHIA Pact surface
 * until `@ouronet/ouronet-core` ships them. When it does, delete this file and
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
import { KADENA_NAMESPACE } from "@ouronet/ouronet-core/constants";

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
  /** Explicit registration flag the mapper emits (verified live). */
  "is-registered"?: boolean;
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

/** Is an Apollo's selector/row registered (deployed) on-chain? The mapper emits an
 *  explicit `is-registered` boolean (verified live); prefer it. Fallback: a
 *  deployed key always carries a non-empty `owner-account`. */
export function isApiKeyRegistered(row: ApiKeyRow | null | undefined): boolean {
  if (!row) return false;
  const flag = (row as { "is-registered"?: unknown })["is-registered"];
  if (typeof flag === "boolean") return flag;
  const owner = row["owner-account"];
  return typeof owner === "string" && owner.length > 0;
}

// ── Dual-link (Standard|Smart composite) reads + Pythia pricing ──────────────

/** The APOLLO account prefixes: ₱. (standard, U+20B1) / Π. (smart, U+03A0). A
 *  linked half's `counterpart` is the OTHER half's Apollo account — so it always
 *  carries one of these prefixes. An UNLINKED half's counterpart is a sentinel
 *  (its exact value is a Pact-side detail and has changed over time), which never
 *  does — so we detect linkage by "counterpart IS an Apollo account", not by
 *  guessing the sentinel string. */
const APOLLO_PREFIXES = ["₱.", "Π."] as const; // ₱.  Π.

/** The separator joining a Standard ₱. half to its Smart Π. half in the on-chain
 *  `PYTHIA|T|DualLinks` composite key. Standard comes FIRST. */
export const DUAL_LINK_BAR = "|";

/** Build the composite dual-API key `"<standard>|<smart>"` (standard first). */
export function buildDualKey(standardApollo: string, smartApollo: string): string {
  return `${standardApollo}${DUAL_LINK_BAR}${smartApollo}`;
}

/** Split a composite dual-API key back into its halves (null if malformed). */
export function splitDualKey(dualKey: string): { standard: string; smart: string } | null {
  const i = dualKey.indexOf(DUAL_LINK_BAR);
  if (i <= 0 || i >= dualKey.length - 1) return null;
  return { standard: dualKey.slice(0, i), smart: dualKey.slice(i + 1) };
}

/** A registered half is LINKED once its `counterpart` is written to the OTHER
 *  half's Apollo account. Detect that by "counterpart is an Apollo account" (₱./Π.
 *  prefix) rather than by comparing to a sentinel string — the unlinked sentinel
 *  is a Pact-side detail that has changed, and any non-Apollo counterpart (empty,
 *  "BAR", or whatever the current sentinel is) means UNLINKED. */
export function isApiKeyLinked(row: ApiKeyRow | null | undefined): boolean {
  const c = row?.counterpart;
  if (typeof c !== "string") return false;
  return APOLLO_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * The `PYTHIA|S|DualLink` row for one linked pair, keyed by the `standard|smart`
 * composite. Field names are the Pact schema names (hyphenated). `iz-active` is
 * the revocable kill-switch (owner flips true→false; the Cronoton link flips
 * false→true after the off-chain dual-ownership proof).
 *
 * NOTE (iteration 1): the exact shape of `UR_DualLinkRowOrNull` is only
 * confirmable against the live node — this is the documented shape; consumers
 * render it DEFENSIVELY (show these fields when present + any extras) so the
 * real row surfaces on inspection. Indexed so unexpected keys are still typed.
 */
export interface DualLinkRow {
  "standard-apollo"?: string;
  "smart-apollo"?: string;
  "consumer-lane"?: string;
  /** The revocable kill-switch: true = active, false = revoked. */
  "iz-active"?: boolean;
  /** True once the dual-link row genuinely exists on-chain (verified live). A
   *  malformed/absent composite comes back with this false + epoch-0 times. */
  "is-registered"?: boolean;
  "linked-at"?: unknown;
  "updated-at"?: unknown;
  /** The `standard|smart` composite the row is keyed by. */
  "dual-link-key"?: string;
  [key: string]: unknown;
}

/** BATCH dual-link read — `ouronet-ns.DPL-UR.URC_0033_DualApiKeyMapper [dualKey…]`
 *  — maps `PYTHIA.UR_DualLinkRowOrNull` over each `standard|smart` composite,
 *  returning one entry per input IN ORDER (index-aligned; `null` where the
 *  composite has no dual-link row). Mirrors `getApiKeySelectorData`. */
export async function getDualApiKeySelectorData(
  dualKeys: string[],
): Promise<Array<DualLinkRow | null>> {
  if (!dualKeys.length) return [];
  try {
    const list = dualKeys.map((k) => `"${k}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0033_DualApiKeyMapper [${list}])`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return (response.result.data as Array<DualLinkRow | null>) ?? [];
    }
    return [];
  } catch {
    return [];
  }
}

/** The Pythia deploy/rename STOA prices (`URC_0034_PythiaPrices`). `*-text` are
 *  the pre-formatted human strings the contract emits. */
export interface PythiaPrices {
  "deploy-price": number;
  "rename-price": number;
  "deploy-price-text": string;
  "rename-price-text": string;
}

/** Read `ouronet-ns.DPL-UR.URC_0034_PythiaPrices` — the deploy/rename STOA prices
 *  for Apollo-half deploy + dual-link consumer-lane rename. */
export async function getPythiaPrices(): Promise<PythiaPrices | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0034_PythiaPrices)`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      return (response.result.data as PythiaPrices) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
