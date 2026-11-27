/**
 * `honest-failure-reporting` design.md §2, acceptance criteria 3 and 4 —
 * the RESULT step must say which of the four things actually happened.
 *
 * Before this, `runStructuralMigration`'s three distinct silent `continue`s
 * (not-stoic, empty secret, already-current) were indistinguishable to the
 * caller, so "this codex has no seeds I am responsible for" and "every seed
 * was already fine" both reached the user as the same line, `Fixed 0 seeds.`
 *
 * Two layers, deliberately:
 *   - `describeStructuralUpgradeOutcome` is pure, so the full outcome matrix
 *     is asserted without crypto or a DOM.
 *   - two MOUNTED runs over a real store + `MemoryCodexAdapter` with REAL
 *     crypto prove the text actually reaches the DOM, and that a partial run
 *     leaves the codex's `Codex_Shape_Version` unstamped so the Codex ID
 *     page keeps offering the upgrade (criterion 3's "the retry button
 *     survives a partial run").
 *
 * No `vi.mock` anywhere: the store is injected with a real adapter, exactly
 * as `tests/ui-structural-upgrade-wizard.test.tsx` already does.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { STRUCTURAL_SHAPE_TARGET_VERSION } from "@ancientpantheon/codex-ouronet/structural-migration";
import type { StructuralMigrationResult } from "@ancientpantheon/codex-ouronet/structural-migration";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";

import {
  StructuralUpgradeWizard,
  describeStructuralUpgradeOutcome,
} from "../src/ui/internal/StructuralUpgradeWizard.js";

const PASSWORD = "structural-upgrade-outcome-test-pw";

/** A real 1600-char DALOS bitstring — the already-current shape. */
const BITSTRING_1600 = "01".repeat(800);

/** Builds a result with the given counters over an empty snapshot. Only the
 *  counters matter to `describeStructuralUpgradeOutcome`, which is pure. */
function resultWith(counts: Partial<StructuralMigrationResult>): StructuralMigrationResult {
  return {
    snapshot: {} as StructuralMigrationResult["snapshot"],
    fixedSeedIds: [],
    skipped: [],
    examined: 0,
    alreadyCurrent: 0,
    emptySecret: 0,
    notEligible: 0,
    ...counts,
  };
}

/** Mirrors `tests/ui-structural-upgrade-wizard.test.tsx`'s own
 *  `seededAdapter` — one "stoic" kadenaSeeds entry whose `secret` is
 *  `encryptStringV2(plaintext, PASSWORD)`, written straight through
 *  `saveAll` so the test controls the exact on-disk shape. */
async function seededAdapter(seedId: string, plaintext: string): Promise<CodexAdapter> {
  const adapter = new MemoryCodexAdapter("dev");
  const secret = await encryptStringV2(plaintext, PASSWORD);
  await adapter.saveAll({
    kadenaSeeds: [
      {
        id: seedId,
        seedType: "stoic",
        version: "1.0",
        index: 0,
        secret,
        main: "deadbeef",
        createdAt: "2026-01-01T00:00:00.000Z",
        accounts: [],
        isPrime: true,
      },
    ],
    ouroAccounts: [],
    pureKeypairs: [],
    addressBook: [],
    watchList: [],
    uiSettings: {} as never,
    schemaVersion: 1,
    lastUpdatedAt: null,
    lastUpdatedDevice: "dev",
  } as never);
  return adapter;
}

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

let capturedStore: ReturnType<typeof useCodexStore> | null = null;
function StoreGrabber() {
  capturedStore = useCodexStore();
  return null;
}

async function renderWizard(adapter: CodexAdapter) {
  render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <StoreGrabber />
      <StructuralUpgradeWizard open onClose={() => {}} />
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
  act(() => {
    capturedStore!.getState().actions.authenticate(PASSWORD, 60);
  });
}

const outcomeText = () => screen.getByTestId("structural-upgrade-outcome").textContent ?? "";

