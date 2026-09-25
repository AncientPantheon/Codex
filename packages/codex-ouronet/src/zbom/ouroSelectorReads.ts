/**
 * ouroSelectorReads — LOCAL Ouronet account/StoicTag/StoaAccount selector
 * reads, pointed at the LIVE `O-UI-SEVEN` module.
 *
 * DPL-UR chain-symbol audit (2026-09-25, follow-up handoff): `ouronet-ns.
 * DPL-UR` went into archive mode (`PureV2/14`) — its 57-function read layer
 * was deleted. Four of the reads this package depends on have a CONFIRMED
 * LIVE replacement on `O-UI-SEVEN` ("verified object-for-object against the
 * old functions on mainnet, for a real account and a non-existent one" —
 * argument lists and key shapes are IDENTICAL, only the module/function name
 * changed):
 *
 *   DPL-UR.URC_0027_AccountSelectorMapper    → O-UI-SEVEN.URC_01|Accounts
 *   DPL-UR.URC_0027b_StoicTagSelectorMapper  → O-UI-SEVEN.URC_03|StoicTags
 *   DPL-UR.URC_0027c_StoicTagSelectorSingle  → O-UI-SEVEN.URC_04|StoicTag
 *   DPL-UR.URC_0028_StoaAccountSelectorMapper→ O-UI-SEVEN.URC_05|StoaAccounts
 *
 * WHY THIS FILE EXISTS (not just a version bump): the equivalent functions
 * in `@ouronet/ouronet-core` (`getAccountSelectorData`, `getStoicTagSelectorData`,
 * `getStoicTagInfo`, `getStoaAccountSelectorData` — `interactions/
 * ouroAccountFunctions.ts`) still build the OLD `DPL-UR.*` Pact call
 * internally, confirmed against its latest published version (4.6.0,
 * checked against npm 2026-09-25) — this package cannot patch that
 * dependency from here. These are byte-for-byte the SAME implementations
 * (same `pactRead` seam, same tiers, same "no data ⇒ `[]`/`null`" failure
 * shape, same result types reused from `@ouronet/ouronet-core`'s own
 * `ouroTypes.js`) with ONLY the Pact call's module/function name changed —
 * mirrors `deployApiKey.ts`'s own "interim; upstream to ouronet-core"
 * pattern for `URC_0031`. DELETE this file (and re-point every import back
 * to `@ouronet/ouronet-core/interactions/ouroAccountFunctions`) the day that
 * package ships an O-UI-SEVEN-compatible release.
 *
 * Sentinel values changed shape but NOT type on the chain side (per the
 * handoff: `iz-smart` can come back as the number `-1` instead of `false`
 * for "account does not exist", `payment-key-balance` as `-1.0` instead of
 * `0.0` for "no payment key", `payment-key` as the literal string `"|"`
 * (the BAR sentinel) instead of `""`) — the reused `AccountSelectorData`
 * type already declares `"iz-smart": boolean | number` and
 * `"payment-key-balance"/"payment-key"` as plain `number`/`string`, so no
 * type change was needed here; this file passes `response.result.data`
 * through verbatim, same as every read in this package already does.
 * `StoicTagSelectorData`'s three-state shape (`iz-never-registered` /
 * `iz-active` / `iz-released`) was ALREADY a distinct field per state in the
 * existing type — nothing to change there either. The new additive
 * `-ok`/`entry-ok` row flag is safe to ignore (per the handoff) and is not
 * modeled here; it rides through untyped on whatever `response.result.data`
 * actually contains.
 */

import { pactRead } from "@stoachain/stoa-core/reads";
import { KADENA_NAMESPACE } from "@ouronet/ouronet-core/constants";
import type {
  AccountSelectorData,
  StoaAccountSelectorData,
  StoicTagSelectorData,
} from "@ouronet/ouronet-core/interactions/ouroTypes";

/** `O-UI-SEVEN.URC_01|Accounts` — batch account selector (activation, guard,
 *  smart/standard, payment key + guard + balance, on-chain public key,
 *  sovereign, governor, StoicTag). Mirrors `getAccountSelectorData`'s exact
 *  signature/behavior — drop-in replacement. */
export async function getAccountSelectorDataLive(
  accounts: string[],
  options?: { skipTempWatcher?: boolean },
): Promise<AccountSelectorData[]> {
  const accountsList = accounts.map((a) => `"${a}"`).join(" ");
  const pactCode = `(${KADENA_NAMESPACE}.O-UI-SEVEN.URC_01|Accounts [${accountsList}])`;
  const response = await pactRead(pactCode, { tier: "T5", skipTempWatcher: options?.skipTempWatcher });
  if (!response?.result || response.result.status === "failure") return [];
  return (response.result.data as AccountSelectorData[]) ?? [];
}

/** `O-UI-SEVEN.URC_03|StoicTags` — batch inverse StoicTag lookup (tag name →
 *  on-chain status + bound account). Mirrors `getStoicTagSelectorData`'s
 *  exact signature/behavior — drop-in replacement. */
export async function getStoicTagSelectorDataLive(
  tagNames: string[],
): Promise<StoicTagSelectorData[]> {
  if (tagNames.length === 0) return [];
  const tagList = tagNames.map((t) => `"${t}"`).join(" ");
  const pactCode = `(${KADENA_NAMESPACE}.O-UI-SEVEN.URC_03|StoicTags [${tagList}])`;
  const response = await pactRead(pactCode, { tier: "T5" });
  if (!response?.result || response.result.status === "failure") return [];
  return (response.result.data as StoicTagSelectorData[]) ?? [];
}

/** `O-UI-SEVEN.URC_04|StoicTag` — single inverse StoicTag lookup. Mirrors
 *  `getStoicTagInfo`'s exact signature/behavior — drop-in replacement.
 *  Returns `null` only on a read failure; a never-registered tag still
 *  resolves to a row with `iz-never-registered: true`. */
export async function getStoicTagInfoLive(
  tagName: string,
): Promise<StoicTagSelectorData | null> {
  if (!tagName) return null;
  const pactCode = `(${KADENA_NAMESPACE}.O-UI-SEVEN.URC_04|StoicTag "${tagName}")`;
  const response = await pactRead(pactCode, { tier: "T5" });
  if (!response?.result || response.result.status === "failure") return null;
  return (response.result.data as StoicTagSelectorData) ?? null;
}

/** `O-UI-SEVEN.URC_05|StoaAccounts` — batch Stoa (k:/u:/c:/w:) account
 *  selector (activation, balance, guard). Mirrors
 *  `getStoaAccountSelectorData`'s exact signature/behavior — drop-in
 *  replacement. */
export async function getStoaAccountSelectorDataLive(
  accounts: string[],
): Promise<StoaAccountSelectorData[]> {
  if (accounts.length === 0) return [];
  const accountsList = accounts.map((a) => `"${a}"`).join(" ");
  const pactCode = `(${KADENA_NAMESPACE}.O-UI-SEVEN.URC_05|StoaAccounts [${accountsList}])`;
  const response = await pactRead(pactCode, { tier: "T5" });
  if (!response?.result || response.result.status === "failure") return [];
  return (response.result.data as StoaAccountSelectorData[]) ?? [];
}
