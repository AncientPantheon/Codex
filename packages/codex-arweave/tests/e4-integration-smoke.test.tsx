/**
 * E4 FULL-PHASE INTEGRATION SMOKE (E-09/E-10/E-11/E-12, N-05/N-08 — TERMINAL).
 *
 * Proves Phase 14 composes END-TO-END: the REAL `ArweavePanel` (codex-arweave)
 * drops into codex-ui's chain-generic `ForeignChainsTab` as
 * `foreignChainPanels[ARWEAVE_CHAIN_ID]`, alongside a STUB second adapter, and the
 * 5 areas + the funds/secret-critical flows all work against FAKES — no real
 * network, worker, upload, or funded key.
 *
 * Everything is wired from the executed E1-E3 + D3 + D5 surface exactly as the E5
 * consumer will: a `createForeignChainRegistry()` instance holds the real Arweave
 * adapter + a stub, `registry.list()` feeds the tab's `foreignChains`, and the
 * ArweavePanel obtains its E1-E3 seams from an `ArweavePanelProvider` (injected
 * fakes). The tab layer is id-blind (N-05) — it sees only ids + the slot map.
 *
 * The rows mirror the T14.13 acceptance matrix:
 *   (a) both the Arweave + stub subtabs show (the N-05 gate, real panel);
 *   (b) selecting Arweave renders the 5 areas;
 *   (c) the FULL fee-cap error matrix — over-cap block (no pay) AND a non-cap
 *       rejection that re-enables send with no confirmed status (FIX-1);
 *   (d) a permanence-gated upload → a pending Library entry (no phantom);
 *   (e) an off-thread keygen (fake runner) → key added, JWK never in state/DOM (FIX-5);
 *   (f) a book-recipient pick offers + fills the Arweave contact (E-11).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import * as React from "react";

import {
  arToWinston,
  RewardExceedsCapError,
  GatewayPoolExhaustedError,
  type ArweaveJwk,
  type GatewayPool,
} from "@ancientpantheon/arweave-core";
import { createForeignChainRegistry } from "@ancientpantheon/codex-core";
import type { ForeignChainAdapter, ForeignKeyEntry } from "@ancientpantheon/codex-core";
import {
  registerChainAddressValidator,
  validateAddress,
} from "@ancientpantheon/codex-ouronet/hooks";
import { CodexProvider } from "@ancientpantheon/codex-ui";
import { ForeignChainsTab, type PanelProps } from "@ancientpantheon/codex-ui/ui/foreign-chains";

import { ArweavePanel } from "../src/panel/ArweavePanel";
import {
  ArweavePanelProvider,
  type ArweavePanelDeps,
} from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import { createArweaveAdapter } from "../src/adapter";
import type { LibraryEntry, LibraryStore } from "../src/library/types";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

// ── constants ─────────────────────────────────────────────────────────────

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const KADENA_CHAIN_ID = "kadena:mainnet";
const STUB_CHAIN_ID = "stub-chain";
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;

// ── a stub second adapter + its trivial panel (the N-05 gate) ───────────────

const stubAdapter: ForeignChainAdapter = {
  id: STUB_CHAIN_ID,
  generateKey: async () => {
    throw new Error("stub adapter has no driver behaviour");
  },
  importKey: async () => {
    throw new Error("stub adapter has no driver behaviour");
  },
  addressOf: () => {
    throw new Error("stub adapter has no addressOf");
  },
  getBalance: async () => {
    throw new Error("stub adapter has no getBalance");
  },
  buildSend: async () => {
    throw new Error("stub adapter has no buildSend");
  },
  sign: async () => {
    throw new Error("stub adapter has no sign");
  },
  post: async () => {
    throw new Error("stub adapter has no post");
  },
};

function StubPanel({ id }: PanelProps): React.ReactElement {
  return <div data-testid="stub-panel">{`stub-panel:${id}`}</div>;
}

// ── fake E1-E3 seams the ArweavePanel context injects ───────────────────────

const fakePool = { pick: () => ARWEAVE_ADDRESS } as unknown as GatewayPool;

function makeEntry(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: ARWEAVE_ADDRESS,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: "CIPHERTEXT-NOT-A-JWK",
    label: "My Arweave key",
    ...overrides,
  };
}

/** An in-memory Library store fake — the smoke reads back the pending upload. */
function makeLibraryStore(seed: LibraryEntry[] = []): LibraryStore {
  const rows = new Map<string, LibraryEntry>(seed.map((e) => [e.id, e]));
  return {
    append: vi.fn(async (entry: LibraryEntry) => {
      rows.set(entry.id, entry);
    }),
    get: vi.fn(async (id: string) => rows.get(id)),
    updateStatus: vi.fn(async () => {}),
    list: vi.fn(async () =>
      [...rows.values()].sort((a, b) => b.createdAt - a.createdAt),
    ),
  } as unknown as LibraryStore;
}

