/**
 * LocalStorageCodexAdapter — a GENERIC, key-sharded reference implementation of
 * `CodexAdapter<TSnapshot, TUiSettings>`.
 *
 * It shards a codex snapshot across a set of storage keys: the generic base
 * metadata (`schemaVersion` / `lastUpdatedAt` / `lastUpdatedDevice`) each get
 * their own key, and everything else on the snapshot — the consumer's opaque,
 * chain-specific payload — is persisted as one JSON blob under a payload key. The
 * key names are CONFIGURABLE (constructor-injected, defaulting to generic
 * `codex_*` names) so a consumer (e.g. the D5 Ouronet subclass) can re-shard onto
 * its own historical key inventory without a core change.
 *
 * TWO seams keep codex-core dependency-light and DOM-lib-free:
 *   - `StorageLike` — a minimal, structurally-`localStorage` storage seam is
 *     injected, so core never references the ambient `window`/`Storage` DOM
 *     globals (which would not typecheck under the DOM-free `lib:["ES2023"]`
 *     tsconfig, and would leak DOM types into every headless consumer). An absent
 *     storage seam makes every operation throw a `CodexAdapterError`.
 *   - `CryptoSeam` — the encrypted-UI-settings sidecar encrypts/decrypts through
 *     an INJECTED crypto seam bound to a caller-supplied key (the CK), so core
 *     imports no real cipher. This mirrors the vault's injectable-crypto discipline.
 *
 * The Ouronet specifics of the source adapter (the `migrateSeedType` seed
 * migration, the hardwired `"wallets"`/`"ouronetWallets"` key names, the
 * redux-persist legacy fallback, the per-entity convenience writes) are NOT here —
 * they are re-supplied by the D5 Ouronet subclass/config.
 */

import { CodexAdapterError } from "../codex/errors.js";
import { emptySnapshotBase } from "./types.js";
import type {
  CodexAdapter,
  CodexSnapshotBase,
  DeviceVariant,
} from "./types.js";
import type { CryptoSeam } from "../vault/crypto.js";

/**
 * The minimal storage surface this adapter needs — structurally satisfied by the
 * browser `localStorage`. Declared locally so core stays DOM-lib-free; a consumer
 * injects `globalThis.localStorage` (or any Map-backed stub) at construction.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The configurable key map. Every field defaults to a generic `codex_*` name; a
 * consumer overrides any subset to match its own storage inventory.
 */
export interface LocalStorageCodexKeys {
  /** Key holding the integer schema version (stored as a string). */
  schemaVersion: string;
  /** Key holding the ISO last-updated timestamp. */
  lastUpdatedAt: string;
  /** Key holding the device variant ("dev" | "main"). */
  device: string;
  /** Key holding the opaque consumer-payload JSON blob. */
  payload: string;
  /** Key holding the encrypted UI-settings sidecar ciphertext. */
  uiSettingsEncrypted: string;
}

const DEFAULT_KEYS: LocalStorageCodexKeys = {
  schemaVersion: "codex_schema_version",
  lastUpdatedAt: "codex_last_updated",
  device: "codex_device",
  payload: "codex_payload",
  uiSettingsEncrypted: "codex_ui_settings_enc",
};

/** The base-metadata field names owned by `CodexSnapshotBase`. Everything on a
 *  snapshot EXCEPT these rides in the opaque payload blob. */
const BASE_FIELDS = new Set([
  "schemaVersion",
  "lastUpdatedAt",
  "lastUpdatedDevice",
]);

export interface LocalStorageCodexAdapterOptions {
  /** The storage seam (structurally `localStorage`). `null`/absent ⇒ every
   *  operation throws a `CodexAdapterError`. */
  storage: StorageLike | null | undefined;
  /** The injected crypto seam the UI-settings sidecar encrypts/decrypts through. */
  cryptoSeam: CryptoSeam;
  /** The key (the CK) bound to the sidecar crypto seam. */
  cryptoKey: string;
  /** The device stamp used when nothing has been persisted yet. */
  deviceVariant?: DeviceVariant;
  /** Optional overrides for the sharded key names. */
  keys?: Partial<LocalStorageCodexKeys>;
}

export class LocalStorageCodexAdapter<
  TSnapshot extends CodexSnapshotBase,
  TUiSettings,
