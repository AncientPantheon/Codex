// @vitest-environment node
/**
 * resolve-master-arweave-seed.test.ts — the precedence chain behind which
 * Arweave seed row is the codex's MASTER (first position, gold styling).
 *
 * Why this helper exists at all, and why it is tested apart from the surface
 * that renders it: the eligibility wizard RENAMES the master
 * (`MASTER_ARWEAVE_SEED` moves to the newly derived seed, the previous holder
 * becomes "Arweave Seed N") but deliberately does NOT move the persisted
 * `isPrime` flag — that flag records the FIRST seed ever added, and
 * `addArweaveSeed` throws `id-conflict` on a second explicit prime. Ordering
 * and gold followed `isPrime`, so on a codex that already had an Arweave seed
 * the DEMOTED seed kept position one and the gold, and the real new master sat
 * grey further down: the inverse of what the owner asked for.
 *
 * Each case guards a distinct regression:
 *   (settled) the bug itself — a settled `codexMasterSeed.arweaveSeedId` must
 *       outrank a stale `isPrime` stamp sitting on some other seed.
 *   (absent/empty) BACKWARDS COMPATIBILITY: a codex that never ran the wizard
 *       has no `codexMasterSeed`, or a row with no `arweaveSeedId` at all, and
 *       must order and colour exactly as it always has.
 *   (unknown id) a dangling id (seed deleted, codex half-restored) must still
 *       yield SOME master, or the surface renders no gold row at all.
 *   (no isPrime anywhere) the pre-existing positional fallback — a codex whose
 *       seeds were never flagged still has a first row.
 *   (empty) no seeds means no master, not a crash — the surface shows its
 *       "undefined" define row instead.
 */

import { describe, it, expect } from "vitest";

import { resolveMasterArweaveSeed } from "../src/panel/resolveMasterArweaveSeed.js";

/** The owner's reported shape: the legacy first-ever seed still carries
 *  `isPrime`, the newly derived master carries only the title. */
const LEGACY = { id: "legacy", isPrime: true };
const NEW_MASTER = { id: "new-master" };
const SEEDS = [LEGACY, NEW_MASTER];

describe("resolveMasterArweaveSeed — the master-row precedence chain", () => {
  it("returns the seed `codexMasterSeed.arweaveSeedId` names, even when ANOTHER seed carries isPrime", () => {
    expect(resolveMasterArweaveSeed(SEEDS, "new-master")).toBe(NEW_MASTER);
  });

  it("falls back to the isPrime seed when no master arweave seed id is settled (undefined)", () => {
    expect(resolveMasterArweaveSeed(SEEDS, undefined)).toBe(LEGACY);
  });

  it("falls back to the isPrime seed when the settled id is empty or null — a half-written row is not an identity", () => {
    expect(resolveMasterArweaveSeed(SEEDS, "")).toBe(LEGACY);
    expect(resolveMasterArweaveSeed(SEEDS, null)).toBe(LEGACY);
  });

  it("falls back to the isPrime seed when the settled id names a seed that is not in the list", () => {
    expect(resolveMasterArweaveSeed(SEEDS, "deleted-seed")).toBe(LEGACY);
  });

  it("falls back to the FIRST seed when nothing carries isPrime — the pre-existing positional rule", () => {
    const unflagged = [{ id: "a" }, { id: "b" }];
    expect(resolveMasterArweaveSeed(unflagged, undefined)).toBe(unflagged[0]);
    expect(resolveMasterArweaveSeed(unflagged, "nope")).toBe(unflagged[0]);
  });

  it("returns undefined for an empty list, with or without a settled id", () => {
    expect(resolveMasterArweaveSeed([], "new-master")).toBeUndefined();
    expect(resolveMasterArweaveSeed([], undefined)).toBeUndefined();
  });

  it("prefers an isPrime seed over list position, wherever in the list it sits", () => {
    // The rule this helper absorbs (`all.find((s) => s.isPrime === true) ??
    // all[0]`) is order-independent: a codex whose prime seed is not the first
    // element of the host's snapshot still puts the prime first.
    const seeds = [{ id: "a", isPrime: false }, { id: "b", isPrime: true }];
    expect(resolveMasterArweaveSeed(seeds, undefined)).toBe(seeds[1]);
  });
});