/** The full injected-seam bundle, with per-row overrides. Fakes throughout. */
function makeDeps(overrides: Partial<ArweavePanelDeps> = {}): ArweavePanelDeps {
  const store = makeLibraryStore();
  const libraryRows: LibraryEntry[] = [];
  return {
    address: ARWEAVE_ADDRESS,

    // keyring (E1)
    foreignKeys: [makeEntry()],
    keygenRunner: {
      runKeygen: vi.fn(async (onProgress) => {
        onProgress({ state: "working" });
        onProgress({ state: "done" });
        return fixtureJwk;
      }),
    },
    generateArweaveKey: vi.fn(async () => makeEntry({ id: "new-key-id", label: "Fresh key" })),
    importArweaveKey: vi.fn(async () => makeEntry()),
    decryptArweaveKey: vi.fn(async () => fixtureJwk),
    addForeignKey: vi.fn(async () => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),

    // balance / send (E2)
    getBalance: vi.fn(async () => 1_500_000_000_000n),
    send: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 1_000_000n })),
    pollStatus: vi.fn(async () => "final" as const),

    // upload / library (E3)
    uploadAndTrack: vi.fn(async () => {
      const entry: LibraryEntry = {
        id: "uploaded-item-id-000000000000000000000000000",
        owner: ARWEAVE_ADDRESS,
        itemId: "codex-item-1",
        contentType: "text/plain",
        status: "pending",
        createdAt: Date.now(),
        tags: [],
      };
      libraryRows.push(entry);
      await store.append(entry);
      return {
        id: entry.id,
        itemId: entry.itemId,
        ownerAddress: entry.owner,
        tags: entry.tags,
      };
    }),
    listLibrary: vi.fn(async () =>
      [...libraryRows].sort((a, b) => b.createdAt - a.createdAt),
    ),
    openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
    rebuildLibrary: vi.fn(async () => {}),
    libraryStore: store,
    pool: fakePool,

    // address book (D5)
    addressBook: [
      { id: "ab-1", name: "Alice (AR)", address: ARWEAVE_ADDRESS, chainId: ARWEAVE_CHAIN_ID },
      { id: "ab-2", name: "Bob (KDA)", address: "k:abcdef", chainId: KADENA_CHAIN_ID },
    ],

    ...overrides,
  };
}

// ── the CodexProvider seams (a minimal zustand-shaped fake store) ───────────

function makeFakeStore() {
  const state = { schemaVersion: 1, dirty: false, actions: { init: vi.fn(async () => {}), updateUiSettings: vi.fn(async () => {}), clearDirty: vi.fn() } };
  return Object.assign(() => state, {
    getState: () => state,
    subscribe: () => () => {},
  });
}
const fakeAdapter = { name: "memory-fake" } as never;

// ── the full composition under test ─────────────────────────────────────────

/**
 * Compose exactly as the E5 consumer will: the ArweavePanel context provider
 * (injected fakes) wraps the CodexProvider + the generic ForeignChainsTab, so the
 * real ArweavePanel — slotted by id into `foreignChainPanels[ARWEAVE_CHAIN_ID]` —
 * finds its E1-E3 seams while the tab layer stays chain-blind.
 */
function renderPhase(depsOverrides: Partial<ArweavePanelDeps> = {}) {
  const registry = createForeignChainRegistry();
  registry.register(createArweaveAdapter());
  registry.register(stubAdapter);

  const foreignChainPanels: Record<string, React.ComponentType<PanelProps>> = {
    [ARWEAVE_CHAIN_ID]: ArweavePanel,
    [STUB_CHAIN_ID]: StubPanel,
  };

  const deps = makeDeps(depsOverrides);

  const utils = render(
    <ArweavePanelProvider deps={deps}>
      <CodexProvider createStore={(() => makeFakeStore()) as never} adapter={fakeAdapter}>
        <ForeignChainsTab
          foreignChains={registry.list()}
          foreignChainPanels={foreignChainPanels}
        />
      </CodexProvider>
    </ArweavePanelProvider>,
  );
  return { registry, deps, ...utils };
}

function assertNoPrivateJwkInDom(): void {
  const html = document.body.innerHTML;
  for (const field of PRIVATE_JWK_FIELDS) {
    const value = (fixtureJwk as unknown as Record<string, string>)[field];
    expect(html).not.toContain(value);
  }
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Register the real Arweave validator so the recipient paste path exercises the
  // actual D5 `validateAddress(ARWEAVE_CHAIN_ID, ...)` seam.
  registerChainAddressValidator(ARWEAVE_CHAIN_ID, (addr) => /^[A-Za-z0-9_-]{43}$/.test(addr));
});

