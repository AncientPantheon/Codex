/**
 * T2 of `docs/work/wizard-page2-and-dashboard-fixes/plan.md` —
 * `SeedRevealModal`, the real seed-reveal popup for the Settling
 * Dashboard's sub-row buttons. Reuses `DalosSecretReveal` as-is; real
 * crypto throughout, no mocking.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { SeedRevealModal } from "../src/ui/internal/SeedRevealModal.js";
import type { IStoaChainSeed } from "../src/types/entities.js";

const PASSWORD = "seed-reveal-modal-test-pw";
const WORDS = "river stone ember garden lantern";
const BITS = "1".repeat(1600);
// Two real PBKDF2 derivations (the attempted decrypt's own key derivation,
// plus the earlier successful encrypt) can run past vitest's 5s default —
// same convention as `codex-identity-encryption.test.ts`'s `CRYPTO_TIMEOUT`.
const CRYPTO_TIMEOUT = 60_000;
/** Verbatim `CodexLockedError` text, as the owner actually saw it inside a
 *  modal titled with their account name (`docs/work/wizard-unlock-lifecycle/
 *  design.md`'s "Problem"). It must never reach the DOM again. */
const CODEX_LOCKED_ERROR =
  'Codex is locked; operation "getPassword" requires authentication. '
  + "Call authenticate(password) first.";

const promptInput = () => screen.getByTestId("wizard-unlock-prompt-input") as HTMLInputElement;
const promptSubmit = () => screen.getByTestId("wizard-unlock-prompt-submit") as HTMLButtonElement;

function submitPrompt(password: string): void {
  fireEvent.change(promptInput(), { target: { value: password } });
  fireEvent.click(promptSubmit());
}

function seed(overrides: Partial<IStoaChainSeed> & { id: string }): IStoaChainSeed {
  return {
    name: "Test Seed", seedType: "koala", version: "1.0", index: 0,
    secret: "ct", main: "", createdAt: "2026-01-01T00:00:00.000Z",
    accounts: [], ...overrides,
  };
}

