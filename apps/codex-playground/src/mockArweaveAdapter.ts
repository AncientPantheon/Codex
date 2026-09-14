// ============================================================================
// The MOCK Arweave stack for the playground's PG-01 (mock) mode.
//
// This module supplies ZERO-DEPENDENCY, deterministic fakes so the Foreign
// Chains tab + the E4 ArweavePanel render with NO network and NO real keys:
//   - `createMockArweaveAdapter()` — a D3 `ForeignChainAdapter` whose id is the
//     canonical `ARWEAVE_CHAIN_ID` (imported, never re-spelled). ALL methods are
//     async (F-004) so they match the `Promise<T>` seams the panel `await`s.
//   - `buildMockPanelDeps()` — the E4 `ArweavePanelDeps` bundle filled with fakes
//     (an in-memory `MemoryLibraryStore`, a `FakeKeygenRunner`, a no-op gateway
//     pool, and fake balance/send/upload seams). The non-fake seams are the two
//     CODEX-LOCAL lists the caller passes in: the address book (so the Send
//     recipient picker is exercised against the user's own saved addresses) and
//     the foreign-key slice (so Arweave → Accounts lists the Codex's real keys).
//     Neither touches the network, and the `send` seam itself stays fake, so
//     nothing moves.
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
  PanelAddressBookEntry,
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

/**
 * The ciphertext-only (N-06) entry the fake generate/import seams RESOLVE.
 *
 * It is NOT seeded into the keyring list any more (E5/T8): the mock stack used
 * to hand `buildMockPanelDeps` a hardcoded `mock-arweave-key-1` /
 * "Mock Arweave key" entry, so Arweave → Accounts rendered a populated list —
 * under "Unassigned", since no seed can claim it — in a Codex holding no
 * Arweave material at all. An empty Codex must show the empty state; the real
 * `foreignKeys` slice is the only source of that list now.
 *
 * Its id is the mock ADDRESS, mirroring the real keyring (which uses the
 * canonical 43-char address as the stable entry id) instead of a demo label.
 */
function mockKeyringEntry(label?: string): ForeignKeyEntry {
  const entry: ForeignKeyEntry = {
    id: MOCK_FAKE_ADDRESS,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: "mock-encrypted-keyfile-blob",
  };
  if (label !== undefined) entry.label = label;
  return entry;
}

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

/** Options for {@link buildMockPanelDeps}. */
export interface BuildMockPanelDepsOptions {
  /** The panel-shaped address book (the app maps the CODEX address-book slice
   *  into this shape — see `ForeignChainsWiring.toPanelAddressBook`). The Send
   *  area filters it down to `chainId === ARWEAVE_CHAIN_ID`, so an empty seam
   *  means a saved Arweave address can never be picked as a recipient. Defaults
   *  to empty for the non-React callers (`buildMockPanelDeps()` with no store). */
  addressBook?: PanelAddressBookEntry[];
  /** The codex's REAL foreign-key entries (ciphertext-only), passed through
   *  from the mounted store by `ForeignChainsWiring`. The Arweave panel filters
   *  them to `chainId === ARWEAVE_CHAIN_ID` and groups them by `seedId` in the
   *  Accounts category, so an empty Codex shows the empty state. Defaults to
   *  empty for the non-React callers — NEVER to a demo entry (E5/T8). */
  foreignKeys?: ForeignKeyEntry[];
}

/**
 * Assemble the E4 `ArweavePanelDeps` filled with fakes for every NETWORK seam,
 * disconnected from any gateway. The LibraryStore is a fresh empty
 * `MemoryLibraryStore`; the keygen runner is a local `FakeKeygenRunner`.
 *
 * TWO seams are NOT fakes — both are codex-local (no network, no funds), so
 * faking them would only hide the user's own data from the panel:
 *   - `addressBook` — the real codex entries, so the Send recipient picker is
 *     exercised against the user's own saved addresses.
 *   - `foreignKeys` — the real keyring slice, so Arweave → Accounts lists the
 *     Codex's actual Arweave keys and an EMPTY Codex shows the empty state
 *     (E5/T8; the old hardcoded demo entry made an empty Codex look populated).
 * The mutating keyring seams stay no-ops here: mock mode must never write fake
 * key material into the user's real codex.
 */
export function buildMockPanelDeps(
  { addressBook = [], foreignKeys = [] }: BuildMockPanelDepsOptions = {},
): ArweavePanelDeps {
  const adapter = createMockArweaveAdapter();
  const libraryStore: LibraryStore = new MemoryLibraryStore();
  const pool = createNoopGatewayPool();

  return {
    address: MOCK_FAKE_ADDRESS,

    // keyring — the LIST is the codex's own slice; the mutating seams are fakes.
    foreignKeys,
    keygenRunner: createFakeKeygenRunner(),
    generateArweaveKey: async ({ label }) => mockKeyringEntry(label),
    importArweaveKey: async (_raw, opts) => mockKeyringEntry(opts?.label),
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

    // address book (D5) — the codex entries the app mapped in (empty when the
    // caller supplied none).
    addressBook,
  };
}
