/**
 * The ONE pre-ZBOM tooltip fill map — canon rule 7's own "one fill map, not
 * one per page" requirement (`TOOLTIP-CANON.md`, `@ouronet/talos-registry@
 * 2.2.0`): "if two value-builders exist, they will diverge, and the
 * divergence will be a whole category." Every `PreZbomHint` launcher in this
 * package that has a real "this account" alias to fill (`executor`/
 * `account`/`owner-account`/`apollo-account`) calls `ouronetAccountFillValues`
 * from here — `OuronetAccountsTab.tsx`, `SingleApiPanel.tsx`,
 * `DualApiPanel.tsx` — rather than each hand-rolling its own copy of the
 * alias list. `patron` is deliberately NOT part of `ouronetAccountFillValues`
 * itself: it is a genuinely different value (who PAYS/SPONSORS, not who is
 * acted upon), and its correct resolution differs by CONTEXT, not just by
 * account — `resolvePatronFillValue` covers the resident-vs-prime case
 * `OuronetAccountsTab.tsx` has the inputs for (the row's own account is a
 * valid "resident"); `DualApiPanel.tsx`'s own patron is resident-vs-prime
 * too (confirmed reading `RevokeDualLinkModal.tsx` directly) but its
 * "resident" means the codex's CURRENTLY ACTIVE account, a wallet-wide
 * concept this per-row launcher has no access to — so it fills `patron`
 * with the prime account directly (the real account `usePatronSelectionDefaults`'s
 * own DEFAULT setting resolves to), documented at that call site rather
 * than forcing a mismatched resolution through this shared function.
 *
 * THE BUG THIS FIXES, confirmed live against the installed registry
 * (2026-09-28): eight launchers in `OuronetAccountsTab.tsx` passed
 * `values={{ account: account.address }}` — but `account` is not an
 * execution parameter name for ANY of `C_RotateStoa` / `C_RotateGuard` /
 * `C_ReleaseStoicTag` / `C_RegisterStoicTag` / `C_RotateSovereign` /
 * `C_RotateGovernor` / `C_DeploySmartAccount` / `C_DeployStandardAccount` —
 * their real names are `patron`/`executor` (confirmed via
 * `tooltipModel(key).slots`). `tooltipModel`'s `values` merges strictly BY
 * NAME (rule 2), so every one of those calls was a complete, SILENT no-op:
 * the tooltip showed the registry's own example ghost account instead of
 * the real one, on every account-management button in the app. This is
 * exactly the fault class rule 7 exists to catch — a value that "type-
 * checks, renders plausibly, and shows the wrong entity" — except here the
 * fill was not even reaching the entity, just discarded.
 *
 * WHY `sender`/`receiver`/`buyer`/`account-to-redeem`/`redemption-payer`/
 * `executee`/`target-account` are deliberately NOT in this map, even though
 * `paramsByRole()` lists all of them under `"ouronet-account"` too: none of
 * this package's launchers were confirmed (by reading the real modal each
 * one opens) to mean "the account this row represents" for those specific
 * names — `sender` is StoaChain's own launcher-filled name (handled at each
 * StoaChain call site directly, not through this map, since it is a
 * DIFFERENT chain's own signature); `receiver` is the one genuinely
 * launcher-time-UNKNOWABLE case (Send's whole point is to let the user pick
 * a receiver that doesn't exist in the launcher's own context yet — see
 * this file's own `SEND_RECEIVER_EXEMPT_NAMES`). Emitting the whole
 * vocabulary regardless would be harmless (merging is by name) but is
 * exactly the "noise in a fill map is where the next wrong-entity bug
 * hides" rule 7 warns against — so this map stays scoped to names actually
 * confirmed correct, and grows only when a new launcher's real modal
 * confirms a new alias.
 */

/**
 * Fills every confirmed "this account" alias with `self` — the account the
 * launcher's own row represents. Safe to spread into every launcher's
 * `values=` unconditionally: an alias that is not a real parameter name for
 * a given entrypoint is simply ignored (values merge by name, never
 * positionally), so passing all four costs nothing on a call that only uses
 * one or two of them.
 *
 * `executor` / `account` / `apollo-account` are confirmed EXECUTION slot
 * names (`paramRole` classifies all three "ouronet-account"). `owner-
 * account` is different: it is `C_DeployApiKey`'s own PREVIEW parameter
 * name (never an execution slot for anything this map covers), so the
 * registry does not classify it under any role at all — but it is still a
 * correct, deliberate inclusion, because rule 2's merge is by name against
 * BOTH the execution's and the preview's lists at once.
 */
export function ouronetAccountFillValues(self: string): Record<string, string> {
  return {
    executor: self,
    account: self,
    "owner-account": self,
    "apollo-account": self,
  };
}

/**
 * Resolves the `patron` alias the SAME way every ZBOM modal's own mount-time
 * seed already does (`usePatronSelectionDefaults`'s own doc comment): the
 * user's persisted `patronSelectionMode` decides between two REAL accounts,
 * never a fabricated one.
 *
 *   "resident"              -> `self` (this row's own account pays/sponsors).
 *   "prime" | "wealthiest" | "custom"
 *                           -> `primeAddress` (accounts[0] — the same seed
 *                             `usePatronSelectionDefaults` uses; "wealthiest"
 *                             is ALSO seeded as prime, per that hook's own
 *                             doc comment — "the seed is prime as a
 *                             placeholder; usePatronAutoSelect then flips
 *                             it" — a real, live account, not a guess, even
 *                             though it may not be the FINAL patron once the
 *                             modal's own async wealthiest-check resolves.
 *                             "custom" (a per-session pick this hook never
 *                             itself returns, but the wider `PatronMode`
 *                             type it shares with modal-internal state
 *                             allows) has no launcher-time equivalent at
 *                             all — prime is the closest real account
 *                             available, not a guess at the actual custom
 *                             pick).
 *
 * Returns `undefined` when a non-"resident" patron would resolve to
 * `primeAddress` but the caller has no accounts list to derive it from yet
 * — deliberately NOT falling back to `self` in that case: `self` is
 * "resident" mode's own correct answer, not prime mode's, and silently
 * substituting it here would be exactly the "plausible but wrong entity"
 * fault rule 7 exists to catch, just relocated to this helper instead of a
 * call site. Left as the registry's own honest placeholder instead (rule 5
 * — "a ghost is not data", extended: an unknown must not be invented even
 * when a DIFFERENT real value happens to be sitting right there).
 */
export function resolvePatronFillValue(
  initialPatronMode: "prime" | "resident" | "custom",
  self: string,
  primeAddress: string | undefined,
): string | undefined {
  if (initialPatronMode === "resident") return self;
  return primeAddress;
}
