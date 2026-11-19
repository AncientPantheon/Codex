/**
 * T1/T2 of `docs/work/wizard-seed-dashboard/plan.md` and
 * `docs/work/wizard-seed-dashboard-refinements/plan.md` — the pure,
 * React-free seed-attribution helpers behind the migration wizard's
 * "Settling Dashboard" (`docs/work/wizard-seed-dashboard-refinements/
 * design.md`): one CARD per seed, one SUB-ROW per distinct derivation
 * label in play for that seed this run.
 */

import { describe, it, expect } from "vitest";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import {
  findSeedIdForKey,
  pureKeypairBacksRole,
  accountOwnKeyBacksRole,
  computeSeedDashboardCards,
  resolveArweaveMatchSeedId,
  resolveAccountSeedId,
  codexHoldsMasterArweaveAccounts,
  STOIC_DALOS_DERIVATION_LABEL,
} from "../src/ui/internal/seedDashboard.js";
import type { IStoaChainSeed, IArweaveSeed, IPureKeypair } from "../src/types/entities.js";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";

const PASSWORD = "seed-dashboard-test-pw";

function seed(id: string, publicKeys: readonly string[], seedType: IStoaChainSeed["seedType"] = "stoic"): IStoaChainSeed {
  return {
    id, name: `Seed ${id}`, seedType, version: "1.0", index: 0,
    secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
    accounts: publicKeys.map((publicKey, index) => ({ index, publicKey, derivationPath: `m/${index}` })),
  };
}

/** Hoisted to module scope (`arweave-master-accounts` T1) from the
 *  `resolveArweaveMatchSeedId` / `resolveAccountSeedId` blocks that each
 *  had their own copy, so `codexHoldsMasterArweaveAccounts` — which does
 *  the SAME decrypt-and-compare against the SAME `IArweaveSeed` shape —
 *  reuses these exact fixtures instead of a third parallel set. */
const realSmartDecrypt = async (ciphertext: string, password: string): Promise<string> => {
  const { smartDecrypt } = await import("@stoachain/stoa-core/crypto");
  return smartDecrypt(ciphertext, password);
};

function arweaveSeed(id: string, secret: string, isPrime = false): IArweaveSeed {
  return { id, secret, createdAt: "2026-01-01T00:00:00.000Z", isPrime };
}

const ACCOUNT_KEY = "a".repeat(64);
const PAYMENT_KEY = "b".repeat(64);
const GUARD_KEY_1 = "c".repeat(64);
const GUARD_KEY_2 = "d".repeat(64);
const UNMATCHED_KEY = "f".repeat(64);

describe("findSeedIdForKey", () => {
  const seeds = [seed("seed-1", [ACCOUNT_KEY]), seed("seed-2", [PAYMENT_KEY])];

  it("returns the owning seed's id, stripping an optional k: prefix", () => {
    expect(findSeedIdForKey(ACCOUNT_KEY, seeds)).toBe("seed-1");
    expect(findSeedIdForKey(`k:${PAYMENT_KEY}`, seeds)).toBe("seed-2");
  });

  it("returns null for a key no seed holds, and for null/empty input, without throwing", () => {
    expect(findSeedIdForKey(UNMATCHED_KEY, seeds)).toBeNull();
    expect(findSeedIdForKey(null, seeds)).toBeNull();
    expect(findSeedIdForKey("", seeds)).toBeNull();
  });
});

