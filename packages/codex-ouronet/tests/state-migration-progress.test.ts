/**
 * The unfinished-migration row, driven through the STORE directly.
 *
 * The behaviours that matter are the two boundaries: a partial stage 1 must
 * leave the codex untouched, and a finished migration must CLEAR the row so
 * the wizard never offers to resume something that already happened.
 */

import { describe, it, expect, vi } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexError } from "@ancientpantheon/codex-ouronet/errors";
import type {
  MigrationSelection,
  MigrationPendingPlan,
} from "@ancientpantheon/codex-core";
import { resolveMigrationResume } from "../src/ui/internal/migrationResume.js";

const SELECTION: MigrationSelection = {
  account: { kind: "existing", accountId: "ouro-7" },
  payment: { kind: "stoic-dalos-position-0" },
  guard: { kind: "recommended-single-key" },
  derivationMethod: "stoic-dalos",
};

async function store() {
  const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({ ...emptySnapshot("dev"), schemaVersion: 1 });
  const s = createCodexStore();
  await s.getState().actions.init(adapter, "dev");
  return { s, adapter };
}

describe("recordMigrationSelection", () => {
  it("records the selection at stage 'selection'", async () => {
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);

    const row = s.getState().migrationProgress;
    expect(row?.stage).toBe("selection");
    expect(row?.selection).toEqual(SELECTION);
    expect((await adapter.loadAll()).migrationProgress?.selection).toEqual(SELECTION);
  });

  it("is EQUALITY-GATED — re-recording the same selection never touches the adapter", async () => {
    // Otherwise re-rendering or re-picking the same option would churn the
    // codex and keep bumping lastUpdatedAt / marking it dirty.
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    const spy = vi.spyOn(adapter, "saveAll");
    await s.getState().actions.recordMigrationSelection({ ...SELECTION });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("DOES write when the selection actually changes", async () => {
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.recordMigrationSelection({
      ...SELECTION,
      guard: { kind: "keep" },
    });
    expect(s.getState().migrationProgress?.selection?.guard).toEqual({ kind: "keep" });
  });

  it("preserves startedAt across updates, so 'when did this run begin' survives", async () => {
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    const first = s.getState().migrationProgress!.startedAt;
    await s.getState().actions.recordMigrationSelection({ ...SELECTION, guard: { kind: "keep" } });
    expect(s.getState().migrationProgress!.startedAt).toBe(first);
  });
});

describe("stage 2 commit recording", () => {
  it("moves the run to 'committing'", async () => {
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.beginMigrationCommit();
    expect(s.getState().migrationProgress?.stage).toBe("committing");
  });

  it("MERGES each recorded write rather than replacing the record", async () => {
    // Each call records ONE fact; a replace would erase what already landed
    // and make a resumed commit redo it.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.beginMigrationCommit();

    await s.getState().actions.recordMigrationCommit({ seedId: "seed-1" });
    await s.getState().actions.recordMigrationCommit({ rowWritten: true });
    await s.getState().actions.recordMigrationCommit({ locksWritten: true });

    expect(s.getState().migrationProgress?.committed).toEqual({
      seedId: "seed-1", rowWritten: true, locksWritten: true,
    });
  });

  it("keeps the selection visible throughout the commit, so a resume can still show it", async () => {
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.beginMigrationCommit();
    await s.getState().actions.recordMigrationCommit({ seedId: "seed-1" });
    expect(s.getState().migrationProgress?.selection).toEqual(SELECTION);
  });

  it("is a no-op when no migration was ever started", async () => {
    const { s } = await store();
    await s.getState().actions.recordMigrationCommit({ seedId: "x" });
    await s.getState().actions.beginMigrationCommit();
    expect(s.getState().migrationProgress).toBeUndefined();
  });
});

const PLAN_A: MigrationPendingPlan = {
  finalizedAt: "2026-11-18T10:00:00.000Z",
  accountId: "ouro-7",
  seedId: "seed-1",
  arweaveSeedId: "ar-1",
  paymentPublicKey: "a".repeat(64),
  guardPublicKeys: ["b".repeat(64)],
  guardPred: "keys-all",
};

const PLAN_B: MigrationPendingPlan = {
  finalizedAt: "2026-11-18T12:00:00.000Z",
  accountId: "ouro-9",
};

describe("recordMigrationPending — finalize writes the pending state", () => {
  it("creates the row when none exists, at stage 'committing', and persists it", async () => {
    // Finalize can run on a codex whose row was never written (or was
    // cleared); if the write were conditional on an existing row, the
    // pending state would silently vanish and Apply would never appear.
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationPending(PLAN_A);

    const row = s.getState().migrationProgress;
    expect(row?.pending).toEqual(PLAN_A);
    expect(row?.stage).toBe("committing");
    expect(row?.appliedAt).toBeUndefined();
    expect((await adapter.loadAll()).migrationProgress?.pending).toEqual(PLAN_A);
  });

  it("REPLACES a previous plan wholesale — a new finalize is a new plan", async () => {
    // The owner's partition-manager rule. A MERGE would leave run 1's
    // payment/guard keys on a plan run 2 deliberately did not derive, so
    // Apply would seal keys the user no longer chose.
    const { s } = await store();
    await s.getState().actions.recordMigrationPending(PLAN_A);
    await s.getState().actions.recordMigrationPending(PLAN_B);

    expect(s.getState().migrationProgress?.pending).toEqual(PLAN_B);
    expect(s.getState().migrationProgress?.pending?.paymentPublicKey).toBeUndefined();
    expect(s.getState().migrationProgress?.pending?.guardPublicKeys).toBeUndefined();
    expect(s.getState().migrationProgress?.pending?.seedId).toBeUndefined();
  });

  it("leaves selection, committed and execution intact", async () => {
    // Those power resume and the skip-what-landed logic of a resumed
    // commit; writing the plan must not erase them.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.beginMigrationCommit();
    await s.getState().actions.recordMigrationCommit({ seedId: "seed-1", rowWritten: true });
    const startedAt = s.getState().migrationProgress!.startedAt;

    await s.getState().actions.recordMigrationPending(PLAN_A);

    const row = s.getState().migrationProgress;
    expect(row?.selection).toEqual(SELECTION);
    expect(row?.committed).toEqual({ seedId: "seed-1", rowWritten: true });
    expect(row?.startedAt).toBe(startedAt);
  });

  it("REFUSES with CodexError once the migration is sealed", async () => {
    // "makes further modifications impossible" — the seal is permanent.
    const { s } = await store();
    await s.getState().actions.recordMigrationPending(PLAN_A);
    await s.getState().actions.sealMigration();

    await expect(s.getState().actions.recordMigrationPending(PLAN_B)).rejects.toBeInstanceOf(
      CodexError
    );
    expect(s.getState().migrationProgress?.pending).toEqual(PLAN_A);
  });
});

describe("sealMigration — Apply seals the pending state forever", () => {
  it("sets appliedAt, stage 'done' AND primeAlignment 'aligned', persisted", async () => {
    // The seal that used to happen at finalize now happens here; without the
    // alignment stamp the codex would never read as migrated.
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationPending(PLAN_A);
    expect(s.getState().primeAlignment).toBe("legacy");

    await s.getState().actions.sealMigration();

    const row = s.getState().migrationProgress;
    expect(typeof row?.appliedAt).toBe("string");
    expect(row?.stage).toBe("done");
    expect(s.getState().primeAlignment).toBe("aligned");

    const snap = await adapter.loadAll();
    expect(snap.migrationProgress?.appliedAt).toBe(row?.appliedAt);
    expect((snap as unknown as { primeAlignment?: string }).primeAlignment).toBe("aligned");
  });

  it("KEEPS the plan on the row as the record of what was applied", async () => {
    const { s } = await store();
    await s.getState().actions.recordMigrationPending(PLAN_A);
    await s.getState().actions.sealMigration();
    expect(s.getState().migrationProgress?.pending).toEqual(PLAN_A);
  });

  it("is idempotent — a second seal resolves without writing anything", async () => {
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationPending(PLAN_A);
    await s.getState().actions.sealMigration();
    const appliedAt = s.getState().migrationProgress!.appliedAt;

    const spy = vi.spyOn(adapter, "saveAll");
    await expect(s.getState().actions.sealMigration()).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    expect(s.getState().migrationProgress?.appliedAt).toBe(appliedAt);
  });

  it("REFUSES with CodexError when there is no pending plan — you cannot seal nothing", async () => {
    // And above all it must not stamp alignment, which is irreversible.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);

    await expect(s.getState().actions.sealMigration()).rejects.toBeInstanceOf(CodexError);
    expect(s.getState().primeAlignment).toBe("legacy");
    expect(s.getState().migrationProgress?.appliedAt).toBeUndefined();
  });

  it("refuses the same way when no migration row exists at all", async () => {
    const { s } = await store();
    await expect(s.getState().actions.sealMigration()).rejects.toBeInstanceOf(CodexError);
    expect(s.getState().primeAlignment).toBe("legacy");
    expect(s.getState().migrationProgress).toBeUndefined();
  });

  it("makes the run non-resumable — stage 'done' is what the resume resolver reads", async () => {
    // Sealing must stop the wizard offering to resume a migration that can
    // no longer be modified.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.recordMigrationPending(PLAN_A);
    expect(
      resolveMigrationResume(s.getState().migrationProgress, { accounts: [], seeds: [] }).resumable
    ).toBe(true);

    await s.getState().actions.sealMigration();

    expect(
      resolveMigrationResume(s.getState().migrationProgress, { accounts: [], seeds: [] }).resumable
    ).toBe(false);
  });
});

describe("terminal actions clear the row", () => {
  it("completeMigration removes it from state AND from the adapter", async () => {
    // A finished codex that kept its row would offer to resume forever.
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    expect((await adapter.loadAll()).migrationProgress).toBeTruthy();

    await s.getState().actions.completeMigration();

    expect(s.getState().migrationProgress).toBeUndefined();
    // On the wire "no row" is `null` for a sharding adapter (its remove
    // marker) and `null` for a whole-snapshot one that stored it verbatim;
    // either way it is absent. The store normalizes to `undefined`.
    expect((await adapter.loadAll()).migrationProgress ?? undefined).toBeUndefined();
  });

  it("abandonMigration clears it the same way", async () => {
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.abandonMigration();
    expect(s.getState().migrationProgress).toBeUndefined();
    expect((await adapter.loadAll()).migrationProgress ?? undefined).toBeUndefined();
  });
});

describe("a codex with no migration started", () => {
  it("has no row at all — stage 1 is free to abandon", async () => {
    const { s, adapter } = await store();
    expect(s.getState().migrationProgress).toBeUndefined();
    expect((await adapter.loadAll()).migrationProgress).toBeUndefined();
  });
});

describe("null on the wire normalizes to undefined in state", () => {
  it("a re-init after completion does not resurrect a null row", async () => {
    // The adapter may hand back `null` (its "removed" marker). Live state is
    // declared `MigrationProgress | undefined`; leaking a null would make
    // every `?.stage` check read as a started-but-stageless run.
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.completeMigration();
    await s.getState().actions.init(adapter, "dev");
    expect(s.getState().migrationProgress).toBeUndefined();
  });
});
