// ============================================================================
// THROWAWAY DEV FIXTURES — NEVER REAL FUNDS OR KEYS (N-06).
//
// Every value in this module is fabricated dev-only test material. All wallet
// "secrets" are opaque THROWAWAY encrypted-looking blobs — they are NOT real
// ciphertext of any real key, they decrypt to nothing, and they back no funds.
// The `backupPassword` below is a clearly-labeled dev-only test password. Do
// NOT paste any real mnemonic, private key, or password into this file.
//
// These fixtures feed the codex-playground devtool's two load modes:
//   - mode-2 (plaintext snapshot): `emptySnapshot` / `populatedKadenaSnapshot`
//     are hydrated VERBATIM into a MemoryCodexAdapter, so their `lastUpdatedAt`
//     / `lastUpdatedDevice` are KNOWN FIXED constants (see MODE2_* below) that a
//     round-trip test can assert exactly.
//   - mode-1 (backup JSON): `backupJson` is the augmented "1.2"+pureKeypairs
//     backup wire shape the real `useCodexBackup().importFromCloud` restores.
//     The restore SYNTHESIZES `lastUpdatedAt` and re-stamps `lastUpdatedDevice`
//     to the current device, so this module exports the backup's DATA slices as
//     reference constants (NOT a verbatim lastUpdated* constant).
// ============================================================================

import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type {
  IKadenaSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  UiSettings,
} from "@ancientpantheon/codex-ouronet/types";

// ---------------------------------------------------------------------------
// Known-fixed mode-2 metadata.
//
// `DeviceVariant` is the union `"dev" | "main"` (verified on disk) — it has NO
// `"playground"` member, so the closest dev tag `"dev"` is the fixed device for
// the mode-2 verbatim round-trip. The mode-2 hydration path is `structuredClone`
// (no re-stamp), so a round-trip test asserts these values EXACTLY.
// ---------------------------------------------------------------------------

/** Fixed `lastUpdatedDevice` on the mode-2 plaintext snapshots. The
 *  DeviceVariant union rejects "playground"; "dev" is the substituted tag. */
export const MODE2_LAST_UPDATED_DEVICE = "dev" as const;

/** Fixed `lastUpdatedAt` on the mode-2 plaintext snapshots. A stable ISO
 *  string so the verbatim round-trip is deterministic. */
export const MODE2_LAST_UPDATED_AT = "2026-07-04T00:00:00.000Z" as const;

// ---------------------------------------------------------------------------
// THROWAWAY encrypted-blob material (mode-1 backup + mode-2 populated snapshot).
//
// Opaque, clearly-fake ciphertext-looking strings. NOT real encrypted secrets.
// ---------------------------------------------------------------------------

const THROWAWAY_ENCRYPTED_SEED_SECRET =
  "THROWAWAY-enc::v1::a2FkZW5hLXNlZWQtdGhyb3dhd2F5LW5vdC1yZWFs";
const THROWAWAY_ENCRYPTED_OURO_SECRET =
  "THROWAWAY-enc::v1::b3Vyby1hY2NvdW50LXNlY3JldC10aHJvd2F3YXk";
const THROWAWAY_ENCRYPTED_OURO_BACKUP =
  "THROWAWAY-enc::v1::b3Vyby1iYWNrdXAtYmxvYi10aHJvd2F3YXk";
const THROWAWAY_ENCRYPTED_PURE_PRIVKEY =
  "THROWAWAY-enc::v1::cHVyZS1rZXlwYWlyLXByaXZhdGUtdGhyb3dhd2F5";

// ---------------------------------------------------------------------------
// mode-2 fixture: EMPTY plaintext snapshot.
//
// Valid CodexSnapshot shape, no kadenaSeeds/ouroAccounts entries, known-fixed
// lastUpdated* so the empty-but-valid round-trip is deterministic.
// ---------------------------------------------------------------------------

const DEFAULT_UI_SETTINGS: UiSettings = {
  passwordCacheMinutes: 1,
  patronSelectionMode: "wealthiest",
  selectedNode: "node2",
  customNodeUrl: "",
  customNodeGasLimit: 1_600_000,
  legacyKoalaSigning: false,
  experimentalCurvesEnabled: false,
  zbomProfile: "basic",
  zbomZone0: true,
  zbomZone1: false,
  zbomZone2: false,
  zbomZone3: false,
  zbomExecutePosition: "top",
};

