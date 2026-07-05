/**
 * Seed display-name helpers — ported 1:1 from OuronetUI's
 * `src/lib/seed-utils.ts` so the packaged CodexUI labels seeds identically
 * to the legacy My Codex page.
 *
 * Prime-seed rule: the codex's prime seed always reads "Prime Codex Seed",
 * whether it's flagged via `isPrime`, sits at index 0, or still carries the
 * historical "Initial Seed" name from older codices.
 */

import type { IKadenaSeed } from "../../types/entities.js";

export function getSeedDisplayName(
  seed: IKadenaSeed,
  seedIndexOrSeeds: number | IKadenaSeed[],
): string {
  const idx = Array.isArray(seedIndexOrSeeds)
    ? seedIndexOrSeeds.indexOf(seed)
    : seedIndexOrSeeds;

  if (seed.isPrime || idx === 0 || seed.name === "Initial Seed") {
    return "Prime Codex Seed";
  }

  return seed.name || (idx >= 0 ? `Seed #${idx + 1}` : seed.id.slice(0, 8));
}

/**
 * sortSeeds — prime seed first, the rest alphabetically by display name.
 * Returns a new array; does not mutate the input.
 */
export function sortSeeds(seeds: IKadenaSeed[]): IKadenaSeed[] {
  if (seeds.length <= 1) return seeds;
  const primeIdx = seeds.findIndex((s, i) => s.isPrime || i === 0 || s.name === "Initial Seed");
  const prime = seeds[primeIdx >= 0 ? primeIdx : 0];
  const rest = seeds.filter((s) => s !== prime);
  const sorted = [...rest].sort((a, b) =>
    getSeedDisplayName(a, seeds).toLowerCase().localeCompare(
      getSeedDisplayName(b, seeds).toLowerCase(),
    ),
  );
  return [prime, ...sorted];
}
