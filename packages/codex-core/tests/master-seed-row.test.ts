/**
 * The Codex Master Seed row — the codex's record of which three entities are
 * the three faces of its one seed.
 */

import { describe, it, expect } from "vitest";
import {
  describeCodexMasterSeed,
  recordFormerMasterIds,
  isFormerMasterAccount,
  isFormerMasterArweaveSeed,
} from "../src/codex/masterSeed.js";
import type { CodexMasterSeed } from "../src/codex/masterSeed.js";
import type { MigrationProgress } from "../src/codex/migrationProgress.js";
import { serializeCodex, deserializeCodex } from "../src/codex/codec.js";
import type { PlaintextCodex } from "../src/codex/types.js";

// `Required` deliberately: adding a field to `CodexMasterSeed` without adding
// it here stops compiling, which is what keeps the "linkage ONLY" key-set
// guard below exhaustive instead of frozen at the shape of the day it was
// written.
const full: Required<CodexMasterSeed> = {
  ouroAccountId: "ouro-1",
  chainwebSeedId: "seed-1",
  arweaveSeedId: "arw-1",
  establishedAt: "2026-10-28T10:00:00.000Z",
  formerOuroAccountIds: ["ouro-0"],
  formerArweaveSeedIds: ["arw-0"],
};

describe("describeCodexMasterSeed", () => {
  it("reports all three faces established on a complete row", () => {
    expect(describeCodexMasterSeed(full)).toEqual({
      ouronet: true, chainweb: true, arweave: true, complete: true,
    });
  });

  it("reports the ArWeave face absent WITHOUT calling the row incomplete nonsense", () => {
    // The ArWeave derivation is RSA-4096 and happens separately, so a codex
    // with two faces settled is a normal intermediate state, not corruption.
    const { arweaveSeedId, ...twoFaces } = full;
    void arweaveSeedId;
    expect(describeCodexMasterSeed(twoFaces)).toEqual({
      ouronet: true, chainweb: true, arweave: false, complete: false,
    });
  });

  it("reports every face absent for a codex that has no row at all", () => {
    // A never-migrated codex is a normal state, not an error.
    expect(describeCodexMasterSeed(undefined)).toEqual({
      ouronet: false, chainweb: false, arweave: false, complete: false,
    });
  });

  it("treats an empty id as absent rather than established", () => {
    expect(describeCodexMasterSeed({ ...full, arweaveSeedId: "" }).arweave).toBe(false);
  });
});

describe("the row carries linkage ONLY", () => {
  it("has no field that could hold words, a bitstring or a secret", () => {
    // A second at-rest copy of key material would drift from the first and
    // would have to be re-keyed in lockstep on every password change.
    const keys = Object.keys(full);
    expect(keys.sort()).toEqual(
      [
        "arweaveSeedId",
        "chainwebSeedId",
        "establishedAt",
        "formerArweaveSeedIds",
        "formerOuroAccountIds",
        "ouroAccountId",
      ],
    );
    for (const k of keys) {
      expect(k).not.toMatch(/secret|words|bitstring|private|mnemonic/i);
    }
  });
});

// --------------------------------------------------------------------
// The former-master history. Nothing in the codex used to record WHO the
// master was before it moved: `setCodexMasterSeed` overwrote the id in place,
// so "Former Codex Ouronet Master" / "Former Master ArWeave Seed" could not be
// derived from anything that existed. These ids are that record, following
// `IPureKeypair.wasCodexGuard`'s "stored forever" discipline.
// --------------------------------------------------------------------

const settled: CodexMasterSeed = {
  ouroAccountId: "ouro-1",
  chainwebSeedId: "seed-1",
  arweaveSeedId: "arw-1",
  establishedAt: "2026-10-28T10:00:00.000Z",
};

