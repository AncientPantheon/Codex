/**
 * StructuralUpgradeWizard specs (docs/work/upgrade-prompt-ui/design.md, T4).
 *
 * Mounts the wizard over a REAL store + MemoryCodexAdapter, seeded directly
 * via `saveAll()` (same convention as `tests/state-structural-upgrade.test.ts`
 * and `tests/structural-migration.test.ts`'s own fixtures), authenticated via
 * `actions.authenticate()` (same `StoreGrabber` seam
 * `tests/hooks-needs-structural-upgrade.test.tsx` already uses to reach the
 * store directly from a test). Real crypto throughout (no mocked
 * smartDecrypt/encryptStringV2) — same rationale every other Stoa-Dalos test
 * in this package already states: these ARE the primitives a regression
 * would actually break, and the live, changing `onProgress` text is only a
 * meaningful proof when it is produced by the real engine's real timing.
 *
 * Two scenarios, matching the plan's two fixture shapes exactly:
 *   1. A word-shaped stoic seed (the legacy-shape bug) — resolves
 *      automatically; the wizard reaches "result" reporting it fixed, and
 *      the live progress text visibly changes ("Checking..." -> "Fixed...")
 *      while still on the "running" step, proving the onProgress callback's
 *      value actually reaches the DOM over the course of the run, not just
 *      a single static line.
 *   2. An UNRESOLVABLE (garbage-plaintext) stoic seed — the engine's
 *      `requestMissingData` fires, and the wizard must pause on its own
 *      "needs-input" step. Two sub-paths: submitting real valid DALOS words
 *      rescues it (-> fixed), or explicitly skipping it (-> skipped, with
 *      its reason shown).
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

/**
 * This suite drives the REAL structural migration (PBKDF2-600k
 * derivations per seed), so Testing Library's 1000ms default for
 * `waitFor`/`findBy*` is under the real work once the rest of the suite
 * is running in parallel — the cause of this file's "passes alone, fails
 * in the full run" history. Raising the async timeout changes only how
 * long a wait is given, never what is asserted.
 */

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";

import { StructuralUpgradeWizard } from "../src/ui/internal/StructuralUpgradeWizard.js";

const PASSWORD = "structural-upgrade-wizard-test-pw";

/** A real, valid DALOS word list — same known-good fixture
 *  `tests/structural-migration.test.ts`/`tests/state-structural-upgrade.test.ts`
 *  already use for the identical purpose. */
const VALID_DALOS_WORDS =
  "bid day just attack address climb actual void method cave " +
  "fuel soldier bright fancy donkey exist gown silly mimic " +
  "canal fiber pulse exercise fit";

/** Builds a MemoryCodexAdapter pre-seeded (via `saveAll`, bypassing any store
 *  action) with one "stoic" kadenaSeeds entry whose `secret` is
 *  `encryptStringV2(plaintext, PASSWORD)` — `plaintext` is either real DALOS
 *  words (the auto-resolvable legacy-shape bug) or garbage (unresolvable,
 *  routes through `requestMissingData`). Mirrors
 *  `tests/state-structural-upgrade.test.ts`'s own `seededAdapter`. */
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

// Exposes the per-mount store so a test can authenticate directly, same
// convention as tests/hooks-needs-structural-upgrade.test.tsx's own
// StoreGrabber.
let capturedStore: ReturnType<typeof useCodexStore> | null = null;
function StoreGrabber() {
  capturedStore = useCodexStore();
  return null;
}

async function renderWizard(adapter: CodexAdapter, onClose: () => void = () => {}) {
  render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <StoreGrabber />
      <StructuralUpgradeWizard open onClose={onClose} />
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("yes"));
  act(() => {
    capturedStore!.getState().actions.authenticate(PASSWORD, 60);
  });
}

const startButton = () => screen.getByTestId("structural-upgrade-start");
const progressText = () => screen.queryByTestId("structural-upgrade-progress-text");