describe("SeedRevealModal", () => {
  it("renders nothing when open is false", () => {
    render(
      <SeedRevealModal
        open={false}
        onClose={() => {}}
        seed={seed({ id: "seed-1" })}
        getPassword={() => PASSWORD}
      />,
    );
    expect(screen.queryByText("Test Seed")).toBeNull();
  });

  // owner (live testing, real-data bug — round 1): "when i click view
  // seed, it cant tell me the seed words, so what the actual fuck?" Root
  // cause (found via investigation): `IStoaChainSeed.secret` decrypts to
  // a valid 1600-bit bitstring ONLY for `seedType: "stoic"` — for every
  // OTHER seed type (koala/chainweaver/eckowallet), `secret` is the
  // encrypted MNEMONIC directly (`CreateStoaChainSeedModal.tsx`'s own
  // non-stoic creation path: `encryptStringV2(mnemonic.trim(), password)`,
  // never run through `seedWordsToBitString`). Feeding that into
  // `DalosSecretReveal originMode="bitString"` is exactly what produced
  // the real "Could not derive bitstring" error.
  //
  // Owner (live testing, round 2 — REGRESSION): "it is shown like this,
  // instead of using the whole seed view we had previously... its good
  // that the seed is recognized, but its a regression that we are not
  // shown the full popup we settled before we'd use." Round 1's fix
  // over-corrected: it replaced the bitstring-mode crash with a bare
  // plain-text box instead of reusing `DalosSecretReveal` with
  // `originMode="seedWords"` — which the component supports precisely
  // for this case (feed it the real WORDS, not a bitstring, and it
  // derives every other tab itself) and which the earlier "stoic +
  // wordsSecret" test below already proves works. A non-stoic seed's
  // `secret` IS the real mnemonic, so it gets the exact same full
  // tabbed reveal, not a stripped-down fallback.
  it("shows the FULL tabbed seed reveal (Seed/Bitmap/BitString/...) for a koala seed's own secret — its secret IS the real mnemonic, so it gets the same popup a stoic seed's wordsSecret gets", async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1", seedType: "koala", secret: encrypted })}
        getPassword={() => PASSWORD}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Seed")).toBeTruthy();
      expect(screen.getByText("5 words")).toBeTruthy();
    });
    // The bitstring/bitmap/base-10/base-49 tabs are also reachable —
    // derived FROM the words, not fed a raw bitstring.
    expect(screen.getByText("BitString")).toBeTruthy();
    // A user whose codex is unlocked with the right password sees no extra
    // step — the unlock prompt T3 added must stay out of the happy path.
    expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
  });

  it("shows the decrypted bitstring view for a STOIC seed's own secret", async () => {
    const encrypted = await encryptStringV2(BITS, PASSWORD);
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1", seedType: "stoic", secret: encrypted })}
        getPassword={() => PASSWORD}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("BitString")).toBeTruthy();
    });
    // No "Seed" (words) tab for a bitstring-only reveal.
    expect(screen.queryByText("Seed")).toBeNull();
  });

  it("shows the real WORDS view for a stoic seed whose wordsSecret decrypts successfully", async () => {
    const encryptedBits = await encryptStringV2(BITS, PASSWORD);
    const encryptedWords = await encryptStringV2(WORDS, PASSWORD);
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({
          id: "seed-1", seedType: "stoic",
          secret: encryptedBits, wordsSecret: encryptedWords,
        })}
        getPassword={() => PASSWORD}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Seed")).toBeTruthy();
      expect(screen.getByText("5 words")).toBeTruthy();
    });
  });

  // T3 of `docs/work/wizard-unlock-lifecycle/plan.md` REPLACED this test's
  // old expectation (a plain error line reading "the codex is locked"). A
  // locked codex is recoverable — the user has the password — so the modal
  // now asks for it where they stand instead of dead-ending. The part that
  // must never regress is that `DalosSecretReveal` stays unmounted until
  // something actually decrypted.
  it("prompts for the password inline, never DalosSecretReveal, when getPassword throws (locked)", async () => {
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1" })}
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

  // The owner's actual report: the raw store error, surfaced verbatim inside
  // a modal titled with their account name. A `CodexLockedError`'s text is
  // an internal API instruction ("Call authenticate(password) first") — it
  // tells a user nothing they can act on, and its presence anywhere in the
  // DOM means a password failure escaped the prompt path.
  it("never renders the raw `Codex is locked; operation \"getPassword\"` store error in the modal", async () => {
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1" })}
        getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain('Codex is locked; operation "getPassword"');
    expect(document.body.textContent).not.toContain("authenticate(password)");
  });

  it("reveals the seed in place after a correct password is submitted in the prompt — the modal is never closed or reopened", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    const onClose = vi.fn();
    render(
      <SeedRevealModal
        open
        onClose={onClose}
        seed={seed({ id: "seed-1", seedType: "koala", secret: encrypted })}
        getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });

    submitPrompt(PASSWORD);

    await waitFor(() => {
      expect(screen.getByText("5 words")).toBeTruthy();
    });
    // The prompt yields to the reveal, and the reveal happens in the SAME
    // open modal — no close-and-reopen round trip for the user.
    expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
    expect(screen.getByTestId("legacy-prime-migration-seed-reveal-modal")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the prompt open with an error, and reveals nothing, when a wrong password is submitted", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1", seedType: "koala", secret: encrypted })}
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
    // Still recoverable: the prompt stays, and nothing was revealed.
    expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    expect(screen.queryByText("5 words")).toBeNull();
  });

  // A seed that decrypted fine must never be interrupted by a password
  // prompt. `wordsSecret` is encrypted separately and CAN be corrupt or
  // foreign while `secret` is perfectly readable — the password is provably
  // right in that case (it just decrypted `secret`), so classifying this as
  // "wrong password" would pop a prompt over a working reveal.
  it("keeps the existing bitstring-only fallback — and shows NO password prompt — for a stoic seed whose wordsSecret cannot be recovered", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encryptedBits = await encryptStringV2(BITS, PASSWORD);
    const foreignWords = await encryptStringV2(WORDS, "some-older-password");
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({
          id: "seed-1", seedType: "stoic",
          secret: encryptedBits, wordsSecret: foreignWords,
        })}
        getPassword={() => PASSWORD}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("BitString")).toBeTruthy();
    });
    expect(screen.queryByTestId("wizard-unlock-prompt")).toBeNull();
    expect(screen.queryByText("Seed")).toBeNull();
  });

  // owner (live testing, this round): a user saw a Settling Dashboard card
  // titled "Prime Codex Seed" (computeSeedDashboardCards's own label for a
  // seed that is isPrime/legacy-"Initial Seed" but doesn't back the chosen
  // account), clicked its "View seed" button, and got a popup titled
  // "Initial Seed" instead — the raw stored name, not the SAME label the
  // card used. The title must match computeSeedDashboardCards's own
  // non-account-match naming logic (seedDisplayNameFallback), not the raw
  // seed.name.
  it("titles the popup \"Prime Codex Seed\" for a legacy-prime seed, matching computeSeedDashboardCards's own label — not the raw stored name", () => {
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1", name: "Initial Seed", isPrime: true })}
        getPassword={() => PASSWORD}
      />,
    );
    expect(screen.getByText("Prime Codex Seed")).toBeTruthy();
    expect(screen.queryByText("Initial Seed")).toBeNull();
  });

  it("titles the popup with the seed's own real name for an ordinary, non-prime seed", () => {
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1", name: "My Koala Seed" })}
        getPassword={() => PASSWORD}
      />,
    );
    expect(screen.getByText("My Koala Seed")).toBeTruthy();
  });

  // owner (live testing, an earlier round): the decrypt-failure catch block
  // surfaced the RAW crypto-library error verbatim (e.g. an AES-GCM
  // auth-tag failure message) — alarming and uninformative to a real user.
  // T3 (`docs/work/wizard-unlock-lifecycle/`) goes one step further: this
  // case is the "wrong password" half of the two password failures, and a
  // wrong password is recoverable, so the honest-but-terminal message is
  // replaced by the prompt that lets the user fix it. The raw crypto text
  // must still never appear.
  it("prompts for the password — never the raw crypto error — when the password the codex currently holds cannot decrypt the seed", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    render(
      <SeedRevealModal
        open
        onClose={() => {}}
        seed={seed({ id: "seed-1", secret: encrypted })}
        getPassword={() => "a-completely-different-password"}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    // Says WHICH of the two situations this is — a password was available,
    // it just didn't work — rather than claiming the codex is locked.
    expect(screen.getByTestId("wizard-unlock-prompt").textContent).toMatch(/could not decrypt/i);
    expect(document.body.textContent).not.toMatch(/auth.?tag|AES/i);
    // And it is recoverable from right here.
    submitPrompt(PASSWORD);
    await waitFor(() => {
      expect(screen.getByText("5 words")).toBeTruthy();
    });
  });
});