describe("recordFormerMasterIds", () => {
  it("records NO former ids for a first-ever settlement", () => {
    // A codex settling its master for the first time displaced nobody. An
    // empty array here would make every fresh codex claim a history it does
    // not have, and would defeat `setCodexMasterSeed`'s no-change
    // short-circuit by writing a row that differs only by two empty arrays.
    const recorded = recordFormerMasterIds(undefined, settled);
    expect(recorded.formerOuroAccountIds).toBeUndefined();
    expect(recorded.formerArweaveSeedIds).toBeUndefined();
    expect("formerOuroAccountIds" in recorded).toBe(false);
    expect("formerArweaveSeedIds" in recorded).toBe(false);
  });

  it("appends exactly the OUTGOING account id, never the incoming one", () => {
    const moved = recordFormerMasterIds(settled, { ...settled, ouroAccountId: "ouro-2" });
    expect(moved.formerOuroAccountIds).toEqual(["ouro-1"]);
    expect(moved.ouroAccountId).toBe("ouro-2");
  });

  it("appends the outgoing ArWeave seed id on an ArWeave handover", () => {
    const moved = recordFormerMasterIds(settled, { ...settled, arweaveSeedId: "arw-2" });
    expect(moved.formerArweaveSeedIds).toEqual(["arw-1"]);
  });

  it("keeps the two faces' histories separate", () => {
    // The Ouronet account and the ArWeave seed move at different moments
    // (the ArWeave derivation is a separate RSA-4096 step). An account
    // handover that touched the seed history would make a seed that never
    // moved read as "Former Master ArWeave Seed".
    const accountMoved = recordFormerMasterIds(settled, { ...settled, ouroAccountId: "ouro-2" });
    expect(accountMoved.formerArweaveSeedIds).toBeUndefined();
    const seedMoved = recordFormerMasterIds(settled, { ...settled, arweaveSeedId: "arw-2" });
    expect(seedMoved.formerOuroAccountIds).toBeUndefined();
  });

  it("accumulates both displaced holders across two moves, most recent LAST", () => {
    const first = recordFormerMasterIds(settled, { ...settled, ouroAccountId: "ouro-2" });
    const second = recordFormerMasterIds(first, { ...first, ouroAccountId: "ouro-3" });
    expect(second.formerOuroAccountIds).toEqual(["ouro-1", "ouro-2"]);
  });

  it("records nothing when the row is re-set to the SAME ids", () => {
    // Re-finalizing an unsealed codex re-writes the row with the same faces;
    // that is not a handover and must not grow the history.
    const resaved = recordFormerMasterIds(settled, { ...settled });
    expect(resaved.formerOuroAccountIds).toBeUndefined();
    expect(resaved.formerArweaveSeedIds).toBeUndefined();
  });

  it("does not duplicate an id that is already in the history", () => {
    // Handing the role BACK and forth (A -> B -> A -> B) must not grow the
    // list without bound, and must not list A twice.
    const toB = recordFormerMasterIds(settled, { ...settled, ouroAccountId: "ouro-2" });
    const backToA = recordFormerMasterIds(toB, { ...toB, ouroAccountId: "ouro-1" });
    expect(backToA.formerOuroAccountIds).toEqual(["ouro-1", "ouro-2"]);
    const toBAgain = recordFormerMasterIds(backToA, { ...backToA, ouroAccountId: "ouro-2" });
    expect(toBAgain.formerOuroAccountIds).toEqual(["ouro-1", "ouro-2"]);
  });

  it("records the displaced seed when the ArWeave face is CLEARED, not replaced", () => {
    const cleared = recordFormerMasterIds(settled, {
      ouroAccountId: settled.ouroAccountId,
      chainwebSeedId: settled.chainwebSeedId,
      establishedAt: settled.establishedAt,
    });
    expect(cleared.formerArweaveSeedIds).toEqual(["arw-1"]);
  });

  it("returns the next row UNCHANGED (same object) when there is nothing to record", () => {
    // `setCodexMasterSeed` compares the merged row against the stored one to
    // decide whether to write at all; a fresh object that merely looks the
    // same is fine for that comparison, but handing back the identical row
    // keeps the no-op path provably allocation-free and side-effect-free.
    const next = { ...settled };
    expect(recordFormerMasterIds(settled, next)).toBe(next);
  });

  it("carries a history the caller already supplied, and appends to it", () => {
    // Restore/import paths hand over a row that ALREADY has a history. It is
    // the base to append to, not something to overwrite.
    const imported: CodexMasterSeed = { ...settled, formerOuroAccountIds: ["ouro-0"] };
    const moved = recordFormerMasterIds(imported, { ...imported, ouroAccountId: "ouro-2" });
    expect(moved.formerOuroAccountIds).toEqual(["ouro-0", "ouro-1"]);
  });
});

// --------------------------------------------------------------------
// The derived "Former ..." predicates. Design: "the designation follows the
// SEAL, not the finalize" — `codexMasterSeed` is written at finalize and is
// re-writable while unsealed, whereas `migrationProgress.appliedAt` is
// monotone and permanent.
// --------------------------------------------------------------------

const SEALED: MigrationProgress = {
  stage: "done",
  startedAt: "2026-11-18T09:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
  appliedAt: "2026-11-18T11:00:00.000Z",
};

const UNSEALED: MigrationProgress = {
  stage: "committing",
  startedAt: "2026-11-18T09:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
};

const moved: CodexMasterSeed = {
  ...settled,
  ouroAccountId: "ouro-2",
  arweaveSeedId: "arw-2",
  formerOuroAccountIds: ["ouro-1"],
  formerArweaveSeedIds: ["arw-1"],
};

