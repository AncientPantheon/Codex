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
 *   (b) selecting Arweave renders the 5 categories over the existing areas;
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
  cleanup,
  fireEvent,
} from "@testing-library/react";
import * as React from "react";

import {
  type ArweaveJwk,
  type GatewayPool,
} from "@ancientpantheon/arweave-core";
import { createForeignChainRegistry } from "@ancientpantheon/codex-core";
import type { ForeignChainAdapter, ForeignKeyEntry } from "@ancientpantheon/codex-core";
import {
  registerChainAddressValidator,
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

/** The chain rail Capitalises ids for display ("arweave" -> "Arweave"). The id
 *  stays the contract, so match case-insensitively and assert the display form
 *  via `shown` rather than hardcoding it. */
const shown = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const railTab = (id: string) => new RegExp(`^${id}$`, "i");


// ── constants ─────────────────────────────────────────────────────────────

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const STOACHAIN_CHAIN_ID = "kadena:mainnet";
const STUB_CHAIN_ID = "stub-chain";

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
      { id: "ab-2", name: "Bob (KDA)", address: "k:abcdef", chainId: STOACHAIN_CHAIN_ID },
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
    const tabs = screen.getAllByRole("tab", { name: new RegExp(`^(${ARWEAVE_CHAIN_ID}|${STUB_CHAIN_ID})$`, "i") });
    const tabNames = tabs.map((t) => t.textContent);
    // The tab strip mirrors registry.list() — the real Arweave adapter's id plus
    // the stub, in registration order, with zero generic-layer change.
    expect(registry.list()).toEqual([ARWEAVE_CHAIN_ID, STUB_CHAIN_ID]);
    expect(tabNames).toEqual([ARWEAVE_CHAIN_ID, STUB_CHAIN_ID].map(shown));
  });

  it("(a) selecting the stub subtab renders the stub panel, not the Arweave panel", () => {
    renderPhase();
    fireEvent.click(screen.getByRole("tab", { name: railTab(STUB_CHAIN_ID) }));
    expect(screen.getByTestId("stub-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-panel")).not.toBeInTheDocument();
  });
});

// ── (b) selecting Arweave renders the 5 areas ───────────────────────────────

// ── REMOVED: the five "areas render through the panel" integration blocks ────
//
// ArweavePanel no longer mounts KeyringArea / BalanceArea / SendArea /
// UploadArea / LibraryArea — every Arweave category is now an explicit empty
// placeholder, pending real per-category wiring (Seeds first). The blocks that
// lived here drove those areas THROUGH the panel, so their subject no longer
// exists:
//   (b) the 5 areas render through the real panel
//   (c) the fee-cap error matrix end-to-end (FIX-1)
//   (d) the permanence-gated upload (E-10)
//   (e) the off-thread keygen (FIX-5)
//   (f) the address-book recipient pick (E-11)
//
// NOTHING was deleted from src: each area component still exists and keeps its
// own direct spec (tests/e4-panel-keyring|balance|send|upload|library.test.tsx),
// so the area behaviour above is still covered. Re-add an integration block per
// category as that category gets wired for real.
