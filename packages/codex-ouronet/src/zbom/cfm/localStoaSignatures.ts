/**
 * A stopgap for StoaChain `coin.*` entrypoints the installed
 * `@ouronet/talos-registry` doesn't describe yet — confirmed live:
 * `coin.C_TransferAcross` is absent from its `STOA_SIGNATURES` table (same
 * class of gap as the previously-found-and-reported `coin.C_UR|TransferAnew`
 * missing entry). `PreZbomHint.tsx` consults this ONLY as a fallback, for a
 * key the registry itself cannot yet render a tooltip for — every other key
 * still goes through `tooltipModel` exclusively.
 *
 * Delete this file (and its one consulting branch in `PreZbomHint.tsx`) once
 * the registry adds `coin.C_TransferAcross` upstream — mirrors this
 * package's own now-deleted `nativeStoaSpecs.ts` precedent exactly:
 * hand-transcribed, line-numbered, and verified against the deployed
 * contract by `tests/zbom-local-stoa-signatures.test.ts`, which fails loudly
 * on drift and skips visibly when the sibling Pact checkout is absent.
 *
 * `signature` carries `[name, type]` pairs — the SAME shape the registry's
 * own `STOA_SIGNATURES`/`KADENA_SIGNATURES` tables use — rather than bare
 * names, so this stopgap can resolve a caller-supplied value OR a
 * type-appropriate ghost per slot, the same fallback `tooltipModel`'s own
 * (unexported) `offRegistryModel` already applies to every OTHER stoa/kadena
 * key. `receiver-guard`'s `"guard"` type is cross-validated against Kadena's
 * own `coin.transfer-crosschain` — the two chains' cross-chain `coin`
 * entrypoints share the identical SPV-proof two-step protocol shape (this
 * file's own top comment already treated them as parallel constructs before
 * this round), so Kadena's live, registry-confirmed signature
 * (`sender:string receiver:string receiver-guard:guard target-chain:string
 * amount:decimal`) is strong corroboration, not a guess.
 */

import { PLACEHOLDER } from "@ouronet/talos-registry";

export interface LocalStoaSignature {
  /** Fully-qualified `coin.<Fn>` key — root namespace, no `ouronet-ns.` prefix. */
  exec: string;
  /** `[name, type]` pairs, in declared order — verified against the deployed
   *  contract by `tests/zbom-local-stoa-signatures.test.ts`. */
  signature: Array<[name: string, type: string]>;
}

export const LOCAL_STOA_SIGNATURES: Readonly<Record<string, LocalStoaSignature>> = {
  "coin.C_TransferAcross": {
    exec: "coin.C_TransferAcross",
    signature: [
      ["sender", "string"],
      ["receiver", "string"],
      ["receiver-guard", "guard"],
      ["target-chain", "string"],
      ["amount", "decimal"], // coin-live.pact:589-592
    ],
  },
};

/** Type-appropriate ghost per Pact type, for a slot this stopgap's own
 *  caller-supplied `values` didn't fill — the SAME table (by value, not
 *  import: `STOA_GHOST`/`KADENA_GHOST` are private to `@ouronet/talos-
 *  registry`'s `tooltip.js`, byte-identical to each other there today) the
 *  registry itself would apply to this same key once it adds
 *  `coin.C_TransferAcross` upstream and this file gets deleted — kept in
 *  sync by inspection, not by a shared export, since there is none to import. */
const STOA_GHOST: Readonly<Record<string, string>> = {
  string: '"k:1ac0d8b0a4f6e2c9d3b5a7e1f4c6089d2b3e5a7c9f1d3b5e7a9c1f3d5b7e9a1c"',
  decimal: "1.0",
  integer: "1",
  bool: "false",
  guard: '(read-keyset "ks")',
};

export interface LocalStoaSlot {
  index: number;
  name: string;
  type: string;
  /** Already display-ready — a quoted Pact string literal, a bare decimal,
   *  `(read-keyset "ks")`, or the registry's own `PLACEHOLDER` sentinel —
   *  same convention `TooltipModel["slots"][number]["value"]` uses. */
  value: string;
  isPlaceholder: boolean;
}

/**
 * Resolves a local-stopgap signature's slots against caller-supplied
 * `values` (already-quoted Pact literals, keyed by parameter name — the
 * SAME `modelValues` shape `PreZbomTooltipCard` builds for every registry
 * model): `values[name] ?? STOA_GHOST[type] ?? PLACEHOLDER`, mirroring
 * `tooltipModel`'s own fallback for every other stoa/kadena key exactly, so
 * a caller-supplied `sender`/`receiver`/`target-chain` reaches this card the
 * same way it reaches every registry-backed one.
 */
export function resolveLocalStoaSlots(
  signature: LocalStoaSignature,
  values: Record<string, string> = {},
): LocalStoaSlot[] {
  return signature.signature.map(([name, type], i) => {
    const supplied = values[name];
    const ghost = STOA_GHOST[type];
    return {
      index: i + 1,
      name,
      type,
      value: supplied ?? ghost ?? PLACEHOLDER,
      isPlaceholder: supplied === undefined && ghost === undefined,
    };
  });
}
