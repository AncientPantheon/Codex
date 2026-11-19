/**
 * `AccountSeedRevealModal` — the Settling Dashboard's "account has no
 * matching Chainweb seed on record" fallback card's own reveal modal
 * (`docs/work/wizard-page2-and-dashboard-fixes/design.md`, round 3).
 * Owner (live testing, this round): "Selecting AncientHolder, and then
 * clicking reveal seed, still doesn't show its Ouronet Seed, which is
 * what it should happen." Real crypto throughout, no mocking.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { AccountSeedRevealModal } from "../src/ui/internal/AccountSeedRevealModal.js";
import type { IOuroAccount } from "../src/types/entities.js";

const PASSWORD = "account-seed-reveal-modal-test-pw";
const WORDS = "totally distinct seed words right here now and more";
// Real PBKDF2-600k derivations (encrypt + one or more decrypt attempts) run
// past vitest's 5s default — same convention as the sibling
// `ui-seed-reveal-modal.test.tsx`.
const CRYPTO_TIMEOUT = 60_000;
/** Verbatim `CodexLockedError` text, exactly as the owner saw it inside a
 *  modal titled with their account name (`docs/work/wizard-unlock-lifecycle/
 *  design.md`'s "Problem"). */
const CODEX_LOCKED_ERROR =
  'Codex is locked; operation "getPassword" requires authentication. '
  + "Call authenticate(password) first.";

const promptInput = () => screen.getByTestId("wizard-unlock-prompt-input") as HTMLInputElement;
const promptSubmit = () => screen.getByTestId("wizard-unlock-prompt-submit") as HTMLButtonElement;

function submitPrompt(password: string): void {
  fireEvent.change(promptInput(), { target: { value: password } });
  fireEvent.click(promptSubmit());
}

function account(overrides: Partial<IOuroAccount> & { id: string; secret: string }): IOuroAccount {
  return {
    name: "AncientHodler", version: "1.0", isSmart: false, address: "Ѻ.hodler-address",
    guard: null, stoaChainLedger: null, publicKey: "pub", backup: "ct",
    ...overrides,
  };
}