/**
 * The unlock window is ABSOLUTE, not sliding (`src/zbom/hooks/
 * useEnsureCodexUnlocked.ts` documents the prior bug where an
 * unconditional `authenticate()` reset the TTL on every operation, making
 * the visible "re-authenticate in X" countdown a lie). These two tests pin
 * both directions for this modal's own prompt.
 */
describe("SeedRevealModal — absolute (non-sliding) unlock window", () => {
  let capturedStore: ReturnType<typeof useCodexStore> | null = null;
  function StoreGrabber(): null {
    capturedStore = useCodexStore();
    return null;
  }

  it("does NOT reset the countdown when the codex was already unlocked — the held password simply didn't decrypt this seed", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    const heldPassword = "a-stale-but-cached-password";
    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <StoreGrabber />
        <SeedRevealModal
          open
          onClose={() => {}}
          seed={seed({ id: "seed-1", secret: encrypted })}
          getPassword={() => heldPassword}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    // Unlocked — just not with the password this seed was encrypted under.
    act(() => {
      capturedStore!.getState().actions.authenticate(heldPassword, 60);
    });
    const deadline = capturedStore!.getState().passwordCache!.expiresAt;

    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    submitPrompt(PASSWORD);
    await waitFor(() => {
      expect(screen.getByText("5 words")).toBeTruthy();
    });

    // The reveal succeeded WITHOUT touching the window: this codex was
    // never locked, so nothing here may start or extend its countdown.
    expect(capturedStore!.getState().passwordCache!.expiresAt).toBe(deadline);
    expect(capturedStore!.getState().passwordCache!.value).toBe(heldPassword);
  });

  it("starts the window exactly once when the codex really was locked", { timeout: CRYPTO_TIMEOUT }, async () => {
    const encrypted = await encryptStringV2(WORDS, PASSWORD);
    capturedStore = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <StoreGrabber />
        <SeedRevealModal
          open
          onClose={() => {}}
          seed={seed({ id: "seed-1", secret: encrypted })}
          getPassword={() => { throw new Error(CODEX_LOCKED_ERROR); }}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(capturedStore!.getState().ready).toBe(true));
    // Never authenticated — genuinely locked.
    expect(capturedStore!.getState().passwordCache).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId("wizard-unlock-prompt")).toBeTruthy();
    });
    submitPrompt(PASSWORD);
    await waitFor(() => {
      expect(screen.getByText("5 words")).toBeTruthy();
    });

    // A FRESH password entry legitimately starts a window — that is the one
    // case `authenticate()` is allowed, and the user shouldn't have to
    // re-enter it for the next operation.
    const cache = capturedStore!.getState().passwordCache;
    expect(cache).not.toBeNull();
    expect(cache!.value).toBe(PASSWORD);
    expect(cache!.expiresAt).toBeGreaterThan(Date.now());
  });
});