function pureKeypair(id: string, publicKey: string): IPureKeypair {
  return { id, publicKey, encryptedPrivateKey: "ct", createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("pureKeypairBacksRole", () => {
  const pureKeypairs = [pureKeypair("pk-1", ACCOUNT_KEY)];

  it("returns true for a k:-prefixed key matching a pure keypair's publicKey", () => {
    expect(pureKeypairBacksRole(`k:${ACCOUNT_KEY}`, pureKeypairs)).toBe(true);
  });

  it("returns true for a bare-hex key matching a pure keypair's publicKey", () => {
    expect(pureKeypairBacksRole(ACCOUNT_KEY, pureKeypairs)).toBe(true);
  });

  it("returns false for a key no pure keypair holds, and for null/undefined/empty input, without throwing", () => {
    expect(pureKeypairBacksRole(UNMATCHED_KEY, pureKeypairs)).toBe(false);
    expect(pureKeypairBacksRole(null, pureKeypairs)).toBe(false);
    expect(pureKeypairBacksRole(undefined, pureKeypairs)).toBe(false);
    expect(pureKeypairBacksRole("", pureKeypairs)).toBe(false);
  });
});

describe("accountOwnKeyBacksRole", () => {
  const DALOS_KEY = ACCOUNT_KEY;
  const PAYMENT_KEY = "d".repeat(64);
  const full = { publicKey: DALOS_KEY, stoaChainLedger: `k:${PAYMENT_KEY}` };

  it("matches the account's own DALOS publicKey, k:-prefixed or bare", () => {
    expect(accountOwnKeyBacksRole(DALOS_KEY, full)).toBe(true);
    expect(accountOwnKeyBacksRole(`k:${DALOS_KEY}`, full)).toBe(true);
  });

  // Owner (live testing, real data): AncientHodler's 2-key guard names its
  // own PAYMENT key — `stoaChainLedger`, stored `k:`-prefixed — not its
  // DALOS `publicKey`. Checking only the latter under-counted the keyset.
  it("matches the account's own PAYMENT key (stoaChainLedger), k:-prefixed or bare", () => {
    expect(accountOwnKeyBacksRole(PAYMENT_KEY, full)).toBe(true);
    expect(accountOwnKeyBacksRole(`k:${PAYMENT_KEY}`, full)).toBe(true);
  });

  it("returns false for a key the account does not own, and for null/undefined/empty input", () => {
    expect(accountOwnKeyBacksRole(UNMATCHED_KEY, full)).toBe(false);
    expect(accountOwnKeyBacksRole(null, full)).toBe(false);
    expect(accountOwnKeyBacksRole(undefined, full)).toBe(false);
    expect(accountOwnKeyBacksRole("", full)).toBe(false);
    expect(accountOwnKeyBacksRole(DALOS_KEY, null)).toBe(false);
  });

  // Owner (live testing): clicking "keep the guard as is" CRASHED the
  // wizard — `Cannot read properties of undefined (reading 'startsWith')`
  // from this exact helper. `IOuroAccount` types `publicKey` as a required
  // string and `stoaChainLedger` as `string | null`, but the real
  // legacy/imported accounts this wizard exists to rescue carry neither
  // reliably. An attribution helper must degrade to "no match", never take
  // the screen down.
  it("never throws when the account's own key fields are absent, null, or not strings", () => {
    const shapes: unknown[] = [
      {},
      { publicKey: undefined, stoaChainLedger: undefined },
      { publicKey: null, stoaChainLedger: null },
      { publicKey: "", stoaChainLedger: "" },
      { publicKey: 42, stoaChainLedger: { nested: true } },
    ];
    for (const shape of shapes) {
      expect(() =>
        accountOwnKeyBacksRole(DALOS_KEY, shape as Parameters<typeof accountOwnKeyBacksRole>[1]),
      ).not.toThrow();
      expect(
        accountOwnKeyBacksRole(DALOS_KEY, shape as Parameters<typeof accountOwnKeyBacksRole>[1]),
      ).toBe(false);
    }
  });

  it("still matches the PAYMENT key when the DALOS publicKey is missing entirely", () => {
    const partial = { stoaChainLedger: `k:${PAYMENT_KEY}` };
    expect(
      accountOwnKeyBacksRole(PAYMENT_KEY, partial as Parameters<typeof accountOwnKeyBacksRole>[1]),
    ).toBe(true);
  });
});

describe("computeSeedDashboardCards", () => {
  it("a seed backing only the account produces one card with one sub-row, labelled STOIC_DALOS_DERIVATION_LABEL", () => {
    const seeds = [seed("seed-1", [ACCOUNT_KEY])];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-1", paymentSeedId: null, guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.seedId).toBe("seed-1");
    expect(cards[0]!.seedName).toBe("Codex Master Seed");
    expect(cards[0]!.subRows).toEqual([
      { label: STOIC_DALOS_DERIVATION_LABEL, accountMatch: true, paymentMatch: false, guardCount: 0, arweaveMatch: false },
    ]);
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 5):
  // "Master Chainweb seed becomes the seed that is responsible for the
  // Payment Key. It shifted. This musnt be possible. The Master Seed is
  // the seed responsible for the Selected Ouronet Account. PERIOD." —
  // `computeSeedDashboardCards` used to name EVERY card via
  // `masterChainwebSeedName(index, isPrime, name)` (the codex-WIDE
  // positional convention, correct for the general "Seeds" tab, wrong
  // here) regardless of which role it actually backed. Naming is now
  // keyed SOLELY to `accountMatch` — the "Codex Master Seed" label
  // (round 8 owner correction: "The name is Codex Master Seed Not
  // Master Chainweb Seed" — `masterNames.ts`'s own first-class concept
  // for "the one seed behind all three" roles, the exact thing this
  // dashboard's account-matching card represents) belongs to whichever
  // seed backs the CHOSEN account this run, never to array position or
  // `isPrime`, which can easily be a totally different, unrelated seed
  // once the user picks a non-prime account.
  it("names the card 'Codex Master Seed' for the seed backing the chosen account, regardless of array position or isPrime", () => {
    const seeds = [seed("seed-not-prime", [ACCOUNT_KEY])]; // isPrime undefined, index 0 — only "Master" because it's the account's own seed
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-not-prime", paymentSeedId: null, guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards[0]!.seedName).toBe("Codex Master Seed");
  });

  it("shows a seed's OWN stored name — never 'Codex Master Seed' — when it backs a role but is NOT the seed backing the chosen account, even if it is isPrime/array position 0", () => {
    const primeButUnrelated = { ...seed("seed-prime-unrelated", []), isPrime: true, name: "Old Prime Seed" };
    const paymentBacker = seed("seed-payment-backer", [], "koala");
    const seeds = [primeButUnrelated, paymentBacker];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-somewhere-else-not-in-this-list", // no real match in `seeds` at all
      paymentSeedId: "seed-payment-backer", guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards).toHaveLength(1); // primeButUnrelated backs nothing — omitted entirely
    expect(cards[0]!.seedId).toBe("seed-payment-backer");
    expect(cards[0]!.seedName).toBe("Seed seed-payment-backer"); // its own stored name
  });

  it("falls back to a generic 'Seed' label for a non-account card with no stored name at all", () => {
    const unnamed: IStoaChainSeed = { ...seed("seed-unnamed", [], "koala"), name: undefined };
    const cards = computeSeedDashboardCards([unnamed], {
      accountSeedId: null, paymentSeedId: "seed-unnamed", guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards[0]!.seedName).toBe("Seed");
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 7):
  // "the seed responsible for it is the Seed that is called Prime Codex
  // Seed, (not Initial Seed), (initial Seed was an ancient designation
  // we used in the very beginning, which may now have lingered with
  // this designation even still as it seems)." A seed that IS the
  // codex's own genuine prime/genesis seed (`isPrime: true`, or still
  // carrying the legacy literal name "Initial Seed" from older codices
  // — the SAME legacy marker `seedNames.ts`'s own `getSeedDisplayName`
  // already recognizes) but happens NOT to be the seed backing the
  // CURRENTLY chosen account (round 5's `accountMatch` rule) shows
  // "Prime Codex Seed" — honoring what it genuinely is — rather than
  // either "Codex Master Seed" (reserved for the account's own
  // match) or the confusing raw legacy string "Initial Seed".
  it("shows 'Prime Codex Seed' for a non-account-matching seed flagged isPrime", () => {
    const primeSeed = { ...seed("seed-prime", [], "koala"), isPrime: true, name: "Some Stored Name" };
    const cards = computeSeedDashboardCards([primeSeed], {
      accountSeedId: "seed-elsewhere", paymentSeedId: "seed-prime", guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards[0]!.seedName).toBe("Prime Codex Seed");
  });

  it("shows 'Prime Codex Seed' for a non-account-matching seed whose stored name is the legacy 'Initial Seed' placeholder", () => {
    const legacySeed = { ...seed("seed-legacy", [], "koala"), name: "Initial Seed" };
    const cards = computeSeedDashboardCards([legacySeed], {
      accountSeedId: "seed-elsewhere", paymentSeedId: "seed-legacy", guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards[0]!.seedName).toBe("Prime Codex Seed");
  });

  // Owner (same round, screenshot 2): "the Master Seed must always be
  // shown on the first position... The Other Seeds that are
  // responsible for the Selected Keys, must follow beneath it."
  it("always lists the account-matching card FIRST, regardless of its position in the seeds array", () => {
    const paymentBacker = seed("seed-payment-backer", [], "koala");
    const accountSeed = seed("seed-account", [], "koala");
    // Account's own seed listed SECOND in the array — the card order
    // must not simply mirror array order.
    const cards = computeSeedDashboardCards([paymentBacker, accountSeed], {
      accountSeedId: "seed-account", paymentSeedId: "seed-payment-backer",
      guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards.map((c) => c.seedId)).toEqual(["seed-account", "seed-payment-backer"]);
  });

  // Owner (same round): "with the default selection, this same Master
  // Seed would be responsible for generation of the payment key... thus
  // also green ticker." A freshly-DERIVED payment/guard key (the
  // wizard's own default "derive from this account's words" choice) is
  // never recorded in any seed's `accounts[]` yet, so key-matching can
  // never attribute it anywhere — the caller must instead attribute it
  // directly to whichever seed id the ACCOUNT role itself resolved to
  // (same underlying material). `paymentSeedId`/`guardSeedIds` are
  // therefore already-resolved ids, exactly like `accountSeedId` always
  // was — this module does no key search at all anymore (see
  // `findSeedIdForKey`'s own tests above for that half, now the
  // CALLER's responsibility).
  it("merges the account and a default-derived payment key onto ONE sub-row when the backing seed's seedType is stoic", () => {
    const seeds = [seed("seed-1", [ACCOUNT_KEY, PAYMENT_KEY], "stoic")];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-1", paymentSeedId: "seed-1", guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.subRows).toHaveLength(1);
    expect(cards[0]!.subRows[0]).toMatchObject({
      label: STOIC_DALOS_DERIVATION_LABEL, accountMatch: true, paymentMatch: true,
    });
  });

  it("splits into TWO sub-rows when payment traces to a DIFFERENT derivation label than the account, on the SAME seed", () => {
    const seeds = [seed("seed-1", [ACCOUNT_KEY, PAYMENT_KEY], "koala")];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-1", paymentSeedId: "seed-1", guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.subRows).toHaveLength(2);
    expect(cards[0]!.subRows).toContainEqual(
      { label: STOIC_DALOS_DERIVATION_LABEL, accountMatch: true, paymentMatch: false, guardCount: 0, arweaveMatch: false },
    );
    expect(cards[0]!.subRows).toContainEqual(
      { label: "Koala Derivation", accountMatch: false, paymentMatch: true, guardCount: 0, arweaveMatch: false },
    );
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 5):
  // "With the default option the Same Master Seed would be responsible
  // for the Ouronet Account (previous selection, so blue ticker), and
  // the payment key, thus also green ticker." The Payment step's own
  // "Derivation method" copy for the "derive a new one" choice is fixed
  // — "Stoic Dalos Derivation" — regardless of what wallet the BACKING
  // seed itself historically came from (koala here). `paymentIsStoicDerived`
  // overrides the per-seed-type label so the derived key merges onto the
  // SAME sub-row as the account, never splitting onto a second
  // "Koala Derivation" row the way an EXISTING, already-recorded koala
  // key correctly would (the test just above, without this flag).
  it("merges payment onto the account's own sub-row when paymentIsStoicDerived is true, even on a non-stoic seed", () => {
    const seeds = [seed("seed-1", [ACCOUNT_KEY, PAYMENT_KEY], "koala")];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-1", paymentSeedId: "seed-1", paymentIsStoicDerived: true,
      guardSeedIds: null, arweaveMatchSeedId: null,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.subRows).toEqual([
      { label: STOIC_DALOS_DERIVATION_LABEL, accountMatch: true, paymentMatch: true, guardCount: 0, arweaveMatch: false },
    ]);
  });

  it("merges guard onto the account's own sub-row when guardIsStoicDerived is true, even on a non-stoic seed", () => {
    const seeds = [seed("seed-1", [ACCOUNT_KEY, GUARD_KEY_1], "chainweaver")];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-1", paymentSeedId: null,
      guardSeedIds: ["seed-1"], guardIsStoicDerived: true, arweaveMatchSeedId: null,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.subRows).toEqual([
      { label: STOIC_DALOS_DERIVATION_LABEL, accountMatch: true, paymentMatch: false, guardCount: 1, arweaveMatch: false },
    ]);
  });

  it("splits a guard key across two different seeds, each with its own sub-row labelled by its own derivation", () => {
    const seeds = [
      seed("seed-1", [GUARD_KEY_1], "koala"),
      seed("seed-2", [GUARD_KEY_2], "chainweaver"),
    ];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: null, paymentSeedId: null,
      guardSeedIds: ["seed-1", "seed-2"], arweaveMatchSeedId: null,
    });
    expect(cards).toHaveLength(2);
    const card1 = cards.find((c) => c.seedId === "seed-1")!;
    const card2 = cards.find((c) => c.seedId === "seed-2")!;
    expect(card1.subRows).toEqual([
      { label: "Koala Derivation", accountMatch: false, paymentMatch: false, guardCount: 1, arweaveMatch: false },
    ]);
    expect(card2.subRows).toEqual([
      { label: "Chainweaver Derivation", accountMatch: false, paymentMatch: false, guardCount: 1, arweaveMatch: false },
    ]);
  });

  it("a payment/guard seed id matching no seed in the list contributes to no card and never throws", () => {
    const seeds = [seed("seed-1", [ACCOUNT_KEY])];
    expect(() =>
      computeSeedDashboardCards(seeds, {
        accountSeedId: null, paymentSeedId: "no-such-seed",
        guardSeedIds: ["no-such-seed"], arweaveMatchSeedId: null,
      }),
    ).not.toThrow();
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: null, paymentSeedId: "no-such-seed",
      guardSeedIds: ["no-such-seed"], arweaveMatchSeedId: null,
    });
    expect(cards).toEqual([]);
  });

  it("a seed backing only the Arweave match produces one card with one sub-row labelled STOIC_DALOS_DERIVATION_LABEL", () => {
    const seeds = [seed("seed-1", [])];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: null, paymentSeedId: null, guardSeedIds: null, arweaveMatchSeedId: "seed-1",
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.subRows).toEqual([
      { label: STOIC_DALOS_DERIVATION_LABEL, accountMatch: false, paymentMatch: false, guardCount: 0, arweaveMatch: true },
    ]);
  });

  it("the Arweave match merges onto an existing STOIC_DALOS_DERIVATION_LABEL sub-row rather than creating a second one", () => {
    const seeds = [seed("seed-1", [ACCOUNT_KEY])];
    const cards = computeSeedDashboardCards(seeds, {
      accountSeedId: "seed-1", paymentSeedId: null, guardSeedIds: null, arweaveMatchSeedId: "seed-1",
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.subRows).toHaveLength(1);
    expect(cards[0]!.subRows[0]).toMatchObject({ accountMatch: true, arweaveMatch: true });
  });

  it("returns [] when seeds is [] or nothing matches", () => {
    expect(computeSeedDashboardCards([], {
      accountSeedId: "seed-1", paymentSeedId: null, guardSeedIds: null, arweaveMatchSeedId: null,
    })).toEqual([]);
    const seeds = [seed("seed-1", [ACCOUNT_KEY])];
    expect(computeSeedDashboardCards(seeds, {
      accountSeedId: "some-other-seed-id", paymentSeedId: null, guardSeedIds: null, arweaveMatchSeedId: null,
    })).toEqual([]);
  });
});

describe("resolveArweaveMatchSeedId", () => {
  it("returns the id of the candidate seed whose decrypted secret exactly matches the prime Arweave seed's", async () => {
    const BITS = "1".repeat(1600);
    const encrypted = await encryptStringV2(BITS, PASSWORD);
    const otherEncrypted = await encryptStringV2("0".repeat(1600), PASSWORD);
    const seeds = [
      seed("seed-1", []),
      { ...seed("seed-2", []), secret: encrypted },
    ];
    seeds[0]!.secret = otherEncrypted;

    const result = await resolveArweaveMatchSeedId({
      arweaveSeeds: [arweaveSeed("prime-arweave", encrypted, true)],
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBe("seed-2");
  });

  it("returns null when no arweaveSeeds entry has isPrime: true", async () => {
    const encrypted = await encryptStringV2("1".repeat(1600), PASSWORD);
    const result = await resolveArweaveMatchSeedId({
      arweaveSeeds: [arweaveSeed("not-prime", encrypted, false)],
      candidateSeeds: [{ ...seed("seed-1", []), secret: encrypted }],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBeNull();
  });

  it("returns null when password is null", async () => {
    const encrypted = await encryptStringV2("1".repeat(1600), PASSWORD);
    const result = await resolveArweaveMatchSeedId({
      arweaveSeeds: [arweaveSeed("prime-arweave", encrypted, true)],
      candidateSeeds: [{ ...seed("seed-1", []), secret: encrypted }],
      password: null,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBeNull();
  });

  it("returns null (not a rejection) when smartDecrypt rejects for every call", async () => {
    const result = await resolveArweaveMatchSeedId({
      arweaveSeeds: [arweaveSeed("prime-arweave", "whatever-ciphertext", true)],
      candidateSeeds: [seed("seed-1", [])],
      password: PASSWORD,
      smartDecrypt: async () => { throw new Error("boom"); },
    });
    expect(result).toBeNull();
  });
});

describe("resolveAccountSeedId", () => {
  const WORDS = "river stone ember garden lantern";
  const WORDS_ARR = WORDS.split(" ");
  const BITS = seedWordsToBitString(WORDS_ARR);
  const OTHER_BITS = seedWordsToBitString("totally different words entirely here".split(" "));

  it("returns the id of the candidate seed whose own decrypted bitstring matches the account's decrypted WORDS (re-derived, not compared raw)", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const matchingSeedSecret = await encryptStringV2(BITS, PASSWORD);
    const otherSeedSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const seeds = [
      { ...seed("seed-other", []), secret: otherSeedSecret },
      { ...seed("seed-match", []), secret: matchingSeedSecret },
    ];

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBe("seed-match");
  });

  it("never returns a seed whose decrypted bitstring does not match, even when listed first", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const otherSeedSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const seeds = [{ ...seed("seed-other", []), secret: otherSeedSecret }];

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBeNull();
  });

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 2):
  // "when i choose another ouronet account as being selected, the same
  // seed displays, which is... incorrect." Root cause: this function
  // ALWAYS treated a CANDIDATE seed's own decrypted `secret` as an
  // already-the-bitstring value — true only for `seedType: "stoic"`
  // (see `entities.ts`'s own doc comment, the SAME distinction
  // `SeedRevealModal.tsx` had to learn last round). For koala/
  // chainweaver/eckowallet candidates, `secret` decrypts to the real
  // MNEMONIC directly — comparing that raw words string against the
  // account's own derived BITSTRING can never equal, so a real match
  // against a non-stoic seed silently failed every time, leaving the
  // dashboard showing whatever seed id it last resolved (stale/wrong).
  it("matches a candidate seed whose OWN secret is the real mnemonic directly (koala/chainweaver/eckowallet, never a bitstring) by converting it before comparing", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const koalaSeedSecret = await encryptStringV2(WORDS, PASSWORD); // koala's own secret IS the mnemonic, same words
    const seeds = [{ ...seed("seed-koala", [], "koala"), secret: koalaSeedSecret }];

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBe("seed-koala");
  });

  it("never falsely matches a non-stoic candidate whose real mnemonic differs from the account's own words", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const koalaSeedSecret = await encryptStringV2("totally different words entirely here", PASSWORD);
    const seeds = [{ ...seed("seed-koala", [], "koala"), secret: koalaSeedSecret }];

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBeNull();
  });

  // Same class of bug, the OTHER side: an `IOuroAccount`'s own `secret`
  // is whatever its `originMode` says it is (`SpawnAccountModal.tsx`'s
  // five tabs: seedWords/bitmap/bitString/integerBase10/integerBase49),
  // NEVER unconditionally "words" — a real, legacy/imported account (the
  // whole class this wizard exists to rescue) can easily have been
  // created via ANY of those modes. Re-deriving via `bitStringOf`
  // (`codex-identity/rebuildFullKey.ts`, the SAME helper the real seed-
  // reveal flows already use) handles every mode correctly instead of
  // assuming "words" and corrupting anything that isn't.
  it("resolves correctly for an account whose own secret is NOT seed words (originMode: 'bitString') — re-derives via the account's own origin mode instead of assuming words", async () => {
    const accountSecret = await encryptStringV2(BITS, PASSWORD); // bitString-origin: secret IS the bitstring directly
    const matchingSeedSecret = await encryptStringV2(BITS, PASSWORD);
    const seeds = [{ ...seed("seed-match", []), secret: matchingSeedSecret }];

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address", originMode: "bitString" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBe("seed-match");
  });

  it("returns null when account is null", async () => {
    const matchingSeedSecret = await encryptStringV2(BITS, PASSWORD);
    const result = await resolveAccountSeedId({
      account: null,
      candidateSeeds: [{ ...seed("seed-match", []), secret: matchingSeedSecret }],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBeNull();
  });

  it("returns null when password is null", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const matchingSeedSecret = await encryptStringV2(BITS, PASSWORD);
    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: [{ ...seed("seed-match", []), secret: matchingSeedSecret }],
      password: null,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toBeNull();
  });

  it("returns null (not a rejection) when smartDecrypt rejects for every call", async () => {
    const result = await resolveAccountSeedId({
      account: { secret: "whatever-ciphertext", address: "Ѻ.test-address" },
      candidateSeeds: [seed("seed-1", [])],
      password: PASSWORD,
      smartDecrypt: async () => { throw new Error("boom"); },
    });
    expect(result).toBeNull();
  });

  // `settled-master-identity/design.md` §2 — "`parentSeedId` reorders the
  // search; it never replaces verification". Each decrypt here is a real
  // PBKDF2 at 600,000 iterations run SERIALLY, so with N seeds the blue
  // ticker used to wait on up to N+1 of them. Counting the ciphertexts
  // actually handed to `smartDecrypt` is the only honest way to assert
  // that work was skipped — asserting the returned id alone would pass
  // just as well with no ordering and no cache at all.
  //
  // Every ciphertext below comes from its own `encryptStringV2` call, so
  // each carries its own random salt/IV and is therefore a unique
  // identifier for "which entity was decrypted" even when two entities
  // hold the SAME plaintext.
  function countingDecrypt(): {
    calls: string[];
    decrypt: (ciphertext: string, password: string) => Promise<string>;
  } {
    const calls: string[] = [];
    return {
      calls,
      decrypt: async (ciphertext: string, password: string): Promise<string> => {
        calls.push(ciphertext);
        return realSmartDecrypt(ciphertext, password);
      },
    };
  }

  it("decrypts the seed named by parentSeedId FIRST, resolving in exactly two decrypts (the account's own, then that one seed's)", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const otherSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const matchSecret = await encryptStringV2(BITS, PASSWORD);
    const thirdSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    // The genuinely matching seed sits LAST, so a plain in-order scan
    // would need all three candidate decrypts to find it.
    const seeds = [
      { ...seed("seed-other", []), secret: otherSecret },
      { ...seed("seed-third", []), secret: thirdSecret },
      { ...seed("seed-match", []), secret: matchSecret },
    ];
    const { calls, decrypt } = countingDecrypt();

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address", parentSeedId: "seed-match" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: decrypt,
    });
    expect(result).toBe("seed-match");
    expect(calls).toEqual([accountSecret, matchSecret]);
  });

  // The whole point of the design: `parentSeedId` is a creation-time
  // provenance stamp, structurally identical to `originSeedTab` — which
  // this very wizard already learned is "never derived from, or verified
  // against, the actual stored secret" and misreported BOTH ways on the
  // owner's real codex. A stale/wrong stamp must therefore cost one
  // wasted decrypt and nothing else, never a wrong attribution of the
  // seed behind a funds-bearing account.
  it("still resolves to the genuinely matching seed when parentSeedId names a seed whose bitstring does NOT match", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const wrongSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const matchSecret = await encryptStringV2(BITS, PASSWORD);
    const seeds = [
      { ...seed("seed-wrong", []), secret: wrongSecret },
      { ...seed("seed-match", []), secret: matchSecret },
    ];
    const { calls, decrypt } = countingDecrypt();

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address", parentSeedId: "seed-wrong" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: decrypt,
    });
    expect(result).toBe("seed-match");
    // The falsely-claimed parent was verified (and rejected) first, and
    // the fall-through scan did NOT decrypt it a second time.
    expect(calls).toEqual([accountSecret, wrongSecret, matchSecret]);
  });

  it("ignores a parentSeedId naming a seed absent from candidateSeeds — resolves correctly, in the original order, without throwing", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const otherSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const matchSecret = await encryptStringV2(BITS, PASSWORD);
    const seeds = [
      { ...seed("seed-other", []), secret: otherSecret },
      { ...seed("seed-match", []), secret: matchSecret },
    ];
    const { calls, decrypt } = countingDecrypt();

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address", parentSeedId: "ghost-seed-not-in-this-codex" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: decrypt,
    });
    expect(result).toBe("seed-match");
    expect(calls).toEqual([accountSecret, otherSecret, matchSecret]);
  });

  // `entities.ts`: `parentSeedId` is "Undefined for pure-keypair-derived
  // accounts and for legacy accounts imported from v0.1.0 backups" — i.e.
  // exactly the class of account this wizard exists to rescue. Those must
  // keep getting today's full scan, in today's order.
  it("behaves exactly as before for an account with no parentSeedId — full scan, original order", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const otherSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const matchSecret = await encryptStringV2(BITS, PASSWORD);
    const seeds = [
      { ...seed("seed-other", []), secret: otherSecret },
      { ...seed("seed-match", []), secret: matchSecret },
    ];
    const { calls, decrypt } = countingDecrypt();

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: decrypt,
    });
    expect(result).toBe("seed-match");
    expect(calls).toEqual([accountSecret, otherSecret, matchSecret]);
  });

  it("decrypts no seed at all when a pre-populated seedBitsCache already holds every candidate's bitstring", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const otherSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const matchSecret = await encryptStringV2(BITS, PASSWORD);
    const seeds = [
      { ...seed("seed-other", []), secret: otherSecret },
      { ...seed("seed-match", []), secret: matchSecret },
    ];
    const seedBitsCache = new Map<string, string | null>([
      ["seed-other", OTHER_BITS],
      ["seed-match", BITS],
    ]);
    const { calls, decrypt } = countingDecrypt();

    const result = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: decrypt,
      seedBitsCache,
    });
    expect(result).toBe("seed-match");
    // Only the ACCOUNT's own secret — the cache is not keyed by account,
    // and must never be consulted for it.
    expect(calls).toEqual([accountSecret]);
  });

  // design.md: "Switching back to a previously-resolved account does not
  // re-decrypt any seed." The cache is caller-owned (T6 holds one per
  // wizard mount) precisely so this module can stay the pure, React-free
  // thing its header promises.
  it("populates an empty seedBitsCache so a second call with the same cache performs no seed decrypts", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const otherSecret = await encryptStringV2(OTHER_BITS, PASSWORD);
    const matchSecret = await encryptStringV2(BITS, PASSWORD);
    const seeds = [
      { ...seed("seed-other", []), secret: otherSecret },
      { ...seed("seed-match", []), secret: matchSecret },
    ];
    const seedBitsCache = new Map<string, string | null>();

    const first = countingDecrypt();
    const firstResult = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: first.decrypt,
      seedBitsCache,
    });
    expect(firstResult).toBe("seed-match");
    expect(first.calls).toEqual([accountSecret, otherSecret, matchSecret]);
    expect(seedBitsCache.get("seed-other")).toBe(OTHER_BITS);
    expect(seedBitsCache.get("seed-match")).toBe(BITS);

    const second = countingDecrypt();
    const secondResult = await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: second.decrypt,
      seedBitsCache,
    });
    expect(secondResult).toBe("seed-match");
    expect(second.calls).toEqual([accountSecret]);
  });

  // The cache memoises the FAILURE too (as `null`), so a seed that cannot
  // be decrypted or derived is not retried — at 600k PBKDF2 iterations —
  // on every single account switch. This also pins the `has`/`get`
  // distinction: a naive `cache.get(id) ?? decrypt(...)` would re-decrypt
  // a cached `null` forever.
  it("memoises an undecryptable seed as null, keeps scanning past it, and does not retry it on a second call", async () => {
    const accountSecret = await encryptStringV2(WORDS, PASSWORD);
    const matchSecret = await encryptStringV2(BITS, PASSWORD);
    const seeds = [
      { ...seed("seed-broken", []), secret: "not-a-valid-ciphertext" },
      { ...seed("seed-match", []), secret: matchSecret },
    ];
    const seedBitsCache = new Map<string, string | null>();

    const first = countingDecrypt();
    expect(await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: first.decrypt,
      seedBitsCache,
    })).toBe("seed-match");
    expect(seedBitsCache.get("seed-broken")).toBeNull();

    const second = countingDecrypt();
    expect(await resolveAccountSeedId({
      account: { secret: accountSecret, address: "Ѻ.test-address" },
      candidateSeeds: seeds,
      password: PASSWORD,
      smartDecrypt: second.decrypt,
      seedBitsCache,
    })).toBe("seed-match");
    expect(second.calls).toEqual([accountSecret]);
  });
});

