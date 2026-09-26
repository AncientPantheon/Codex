/**
 * Settings encryption/experimental cards specs (Phase 15, T15.2):
 * <EncryptionCard>, <ExperimentalCurvesCard>.
 *
 * EncryptionCard derives V1/V2 status from the codex secrets (read-only via
 * stoa-core's allEncryptedV2) and delegates the upgrade to a consumer seam.
 *
 * ExperimentalCurvesCard — RETIRED AS A TOGGLE (owner ruling, 2026-09-26):
 * Apollo has graduated from experimental to always-on, so the card no
 * longer reads or writes `uiSettings.experimentalCurvesEnabled` — it is a
 * static status display now, no button, no store interaction. Phase-14
 * harness throughout.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import {
  EncryptionCard,
  ExperimentalCurvesCard,
} from "@ancientpantheon/codex-ouronet/ui";

function ReadyGate() {
  const { isReady } = useCodex();
  return <span data-testid="ready">{isReady ? "yes" : "no"}</span>;
}

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

// A V1 (legacy) and a V2 envelope, recognised by stoa-core's isEncryptedV2.
// V2 is a base64 JSON blob with `v:2`; V1 is anything else.
const V1_SECRET = "legacy-cipher-text";
const V2_SECRET = Buffer.from(
  JSON.stringify({ v: 2, salt: "s", iv: "i", ct: "c" }),
).toString("base64");

describe("<EncryptionCard>", () => {
  it("shows the legacy badge and the upgrade affordance when any secret is still V1", async () => {
    await renderUnder(<EncryptionCard onUpgradeEncryption={vi.fn()} />);
    await act(async () => {
      capturedStore!.setState({
        kadenaSeeds: [
          {
            id: "s1",
            seedType: "koala",
            version: "1",
            index: 0,
            secret: V1_SECRET,
            main: "k:abc",
            createdAt: "t",
            accounts: [],
          },
        ],
      });
    });
    expect(screen.getByText(/legacy/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /upgrade encryption/i }),
    ).toBeTruthy();
  });

  it("hides the upgrade button when every secret is already V2 (nothing to upgrade)", async () => {
    await renderUnder(<EncryptionCard onUpgradeEncryption={vi.fn()} />);
    await act(async () => {
      capturedStore!.setState({
        pureKeypairs: [
          {
            id: "p1",
            publicKey: "pk",
            encryptedPrivateKey: V2_SECRET,
            createdAt: "t",
          },
        ],
      });
    });
    expect(screen.getByText(/upgraded/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /upgrade encryption/i }),
    ).toBeNull();
  });

  it("delegates to onUpgradeEncryption when the legacy upgrade button is clicked", async () => {
    const onUpgradeEncryption = vi.fn().mockResolvedValue(undefined);
    await renderUnder(
      <EncryptionCard onUpgradeEncryption={onUpgradeEncryption} />,
    );
    await act(async () => {
      capturedStore!.setState({
        ouroAccounts: [
          {
            id: "o1",
            version: "1",
            isSmart: false,
            address: "Ѻ.x",
            guard: null,
            stoaChainLedger: null,
            publicKey: "pk",
            secret: V1_SECRET,
          } as never,
        ],
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: /upgrade encryption/i }),
    );
    await waitFor(() => expect(onUpgradeEncryption).toHaveBeenCalledTimes(1));
  });
});

describe("<ExperimentalCurvesCard>", () => {
  it("shows a static 'Graduated · Always On' status — no toggle button at all", async () => {
    await renderUnder(<ExperimentalCurvesCard />);
    expect(screen.getByText("Graduated · Always On")).toBeTruthy();
    // The old Enable/Disable Experimental Curves button is gone entirely —
    // there is nothing left on this card to click.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not read or write uiSettings.experimentalCurvesEnabled — its display is identical regardless of the flag's value", async () => {
    await renderUnder(<ExperimentalCurvesCard />);
    const before = screen.getByText("Graduated · Always On").textContent;
    await act(async () => {
      await capturedStore!
        .getState()
        .actions.updateUiSettings({ experimentalCurvesEnabled: true });
    });
    // Flipping the (now purely reserved) flag changes nothing on screen.
    expect(screen.getByText("Graduated · Always On").textContent).toBe(before);
  });
});
