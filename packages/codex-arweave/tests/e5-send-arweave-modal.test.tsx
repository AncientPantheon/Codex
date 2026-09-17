/**
 * <SendArweaveModal> (T7) + `ArweaveAccountsArea`'s per-row "Send" wiring.
 *
 * Each case guards a user-visible regression:
 *   - a fee estimate that never renders (or renders a stale/wrong value)
 *     leaves the user guessing what a send will actually cost, and the
 *     buffered `maxRewardWinston` cap silently derives from garbage.
 *   - a successful submit that doesn't call `sendFrom` with the EXACT
 *     recipient/quantity/cap sends the wrong amount, to the wrong address,
 *     or with an unbounded fee cap — a funds-affecting bug.
 *   - a locked-codex error shown as a generic message leaves the user with
 *     no idea WHY the send failed or what to do next (unlock).
 *   - any other thrown error shown as a generic fallback (instead of its own
 *     message) hides the real, often actionable, failure reason.
 *   - a Send button that opens the WRONG row's modal (or the wrong row's
 *     `entry` on submit) could send funds from a key the user never chose.
 *
 * `@ancientpantheon/codex-ouronet/zbom`'s `txPending` is mocked throughout —
 * its real `.submitted()` kicks off Kadena-specific chain polling (mirrors
 * `ui-stake-urstoa-modal.test.tsx`'s own reasoning: these specs stay
 * hermetic, no real network calls, no dangling timers).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";
import { winstonToAr, arToWinston, InvalidTransactionIdError } from "@ancientpantheon/arweave-core";

import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import { ArweaveAccountsArea } from "../src/panel/ArweaveAccountsArea";
import type { ArweavePanelDeps } from "../src/panel/context";
import type { LibraryEntry, LibraryStore } from "../src/library/types";

type PollFn = (id: string) => Promise<"pending" | "confirmed" | "give-up">;

const txSubmittedMock = vi.fn();
const txFailMock = vi.fn();
const txPendingMock = vi.fn((_title: string, _opts?: { chain?: string; pollFn?: PollFn }) => ({
  start: vi.fn(),
  submitted: txSubmittedMock,
  fail: txFailMock,
  done: vi.fn(),
  dismiss: vi.fn(),
}));
// Defaults to "already unlocked" (true) so every existing test's flow reaches
// sendFrom unchanged; tests specifically about the locked path override this
// per-test via `ensureCodexUnlockedMock.mockResolvedValueOnce(...)`.
const ensureCodexUnlockedMock = vi.fn(async () => true);
vi.mock("@ancientpantheon/codex-ouronet/zbom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    txPending: (title: string, opts?: { chain?: string; pollFn?: PollFn }) => txPendingMock(title, opts),
    useEnsureCodexUnlocked: () => ensureCodexUnlockedMock,
  };
});

// Real `arToWinston`/`winstonToAr`/`InvalidTransactionIdError` (imported
// above) pass through `importOriginal` untouched — only `getTransactionStatus`
// is faked, so the `pollFn` wiring test below drives it with zero real network.
const getTransactionStatusMock = vi.fn();
vi.mock("@ancientpantheon/arweave-core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTransactionStatus: (...args: unknown[]) => getTransactionStatusMock(...args),
  };
});

// Imported AFTER the mock above so the modal picks up the mocked `txPending`.
import { SendArweaveModal } from "../src/panel/SendArweaveModal";

const ADDRESS_A = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const ADDRESS_B = "ADDRESS-B-0000000000000000000000000000000000";
const RECIPIENT = "RECIPIENT-ADDRESS-0000000000000000000000000";

function makeEntry(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: ADDRESS_A,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: "CIPHERTEXT-NOT-A-JWK",
    address: ADDRESS_A,
    ...overrides,
  };
}

function makeLibraryStore(): LibraryStore {
  return {
    append: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    updateStatus: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  } as unknown as LibraryStore;
}

/** The full injected E1-E3 seam bundle — fakes throughout, mirroring
 *  `e4-panel-categories.test.tsx`'s own `makeDeps`. */
