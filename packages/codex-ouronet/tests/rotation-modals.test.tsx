/**
 * Rotation modal tests — Phase 6b headless RotateGuard / RotatePaymentKey
 * / RotateSovereign modals.
 *
 * Strategy: assert render correctness (isOpen gating, default markup,
 * render-prop overrides), form state, and validation gating. The actual
 * submit-side wiring (build closure → execute → chain) is verified
 * implicitly:
 *   - cfm-builders.test.ts asserts the pact-code string each builder emits
 *   - useSignTransaction tests verify the strategy construction
 *   - Phase 9 OuronetUI migration is the end-to-end signal
 *
 * Asserting submit-path here would require either mocking
 * useSignTransaction (brittle), mocking the underlying PactClient
 * (substantial surface), or running real chain tx (not appropriate in
 * unit tests). The narrow scope here matches the rest of the package's
 * test strategy: unit-test each layer, integrate at migration time.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import {
  RotateGuardModal,
  RotatePaymentKeyModal,
  RotateSovereignModal,
} from "@ancientpantheon/codex-ouronet/components";
import { useOuroAccounts, useCodex } from "@ancientpantheon/codex-ouronet/hooks";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

// --------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------

const smartAccountFx: IOuroAccount = {
  id: "smart-1",
  name: "Smart Test",
  version: "1.0.0",
  isSmart: true,
  address: "Σ.SMART-TEST",
  guard: { pred: "keys-all", keys: ["a".repeat(64)] },
  stoaChainLedger: null,
  publicKey: "a".repeat(64),
  secret: "s",
  backup: "b",
};

const standardAccountFx: IOuroAccount = {
  id: "std-1",
  name: "Standard Test",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ.STD-TEST",
  guard: { pred: "keys-all", keys: ["b".repeat(64)] },
  stoaChainLedger: null,
  publicKey: "b".repeat(64),
  secret: "s",
  backup: "b",
};

/** Adds an account to the store ONCE the provider's init effect has
 *  resolved (otherwise addAccount races init and throws "no adapter
 *  wired"). Returns the current count for tests to waitFor on. */
function AccountSeeder({ account }: { account: IOuroAccount }) {
  const { addAccount, accounts } = useOuroAccounts();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady && accounts.length === 0) void addAccount(account);
  }, [isReady, addAccount, accounts.length, account]);
  return <span data-testid="accounts-count">{accounts.length}</span>;
}

// --------------------------------------------------------------------
// RotateSovereignModal
// --------------------------------------------------------------------

describe("<RotateSovereignModal>", () => {
  it("renders nothing when isOpen=false", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={smartAccountFx} />
        <RotateSovereignModal isOpen={false} onClose={() => {}} />
      </CodexProvider>
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders default markup when isOpen=true with a smart account", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={smartAccountFx} />
        <RotateSovereignModal isOpen onClose={() => {}} />
      </CodexProvider>
    );
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(screen.getByRole("heading", { name: /rotate sovereign/i })).toBeTruthy();
    expect(
      screen.getByLabelText(/new sovereign account address/i)
    ).toBeTruthy();
  });

  it("warns + disables submit when account is not smart", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotateSovereignModal isOpen onClose={() => {}} />
      </CodexProvider>
    );
    await waitFor(() => screen.getByRole("dialog"));
    expect(screen.getByRole("alert").textContent).toMatch(
      /smart-account-only/i
    );
    const input = screen.getByLabelText(/new sovereign/i);
    fireEvent.change(input, { target: { value: "Ѻ.NEW-SOV" } });
    const button = screen.getByRole("button", { name: /rotate sovereign/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("render-prop override replaces the default markup", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={smartAccountFx} />
        <RotateSovereignModal
          isOpen
          onClose={() => {}}
          render={({ newSovereign, onNewSovereignChange, canSubmit }) => (
            <div data-testid="custom-sovereign">
              <input
                data-testid="custom-input"
                value={newSovereign}
                onChange={(e) => onNewSovereignChange(e.target.value)}
              />
              <span data-testid="can-submit">{String(canSubmit)}</span>
            </div>
          )}
        />
      </CodexProvider>
    );
    expect(await screen.findByTestId("custom-sovereign")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancel button calls onClose", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    let closeCount = 0;
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={smartAccountFx} />
        <RotateSovereignModal
          isOpen
          onClose={() => {
            closeCount++;
          }}
        />
      </CodexProvider>
    );
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(closeCount).toBe(1);
  });
});

// --------------------------------------------------------------------
// RotatePaymentKeyModal
// --------------------------------------------------------------------