> implements CodexAdapter<TSnapshot, TUiSettings>
{
  public readonly name = "localStorage";

  private readonly storage: StorageLike | null;
  private readonly cryptoSeam: CryptoSeam;
  private readonly cryptoKey: string;
  private readonly deviceVariant: DeviceVariant;
  private readonly keys: LocalStorageCodexKeys;

  constructor(options: LocalStorageCodexAdapterOptions) {
    this.storage = options.storage ?? null;
    this.cryptoSeam = options.cryptoSeam;
    this.cryptoKey = options.cryptoKey;
    this.deviceVariant = options.deviceVariant ?? "dev";
    this.keys = { ...DEFAULT_KEYS, ...options.keys };
  }

  public async loadAll(): Promise<TSnapshot> {
    const storage = this.assertStorage("loadAll");
    try {
      const base = emptySnapshotBase(this.deviceVariant);
      base.schemaVersion = this.readSchemaVersion(storage);
      base.lastUpdatedAt = storage.getItem(this.keys.lastUpdatedAt);
      base.lastUpdatedDevice = this.readDevice(storage);
      const payload = this.readPayload(storage);
      // The opaque payload carries the consumer's chain-specific slots; base
      // fields win (they are sharded under their own keys, not in the blob).
      return { ...payload, ...base } as TSnapshot;
    } catch (cause) {
      throw new CodexAdapterError(this.name, "loadAll", cause);
    }
  }

  public async saveAll(snapshot: TSnapshot): Promise<void> {
    const storage = this.assertStorage("saveAll");
    try {
      storage.setItem(this.keys.schemaVersion, String(snapshot.schemaVersion));
      if (snapshot.lastUpdatedAt !== null) {
        storage.setItem(this.keys.lastUpdatedAt, snapshot.lastUpdatedAt);
      }
      storage.setItem(this.keys.device, snapshot.lastUpdatedDevice);
      storage.setItem(this.keys.payload, JSON.stringify(this.payloadOf(snapshot)));
    } catch (cause) {
      throw new CodexAdapterError(this.name, "saveAll", cause);
    }
  }

  public async touch(deviceVariant: DeviceVariant): Promise<{
    lastUpdatedAt: string;
    lastUpdatedDevice: DeviceVariant;
  }> {
    const storage = this.assertStorage("touch");
    try {
      const lastUpdatedAt = new Date().toISOString();
      storage.setItem(this.keys.lastUpdatedAt, lastUpdatedAt);
      storage.setItem(this.keys.device, deviceVariant);
      return { lastUpdatedAt, lastUpdatedDevice: deviceVariant };
    } catch (cause) {
      throw new CodexAdapterError(this.name, "touch", cause);
    }
  }

  public async getSchemaVersion(): Promise<number> {
    const storage = this.assertStorage("getSchemaVersion");
    return this.readSchemaVersion(storage);
  }

  public async setSchemaVersion(version: number): Promise<void> {
    const storage = this.assertStorage("setSchemaVersion");
    try {
      storage.setItem(this.keys.schemaVersion, String(version));
    } catch (cause) {
      throw new CodexAdapterError(this.name, "setSchemaVersion", cause);
    }
  }

  public async loadUiSettingsEncrypted(): Promise<TUiSettings | null> {
    const storage = this.assertStorage("loadUiSettingsEncrypted");
    const ciphertext = storage.getItem(this.keys.uiSettingsEncrypted);
    if (ciphertext === null) return null;
    try {
      const plaintext = await this.cryptoSeam.decrypt(ciphertext, this.cryptoKey);
      return JSON.parse(plaintext) as TUiSettings;
    } catch {
      // A decrypt/parse failure (wrong CK, corrupt ciphertext) surfaces as a
      // clean "no encrypted settings" signal rather than crashing the load.
      return null;
    }
  }

  public async saveUiSettingsEncrypted(settings: TUiSettings): Promise<void> {
    const storage = this.assertStorage("saveUiSettingsEncrypted");
    try {
      const ciphertext = await this.cryptoSeam.encrypt(
        JSON.stringify(settings),
        this.cryptoKey,
      );
      storage.setItem(this.keys.uiSettingsEncrypted, ciphertext);
    } catch (cause) {
      throw new CodexAdapterError(this.name, "saveUiSettingsEncrypted", cause);
    }
  }

  public async clearAll(): Promise<void> {
    const storage = this.assertStorage("clearAll");
    try {
      for (const key of Object.values(this.keys)) storage.removeItem(key);
    } catch (cause) {
      throw new CodexAdapterError(this.name, "clearAll", cause);
    }
  }

  // ===== private helpers =====

  private assertStorage(operation: string): StorageLike {
    if (this.storage === null) {
      throw new CodexAdapterError(
        this.name,
        operation,
        new Error(
          "No storage seam available in this environment. " +
            "Inject a StorageLike (e.g. globalThis.localStorage), or use " +
            "MemoryCodexAdapter for SSR / Node.js contexts.",
        ),
      );
    }
    return this.storage;
  }

  private readSchemaVersion(storage: StorageLike): number {
    const raw = storage.getItem(this.keys.schemaVersion);
    if (raw === null) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private readDevice(storage: StorageLike): DeviceVariant {
    const raw = storage.getItem(this.keys.device);
    // An absent device key means the codex was never persisted here — fall back
    // to the adapter's configured variant rather than silently forcing "dev".
    if (raw === null) return this.deviceVariant;
    return raw === "main" ? "main" : "dev";
  }

  /** Read the opaque consumer payload, degrading to `{}` on missing/corrupt JSON
   *  (a partial-write crash or third-party tampering must not lock the codex). */
  private readPayload(storage: StorageLike): Record<string, unknown> {
    const raw = storage.getItem(this.keys.payload);
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  /** The snapshot minus its base fields — the opaque, chain-specific slots a
   *  consumer persists (core never names them). */
  private payloadOf(snapshot: TSnapshot): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(snapshot)) {
      if (!BASE_FIELDS.has(key)) payload[key] = value;
    }
    return payload;
  }
}