function makeDeps(overrides: Partial<ArweavePanelDeps> = {}): ArweavePanelDeps {
  const libraryRows: LibraryEntry[] = [];
  return {
    address: ADDRESS_A,

    foreignKeys: [makeEntry()],
    keygenRunner: { runKeygen: vi.fn(async () => ({} as unknown as ArweaveJwk)) },
    generateArweaveKey: vi.fn(async () => makeEntry()),
    importArweaveKey: vi.fn(async () => makeEntry()),
    decryptArweaveKey: vi.fn(async () => ({} as unknown as ArweaveJwk)),
    addForeignKey: vi.fn(async () => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),

    getBalance: vi.fn(async () => 1_500_000_000_000n),
    send: vi.fn(async () => ({ id: "send-tx", reward: 1_000_000n })),
    sendFrom: vi.fn(async () => ({ id: "sendfrom-tx", reward: 1_000_000n })),
    estimateFee: vi.fn(async () => 100_000_000n),
    pollStatus: vi.fn(async () => "final" as const),

    uploadAndTrack: vi.fn(async () => ({
      id: "uploaded-item",
      itemId: "codex-item-1",
      ownerAddress: ADDRESS_A,
      tags: [],
    })),
    listLibrary: vi.fn(async () => libraryRows),
    openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
    rebuildLibrary: vi.fn(async () => {}),
    libraryStore: makeLibraryStore(),
    pool: {} as unknown as GatewayPool,

    addressBook: [],

    ...overrides,
  };
}

beforeEach(() => {
  txPendingMock.mockClear();
  txSubmittedMock.mockClear();
  txFailMock.mockClear();
  ensureCodexUnlockedMock.mockClear();
  ensureCodexUnlockedMock.mockResolvedValue(true);
  getTransactionStatusMock.mockReset();
});

afterEach(() => cleanup());

