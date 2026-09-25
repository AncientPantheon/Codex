/**
 * stoicTagExecOps — LOCAL overrides for `@ouronet/ouronet-core`'s
 * `buildReleaseStoicTagPactCode` / `buildRegisterStoicTagPactCode`
 * (`pact/cfmBuilders.js`), confirmed broken against the NOW-DEPLOYED
 * `ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag` / `C_RegisterStoicTag`, found
 * 2026-09-26 chasing an owner-reported live failure: "Program encountered an
 * unhandled error: Evaluation did not reduce to a value" on Release StoicTag
 * execute.
 *
 * ROOT CAUSE, confirmed directly against mainnet via `describe-module
 * "ouronet-ns.TS01-C4"` (chain 0) — the "complete rehaul" the owner warned
 * about: both functions were reshaped by the 2026-09-22 "patron/executor
 * canon 2.2" pass (see the deployed module's own doc comments on
 * `CODEX|C_RegisterStoicTag`/`CODEX|C_ReleaseStoicTag` in `ouronet-ns.CODEX`):
 *
 *   DEPLOYED NOW:
 *     (ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag  patron executor tag-name)
 *     (ouronet-ns.TS01-C4.CODEX|C_RegisterStoicTag patron executor tag-name)
 *
 *   `@ouronet/ouronet-core`'s builders (unpatched, confirmed at latest
 *   published version) still emit the PRE-rehaul shape:
 *     Release:  (…C_ReleaseStoicTag patron tag-name)                  — missing `executor` entirely (2 args, chain wants 3)
 *     Register: (…C_RegisterStoicTag patron tag-name account-address) — `executor` (=account) is in the WRONG position (3rd, chain wants 2nd)
 *
 *   `executor` IS the account the tag is/will be bound to — the same value
 *   this package already sent as `account`/`accountAddress` — it was "ALREADY
 *   the executor" per the deployed module's own doc comment; only its name
 *   and (for Release) its presence changed, not its identity or semantics.
 *   `CAP_EnforceAccountOwnership executor` / `UEV_ExecutorIsTagAccount` prove
 *   this account's own guard signs — unchanged from before.
 *
 * CONFIRMED LIVE (via `/pact/api/v1/local`, chain 0, dummy args, 2026-09-26):
 *   - Old (broken) Release call `(… "k:test" "testtag")` (2 args) →
 *     `"Program encountered an unhandled error: Evaluation did not reduce to
 *     a value"` — the EXACT text of the owner's screenshot.
 *   - Old (broken) Register call `(… "k:patron" "testtag" "k:account")`
 *     (account-address last) → `"StoicTag name k:account must be 3–256
 *     glyphs from DALOS|CHARSET"` — the shifted argument gets validated as
 *     the tag name, i.e. this shape was ALSO silently wrong, just failing
 *     differently (it was previously unreachable — the button stayed
 *     disabled until this same audit's earlier INFO-read fix).
 *   - New (this file's) Release call `(… patron executor tag-name)` → reaches
 *     real application logic: `"StoicTag not found"` (dummy tag legitimately
 *     doesn't exist).
 *   - New (this file's) Register call `(… patron executor tag-name)` →
 *     reaches real application logic: `"The k:account DALOS Account doesnt
 *     exist"` (dummy account legitimately doesn't exist).
 *
 * INFO reads (`INFO_CODEX|ReleaseStoicTag`/`INFO_CODEX|RegisterStoicTag`)
 * were independently re-verified against the same `describe-module` dump —
 * their signatures/arg order are UNCHANGED by this rehaul; only the EXECUTE
 * calls moved. No change needed there.
 *
 * Delete this file (and re-point `ReleaseStoicTagModal`/`RegisterStoicTagModal`
 * back to `@ouronet/ouronet-core/pact`) the day that package ships builders
 * matching the deployed `patron executor tag-name` shape.
 */

import { KADENA_NAMESPACE } from "@ouronet/ouronet-core/constants";

export interface ReleaseStoicTagExecParams {
  /** Pays the IGNIS release fee (1 per glyph). */
  patron: string;
  /** The account the tag is bound to — proven via its own guard signing
   *  (`UEV_ExecutorIsTagAccount` cross-checks this against the tag row). */
  executor: string;
  /** The BARE on-chain tag name (no § sigil). */
  tagName: string;
}

/** `(ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag patron executor tag-name)` —
 *  the deployed 3-arg shape. See this file's own header for why the external
 *  `buildReleaseStoicTagPactCode` (2 args, missing `executor`) is broken. */
export function buildReleaseStoicTagPactCodeLive(p: ReleaseStoicTagExecParams): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.CODEX|C_ReleaseStoicTag "${p.patron}" "${p.executor}" "${p.tagName}")`;
}

export interface RegisterStoicTagExecParams {
  /** Pays the native STOA fee (split across protocol receivers). */
  patron: string;
  /** The account the tag is being applied to — its own guard signs
   *  (`CAP_EnforceAccountOwnership`), and its Elite-tier discount applies. */
  executor: string;
  /** The BARE on-chain tag name (no § sigil). */
  tagName: string;
}

/** `(ouronet-ns.TS01-C4.CODEX|C_RegisterStoicTag patron executor tag-name)` —
 *  the deployed arg ORDER (`executor` 2nd, `tag-name` 3rd). See this file's
 *  own header for why the external `buildRegisterStoicTagPactCode` (which
 *  puts the account-address LAST) is broken. */
export function buildRegisterStoicTagPactCodeLive(p: RegisterStoicTagExecParams): string {
  return `(${KADENA_NAMESPACE}.TS01-C4.CODEX|C_RegisterStoicTag "${p.patron}" "${p.executor}" "${p.tagName}")`;
}
