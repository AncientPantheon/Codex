/**
 * resolveGuardKeys — turn ANY on-chain guard shape into the set of public
 * keys it authorizes.
 *
 * This closes a real gap. `describeKeyset` already existed, but was wired
 * only into the ZBOM guard EDITOR (`zbom/cfm/inputs.tsx`'s "use existing
 * keyset-ref" tab). Nothing anywhere took an ACCOUNT's
 * `{keysetref:{ns,ksn}}` guard and expanded it into its keys — the rest of
 * the app sidestepped the problem by re-reading the account's guard from
 * chain instead. Both the eligibility wizard's guard display and Secure
 * Master Account need the expansion itself.
 *
 * ## The one invariant that matters
 *
 * A failed resolution is reported as `"keyset-ref-unresolved"` and carries
 * NO `keys` field at all. It must never degrade to an empty key list:
 * downstream, Secure Master Account treats "not in use" as grounds to
 * RELEASE a lock, so an empty list from a flaky chain read would silently
 * unlock the very keys guarding the master account. Unknown must stay
 * unknown, and the absent field makes that unmistakable at the type level.
 *
 * Shape detection reuses `detectGuardKind` from `GuardTree.js` — the same
 * import `zbom/cfm/governorSerialize.ts` already makes, so there is one
 * definition of "what shape is this guard" rather than a second copy.
 */

import { detectGuardKind } from "../ui/internal/GuardTree.js";
import type {
  KeysetGuard,
  KeysetRefGuard,
} from "../ui/internal/GuardTree.js";

/** What a named on-chain keyset resolves to. Structurally matches
 *  `IDescribedKeyset` from `@ouronet/ouronet-core`'s guard functions; declared
 *  locally so this module needs no runtime chain dependency. */
export interface DescribedKeyset {
  readonly keys: readonly string[];
  readonly pred: string;
}

export interface ResolveGuardKeysDeps {
  /** Resolve a qualified keyset name (`"ns.keysetName"`). Injected so this
   *  module is pure and testable with no network — the production wiring
   *  passes `describeKeyset` from `@ouronet/ouronet-core`. */
  describeKeyset: (qualifiedName: string) => Promise<DescribedKeyset>;
}

export type GuardKeyResolution =
  /** A direct keyset. `viaRef` is set when the stored keyset also records
   *  the reference it originally came from (`IKeyset.keysetRef`, the
   *  camelCase string) — an annotation, not an unresolved reference. */
  | { kind: "keyset"; pred: string; keys: string[]; viaRef?: string }
  /** A true `(keyset-ref-guard …)`, successfully expanded. */
  | { kind: "keyset-ref"; ref: string; pred: string; keys: string[] }
  /** A true keyset reference that could NOT be expanded. Deliberately has
   *  no `keys` field — see this module's header. */
  | { kind: "keyset-ref-unresolved"; ref: string; error: string }
  /** No guard at all. */
  | { kind: "none" }
  /** A capability or user guard: real, but it authorizes no enumerable
   *  key list, so there is nothing to lock. */
  | { kind: "unsupported"; guardKind: "capability" | "user" }
  /** A shape this code does not recognise. Reported, never guessed at. */
  | { kind: "unknown" };

/**
 * The qualified keyset-reference name a guard carries, in WHICHEVER of the
 * real-world shapes it happens to use — or `null` when it carries none.
 *
 * WHY this is shape-tolerant rather than reading one field: this codebase
 * genuinely has TWO declared spellings for the same idea, and real
 * persisted data uses both.
 *
 *  - `entities.ts`'s `IKeyset` (the type `IOuroAccount.guard` is declared
 *    as) annotates an EXPANDED keyset with `keysetRef?: string` —
 *    camelCase, already-qualified, e.g. `"ouronet-ns.dh_ah-keyset"`.
 *  - `GuardTree.tsx`'s `KeysetRefGuard` (the raw Pact wire shape) uses
 *    `keysetref: { ns, ksn }` — lowercase, nested, unqualified halves.
 *
 * `detectGuardKind` only recognises the SECOND as `"keyset-ref"`, and this
 * module only ever read the FIRST when classifying a `"keyset"`. So a
 * guard stored in any other combination — notably an expanded keyset
 * annotated with the lowercase spelling — resolved as a plain, unannotated
 * keyset, and every "this is a keyset-REFERENCE" affordance downstream
 * (`KeysetRefBadge` and the reference name beside it) silently vanished.
 * Owner, repeatedly, on real data: "it still doesnt show its a keyset-ref…
 * which should be shown there at the current guard."
 *
 * Accepts a bare string OR an `{ns, ksn}` pair under either spelling, and
 * never throws on a malformed one — an unreadable annotation is simply
 * "no annotation", never a crash.
 */
export function keysetRefNameOf(guard: unknown): string | null {
  if (typeof guard !== "object" || guard === null) return null;
  const g = guard as Record<string, unknown>;
  for (const key of ["keysetRef", "keysetref"]) {
    const raw = g[key];
    if (typeof raw === "string" && raw.length > 0) return raw;
    if (typeof raw === "object" && raw !== null) {
      const { ns, ksn } = raw as Record<string, unknown>;
      if (typeof ns === "string" && typeof ksn === "string" && ns && ksn) return `${ns}.${ksn}`;
    }
  }
  return null;
}

export async function resolveGuardKeys(
  guard: unknown,
  deps: ResolveGuardKeysDeps
): Promise<GuardKeyResolution> {
  if (guard === null || guard === undefined) return { kind: "none" };

  const detected = detectGuardKind(guard);

  if (detected === "keyset") {
    const g = guard as KeysetGuard;
    const viaRef = keysetRefNameOf(guard) ?? undefined;
    return {
      kind: "keyset",
      pred: g.pred,
      keys: [...g.keys],
      ...(viaRef !== undefined ? { viaRef } : {}),
    };
  }

  if (detected === "keyset-ref") {
    const g = guard as KeysetRefGuard;
    const ref = `${g.keysetref.ns}.${g.keysetref.ksn}`;
    try {
      const described = await deps.describeKeyset(ref);
      return { kind: "keyset-ref", ref, pred: described.pred, keys: [...described.keys] };
    } catch (e) {
      return {
        kind: "keyset-ref-unresolved",
        ref,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (detected === "capability" || detected === "user") {
    return { kind: "unsupported", guardKind: detected };
  }

  return { kind: "unknown" };
}

/** The keys a resolution authorizes, or `null` when the answer is genuinely
 *  unknown (an unresolved reference). `null` and `[]` mean different things
 *  and callers MUST distinguish them: `[]` is authoritative ("this guard
 *  names no keys"), `null` is "we could not find out". */
export function keysOf(resolution: GuardKeyResolution): string[] | null {
  switch (resolution.kind) {
    case "keyset":
    case "keyset-ref":
      return resolution.keys;
    case "none":
    case "unsupported":
      return [];
    case "keyset-ref-unresolved":
    case "unknown":
      return null;
  }
}
