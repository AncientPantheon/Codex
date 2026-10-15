/**
 * ChangePasswordCard — password-visibility toggle + live progress reporting.
 *
 * Both fixes came from a real downstream consumer report (OuronetUI,
 * 2026-10-15), against this EXACT component (confirmed: the literal button
 * text "Submitting…" in their screenshot is this card's own code, compiled
 * into their installed @ancientpantheon/codex dist — not a lookalike they
 * built themselves):
 *
 *   1. "i need to have view button for the password fields in order to see
 *      what i type" — each of the three password inputs gets its own
 *      independent show/hide toggle (not a single shared one), since a user
 *      may want to verify New/Confirm match without re-revealing Current.
 *   2. "It seems to have worked, but i need to see the progress view, of
 *      how it reencrypts everything anew, to see its not dead" — the card's
 *      own try/catch/finally around `onChangePassword` is already correct
 *      (confirmed by reading it: `busy` always clears once the consumer's
 *      promise settles, success or failure). A permanently-stuck
 *      "Submitting…" means the CONSUMER's own handler promise never
 *      settles — not a bug in this card. What this card *can* do is turn an
 *      indistinguishable freeze into a visible one: `onChangePassword` may
 *      now optionally receive a second argument, an `onProgress` reporter,
 *      mirroring the exact shape OuronetUI's own `upgradeCodexEncryption`
 *      already uses internally (`(password, onProgress) => Promise<...>`).
 *      The card shows whatever the consumer last reported while busy.
 *
 * Backward compatible: a consumer whose `onChangePassword` ignores the
 * second argument (or isn't even typed to expect it) behaves exactly as
 * before — no progress line ever renders, same as today.
 */

import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import { CodexProvider } from "../src/provider/index.js";
import { ChangePasswordCard } from "../src/ui/settings/ChangePasswordCard.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

afterEach(cleanup);

/** `ChangePasswordCard` internally calls `useCodexAuth()` (for its own
 *  "Lock codex now" link, unrelated to these tests) — a real, freshly
 *  mounted `<CodexProvider>` per render is the minimal fixture that
 *  satisfies it, mirroring `hooks-use-request-logout.test.tsx`'s own
 *  pattern for the same requirement. */
function renderCard(
  onChangePassword: NonNullable<
    React.ComponentProps<typeof ChangePasswordCard>["onChangePassword"]
  >,
) {
  return render(
    <CodexProvider createStore={createCodexStore} adapter={new MemoryCodexAdapter()}>
      <ChangePasswordCard onChangePassword={onChangePassword} />
    </CodexProvider>,
  );
}

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "Change Password" }));
}

function fillValid() {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "oldpassword1" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "newpassword1" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "newpassword1" },
  });
}

describe("ChangePasswordCard — password visibility toggle", () => {
  it("each password field defaults to type=password (hidden)", () => {
    renderCard(async () => {});
    openForm();
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
  });

  it("toggling Current password's own visibility button reveals ONLY that field (type=text), the other two stay hidden", () => {
    renderCard(async () => {});
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Show current password" }));
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
  });

  it("clicking the same toggle again re-hides the field (type=password) and the button label flips back", () => {
    renderCard(async () => {});
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Show current password" }));
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide current password" }));
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "password");
  });

  it("New and Confirm each have their own independent toggle, operating only on their own field", () => {
    renderCard(async () => {});
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show confirm new password" }));
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "text");
  });
});

describe("ChangePasswordCard — live progress reporting", () => {
  it("while busy, with no progress reported yet, shows no progress line (just the existing 'Submitting…' button state)", async () => {
    let releaseHandler: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    renderCard(async () => {
      await pending;
    });
    openForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("button", { name: "Submitting…" })).toBeTruthy();
    expect(screen.queryByTestId("change-password-progress")).toBeNull();
    await act(async () => {
      releaseHandler?.();
      await pending;
    });
  });

  it("calling the onProgress reporter updates a visible progress line while busy", async () => {
    let reportStep: ((step: string) => void) | null = null;
    let releaseHandler: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    renderCard(async (_payload, onProgress) => {
      reportStep = onProgress ?? null;
      await pending;
    });
    openForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("button", { name: "Submitting…" });

    act(() => {
      reportStep?.("Re-encrypting seed 1/3: Prime Seed…");
    });
    expect(await screen.findByTestId("change-password-progress")).toHaveTextContent(
      "Re-encrypting seed 1/3: Prime Seed…",
    );

    act(() => {
      reportStep?.("Re-encrypting seed 2/3: Secondary Seed…");
    });
    expect(screen.getByTestId("change-password-progress")).toHaveTextContent(
      "Re-encrypting seed 2/3: Secondary Seed…",
    );

    await act(async () => {
      releaseHandler?.();
      await pending;
    });
  });

  it("the progress line is cleared once the form closes after a successful submit", async () => {
    let reportStep: ((step: string) => void) | null = null;
    renderCard(async (_payload, onProgress) => {
      reportStep = onProgress ?? null;
      reportStep?.("Re-encrypting seed 1/1: Prime Seed…");
    });
    openForm();
    fillValid();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    // Submit succeeded -> form collapses back to the closed "Change Password" button.
    expect(screen.getByRole("button", { name: "Change Password" })).toBeTruthy();
    expect(screen.queryByTestId("change-password-progress")).toBeNull();
  });

  it("a consumer whose onChangePassword never calls onProgress behaves exactly as before (no progress line ever appears)", async () => {
    renderCard(async () => {
      // Ignores the second argument entirely — the pre-existing contract.
    });
    openForm();
    fillValid();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    expect(screen.queryByTestId("change-password-progress")).toBeNull();
  });
});
