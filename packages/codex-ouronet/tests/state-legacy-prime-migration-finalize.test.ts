/**
 * `ensurePrimeSeedAccountPairingAndPromote` — the new store action backing
 * `legacy-prime-migration-wizard` Page 7 ("Finalize"), per
 * `docs/work/legacy-prime-migration-wizard/plan.md` T7 and `design.md`'s
 * "Page 7 — Finalize" section.
 *
 * The action composes three EXISTING actions (`addStoaChainSeed`,
 * `updateOuroAccount`, `promoteSeedAndAccountToPrime`) rather than
 * reimplementing their validation/mutation — these tests therefore assert
 * on the OUTCOME (seed created + linked, promotion happened or didn't,
 * `sweepNeeded` correctly computed), not on how each composed action works
 * internally (already covered by `state-store.test.ts`'s own suites).
 *
 * `derivation`'s shape, per plan.md T7 (T6 — the wizard UI task that owns
 * `LegacyPrimeMigrationKeysChoice` — had NOT landed in
 * `LegacyPrimeMigrationWizard.tsx` as of this task running; confirmed by
 * grepping the file for `computeExistingAccountCandidates`/`stoic-dalos`/
 * `advanced-native`, all absent): `{ bitString, words?, method: "stoic-dalos"
 * | "advanced-native" }`, exactly as documented in the plan line itself.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexError } from "@ancientpantheon/codex-ouronet/errors";
import type { IStoaChainSeed, IOuroAccount } from "@ancientpantheon/codex-ouronet/types";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";

// --------------------------------------------------------------------
// Fixtures — mirrors state-store.test.ts's own seed()/ouro() shape.
// --------------------------------------------------------------------

const seed = (id = "s1"): IStoaChainSeed => ({
  id,
  name: "Seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: "encrypted-secret",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-24T10:00:00.000Z",
  accounts: [
    {
      index: 0,
      publicKey: "a".repeat(64),
      derivationPath: "m/44'/626'/0'/0/0",
    },
  ],
});

const ouro = (
  id = "o1",
  overrides: Partial<IOuroAccount> = {}
): IOuroAccount => ({
  id,
  name: "Ouro",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ." + id,
  guard: null,
  stoaChainLedger: null,
  publicKey: "pk-" + id,
  secret: "secret-" + id,
  backup: "backup-" + id,
  ...overrides,
});

const WORDS = ["alpha", "beta", "gamma"] as const;
const BIT_STRING = seedWordsToBitString(WORDS as unknown as string[]);

describe("ensurePrimeSeedAccountPairingAndPromote", () => {
  let adapter: CodexAdapter;
  let store: ReturnType<typeof createCodexStore>;

  /** Kickstarts the store with a primeSeed/primeOuro pair (so a
   *  subsequently-added account is never auto-primed by addOuroAccount's
   *  own "first account" rule), mirroring state-store.test.ts's own
   *  `setupTwoPairs` convention. */
  async function kickstart(): Promise<void> {
    await store.getState().actions.kickstartCodex({
      seed: seed("primeSeed"),
      primeOuroAccount: ouro("primeOuro"),
    });
  }

  beforeEach(async () => {
    adapter = new MemoryCodexAdapter("dev");
    store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");
  });

  it("on an account with no paired seed and guard: null, creates a new seed, links it, reports guardRotationNeeded: true, and PROMOTES ANYWAY", async () => {
    await kickstart();
    await store
      .getState()
      .actions.addOuroAccount(ouro("target", { guard: null }));
    store.getState().actions.authenticate("hunter2", 60);

    const result = await store
      .getState()
      .actions.ensurePrimeSeedAccountPairingAndPromote("target", {
        bitString: BIT_STRING,
        words: WORDS,
        method: "stoic-dalos",
      });

    expect(result.guardRotationNeeded).toBe(true);

    const seeds = store.getState().kadenaSeeds;
    const createdSeed = seeds.find((s) => s.id === result.seedId);
    expect(createdSeed).toBeDefined();

    const account = store
      .getState()
      .ouroAccounts.find((a) => a.id === "target");
    expect(account?.parentSeedId).toBe(result.seedId);

    // CORRECTED (owner, 2026-10-30). Promotion used to be SKIPPED whenever
    // the on-chain guard did not already match, and that made eligibility
    // unreachable for exactly the codices that need migrating: a legacy
    // guard never matches until a rotation happens, and eligibility reads
    // the PRIME account's bitstring and the PRIME ArWeave address.
    //
    // Promotion is structural and codex-local. `guardRotationNeeded` above
    // is INFORMATION about the chain — reported, never a gate.
    expect(account?.isPrime).toBe(true);
    expect(createdSeed?.isPrime).toBe(true);
  });

  it("on an account whose guard already exactly matches the Stoic Dalos derivation at positions 0/1, returns guardRotationNeeded: false and really promotes both the account and its seed", async () => {
    await kickstart();

    const key0 = deriveStoaDalosKeypairAtIndex(BIT_STRING, 0);
    const key1 = deriveStoaDalosKeypairAtIndex(BIT_STRING, 1);

    await store.getState().actions.addOuroAccount(
      ouro("target", {
        guard: { pred: "keys-all", keys: [key0.publicKey, key1.publicKey] },
      })
    );
    store.getState().actions.authenticate("hunter2", 60);

    const result = await store
      .getState()
      .actions.ensurePrimeSeedAccountPairingAndPromote("target", {
        bitString: BIT_STRING,
        words: WORDS,
        method: "stoic-dalos",
      });

    expect(result.guardRotationNeeded).toBe(false);

    const account = store
      .getState()
      .ouroAccounts.find((a) => a.id === "target");
    expect(account?.isPrime).toBe(true);

    const promotedSeed = store
      .getState()
      .kadenaSeeds.find((s) => s.id === result.seedId);
    expect(promotedSeed?.isPrime).toBe(true);
  });

  it("rejects with CodexError on an already-aligned codex, with zero state change", async () => {
    await kickstart();
    await store
      .getState()
      .actions.addOuroAccount(ouro("target", { guard: null }));
    store.getState().actions.authenticate("hunter2", 60);
    await store.getState().actions.stampPrimeAlignmentAligned();

    const seedsBefore = store.getState().kadenaSeeds;
    const accountsBefore = store.getState().ouroAccounts;

    await expect(
      store
        .getState()
        .actions.ensurePrimeSeedAccountPairingAndPromote("target", {
          bitString: BIT_STRING,
          words: WORDS,
          method: "stoic-dalos",
        })
    ).rejects.toThrow(CodexError);

    expect(store.getState().kadenaSeeds).toEqual(seedsBefore);
    expect(store.getState().ouroAccounts).toEqual(accountsBefore);
  });

  it("on an account that already has a valid parentSeedId pointing at a real seed, reuses it — no second seed is created", async () => {
    await kickstart();
    await store.getState().actions.addStoaChainSeed(seed("existingSeed"));
    await store.getState().actions.addOuroAccount(
      ouro("target", { guard: null, parentSeedId: "existingSeed" })
    );
    store.getState().actions.authenticate("hunter2", 60);

    const seedCountBefore = store.getState().kadenaSeeds.length;

    const result = await store
      .getState()
      .actions.ensurePrimeSeedAccountPairingAndPromote("target", {
        bitString: BIT_STRING,
        words: WORDS,
        method: "stoic-dalos",
      });

    expect(result.seedId).toBe("existingSeed");
    expect(store.getState().kadenaSeeds.length).toBe(seedCountBefore);
  });
});
