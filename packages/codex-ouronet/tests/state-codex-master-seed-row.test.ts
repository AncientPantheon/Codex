/**
 * `setCodexMasterSeed`, driven through the STORE directly.
 *
 * Written for `docs/work/former-master-record/plan.md` T3, which adds the
 * former-holder history to the row. The action had NO dedicated spec before
 * this file — it was only exercised incidentally by the wizard UI tests
 * (`ui-legacy-prime-migration-wizard.test.tsx`,
 * `ui-ouronet-accounts-tab.test.tsx`), and the adapter's shard round trip was
 * covered separately by `adapter-master-seed-row-shard.test.ts`. The
 * behaviours asserted here are therefore BOTH the new history and the four
 * pre-existing guarantees T3 had to preserve while adding it:
 *
 *   - MERGE semantics (establishing the ArWeave face later does not require
 *     restating the other two);
 *   - a STICKY `establishedAt` (the row records when the codex first settled,
 *     not when it was last touched);
 *   - refusal of a row that cannot name both mandatory faces;
 *   - the no-change short-circuit (no adapter write at all).
 *
 * Mirrors `state-migration-progress.test.ts`'s store/adapter setup.
 */

import { describe, it, expect, vi } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexError } from "@ancientpantheon/codex-ouronet/errors";

const FIRST = {
  ouroAccountId: "ouro-1",
  chainwebSeedId: "seed-1",
  arweaveSeedId: "arw-1",
  establishedAt: "2026-10-28T10:00:00.000Z",
} as const;

async function store() {
  const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll({ ...emptySnapshot("dev"), schemaVersion: 1 });
  const s = createCodexStore();
  await s.getState().actions.init(adapter, "dev");
  return { s, adapter };
}

describe("setCodexMasterSeed — the preserved contract", () => {
  it("MERGES, so the ArWeave face can be established later on its own", async () => {
    const { s, adapter } = await store();
    const { arweaveSeedId, ...twoFaces } = FIRST;
    void arweaveSeedId;
    await s.getState().actions.setCodexMasterSeed(twoFaces);
    await s.getState().actions.setCodexMasterSeed({ arweaveSeedId: "arw-1" });

    expect(s.getState().codexMasterSeed).toEqual(FIRST);
    expect((await adapter.loadAll()).codexMasterSeed).toEqual(FIRST);
  });

  it("keeps establishedAt STICKY across later writes", async () => {
    const { s } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    await s
      .getState()
      .actions.setCodexMasterSeed({ arweaveSeedId: "arw-2", establishedAt: "2027-01-01T00:00:00.000Z" });

    expect(s.getState().codexMasterSeed?.establishedAt).toBe(FIRST.establishedAt);
  });

  it("refuses a row that cannot name both mandatory faces", async () => {
    const { s } = await store();
    await expect(
      s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-1" })
    ).rejects.toThrow(CodexError);
    expect(s.getState().codexMasterSeed).toBeUndefined();
  });

  it("SHORT-CIRCUITS a no-change write — the adapter is never touched", async () => {
    const { s, adapter } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    const spy = vi.spyOn(adapter, "saveAll");
    await s.getState().actions.setCodexMasterSeed({ ...FIRST });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("setCodexMasterSeed — the former-master history", () => {
  it("records NO former holder for a first-ever settlement", async () => {
    // Nobody was displaced, so the row must look exactly as it did before
    // this history existed — not carry two empty arrays.
    const { s } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    expect(s.getState().codexMasterSeed).toEqual(FIRST);
  });

  it("appends the OUTGOING account id when the master account moves", async () => {
    // The behaviour the whole task exists for: before this, the displaced
    // account's identity was destroyed by the overwrite and "Former Codex
    // Ouronet Master" could not be derived from anything.
    const { s, adapter } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    await s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-2" });

    expect(s.getState().codexMasterSeed?.ouroAccountId).toBe("ouro-2");
    expect(s.getState().codexMasterSeed?.formerOuroAccountIds).toEqual(["ouro-1"]);
    // ...and it is PERSISTED, not merely live state.
    expect((await adapter.loadAll()).codexMasterSeed?.formerOuroAccountIds).toEqual(["ouro-1"]);
  });

  it("appends the outgoing seed id when the master ArWeave seed moves, leaving the account history alone", async () => {
    const { s } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    await s.getState().actions.setCodexMasterSeed({ arweaveSeedId: "arw-2" });

    const row = s.getState().codexMasterSeed;
    expect(row?.formerArweaveSeedIds).toEqual(["arw-1"]);
    expect(row?.formerOuroAccountIds).toBeUndefined();
  });

  it("leaves the ArWeave history alone when only the account moves", async () => {
    const { s } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    await s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-2" });
    expect(s.getState().codexMasterSeed?.formerArweaveSeedIds).toBeUndefined();
  });

  it("accumulates both displaced holders across two moves, most recent LAST, with no duplicates", async () => {
    const { s } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    await s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-2" });
    await s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-3" });
    expect(s.getState().codexMasterSeed?.formerOuroAccountIds).toEqual(["ouro-1", "ouro-2"]);

    // Handing the role BACK must not re-list a holder already in the history.
    await s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-1" });
    expect(s.getState().codexMasterSeed?.formerOuroAccountIds).toEqual([
      "ouro-1",
      "ouro-2",
      "ouro-3",
    ]);
  });

  it("never records the INCOMING id — re-setting the same row appends nothing", async () => {
    const { s } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    await s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-1" });
    await s.getState().actions.setCodexMasterSeed({ ...FIRST });

    const row = s.getState().codexMasterSeed;
    expect(row?.formerOuroAccountIds).toBeUndefined();
    expect(row?.formerArweaveSeedIds).toBeUndefined();
  });

  it("does not write at all when a rejected row would have recorded a former holder", async () => {
    // The two-mandatory-faces refusal comes FIRST: a half-row must not leave
    // a history entry behind as its only trace.
    const { s } = await store();
    await s.getState().actions.setCodexMasterSeed(FIRST);
    await expect(
      s.getState().actions.setCodexMasterSeed({ ouroAccountId: "ouro-2", chainwebSeedId: "" })
    ).rejects.toThrow(CodexError);
    expect(s.getState().codexMasterSeed).toEqual(FIRST);
  });
});
