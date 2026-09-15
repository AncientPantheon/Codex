/**
 * codex-core canonical envelope types.
 *
 * `PlaintextCodex` and `CodexExportV1_2` are ported verbatim from
 * `@ouronet/ouronet-core`'s `codex/types.ts` so the moved envelope keeps the
 * exact same in-memory + wire contracts. codex-core becomes the CANONICAL
 * owner of the "1.3" envelope; ouronet-core keeps an independent duplicated
 * peer (no cross-org runtime edge).
 *
 * The only addition over the ported shape is the OPTIONAL `foreignKeys` source
 * on `PlaintextCodex` — a bare `ForeignKeyEntry[]` the writer wraps into a
 * `{ schemaVersion, keys }` block on emit (the wire-side `ForeignKeysBlock` and
 * `CodexExportV1_3` are added by the codec module, not here).
 */

import type { ForeignKeyEntry, ForeignKeysBlock } from "./foreignKeys.js";
import type { PureKeypairEntry } from "./pureKeypairs.js";

/**
 * The wire shape of one Arweave seed inside a "1.3" export envelope — the
 * `IArweaveSeed` core fields (id / secret / createdAt), with the optional
 * `name` label and `isPrime` marker (the field the reported incident lost)
 * riding through unchanged. Declared here rather than in a dedicated model
 * file (unlike `ForeignKeyEntry`/`PureKeypairEntry`) because codex-core has no
 * other Arweave-specific module yet; the consumer's richer `IArweaveSeed`
 * (codex-ouronet) is structurally compatible and passes through verbatim.
 *
 * `secret` is ALWAYS ciphertext (`encryptStringV2(bitString, codexPassword)`)
 * — it must NEVER be logged, transmitted in cleartext, or echoed in an error
 * message; it is the only copy of the user's Arweave seed material.
 */
export type ArweaveSeedEntry = {
  /** Stable identifier for this seed (addresses it on restore). */
  id: string;
  /** Optional human label; a labelless entry is valid. */
  name?: string;
  /** Encrypted seed material — ciphertext at rest. NEVER plaintext; NEVER
   *  logged or echoed in an error message. */
  secret: string;
  /** ISO timestamp the seed was created. */
  createdAt: string;
  /** Prime Arweave Seed marker — the field a real incident lost entirely
   *  (a Prime seed reloaded as "Undefined" after this marker + the seed's
   *  whole record silently dropped out of the backup round-trip). */
  isPrime?: boolean;
};

/**
 * PlaintextCodex — the portable shape of an Ouronet user's in-memory
 * codex state. Consumers decide the concrete element types for each list
 * via generics (OuronetUI plugs in its IStoaChainSeed / IOuroAccount / etc;
 * the future HUB can supply its own if it prefers, or reuse UI's via a
 * shared `@ouronet/shared-types` package later).
 *
 * Why generic? Because the codec (serialize / deserialize) and any other
 * core-side consumer only cares about the SHAPE — "there are N wallets,
 * M accounts, K pure keypairs, an address book, and some ui settings".
 * The field contents are consumer-defined. Generics let the type carry
 * information without forcing core to own every wallet-domain type.
 *
 * Default type params are `unknown` so downstream code that doesn't need
 * field-level types still works — `PlaintextCodex` with no args treats
 * each list as `unknown[]`, which TypeScript allows assignment TO but
 * nothing structured FROM (exactly right for a generic serializer).
 */
export interface PlaintextCodex<
  StoaChainSeed       = unknown,
  OuroAccount      = unknown,
  PureKeypair      = unknown,
  AddressBookEntry = unknown,
  UiSettings       = unknown,
  ArweaveSeed      = unknown,
> {
  /** HD seeds (koala / chainweaver / eckowallet variants) known to this codex. */
  readonly kadenaWallets: StoaChainSeed[];
  /** Resident OURO accounts the user controls. */
  readonly ouronetWallets: OuroAccount[];
  /** Address-book entries (cached or user-added). */
  readonly addressBook: AddressBookEntry[];
  /** Raw pure Pact keypairs stored directly (encrypted privateKey). */
  readonly pureKeypairs: PureKeypair[];
  /** Non-sensitive UI preferences (dock position, zone state, etc). */
  readonly uiSettings: UiSettings;

  /**
   * Schema version of this codex. `0` = pre-upgrade V1-encrypted; `1+` =
   * post-upgrade V2-encrypted. Consumers can read this to decide whether
   * to run the encryption upgrade on unlock.
   *
   * This is the AT-REST ENCRYPTION schema of the secret blobs (device-local,
   * does not travel in the export). It is DISTINCT from the wire `version`
   * ("1.2"/"1.3") and from `ForeignKeysBlock.schemaVersion` (intra-block).
   */
  readonly schemaVersion: number;
  /** ISO timestamp of the last write to this codex (across any device). */
  readonly lastUpdatedAt: string | null;
  /** Which device family last wrote — used for dev/main cross-sync UX. */
  readonly lastUpdatedDevice: "dev" | "main";

  /**
   * OPTIONAL seedless foreign-key source. A BARE `ForeignKeyEntry[]` — NOT a
   * `ForeignKeysBlock`. The writer wraps this array into
   * `{ schemaVersion: FOREIGN_KEYS_BLOCK_SCHEMA_VERSION, keys }` on emit, where it is a
   * codec-level constant; keeping the source a bare array prevents a source
   * that carries its own `schemaVersion` from silently downgrading the
   * writer's stamped block version.
   *
   * OPTIONAL so existing StoaChain-only consumers compile unchanged.
   */
  readonly foreignKeys?: ForeignKeyEntry[];

  /**
   * OPTIONAL Arweave-seed keyring source — a BARE `ArweaveSeed[]`, mirroring
   * `pureKeypairs`' wire shape (NOT a `{schemaVersion, keys}` block like
   * `foreignKeys` — an Arweave seed carries no per-block schema version). Kept
   * OPTIONAL, like `foreignKeys`, so existing consumers built before Arweave
   * seeds existed compile unchanged.
   *
   * FUNDS-CRITICAL: this is the field a real incident lost entirely — a Prime
   * Arweave Seed vanished across a save+reload because the codec had no
   * awareness of it at all. Every consumer that builds a `PlaintextCodex`
   * source for export MUST thread its live `arweaveSeeds` state through here,
   * or the seed silently drops out of the backup on the next round-trip.
   */
  readonly arweaveSeeds?: ArweaveSeed[];
}

