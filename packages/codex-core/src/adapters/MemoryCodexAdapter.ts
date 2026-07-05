/**
 * MemoryCodexAdapter — the SSR/test reference implementation of the generic
 * `CodexAdapter<TSnapshot, TUiSettings>` seam.
 *
 * It is a pure in-memory store: `structuredClone` on the way in and out gives a
 * defensive copy so a caller can never mutate the adapter's internal state, and
 * the encrypted-UI-settings sidecar is a single in-memory slot. There is NO
 * persistence (state dies with the instance) and NO crypto — the "encrypted"
 * sidecar is stored verbatim, because Memory is for SSR pre-hydration and tests,
 * never a real security-sensitive session. Use `LocalStorageCodexAdapter` (with
 * an injected `CryptoSeam`) for that.
 *
 * The adapter is GENERIC over an arbitrary consumer snapshot (`TSnapshot`) and an
 * opaque UI-settings payload (`TUiSettings`): it names no Ouronet entity type, so
 * a headless non-Ouronet consumer can use it directly.
 */

import { emptySnapshotBase } from "./types.js";
import type {
  CodexAdapter,
  CodexSnapshotBase,
  DeviceVariant,
} from "./types.js";

export class MemoryCodexAdapter<
  TSnapshot extends CodexSnapshotBase,
  TUiSettings,
> implements CodexAdapter<TSnapshot, TUiSettings>
{
  public readonly name = "memory";

  private snapshot: TSnapshot;
  private uiSettingsEncrypted: TUiSettings | null = null;

  constructor(deviceVariant: DeviceVariant = "dev") {
    // The base skeleton is a valid TSnapshot until the first saveAll supplies the
    // consumer's payload; a consumer that reads before writing gets the empty base.
    this.snapshot = emptySnapshotBase(deviceVariant) as TSnapshot;
  }

  public async loadAll(): Promise<TSnapshot> {
    return structuredClone(this.snapshot);
  }

  public async saveAll(snapshot: TSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }

  public async touch(deviceVariant: DeviceVariant): Promise<{
    lastUpdatedAt: string;
    lastUpdatedDevice: DeviceVariant;
  }> {
    const lastUpdatedAt = new Date().toISOString();
    this.snapshot.lastUpdatedAt = lastUpdatedAt;
    this.snapshot.lastUpdatedDevice = deviceVariant;
    return { lastUpdatedAt, lastUpdatedDevice: deviceVariant };
  }

  public async getSchemaVersion(): Promise<number> {
    return this.snapshot.schemaVersion;
  }

  public async setSchemaVersion(version: number): Promise<void> {
    this.snapshot.schemaVersion = version;
  }

  public async loadUiSettingsEncrypted(): Promise<TUiSettings | null> {
    return this.uiSettingsEncrypted === null
      ? null
      : structuredClone(this.uiSettingsEncrypted);
  }

  public async saveUiSettingsEncrypted(settings: TUiSettings): Promise<void> {
    this.uiSettingsEncrypted = structuredClone(settings);
  }

  public async clearAll(): Promise<void> {
    this.snapshot = emptySnapshotBase(
      this.snapshot.lastUpdatedDevice,
    ) as TSnapshot;
    this.uiSettingsEncrypted = null;
  }
}