describe("AccountSeedRevealModal", () => {
  it("renders nothing when open is false", () => {
    render(
      <AccountSeedRevealModal
        open={false}
        onClose={() => {}}
        account={account({ id: "hodler", secret: "ct" })}
        getPassword={() => PASSWORD}
      />,
    );
    expect(screen.queryByText("AncientHodler")).toBeNull();
  });

  // The whole point of this component: an `IOuroAccount`'s own `secret`
  // is ALWAYS independently revealable, regardless of whether any
  // `IStoaChainSeed` entity elsewhere in the codex shares its words —
  // default `originMode` (undefined, the common legacy-account shape)
  // is treated as `"seedWords"`, same as `ViewSeedModal.tsx`'s own
  // established fallback.
  it("shows the FULL tabbed seed reveal for an account's own secret, defaulting originMode to seedWords when unset", async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    render(
      <AccountSeedRevealModal
        open
        onClose={() => {}}
        account={account({ id: "hodler", secret: encrypted })}
        getPassword={() => PASSWORD}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Seed")).toBeTruthy();
      expect(screen.getByText("9 words")).toBeTruthy();
    });
    expect(screen.getByText("BitString")).toBeTruthy();
    // A user whose codex is unlocked with the right password sees no extra
    // step — the unlock prompt T3 added stays out of the happy path.
    expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
  });

  it("shows the modal's title as the account's own name", async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    render(
      <AccountSeedRevealModal
        open
        onClose={() => {}}
        account={account({ id: "hodler", secret: encrypted, name: "AncientHodler" })}
        getPassword={() => PASSWORD}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("AncientHodler")).toBeTruthy();
    });
  });

  // T3 of `docs/work/wizard-unlock-lifecycle/plan.md` REPLACED this test's
  // old expectation (a plain error line reading "the codex is locked"): a
  // locked codex is recoverable, so the modal asks for the password where
  // the user stands. What must not regress is that `DalosSecretReveal`
  // stays unmounted until something actually decrypted.
  it("prompts for the password inline, never DalosSecretReveal, when getPassword throws (locked)", async () => {
    render(
      <AccountSeedRevealModal
        open
        onClose={() => {}}
        account={account({ id: "hodler", secret: "ct" })}
        getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    // And it names the right situation: locked, not "the password we hold
    // doesn't work" — the two cases call for different user reactions.
    expect(screen.getByTestId("wizard-unlock-prompt").textContent).toMatch(
      /your codex is locked/i,
    );
    expect(screen.queryByText("BitString")).toBeNull();
  });

  // The owner's actual report: this exact internal API instruction ("Call
  // authenticate(password) first") rendered verbatim inside a modal titled
  // with their account name. Its presence anywhere in the DOM means a
  // password failure escaped the prompt path.
  it("never renders the raw `Codex is locked; operation \"getPassword\"` store error in the modal", async () => {
    render(
      <AccountSeedRevealModal
        open
        onClose={() => {}}
        account={account({ id: "hodler", secret: "ct", name: "AncientHodler" })}
        getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain('Codex is locked; operation "getPassword"');
    expect(document.body.textContent).not.toContain("authenticate(password)");
  });

  it("reveals the account's own words in place after a correct password is submitted — the modal is never closed or reopened", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    const onClose = vi.fn();
    render(
      <AccountSeedRevealModal
        open
        onClose={onClose}
        account={account({ id: "hodler", secret: encrypted })}
        getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });

    submitPrompt(PASSWORD);

    await waitFor(() => {
      expect(screen.getByText("9 words")).toBeTruthy();
    });
    expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
    expect(screen.getByTestId("legacy-prime-migration-account-seed-reveal-modal")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the prompt open with an error, and reveals nothing, when a wrong password is submitted", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    render(
      <AccountSeedRevealModal
        open
        onClose={() => {}}
        account={account({ id: "hodler", secret: encrypted })}
        getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });

    submitPrompt("not-the-password");

    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt-error").textContent).toMatch(
        /incorrect password/i,
      );
    });
    expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    expect(screen.queryByText("9 words")).toBeNull();
  });

  // The second of the two password failures: a password WAS available
  // (`getPassword()` returned without throwing — the codex isn't locked),
  // it just doesn't decrypt this account. Previously terminal: the modal
  // showed the raw `smartDecrypt` error and the user's only move was to
  // close it.
  it("prompts for the password — never the raw crypto error — when the password the codex currently holds cannot decrypt the account", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    render(
      <AccountSeedRevealModal
        open
        onClose={() => {}}
        account={account({ id: "hodler", secret: encrypted })}
        getPassword={() => "a-completely-different-password"}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    // Says WHICH situation this is, rather than claiming the codex is locked.
    expect(screen.getByTestId("wizard-unlock-prompt").textContent).toMatch(/could not decrypt/i);
    expect(document.body.textContent).not.toMatch(/auth.?tag|AES/i);

    submitPrompt(PASSWORD);
    await waitFor(() => {
      expect(screen.getByText("9 words")).toBeTruthy();
    });
  });
});

/**
 * The unlock window is ABSOLUTE, not sliding (`src/zbom/hooks/
 * useEnsureCodexUnlocked.ts` documents the prior bug where an
 * unconditional `authenticate()` reset the TTL on every operation and made
 * the visible "re-authenticate in X" countdown a lie).
 */
describe("AccountSeedRevealModal — absolute (non-sliding) unlock window", () => {
  let capturedStore: ReturnType<typeof useCodexStore> | null = null;
  function StoreGrabber(): null {
    capturedStore = useCodexStore();
    return null;
  }

  it("does NOT reset the countdown when the codex was already unlocked — the held password simply didn't decrypt this account", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    const heldPassword = "a-stale-but-cached-password";
    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <StoreGrabber />
        <AccountSeedRevealModal
          open
          onClose={() => {}}
          account={account({ id: "hodler", secret: encrypted })}
          getPassword={() => heldPassword}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    act(() => {
      capturedStore!.getState().actions.authenticate(heldPassword, 60);
    });
    const deadline = capturedStore!.getState().passwordCache!.expiresAt;

    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    submitPrompt(PASSWORD);
    await waitFor(() => {
      expect(screen.getByText("9 words")).toBeTruthy();
    });

    expect(capturedStore!.getState().passwordCache!.expiresAt).toBe(deadline);
    expect(capturedStore!.getState().passwordCache!.value).toBe(heldPassword);
  });

  it("starts the window exactly once when the codex really was locked", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <StoreGrabber />
        <AccountSeedRevealModal
          open
          onClose={() => {}}
          account={account({ id: "hodler", secret: encrypted })}
          getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    expect(capturedStore!.getState().passwordCache).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    submitPrompt(PASSWORD);
    await waitFor(() => {
      expect(screen.getByText("9 words")).toBeTruthy();
    });

    const cache = capturedStore!.getState().passwordCache;
    expect(cache).not.toBeNull();
    expect(cache!.value).toBe(PASSWORD);
    expect(cache!.expiresAt).toBeGreaterThan(Date.now());
  });
});