/** A valid but EMPTY CodexSnapshot (mode-2). No Kadena/Ouro entries. */
export const emptySnapshot: CodexSnapshot = {
  kadenaSeeds: [],
  ouroAccounts: [],
  pureKeypairs: [],
  addressBook: [],
  watchList: [],
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  consumerSettings: {},
  schemaVersion: 1,
  lastUpdatedAt: MODE2_LAST_UPDATED_AT,
  lastUpdatedDevice: MODE2_LAST_UPDATED_DEVICE,
};

// ---------------------------------------------------------------------------
// mode-2 fixture: POPULATED-Kadena plaintext snapshot.
//
// >= 1 Kadena seed + >= 1 Ouro account (+ address-book + pure keypair) so the
// dashboard renders visible content. Secrets are THROWAWAY encrypted blobs.
// Known-fixed lastUpdated* for the verbatim round-trip.
// ---------------------------------------------------------------------------

const throwawayKadenaSeed: IKadenaSeed = {
  id: "seed-throwaway-0001",
  name: "Throwaway Dev Seed",
  seedType: "chainweaver",
  version: "1.2",
  index: 0,
  secret: THROWAWAY_ENCRYPTED_SEED_SECRET,
  main: "k:00000000000000000000000000000000000000000000000000000000throwaway",
  createdAt: "2026-07-01T00:00:00.000Z",
  accounts: [
    {
      index: 0,
      publicKey:
        "0000000000000000000000000000000000000000000000000000throwaway01",
      derivationPath: "m/44'/626'/0'/0/0",
      guard: [
        "0000000000000000000000000000000000000000000000000000throwaway01",
      ],
    },
  ],
  isPrime: true,
};

const throwawayOuroAccount: IOuroAccount = {
  id: "ouro-throwaway-0001",
  name: "Throwaway Ouro Prime",
  version: "1.2",
  isSmart: false,
  address: "Ѻ.throwaway-dev-account-not-real",
  guard: {
    pred: "keys-all",
    keys: ["0000000000000000000000000000000000000000000000000000throwaway01"],
  },
  kadenaLedger: null,
  publicKey:
    "0000000000000000000000000000000000000000000000000000throwaway01",
  secret: THROWAWAY_ENCRYPTED_OURO_SECRET,
  backup: THROWAWAY_ENCRYPTED_OURO_BACKUP,
  isActive: true,
  originMode: "seedWords",
  originCurve: "dalos",
  isPrime: true,
  parentSeedId: "seed-throwaway-0001",
};

const throwawayPureKeypair: IPureKeypair = {
  id: "pure-throwaway-0001",
  label: "CodexGuard",
  publicKey:
    "0000000000000000000000000000000000000000000000000000throwawayCG",
  encryptedPrivateKey: THROWAWAY_ENCRYPTED_PURE_PRIVKEY,
  createdAt: "2026-07-01T00:00:00.000Z",
  isCodexGuard: true,
};