// ── (a) the N-05 gate — both subtabs, real Arweave panel ────────────────────

describe("E4 integration — the generic tab hosts the real Arweave panel + a stub (N-05)", () => {
  it("(a) shows BOTH the Arweave subtab and the stub subtab, derived from registry.list()", () => {
    const { registry } = renderPhase();
    const tabs = screen.getAllByRole("tab", { name: new RegExp(`^(${ARWEAVE_CHAIN_ID}|${STUB_CHAIN_ID})$`) });
    const tabNames = tabs.map((t) => t.textContent);
    // The tab strip mirrors registry.list() — the real Arweave adapter's id plus
    // the stub, in registration order, with zero generic-layer change.
    expect(registry.list()).toEqual([ARWEAVE_CHAIN_ID, STUB_CHAIN_ID]);
    expect(tabNames).toEqual([ARWEAVE_CHAIN_ID, STUB_CHAIN_ID]);
  });

  it("(a) selecting the stub subtab renders the stub panel, not the Arweave panel", () => {
    renderPhase();
    fireEvent.click(screen.getByRole("tab", { name: STUB_CHAIN_ID }));
    expect(screen.getByTestId("stub-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-panel")).not.toBeInTheDocument();
  });
});

// ── (b) selecting Arweave renders the 5 areas ───────────────────────────────

