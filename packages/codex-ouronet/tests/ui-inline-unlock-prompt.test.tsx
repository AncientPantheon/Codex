/**
 * `docs/work/wizard-unlock-lifecycle/plan.md` T1 — `<InlineUnlockPrompt>`, the
 * reusable inline "the codex is locked, enter your password" panel, shaped after
 * the Account step's existing `legacy-prime-migration-account-probe-unlock`
 * panel in `LegacyPrimeMigrationWizard.tsx`.
 *
 * The component is deliberately AUTH-FREE: it collects a password and hands it
 * to an injected `onUnlock`. Deciding whether to call `authenticate()` (which
 * must only happen on a genuinely locked codex — the unlock window is absolute,
 * not sliding) belongs to the callers, so every test here drives `onUnlock`
 * directly.
 *
 * NB: `@testing-library/jest-dom` is a declared dependency of this package but
 * is NEVER registered in `tests/setup.ts`, so `toBeDisabled()` and friends throw
 * `Invalid Chai property` — and inside `waitFor` that surfaces as an opaque
 * "Test timed out in 5000ms". Every assertion below uses plain DOM properties.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

import { InlineUnlockPrompt } from "../src/ui/internal/InlineUnlockPrompt.js";

afterEach(cleanup);

type UnlockResult = { ok: boolean; error?: string };

const MESSAGE = "Your codex is locked — enter your password to finish.";

const input = () => screen.getByTestId("wizard-unlock-prompt-input") as HTMLInputElement;
const submit = () => screen.getByTestId("wizard-unlock-prompt-submit") as HTMLButtonElement;

/** A promise whose settlement the test controls, so "in flight" is observable. */
function deferred(): {
  promise: Promise<UnlockResult>;
  resolve: (v: UnlockResult) => void;
} {
  let resolve: (v: UnlockResult) => void = () => {};
  const promise = new Promise<UnlockResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("<InlineUnlockPrompt>", () => {
  it("renders the caller-supplied message, and no error line before any attempt", () => {
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={vi.fn()} />);

    expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    // A stale/eagerly-rendered error line would accuse the user of a wrong
    // password before they have typed anything.
    expect(screen.queryByTestId("wizard-unlock-prompt-error")).toBeNull();
  });

  it("passes the typed password to onUnlock when submit is clicked", async () => {
    const onUnlock = vi.fn<(pw: string) => Promise<UnlockResult>>(async () => ({ ok: true }));
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={onUnlock} />);

    fireEvent.change(input(), { target: { value: "hunter2" } });
    fireEvent.click(submit());

    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    // The whole point of the component: the exact string the user typed, not a
    // stale render-time capture of it.
    expect(onUnlock).toHaveBeenCalledWith("hunter2");
  });

  it("submits on Enter in the input, matching the Account step's panel", async () => {
    const onUnlock = vi.fn<(pw: string) => Promise<UnlockResult>>(async () => ({ ok: true }));
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={onUnlock} />);

    fireEvent.change(input(), { target: { value: "enter-pw" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("enter-pw"));
  });

  it("does not call onUnlock while the field is empty (submit stays disabled)", () => {
    const onUnlock = vi.fn<(pw: string) => Promise<UnlockResult>>(async () => ({ ok: true }));
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={onUnlock} />);

    // An empty submit would spend a real `authenticate()` attempt and come back
    // as a bogus "Incorrect password", blaming the user for a no-op click.
    expect(submit().disabled).toBe(true);
    fireEvent.click(submit());
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("disables both the input and the submit button while onUnlock is pending", async () => {
    const d = deferred();
    const onUnlock = vi.fn<(pw: string) => Promise<UnlockResult>>(() => d.promise);
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={onUnlock} />);

    fireEvent.change(input(), { target: { value: "slow-pw" } });
    fireEvent.click(submit());

    // In flight, the password derivation is seconds long: a second click would
    // fire a duplicate authenticate, and an editable field would let the typed
    // value drift away from the attempt actually being checked.
    await waitFor(() => expect(submit().disabled).toBe(true));
    expect(input().disabled).toBe(true);

    // Release as a FAILURE on purpose: that is the path where the typed value
    // survives, so "both controls came back" is observable. (On success the
    // field clears, which disables submit again for the legitimate reason.)
    await act(async () => {
      d.resolve({ ok: false, error: "Incorrect password — try again." });
      await d.promise;
    });

    // Not stuck: an in-flight guard that never released would strand the user
    // in a dead panel with no way to retry.
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(input().disabled).toBe(false);
  });

  it("renders the error and KEEPS the typed password when onUnlock resolves { ok: false }", async () => {
    const onUnlock = vi.fn<(pw: string) => Promise<UnlockResult>>(async () => ({
      ok: false,
      error: "Incorrect password — try again.",
    }));
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={onUnlock} />);

    fireEvent.change(input(), { target: { value: "wrong-pw" } });
    fireEvent.click(submit());

    await waitFor(() =>
      expect(screen.getByTestId("wizard-unlock-prompt-error").textContent).toBe(
        "Incorrect password — try again.",
      ),
    );
    // A failed attempt must be retryable from where the user stands: clearing
    // the field on failure forces a full re-type of a long codex password.
    expect(input().value).toBe("wrong-pw");
    expect(submit().disabled).toBe(false);
  });

  it("clears the input and any previous error when onUnlock resolves { ok: true }", async () => {
    const results: UnlockResult[] = [
      { ok: false, error: "Incorrect password — try again." },
      { ok: true },
    ];
    const onUnlock = vi.fn<(pw: string) => Promise<UnlockResult>>(
      async () => results.shift() as UnlockResult,
    );
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={onUnlock} />);

    fireEvent.change(input(), { target: { value: "wrong-pw" } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByTestId("wizard-unlock-prompt-error")).toBeTruthy());

    fireEvent.change(input(), { target: { value: "right-pw" } });
    fireEvent.click(submit());

    // The plaintext password must not linger in a mounted DOM node after it has
    // been accepted, and the stale error must not outlive the failure it described.
    await waitFor(() => expect(input().value).toBe(""));
    expect(screen.queryByTestId("wizard-unlock-prompt-error")).toBeNull();
  });

  it("uses the caller's submitLabel when given, and a default otherwise", () => {
    render(<InlineUnlockPrompt message={MESSAGE} onUnlock={vi.fn()} />);
    const defaultLabel = submit().textContent;
    expect(defaultLabel).toBeTruthy();
    cleanup();

    render(<InlineUnlockPrompt message={MESSAGE} submitLabel="Unlock & Finish" onUnlock={vi.fn()} />);
    expect(submit().textContent).toBe("Unlock & Finish");
  });
});
