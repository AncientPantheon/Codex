// ============================================================================
// RED SPEC — `CreateCodexScreen`, the minimal "create a brand-new codex" form
// (T4 of docs/work/codex-recovery-backup-tagging/plan.md).
//
// No file under `apps/` called `useCodexLifecycle()`'s `kickstart` before this
// task (grep-confirmed) — there was no UI path to exercise kickstart + the
// Prime Arweave auto-install locally at all. This is that minimal path's
// form half.
//
// PRESENTATIONAL + INJECTED, mirroring `ArweaveSeedsArea.tsx`'s own
// "reaches into NO store" discipline: `onCreate` is a plain callback, so this
// test never mocks a hook module — it drives the real rendered form exactly
// as a user would and asserts what reaches the injected callback.
// ============================================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateCodexScreen } from "../src/CreateCodexScreen";

afterEach(() => {
  cleanup();
});

describe("CreateCodexScreen", () => {
  it("submits the typed password and seed words to onCreate", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CreateCodexScreen onCreate={onCreate} busy={false} />);

    await user.type(screen.getByLabelText(/codex password/i), "dev-throwaway-password");
    const wordsField = screen.getByLabelText(/seed words/i);
    await user.clear(wordsField);
    await user.type(wordsField, "orbit lantern meadow cobalt granite ember");
    await user.click(screen.getByRole("button", { name: /create codex/i }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      password: "dev-throwaway-password",
      words: "orbit lantern meadow cobalt granite ember",
    });
  });

  it("does not submit with an empty password (never kickstarts with no secret)", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CreateCodexScreen onCreate={onCreate} busy={false} />);

    await user.click(screen.getByRole("button", { name: /create codex/i }));

    expect(onCreate).not.toHaveBeenCalled();
  });

  it("disables the submit button and shows the live progress label while busy (never a silent multi-second freeze)", () => {
    render(
      <CreateCodexScreen
        onCreate={vi.fn()}
        busy
        progressLabel="Deriving your Prime Arweave seed… (~7s)"
      />,
    );

    const button = screen.getByRole("button", { name: /deriving your prime arweave seed/i });
    expect(button).toBeDisabled();
  });

  it("surfaces an errorMessage as an alert", () => {
    render(
      <CreateCodexScreen onCreate={vi.fn()} busy={false} errorMessage="kickstart failed: boom" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("kickstart failed: boom");
  });

  it("never leaks the typed password into the rendered DOM text (N-06 secret hygiene)", async () => {
    const SECRET = "throwaway-dev-password";
    const user = userEvent.setup();
    const { container } = render(<CreateCodexScreen onCreate={vi.fn()} busy={false} />);

    await user.type(screen.getByLabelText(/codex password/i), SECRET);

    expect(container.textContent ?? "").not.toContain(SECRET);
  });
});
