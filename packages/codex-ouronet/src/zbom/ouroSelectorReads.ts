/**
 * ouroSelectorReads — LOCAL overrides for `@ouronet/ouronet-core` read
 * functions confirmed broken at that package's latest published version
 * (4.6.0), each byte-for-byte the same implementation with only the Pact
 * call's module/function name corrected. Several unrelated bug classes live
 * here (see each function's own doc comment for which): the DPL-UR archival
 * migration (`*Live` selector functions, → `O-UI-SEVEN`), a separate,
 * never-fixed rename in `getRegisterStoicTagInfo` (→
 * `getRegisterStoicTagInfoLive`), the Activate Standard/Smart INFO-ZERO→
 * INFO-ONE move, and — added 2026-09-26, found chasing the SAME owner
 * report that led to the StoicTag execute-arity fix — the 2026-09-22
 * "patron/executor canon" rehaul's fallout on three more reads:
 * `getWrapperPaymentKey` (`DALOS.UR_AccountKadena`, RETIRED — confirmed
 * "no such member" on mainnet — renamed `DALOS.UR_AccountStoa`, same 1-arg
 * signature, confirmed live via a real "no value found in table" response
 * instead of a resolution error), and `getRotateGuardInfo`/
 * `getRotateKadenaInfo` (both still calling the `INFO-ZERO` tombstone —
 * that module's own on-chain doc comment says so explicitly: "OBSOLETE
 * TOMBSTONE... DALOS-INFO previews moved to INFO-ONE" — replacements
 * confirmed present via `describe-module "ouronet-ns.INFO-ONE"`:
 * `INFO_DALOS|RotateGuard` / `INFO_DALOS|RotateStoa`, same 2-arg
 * `(patron account)` signature). Delete each function here (re-pointing
 * its one caller back to `@ouronet/ouronet-core`) independently, the day
 * that package fixes the corresponding bug.
 *
 * Original DPL-UR module doc comment follows:
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

// ── RegisterStoicTag INFO — a DIFFERENT bug class, found while testing every
//    Ouronet execute flow's wiring (2026-09-25): NOT a DPL-UR archival, an
//    unfixed rename in @ouronet/ouronet-core's own `getRegisterStoicTagInfo`
//    (still `CODEX.CODEX|INFO_RegisterStoicTag` instead of the correct
//    `CODEX.INFO_CODEX|RegisterStoicTag`, AND `DALOS.UR_AccountKadena`
//    instead of `DALOS.UR_AccountStoa` — both confirmed at that package's
//    latest published version, 4.6.0). Consequence was worse than a wasted
//    read: `RegisterStoicTagModal`'s `blockerReason` gates on `info !==
//    null`, and since the external read always fails, "Register StoicTag"
//    was PERMANENTLY DISABLED — the same failure shape the chain-symbol
//    audit found for `LinkDualApiKeyModal`. Same "interim; upstream to
//    ouronet-core" pattern as every other function in this file. ──────────

/** `{ info, receivers }` — the INFO object + its resolved k:/c: split
 *  targets. Byte-for-byte the same shape as `@ouronet/ouronet-core`'s
 *  `RegisterStoicTagFullInfo`. */
export interface RegisterStoicTagFullInfoLive {
  info: any | null;
  receivers: string[];
}

/** Full INFO for registering a StoicTag — reads the CORRECT
 *  `CODEX.INFO_CODEX|RegisterStoicTag` AND resolves the STOA-split target
 *  Ouronet accounts (`kadena.kadena-targets`) to their actual k:/c: payment
 *  addresses via the CORRECT `DALOS.UR_AccountStoa`, in one `let*` read.
 *  Drop-in replacement for `@ouronet/ouronet-core`'s `getRegisterStoicTagInfo`
 *  — same params, same return shape, same "missing arg ⇒ null" behavior. */