const throwawayAddressBookEntry: AddressBookEntry = {
  id: "addr-throwaway-0001",
  name: "Throwaway Recipient",
  address: "k:00000000000000000000000000000000000000000000000000000recipient",
  type: "ouronet",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

/** A CodexSnapshot with >= 1 Kadena entry so the dashboard renders visible
 *  content (mode-2). Verbatim-hydrated; secrets are THROWAWAY encrypted. */
export const populatedKadenaSnapshot: CodexSnapshot = {
  kadenaSeeds: [throwawayKadenaSeed],
  ouroAccounts: [throwawayOuroAccount],
  pureKeypairs: [throwawayPureKeypair],
  addressBook: [throwawayAddressBookEntry],
  watchList: [],
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  consumerSettings: {},
  schemaVersion: 1,
  lastUpdatedAt: MODE2_LAST_UPDATED_AT,
  lastUpdatedDevice: MODE2_LAST_UPDATED_DEVICE,
};

// ---------------------------------------------------------------------------
// mode-1 fixture: BACKUP JSON STRING (augmented "1.2"+pureKeypairs shape).
//
// Matches `useCodexBackup`'s `BackupFileV12Plus` wire shape EXACTLY (verified on
// disk, codex-ui/src/hooks/useCodexBackup.ts):
//   { version: "1.2", exportedAt, kadenaWallets, ouronetWallets, addressBook,
//     uiSettings, pureKeypairs }
// This is NOT a raw codec envelope and is NOT stamped "1.3". No `foreignKeys`.
// Wallet secrets are THROWAWAY encrypted blobs (never plaintext). On restore,
// `importFromCloud` maps kadenaWallets->kadenaSeeds, ouronetWallets->ouroAccounts,
// pureKeypairs->(pureKeypairs ?? []), SYNTHESIZES lastUpdatedAt and re-stamps
// lastUpdatedDevice to the current device — so there is no verbatim lastUpdated*.
// ---------------------------------------------------------------------------

/** Parsed DATA slices of `backupJson`, exported so mode-1 tests deep-equal
 *  against SHARED constants (NOT the synthesized lastUpdated*). These are the
 *  values the restore adopts into the hydrated snapshot. */
export const backupKadenaWallets: IKadenaSeed[] = [
  {
    id: "seed-backup-throwaway-0001",
    name: "Backup Throwaway Seed",
    seedType: "koala",
    version: "1.2",
    index: 0,
    secret: THROWAWAY_ENCRYPTED_SEED_SECRET,
    main: "k:00000000000000000000000000000000000000000000000000000000bkupseed",
    createdAt: "2026-07-02T00:00:00.000Z",
    accounts: [
      {
        index: 0,
        publicKey:
          "0000000000000000000000000000000000000000000000000000bkupacct01",
        derivationPath: "m/44'/626'/0'/0/0",
      },
    ],
    isPrime: true,
  },
];

export const backupOuronetWallets: IOuroAccount[] = [
  {
    id: "ouro-backup-throwaway-0001",
    name: "Backup Throwaway Ouro",
    version: "1.2",
    isSmart: false,
    address: "Ѻ.backup-throwaway-account-not-real",
    guard: {
      pred: "keys-all",
      keys: [
        "0000000000000000000000000000000000000000000000000000bkupacct01",
      ],
    },
    kadenaLedger: null,
    publicKey:
      "0000000000000000000000000000000000000000000000000000bkupacct01",
    secret: THROWAWAY_ENCRYPTED_OURO_SECRET,
    backup: THROWAWAY_ENCRYPTED_OURO_BACKUP,
    isPrime: true,
    parentSeedId: "seed-backup-throwaway-0001",
  },
];

export const backupPureKeypairs: IPureKeypair[] = [
  {
    id: "pure-backup-throwaway-0001",
    label: "CodexGuard",
    publicKey:
      "0000000000000000000000000000000000000000000000000000bkuppureCG",
    encryptedPrivateKey: THROWAWAY_ENCRYPTED_PURE_PRIVKEY,
    createdAt: "2026-07-02T00:00:00.000Z",
    isCodexGuard: true,
  },
];

export const backupAddressBook: AddressBookEntry[] = [
  {
    id: "addr-backup-throwaway-0001",
    name: "Backup Recipient",
    address: "k:0000000000000000000000000000000000000000000000000000bkuprecip",
    type: "ouronet",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
  },
];

export const backupUiSettings: UiSettings = { ...DEFAULT_UI_SETTINGS };

/** Length reference for the mode-1 data-slice assertions. */
export const backupExpectedKadenaWalletsLength = backupKadenaWallets.length;
export const backupExpectedPureKeypairsLength = backupPureKeypairs.length;

/** The augmented "1.2"+pureKeypairs backup file object (pre-serialization).
 *  Kept typed-loose (the wire shape has DATA-slice field names, not the
 *  snapshot field names) so a drift in the reference slices is caught. */
const backupFileObject = {
  version: "1.2" as const,
  exportedAt: "2026-07-03T12:00:00.000Z",
  kadenaWallets: backupKadenaWallets,
  ouronetWallets: backupOuronetWallets,
  addressBook: backupAddressBook,
  uiSettings: backupUiSettings,
  pureKeypairs: backupPureKeypairs,
};

/** The mode-1 backup JSON STRING the real `useCodexBackup().importFromCloud`
 *  restores. Augmented "1.2"+pureKeypairs wire shape; THROWAWAY. */
export const backupJson: string = JSON.stringify(backupFileObject, null, 2);

/** THROWAWAY DEV-ONLY test password for the mode-1 unlock path. NOT a real
 *  password; it unlocks nothing of value (the secrets are fake blobs). */
export const backupPassword = "throwaway-dev-password-not-real" as const;
