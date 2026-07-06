/**
 * The Arweave-panel seam context.
 *
 * A React context + provider that holds the INJECTED E1-E3 seams (the adapter,
 * keyring ops, the Library store + composition flows, the gateway pool, the
 * off-main-thread `KeygenRunner`, and the unified address book) as ONE typed
 * `ArweavePanelDeps` object. The panel shell and the 5 areas read the seams
 * through `useArweavePanelDeps()` rather than importing concrete protocol code
 * directly — this keeps the panel a pure presentation layer over E1-E3.
 *
 * The deps carry only functions/values the areas consume; no plaintext JWK ever
 * lives here (the keyring ops accept/return ciphertext entries, and the keygen
 * result is handed straight to `generateArweaveKey` by the create flow).
 */

import * as React from "react";
import { createContext, useContext } from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import type {
  KeygenRunner,
  KeygenProgress,
  KeygenWorkerMsg,
} from "../keygen/index.js";
import type { LibraryEntry, LibraryStore } from "../library/types.js";

/**
 * The subset of the D5 `AddressBookEntry` the Send recipient picker reads. The
 * real `AddressBookEntry` (which additionally carries `type`/`createdAt`/
 * `updatedAt`/`notes`) is structurally assignable to this — the panel depends
 * only on the id/name/address/chainId a recipient row needs, so it stays free
 * of a value edge on the codex-ouronet `/types` subpath.
 */
export interface PanelAddressBookEntry {
  id: string;
  name: string;
  address: string;
  chainId?: string;
}

/**
 * The keygen seam types are OWNED by `src/keygen` — the single source of truth.
 * The context re-exports them by name so panel consumers can keep importing
 * `KeygenRunner`/`KeygenProgress` from the panel barrel, while the canonical
 * coarse `{ state }` shape (never `{ phase }`, never a JWK field) flows through.
 */
export type { KeygenRunner, KeygenProgress, KeygenWorkerMsg };

/** The result of E2's send: the tx/data-item id + the quoted reward (winston). */
export interface ArweaveSendResult {
  id: string;
  reward: bigint;
}

/** The winston-denominated send request the Send area hands to E2. */
export interface ArweaveSendRequest {
  target: string;
  quantity: bigint;
  maxRewardWinston: bigint;
}

/**
 * The full injected-seam bundle the Arweave panel + its areas consume. Every
 * member is a seam the E5 consumer wires from the executed E1-E3 surface; the
 * panel never reaches into concrete protocol modules itself.
 */
export interface ArweavePanelDeps {
  /** The selected Arweave address the balance/upload/library areas are scoped to. */
  address: string;

  // ── keyring (E1) ──
  /** The current foreign-key entries (ciphertext-only) for the keyring list. */
  foreignKeys: ForeignKeyEntry[];
  /** The off-main-thread keygen seam driving the create flow. */
  keygenRunner: KeygenRunner;
  /** E1 generate: encrypts the handed JWK at rest and returns the ciphertext entry. */
  generateArweaveKey: (args: { jwk: ArweaveJwk; label?: string }) => Promise<ForeignKeyEntry>;
  /** E1 import: validates + encrypts a raw keyfile, returns the ciphertext entry. */
  importArweaveKey: (raw: unknown, opts?: { label?: string }) => Promise<ForeignKeyEntry>;
  /** E1 decrypt: unlock-gated decrypt of an entry to its transient JWK (export flow). */
  decryptArweaveKey: (entry: ForeignKeyEntry) => Promise<ArweaveJwk>;
  /** Persist a pre-encrypted entry into the foreign-key slice. */
  addForeignKey: (entry: ForeignKeyEntry) => Promise<void>;
  /** Rename an entry by id. */
  renameForeignKey: (id: string, label: string) => Promise<void>;
  /** Delete an entry by id. */
  deleteForeignKey: (id: string) => Promise<void>;

  // ── balance / send (E2) ──
  /** E2 balance read: winston bigint for an address. */
  getBalance: (address: string) => Promise<bigint>;
  /** E2 send: resolves `{id,reward}` or throws the fee-cap/non-cap error matrix. */
  send: (req: ArweaveSendRequest) => Promise<ArweaveSendResult>;
  /** E2 status poll: resolves the current confirmation state for a tx id. */
  pollStatus: (id: string) => Promise<"pending" | "final">;

  // ── upload / library (E3) ──
  /** E3 upload-then-append: uploads and returns the data-item result. */
  uploadAndTrack: (
    file: File,
  ) => Promise<{ id: string; itemId: string; ownerAddress: string; tags: unknown[] }>;
  /** E3 list: the owner's Library entries, newest-first. */
  listLibrary: (owner: string) => Promise<LibraryEntry[]>;
  /** E3 openUrl: composes a healthy-gateway URL for an id. */
  openUrl: (id: string, opts?: { pool: GatewayPool }) => string;
  /** E3 rebuild-from-chain: reconciles the Library for an owner. */
  rebuildLibrary: (owner: string, opts: { pool: GatewayPool }) => Promise<void>;
  /** The Library persistence seam (injected impl: Memory / IndexedDB / SQLite). */
  libraryStore: LibraryStore;
  /** The gateway pool the open/rebuild paths run through. */
  pool: GatewayPool;

  // ── address book (D5) ──
  /** The unified address book — the Send recipient picker filters this to Arweave. */
  addressBook: PanelAddressBookEntry[];
}

const ArweavePanelContext = createContext<ArweavePanelDeps | null>(null);

export interface ArweavePanelProviderProps {
  deps: ArweavePanelDeps;
  children: React.ReactNode;
}

/** Provides the injected E1-E3 seam bundle to the panel + its areas. */
export function ArweavePanelProvider({
  deps,
  children,
}: ArweavePanelProviderProps): React.ReactElement {
  return (
    <ArweavePanelContext.Provider value={deps}>{children}</ArweavePanelContext.Provider>
  );
}

/** Reads the injected seam bundle; throws if used outside the provider so a
 *  missing wiring fails loudly rather than dereferencing `null`. */
export function useArweavePanelDeps(): ArweavePanelDeps {
  const deps = useContext(ArweavePanelContext);
  if (deps === null) {
    throw new Error(
      "useArweavePanelDeps must be used within an ArweavePanelProvider.",
    );
  }
  return deps;
}

export { ArweavePanelContext };