export async function getRegisterStoicTagInfoLive(
  patron: string,
  tagName: string,
  account: string,
): Promise<RegisterStoicTagFullInfoLive | null> {
  if (!patron || !tagName || !account) return null;
  try {
    const pactCode =
      `(let*` +
      `  ((info (${KADENA_NAMESPACE}.CODEX.INFO_CODEX|RegisterStoicTag "${patron}" "${tagName}" "${account}"))` +
      `   (receivers (map (${KADENA_NAMESPACE}.DALOS.UR_AccountStoa) (at "kadena-targets" (at "kadena" info)))))` +
      `  { "info": info, "receivers": receivers })`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result && response.result.status !== "failure") {
      const data = response.result.data as { info?: unknown; receivers?: unknown };
      return { info: data?.info ?? null, receivers: (data?.receivers as string[]) ?? [] };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Activate Standard/Smart Account INFO — the SAME bug class as
//    RegisterStoicTag above: @ouronet/ouronet-core's own
//    `getDeployStandardAccountInfo(Only)` / `getDeploySmartAccountInfo(Only)`
//    (`interactions/activateFunctions.ts`) still build
//    `INFO-ZERO.DALOS-INFO|URC_DeployStandardAccount` /
//    `URC_DeploySmartAccount` (retired — `INFO-ZERO` now defines only
//    `GOV|Demiurgoi`) AND `DALOS.UR_AccountKadena` (retired) internally,
//    confirmed at that package's latest published version (4.6.0). Unlike
//    RegisterStoicTag this does NOT permanently disable "Activate" — both
//    `ActivateStandardAccountModal` / `ActivateSmartAccountModal` derive
//    `canExecute` from FORM STATE (typed keys/addresses), not from this
//    read — but it DOES mean the shown STOA cost silently reads "free"/`0`
//    instead of the real activation price. Same "interim; upstream to
//    ouronet-core" pattern; same drop-in param/return shapes. ─────────────

/** `{ info, receivers }` for account activation — byte-for-byte the same
 *  shape `getDeployStandardAccountInfo` / `getDeploySmartAccountInfo`
 *  already return. */
export interface DeployAccountFullInfoLive {
  info: any | null;
  receivers: string[];
}

/** Full INFO for Activate Standard — reads the CORRECT
 *  `INFO-ONE.INFO_DALOS|DeployStandardAccount` and resolves receivers via
 *  the CORRECT `DALOS.UR_AccountStoa`. Drop-in replacement for
 *  `getDeployStandardAccountInfo`. */
export async function getDeployStandardAccountInfoLive(
  account: string,
): Promise<DeployAccountFullInfoLive | null> {
  try {
    const pactCode =
      `(let*` +
      `  ((info (${KADENA_NAMESPACE}.INFO-ONE.INFO_DALOS|DeployStandardAccount "${account}"))` +
      `   (receivers (map (${KADENA_NAMESPACE}.DALOS.UR_AccountStoa) (at "kadena-targets" (at "kadena" info)))))` +
      `  { "info": info, "receivers": receivers })`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") {
      const data = response.result.data as { info?: unknown; receivers?: unknown };
      return { info: data?.info ?? null, receivers: (data?.receivers as string[]) ?? [] };
    }
    return null;
  } catch {
    return null;
  }
}

/** INFO-only read (no receiver resolution) for Activate Standard — the
 *  `FunctionInfoZone` fetcher. Drop-in replacement for
 *  `getDeployStandardAccountInfoOnly`. */
export async function getDeployStandardAccountInfoOnlyLive(account: string): Promise<any | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.INFO_DALOS|DeployStandardAccount "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") return response.result.data ?? null;
    return null;
  } catch {
    return null;
  }
}

/** Full INFO for Activate Smart — reads the CORRECT
 *  `INFO-ONE.INFO_DALOS|DeploySmartAccount` and resolves receivers via the
 *  CORRECT `DALOS.UR_AccountStoa`. Drop-in replacement for
 *  `getDeploySmartAccountInfo`. */
