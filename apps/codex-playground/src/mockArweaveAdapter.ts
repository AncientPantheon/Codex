// ============================================================================
// The MOCK Arweave stack for the playground's PG-01 (mock) mode.
//
// This module supplies ZERO-DEPENDENCY, deterministic fakes so the Foreign
// Chains tab + the E4 ArweavePanel render with NO network and NO real keys:
//   - `createMockArweaveAdapter()` — a D3 `ForeignChainAdapter` whose id is the
//     canonical `ARWEAVE_CHAIN_ID` (imported, never re-spelled). ALL methods are
//     async (F-004) so they match the `Promise<T>` seams the panel `await`s.
//   - `buildMockPanelDeps()` — the E4 `ArweavePanelDeps` bundle filled with fakes
//     (a fake keyring seeded with one ciphertext-only entry, an in-memory
//     `MemoryLibraryStore`, a `FakeKeygenRunner`, a no-op gateway pool, an empty
//     address book, and fake balance/send/upload seams).
//
// FUNDS-SAFETY / SECRET HYGIENE (N-06): the fake keyring entry carries an
// ENCRYPTED-blob placeholder (never a plaintext JWK field); the fake JWK the
// keygen/import seams resolve is a throwaway shape with empty key material — it
// is NEVER a real or funded key. Nothing here touches a real gateway.
// ============================================================================

import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";
import type { ForeignChainAdapter, ForeignKeyEntry } from "@ancientpantheon/codex-core";
import {
  MemoryLibraryStore,
  type LibraryEntry,
  type LibraryStore,
} from "@ancientpantheon/codex-arweave";
import type {
  ArweavePanelDeps,
  KeygenProgress,
  KeygenRunner,
} from "@ancientpantheon/codex-arweave/panel";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";

/**
 * The fixed fake Winston balance the mock `getBalance` resolves. Chosen so
 * `winstonToAr(MOCK_FAKE_BALANCE_WINSTON) === "1.5"` — the deterministic
 * no-network anchor the balance-area render assertion drives its expectation off.
 */
export const MOCK_FAKE_BALANCE_WINSTON = 1_500_000_000_000n;

/**
 * A fixed fake canonical 43-character Arweave address the mock `addressOf`
 * resolves. Reuses the throwaway address anchor — no real/funded wallet.
 */
export const MOCK_FAKE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

/**
 * A throwaway JWK-SHAPED object the mock keygen/import seams resolve. Every RSA
 * field is an empty placeholder — this is NEVER a real or funded key. It exists
 * only so the async seams return a value of the right shape.
 */
export const MOCK_FAKE_JWK: ArweaveJwk = {
  kty: "RSA",
  n: "",
  e: "AQAB",
  d: "",
  p: "",
  q: "",
  dp: "",
  dq: "",
  qi: "",
};

/** A single fake keyring entry — ciphertext-only (N-06), seeding the keyring list. */
export const MOCK_FOREIGN_KEY_ENTRY: ForeignKeyEntry = {
  id: "mock-arweave-key-1",
  label: "Mock Arweave key",
  chainId: ARWEAVE_CHAIN_ID,
  encryptedKeyfile: "mock-encrypted-keyfile-blob",
};

/**
 * The MOCK `ForeignChainAdapter` (D3 contract) — `id === ARWEAVE_CHAIN_ID`, all
 * methods async, returning deterministic fakes with NO network and NO real keys.
 */
export function createMockArweaveAdapter(): ForeignChainAdapter {
  return {
    id: ARWEAVE_CHAIN_ID,
    async generateKey(): Promise<ArweaveJwk> {
      return MOCK_FAKE_JWK;
    },
    async importKey(): Promise<ArweaveJwk> {
      return MOCK_FAKE_JWK;
    },
    async addressOf(): Promise<string> {
      return MOCK_FAKE_ADDRESS;
    },
    async getBalance(): Promise<bigint> {
      return MOCK_FAKE_BALANCE_WINSTON;
    },
    async buildSend(): Promise<{ id: string }> {
      return { id: "mock-unsigned-tx" };
    },
    async sign(): Promise<{ id: string; signature: string }> {
      return { id: "mock-signed-tx", signature: "mock-signature" };
    },
    async post(): Promise<{ id: string; status: "pending" }> {
      return { id: "mock-posted-tx", status: "pending" };
    },
    async upload(): Promise<{ id: string; itemId: string }> {
      return { id: "mock-upload-id", itemId: "mock-item-id" };
    },
  };
}

/**
 * A local fake `KeygenRunner` — scripts coarse progress then resolves the
 * throwaway JWK, with NO worker and NO real RSA-4096. App-owned (mirrors E4's
 * `FakeKeygenRunner`) so the mock keygen seam needs no protocol-package value edge.
 */
function createFakeKeygenRunner(): KeygenRunner {
  return {
    async runKeygen(
      onProgress: (p: KeygenProgress) => void,
    ): Promise<ArweaveJwk> {
      onProgress({ state: "working" });
      onProgress({ state: "done" });
      return MOCK_FAKE_JWK;
    },
  };
}

/** A no-op gateway pool — the mock never opens a URL or rebuilds against a network. */
function createNoopGatewayPool(): GatewayPool {
  return {
    execute: async () => {
      throw new Error("mock gateway pool: no network in mock mode");
    },
    getHealthSnapshot: () => [],
    getActiveEndpoint: () => "mock://offline",
  };
}

/**
 * Assemble the E4 `ArweavePanelDeps` filled entirely with fakes disconnected
 * from any real store or network. The fake keyring is a local in-memory list
 * (NOT bridged to the codex store — F-002); the LibraryStore is a fresh empty
 * `MemoryLibraryStore`; the keygen runner is E4's `FakeKeygenRunner`.
 */
export function buildMockPanelDeps(): ArweavePanelDeps {
  const adapter = createMockArweaveAdapter();
  const libraryStore: LibraryStore = new MemoryLibraryStore();
  const pool = createNoopGatewayPool();

  // A local fake keyring, seeded with one ciphertext-only entry so the keyring
  // area renders the list (not the empty state). Disconnected from the codex
  // store on purpose (mock mode) — the real-store round-trip is asserted
  // elsewhere against the actual slice, never against this fake.
  const foreignKeys: ForeignKeyEntry[] = [MOCK_FOREIGN_KEY_ENTRY];

  return {
    address: MOCK_FAKE_ADDRESS,

    // keyring seams (fakes)
    foreignKeys,
    keygenRunner: createFakeKeygenRunner(),
    generateArweaveKey: async () => MOCK_FOREIGN_KEY_ENTRY,
    importArweaveKey: async () => MOCK_FOREIGN_KEY_ENTRY,
    decryptArweaveKey: async () => MOCK_FAKE_JWK,
    addForeignKey: async () => {},
    renameForeignKey: async () => {},
    deleteForeignKey: async () => {},

    // balance / send seams (fakes)
    getBalance: async () => (await adapter.getBalance()) as bigint,
    send: async () => ({ id: "mock-send-tx", reward: 0n }),
    pollStatus: async () => "final",

    // upload / library seams (fakes)
    uploadAndTrack: async () => ({
      id: "mock-upload-id",
      itemId: "mock-item-id",
      ownerAddress: MOCK_FAKE_ADDRESS,
      tags: [],
    }),
    listLibrary: async (): Promise<LibraryEntry[]> => [],
    openUrl: (id: string) => `mock://library/${id}`,
    rebuildLibrary: async () => {},
    libraryStore,
    pool,

    // address book (D5) — empty in mock mode
    addressBook: [],
  };
}