describe("E4 integration — the 5 Arweave areas render through the real panel", () => {
  it("(b) the Arweave panel is the default slot and its 5 subtabs are present", () => {
    renderPhase();
    // The Arweave subtab is first (registry order) → the Arweave panel mounts.
    expect(screen.getByTestId("arweave-panel")).toBeInTheDocument();
    for (const area of ["keyring", "balance", "send", "upload", "library"]) {
      expect(screen.getByTestId(`arweave-subtab-${area}`)).toBeInTheDocument();
    }
  });

  it("(b) each area's marker renders when its subtab is selected", async () => {
    renderPhase();
    // keyring is the default active area.
    expect(screen.getByTestId("keyring-area")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-subtab-balance"));
    expect(await screen.findByTestId("balance-area")).toBeInTheDocument();
    // Balance numeric token === winstonToAr(w) exactly, with an adjacent AR label.
    expect(await screen.findByTestId("balance-amount")).toHaveTextContent("1.5");
    expect(screen.getByTestId("balance-unit")).toHaveTextContent("AR");

    fireEvent.click(screen.getByTestId("arweave-subtab-send"));
    expect(await screen.findByTestId("send-area")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(await screen.findByTestId("upload-area")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-subtab-library"));
    expect(await screen.findByTestId("library-area")).toBeInTheDocument();
  });
});

// ── (c) the FULL fee-cap error matrix (FIX-1) ───────────────────────────────

describe("E4 integration — the fee-cap error matrix end-to-end (FIX-1)", () => {
  function fillValidSendForm(): void {
    fireEvent.change(screen.getByTestId("send-recipient-input"), { target: { value: ARWEAVE_ADDRESS } });
    fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByTestId("send-cap-input"), { target: { value: "0.01" } });
  }

  it("(c) OVER-CAP: RewardExceedsCapError → a clear reward-vs-cap block, no pay, no confirmed status", async () => {
    const err = new RewardExceedsCapError(5_000_000n, 1_000_000n);
    const send = vi.fn(async () => {
      throw err;
    });
    renderPhase({ send });
    fireEvent.click(screen.getByTestId("arweave-subtab-send"));
    fillValidSendForm();
    fireEvent.click(screen.getByTestId("send-submit"));

    const block = await screen.findByTestId("send-overcap-error");
    // The message is built from err.reward / err.cap (instanceof-discriminated).
    expect(block.textContent).toContain("5000000");
    expect(block.textContent).toContain("1000000");
    expect(screen.queryByTestId("send-confirm")).not.toBeInTheDocument();
    expect(screen.queryByTestId("send-status-final")).not.toBeInTheDocument();
  });

  it("(c) NON-CAP REJECTION: GatewayPoolExhaustedError → non-crash error, send RE-ENABLES, no confirmed status", async () => {
    const err = new GatewayPoolExhaustedError("post", []);
    const send = vi.fn(async () => {
      throw err;
    });
    renderPhase({ send });
    fireEvent.click(screen.getByTestId("arweave-subtab-send"));
    fillValidSendForm();
    fireEvent.click(screen.getByTestId("send-submit"));

    expect(await screen.findByTestId("send-generic-error")).toBeInTheDocument();
    // The button re-enables (the mid-flow crash/hang the review flagged is gone).
    await waitFor(() => expect(screen.getByTestId("send-submit")).not.toBeDisabled());
    expect(screen.queryByTestId("send-overcap-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("send-status-final")).not.toBeInTheDocument();
  });

  it("(c) IN-CAP success: resolves {id,reward} → confirm, then pollStatus pending→final", async () => {
    const { deps } = renderPhase();
    fireEvent.click(screen.getByTestId("arweave-subtab-send"));
    fillValidSendForm();
    fireEvent.click(screen.getByTestId("send-submit"));

    const confirm = await screen.findByTestId("send-confirm");
    expect(confirm.textContent).toContain(ARWEAVE_ADDRESS);
    // The send seam received the winston-parsed cap (never a float).
    const arg = (deps.send as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      maxRewardWinston: bigint;
    };
    expect(arg.maxRewardWinston).toBe(arToWinston("0.01"));
    expect(await screen.findByTestId("send-status-final")).toBeInTheDocument();
  });
});

// ── (d) a permanence-gated upload → a pending Library entry ──────────────────

describe("E4 integration — the permanence-gated upload (E-10)", () => {
  it("(d) confirm renders the permanence warning, then a pending Library entry appears (no phantom)", async () => {
    const { deps } = renderPhase();
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));

    const fileInput = screen.getByTestId("upload-file-input") as HTMLInputElement;
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByTestId("upload-start"));
    // The mandatory permanence confirm gates the upload with the verbatim warning.
    const confirm = await screen.findByTestId("upload-permanence-confirm");
    expect(confirm.textContent).toContain("PERMANENT and PUBLIC");

    fireEvent.click(screen.getByTestId("upload-permanence-accept"));
    // The upload seam ran and the pending entry surfaces — no phantom on happy path.
    await waitFor(() => expect(deps.uploadAndTrack).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("upload-pending-entry")).toBeInTheDocument();
  });
});

// ── (e) an off-thread keygen → key added, JWK never in state/DOM (FIX-5) ─────

describe("E4 integration — the off-thread keygen (FIX-5)", () => {
  it("(e) the fake KeygenRunner adds a key (encrypted) and the JWK never lands in the DOM", async () => {
    const { deps } = renderPhase();
    assertNoPrivateJwkInDom();

    // keyring is the default area; create a key off-thread via the fake runner.
    fireEvent.click(screen.getByTestId("keyring-create"));

    await waitFor(() => expect(deps.keygenRunner.runKeygen).toHaveBeenCalledTimes(1));
    // The resolved JWK is handed to the encrypt-at-rest seam then dropped.
    await waitFor(() =>
      expect(deps.generateArweaveKey).toHaveBeenCalledWith(
        expect.objectContaining({ jwk: fixtureJwk }),
      ),
    );
    await waitFor(() => expect(deps.addForeignKey).toHaveBeenCalledTimes(1));

    // The ciphertext entry — never a plaintext JWK — is what addForeignKey persists,
    // and no private field value ever reached the rendered tree.
    const appended = (deps.addForeignKey as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as ForeignKeyEntry;
    expect(appended).not.toHaveProperty("d");
    assertNoPrivateJwkInDom();
  });
});

// ── (f) a book-recipient pick (Arweave contact) ─────────────────────────────

describe("E4 integration — the address-book recipient pick (E-11)", () => {
  it("(f) the Send picker offers ONLY the Arweave contact and fills it on select", async () => {
    const { deps } = renderPhase();
    fireEvent.click(screen.getByTestId("arweave-subtab-send"));

    const picker = screen.getByTestId("send-book-picker");
    // Only the chainId===ARWEAVE_CHAIN_ID contact is offerable; the Kadena one is filtered.
    expect(within(picker).getByText("Alice (AR)")).toBeInTheDocument();
    expect(within(picker).queryByText("Bob (KDA)")).not.toBeInTheDocument();

    fireEvent.click(within(picker).getByText("Alice (AR)"));
    fireEvent.change(screen.getByTestId("send-amount-input"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByTestId("send-cap-input"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByTestId("send-submit"));

    await waitFor(() => expect(deps.send).toHaveBeenCalledTimes(1));
    const arg = (deps.send as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      target: string;
    };
    // The picked Arweave address filled the recipient and passed the D5 validator.
    expect(arg.target).toBe(ARWEAVE_ADDRESS);
    expect(validateAddress(ARWEAVE_CHAIN_ID, ARWEAVE_ADDRESS)).toBe(true);
  });
});
