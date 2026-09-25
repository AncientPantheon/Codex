/**
 * CodexPasswordPrompt — stacking-order regression test.
 *
 * Owner-reported bug (a "Release StoicTag" ZBOM action stuck forever on
 * "Processing…"): `ZbomModalFrame` (codex-ouronet) deliberately sits at
 * z-index 10050 (round 29 — so it always stacks ABOVE a `CodexModalShell`
 * popup already open underneath it, e.g. an account-detail full-screen
 * view). But a signed action on a LOCKED codex calls `ensureCodexUnlocked()`
 * / `requestPassword()` FROM INSIDE that already-open ZBOM modal, which
 * opens `CodexPasswordPrompt` — ALSO a `CodexModalShell`. At the shared
 * default of 9999, the prompt rendered INVISIBLY BEHIND the ZBOM card:
 * `handleExecute`'s `await ensureCodexUnlocked()` could never resolve
 * because the user could never see or reach the password input it was
 * waiting on — the observed symptom was an indefinite "Processing…" hang
 * with a `🔒 Locked` codex and no visible unlock dialog.
 *
 * This locks in the fix: `CodexPasswordPrompt` must always render at a
 * z-index higher than ANY other popup in the app, including `ZbomModalFrame`.
 */
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import { CodexPasswordPrompt } from "../src/ui/CodexLockControl.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

/** The z-index codex-ouronet's ZbomModalFrame deliberately sits at (round 29)
 *  — kept in sync manually since it lives in a sibling package; the load-
 *  bearing assertion below is ">", not an exact match. */
const ZBOM_MODAL_FRAME_Z_INDEX = 10050;

function mountAndOpen() {
  const adapter = new MemoryCodexAdapter("dev");
  let opened: Promise<string> | null = null;
  function Opener() {
    const store = useCodexStore();
    if (!opened) {
      opened = store.getState().actions.requestPassword();
      opened.catch(() => {});
    }
    return null;
  }
  const utils = render(
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      <Opener />
      <CodexPasswordPrompt />
    </CodexProvider>,
  );
  return utils;
}

describe("CodexPasswordPrompt — always renders above ZbomModalFrame", () => {
  it("its dialog's z-index is numerically greater than ZbomModalFrame's (10050)", async () => {
    await act(async () => {
      mountAndOpen();
    });
    const dialog = screen.getByRole("dialog");
    const z = Number(dialog.style.zIndex);
    expect(z).toBeGreaterThan(ZBOM_MODAL_FRAME_Z_INDEX);
  });

  it("uses the same 'always topmost' sentinel (2147483647) other must-win-the-stack popups in this app already use", async () => {
    await act(async () => {
      mountAndOpen();
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.zIndex).toBe("2147483647");
  });
});
