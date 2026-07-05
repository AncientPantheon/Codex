/**
 * monitoredReads — thin instrumented wrappers around the `@stoachain/ouronet-core`
 * read helpers the CodexUI calls directly (outside the FunctionInfoZone fetcher
 * path). Each wrapper preserves the exact signature of the core helper and only
 * routes the call through `codexClock.report(<registry id>, …)` so the read shows
 * up live on the debouncer + the Settings → Read Functions page.
 *
 * Call sites import these in place of the core helpers — drop-in, same names,
 * same types. The real network still happens inside the core helper / injected
 * `pactRead` reader; this layer only times it.
 */

import { getIgnisBalance as _getIgnisBalance } from "@stoachain/ouronet-core/interactions/ouroBalanceFunctions";
import { getKadenaAccountGuard as _getKadenaAccountGuard } from "@stoachain/ouronet-core/interactions/ouroAccountFunctions";
import { codexClock } from "./codexClock.js";

/** IGNIS balance read — registry id `UR_AccountSupply`. */
export const getIgnisBalance: typeof _getIgnisBalance = (...args) =>
  codexClock.report("UR_AccountSupply", undefined, () => _getIgnisBalance(...args));

/** Sovereign-guard read — registry id `UR_AccountGuard`. */
export const getKadenaAccountGuard: typeof _getKadenaAccountGuard = (...args) =>
  codexClock.report("UR_AccountGuard", undefined, () => _getKadenaAccountGuard(...args));