/**
 * `docs/work/arweave-master-accounts/design.md` — the ONE predicate behind
 * both the Settling Dashboard's violet ticker and the wizard's "This codex
 * is now eligible." claim, so the two can no longer disagree (the reported
 * bug: a success message printed over a DARK violet ticker, because
 * eligibility was inferred from "the derivation call didn't throw" rather
 * than from the codex's end state — and the derived key was in fact being
 * discarded, leaving ZERO Arweave accounts).
 */
describe("codexHoldsMasterArweaveAccounts", () => {
  const MASTER_BITS = "1".repeat(1600);
  const OTHER_BITS = "0".repeat(1600);

  /** A persisted Arweave ACCOUNT — a `ForeignKeyEntry` addressed by
   *  `(seedId, index)` exactly as that type documents. */
  function arweaveKey(id: string, over: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
    return { id, chainId: "arweave:mainnet", encryptedKeyfile: "keyfile-ct", ...over };
  }

  function countingDecrypt(): {
    calls: string[];
    decrypt: (ciphertext: string, password: string) => Promise<string>;
  } {
    const calls: string[] = [];
    return {
      calls,
      decrypt: async (ciphertext: string, password: string): Promise<string> => {
        calls.push(ciphertext);
        return realSmartDecrypt(ciphertext, password);
      },
    };
  }

  // The legacy-codex case (design.md: "No Arweave seed at all"). A
  // regression returning anything but "both missing" here lets finalize
  // claim eligibility for a codex with no Arweave face whatsoever.
  it("reports both indexes missing, with no seed, when the codex holds no Arweave seed at all", async () => {
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [],
      foreignKeys: [],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: false, seedId: null, missingIndexes: [0, 1] });
  });

  // design.md acceptance: "A codex already holding #0 and #1 under the
  // master seed completes finalize without deriving anything new." This is
  // the ONLY shape that may answer `ok: true`.
  it("is ok with nothing missing when a seed decrypts to the master bitstring and holds both index 0 and index 1", async () => {
    const encrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [arweaveSeed("arw-master", encrypted)],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-master", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-master", index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: true, seedId: "arw-master", missingIndexes: [] });
  });

  // design.md acceptance: "A codex holding only #0 under the master seed
  // derives exactly #1." This is also the EXACT reported defect's shape:
  // `deriveArweaveSeedAtPositionZero` only ever ran `{start: 0, end: 0}`,
  // so #1 never existed — and eligibility was claimed anyway.
  it("names the matching seed but reports index 1 missing when only index 0 is held", async () => {
    const encrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [arweaveSeed("arw-master", encrypted)],
      foreignKeys: [arweaveKey("key-0", { seedId: "arw-master", index: 0 })],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: false, seedId: "arw-master", missingIndexes: [1] });
  });

  it("reports index 0 missing when only index 1 is held", async () => {
    const encrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [arweaveSeed("arw-master", encrypted)],
      foreignKeys: [arweaveKey("key-1", { seedId: "arw-master", index: 1 })],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: false, seedId: "arw-master", missingIndexes: [0] });
  });

  // `ForeignKeyEntry`'s own doc: `(seedId, index)` addresses a key, `index`
  // is per-seed and NEVER global, and is "meaningless — and rejected —
  // without a `seedId`". Counting a #0/#1 that belongs to some OTHER
  // Arweave seed (or carries no provenance at all) is precisely how the
  // wizard could claim eligibility off unrelated keys while the ticker,
  // which tests the master seed specifically, stays dark.
  it("does not count keys at index 0/1 that carry a DIFFERENT seedId, or no seedId at all", async () => {
    const encrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [arweaveSeed("arw-master", encrypted)],
      foreignKeys: [
        arweaveKey("key-other-0", { seedId: "arw-some-other-seed", index: 0 }),
        arweaveKey("key-other-1", { seedId: "arw-some-other-seed", index: 1 }),
        arweaveKey("key-orphan-0", { index: 0 }),
        arweaveKey("key-orphan-1", { index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: false, seedId: "arw-master", missingIndexes: [0, 1] });
  });

  // design.md: "Arweave accounts from a DIFFERENT seed" — step 1 fails
  // against the master bitstring, so there is no `seedId` to report and
  // both positions count as missing, however many accounts that unrelated
  // seed happens to hold.
  it("reports no seed and both indexes missing when the only Arweave seed does not decrypt to the master bitstring, even though it holds both indexes", async () => {
    const encrypted = await encryptStringV2(OTHER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [arweaveSeed("arw-unrelated", encrypted)],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-unrelated", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-unrelated", index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: false, seedId: null, missingIndexes: [0, 1] });
  });

  // Derivation, not a flag: the matching seed may well not be the one
  // `isPrime` points at (design.md leaves pre-existing seeds alone, so the
  // codex's FIRST — hence prime — Arweave seed is commonly an unrelated
  // one). `resolveArweaveMatchSeedId`'s `isPrime` filter must NOT be
  // copied along with its decrypt-and-compare discipline.
  it("matches by decrypted bitstring alone — a seed that is not flagged isPrime still counts", async () => {
    const primeUnrelated = await encryptStringV2(OTHER_BITS, PASSWORD);
    const masterEncrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [
        arweaveSeed("arw-prime-unrelated", primeUnrelated, true),
        arweaveSeed("arw-master", masterEncrypted, false),
      ],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-master", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-master", index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: true, seedId: "arw-master", missingIndexes: [] });
  });

  // Pins the documented tie-break so the answer cannot drift: after a
  // re-import a codex can hold TWO seeds with the same bitstring, and
  // which one is "the" master seed decides which seed's accounts count.
  // FIRST in array order wins — here the accounts hang off the SECOND
  // duplicate, so a last-match (or "any match") implementation would
  // wrongly answer `ok: true`.
  it("picks the FIRST Arweave seed in array order when several decrypt to the master bitstring", async () => {
    const firstEncrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const secondEncrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [
        arweaveSeed("arw-master-first", firstEncrypted),
        arweaveSeed("arw-master-second", secondEncrypted),
      ],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-master-second", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-master-second", index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: false, seedId: "arw-master-first", missingIndexes: [0, 1] });
  });

  // Same discipline `resolveArweaveMatchSeedId` already has: one seed's
  // decrypt failure degrades to "not a match" and the scan continues. A
  // single legacy/corrupt Arweave seed must not reject the predicate and
  // take the finalize screen down with it.
  it("skips an Arweave seed whose decrypt rejects and keeps scanning, without throwing", async () => {
    const masterEncrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [
        arweaveSeed("arw-broken", "not-a-valid-ciphertext"),
        arweaveSeed("arw-master", masterEncrypted),
      ],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-master", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-master", index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: realSmartDecrypt,
    });
    expect(result).toEqual({ ok: true, seedId: "arw-master", missingIndexes: [] });
  });

  it("resolves (never rejects) to both indexes missing when every decrypt rejects", async () => {
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [arweaveSeed("arw-1", "ct-a"), arweaveSeed("arw-2", "ct-b")],
      foreignKeys: [arweaveKey("key-0", { seedId: "arw-1", index: 0 })],
      password: PASSWORD,
      smartDecrypt: async () => { throw new Error("boom"); },
    });
    expect(result).toEqual({ ok: false, seedId: null, missingIndexes: [0, 1] });
  });

  // A locked codex (no password) or an unresolvable master bitstring is
  // "not proven eligible", and must cost ZERO 600,000-iteration PBKDF2
  // decrypts — the predicate runs on the wizard's own finalize path.
  it("reports both indexes missing WITHOUT calling smartDecrypt when the password is null", async () => {
    const encrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const { calls, decrypt } = countingDecrypt();
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: MASTER_BITS,
      arweaveSeeds: [arweaveSeed("arw-master", encrypted)],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-master", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-master", index: 1 }),
      ],
      password: null,
      smartDecrypt: decrypt,
    });
    expect(result).toEqual({ ok: false, seedId: null, missingIndexes: [0, 1] });
    expect(calls).toEqual([]);
  });

  it("reports both indexes missing WITHOUT calling smartDecrypt when the master bitstring is null", async () => {
    const encrypted = await encryptStringV2(MASTER_BITS, PASSWORD);
    const { calls, decrypt } = countingDecrypt();
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: null,
      arweaveSeeds: [arweaveSeed("arw-master", encrypted)],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-master", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-master", index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: decrypt,
    });
    expect(result).toEqual({ ok: false, seedId: null, missingIndexes: [0, 1] });
    expect(calls).toEqual([]);
  });

  // An EMPTY master bitstring is an unresolved master, not a value to
  // match: a decrypt that legitimately returns "" would otherwise equal it
  // and hand back a false `seedId`. Treated exactly like `null`.
  it("treats an empty master bitstring as unresolved, without calling smartDecrypt", async () => {
    const emptyEncrypted = await encryptStringV2("", PASSWORD);
    const { calls, decrypt } = countingDecrypt();
    const result = await codexHoldsMasterArweaveAccounts({
      masterBitString: "",
      arweaveSeeds: [arweaveSeed("arw-empty", emptyEncrypted)],
      foreignKeys: [
        arweaveKey("key-0", { seedId: "arw-empty", index: 0 }),
        arweaveKey("key-1", { seedId: "arw-empty", index: 1 }),
      ],
      password: PASSWORD,
      smartDecrypt: decrypt,
    });
    expect(result).toEqual({ ok: false, seedId: null, missingIndexes: [0, 1] });
    expect(calls).toEqual([]);
  });
});
