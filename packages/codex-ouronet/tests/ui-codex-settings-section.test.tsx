/**
 * CodexSettingsSection specs (Phase 15, T15.4 — updated for the v0.5.x subtab
 * reorganisation).
 *
 * The section now groups its cards under four pill-selected subtabs
 * (Operations / Security / Identity & Backup / Advanced) instead of one flat
 * stack. Pins: every card still renders under its tab, the change-password /
 * upgrade seams thread through, the `initialTab` prop opens a chosen tab, and
 * NO Google Drive sync card is present (it stays in OuronetUI).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { CodexSettingsSection } from "@ancientpantheon/codex-ouronet/ui";

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

async function renderSection(
  props: React.ComponentProps<typeof CodexSettingsSection> = {},
) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <CodexSettingsSection {...props} />
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

/** Click a subtab pill by its visible label. */
const goTab = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("<CodexSettingsSection>", () => {
  it("groups every codex settings card under its subtab", async () => {
    await renderSection();

    // Operations is the default tab — ZBOM defaults + gas reference.
    expect(screen.getByText("Patron Selection")).toBeTruthy();
    expect(screen.getByText("Adaptive Gas Limit Algorithm")).toBeTruthy();

    // Security tab — password / encryption / guard / auto-lock.
    goTab("Security");
    expect(
      screen.getByRole("button", { name: /change password/i }),
    ).toBeTruthy();
    // "Encryption" also appears as a CodexInfo row label, so assert the
    // EncryptionCard's unique sub-copy instead.
    expect(screen.getByText("Manage encryption level")).toBeTruthy();
    expect(screen.getByText("CodexGuard")).toBeTruthy();

    // Identity & Backup tab — identity, download, info.
    goTab("Identity & Backup");
    expect(screen.getByText("Codex Identity")).toBeTruthy();
    expect(screen.getByText("Download Codex")).toBeTruthy();
    expect(screen.getByText("Codex Info")).toBeTruthy();

    // Advanced tab — experimental curves + consumer settings.
    goTab("Advanced");
    expect(
      screen.getByRole("button", { name: /enable experimental curves/i }),
    ).toBeTruthy();
  });

  it("opens a chosen tab via the initialTab prop", async () => {
    await renderSection({ initialTab: "security" });
    // Security content is visible without clicking; Operations content is not.
    expect(
      screen.getByRole("button", { name: /change password/i }),
    ).toBeTruthy();
    expect(screen.queryByText("Adaptive Gas Limit Algorithm")).toBeNull();
  });

  it("does NOT render any Google Drive sync card (that stays redux-bound in OuronetUI)", async () => {
    await renderSection();
    for (const tab of ["Security", "Identity & Backup", "Advanced"]) {
      goTab(tab);
      expect(screen.queryByText(/google drive/i)).toBeNull();
      expect(screen.queryByText(/link google/i)).toBeNull();
      expect(screen.queryByText(/save to google/i)).toBeNull();
    }
  });

  it("threads onChangePassword through to the embedded ChangePasswordCard seam", async () => {
    const onChangePassword = vi.fn().mockResolvedValue(undefined);
    await renderSection({ onChangePassword, initialTab: "security" });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: "old-pass" },
    });
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: "fresh-pass-1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), {
      target: { value: "fresh-pass-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

    await waitFor(() =>
      expect(onChangePassword).toHaveBeenCalledWith({
        currentPassword: "old-pass",
        newPassword: "fresh-pass-1",
      }),
    );
  });

  it("uses the provided consumerName for the embedded ConsumerSettingsCard", async () => {
    await renderSection({ consumerName: "Mnemosyne", initialTab: "advanced" });
    expect(screen.getByText(/Consumer Settings — Mnemosyne/)).toBeTruthy();
  });
});
