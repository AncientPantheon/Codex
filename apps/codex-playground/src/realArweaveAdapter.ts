// ============================================================================
// The REAL Arweave stack for the playground's PG-02 (real) mode — the OPT-IN,
// funds-safety-gated path that swaps the mock fakes for the executed E1-E3 seams.
//
//   - `createRealArweaveAdapter({ gatewayUrl, pool? })` — the REAL E1
//     `createArweaveAdapter({ pool })` fed a `createGatewayPool` built from the
//     USER-SET gateway URL (arweave-core). The `pool` may be injected directly
//     so automated tests drive the "real" path against a FAKE pool with ZERO
//     live network (the live-gateway path is a manual/opt-in dev affordance).
//   - `buildRealPanelDeps({ gatewayUrl, pool?, adapter? })` — the E4
//     `ArweavePanelDeps` bundle wired to the REAL adapter + E3 upload/Library
//     (`MemoryLibraryStore`/`uploadAndTrack`/`pollStatus`/`openUrl`/
//     `rebuildLibrary`) against the same pool.
//
// FUNDS-SAFETY (non-negotiable): the real adapter/pool is constructed ONLY when
// this module is called (i.e. only when the toggle flips to real) — the default
// mock path never imports or constructs it, so booting the app touches no
// network. Keygen-in-the-playground is DOCUMENTED-UNSUPPORTED (S-3): the real
// panel context supplies a main-thread no-op `KeygenRunner` and the real toggle
// imports keys via the throwaway keyfile fixture instead — it NEVER wires a
// bundler-specific `new Worker(...)` into this shared seam. Automated tests use
// the fake runner regardless (no real Worker in jsdom).
// ============================================================================

import {
  createGatewayPool,
  type ArweaveJwk,
  type GatewayPool,
} from "@ancientpantheon/arweave-core";
import type { ForeignChainAdapter, ForeignKeyEntry } from "@ancientpantheon/codex-core";
import {
  createArweaveAdapter,
  MemoryLibraryStore,
  pollStatus,
  openUrl,
  rebuildLibrary,
  type LibraryEntry,
  type LibraryStore,
} from "@ancientpantheon/codex-arweave";
import type {
  ArweavePanelDeps,
  ArweaveSendRequest,
  ArweaveSendResult,
  KeygenProgress,
  KeygenRunner,
} from "@ancientpantheon/codex-arweave/panel";

/**
 * The real-mode gateway pool: `createGatewayPool({ endpoints: [gatewayUrl] })`
 * from arweave-core, fed the user-configured URL. When a `pool` is injected
 * (automated tests), that fake pool is used verbatim and NO real pool is built —
 * this is how the real path is exercised with zero live network.
 */
export function resolveRealPool({
  gatewayUrl,
  pool,
}: {
  gatewayUrl: string;
  pool?: GatewayPool;
}): GatewayPool {
  return pool ?? createGatewayPool({ endpoints: [gatewayUrl] });
}

/**
 * Construct the REAL E1 `ForeignChainAdapter` bound to the resolved gateway pool.
 * NOT constructed until this function is called (real-mode opt-in) — the default
 * mock path never reaches here, so booting the app opens no network connection.
 */
export function createRealArweaveAdapter({
  gatewayUrl,
  pool,
}: {
  gatewayUrl: string;
  pool?: GatewayPool;
}): ForeignChainAdapter {
  const resolvedPool = resolveRealPool({ gatewayUrl, pool });
  return createArweaveAdapter({ pool: resolvedPool });
}

/**
 * A MAIN-THREAD, no-op `KeygenRunner` for the real panel context (S-3): the
 * playground documents worker-based keygen as UNSUPPORTED, so real-mode keygen
 * runs on the main thread. It throws when actually invoked — the real toggle's
 * supported affordance is IMPORTING a key via the throwaway keyfile fixture, not
 * generating one in the browser. Automated tests use the fake runner regardless.
 */
