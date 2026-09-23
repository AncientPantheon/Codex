/**
 * Round 25 owner correction: "this seed, still doesnt show the seed words
 * when looking only the bitstring elements. Is this becuase it was created
 * before that could be captured, does this mean, i would need to remove
 * it and recreated it, because now the seed is captured?"
 *
 * Yes — this file is the actual fix. Mirrors `ForeignChainsWiring.tsx`'s
 * Chainweb-side counterpart (`IStoaChainSeed.wordsSecret`, landed a couple
 * of rounds ago): `revealArweaveSeedWords`/`createArweaveSeedPersistence`/
 * `toPanelArweaveSeeds` now round-trip a seed's real word list through a
 * SEPARATE encrypted `wordsSecret` envelope, the same way `bits`/`secret`
 * already round-trip the derived bitstring. Direct unit specs — these
 * three functions are pure/async and exported, no component mount needed.
 */

import { describe, it, expect } from "vitest";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";

import {
  toPanelArweaveSeeds,
  revealArweaveSeedBits,
  revealArweaveSeedWords,
  createArweaveSeedPersistence,
  type StoredArweaveSeed,
  type PanelArweaveSeed,
} from "../src/ForeignChainsWiring";

const PASSWORD = "hunter2";
const BITS = "1".repeat(1600);
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

describe("createArweaveSeedPersistence — round 25", () => {
  it("persists a SEPARATE wordsSecret when the panel seed carries real words", async () => {
    const stored: StoredArweaveSeed[] = [];
    const addArweaveSeed = createArweaveSeedPersistence({
      getPassword: () => PASSWORD,
      addArweaveSeed: async (seed) => {
        stored.push(seed);
      },
    });

    const seed: PanelArweaveSeed = { id: "s1", label: "My Seed", bits: BITS, words: WORDS };
    await addArweaveSeed(seed);

    expect(stored).toHaveLength(1);
    expect(stored[0]!.wordsSecret).toBeDefined();
    expect(stored[0]!.secret).toBeDefined();
    // Never the plaintext, in either field.
    expect(stored[0]!.secret).not.toContain(BITS);
    expect(stored[0]!.wordsSecret).not.toContain(WORDS.join(" "));
  });

  it("omits wordsSecret entirely when the panel seed has no words (Direct-mode)", async () => {
    const stored: StoredArweaveSeed[] = [];
    const addArweaveSeed = createArweaveSeedPersistence({
      getPassword: () => PASSWORD,
      addArweaveSeed: async (seed) => {
        stored.push(seed);
      },
    });

    await addArweaveSeed({ id: "s1", label: "Direct Seed", bits: BITS });

    expect(stored).toHaveLength(1);
    expect(stored[0]!.wordsSecret).toBeUndefined();
  });
});

describe("revealArweaveSeedWords — round 25", () => {
  it("decrypts wordsSecret back into the real word list", async () => {
    const wordsSecret = await encryptStringV2(WORDS.join(" "), PASSWORD);
    const seeds: StoredArweaveSeed[] = [
      { id: "s1", name: "My Seed", secret: "irrelevant-here", wordsSecret, createdAt: "2026-01-01T00:00:00.000Z" },
    ];

    const result = await revealArweaveSeedWords(seeds, () => PASSWORD);

    expect(result.s1).toEqual(WORDS);
  });

  it("contributes no entry for a seed with no wordsSecret — never a crash", async () => {
    const seeds: StoredArweaveSeed[] = [
      { id: "s1", name: "Direct Seed", secret: "irrelevant-here", createdAt: "2026-01-01T00:00:00.000Z" },
    ];

    const result = await revealArweaveSeedWords(seeds, () => PASSWORD);

    expect(result.s1).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("contributes no entry (never throws) when the codex is locked — same contract as revealArweaveSeedBits", async () => {
    const wordsSecret = await encryptStringV2(WORDS.join(" "), PASSWORD);
    const seeds: StoredArweaveSeed[] = [
      { id: "s1", name: "My Seed", secret: "irrelevant-here", wordsSecret, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const throwingGetPassword = (): string => {
      throw new Error("CodexLockedError: locked");
    };

    const result = await revealArweaveSeedWords(seeds, throwingGetPassword);

    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("toPanelArweaveSeeds — round 25", () => {
  it("attaches decrypted words onto the panel record when present", () => {
    const seeds: StoredArweaveSeed[] = [
      { id: "s1", name: "My Seed", secret: "ciphertext", createdAt: "2026-01-01T00:00:00.000Z" },
    ];

    const panelSeeds = toPanelArweaveSeeds(seeds, { s1: BITS }, { s1: WORDS });

    expect(panelSeeds[0]!.words).toEqual(WORDS);
  });

  it("omits words when the id has no entry in wordsById — a genuinely wordless or not-yet-decrypted seed", () => {
    const seeds: StoredArweaveSeed[] = [
      { id: "s1", name: "My Seed", secret: "ciphertext", createdAt: "2026-01-01T00:00:00.000Z" },
    ];

    const panelSeeds = toPanelArweaveSeeds(seeds, { s1: BITS });

    expect(panelSeeds[0]!.words).toBeUndefined();
  });

  it("omitting wordsById entirely is byte-identical to before this param existed", () => {
    const seeds: StoredArweaveSeed[] = [
      { id: "s1", name: "My Seed", secret: "ciphertext", createdAt: "2026-01-01T00:00:00.000Z" },
    ];

    const panelSeeds = toPanelArweaveSeeds(seeds, { s1: BITS });
    expect(panelSeeds).toEqual([{ id: "s1", label: "My Seed", bits: BITS }]);
  });
});

describe("round-trip — define a seed with words, reload, and get the same words back", () => {
  it("persists then re-reveals the identical word list", async () => {
    let stored: StoredArweaveSeed | null = null;
    const persist = createArweaveSeedPersistence({
      getPassword: () => PASSWORD,
      addArweaveSeed: async (seed) => {
        stored = seed;
      },
    });
    await persist({ id: "s1", label: "My Seed", bits: BITS, words: WORDS });
    expect(stored).not.toBeNull();

    // "reload" — decrypt both envelopes from the persisted record, exactly
    // as `ForeignChainsWiring`'s own effect does on every mount.
    const bitsById = await revealArweaveSeedBits([stored!], () => PASSWORD);
    const wordsById = await revealArweaveSeedWords([stored!], () => PASSWORD);
    const panelSeeds = toPanelArweaveSeeds([stored!], bitsById, wordsById);

    expect(panelSeeds[0]!.bits).toBe(BITS);
    expect(panelSeeds[0]!.words).toEqual(WORDS);
  });
});
