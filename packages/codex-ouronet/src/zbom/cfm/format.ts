/**
 * CFM Format Helpers
 * Shared formatters used across all CFM modals.
 */

import { formatEU } from "@stoachain/stoa-core/pact";

/**
 * Format an IGNIS value EU-style, truncated to 4 decimals with "..." suffix.
 * Rule 3 display for Patron IGNIS bar.
 * Example: "1.234.567,1234..." for long decimals
 */
export function formatIgnisTrunc(val: string): string {
  const eu = formatEU(val);
  const commaIdx = eu.indexOf(",");
  if (commaIdx === -1) return eu;
  const dec = eu.slice(commaIdx + 1);
  if (dec.length <= 4) return eu;
  return `${eu.slice(0, commaIdx + 5)}...`;
}