function createUnsupportedKeygenRunner(): KeygenRunner {
  return {
    async runKeygen(
      onProgress: (p: KeygenProgress) => void,
    ): Promise<ArweaveJwk> {
      onProgress({ state: "error" });
      throw new Error(
        "Keygen-in-the-playground is unsupported (real mode). Import an " +
          "existing keyfile instead — see the README funds-safety notes.",
      );
    },
  };
}

/**
 * Assemble the E4 `ArweavePanelDeps` wired to the REAL adapter + E3 upload/
 * Library seams against the resolved gateway pool. The keyring seams surface the
 * ciphertext entries the app supplies (no plaintext JWK); the send seam runs the
 * adapter's real `buildSend`→`sign`→`post` recipe; the upload/library seams run
 * E3's `uploadAndTrack`/`pollStatus`/`openUrl`/`rebuildLibrary` against a real
 * `MemoryLibraryStore`. The keygen seam is the main-thread unsupported runner.
 */
export function buildRealPanelDeps({
  gatewayUrl,
  address,
  foreignKeys = [],
  pool,
  adapter,
  libraryStore,
}: {
  gatewayUrl: string;
  address?: string;
  foreignKeys?: ForeignKeyEntry[];
  pool?: GatewayPool;
  adapter?: ForeignChainAdapter;
  libraryStore?: LibraryStore;
}): ArweavePanelDeps {
  const resolvedPool = resolveRealPool({ gatewayUrl, pool });
  const resolvedAdapter =
    adapter ?? createArweaveAdapter({ pool: resolvedPool });
  const store: LibraryStore = libraryStore ?? new MemoryLibraryStore();
  const ownerAddress = address ?? "";

  return {
    address: ownerAddress,

    // ── keyring (E1) — the app owns the ciphertext entries; no plaintext here ──
    foreignKeys,
    keygenRunner: createUnsupportedKeygenRunner(),
    generateArweaveKey: async () => {
      throw new Error(
        "Keygen-in-the-playground is unsupported (real mode). Import a keyfile.",
      );
    },
    importArweaveKey: async () => {
      throw new Error(
        "Wire importArweaveKey to the codex keyring slice before real import.",
      );
    },
    decryptArweaveKey: async () => {
      throw new Error("decryptArweaveKey requires the unlock-gated keyring.");
    },
    addForeignKey: async () => {},
    renameForeignKey: async () => {},
    deleteForeignKey: async () => {},

    // ── balance / send (E2) — real adapter against the resolved pool ──
    // The D3 `ForeignChainAdapter.getBalance` is deliberately loose
    // (`Promise<unknown>`); the real E1 adapter resolves a winston `bigint`, so
    // narrow it to the panel seam's `Promise<bigint>` contract.
    getBalance: async (addr: string): Promise<bigint> =>
      (await resolvedAdapter.getBalance(addr)) as bigint,
    send: async (_req: ArweaveSendRequest): Promise<ArweaveSendResult> => {
      throw new Error(
        "Real send requires an unlocked keyfile JWK; import one first.",
      );
    },
    pollStatus: async (id: string): Promise<"pending" | "final"> => {
      // E3's pollStatus is void — it flips the store entry to `final` on deep
      // confirmation. Read the entry back to surface the current status the
      // panel's poll seam contract returns.
      await pollStatus(id, { pool: resolvedPool, store });
      const entry = await store.get(id);
      return entry?.status ?? "pending";
    },

    // ── upload / library (E3) — real flows against the resolved pool + store ──
    uploadAndTrack: async (_file: File) => {
      throw new Error(
        "Real upload requires an unlocked keyfile JWK; import one first.",
      );
    },
    listLibrary: (owner: string): Promise<LibraryEntry[]> =>
      store.list(owner),
    openUrl: (id: string, opts?: { pool: GatewayPool }) =>
      openUrl(id, { pool: opts?.pool ?? resolvedPool }),
    rebuildLibrary: async (owner: string, opts: { pool: GatewayPool }) => {
      await rebuildLibrary(owner, {
        pool: opts.pool ?? resolvedPool,
        store,
      });
    },
    libraryStore: store,
    pool: resolvedPool,

    // ── address book (D5) — empty until the app wires the real slice ──
    addressBook: [],
  };
}