/**
 * The exported-backup JSON shape (`version: "1.2"` — the historical string
 * that OuronetUI has written since well before the extraction began).
 *
 * A codex backup is a subset of PlaintextCodex: no schemaVersion /
 * lastUpdatedAt / lastUpdatedDevice (those are device-local), and no
 * pureKeypairs in this historical shape (they shipped inside `cloud-backup`
 * alongside user settings — see the `downloadAsJson` → `exportForCloud`
 * split in OuronetUI's LocalStorageCodexAdapter). The `"1.2"` label
 * stays because a bump would break every existing user's recovery file.
 *
 * Note: the CURRENT `useCodexBackup` writer emits the "1.3" shape, which DOES
 * carry `pureKeypairs` (see `CodexExportV1_3`) so a fresh backup is restorable.
 * The "1.2" shape above stays pureKeypairs-free because it is READ-ONLY — no
 * writer emits it anymore.
 */
export interface CodexExportV1_2<
  StoaChainSeed       = unknown,
  OuroAccount      = unknown,
  AddressBookEntry = unknown,
  UiSettings       = unknown,
> {
  readonly version: "1.2";
  readonly exportedAt: string;
  readonly kadenaWallets: StoaChainSeed[];
  readonly ouronetWallets: OuroAccount[];
  readonly addressBook: AddressBookEntry[];
  readonly uiSettings: UiSettings;
}

/**
 * The exported-backup JSON shape written by the current codec (`version:
 * "1.3"`). Identical to `CodexExportV1_2` in every field EXCEPT the version
 * string and the OPTIONAL `foreignKeys` keyring block.
 *
 * The `foreignKeys` block is OMITTED entirely when the source codex carries no
 * foreign keys — an absent block and an empty block (`{ schemaVersion, keys: [] }`)
 * are DISTINCT and both valid on read; the writer never injects a mandatory
 * empty block. A historical "1.2" file has no `foreignKeys` and restores with
 * the property absent (no default is injected on the 1.2 path).
 *
 * `pureKeypairs` (added for the `useCodexBackup` rewire, FIX-2) rides the
 * envelope as a BARE ARRAY of `PureKeypairEntry` — NOT a `{ schemaVersion, keys }`
 * block like `foreignKeys`. WHY the divergence: pureKeypairs was already a bare
 * array in the old `BackupFileV12Plus` hook format the rewire replaces, and it
 * carries no per-block schema version. Like `foreignKeys`, it is OMITTED when the
 * source carries no pure keypairs (no mandatory empty array on the wire).
 *
 * `ForeignKeysBlock` and `PureKeypairEntry` are imported from their single-owner
 * models — never re-declared here.
 *
 * `arweaveSeeds` (the fix for the reported Prime-Arweave-Seed-vanishes
 * incident) rides the envelope the SAME way as `pureKeypairs` — a BARE ARRAY
 * of `ArweaveSeedEntry`, OMITTED when the source carries no Arweave seeds. It
 * is NOT block-wrapped like `foreignKeys`: an Arweave seed carries no
 * per-block schema version either.
 */
export interface CodexExportV1_3<
  StoaChainSeed       = unknown,
  OuroAccount      = unknown,
  AddressBookEntry = unknown,
  UiSettings       = unknown,
  PureKeypair      = PureKeypairEntry,
  ArweaveSeed      = ArweaveSeedEntry,
> {
  readonly version: "1.3";
  readonly exportedAt: string;
  readonly kadenaWallets: StoaChainSeed[];
  readonly ouronetWallets: OuroAccount[];
  readonly addressBook: AddressBookEntry[];
  readonly uiSettings: UiSettings;
  readonly foreignKeys?: ForeignKeysBlock;
  readonly pureKeypairs?: PureKeypair[];
  readonly arweaveSeeds?: ArweaveSeed[];
}