describe("<StructuralUpgradeWizard>", () => {
  describe("auto-resolvable (word-shaped) stoic seed", () => {
    it(
      "reaches a result step reporting the seed fixed, with live progress text that visibly changes mid-run",
      async () => {
        const adapter = await seededAdapter("stoic-legacy-seed", VALID_DALOS_WORDS);
        await renderWizard(adapter);

        // Before starting, there is no progress text at all — this is the
        // "initial pre-upgrade" state the later DOM change is measured
        // against.
        expect(progressText()).toBeNull();

        fireEvent.click(startButton());

        // First observed live progress line, while the engine is still
        // checking the seed.
        await waitFor(() => {
          expect(progressText()).not.toBeNull();
          expect(progressText()!.textContent).toMatch(/checking/i);
        });
        const checkingText = progressText()!.textContent;

        // The SAME element's content must change, live, once the fix is
        // actually applied — not a single static "please wait" line.
        // Asserted INSIDE the waitFor callback: by the time it resolves
        // the run may have already moved past "running" into "result",
        // unmounting the progress-text node entirely.
        let fixedText: string | null = null;
        await waitFor(() => {
          const el = progressText();
          expect(el).not.toBeNull();
          expect(el!.textContent).toMatch(/fixed/i);
          fixedText = el!.textContent;
        });
        expect(fixedText).not.toBe(checkingText);

        await waitFor(() => expect(screen.getByTestId("structural-upgrade-result")).toBeTruthy());
        const fixedList = screen.getByTestId("structural-upgrade-fixed-list");
        expect(within(fixedList).getByText("stoic-legacy-seed")).toBeTruthy();
      },
      15000,
    );
  });

  describe("unresolvable (garbage-plaintext) stoic seed", () => {
    it(
      "pauses on a needs-input step naming the seed, and submitting valid words leads to a result step reporting it fixed",
      async () => {
        const adapter = await seededAdapter("garbage-seed-submit", "not-words-or-bits!@#$%^&*()");
        await renderWizard(adapter);

        fireEvent.click(startButton());

        await waitFor(() =>
          expect(screen.getByTestId("structural-upgrade-needs-input")).toBeTruthy(),
        );
        const needsInput = screen.getByTestId("structural-upgrade-needs-input");
        expect(within(needsInput).getByText(/garbage-seed-submit/)).toBeTruthy();

        fireEvent.change(screen.getByTestId("structural-upgrade-needs-input-field"), {
          target: { value: VALID_DALOS_WORDS },
        });
        fireEvent.click(screen.getByTestId("structural-upgrade-submit-input"));

        await waitFor(() => expect(screen.getByTestId("structural-upgrade-result")).toBeTruthy());
        const fixedList = screen.getByTestId("structural-upgrade-fixed-list");
        expect(within(fixedList).getByText("garbage-seed-submit")).toBeTruthy();
        expect(screen.queryByTestId("structural-upgrade-skipped-list")).toBeNull();
      },
      15000,
    );

    it(
      "pauses on a needs-input step naming the seed, and skipping it leads to a result step reporting it skipped with its reason shown",
      async () => {
        const adapter = await seededAdapter("garbage-seed-skip", "not-words-or-bits!@#$%^&*()");
        await renderWizard(adapter);

        fireEvent.click(startButton());

        await waitFor(() =>
          expect(screen.getByTestId("structural-upgrade-needs-input")).toBeTruthy(),
        );
        const needsInput = screen.getByTestId("structural-upgrade-needs-input");
        expect(within(needsInput).getByText(/garbage-seed-skip/)).toBeTruthy();

        fireEvent.click(screen.getByTestId("structural-upgrade-skip"));

        await waitFor(() => expect(screen.getByTestId("structural-upgrade-result")).toBeTruthy());
        expect(screen.queryByTestId("structural-upgrade-fixed-list")).toBeNull();
        const skippedList = screen.getByTestId("structural-upgrade-skipped-list");
        expect(within(skippedList).getByText(/garbage-seed-skip/)).toBeTruthy();
        // The reason is a real message (smartDecrypt's own failure text) —
        // just confirm something non-empty renders, not a blank line.
        expect(skippedList.textContent!.length).toBeGreaterThan("garbage-seed-skip".length);
      },
      15000,
    );
  });
});