describe("describeStructuralUpgradeOutcome", () => {
  it("gives every outcome its own kind and its own sentence — never one shared 'Fixed 0 seeds.'", () => {
    const outcomes = [
      // Nothing in the codex at all.
      describeStructuralUpgradeOutcome(resultWith({})),
      // Seeds exist, but none of a type this engine walks.
      describeStructuralUpgradeOutcome(resultWith({ notEligible: 2 })),
      // Walked two, both already the current shape.
      describeStructuralUpgradeOutcome(resultWith({ examined: 2, alreadyCurrent: 2 })),
      // Walked two, fixed both.
      describeStructuralUpgradeOutcome(resultWith({ examined: 2, fixedSeedIds: ["a", "b"] })),
      // Walked two, fixed one, left one exactly as it was.
      describeStructuralUpgradeOutcome(
        resultWith({
          examined: 2,
          fixedSeedIds: ["a"],
          skipped: [{ slice: "kadenaSeeds", id: "b", reason: "unreadable" }],
        }),
      ),
    ];

    expect(outcomes.map((o) => o.kind)).toEqual([
      "examined-none",
      "not-eligible",
      "already-current",
      "fixed",
      "skipped",
    ]);
    // The whole point: five different situations, five different sentences.
    expect(new Set(outcomes.map((o) => o.headline)).size).toBe(5);
    for (const outcome of outcomes) expect(outcome.headline).toMatch(/\S/);
  });

  it("distinguishes an empty secret from an already-current one, and reports both together", () => {
    expect(describeStructuralUpgradeOutcome(resultWith({ examined: 1, emptySecret: 1 })).headline).toMatch(
      /no stored secret/i,
    );
    const mixed = describeStructuralUpgradeOutcome(
      resultWith({ examined: 3, alreadyCurrent: 2, emptySecret: 1 }),
    );
    expect(mixed.kind).toBe("already-current");
    expect(mixed.headline).toMatch(/2 already in the current shape/i);
    expect(mixed.headline).toMatch(/1 with no stored secret/i);
  });

  it("says the upgrade is still needed after a partial run, and not after a clean one", () => {
    const partial = describeStructuralUpgradeOutcome(
      resultWith({
        examined: 1,
        skipped: [{ slice: "kadenaSeeds", id: "b", reason: "unreadable" }],
      }),
    );
    expect(partial.stillNeedsUpgrade).toBe(true);
    expect(partial.headline).toMatch(/still marked as needing an upgrade/i);

    expect(
      describeStructuralUpgradeOutcome(resultWith({ examined: 1, fixedSeedIds: ["a"] })).stillNeedsUpgrade,
    ).toBe(false);
  });

  it("names the seeds it never examined, even when it did examine others", () => {
    const outcome = describeStructuralUpgradeOutcome(
      resultWith({ examined: 1, fixedSeedIds: ["a"], notEligible: 3 }),
    );
    expect(outcome.kind).toBe("fixed");
    expect(outcome.note).toMatch(/3 other seed/i);
  });
});

describe("<StructuralUpgradeWizard> — the result step reports which outcome occurred", () => {
  it(
    "says the examined seed was already in the current shape, instead of reporting 0 fixed seeds",
    async () => {
      const adapter = await seededAdapter("already-current-seed", BITSTRING_1600);
      await renderWizard(adapter);

      fireEvent.click(screen.getByTestId("structural-upgrade-start"));

      await waitFor(() => expect(screen.getByTestId("structural-upgrade-result")).toBeTruthy());
      expect(outcomeText()).toMatch(/already in the current shape/i);
      expect(outcomeText()).not.toMatch(/fixed 0/i);
      // A clean run IS a completed run — the stamp is earned here.
      expect(capturedStore!.getState().Codex_Shape_Version).toBe(STRUCTURAL_SHAPE_TARGET_VERSION);
    },
    15000,
  );

  it(
    "says the codex still needs an upgrade after a skipped seed, and leaves Codex_Shape_Version unstamped so the retry survives",
    async () => {
      const adapter = await seededAdapter("skipped-seed", "not-words-or-bits!@#$%^&*()");
      await renderWizard(adapter);

      fireEvent.click(screen.getByTestId("structural-upgrade-start"));

      await waitFor(() => expect(screen.getByTestId("structural-upgrade-needs-input")).toBeTruthy());
      fireEvent.click(screen.getByTestId("structural-upgrade-skip"));

      await waitFor(() => expect(screen.getByTestId("structural-upgrade-result")).toBeTruthy());
      expect(outcomeText()).toMatch(/still marked as needing an upgrade/i);
      // The defect this whole section exists for: the stamp used to be made
      // unconditionally, after which `useNeedsStructuralUpgrade` returned
      // false and the Codex ID page showed "✓ Versioned" permanently.
      expect(capturedStore!.getState().Codex_Shape_Version).not.toBe(STRUCTURAL_SHAPE_TARGET_VERSION);
    },
    15000,
  );
});
