/**
 * former-prime-provenance.test.ts — the regression locks the "Former Codex
 * Prime" INVESTIGATION leaves behind.
 *
 * Findings: `docs/work/migration-execute-keyset/former-prime-investigation.md`
 * (migration-execute-keyset/plan.md T1, design.md §4 / criterion 10). That
 * investigation changed NO production code; these are the two facts it rests
 * on that code can pin, so neither can rot silently:
 *
 *   1. THE CAPTURE ORDER. The wizard's finalize reads "who carries `isPrime`"
 *      BEFORE it calls the promotion that clears that flag from every other
 *      account. The design asserted the opposite ("the promotion clears
 *      `isPrime` before anything records it") and concluded the record was
 *      lost to a race. It is not — the order is correct, and the record is
 *      merely younger than some codexes. A reordering would turn the design's
 *      wrong diagnosis into a real, silent, unrecoverable bug, so the order is
 *      scanned from the source here.
 *
 *   2. THE THREE STATES OF THE ROW, and why an `ouroAccounts[0]` backfill is
 *      unsafe: a sealed row with no `legacyPrimeOuroAccountId` is AMBIGUOUS
 *      between "displaced nobody" and "older than the capture", and the
 *      displaced account is deletable after the seal, so index 0 need not be
 *      the former prime at all.
 *
 * NO MAINNET RISK: no chain read, no submit, no network, and not one
 * `vi.mock` in the file — it passes with every mock deleted because there are
 * none. The only I/O is `readFileSync` on a source file in this repo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import { isLegacyPrimeAccount } from "@ancientpantheon/codex-core";
import type { CodexMasterSeed, MigrationProgress } from "@ancientpantheon/codex-core";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexPrimeProtectedError } from "@ancientpantheon/codex-ouronet/errors";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

const OURONET_SRC = resolve(__dirname, "..", "src");
const WIZARD = join(OURONET_SRC, "ui", "internal", "LegacyPrimeMigrationWizard.tsx");

/** The outgoing-prime READ: `…ouroAccounts.find((a) => a.isPrime)`, whatever
 *  the formatting and whatever the parameter is annotated as. */
const CAPTURE = /ouroAccounts\s*\.\s*find\(\s*\(\s*a[^)]*\)\s*=>\s*a\.isPrime\s*\)/g;
/** The promotion CALL — `actions.ensurePrime…(`, never the many prose
 *  mentions of the same name in this file's doc comments. */
