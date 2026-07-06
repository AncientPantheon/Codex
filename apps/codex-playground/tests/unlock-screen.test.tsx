// ============================================================================
// RED SPEC — the minimal mode-1 unlock screen (T10.6).
//
// The unlock screen drives the REAL unlock path (D-12): a masked password input
// + a submit that calls useCodexAuth().authenticate(password, ttl) — the REAL
// hook, which seeds passwordCache = {value, expiresAt}. It does NOT pre-validate
// the password: authenticate() just caches; a wrong password surfaces at the
// NEXT decrypt as CodexPasswordError. The screen must therefore:
//   - call authenticate WITH the entered password on submit,
//   - NOT swallow/short-circuit before authenticate (no bespoke pre-validation),
//   - NOT call authenticate when the password is empty (the empty-guard branch),
//   - never leak the password to the console or to DOM text (N-06 secret hygiene) —
//     it lives ONLY in the masked <input type="password">.
//
// useCodexAuth is MOCKED here (an acceptable substitute per the acceptance — a
// fake OR a real store-backed provider) so the test is self-contained and pins
// the screen's OWN submit/guard/hygiene logic without a full store mount.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the REAL hook module the screen imports. The screen calls the REAL
// authenticate(password, ttlMinutes?) signature (grep-confirmed at
// packages/codex-ui/src/hooks/useCodexAuth.ts:22, re-exported from
// @ancientpantheon/codex-ouronet/hooks) — we spy on it to assert the wiring.
const authenticate = vi.fn<(password: string, ttlMinutes?: number) => void>();

vi.mock("@ancientpantheon/codex-ouronet/hooks", () => ({
  useCodexAuth: () => ({
    isLocked: true,
    authenticate,
    lock: vi.fn(),
    getCurrentPassword: () => {
      throw new Error("locked");
    },
    passwordCacheExpiresAt: null,
  }),
}));

import { UnlockScreen } from "../src/UnlockScreen";

const SECRET = "throwaway-dev-password";

beforeEach(() => {
  authenticate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("UnlockScreen — the minimal mode-1 unlock path", () => {
  it("seeds the cache by calling the REAL authenticate with the entered password on submit", async () => {
    const user = userEvent.setup();
    render(<UnlockScreen />);

    const input = screen.getByLabelText(/^password$/i);
    expect(input).toHaveAttribute("type", "password"); // masked, not plaintext

    await user.type(input, SECRET);
    await user.click(screen.getByRole("button", { name: /unlock/i }));

    // The screen wires the entered password straight into authenticate — WITH
    // the actual value, not just "called". If this drifts, the unlock seam breaks.
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith(SECRET, expect.anything());
  });

  it("does NOT pre-validate: it seeds the cache and lets a later decrypt surface the wrong password", async () => {
    // authenticate() never rejects a wrong password (it just caches). The screen
    // must forward whatever was typed — even an obviously-wrong password — so the
    // dashboard's next decrypt can throw CodexPasswordError. Assert the screen
    // does NOT gate on password correctness (it has no encrypted secret to check).
    const user = userEvent.setup();
    render(<UnlockScreen />);

    await user.type(screen.getByLabelText(/^password$/i), "definitely-the-wrong-password");
    await user.click(screen.getByRole("button", { name: /unlock/i }));

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith("definitely-the-wrong-password", expect.anything());
    // No error surfaced on the screen — decrypt validation is the dashboard's job.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does NOT call authenticate when the password is empty (the empty-guard branch)", async () => {
    const user = userEvent.setup();
    render(<UnlockScreen />);

    // Submit with an empty input — the guard must short-circuit before caching.
    await user.click(screen.getByRole("button", { name: /unlock/i }));

    expect(authenticate).not.toHaveBeenCalled();
  });

  it("does NOT leak the password to the console or to DOM text (N-06 secret hygiene)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const user = userEvent.setup();
    const { container } = render(<UnlockScreen />);

    await user.type(screen.getByLabelText(/^password$/i), SECRET);
    await user.click(screen.getByRole("button", { name: /unlock/i }));

    // The password must never appear in any console channel...
    for (const spy of [logSpy, errorSpy, warnSpy, debugSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET);
      }
    }
    // ...nor be echoed anywhere in the rendered DOM TEXT (it lives only in the
    // masked input's value, which textContent does not expose).
    expect(container.textContent ?? "").not.toContain(SECRET);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });
});