describe("<SendArweaveModal>", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <SendArweaveModal entry={makeEntry()} isOpen={false} onClose={() => {}} deps={makeDeps()} />,
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("shows a live network-fee estimate rendered from a mocked deps.estimateFee", async () => {
    const estimateFee = vi.fn(async () => 240_000_000_000n); // 0.24 AR
    render(
      <SendArweaveModal
        entry={makeEntry()}
        isOpen
        onClose={() => {}}
        deps={makeDeps({ estimateFee })}
      />,
    );

    await waitFor(() => expect(estimateFee).toHaveBeenCalledWith(0, ""));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(
        `Network fee: ~${winstonToAr(240_000_000_000n)} AR`,
      ),
    );
  });

  it("re-fetches the fee estimate when the recipient changes", async () => {
    const estimateFee = vi.fn(async () => 100_000_000n);
    render(
      <SendArweaveModal
        entry={makeEntry()}
        isOpen
        onClose={() => {}}
        deps={makeDeps({ estimateFee })}
      />,
    );

    await waitFor(() => expect(estimateFee).toHaveBeenCalledWith(0, ""));
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    await waitFor(() => expect(estimateFee).toHaveBeenCalledWith(0, RECIPIENT));
  });

  it("a successful submit calls deps.sendFrom with the exact recipient/quantity/maxRewardWinston, fires the toast, calls onSuccess, and closes", async () => {
    const sendFrom = vi.fn(async () => ({ id: "confirmed-tx-id", reward: 120_000_000n }));
    const entry = makeEntry();
    const onSuccess = vi.fn();
    let closedCount = 0;
    render(
      <SendArweaveModal
        entry={entry}
        isOpen
        onClose={() => {
          closedCount++;
        }}
        onSuccess={onSuccess}
        deps={makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n) })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
    );

    // "Fee On Top" (exact mode) — pinned explicitly since this test is about
    // the generic submit/toast/onSuccess plumbing, not fee-math semantics,
    // and should stay stable regardless of which mode is the default.
    fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByTestId("arweave-send-submit"));

    await waitFor(() => expect(sendFrom).toHaveBeenCalledTimes(1));
    expect(sendFrom).toHaveBeenCalledWith(entry, {
      target: RECIPIENT,
      quantity: arToWinston("2.5"),
      // 1.2x buffer over the held 100_000_000n quote.
      maxRewardWinston: 120_000_000n,
    });

    // Regression: the toast used to point its "View on Explorer" link (and
    // its `.submitted()` confirmation poll) at StoaChain unconditionally —
    // dead for an Arweave tx id. `chain: "arweave"` is what routes the toast
    // to the ViewBlock explorer / skips the Pact poll (toastManager.ts).
    // `pollFn` (see the dedicated describe block below) is what gives the
    // toast a REAL "Confirmed" signal instead of an immediate optimistic one.
    expect(txPendingMock).toHaveBeenCalledWith(
      "Send Arweave",
      expect.objectContaining({ chain: "arweave", pollFn: expect.any(Function) }),
    );
    expect(txSubmittedMock).toHaveBeenCalledWith("confirmed-tx-id");
    expect(txFailMock).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("confirmed-tx-id");
    expect(closedCount).toBe(1);
  });

  describe("the pollFn passed to txPending — real on-chain confirmation, not an optimistic guess", () => {
    /** Submits once and returns the exact `pollFn` the modal handed to
     *  `txPending` — the thing under test in every case below. */
    async function submitAndCapturePollFn(deps: Partial<ArweavePanelDeps> = {}): Promise<PollFn> {
      const sendFrom = vi.fn(async () => ({ id: "confirmed-tx-id", reward: 120_000_000n }));
      render(
        <SendArweaveModal
          entry={makeEntry()}
          isOpen
          onClose={() => {}}
          deps={makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n), ...deps })}
        />,
      );
      await waitFor(() =>
        expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
      );
      fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));
      fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
      fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });
      fireEvent.click(screen.getByTestId("arweave-send-submit"));
      await waitFor(() => expect(sendFrom).toHaveBeenCalledTimes(1));
      const call = txPendingMock.mock.calls.find(([title]) => title === "Send Arweave");
      const pollFn = call?.[1]?.pollFn;
      if (!pollFn) throw new Error("txPending was not called with a pollFn");
      return pollFn;
    }

    it("queries the REAL gateway pool via getTransactionStatus, and maps a mined tx to 'confirmed'", async () => {
      const fakePool = { fake: "pool" } as unknown as GatewayPool;
      getTransactionStatusMock.mockResolvedValue({ status: "confirmed", blockHeight: 1, blockIndepHash: "h", numberOfConfirmations: 3, final: false });
      const pollFn = await submitAndCapturePollFn({ pool: fakePool });

      const result = await pollFn("some-arweave-tx-id");
      expect(getTransactionStatusMock).toHaveBeenCalledWith(fakePool, "some-arweave-tx-id");
      expect(result).toBe("confirmed");
    });

    it("maps 'pending' and 'not-found' gateway answers to 'pending' (keep polling)", async () => {
      const pollFn = await submitAndCapturePollFn();

      getTransactionStatusMock.mockResolvedValueOnce({ status: "pending" });
      expect(await pollFn("id")).toBe("pending");

      getTransactionStatusMock.mockResolvedValueOnce({ status: "not-found" });
      expect(await pollFn("id")).toBe("pending");
    });

    it("maps InvalidTransactionIdError (e.g. mock mode's fixed placeholder id, which can never become valid) to 'give-up'", async () => {
      getTransactionStatusMock.mockRejectedValue(new InvalidTransactionIdError("mock-send-tx"));
      const pollFn = await submitAndCapturePollFn();

      expect(await pollFn("mock-send-tx")).toBe("give-up");
    });

    it("maps any OTHER thrown error (a transient gateway hiccup) to 'pending' — never gives up on a real send's confirmation over a network blip", async () => {
      getTransactionStatusMock.mockRejectedValue(new Error("network hiccup"));
      const pollFn = await submitAndCapturePollFn();

      expect(await pollFn("some-arweave-tx-id")).toBe("pending");
    });
  });

  it("calls the codex-unlock gate BEFORE sendFrom on every submit — pops the REAL password prompt if locked, instead of erroring out", async () => {
    // WHY: the modal used to just call sendFrom directly and, on a
    // CodexLockedError, dead-end with a static text message telling the user
    // to go find the unlock control themselves. useEnsureCodexUnlocked is the
    // SAME gate every other signing modal in this app already uses — it pops
    // the actual global password prompt and resumes automatically once
    // unlocked, so a locked codex no longer "errors the user out."
    const callOrder: string[] = [];
    ensureCodexUnlockedMock.mockImplementation(async () => {
      callOrder.push("ensureUnlocked");
      return true;
    });
    const sendFrom = vi.fn(async () => {
      callOrder.push("sendFrom");
      return { id: "tx-1", reward: 100_000_000n };
    });
    render(
      <SendArweaveModal
        entry={makeEntry()}
        isOpen
        onClose={() => {}}
        deps={makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n) })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
    );
    fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("arweave-send-submit"));

    await waitFor(() => expect(sendFrom).toHaveBeenCalledTimes(1));
    expect(ensureCodexUnlockedMock).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["ensureUnlocked", "sendFrom"]);
  });

  it("when the user cancels the password prompt, stops quietly — no sendFrom call, no error toast, no alert", async () => {
    ensureCodexUnlockedMock.mockResolvedValueOnce(false);
    const sendFrom = vi.fn();
    render(
      <SendArweaveModal
        entry={makeEntry()}
        isOpen
        onClose={() => {}}
        deps={makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n) })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
    );
    fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("arweave-send-submit"));

    await waitFor(() => expect(ensureCodexUnlockedMock).toHaveBeenCalledTimes(1));
    expect(sendFrom).not.toHaveBeenCalled();
    expect(txFailMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    // The submit button is usable again — cancelling isn't a permanent lockout.
    expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows 'Codex is locked. Unlock your codex to send.' when sendFrom throws a name-based CodexLockedError (duck-typed, not instanceof)", async () => {
    const lockedError = new Error("locked");
    lockedError.name = "CodexLockedError";
    const sendFrom = vi.fn(async () => {
      throw lockedError;
    });
    let closedCount = 0;
    render(
      <SendArweaveModal
        entry={makeEntry()}
        isOpen
        onClose={() => {
          closedCount++;
        }}
        deps={makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n) })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
    );
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("arweave-send-submit"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Codex is locked. Unlock your codex to send."),
    );
    expect(closedCount).toBe(0);
    expect(txFailMock).toHaveBeenCalledWith("Codex is locked. Unlock your codex to send.");
  });

  it("shows the thrown error's own message for any other error — never a generic fallback", async () => {
    const sendFrom = vi.fn(async () => {
      throw new Error("Simulation failed: insufficient AR balance");
    });
    render(
      <SendArweaveModal
        entry={makeEntry()}
        isOpen
        onClose={() => {}}
        deps={makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n) })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
    );
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("arweave-send-submit"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Simulation failed: insufficient AR balance"),
    );
    expect(txFailMock).toHaveBeenCalledWith("Simulation failed: insufficient AR balance");
  });

  describe("two send modes — 'Fee Included' (default) vs 'Fee On Top'", () => {
    // WHY: Arweave has no gas station — the fee always comes out of the SAME
    // balance as the amount being sent, unlike a Kadena send through the
    // Ouronet Gas Station where the full balance is always sendable. Two
    // distinct, explicit modes resolve the ambiguity of "what does the number
    // I type actually mean":
    //   - "Fee Included" (default, owner's primary use case): the typed
    //     amount is the TOTAL debited from the sender's balance; the
    //     recipient receives that minus the fee. Mirrors a Binance-style
    //     withdrawal screen ("You will receive: ~X").
    //   - "Fee On Top": the typed amount is EXACTLY what the recipient
    //     receives; the sender needs additional balance beyond that to cover
    //     the fee. This was the modal's only behavior before this change.
    const BALANCE = 1_000_000_000_000n; // exactly 1.000000000000 AR
    const FEE = 100_000_000n; // 0.0001 AR quoted; buffered cap = 120_000_000n
    const BUFFERED_FEE = (FEE * 12n) / 10n; // 120_000_000n

    it("defaults to 'Fee Included' mode", () => {
      render(<SendArweaveModal entry={makeEntry()} isOpen onClose={() => {}} deps={makeDeps()} />);
      expect(screen.getByTestId("arweave-send-mode-included")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("arweave-send-mode-onTop")).toHaveAttribute("aria-pressed", "false");
    });

    it("switching modes is a single click, both directions", () => {
      render(<SendArweaveModal entry={makeEntry()} isOpen onClose={() => {}} deps={makeDeps()} />);
      fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));
      expect(screen.getByTestId("arweave-send-mode-onTop")).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByTestId("arweave-send-mode-included"));
      expect(screen.getByTestId("arweave-send-mode-included")).toHaveAttribute("aria-pressed", "true");
    });

    describe("'Fee Included' mode (default) — typed amount is the TOTAL debited", () => {
      it("shows the estimated arrival amount (Binance-style): typed amount minus the buffered fee", async () => {
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE) })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
        fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });

        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-receive-estimate")).toHaveTextContent(
            `Recipient receives: ~${winstonToAr(arToWinston("1") - BUFFERED_FEE)} AR`,
          ),
        );
      });

      it("sends the WHOLE typed amount as the total: the full 1 AR balance is submittable (fee comes out of it, no separate headroom needed)", async () => {
        const sendFrom = vi.fn(async () => ({ id: "tx-1", reward: FEE }));
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE), sendFrom })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
        // The FULL 1 AR balance — impossible in "Fee On Top" mode, fine here.
        fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });

        expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByTestId("arweave-send-submit"));

        await waitFor(() => expect(sendFrom).toHaveBeenCalledTimes(1));
        expect(sendFrom).toHaveBeenCalledWith(makeEntry(), {
          target: RECIPIENT,
          quantity: arToWinston("1") - BUFFERED_FEE,
          maxRewardWinston: BUFFERED_FEE,
        });
      });

      it("blocks submit when the typed TOTAL exceeds the balance", async () => {
        const sendFrom = vi.fn();
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE), sendFrom })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
        fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1.5" } });

        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/exceeds your balance/i));
        expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByTestId("arweave-send-submit"));
        expect(sendFrom).not.toHaveBeenCalled();
      });

      it("blocks submit when the typed TOTAL is too small to even cover the fee", async () => {
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE) })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
        // 0.00000001 AR (10_000_000 Winston) — less than the 120_000_000n buffered fee.
        fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "0.00000001" } });

        await waitFor(() =>
          expect(screen.getByRole("alert")).toHaveTextContent(/too small to cover the network fee/i),
        );
        expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(true);
      });

      it("clicking Max fills the amount with the WHOLE balance (the fee is already accounted for by the mode itself)", async () => {
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE) })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });

        fireEvent.click(screen.getByTestId("arweave-send-max"));

        expect((screen.getByTestId("arweave-send-amount") as HTMLInputElement).value).toBe(
          winstonToAr(BALANCE),
        );
        expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(false);
      });
    });

    describe("'Fee On Top' mode — typed amount is EXACTLY what the recipient receives", () => {
      it("blocks submit and shows a clear message when amount + buffered fee exceeds the known balance — never attempts sendFrom", async () => {
        const sendFrom = vi.fn();
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE), sendFrom })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));

        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
        // The full 1 AR balance, leaving NO room for the fee.
        fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });

        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/exceeds your balance/i));
        expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByTestId("arweave-send-submit"));
        expect(sendFrom).not.toHaveBeenCalled();
      });

      it("allows submit when amount + buffered fee fits inside the balance, and sends EXACTLY the typed amount", async () => {
        const sendFrom = vi.fn(async () => ({ id: "tx-1", reward: 100_000_000n }));
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE), sendFrom })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));

        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
        fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "0.5" } });
        expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByTestId("arweave-send-submit"));

        await waitFor(() => expect(sendFrom).toHaveBeenCalledTimes(1));
        expect(sendFrom).toHaveBeenCalledWith(makeEntry(), {
          target: RECIPIENT,
          quantity: arToWinston("0.5"),
          maxRewardWinston: BUFFERED_FEE,
        });
      });

      it("clicking Max fills the amount with balance minus the buffered fee, leaving exactly enough for the fee", async () => {
        render(
          <SendArweaveModal
            entry={makeEntry()}
            isOpen
            onClose={() => {}}
            deps={makeDeps({ estimateFee: vi.fn(async () => FEE) })}
            senderBalanceWinston={BALANCE}
          />,
        );
        await waitFor(() =>
          expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
        );
        fireEvent.click(screen.getByTestId("arweave-send-mode-onTop"));
        fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });

        fireEvent.click(screen.getByTestId("arweave-send-max"));

        const expectedMax = winstonToAr(BALANCE - BUFFERED_FEE);
        expect((screen.getByTestId("arweave-send-amount") as HTMLInputElement).value).toBe(expectedMax);
        expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(false);
      });
    });

    it("disables Max while the balance or fee quote is unknown", () => {
      render(<SendArweaveModal entry={makeEntry()} isOpen onClose={() => {}} deps={makeDeps()} />);
      expect((screen.getByTestId("arweave-send-max") as HTMLButtonElement).disabled).toBe(true);
    });

    it("does not block submit when senderBalanceWinston is simply not provided (unknown balance never silently forces a failure)", async () => {
      const sendFrom = vi.fn(async () => ({ id: "tx-1", reward: 100_000_000n }));
      render(
        <SendArweaveModal
          entry={makeEntry()}
          isOpen
          onClose={() => {}}
          deps={makeDeps({ estimateFee: vi.fn(async () => FEE), sendFrom })}
        />,
      );
      await waitFor(() =>
        expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(FEE)),
      );
      fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
      fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "5" } });
      expect((screen.getByTestId("arweave-send-submit") as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

describe("ArweaveAccountsArea — Send button (T7)", () => {
  it("omits the Send button entirely when deps is not provided (keeps pre-T7 rendering unchanged)", () => {
    const entry = makeEntry();
    render(<ArweaveAccountsArea entries={[entry]} seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]} />);
    expect(screen.queryByTestId(`arweave-account-send-${entry.id}`)).toBeNull();
  });

  it("clicking Send opens SendArweaveModal for the correct row — submit calls sendFrom with THAT row's entry, not a sibling's", async () => {
    const entryA = makeEntry({ id: "a", address: ADDRESS_A });
    const entryB = makeEntry({ id: "b", address: ADDRESS_B });
    const sendFrom = vi.fn(async () => ({ id: "tx-b", reward: 0n }));
    const deps = makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n) });

    render(
      <ArweaveAccountsArea
        entries={[entryA, entryB]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        deps={deps}
      />,
    );

    // Row B's Send button — NOT row A's — is the one clicked.
    fireEvent.click(screen.getByTestId(`arweave-account-send-${entryB.id}`));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The sibling row's own Send button is unaffected — still present, only one dialog open.
    expect(screen.getByTestId(`arweave-account-send-${entryA.id}`)).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
    );
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("arweave-send-submit"));

    await waitFor(() => expect(sendFrom).toHaveBeenCalledTimes(1));
    expect(sendFrom).toHaveBeenCalledWith(entryB, expect.anything());
  });

  it("refreshes exactly that row's balance (T4's per-row trigger) after a successful send", async () => {
    const entryA = makeEntry({ id: "a", address: ADDRESS_A });
    const entryB = makeEntry({ id: "b", address: ADDRESS_B });
    // A real, sufficient balance — this test is about the refresh mechanism,
    // not about the (correct, separately-tested) zero-balance block, and
    // now that the modal is balance-aware a genuine 0n would legitimately
    // block the send before it ever reaches sendFrom.
    const getBalance = vi.fn(async () => 2_000_000_000_000n);
    const sendFrom = vi.fn(async () => ({ id: "tx-b", reward: 0n }));
    const deps = makeDeps({ sendFrom, estimateFee: vi.fn(async () => 100_000_000n) });

    render(
      <ArweaveAccountsArea
        entries={[entryA, entryB]}
        seeds={[{ id: "seed-1", label: "Prime Arweave Seed" }]}
        getBalance={getBalance}
        deps={deps}
      />,
    );

    // The initial on-mount read: one call per row.
    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(2));
    getBalance.mockClear();

    fireEvent.click(screen.getByTestId(`arweave-account-send-${entryB.id}`));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-send-fee")).toHaveTextContent(winstonToAr(100_000_000n)),
    );
    fireEvent.change(screen.getByTestId("arweave-send-recipient"), { target: { value: RECIPIENT } });
    fireEvent.change(screen.getByTestId("arweave-send-amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("arweave-send-submit"));

    await waitFor(() => expect(sendFrom).toHaveBeenCalledTimes(1));
    // Exactly row B's address is re-read — not row A's, and not a bulk re-read.
    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(1));
    expect(getBalance).toHaveBeenCalledWith(ADDRESS_B);
  });
});
