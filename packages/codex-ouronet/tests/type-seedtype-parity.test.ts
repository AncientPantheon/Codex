/**
 * Compile-time parity proof: codex-ouronet's `SeedType`
 * (`src/types/entities.ts`) and codex-core's `StoaChainSeedType`
 * (`@ancientpantheon/codex-core`'s `resolver` subpath) must carry the exact
 * same set of literal members.
 *
 * WHY THIS EXISTS: these are two separately-declared unions (codex-core
 * cannot import codex-ouronet's types — it must stay Ouronet-free, per
 * `headlessResolver.ts`'s own module doc) that are supposed to describe the
 * same real-world fact: every seed label a `StoaChainSeed`/`IStoaChainSeed`
 * can carry. They drifted out of parity once already — `SeedType` gained
 * `"stoic"` and `StoaChainSeedType` didn't, breaking every headless-resolver
 * consumer's typecheck (e.g. Pythia's `keyResolver.ts`) the moment a real
 * `CodexSnapshot` carrying a stoic seed was fed into `SnapshotSlice`. The
 * `StoaChainSeedType` doc comment claiming a "verbatim mirror" was not
 * enforcement — this test is. Follows this codebase's own existing
 * "compile-time assignability proof" idiom (see the
 * `const asContract: IStoaChainKeypair = resolved;` lines in
 * `InternalCodexResolver.ts` and `headlessKadenaResolver.ts`) rather than
 * inventing a new mechanism.
 *
 * If a member is ever added to one union and not the other, `AssertExact`
 * resolves to `never` and `_seedTypeParity`'s assignment fails to compile —
 * `npm run typecheck --workspace=@ancientpantheon/codex-ouronet` breaks with a
 * type error pointing at this file, not a silent drift discovered downstream
 * in a consumer's own build.
 */
import { describe, it, expect } from "vitest";
import type { SeedType } from "../src/types/entities.js";
import type { StoaChainSeedType } from "@ancientpantheon/codex-core";

/** True iff `A` and `B` are the exact same union (mutual assignability in
 *  both directions) — `never` (not merely `false`) so a diverging union
 *  fails the assignment below at the type level, not just an `if` check. */
type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Fails `tsc` the instant SeedType and StoaChainSeedType diverge in either
// direction. Kept as a real (unused-at-runtime) `const`, not a `type`-only
// declaration, so a `.d.ts`-stripping build step cannot silently drop the check.
const _seedTypeParity: AssertExact<SeedType, StoaChainSeedType> = true;
void _seedTypeParity;

describe("SeedType / StoaChainSeedType parity", () => {
  it("both unions accept the exact same four literal seed-type values", () => {
    // Runtime companion to the compile-time proof above, so a test runner
    // that skips type-only files (no emitted JS from a bare `type` block)
    // still exercises SOMETHING for this file. Assigning each literal to
    // both types compiles only if both unions actually contain it.
    const bothTypesAccept = (v: SeedType & StoaChainSeedType): SeedType & StoaChainSeedType => v;

    const allFour: ReadonlyArray<SeedType & StoaChainSeedType> = [
      "koala",
      "chainweaver",
      "eckowallet",
      "stoic",
    ];

    for (const v of allFour) {
      expect(bothTypesAccept(v)).toBe(v);
    }
    expect(allFour).toHaveLength(4);
  });
});
