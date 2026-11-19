/**
 * useNeedsStructuralUpgrade() — single source of truth for "does this
 * codex need a structural upgrade," shared by the nav indicator (T3) and
 * the Codex ID page gating (T5) so they can never disagree.
 *
 * Returns `Codex_Shape_Version !== STRUCTURAL_SHAPE_TARGET_VERSION` — true
 * for both an unversioned codex (`undefined`) and any older stamped value,
 * false only once the live codex is stamped at the real current target.
 * These specs pin exactly those three cases against the REAL
 * `STRUCTURAL_SHAPE_TARGET_VERSION` constant (never a hardcoded guess), so
 * a future bump of that constant can't silently desync the hook from the
 * engine it is meant to track.
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useNeedsStructuralUpgrade } from "@ancientpantheon/codex-ouronet/hooks";
import { STRUCTURAL_SHAPE_TARGET_VERSION } from "@ancientpantheon/codex-ouronet/structural-migration";

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

// Exposes the per-mount store so a test can set Codex_Shape_Version directly,
// same convention as tests/ui-codex-settings-info-cards.test.tsx's own
// StoreGrabber.
let capturedStore: ReturnType<typeof useCodexStore> | null = null;
function StoreGrabber() {
  capturedStore = useCodexStore();
  return null;
}

function NeedsUpgradeProbe() {
  const needsUpgrade = useNeedsStructuralUpgrade();
  return <span data-testid="needs-upgrade">{String(needsUpgrade)}</span>;
}

async function renderProbe() {
  const adapter = new MemoryCodexAdapter("dev");
  render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <StoreGrabber />
      <NeedsUpgradeProbe />
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
}

describe("useNeedsStructuralUpgrade", () => {
  it("returns true for an unversioned codex (Codex_Shape_Version undefined)", async () => {
    await renderProbe();
    // A fresh MemoryCodexAdapter("dev") with no stamping leaves
    // Codex_Shape_Version at its default `undefined` — the exact
    // "Unversioned" case this hook exists to flag.
    expect(screen.getByTestId("needs-upgrade").textContent).toBe("true");
  });

  it("returns true for an older, explicitly-stamped Codex_Shape_Version", async () => {
    await renderProbe();
    await act(async () => {
      capturedStore!.setState({ Codex_Shape_Version: "0.9.0" });
    });
    expect(screen.getByTestId("needs-upgrade").textContent).toBe("true");
  });

  it("returns false once Codex_Shape_Version matches the real STRUCTURAL_SHAPE_TARGET_VERSION", async () => {
    await renderProbe();
    await act(async () => {
      capturedStore!.setState({
        Codex_Shape_Version: STRUCTURAL_SHAPE_TARGET_VERSION,
      });
    });
    expect(screen.getByTestId("needs-upgrade").textContent).toBe("false");
  });
});
