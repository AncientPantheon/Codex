/**
 * The guard predicate catalogue - the single definition.
 *
 * Previously this list lived privately inside `zbom/cfm/inputs.tsx`, which
 * also pulls in CodeMirror, the Pact grammar and the chain read layer. Any
 * other screen wanting the predicates had to either drag that whole graph in
 * or copy the list. Lifted here so neither is necessary; `inputs.tsx` now
 * imports it rather than owning it.
 */

export const PREDICATES = [
  { value: "keys-all",  label: "keys-all",  group: "Standard", minKeys: 1, description: "All keys must sign" },
  { value: "keys-any",  label: "keys-any",  group: "Standard", minKeys: 1, description: "Any single key may sign" },
  { value: "keys-2",    label: "keys-2",    group: "Standard", minKeys: 2, description: "At least 2 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-1", label: "keys-1", group: "Stoic Basic", minKeys: 1, description: "Exactly 1 key must sign" },
  { value: "stoa-ns.stoic-predicates.keys-3", label: "keys-3", group: "Stoic Basic", minKeys: 3, description: "At least 3 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-4", label: "keys-4", group: "Stoic Basic", minKeys: 4, description: "At least 4 keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-51pct", label: "≥51%", group: "Stoic %", minKeys: 1, description: "At least 51% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-60pct", label: "≥60%", group: "Stoic %", minKeys: 1, description: "At least 60% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-66pct", label: "≥66%", group: "Stoic %", minKeys: 1, description: "At least 66% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-75pct", label: "≥75%", group: "Stoic %", minKeys: 1, description: "At least 75% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.at-least-90pct", label: "≥90%", group: "Stoic %", minKeys: 1, description: "At least 90% of keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-2-of-3", label: "2-of-3", group: "Stoic m-of-n", exactKeys: 3, description: "2 of 3 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-3-of-5", label: "3-of-5", group: "Stoic m-of-n", exactKeys: 5, description: "3 of 5 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-4-of-7", label: "4-of-7", group: "Stoic m-of-n", exactKeys: 7, description: "4 of 7 keys must sign" },
  { value: "stoa-ns.stoic-predicates.keys-5-of-9", label: "5-of-9", group: "Stoic m-of-n", exactKeys: 9, description: "5 of 9 keys must sign" },
  { value: "stoa-ns.stoic-predicates.all-but-one", label: "all-but-one", group: "Stoic Tolerance", minKeys: 1, description: "All keys except one must sign" },
  { value: "stoa-ns.stoic-predicates.all-but-two", label: "all-but-two", group: "Stoic Tolerance", minKeys: 2, description: "All keys except two must sign" },
] as const;

export type PredValue = (typeof PREDICATES)[number]["value"];

/** True when `pred` is selectable for a keyset of `keyCount` keys. The
 *  m-of-n predicates require an EXACT key count; the rest a minimum. */
export function isPredAvailable(pred: string, keyCount: number): boolean {
  const p = PREDICATES.find((x) => x.value === pred);
  if (!p) return false;
  if ("exactKeys" in p && typeof p.exactKeys === "number") return keyCount === p.exactKeys;
  if ("minKeys" in p && typeof p.minKeys === "number") return keyCount >= p.minKeys;
  return true;
}

/** The predicates grouped in catalogue order, for a grouped picker. */
export function predGroups(): { group: string; items: typeof PREDICATES[number][] }[] {
  const out: { group: string; items: typeof PREDICATES[number][] }[] = [];
  for (const p of PREDICATES) {
    const last = out[out.length - 1];
    if (last && last.group === p.group) last.items.push(p);
    else out.push({ group: p.group, items: [p] });
  }
  return out;
}