describe("isFormerMasterAccount", () => {
  it("is true for the displaced account on a SEALED codex", () => {
    expect(isFormerMasterAccount("ouro-1", moved, SEALED)).toBe(true);
  });

  it("is false for the CURRENT master, even when its id is in the history", () => {
    // The role can come back (A -> B -> A). The history is append-only, so
    // without this the current master would render both "Codex Ouronet
    // Master" and "Former Codex Ouronet Master" at once.
    const returned: CodexMasterSeed = {
      ...moved,
      ouroAccountId: "ouro-1",
      formerOuroAccountIds: ["ouro-1", "ouro-2"],
    };
    expect(isFormerMasterAccount("ouro-1", returned, SEALED)).toBe(false);
    expect(isFormerMasterAccount("ouro-2", returned, SEALED)).toBe(true);
  });

  it("is false for an account that never held the role", () => {
    expect(isFormerMasterAccount("ouro-9", moved, SEALED)).toBe(false);
  });

  it("is false on a finalized-but-UNAPPLIED codex", () => {
    // The row exists the moment finalize writes it, but Apply is the lock-in.
    expect(isFormerMasterAccount("ouro-1", moved, UNSEALED)).toBe(false);
    expect(isFormerMasterAccount("ouro-1", moved, undefined)).toBe(false);
    expect(isFormerMasterAccount("ouro-1", moved, null)).toBe(false);
  });

  it("is false on a codex with no master row at all", () => {
    expect(isFormerMasterAccount("ouro-1", undefined, SEALED)).toBe(false);
    expect(isFormerMasterAccount("ouro-1", null, SEALED)).toBe(false);
  });

  it("is false for an absent or empty id rather than matching an empty history entry", () => {
    const withBlank = { ...moved, formerOuroAccountIds: [""] };
    expect(isFormerMasterAccount("", withBlank, SEALED)).toBe(false);
    expect(isFormerMasterAccount(undefined, withBlank, SEALED)).toBe(false);
  });

  it("does not read the ArWeave history", () => {
    expect(isFormerMasterAccount("arw-1", moved, SEALED)).toBe(false);
  });
});

describe("isFormerMasterArweaveSeed", () => {
  it("is true for the displaced seed on a SEALED codex", () => {
    expect(isFormerMasterArweaveSeed("arw-1", moved, SEALED)).toBe(true);
  });

  it("is false for the CURRENT master seed, even when its id is in the history", () => {
    const returned: CodexMasterSeed = {
      ...moved,
      arweaveSeedId: "arw-1",
      formerArweaveSeedIds: ["arw-1", "arw-2"],
    };
    expect(isFormerMasterArweaveSeed("arw-1", returned, SEALED)).toBe(false);
    expect(isFormerMasterArweaveSeed("arw-2", returned, SEALED)).toBe(true);
  });

  it("is false for a seed that never held the role", () => {
    expect(isFormerMasterArweaveSeed("arw-9", moved, SEALED)).toBe(false);
  });

  it("is false on a finalized-but-UNAPPLIED codex", () => {
    expect(isFormerMasterArweaveSeed("arw-1", moved, UNSEALED)).toBe(false);
    expect(isFormerMasterArweaveSeed("arw-1", moved, undefined)).toBe(false);
  });

  it("is false on a codex with no master row at all", () => {
    expect(isFormerMasterArweaveSeed("arw-1", undefined, SEALED)).toBe(false);
  });

  it("does not read the account history", () => {
    expect(isFormerMasterArweaveSeed("ouro-1", moved, SEALED)).toBe(false);
  });
});

describe("the history travels in the codex EXPORT", () => {
  it("survives a serialize -> deserialize round trip intact", () => {
    // Same omission class as the dropped `foreignKeys`, `arweaveSeeds` and
    // `watchList` shards: a writer that enumerated the row's fields instead
    // of passing the object through would silently drop the history, and the
    // former designations would vanish on re-import with nothing to catch it.
    const codex: PlaintextCodex = {
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      pureKeypairs: [],
      uiSettings: {},
      schemaVersion: 1,
      lastUpdatedAt: null,
      lastUpdatedDevice: "dev",
      codexMasterSeed: moved,
    };
    const parsed = deserializeCodex(serializeCodex(codex)) as {
      codexMasterSeed?: CodexMasterSeed;
    };
    expect(parsed.codexMasterSeed).toEqual(moved);
    expect(parsed.codexMasterSeed?.formerOuroAccountIds).toEqual(["ouro-1"]);
    expect(parsed.codexMasterSeed?.formerArweaveSeedIds).toEqual(["arw-1"]);
  });
});
