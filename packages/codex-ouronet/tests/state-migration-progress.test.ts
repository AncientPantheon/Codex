/**
 * The unfinished-migration row, driven through the STORE directly.
 *
 * The behaviours that matter are the two boundaries: a partial stage 1 must
 * leave the codex untouched, and a finished migration must CLEAR the row so
 * the wizard never offers to resume something that already happened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  LocalStorageCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexError } from "@ancientpantheon/codex-ouronet/errors";
import { containsSuspectedSecret } from "@ancientpantheon/codex-core";
import type {
  MigrationSelection,
  MigrationPendingPlan,
  MigrationExecutionStep,
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

/**
 * Execution-step fixtures. Ids are the design's own step names (§2's A-G),
 * which is what makes the recorded list legible to a human reading a support
 * export — the only thing it is for.
 */
const STEP_A_RUNNING: MigrationExecutionStep = {
  id: "A-chain-3",
  state: "running",
  txHash: "request-key-a3",
};

const STEP_B_CONFIRMED: MigrationExecutionStep = {
  id: "B-native-stoa",
  state: "confirmed",
  txHash: "request-key-b",
};

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
    //
    // STRENGTHENED (docs/work/migration-execute T8): this test has always
    // been TITLED "...and execution intact" but could not assert it, because
    // nothing in the tree ever produced an `execution` value. Now that
    // `recordMigrationExecutionStep` does, the assertion the title promises
    // is here — store.ts's `...(current?.execution ? ...)` carry-forward is
    // finally exercised rather than merely trusted.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.beginMigrationCommit();
    await s.getState().actions.recordMigrationCommit({ seedId: "seed-1", rowWritten: true });
    await s.getState().actions.recordMigrationExecutionStep(STEP_B_CONFIRMED);
    const startedAt = s.getState().migrationProgress!.startedAt;

    await s.getState().actions.recordMigrationPending(PLAN_A);

    const row = s.getState().migrationProgress;
    expect(row?.selection).toEqual(SELECTION);
    expect(row?.committed).toEqual({ seedId: "seed-1", rowWritten: true });
    expect(row?.execution).toEqual({ steps: [STEP_B_CONFIRMED] });
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

/**
 * `recordMigrationExecutionStep` — docs/work/migration-execute design §4.
 *
 * This is the FIRST producer `MigrationProgress.execution` has ever had. The
 * record is for display and support and is AUTHORITATIVE FOR NOTHING: design
 * §4 decided the engine resumes by RE-READING CHAIN STATE, so a recorded
 * `txHash` is a hint. Nothing below asserts that some later decision is made
 * from this list, because nothing may ever make one.
 */
