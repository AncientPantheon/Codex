/**
 * DALOS curve identification — ported 1:1 from OuronetUI's
 * `src/lib/dalos/originCurve.ts`.
 *
 * Accounts created from OuronetUI v0.30.12+ carry an `originCurve` stamp
 * ('dalos' | 'apollo'). Pre-stamp accounts fall back to address-prefix
 * sniffing (Ѻ./Σ. → dalos, ₱./Π. → apollo). Drives the CodexUI account-card
 * styling: APOLLO accounts read as "observational" (orange / cherry) and
 * can't be activated on chain.
 */

import type { IOuroAccount, OuronetOriginCurve } from "../../types/entities.js";

/** APOLLO address prefixes: ₱. standard, Π. smart. */
const APOLLO_PREFIXES = ["₱.", "Π."] as const;
/** DALOS Genesis address prefixes: Ѻ. standard, Σ. smart. */
const DALOS_PREFIXES = ["Ѻ.", "Σ."] as const;

export function detectOriginCurve(account: IOuroAccount): OuronetOriginCurve {
  if (account.originCurve === "apollo" || account.originCurve === "dalos") {
    return account.originCurve;
  }
  const addr = account.address ?? "";
  if (APOLLO_PREFIXES.some((p) => addr.startsWith(p))) return "apollo";
  if (DALOS_PREFIXES.some((p) => addr.startsWith(p))) return "dalos";
  return "dalos";
}

/** True if an account was produced by a non-default (experimental) curve. */
export function isExperimentalAccount(account: IOuroAccount): boolean {
  return detectOriginCurve(account) !== "dalos";
}