export async function getDeploySmartAccountInfoLive(
  account: string,
): Promise<DeployAccountFullInfoLive | null> {
  try {
    const pactCode =
      `(let*` +
      `  ((info (${KADENA_NAMESPACE}.INFO-ONE.INFO_DALOS|DeploySmartAccount "${account}"))` +
      `   (receivers (map (${KADENA_NAMESPACE}.DALOS.UR_AccountStoa) (at "kadena-targets" (at "kadena" info)))))` +
      `  { "info": info, "receivers": receivers })`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") {
      const data = response.result.data as { info?: unknown; receivers?: unknown };
      return { info: data?.info ?? null, receivers: (data?.receivers as string[]) ?? [] };
    }
    return null;
  } catch {
    return null;
  }
}

/** INFO-only read (no receiver resolution) for Activate Smart — the
 *  `FunctionInfoZone` fetcher. Drop-in replacement for
 *  `getDeploySmartAccountInfoOnly`. */
export async function getDeploySmartAccountInfoOnlyLive(account: string): Promise<any | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.INFO_DALOS|DeploySmartAccount "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") return response.result.data ?? null;
    return null;
  } catch {
    return null;
  }
}

/** Resolves an Ouronet account's Stoa Chain payment key — reads the CORRECT
 *  `DALOS.UR_AccountStoa` (the external `getWrapperPaymentKey` still calls
 *  the retired `DALOS.UR_AccountKadena`, confirmed "no such member" on
 *  mainnet). Same signature/behavior/failure shape as the original — drop-in
 *  replacement. Used by RegisterStoicTagModal, RenameDualLaneModal, and
 *  ActivateApolloPythiaKeyModal's patron payment-key lookup. */
export async function getWrapperPaymentKeyLive(wrapper: string): Promise<string | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DALOS.UR_AccountStoa "${wrapper}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") return String(response.result.data);
    return null;
  } catch {
    return null;
  }
}

/** RotateGuard INFO preview — reads the CORRECT `INFO-ONE.INFO_DALOS|RotateGuard`
 *  (the external `getRotateGuardInfo` still calls the tombstoned
 *  `INFO-ZERO.DALOS-INFO|URC_RotateGuard`). Same `(patron account)` 2-arg
 *  signature — drop-in replacement. Used by RotateGuardModal, whose Execute
 *  button was PERMANENTLY DISABLED by this (gates on `infoData !== null`,
 *  which never resolved). */
export async function getRotateGuardInfoLive(patron: string, account: string): Promise<any | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.INFO_DALOS|RotateGuard "${patron}" "${account}")`;
    const response = await pactRead(pactCode, { tier: "T7" });
    if (response?.result?.status === "success") return response.result.data ?? null;
    return null;
  } catch {
    return null;
  }
}

/** RotateStoa (payment key) INFO preview — reads the CORRECT
 *  `INFO-ONE.INFO_DALOS|RotateStoa` (the external `getRotateKadenaInfo`
 *  still calls the tombstoned `INFO-ZERO.DALOS-INFO|URC_RotateKadena`).
 *  Same `(patron account)` 2-arg signature — drop-in replacement. Used by
 *  RotatePaymentKeyModal, whose Execute button was PERMANENTLY DISABLED by
 *  this (gates on `infoData !== null`, which never resolved) — which had
 *  been masking the EXECUTE call's own `C_RotateKadena` → `C_RotateStoa`
 *  rename (see `rotatePaymentKeyLive.ts`). */
export async function getRotateStoaChainInfoLive(patron: string, account: string): Promise<any | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.INFO_DALOS|RotateStoa "${patron}" "${account}")`;
    const response = await pactRead(pactCode, { tier: "T7" });
    if (response?.result?.status === "success") return response.result.data ?? null;
    return null;
  } catch {
    return null;
  }
}
