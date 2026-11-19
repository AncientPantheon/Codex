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
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { CodexSettingsSection } from "@ancientpantheon/codex-ouronet/ui";
import type { NetworkSettingsModel } from "@ancientpantheon/codex-core";
import { smartEncrypt } from "@stoachain/stoa-core/crypto";

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

    // Advanced tab — Apollo Curve (graduated status) + consumer settings.
    goTab("Advanced");
    expect(screen.getByText("Apollo Curve")).toBeTruthy();
    expect(screen.getByText("Graduated · Always On")).toBeTruthy();
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
    // Exact strings, not regexes: `ChangePasswordCard` (2026-10-15, FIX
    // password-visibility-toggle) now also renders a per-field show/hide
    // toggle button whose OWN aria-label ("Show current password" etc.)
    // substring-matches these same broad `/current password/i`-style
    // regexes, making the lookup ambiguous. The field's own aria-label is
    // the exact string "Current password" (lowercase "password") — pin to
    // that instead of loosening to match both.
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "old-pass" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "fresh-pass-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "fresh-pass-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

    await waitFor(() =>
      // `ChangePasswordCard` (2026-10-15, FIX progress-reporting) now always
      // passes a second `onProgress` callback argument alongside the
      // payload — this seam doesn't use it, but the mock call now has 2
      // arguments instead of 1.
      expect(onChangePassword).toHaveBeenCalledWith(
        {
          currentPassword: "old-pass",
          newPassword: "fresh-pass-1",
        },
        expect.any(Function),
      ),
    );
  });

  it("uses the provided consumerName for the embedded ConsumerSettingsCard", async () => {
    await renderSection({ consumerName: "Mnemosyne", initialTab: "advanced" });
    expect(screen.getByText(/Consumer Settings — Mnemosyne/)).toBeTruthy();
  });
});

describe("<CodexSettingsSection> default change-password seam — bug 1 regression", () => {
  // docs/work/debug/two-real-codex-bugs.md, bug 1: `rekeyCodex` correctly
  // SKIPS (never drops) a secret it can't decrypt under the old password —
  // proven in rekey.test.ts. But the default UI seam here used to discard
  // that `skipped` report entirely and report plain success, leaving the
  // stranded secret on its old password with zero signal to the user. The
  // next time it's needed for signing, decrypting it with the now-current
  // password genuinely fails (a real AES-GCM auth-tag mismatch) — the exact
  // symptom hit live on Rotate Payment Key / Rotate Guard.
  const OLD = "old-majority-password";
  const STRANDED_OLD = "a-different-old-password";
  const NEW = "brand-new-password-1";

  it("surfaces an error — not silent success — when a secret must stay on its old password", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const majorityBlob = await smartEncrypt("plain-majority-key", OLD, "1.0");
    const strandedBlob = await smartEncrypt("plain-stranded-key", STRANDED_OLD, "1.0");
    await adapter.saveAll({
      ...emptySnapshot("dev"),
      pureKeypairs: [
        {
          id: "pk-majority",
          label: "Majority",
          publicKey: "b".repeat(64),
          encryptedPrivateKey: majorityBlob,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "pk-stranded",
          label: "Stranded",
          publicKey: "c".repeat(64),
          encryptedPrivateKey: strandedBlob,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <CodexSettingsSection initialTab="security" />
      </CodexProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("yes"),
    );

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: OLD },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: NEW },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: NEW },
    });
    fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

    // Must name the problem, not silently close as if everything moved.
    await waitFor(() =>
      expect(
        screen.getByText(/could not be moved to the new password/i),
      ).toBeTruthy(),
    );
    // The form must still be open — a silent-success close here would mean
    // the user has no idea anything needs attention.
    expect(screen.getByLabelText("Current password")).toBeTruthy();
  });

  it("reports plain success (no error) when nothing needed to be skipped", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const blob = await smartEncrypt("plain-key", OLD, "1.0");
    await adapter.saveAll({
      ...emptySnapshot("dev"),
      pureKeypairs: [
        {
          id: "pk-only",
          label: "Only",
          publicKey: "b".repeat(64),
          encryptedPrivateKey: blob,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    render(
      <CodexProvider adapter={adapter}>
        <ReadyGate />
        <CodexSettingsSection initialTab="security" />
      </CodexProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("ready").textContent).toBe("yes"),
    );

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: OLD },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: NEW },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: NEW },
    });
    fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

    // The form closes (no error path) exactly as it did before this fix —
    // the regression test above must not have widened the error to the
    // happy path too.
    await waitFor(() =>
      expect(screen.queryByLabelText("Current password")).toBeNull(),
    );
    expect(screen.queryByText(/could not be moved to the new password/i)).toBeNull();
  });
});

describe("<CodexSettingsSection> Network tab (injected connectors)", () => {
  const localModel: NetworkSettingsModel = {
    locked: false,
    chains: [
      { chainId: "stoachain", status: "live-local", manualFieldEnabled: true },
      { chainId: "arweave", status: "live-local", manualFieldEnabled: true },
    ],
  };
  function netConfig(model: NetworkSettingsModel = localModel, pythiaUrl = "") {
    return {
      model,
      urls: { stoachain: "https://node2.stoachain.com", arweave: "http://localhost:1984" },
      onSetChainUrl: vi.fn(),
      pythiaUrl,
      onSetPythiaUrl: vi.fn(),
    };
  }

  it("does NOT render the Network subtab when no network config is injected", async () => {
    await renderSection();
    expect(screen.queryByRole("button", { name: /^network$/i })).toBeNull();
  });

  it("renders the Network subtab with Pythia (global) + per-chain (local) connectors when injected", async () => {
    await renderSection({ network: netConfig() });
    goTab("Network");
    // The Pythia global connector + the two per-chain local rows.
    expect(screen.getByTestId("pythia-connector-card")).toBeTruthy();
    expect(screen.getByTestId("network-row-stoachain")).toBeTruthy();
    expect(screen.getByTestId("network-row-arweave")).toBeTruthy();
  });

  it("disables the StoaChain local field when Pythia (global) covers it", async () => {
    const covered: NetworkSettingsModel = {
      locked: false,
      chains: [
        { chainId: "stoachain", status: "live-global", manualFieldEnabled: false },
        { chainId: "arweave", status: "live-local", manualFieldEnabled: true },
      ],
    };
    await renderSection({ network: netConfig(covered, "https://pythia.example") });
    goTab("Network");
    // Pythia advertises stoachain → its status reads "Live via Pythia" and the
    // local field is disabled; Arweave stays an editable local field.
    expect((screen.getByTestId("network-url-stoachain") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("network-url-arweave") as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByTestId("pythia-status").textContent).toMatch(/covers stoachain/i);
  });
});
