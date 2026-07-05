/**
 * Settings info/account cards specs (Phase 15, T15.1):
 * <CodexInfoCard>, <ChangePasswordCard>, <DownloadCodexCard>.
 *
 * Token-styled, Redux-free ports of OuronetUI's CodexInfoSection + the
 * Change-Password / Download cards from settings.tsx. State flows strictly
 * through the package hooks over a mounted <CodexProvider> (Phase-14 harness:
 * wait for useCodex().isReady before seeding). Re-encryption (change-password)
 * and the actual download trigger are consumer-supplied seams — the cards
 * delegate, they do not own that logic.
 */

import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import {
  CodexInfoCard,
  ChangePasswordCard,
  DownloadCodexCard,
} from "@ancientpantheon/codex-ouronet/ui";

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

// Exposes the per-mount store so a test can seed slices directly (the cards
// read counts/secrets from the store; there is no add-seed form here).
let capturedStore: ReturnType<typeof useCodexStore> | null = null;
function StoreGrabber() {
  capturedStore = useCodexStore();
  return null;
}

async function renderUnder(node: React.ReactNode) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <ReadyGate />
      <StoreGrabber />
      {node}
    </CodexProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("ready").textContent).toBe("yes"),
  );
  return utils;
}

describe("<CodexInfoCard>", () => {
  it("renders live counts derived from the codex state so a seeded codex shows its seed/account totals", async () => {
    await renderUnder(<CodexInfoCard />);

    // Seed one kadena seed + two address-book entries (one ouronet, one stoa).
    await act(async () => {
      capturedStore!.setState({
        kadenaSeeds: [
          {
            id: "s1",
            seedType: "koala",
            version: "1",
            index: 0,
            secret: "enc-secret",
            main: "k:abc",
            createdAt: new Date().toISOString(),
            accounts: [],
          },
        ],
        addressBook: [
          {
            id: "a1",
            name: "Ouro",
            address: "Ѻ.x",
            type: "ouronet",
            createdAt: "t",
            updatedAt: "t",
          },
          {
            id: "a2",
            name: "Stoa",
            address: "k:y",
            type: "stoa",
            createdAt: "t",
            updatedAt: "t",
          },
        ],
      });
    });

    // Count rows are keyed by their label; the value cell carries a stable
    // testid so the assertion pins the number, not incidental copy.
    expect(screen.getByTestId("info-seeds").textContent).toBe("1");
    expect(screen.getByTestId("info-ab-ouronet").textContent).toBe("1");
    expect(screen.getByTestId("info-ab-stoa").textContent).toBe("1");
  });

  it("shows the device variant from the codex so the user can tell which device last wrote", async () => {
    await renderUnder(<CodexInfoCard />);
    // MemoryCodexAdapter("dev") → lastUpdatedDevice is "dev".
    expect(screen.getByTestId("info-device").textContent).toBe("dev");
  });
});

describe("<ChangePasswordCard>", () => {
  it("delegates the new password to onChangePassword only after current/new/confirm validate", async () => {
    const onChangePassword = vi.fn().mockResolvedValue(undefined);
    await renderUnder(
      <ChangePasswordCard onChangePassword={onChangePassword} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: "old-pass-1" },
    });
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: "brand-new-pass" },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), {
      target: { value: "brand-new-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

    // The card hands the exact pair to the consumer seam — it does NOT
    // re-encrypt itself.
    await waitFor(() =>
      expect(onChangePassword).toHaveBeenCalledWith({
        currentPassword: "old-pass-1",
        newPassword: "brand-new-pass",
      }),
    );
  });

  it("blocks submit when the confirmation does not match so a typo never reaches the seam", async () => {
    const onChangePassword = vi.fn().mockResolvedValue(undefined);
    await renderUnder(
      <ChangePasswordCard onChangePassword={onChangePassword} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: "old" },
    });
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: "aaaaaaaa" },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), {
      target: { value: "bbbbbbbb" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^submit/i }));

    expect(onChangePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeTruthy();
  });
});

describe("<DownloadCodexCard>", () => {
  it("invokes useCodexBackup().downloadAsJson when the user clicks Download", async () => {
    // jsdom lacks URL.createObjectURL; stub it so the real hook path runs.
    const createObjectURL = vi.fn(() => "blob:codex");
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL =
      createObjectURL as unknown as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL =
      revokeObjectURL as unknown as typeof window.URL.revokeObjectURL;

    await renderUnder(<DownloadCodexCard />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    // The blob URL is only created when downloadAsJson actually runs — proves
    // the card is wired to the backup hook, not a no-op.
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });
});
