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
import { winstonToAr, arToWinston } from "@ancientpantheon/arweave-core";

import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import { ArweaveAccountsArea } from "../src/panel/ArweaveAccountsArea";
import type { ArweavePanelDeps } from "../src/panel/context";
import type { LibraryEntry, LibraryStore } from "../src/library/types";

const txSubmittedMock = vi.fn();
const txFailMock = vi.fn();
const txPendingMock = vi.fn((_title: string) => ({
  start: vi.fn(),
  submitted: txSubmittedMock,
  fail: txFailMock,
  done: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@ancientpantheon/codex-ouronet/zbom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, txPending: (title: string) => txPendingMock(title) };
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

    expect(txPendingMock).toHaveBeenCalledWith("Send Arweave");
    expect(txSubmittedMock).toHaveBeenCalledWith("confirmed-tx-id");
    expect(txFailMock).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("confirmed-tx-id");
    expect(closedCount).toBe(1);
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
    const getBalance = vi.fn(async () => 0n);
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
