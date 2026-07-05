/**
 * The chain-agnostic storage seam for a codex.
 *
 * This module owns the GENERIC substrate: a `CodexSnapshotBase` skeleton that
 * carries only the fields the substrate must know about generically, and a
 * `CodexAdapter<TSnapshot, TUiSettings>` interface parameterized over an
 * arbitrary consumer snapshot. The Ouronet entity arrays
 * (`kadenaSeeds`/`ouroAccounts`/`codexIdentity`/…) and the per-Ouronet-entity
 * convenience writes are deliberately ABSENT here — they belong to the
 * Ouronet-side extension, so a headless, non-Ouronet consumer can import this
 * core without dragging in Kadena/Ouronet types.
 */

import { CodexAdapterError } from "../codex/errors.js";
import type { ForeignKeyEntry } from "../codex/foreignKeys.js";

/**
 * The device tag stamped onto a snapshot's `lastUpdatedDevice`. It drives
 * multi-device conflict metadata (which device last wrote the codex). This is
 * a chain-agnostic concept, so it lives in core rather than the Ouronet side.
 */
export type DeviceVariant = "dev" | "main";

/**
 * The Ouronet-free snapshot skeleton. It carries ONLY the fields the substrate
 * reasons about generically. A consumer extends this with its own opaque,
 * chain-specific payload (e.g. an Ouronet extension adds `kadenaSeeds` etc.);
 * core never names those.
 *
 * `foreignKeys` is OPTIONAL and reuses D2's `ForeignKeyEntry` (a bare array,
 * matching the codec's "empty keyring ⇒ field absent" convention) — it is
 * omitted, not emitted empty, when there are no foreign keys.
 */
export interface CodexSnapshotBase {
  /** At-rest encryption schema of the snapshot's secret blobs. */
  schemaVersion: number;
  /** ISO timestamp of the last persist, or `null` for a never-persisted codex. */
  lastUpdatedAt: string | null;
  /** The device that last wrote the codex (multi-device conflict metadata). */
  lastUpdatedDevice: DeviceVariant;
  /** Seedless foreign-chain keyring; omitted when empty. */
  foreignKeys?: ForeignKeyEntry[];
}

/**
 * The generic codex storage interface, parameterized over the consumer's
 * concrete snapshot (`TSnapshot`) and its opaque UI-settings payload
 * (`TUiSettings`). The UI-settings sidecar pair is kept generic over
 * `TUiSettings` so a consumer can carry its own settings shape without core
 * naming it.
 *
 * The per-Ouronet-entity writes (`saveKadenaSeeds` etc.) are intentionally NOT
 * on this interface — they are an Ouronet-side extension concern.
 */
export interface CodexAdapter<
  TSnapshot extends CodexSnapshotBase,
  TUiSettings,
> {
  /** Stable identifier of the adapter implementation; feeds error messages. */
  readonly name: string;

  /** Read the entire snapshot. */
  loadAll(): Promise<TSnapshot>;
  /** Persist the entire snapshot. */
  saveAll(snapshot: TSnapshot): Promise<void>;

  /** Stamp the last-updated metadata and return the new values. */
  touch(deviceVariant: DeviceVariant): Promise<{
    lastUpdatedAt: string;
    lastUpdatedDevice: DeviceVariant;
  }>;

  /** Read the at-rest encryption schema version. */
  getSchemaVersion(): Promise<number>;
  /** Set the at-rest encryption schema version. */
  setSchemaVersion(version: number): Promise<void>;

  /** Read the encrypted UI-settings sidecar, or `null` when unset. */
  loadUiSettingsEncrypted(): Promise<TUiSettings | null>;
  /** Persist the encrypted UI-settings sidecar. */
  saveUiSettingsEncrypted(settings: TUiSettings): Promise<void>;

  /** Wipe all persisted codex state. */
  clearAll(): Promise<void>;
}

/**
 * Build a fresh, never-persisted snapshot skeleton. `schemaVersion` starts at
 * 0 and `lastUpdatedAt` is `null` (nothing has been written yet). No
 * `foreignKeys` field is emitted (empty ⇒ omitted), and no Ouronet arrays are
 * present — the base is chain-agnostic.
 */
export function emptySnapshotBase(
  deviceVariant: DeviceVariant
): CodexSnapshotBase {
  return {
    schemaVersion: 0,
    lastUpdatedAt: null,
    lastUpdatedDevice: deviceVariant,
  };
}

/**
 * Runtime guard: assert an unknown value conforms to the `CodexAdapter`
 * interface's load-bearing surface (`loadAll`/`saveAll` are functions). Throws
 * a structured, secret-free `CodexAdapterError` otherwise — the message names
 * the operation but never echoes the rejected value.
 */
export function assertCodexAdapter(
  x: unknown
): asserts x is CodexAdapter<CodexSnapshotBase, unknown> {
  if (
    x === null ||
    typeof x !== "object" ||
    typeof (x as { loadAll?: unknown }).loadAll !== "function" ||
    typeof (x as { saveAll?: unknown }).saveAll !== "function"
  ) {
    throw new CodexAdapterError(
      "unknown",
      "assertCodexAdapter",
      new Error("Provided adapter is missing required methods")
    );
  }
}
