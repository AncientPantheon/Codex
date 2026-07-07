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
//   - mode-2 (plaintext snapshot): `emptySnapshot` / `populatedStoaChainSnapshot`
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
  IStoaChainSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  UiSettings,
} from "@ancientpantheon/codex-ouronet/types";
import type {
  ForeignKeyEntry,
  ForeignKeysBlock,
  PureKeypairEntry,
  CodexExportV1_3,
} from "@ancientpantheon/codex-core";

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

/** A valid but EMPTY CodexSnapshot (mode-2). No StoaChain/Ouro entries. */
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
// mode-2 fixture: POPULATED-StoaChain plaintext snapshot.
//
// >= 1 StoaChain seed + >= 1 Ouro account (+ address-book + pure keypair) so the
// dashboard renders visible content. Secrets are THROWAWAY encrypted blobs.
// Known-fixed lastUpdated* for the verbatim round-trip.
// ---------------------------------------------------------------------------

const throwawayStoaChainSeed: IStoaChainSeed = {
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
  stoaChainLedger: null,
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

/** A CodexSnapshot with >= 1 StoaChain entry so the dashboard renders visible
 *  content (mode-2). Verbatim-hydrated; secrets are THROWAWAY encrypted. */
export const populatedStoaChainSnapshot: CodexSnapshot = {
  kadenaSeeds: [throwawayStoaChainSeed],
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
export const backupStoaChainWallets: IStoaChainSeed[] = [
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
    stoaChainLedger: null,
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
export const backupExpectedStoaChainWalletsLength = backupStoaChainWallets.length;
export const backupExpectedPureKeypairsLength = backupPureKeypairs.length;

/** The augmented "1.2"+pureKeypairs backup file object (pre-serialization).
 *  Kept typed-loose (the wire shape has DATA-slice field names, not the
 *  snapshot field names) so a drift in the reference slices is caught. */
const backupFileObject = {
  version: "1.2" as const,
  exportedAt: "2026-07-03T12:00:00.000Z",
  kadenaWallets: backupStoaChainWallets,
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

// ===========================================================================
// E5 ARWEAVE FIXTURES — the with-Arweave-keys "1.3"+{foreignKeys, pureKeypairs}
// backup + the throwaway keyfile. ALL THROWAWAY — NEVER REAL FUNDS OR KEYS
// (N-06). Added alongside the D6 fixtures above; the D6 "1.2" `backupJson`
// (no foreignKeys) STAYS as the reader-before-writer regression guard.
//
// SHAPE SOURCE OF TRUTH (grep-confirmed against the post-E1 stack):
//   - `useCodexBackup` (codex-ui/src/hooks/useCodexBackup.ts) exports via
//     `buildCodexExport` → a `"1.3"` envelope, and restores via
//     `deserializeCodex` which accepts BOTH "1.2" and "1.3".
//   - `buildCodexExport` (codex-core/src/codex/codec.ts) emits, for a codex
//     carrying both keyrings:
//       { version:"1.3", exportedAt, kadenaWallets, ouronetWallets, addressBook,
//         uiSettings, foreignKeys:{schemaVersion,keys}, pureKeypairs:[...] }
//     `foreignKeys` is a `{ schemaVersion, keys }` BLOCK; `pureKeypairs` is a
//     BARE ARRAY (the two keyrings have DIFFERENT wire shapes).
//   - On restore, `importFromCloud` UNWRAPS the block: the in-memory store slice
//     is a BARE `ForeignKeyEntry[]` (`parsed.foreignKeys?.keys ?? []`). This
//     block↔bare-array asymmetry is the top funds-loss vector E1 T11.6 flagged —
//     hence the two DISTINCT reference constants below.
//
// SECRET HYGIENE (N-06): `encryptedKeyfile` / `encryptedPrivateKey` are opaque
// THROWAWAY encrypted-BLOB placeholders (strings that satisfy the ForeignKeyEntry
// / PureKeypairEntry type shape) — NOT plaintext keys, NOT real ciphertext of
// any real key. The round-trip test (T15.5) asserts STRUCTURAL survival of the
// foreignKeys through import→export, not decryption, so a shape-valid throwaway
// blob is sufficient and no real key material is ever committed.
// ===========================================================================

/** THROWAWAY opaque encrypted-BLOB placeholder for an Arweave keyfile. NOT real
 *  ciphertext of any real JWK — a clearly-labeled dev-only string that satisfies
 *  the `ForeignKeyEntry.encryptedKeyfile: string` shape. Decrypts to nothing. */
const THROWAWAY_ENCRYPTED_ARWEAVE_KEYFILE =
  "THROWAWAY-enc::v1::YXJ3ZWF2ZS1rZXlmaWxlLWJsb2ItdGhyb3dhd2F5LW5vdC1yZWFs";

/** The chain id every Arweave foreign-key entry carries on the wire. This is the
 *  literal on-wire value of `ARWEAVE_CHAIN_ID` (codex-arweave `address-book`);
 *  a static JSON fixture stores the string, while the mock adapter (T15.4)
 *  imports the const rather than re-spelling it. */
const ARWEAVE_WIRE_CHAIN_ID = "arweave";

// ---------------------------------------------------------------------------
// F-001 reference constant (i): the BARE `ForeignKeyEntry[]` — the UNWRAPPED
// `keys`, i.e. the in-memory/restored store slice. T15.5(a) deep-equals the
// restored store's `foreignKeys` (an `Array.isArray` bare array) against THIS.
// ---------------------------------------------------------------------------

/** The bare `ForeignKeyEntry[]` the restore path lands in the store slice
 *  (`deserialized.foreignKeys?.keys ?? []`). ≥1 Arweave entry. The RESTORED /
 *  in-memory shape — a BARE ARRAY, NOT the on-wire block. */
export const expectedForeignKeysArray: ForeignKeyEntry[] = [
  {
    id: "fk-arweave-throwaway-0001",
    label: "Throwaway Arweave Key",
    chainId: ARWEAVE_WIRE_CHAIN_ID,
    encryptedKeyfile: THROWAWAY_ENCRYPTED_ARWEAVE_KEYFILE,
  },
];

// ---------------------------------------------------------------------------
// F-001 reference constant (ii): the on-wire BLOCK `{ schemaVersion, keys }`
// that `arweaveBackupJson.foreignKeys` carries. T15.5(b) deep-equals the
// EXPORTED backup's `foreignKeys` (the block) against THIS. `schemaVersion: 1`
// matches the codec's `FOREIGN_KEYS_BLOCK_SCHEMA_VERSION` constant.
// ---------------------------------------------------------------------------

/** The on-wire `foreignKeys` BLOCK — `{ schemaVersion, keys }`. The EXPORTED /
 *  on-disk shape (distinct from the bare-array in-memory slice above). */
export const expectedForeignKeysBlock: ForeignKeysBlock = {
  schemaVersion: 1,
  keys: expectedForeignKeysArray,
};

/** The `pureKeypairs` the "1.3" backup carries as a BARE ARRAY (reader-before-
 *  writer: the with-Arweave-keys backup carries BOTH keyrings). THROWAWAY. */
export const arweaveBackupPureKeypairs: PureKeypairEntry[] = [
  {
    id: "pure-arweave-throwaway-0001",
    label: "CodexGuard",
    publicKey:
      "0000000000000000000000000000000000000000000000000000arwv1pureCG",
    encryptedPrivateKey: THROWAWAY_ENCRYPTED_PURE_PRIVKEY,
    createdAt: "2026-07-04T00:00:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// The with-Arweave-keys "1.3" backup OBJECT — the exact `buildCodexExport`
// envelope shape (typed against the real `CodexExportV1_3` so a wire-shape drift
// is a type error here). `foreignKeys` is the BLOCK; `pureKeypairs` is the bare
// array. This is the ACTUAL format `importFromCloud`/`downloadAsJson` round-trip.
// ---------------------------------------------------------------------------

const arweaveBackupObject: CodexExportV1_3<
  IStoaChainSeed,
  IOuroAccount,
  AddressBookEntry,
  UiSettings,
  PureKeypairEntry
> = {
  version: "1.3",
  exportedAt: "2026-07-04T12:00:00.000Z",
  kadenaWallets: [],
  ouronetWallets: [],
  addressBook: [],
  uiSettings: { ...DEFAULT_UI_SETTINGS },
  foreignKeys: expectedForeignKeysBlock,
  pureKeypairs: arweaveBackupPureKeypairs,
};

/** The with-Arweave-keys backup JSON STRING in the D2 `"1.3"` codec envelope
 *  carrying `{foreignKeys, pureKeypairs}` — the ACTUAL post-E1-rewire format
 *  `useCodexBackup().importFromCloud`/`importFromFile` restores and
 *  `downloadAsJson()` emits. `foreignKeys` rides as a `{schemaVersion,keys}`
 *  BLOCK; secrets are THROWAWAY encrypted blobs. */
export const arweaveBackupJson: string = JSON.stringify(
  arweaveBackupObject,
  null,
  2,
);

/** THROWAWAY DEV-ONLY password for the with-Arweave-keys backup unlock path.
 *  NOT a real password; it unlocks nothing of value (the blobs are fake). */
export const arweaveBackupPassword = "throwaway-arweave-dev-password-not-real" as const;

// ---------------------------------------------------------------------------
// throwawayArweaveKeyfile — the plaintext with-Arweave-keys JWK fixture for the
// real-toggle IMPORT path (T15.6). This is a VERBATIM copy of E1's canonical
// throwaway keyfile (packages/codex-arweave/tests/fixtures/throwaway-arweave-
// keyfile.json — also copied to ./throwaway-arweave-keyfile.json in this dir for
// the file-upload path). It is a REAL 9-field RSA JWK, NEVER funded; its known
// 43-char address is the round-trip anchor. Embedded inline (not JSON-imported)
// because the base tsconfig has `resolveJsonModule` off — the inline object
// type-checks against the local 9-field JWK shape without a JSON-module flag.
// ---------------------------------------------------------------------------

/** The canonical 9-field Arweave RSA JWK shape. Declared locally (not imported
 *  from arweave-core) so this fixture module stays self-contained — it depends
 *  only on codex-core (an existing app dep), never on the codex-arweave/
 *  arweave-core resolution the sibling scaffold task wires. */
type ThrowawayArweaveJwk = {
  kty: "RSA";
  n: string;
  e: string;
  d: string;
  p: string;
  q: string;
  dp: string;
  dq: string;
  qi: string;
};

/** The known canonical 43-char Arweave address the `throwawayArweaveKeyfile`
 *  resolves to (E1's documented anchor). The real-toggle round-trip asserts an
 *  imported key derives THIS address. */
export const THROWAWAY_ARWEAVE_ADDRESS =
  "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4" as const;

/** THROWAWAY plaintext Arweave keyfile — a REAL canonical 9-field RSA JWK,
 *  NEVER funded (E1's `throwaway-arweave-keyfile.json`, copied verbatim). The
 *  with-Arweave-keys plaintext fixture for the real-toggle import path. Do NOT
 *  paste any real/funded key here. Its `THROWAWAY_ARWEAVE_ADDRESS` is the
 *  round-trip anchor. */
export const throwawayArweaveKeyfile: ThrowawayArweaveJwk = {
  kty: "RSA",
  n: "yJAX1h-rsU6rmGo5sVPn78h68L8jxNOT9UZ_VXNNxUpC5Lxo0tG4d97f0jPzjGGr6SE1BhGOUS9Af2WkTCRuRkAq3RaoU3cSJ0V_aaWQQug4ccR2msI0o3YFeTTcvfNZvkmeDyLO0lxJ5-w2lL3NF6kT15M5Ufs9rtdHQvOOH_1cjp_-6wEyDxUg_k9YhDTlQR8vKVsyEepPhC4tvzpxE4VTEP52rjfAszGME-Ph8nUirH1nfPsN4mjMyumZi_zVibu42Gjn5sfRHcK5GtA1wAnMgBx_POrXHIqD1x-UpvgUcpe-btiyFFDoobq1ZxalJnc18fVwetrRm-3WHiRxnqOaimENgqY1HaeU1q1mzytVQ7UywKJWJ5ixMHo3j1g6FBLKjvVe73s-SI-EhCQSR7r_VWEVWOg04iytLHN5udmUZl34DvKZdKAwobUYnIOp0cfpKeNngrRfd6JDQVtsqAbgZW5J-743f3fL7jb45DZg9DeCWDCWbwuX5hu8DBMgWIfwI6TrFh3QHxv0DatmJCz9qDbPVqlF6C_nIvqoYbDN1UtGWtZt0sU0upJtsTI9i5ayv9ns-VyotQEI9xb1kaiPVWaPOAuBLDbYMuG6grpbur_5XH7KCWz_mwF9c8MaWrnivFABAh37sYGXY1ClYoLJboktbwtNMWMOfBMdJOs",
  e: "AQAB",
  d: "pbgg8qQbWrMBvougwPAa5KqpCAHu0a_yd9Hh_nO49zk872QsTvAJld3mh6_L6RHhMP6TYBTfq35Uq9l_1dDWnc8BCZeONRFHbq9DjS_6ve7wImFiw256F2NiiM8SyV2IZv-ns_c-cR3JQ-P8PMY_0ZKHuQnwrltbp1MOUJ8-tqUMnpIgE_guaF3sFKrEX2MppEoNx4-d4eaRQm_PvBGY_izJBMGyl8UacMo6XkOZTcEOBltAdEKzvY_aoFLSa8391pnUmu2eoYq7QvzgrOut5Gm_SnOvMm-0a8c7TVXkeqSIpx-saeN3ioxl5mELtgGHZdch8qpTde4AuVa5kaNuAmZPgLcJNaeEcOefUdEAIGDaWf_ljMywuBOpcdIA9ofDj71O2u-jOVJ9WYBuuJ_e3KWIiuvfrbp3tQbQJyc6FCa2K24B4FhX6iE29dPvRoy8ryY2KlGx9mftBaxPJ-bKsdfHM-SfVbzTKhboz1sjU1t3qsI-QXtXIgpZwVWC3fiKsJW9XgMh89FkiFy1p1FZSpCEXZpbusytS007hcQuMFUf7xCNCft0-8FIjwxcHp6XE_bruZunOMD-aooGXggQY_Co2_8p_Z77tFnHCeC1IsGEqYkoEah8i9KQ6CMh-66QaG34Sd8gFkVGd96lZvjxu_fl2CBcJKVnVKUTGATUYQ",
  p: "8abrCXA5Y_Zy9UNuAMhBJnlIw1eOu76LzM3x5d9HxdrXRnvG7a9TjRT-XzuRoWnTjhaeHvPhK2pxEqI56_5cFJCghZKzllHxB_t-KiUi97lF1JpbdBD7l863qP8roxQFi5CSoVlRbXO7Mjah0eV7JQyw7twmaNmcSyvTnMeu8bx6SCvm_sx7zuYg1_lCNlqeNX5mOPUt4Vin6OwgH5js_cfGbzNwB4j_0-HpA7qTXvFwQr5CaVXMfePxFOzfi4JeL9Mz02zaPSr5gMKq_PDjv4-mtZBUW_5BbUA17ha6VFcSAIf5NiXrkXthJlW18-Eh-XmTPNjLMAjOh5SSLwreYQ",
  q: "1Hif6pyHwNrhKkMq8JfYt2CIyk87OWAoOVD4SUBjjmFW4hyUhjL8VMpWY0866totLsyd4Xtjb_0J5IaW3lURGgCisskOTv6jKZLboz-YOBbjMMsHQvzEgP6j3OQhOL8p6tMu0EOIZAn1ROOD2SqDfb2GLaGYYNHzMSZZunhC2vpmeOxajE6bBmsDNoeLMez_QEqgtjYvMcNDcyOlVxsyllv03qJBxFFa0hZto8mCnIN4NUSwh2L6YJvB15_TxbYDqYiO8loJCcp9B928CjtZifR2ATCTulHjQMZGZqKW1jLG0j4_aVWY2DQ_Iknw1i8Fh9aO5x10mRjPpqbRjkWOyw",
  dp: "3_XmUVoMJoQraPo0gk8WapTvhfOpGoFvycF5FqXIPCwlZnKjHHhoxBGX6yUnRGTzJ_X4WBGJN5av8ygc7IZSStD7pLAg9wk8jTxdYqwGa3bvrCne5oQy2TBB8UOE6uBMf1vfOeCw4fLnpJMTiJfZeK35cXbhtj0waE7XEa_TiME4x5jAvpc_i7Km7-NYpU144XUjQlihS__BptLotsAhrNaxJzCR_LnQ-EugjM8ndE_pzkHNBRj6rBZMwisCx6ZsqoBgwOtanGQu11IT7NdJDKoTRKTeOmA7vQhMszunNzF3QrzCkJe2ap_hmwjG2J9nwHIXrsXyErOmzes5TJYTIQ",
  dq: "gQWi7oARO75unxBcoe9Drc-UIW5No4DNzEhsDWdpTUu0y-fZFUkey4p3PSUevQCyEUo10XfxIU9CU6CbOvXjRav_IJxQ8Q1WHWfNsmtqzxyu57FSfo4p8b8v2HI77k6_cJa_Rb7MsxsM8sFKDnTvlkqhkVIgyyKTEFSehkqDJqCJ24KDVdJh91rCf7l9gFrPgcYPo7ZxoEFX0zJhM-0TIhVDNHLJhyJ0CUGPYLd8dfir5YUJwZ0MN-A9rOekXNozjR6c13RvKp_onv86MehqbgiiJATQoIMbgfklRSwUdowtCfy82wUcpKXNdM_7zMSPEjbrXlMXu-RCLIv-kuuQUw",
  qi: "hKN1b_ZwHyOUKaaGMOYV5OaJ48sCbf_VSYF3goyn-CaLbtN5at-sMAwWrjifxS0k_9XxZ19V-7wtyooL9b6vfnQYgY5QZzsUzsd80w-rBOxqAoUePSMUrZ893_lLvctS3jDtJ0EW6m9X21e89006G3_XeXLIobBtxosLTmcplCr-a625vgX_BR32RajIyf6h8JAMHiYLq9rBr_tld77oSMAxRsKHnEERKpw4LgrPvitlVfElAw831WKBbd_7Rort_1K7enw8rtzjpvpbSP-5CQ_y5IacZPlXynKAFTuYMMItwhD4HH7NGOXB323haiY0lP2-VuPUkH8nDNSkL1QWxw",
};