describe("<RotatePaymentKeyModal>", () => {
  it("renders nothing when isOpen=false", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotatePaymentKeyModal isOpen={false} onClose={() => {}} />
      </CodexProvider>
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("validates input length + format", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotatePaymentKeyModal isOpen onClose={() => {}} />
      </CodexProvider>
    );
    await waitFor(() => screen.getByRole("dialog"));
    const input = screen.getByLabelText(/new payment key/i);
    const button = screen.getByRole("button", { name: /rotate payment key/i });

    // Initially disabled (no input).
    expect((button as HTMLButtonElement).disabled).toBe(true);

    // Wrong length.
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.getByRole("alert").textContent).toMatch(
      /64 hex characters/i
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);

    // Valid 64-hex.
    fireEvent.change(input, { target: { value: "a".repeat(64) } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("render-prop receives validation state", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    type Args = {
      validationMessage: string | null;
      canSubmit: boolean;
      onNewPaymentKeyChange: (s: string) => void;
    };
    const captured: { args: Args | null } = { args: null };
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotatePaymentKeyModal
          isOpen
          onClose={() => {}}
          render={(args) => {
            captured.args = args as unknown as Args;
            return <input data-testid="custom-input" />;
          }}
        />
      </CodexProvider>
    );
    await waitFor(() => expect(captured.args).toBeTruthy());
    expect(captured.args?.validationMessage).toBeNull();
    expect(captured.args?.canSubmit).toBe(false);

    await act(async () => {
      captured.args?.onNewPaymentKeyChange("not-hex-short");
    });
    expect(captured.args?.validationMessage).toMatch(/64 hex/i);
  });
});

// --------------------------------------------------------------------
// RotateGuardModal
// --------------------------------------------------------------------

describe("<RotateGuardModal>", () => {
  it("renders nothing when isOpen=false", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotateGuardModal isOpen={false} onClose={() => {}} />
      </CodexProvider>
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("default mode is 'define'; switching to 'existing' shows the keyset-ref input", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotateGuardModal isOpen onClose={() => {}} />
      </CodexProvider>
    );
    await waitFor(() => screen.getByRole("dialog"));
    // Define mode renders new-keys + predicate. Use exact text matchers
    // because "Define new keys" (the radio label) also contains "new keys".
    expect(
      screen.getByLabelText(/^new keys/i)
    ).toBeTruthy();
    expect(screen.getByLabelText(/^predicate$/i)).toBeTruthy();
    expect(screen.queryByLabelText(/keyset reference/i)).toBeNull();

    fireEvent.click(screen.getByLabelText(/use existing keyset-ref/i));
    await waitFor(() => {
      expect(screen.getByLabelText(/keyset reference/i)).toBeTruthy();
    });
    // After switching, the new-keys input is gone (the "Define new keys"
    // radio label still exists — assert the input itself, not the radio).
    expect(screen.queryByLabelText(/^new keys/i)).toBeNull();
  });

  it("submit disabled until define-mode has at least 1 valid key", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotateGuardModal isOpen onClose={() => {}} />
      </CodexProvider>
    );
    await waitFor(() => screen.getByRole("dialog"));
    // Multiple buttons match /rotate guard/i (the H2 heading isn't a
    // button but submit + h2 both contain the phrase). Target the submit
    // explicitly by its disabled state initially.
    const buttons = screen.getAllByRole("button", { name: /rotate guard/i });
    const submitButton = buttons.find(
      (b) => (b as HTMLButtonElement).type === "submit"
    ) as HTMLButtonElement | undefined;
    expect(submitButton).toBeTruthy();
    expect(submitButton!.disabled).toBe(true);

    const keysInput = screen.getByLabelText(/^new keys/i);
    fireEvent.change(keysInput, { target: { value: "a".repeat(64) } });
    await waitFor(() => {
      expect(submitButton!.disabled).toBe(false);
    });
  });

  it("submit disabled in existing mode until keyset-ref is filled", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotateGuardModal isOpen onClose={() => {}} />
      </CodexProvider>
    );
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByLabelText(/use existing keyset-ref/i));
    const button = screen.getByRole("button", { name: /rotate guard/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const refInput = screen.getByLabelText(/keyset reference/i);
    fireEvent.change(refInput, { target: { value: "ouronet-ns.test-keyset" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("render-prop override replaces the default markup", async () => {
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <AccountSeeder account={standardAccountFx} />
        <RotateGuardModal
          isOpen
          onClose={() => {}}
          render={({ mode, onModeChange }) => (
            <div data-testid="custom-guard">
              <span data-testid="current-mode">{mode}</span>
              <button onClick={() => onModeChange("existing")}>
                Custom switch
              </button>
            </div>
          )}
        />
      </CodexProvider>
    );
    expect(await screen.findByTestId("custom-guard")).toBeTruthy();
    expect(screen.getByTestId("current-mode").textContent).toBe("define");
    fireEvent.click(screen.getByRole("button", { name: /custom switch/i }));
    await waitFor(() => {
      expect(screen.getByTestId("current-mode").textContent).toBe(
        "existing"
      );
    });
  });
});
