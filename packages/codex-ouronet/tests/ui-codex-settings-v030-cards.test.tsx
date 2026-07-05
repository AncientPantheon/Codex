/**
 * v0.3.0 settings cards specs (Phase 15, T15.3):
 * <CodexIdentityCard>, <CodexGuardCard>, <ConsumerSettingsCard>.
 *
 * These three surface the new v0.3.0 codex slices via the Phase-12 hooks
 * (useCodexIdentity / useCodexGuard / useConsumerSettings). The defining
 * requirement: each card GATES GRACEFULLY — a fresh/legacy codex (null
 * identity / no active guard / unknown consumer) renders an empty "claim /
 * migrate to unlock" hint instead of crashing. Phase-14 harness.
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import { useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import {
  CodexIdentityCard,
  CodexGuardCard,
  ConsumerSettingsCard,
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

describe("<CodexIdentityCard>", () => {
  it("renders the empty/claim hint for a fresh codex with no identity (gates instead of crashing)", async () => {
    await renderUnder(<CodexIdentityCard />);
    // A fresh MemoryCodexAdapter has codexIdentity === undefined → null.
    expect(screen.getByText(/no codex identity/i)).toBeTruthy();
    // The formatted address must NOT appear since there is none.
    expect(screen.queryByTestId("identity-formatted")).toBeNull();
  });

  it("shows the formatted identity once the codex has one", async () => {
    await renderUnder(<CodexIdentityCard />);
    await act(async () => {
      capturedStore!.setState({
        codexIdentity: {
          formatted: "₱.STANDARD-x:Π.SMART-y",
          standardPublicKey: "std",
          smartPublicKey: "smt",
          encryptedSeedWords: "esw",
          encryptedStandardBitstring: "esb",
          encryptedSmartBitstring: "esmb",
          encryptedStandardBase10: "e10",
          encryptedSmartBase10: "es10",
          encryptedStandardBase49: "e49",
          encryptedSmartBase49: "es49",
        } as never,
      });
    });
    expect(screen.getByTestId("identity-formatted").textContent).toContain(
      "₱.STANDARD-x:Π.SMART-y",
    );
  });

  it("shows the observational 'fed in' identity when no real identity but a CodexID is configured", async () => {
    await renderUnder(<CodexIdentityCard />);
    await act(async () => {
      capturedStore!.setState({
        ouroAccounts: [
          { id: "std-1", address: "₱.OBSERVED-STANDARD", isSmart: false } as never,
          { id: "smt-1", address: "Π.OBSERVED-SMART", isSmart: true } as never,
        ],
      });
      await capturedStore!.getState().actions.updateUiSettings({
        observationalCodexId: { enabled: true, standardId: "std-1", smartId: "smt-1" },
      } as never);
    });
    const code = screen.getByTestId("identity-formatted");
    expect(code.textContent).toContain("₱.OBSERVED-STANDARD:Π.OBSERVED-SMART");
    expect(screen.getByText(/observational — fed in/i)).toBeTruthy();
  });
});

describe("<CodexGuardCard>", () => {
  it("renders the migrate-to-unlock hint when there is no active CodexGuard", async () => {
    await renderUnder(<CodexGuardCard />);
    // No pure keypairs → no active guard → gated state.
    expect(screen.getByText(/no active codexguard/i)).toBeTruthy();
    expect(screen.queryByTestId("guard-pubkey")).toBeNull();
  });

  it("shows the active guard public key when one exists", async () => {
    await renderUnder(<CodexGuardCard />);
    await act(async () => {
      capturedStore!.setState({
        pureKeypairs: [
          {
            id: "g1",
            label: "CodexGuard",
            publicKey: "ABC123",
            encryptedPrivateKey: "enc",
            createdAt: "t",
            isCodexGuard: true,
          },
        ],
      });
    });
    expect(screen.getByTestId("guard-pubkey").textContent).toContain("ABC123");
  });
});

describe("<ConsumerSettingsCard>", () => {
  it("renders the empty hint when the named consumer has no slot yet", async () => {
    await renderUnder(<ConsumerSettingsCard consumerName="Mnemosyne" />);
    expect(screen.getByText(/no settings/i)).toBeTruthy();
  });

  it("renders the consumer's version + schema once a slot exists", async () => {
    await renderUnder(<ConsumerSettingsCard consumerName="Mnemosyne" />);
    await act(async () => {
      await capturedStore!.getState().actions.updateConsumerSettings({
        consumerName: "Mnemosyne",
        consumerVersion: "1.4.0",
        schemaVersion: 2,
        settings: { theme: "dark" },
        lastUpdatedAt: "ignored-server-stamps",
      });
    });
    expect(screen.getByTestId("consumer-version").textContent).toContain(
      "1.4.0",
    );
    expect(screen.getByTestId("consumer-schema").textContent).toContain("2");
  });
});