const PROMOTE = /actions\s*\.\s*ensurePrimeSeedAccountPairingAndPromote\s*\(/g;

/**
 * Where the capture and the promotion sit in a source text, in the style
 * `structural-guards.test.ts` already uses for its dependency scans: a static
 * read, no parsing, no execution.
 *
 * `*Matches` are reported alongside the verdict so the guard cannot pass
 * VACUOUSLY — a rename that makes either anchor stop matching fails on the
 * count rather than quietly ordering nothing against nothing.
 */
function scanCaptureOrder(src: string): {
  captureMatches: number;
  promoteMatches: number;
  capturePrecedesPromotion: boolean;
} {
  const captures = [...src.matchAll(CAPTURE)];
  const promotes = [...src.matchAll(PROMOTE)];
  const captureAt = captures[0]?.index;
  const promoteAt = promotes[0]?.index;
  return {
    captureMatches: captures.length,
    promoteMatches: promotes.length,
    capturePrecedesPromotion:
      captureAt !== undefined && promoteAt !== undefined && captureAt < promoteAt,
  };
}

describe("the legacy-prime capture happens BEFORE the promotion destroys the evidence", () => {
  it("scans the wizard source and finds the isPrime read ahead of the promote call", () => {
    const scan = scanCaptureOrder(readFileSync(WIZARD, "utf8"));

    expect(scan.captureMatches).toBe(1);
    expect(scan.promoteMatches).toBe(1);
    expect(scan.capturePrecedesPromotion).toBe(true);
  });

  it("reports a VIOLATION when the two are swapped, and no verdict at all when an anchor vanishes", () => {
    // The guard above can only mean something if this scan can actually SEE
    // the bug the design believed was already shipped. Swapping the two
    // statements is exactly that bug: the finalize would then read `isPrime`
    // off a store the promotion had already rewritten, record the NEW master
    // as its own predecessor, and the real legacy prime would be gone with no
    // way back.
    const swapped = `
      const result = await actions.ensurePrimeSeedAccountPairingAndPromote(resolved.accountId, {});
      const legacyPrimeOuroAccountId = codexStore
        ?.getState()
        .ouroAccounts.find((a: IOuroAccount) => a.isPrime)?.id;
    `;
    const scan = scanCaptureOrder(swapped);
    expect(scan.captureMatches).toBe(1);
    expect(scan.promoteMatches).toBe(1);
    expect(scan.capturePrecedesPromotion).toBe(false);

    // And a rename that silences an anchor is reported as a zero count rather
    // than as a passing order — otherwise the guard above would go vacuous the
    // first time either call site is renamed.
    const renamed = scanCaptureOrder(swapped.replace("a.isPrime", "a.wasPrime"));
    expect(renamed.captureMatches).toBe(0);
    expect(renamed.capturePrecedesPromotion).toBe(false);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * The backfill question (design.md §4, last paragraph): on a SEALED codex with
 * no `legacyPrimeOuroAccountId`, is `ouroAccounts[0]` necessarily the former
 * prime? The two tests below are the evidence behind the verdict NO.
 * ─────────────────────────────────────────────────────────────────────────── */

/** `appliedAt` is the seal, and it is monotone and permanent. */
const SEALED: MigrationProgress = {
  stage: "done",
  startedAt: "2026-11-17T00:00:00.000Z",
  updatedAt: "2026-11-18T09:30:00.000Z",
  appliedAt: "2026-11-18T09:30:00.000Z",
};

const ROW_BASE = {
  ouroAccountId: "hodler",
  chainwebSeedId: "cw-seed",
  establishedAt: "2026-11-17T00:00:00.000Z",
} as const;

/** The AMBIGUOUS row: sealed, settled, and silent about who it displaced.
 *  Either the finalize displaced nobody, or it predates the capture. */
const ROW_WITHOUT_RECORD: CodexMasterSeed = { ...ROW_BASE };
/** The same settlement, with the displacement actually recorded. */
const ROW_WITH_RECORD: CodexMasterSeed = { ...ROW_BASE, legacyPrimeOuroAccountId: "initial" };

const ouro = (id: string, overrides: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id,
  name: id,
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

describe("why ouroAccounts[0] cannot be backfilled into legacyPrimeOuroAccountId", () => {
  it("answers FALSE for the ambiguous row, so a silent row designates nobody", () => {
    // The three states the whole finding turns on. codex-core's
    // `tests/master-seed-row.test.ts` owns the unit-level coverage of this
    // predicate; these three are re-asserted here, from the consuming package,
    // because the investigation's recommendation ("leave it absent") is only
    // honest while absence means NO designation rather than a wrong one.
    expect(isLegacyPrimeAccount("initial", ROW_WITHOUT_RECORD, SEALED)).toBe(false);
    expect(isLegacyPrimeAccount("initial", ROW_WITH_RECORD, SEALED)).toBe(true);
    // "Displaced nobody" — a finalize that re-confirmed the sitting master.
    // This case must STAY absent; a backfill would invent a predecessor.
    expect(
      isLegacyPrimeAccount("hodler", { ...ROW_BASE, legacyPrimeOuroAccountId: "hodler" }, SEALED),
    ).toBe(false);
  });

  it("lets the displaced prime be DELETED after the seal, which moves index 0 onto an account that never held the role", async () => {
    // The hazard, end to end. `deleteOuroAccount` refuses only an account
    // still carrying `isPrime` (state/store.ts:2571-2575) and the promotion
    // cleared that flag from the displaced one (`:2649-2650`); no entry in
    // `ouronetAccountLock` names a former prime either. So the owner can
    // delete it, and `ouroAccounts[0]` then names its neighbour.
    const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
    const accounts = [
      // index 0 — the legacy prime, displaced by the settlement: its `isPrime`
      // was cleared by the promotion, which is why nothing protects it.
      ouro("initial", { name: "Initial Seed" }),
      // Never prime, never master. The account a backfill would mislabel.
      ouro("spare", { name: "Spare" }),
      // The settled master, still flagged.
      ouro("hodler", { name: "AncientHodler", isPrime: true }),
    ];
    await adapter.saveAll({
      ...emptySnapshot("dev"),
      schemaVersion: 1,
      ouroAccounts: accounts,
      codexMasterSeed: ROW_WITHOUT_RECORD,
      migrationProgress: SEALED,
    });
    const store = createCodexStore();
    await store.getState().actions.init(adapter, "dev");

    // The contrast that proves this spec can SEE a refusal: the master is
    // protected, so a green assertion below is a real permission, not a
    // test that cannot distinguish the two outcomes.
    await expect(store.getState().actions.deleteOuroAccount("hodler")).rejects.toThrow(
      CodexPrimeProtectedError,
    );

    expect(store.getState().ouroAccounts[0]?.id).toBe("initial");
    await store.getState().actions.deleteOuroAccount("initial");

    const survivor = store.getState().ouroAccounts[0];
    expect(survivor?.id).toBe("spare");
    // It never held the role: not flagged, and not the settled master.
    expect(survivor?.isPrime).toBeFalsy();
    expect(survivor?.id).not.toBe(ROW_WITHOUT_RECORD.ouroAccountId);
    // And this is what an index-0 backfill would have produced: a retired
    // designation handed to an account that was never prime.
    expect(
      isLegacyPrimeAccount(
        survivor?.id,
        { ...ROW_WITHOUT_RECORD, legacyPrimeOuroAccountId: survivor?.id },
        SEALED,
      ),
    ).toBe(true);
  });
});