describe("recordMigrationExecutionStep — the record of what the engine DID", () => {
  it("creates execution.steps on the first call, in state and on the adapter", async () => {
    // The field has been declared and carefully preserved by three writers
    // for months with no producer at all. This is the producer; if it did not
    // persist, a support export would still show an empty execution record
    // after a full chain run.
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);

    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);

    expect(s.getState().migrationProgress?.execution).toEqual({ steps: [STEP_A_RUNNING] });
    expect((await adapter.loadAll()).migrationProgress?.execution).toEqual({
      steps: [STEP_A_RUNNING],
    });
  });

  it("APPENDS a step with a new id, preserving the order the engine ran them in", async () => {
    // The list is read by a human asking "how far did it get?". Reordering
    // (or replacing) would answer that question wrongly.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);

    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);
    await s.getState().actions.recordMigrationExecutionStep(STEP_B_CONFIRMED);
    await s
      .getState()
      .actions.recordMigrationExecutionStep({ id: "C-unstake", state: "running" });

    expect(s.getState().migrationProgress?.execution?.steps.map((st) => st.id)).toEqual([
      "A-chain-3",
      "B-native-stoa",
      "C-unstake",
    ]);
  });

  it("REPLACES the entry with the same id rather than appending a second one", async () => {
    // One step is recorded repeatedly as it progresses (running -> txHash ->
    // confirmed). Appending would turn a nine-step chain into a list of
    // twenty-seven half-truths, with the stale "running" rows indistinguishable
    // from steps that really did stall.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);

    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);
    await s
      .getState()
      .actions.recordMigrationExecutionStep({ ...STEP_A_RUNNING, state: "confirmed" });

    const steps = s.getState().migrationProgress!.execution!.steps;
    expect(steps.length).toBe(1);
    expect(steps[0]!.state).toBe("confirmed");
    expect(steps[0]!.txHash).toBe("request-key-a3");
  });

  it("replaces IN PLACE, so a late update does not move its step to the end", async () => {
    // A filter-then-append merge would pass the test above and still scramble
    // the order here, which is the one thing the list is good for.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);
    await s.getState().actions.recordMigrationExecutionStep(STEP_B_CONFIRMED);
    await s
      .getState()
      .actions.recordMigrationExecutionStep({ id: "C-unstake", state: "running" });

    await s
      .getState()
      .actions.recordMigrationExecutionStep({ ...STEP_A_RUNNING, state: "failed", error: "gas" });

    const steps = s.getState().migrationProgress!.execution!.steps;
    expect(steps.map((st) => st.id)).toEqual(["A-chain-3", "B-native-stoa", "C-unstake"]);
    expect(steps[0]).toEqual({
      id: "A-chain-3",
      state: "failed",
      txHash: "request-key-a3",
      error: "gas",
    });
  });

  it("is a NO-OP when no migration row exists, and never touches the adapter", async () => {
    // Same discipline as recordMigrationCommit: a record of a run nobody
    // started must not conjure a half-row that the resume resolver would then
    // read as a started-but-stageless migration.
    const { s, adapter } = await store();
    const spy = vi.spyOn(adapter, "saveAll");

    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);

    expect(s.getState().migrationProgress).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("STILL records after sealMigration — unlike recordMigrationPending, which refuses", async () => {
    // Deliberately asymmetric. The seal forbids changing the PLAN; this
    // action records what HAPPENED, and the engine legitimately confirms its
    // last steps after the seal. A guard added here "for symmetry" would
    // silently drop the tail of every run.
    const { s } = await store();
    await s.getState().actions.recordMigrationPending(PLAN_A);
    await s.getState().actions.sealMigration();
    const appliedAt = s.getState().migrationProgress!.appliedAt;

    await s.getState().actions.recordMigrationExecutionStep(STEP_B_CONFIRMED);

    expect(s.getState().migrationProgress?.execution).toEqual({ steps: [STEP_B_CONFIRMED] });
    // The seal itself is untouched — recording is not modification.
    expect(s.getState().migrationProgress?.appliedAt).toBe(appliedAt);
    expect(s.getState().migrationProgress?.pending).toEqual(PLAN_A);
    expect(s.getState().migrationProgress?.stage).toBe("done");
  });

  it("keeps a recorded step when recordMigrationPending later writes a new plan, on disk too", async () => {
    // store.ts's execution carry-forward happens in `set()`; this asserts the
    // preserved value also reaches the adapter, so a re-finalize after a
    // partial chain run cannot erase the record of what already moved.
    const { s, adapter } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);
    await s.getState().actions.recordMigrationExecutionStep(STEP_B_CONFIRMED);

    await s.getState().actions.recordMigrationPending(PLAN_B);

    expect((await adapter.loadAll()).migrationProgress?.execution).toEqual({
      steps: [STEP_A_RUNNING, STEP_B_CONFIRMED],
    });
  });

  it("adds nothing that looks like a secret — the row-wide guarantee over the new branch", async () => {
    // `containsSuspectedSecret` is the test-enforced scan over this row. The
    // execution branch carries chain-supplied strings (request keys, error
    // messages), which is exactly where a future field could smuggle key
    // material in by accident.
    const { s } = await store();
    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);
    await s.getState().actions.recordMigrationExecutionStep({
      id: "F-rotate-payment",
      state: "failed",
      txHash: "request-key-f",
      error: "Keyset failure (keys-all): [a1b2c3]",
    });

    expect(containsSuspectedSecret(s.getState().migrationProgress)).toBe(false);
  });
});

describe("recordMigrationExecutionStep — through the sharding adapter", () => {
  // The real adapter shards this row into its own localStorage key, so the
  // round trip is where a non-JSON-able value (or a dropped nested object)
  // would actually be lost. Mirrors adapter-migration-progress-shard.test.ts.
  let real: Storage | undefined;
  beforeEach(() => {
    const map = new Map<string, string>();
    real = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
        clear: () => { map.clear(); },
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        get length() { return map.size; },
      } as Storage,
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: real, configurable: true, writable: true,
    });
  });

  it("survives saveAll -> loadAll with its steps and their order", async () => {
    const adapter = new LocalStorageCodexAdapter("dev");
    await adapter.saveAll({ ...emptySnapshot("dev"), schemaVersion: 1 });
    const s = createCodexStore();
    await s.getState().actions.init(adapter, "dev");

    await s.getState().actions.recordMigrationSelection(SELECTION);
    await s.getState().actions.recordMigrationExecutionStep(STEP_A_RUNNING);
    await s.getState().actions.recordMigrationExecutionStep(STEP_B_CONFIRMED);

    expect((await adapter.loadAll()).migrationProgress?.execution).toEqual({
      steps: [STEP_A_RUNNING, STEP_B_CONFIRMED],
    });
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
