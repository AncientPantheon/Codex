/**
 * codex-core canonical envelope types.
 *
 * `PlaintextCodex` and `CodexExportV1_2` are ported verbatim from
 * `@stoachain/ouronet-core`'s `codex/types.ts` so the moved envelope keeps the
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
   * `{ schemaVersion: 1, keys }` on emit, where `schemaVersion` is a
   * codec-level constant; keeping the source a bare array prevents a source
   * that carries its own `schemaVersion` from silently downgrading the
   * writer's stamped block version.
   *
   * OPTIONAL so existing StoaChain-only consumers compile unchanged.
   */
  readonly foreignKeys?: ForeignKeyEntry[];
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
 */
export interface CodexExportV1_3<
  StoaChainSeed       = unknown,
  OuroAccount      = unknown,
  AddressBookEntry = unknown,
  UiSettings       = unknown,
  PureKeypair      = PureKeypairEntry,
> {
  readonly version: "1.3";
  readonly exportedAt: string;
  readonly kadenaWallets: StoaChainSeed[];
  readonly ouronetWallets: OuroAccount[];
  readonly addressBook: AddressBookEntry[];
  readonly uiSettings: UiSettings;
  readonly foreignKeys?: ForeignKeysBlock;
  readonly pureKeypairs?: PureKeypair[];
}
