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
import type { MultiOwnerRebuildProgress } from "../library/rebuild.js";
import type {
  ArweaveSeedAccountSource,
  ArweaveSeedChainwebSource,
  ArweaveSeedDeletion,
} from "./ArweaveSeedsArea.js";
import type {
  UploadTrackResult,
  UploadBundleTrackResult,
} from "./UploadArea.js";
import type { UploadWizardSelection } from "./UploadWizard.js";
import type { CodexBackupResult } from "./CodexBackupArea.js";

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
  /**
   * The host's single DEFAULT Arweave identity — typically its first
   * configured key. Used as the balance/upload areas' starting point and as
   * codex-backup's own default signing identity (which never carries an
   * explicit per-call account selection the way `uploadAndTrack`/
   * `uploadFilesAndTrack` do).
   *
   * NOT what the Library area scopes to, as of `arweave-library-multi-key`:
   * a codex can hold more than one Arweave key, and an upload can genuinely
   * go out under ANY of them (the Upload Wizard's own Account step resolves
   * its `accountId` per call) — scoping Library to this one address made
   * every OTHER key's uploads silently invisible and un-rebuildable. The
   * panel therefore derives the FULL set of this chain's configured
   * addresses from `foreignKeys` (see `ArweavePanel.tsx`'s own
   * `libraryOwners`) and hands that whole list to `LibraryArea`, which
   * aggregates `listLibrary`/`rebuildLibrary` across every one of them —
   * this field is folded in too, as a floor, never a narrowing.
   */
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

  // ── Arweave seeds (Class-IA seeded RSA) ──
  // OPTIONAL: the panel forwards each straight through to `ArweaveSeedsArea`.
  // A consumer that omits one leaves exactly that affordance disabled — the
  // area degrades per-source rather than failing, so a host with no decrypt
  // seam still gets Free Seed Input and the Accounts list.
  //
  // `arweave-upload-encryption` (T6): `ouronetAccounts`/`revealAccountSecret`
  // are now a SHARED seam — `LibraryArea`'s decrypt-on-download also consumes
  // both (forwarded the same way this seam already reaches
  // `ArweaveSeedsArea`), since they're the ONLY mapping this panel has from
  // an on-chain `Codex-Encryptor` address back to a revealable account. A
  // consumer that omits either leaves encrypted-entry download disabled
  // (surfacing `LibraryArea`'s "doesn't hold the account" message) exactly
  // as omitting them already leaves seed-Option-2 disabled.
  /** Activated, dalos-curve Ouronet accounts offered by define-seed Option 2,
   *  and the address→account mapping `LibraryArea`'s decrypt-on-download uses. */
  ouronetAccounts?: readonly ArweaveSeedAccountSource[];
  /** Decrypts an Ouronet account's stored secret (unlock-gated), for
   *  define-seed Option 2 AND `LibraryArea`'s decrypt-on-download. */
  revealAccountSecret?: (accountId: string) => Promise<string | null> | string | null;
  /** Chainweb seeds offered by define-seed Option 3. */
  chainwebSeeds?: readonly ArweaveSeedChainwebSource[];
  /** Decrypts a Chainweb seed's stored mnemonic into its words (unlock-gated),
   *  for Option 3. LAZY on purpose — eagerly decrypting every seed just to
   *  populate a picker would hold every mnemonic in memory at once. */
  revealSeedWords?: (seedId: string) => Promise<readonly string[] | null>;
  /** Spawns the off-main-thread keygen worker. Bundler-specific, so it is
   *  injected by the APP — never hardcoded in this package (`worker.ts` and
   *  `worker.js` resolve differently in src vs dist). */
  workerFactory?: () => Worker;
  /** Deletes a seed AND the keys derived from it. Without it a delete only
   *  clears the row locally and the entries orphan in the store. */
  onDeleteSeed?: (request: ArweaveSeedDeletion) => Promise<void> | void;

  // ── balance / send (E2) ──
  /** E2 balance read: winston bigint for an address. */
  getBalance: (address: string) => Promise<bigint>;
  /** E2 send: resolves `{id,reward}` or throws the fee-cap/non-cap error matrix. */
  send: (req: ArweaveSendRequest) => Promise<ArweaveSendResult>;
  /** E2 send-from: resolves the JWK for the given entry at call time (never
   *  cached) and sends from it, resolving `{id,reward}` or throwing the same
   *  fee-cap/non-cap error matrix as `send`. */
  sendFrom: (entry: ForeignKeyEntry, req: ArweaveSendRequest) => Promise<ArweaveSendResult>;
  /** E2 fee estimate: a live Winston quote for a `byteSize`/`target` pair, used
   *  to show "Network fee: ~X AR" and to derive the buffered `maxRewardWinston` cap. */
  estimateFee: (byteSize: number, target: string) => Promise<bigint>;
  /** E2 status poll: resolves the current confirmation state for a tx id. */
  pollStatus: (id: string) => Promise<"pending" | "final">;

  // ── upload / library (E3, current T5/T7 shapes) ──
  /** E3 upload-then-append (T5/T7/T8 CURRENT shape): uploads a single file
   *  under a mandatory category selection and returns the data-item result.
   *  Typed to `UploadWizardSelection` (`arweave-upload-wizard`, T2/T3) — a
   *  STRICT widening of `UploadAreaProps`'s own `UploadCategorySelection`
   *  (one additional optional field, `encryptFor`) — rather than the
   *  narrower shape, because this is what the real underlying function
   *  (`library/flow.ts`'s `uploadAndTrack`, via its `opts.encryptFor`)
   *  actually accepts once an Encrypted upload is possible; a host wiring
   *  that never threads `encryptFor` through still satisfies this type
   *  exactly as before (the field is optional), and `UploadArea.tsx` itself
   *  is unaffected — it only ever builds the narrower
   *  `UploadCategorySelection`, which is assignable to this wider shape.
   *
   *  THIRD PARAMETER, `accountId` (owner-reported Bug 1 fix,
   *  `arweave-upload-wizard-account-wiring`): the chosen account's id — the
   *  SAME `ForeignKeyEntry.id` `UploadWizard`'s own Account step picker
   *  already holds as its `accountId` state, forwarded verbatim with no
   *  translation. Before this parameter existed, the Account step's
   *  selection was purely cosmetic: nothing told a real implementation
   *  WHICH account should sign/pay for the upload, so it silently used
   *  whatever identity the host's deps happened to be constructed with
   *  (see `realArweaveAdapter.ts`'s `buildRealPanelDeps`) regardless of what
   *  the wizard showed as selected. A consumer MUST resolve the actual
   *  signing key from this id at call time (never from a construction-time
   *  default) for the Account step to mean anything in a multi-account
   *  codex. */
  uploadAndTrack: (
    file: File,
    selection: UploadWizardSelection,
    accountId: string,
  ) => Promise<UploadTrackResult>;
  /** T7 bundle-aware upload-then-append: uploads 2+ files (or a folder), with
   *  the SAME category selection applied to every item, as one atomic bundle.
   *  Same `UploadWizardSelection` widening, AND the same mandatory
   *  `accountId` third parameter, as {@link ArweavePanelDeps.uploadAndTrack}. */
  uploadFilesAndTrack: (
    files: File[],
    selection: UploadWizardSelection,
    accountId: string,
  ) => Promise<UploadBundleTrackResult>;
  /** `arweave-non-removable-account` T4: fired once an Encrypted upload
   *  succeeds through the `UploadWizard` mount, with the ENCRYPTING Ouronet
   *  account's id — mirrors `getBalance`/`revealAccountSecret`'s existing
   *  injection shape exactly (optional, threaded straight through to
   *  `UploadWizard`). This is the real-app wiring point `library/flow.ts`'s
   *  own `uploadAndTrack`/`uploadFilesAndTrack` were already built to drive
   *  (their `opts.onAccountUsedForEncryption`) — the non-removable-account
   *  invariant's dead-letter gap: "the trigger exists and fires, but nothing
   *  in the real app is wired to it yet" (design.md). `codex-arweave` itself
   *  never interprets what "non-removable" means or imports `codex-ouronet`
   *  — a consumer that omits this leaves the signal unobserved, exactly as
   *  omitting any other optional seam here leaves its own affordance inert. */
  onAccountUsedForEncryption?: (accountId: string) => void;
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
  /**
   * `arweave-auto-rebuild-on-unlock`: the HOST's own in-flight
   * multi-address auto-rebuild progress (driven by `rebuildLibraryForAllOwners`,
   * which the host runs once per unlock — this panel never triggers it
   * itself), or `null`/absent when none is running. Mirrors the
   * `onAccountUsedForEncryption`/`checkArweaveRestoreEligibility` optional-
   * value-seam shape already established on this interface: the panel just
   * forwards whatever the host reports, through `LibraryAutoRebuildProgress`,
   * mounted in the Library category — an unwired host (or one that never
   * updates this field) simply never shows the status, same "absent optional
   * seam → graceful no-op" discipline every other optional field here
   * already follows.
   */
  libraryAutoRebuildProgress?: MultiOwnerRebuildProgress | null;

  // ── codex backup (arweave-upload-categories T5) ──
  /** Resolves the codex's CURRENT encrypted export payload — the SAME
   *  `useCodexBackup().exportForCloud` seam the download/cloud-backup flow
   *  already uses. Computed by the HOST, forwarded to `CodexBackupArea`
   *  verbatim: this module never parses, produces, or interprets it (matches
   *  `CodexBackupAreaProps.getExportJson` verbatim). LAZY on purpose —
   *  `CodexBackupArea` calls it fresh at confirm-time, never at mount/render
   *  time, so a backup always captures whatever's true at the moment of the
   *  click. */
  getExportJson: () => Promise<string>;
  /** Uploads the resolved export payload under `Codex-Category: codex-backup` (via
   *  `backupCodexToLibrary`, `library/flow.ts`) and resolves the resulting
   *  data-item id. The host's own closure is also where the codex's `dirty`
   *  flag gets cleared on success — this module has zero knowledge of that.
   *  Matches `CodexBackupAreaProps.backupCodex` verbatim. */
  backupCodex: (exportJson: string) => Promise<CodexBackupResult>;
  /** `codex-seed-restore-activation` T2: resolves whether the codex's Prime
   *  Arweave seed currently shares origin words with Prime Ouronet (`true` ⇒
   *  the NEXT `backupCodex` call will carry a `Codex-Backup-Recovery-Key`
   *  recovery tag — `codex-recovery-backup-tagging`). HOST-SUPPLIED and
   *  ZERO-ARGUMENT on purpose: the host already holds the Prime Ouronet
   *  account's bitstring AND the Prime Arweave seed's stored address, so it
   *  answers this itself via T1's `checkArweaveRestoreEligibility`
   *  (`seeds/checkRestoreEligibility.ts`) — this package's UI layer never
   *  touches an Ouronet account's bitstring directly, matching the
   *  host-app-bridges-isolated-packages pattern every other seam here
   *  follows. Same optional-seam shape precedent as `revealAccountSecret`
   *  above. Drives `ArweaveRestoreEligibilityStatus`, mounted in the Library
   *  category alongside `CodexBackupArea` — OPTIONAL: an unwired host simply
   *  never shows the status (same "absent seam → graceful no-op" discipline
   *  every other optional field here already follows), and the mock adapter
   *  is not required to implement it. The underlying re-derivation is an
   *  RSA-4096 keygen (~6.7s) — a consumer that wires this should expect a
   *  real multi-second resolve, never an instant one. */
  checkArweaveRestoreEligibility?: () => Promise<boolean>;

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
